/**
 * Zugriff verwalten
 *
 * Zwei Ebenen in einem Dialog, weil sie zusammen gelesen werden muessen:
 *
 *   ALLGEMEIN  — welche Rollen duerfen Ihre Daten grundsaetzlich abfragen.
 *                Schreibt {pod}access/role-policy.ttl, materialisiert die
 *                vcard:Group-Dokumente und stempelt die Container-ACLs nach.
 *                Das ist die Obergrenze: kein Dokument kann mehr freigeben.
 *
 *   DOKUMENTE  — welche Rollen duerfen EIN bestimmtes Dokument sehen.
 *                Schreibt {pod}access/doc-policy.ttl und eine Ressourcen-ACL
 *                je Datei. Wirksam ist stets die Schnittmenge mit der
 *                allgemeinen Freigabe.
 *
 * Die Reihenfolge der Tabs bildet diese Abhaengigkeit ab: wer die allgemeine
 * Freigabe leer laesst, hat bei den Dokumenten nichts zu waehlen.
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  Check,
  FileText,
  Loader2,
  Search,
  Shield,
  X,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import {
  getAllowedRoles,
  setAllowedRoles,
  setDocumentPolicies,
  listManagedDocuments,
  podBaseFromWebId,
  type ManagedDocument,
} from "../../services/accessControlService";
import { resolveRoleMembers } from "../../services/registryService";
import { RoleCheckList, EmptyPodPolicyHint } from "../Access/RoleCheckList";
import { summariseRoles } from "../Access/roleSummary";
import { useBodyScrollLock } from "../UI/SheetPortal";

interface RoleAccessSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "general" | "documents";

export function RoleAccessSettings({ isOpen, onClose }: RoleAccessSettingsProps) {
  const { webId } = useAuth();
  const [tab, setTab] = useState<Tab>("general");

  // --- allgemeine Freigabe ---
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // --- Dokumente ---
  const [documents, setDocuments] = useState<ManagedDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Dokument, dessen Rollen gerade bearbeitet werden. */
  const [editing, setEditing] = useState<ManagedDocument | null>(null);
  const [editSelection, setEditSelection] = useState<Set<string>>(new Set());
  const [savingDoc, setSavingDoc] = useState(false);

  useBodyScrollLock(isOpen);

  // Die aktuelle Allowlist beim Oeffnen laden.
  useEffect(() => {
    if (!isOpen || !webId) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    setTab("general");
    setEditing(null);
    setQuery("");
    const pod = podBaseFromWebId(webId);
    getAllowedRoles(pod)
      .then((iris) => setSelected(new Set(iris)))
      .catch((e) => setError(e instanceof Error ? e.message : "Laden fehlgeschlagen"))
      .finally(() => setLoading(false));
  }, [isOpen, webId]);

  /** Dokumentliste laden — erst beim Wechsel auf den Tab, sie kostet Requests. */
  const loadDocuments = useCallback(async () => {
    if (!webId) return;
    setDocsLoading(true);
    setDocsError(null);
    try {
      setDocuments(await listManagedDocuments(webId));
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : "Dokumente konnten nicht geladen werden");
    } finally {
      setDocsLoading(false);
    }
  }, [webId]);

  useEffect(() => {
    if (isOpen && tab === "documents" && documents.length === 0 && !docsLoading) {
      void loadDocuments();
    }
    // Nur beim Tabwechsel nachladen, nicht bei jeder Listenaenderung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tab]);

  // Escape schliesst das Modal (X kann bei kleinen Fenstern sonst schwer erreichbar sein)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Aus der Dokumentbearbeitung erst eine Ebene zurueck, nicht gleich zu.
      if (editing) setEditing(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, editing]);

  const toggle = useCallback((iri: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(iri)) next.delete(iri);
      else next.add(iri);
      return next;
    });
    setSaved(false);
  }, []);

  const handleSave = async () => {
    if (!webId) return;
    setSaving(true);
    setError(null);
    try {
      // Resolve each allowed role's members from the federation registry
      // (WebIDs that declared that role). The owner's own WebID is always
      // included so they can read their own data via any role they grant.
      await setAllowedRoles(webId, Array.from(selected), async (roleIri) => {
        const members = await resolveRoleMembers(roleIri);
        return Array.from(new Set([webId, ...members]));
      });
      setSaved(true);
      // Die Dokumentliste haengt an dieser Obergrenze -> neu berechnen lassen.
      setDocuments([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  };

  const openDocument = (doc: ManagedDocument) => {
    setEditing(doc);
    // Ohne eigene Regel startet die Bearbeitung bei der Pod-Freigabe — das ist
    // der Zustand, der aktuell auch tatsaechlich gilt.
    setEditSelection(new Set(doc.effectiveRoleIris));
  };

  const saveDocument = async () => {
    if (!webId || !editing) return;
    setSavingDoc(true);
    setDocsError(null);
    try {
      await setDocumentPolicies(webId, [
        { fileUrl: editing.fileUrl, roleIris: Array.from(editSelection) },
      ]);
      // Nur den bearbeiteten Eintrag auffrischen, damit die Liste nicht
      // springt und der Nutzer sieht, was sich geaendert hat.
      const roles = Array.from(editSelection).filter((iri) => selected.has(iri));
      setDocuments((prev) =>
        prev.map((d) =>
          d.fileUrl === editing.fileUrl
            ? { ...d, roleIris: roles, effectiveRoleIris: roles, hasOwnPolicy: true }
            : d,
        ),
      );
      setEditing(null);
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSavingDoc(false);
    }
  };

  const podAllowlist = Array.from(selected);
  const filtered = documents.filter((d) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      d.name.toLowerCase().includes(q) ||
      d.label.toLowerCase().includes(q) ||
      d.containerName.toLowerCase().includes(q)
    );
  });

  // Portal: das Modal haengt im UserMenu innerhalb des Headers, dessen
  // backdrop-blur einen Containing Block fuer position:fixed erzeugt —
  // ohne Portal wuerde sich "fixed inset-0" auf den Header beziehen.
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night-950/80 backdrop-blur-sm sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="w-full sm:max-w-lg bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[88%] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kopf (immer sichtbar) */}
            <div className="flex items-start justify-between px-5 sm:px-6 pt-5 pb-4 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {editing ? (
                  <button
                    onClick={() => setEditing(null)}
                    className="w-11 h-11 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                    aria-label="Zurück zur Dokumentliste"
                  >
                    <ChevronLeft className="w-5 h-5 text-night-200" />
                  </button>
                ) : (
                  <div className="w-11 h-11 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
                    <Shield className="w-5 h-5 text-acid-300" />
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white truncate">
                    {editing ? editing.label : "Zugriff verwalten"}
                  </h2>
                  <p className="text-xs text-night-300 mt-0.5 truncate">
                    {editing
                      ? editing.containerName
                      : "Rollenbasierte Freigabe Ihrer Daten"}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                aria-label="Schließen"
              >
                <X className="w-4 h-4 text-night-300" />
              </button>
            </div>

            {/* Tabs — nur ausserhalb der Dokumentbearbeitung */}
            {!editing && (
              <div className="px-5 sm:px-6 pb-3 flex-shrink-0">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-night-700/50 border border-white/10">
                  <TabButton
                    active={tab === "general"}
                    onClick={() => setTab("general")}
                    label="Allgemein"
                  />
                  <TabButton
                    active={tab === "documents"}
                    onClick={() => setTab("documents")}
                    label="Je Dokument"
                  />
                </div>
              </div>
            )}

            {/* Inhalt (scrollbar) */}
            <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto scroll-touch space-y-4">
              {/* ---------- Einzelnes Dokument bearbeiten ---------- */}
              {editing ? (
                <>
                  <p className="text-sm text-night-300 leading-relaxed">
                    Wählen Sie, welche Rollen dieses Dokument einsehen dürfen.
                    Mehr als Ihre allgemeine Freigabe ist nicht möglich.
                  </p>

                  {podAllowlist.length === 0 ? (
                    <EmptyPodPolicyHint onOpenSettings={() => setEditing(null)} />
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-night-300">
                          {editSelection.size} von {podAllowlist.length} Rollen
                        </p>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => setEditSelection(new Set(podAllowlist))}
                            disabled={savingDoc}
                            className="text-xs font-semibold text-acid-300 hover:text-acid-200 disabled:opacity-50"
                          >
                            Alle
                          </button>
                          <span className="text-night-600">·</span>
                          <button
                            onClick={() => setEditSelection(new Set())}
                            disabled={savingDoc}
                            className="text-xs font-semibold text-night-300 hover:text-white disabled:opacity-50"
                          >
                            Keine
                          </button>
                        </div>
                      </div>

                      <RoleCheckList
                        selected={editSelection}
                        available={podAllowlist}
                        disabled={savingDoc}
                        compact
                        onToggle={(iri) =>
                          setEditSelection((prev) => {
                            const next = new Set(prev);
                            if (next.has(iri)) next.delete(iri);
                            else next.add(iri);
                            return next;
                          })
                        }
                      />

                      {editSelection.size === 0 && (
                        <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 leading-relaxed">
                          Dieses Dokument wird für niemanden freigegeben — nur
                          Sie selbst können es dann noch abrufen.
                        </p>
                      )}
                    </>
                  )}

                  {docsError && <ErrorNote message={docsError} />}

                  <button
                    onClick={() => void saveDocument()}
                    disabled={savingDoc || podAllowlist.length === 0}
                    className="btn btn-acid w-full"
                  >
                    {savingDoc ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Speichere...
                      </>
                    ) : (
                      "Freigabe speichern"
                    )}
                  </button>
                </>
              ) : tab === "general" ? (
                /* ---------- Allgemeine Pod-Freigabe ---------- */
                <>
                  <p className="text-sm text-night-300 leading-relaxed">
                    Wählen Sie, welche Rollen Ihre Daten abfragen dürfen. Das ist
                    die Obergrenze für alle Dokumente und zugleich die
                    Voreinstellung für neue Uploads.
                  </p>

                  {loading ? (
                    <Spinner />
                  ) : (
                    <RoleCheckList
                      selected={selected}
                      onToggle={toggle}
                      disabled={saving}
                    />
                  )}

                  {error && <ErrorNote message={error} />}

                  <button
                    onClick={handleSave}
                    disabled={saving || loading}
                    className="btn btn-acid w-full"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Speichere...
                      </>
                    ) : saved ? (
                      <>
                        <Check className="w-5 h-5" />
                        Gespeichert
                      </>
                    ) : (
                      "Speichern"
                    )}
                  </button>
                </>
              ) : (
                /* ---------- Liste der Dokumente ---------- */
                <>
                  <p className="text-sm text-night-300 leading-relaxed">
                    Hier legen Sie je Dokument fest, wer es sehen darf.
                    Dokumente ohne eigene Regel folgen Ihrer allgemeinen
                    Freigabe.
                  </p>

                  {podAllowlist.length === 0 && (
                    <EmptyPodPolicyHint onOpenSettings={() => setTab("general")} />
                  )}

                  {documents.length > 5 && (
                    <div className="relative">
                      <Search className="w-4 h-4 text-night-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Dokument oder Vorgang suchen..."
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-night-700/50 border border-white/10 text-sm text-white placeholder:text-night-400 focus:outline-none focus:border-acid-400/50"
                      />
                    </div>
                  )}

                  {docsLoading ? (
                    <Spinner />
                  ) : docsError ? (
                    <ErrorNote message={docsError} />
                  ) : filtered.length === 0 ? (
                    <p className="text-sm text-night-400 text-center py-8">
                      {documents.length === 0
                        ? "Noch keine Dokumente in Ihrem Pod."
                        : "Keine Treffer."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {filtered.map((doc) => (
                        <button
                          key={doc.fileUrl}
                          onClick={() => openDocument(doc)}
                          className="w-full px-4 py-3 rounded-2xl border border-white/10 bg-night-700/40 hover:border-acid-400/30 text-left transition-all flex items-center gap-3"
                        >
                          <div className="w-9 h-9 rounded-xl bg-acid-400/10 border border-acid-400/20 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-4 h-4 text-acid-300" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white truncate">
                              {doc.label}
                            </p>
                            <p className="text-xs text-night-400 truncate">
                              {doc.containerName}
                            </p>
                          </div>
                          <div className="flex-shrink-0 text-right max-w-[42%]">
                            <p
                              className={`text-xs font-semibold truncate ${
                                doc.effectiveRoleIris.length === 0
                                  ? "text-amber-300"
                                  : "text-acid-300"
                              }`}
                            >
                              {summariseRoles(doc.effectiveRoleIris)}
                            </p>
                            <p className="text-[10px] text-night-500 uppercase tracking-wide mt-0.5">
                              {doc.hasOwnPolicy ? "eigene Regel" : "wie Pod"}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
        active ? "bg-acid-400 text-night-950" : "text-night-300 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-8 text-night-300">
      <Loader2 className="w-6 h-6 animate-spin" />
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
      {message}
    </div>
  );
}
