import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { RoleCheckList, EmptyPodPolicyHint } from './RoleCheckList';

/**
 * "Wer darf dieses Dokument sehen?" — die Frage nach dem Upload.
 *
 * Ein Vorgang bringt mehrere Dokumente mit, die fachlich sehr verschieden sind:
 * die Leistungserklaerung soll die halbe Lieferkette sehen, die Kalkulation im
 * selben Vorgang niemand. Deshalb wird je Dokument gefragt, nicht je Vorgang.
 *
 * Gefuehrt wird das als Abfolge — ein Dokument je Schritt. Alle gleichzeitig
 * auf einer Seite waeren bei 25 Rollen mal vier Dokumenten eine Wand aus
 * Kaestchen, in der niemand mehr sieht, was zu welchem Dokument gehoert.
 *
 * VORBELEGT ist die allgemeine Pod-Freigabe. Der haeufige Fall — "alles wie
 * immer" — ist damit reines Weiterklicken; nur die Abweichung kostet Arbeit.
 * Die Auswahl kann die Pod-Freigabe nur einschraenken (siehe
 * accessControlService: effectiveRolesForDocument).
 */

export interface DocumentAccessTarget {
  /** URL der Datei im Pod — Subjekt der Regel. */
  fileUrl: string;
  /** Anzeigename (Dateiname bzw. Vorlagenbezeichnung). */
  label: string;
  /** Zusatz, z.B. "Pflichtdokument" oder die Vorlagenbezeichnung. */
  hint?: string | null;
  /** Material-Idente des Dokuments, fuer die EPCIS-Freigabe. */
  epcs?: string[];
}

export interface DocumentAccessDecision {
  fileUrl: string;
  label: string;
  roleIris: string[];
  epcs: string[];
}

interface DocumentAccessSheetProps {
  isOpen: boolean;
  /** Die Dokumente dieses Vorgangs, in der Reihenfolge des Uploads. */
  documents: DocumentAccessTarget[];
  /** Die allgemeine Freigabe des Pods — Obergrenze und Vorbelegung. */
  podAllowlist: string[];
  /** Laeuft noch, waehrend die Regeln geschrieben werden. */
  saving?: boolean;
  onConfirm: (decisions: DocumentAccessDecision[]) => void;
  /**
   * Ueberspringen: es wird KEINE Dokumentregel geschrieben, es bleibt bei der
   * allgemeinen Freigabe. Die Dateien sind zu diesem Zeitpunkt bereits im Pod.
   */
  onSkip: () => void;
}

export function DocumentAccessSheet({
  isOpen,
  documents,
  podAllowlist,
  saving = false,
  onConfirm,
  onSkip,
}: DocumentAccessSheetProps) {
  useBodyScrollLock(isOpen);

  const [index, setIndex] = useState(0);
  /** Auswahl je Datei-URL. */
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});

  // Beim Oeffnen jedes Dokument mit der Pod-Freigabe vorbelegen.
  useEffect(() => {
    if (!isOpen) return;
    setIndex(0);
    const initial: Record<string, Set<string>> = {};
    for (const doc of documents) initial[doc.fileUrl] = new Set(podAllowlist);
    setSelection(initial);
    // documents/podAllowlist sind beim Oeffnen stabil; ein Neuaufbau bei jeder
    // Referenzaenderung wuerde die laufende Auswahl verwerfen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const current = documents[index];
  const total = documents.length;
  const isLast = index >= total - 1;
  const selectedForCurrent: Set<string> = current
    ? (selection[current.fileUrl] ?? new Set<string>())
    : new Set<string>();

  const toggle = (iri: string) => {
    if (!current) return;
    setSelection((prev) => {
      const next = new Set(prev[current.fileUrl] ?? []);
      if (next.has(iri)) next.delete(iri);
      else next.add(iri);
      return { ...prev, [current.fileUrl]: next };
    });
  };

  const setAll = (on: boolean) => {
    if (!current) return;
    setSelection((prev) => ({
      ...prev,
      [current.fileUrl]: on ? new Set(podAllowlist) : new Set(),
    }));
  };

  const finish = () => {
    onConfirm(
      documents.map((doc) => ({
        fileUrl: doc.fileUrl,
        label: doc.label,
        roleIris: Array.from(selection[doc.fileUrl] ?? new Set<string>()),
        epcs: doc.epcs ?? [],
      })),
    );
  };

  // Zusammenfassung der bereits entschiedenen Dokumente — zeigt beim letzten
  // Schritt, was gleich gespeichert wird.
  const summary = useMemo(
    () =>
      documents.map((doc) => ({
        label: doc.label,
        count: (selection[doc.fileUrl] ?? new Set()).size,
      })),
    [documents, selection],
  );

  const hasPodPolicy = podAllowlist.length > 0;

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-night-950/70 backdrop-blur-sm flex items-stretch justify-center"
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full h-full sm:h-[90%] sm:my-auto sm:max-w-2xl bg-night-800 sm:border border-white/10 sm:rounded-3xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
            >
              {/* Kopf */}
              <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-white/10">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="w-5 h-5 text-acid-300" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-xl font-bold text-white">
                      Wer darf dieses Dokument sehen?
                    </h2>
                    <p className="text-xs text-night-300 mt-1 leading-relaxed">
                      Die Dateien liegen bereits in Ihrem Pod. Legen Sie jetzt je
                      Dokument fest, welche Rollen die darin enthaltenen Daten
                      abrufen dürfen.
                    </p>
                  </div>
                </div>

                {/* Fortschritt */}
                {total > 1 && (
                  <div className="flex items-center gap-1.5 mt-4">
                    {documents.map((doc, i) => (
                      <div
                        key={doc.fileUrl}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          i < index
                            ? 'bg-acid-400'
                            : i === index
                              ? 'bg-acid-400/60'
                              : 'bg-white/10'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Inhalt */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
                {current && (
                  <>
                    {/* Welches Dokument gerade dran ist */}
                    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-night-700/50 border border-white/10">
                      <div className="w-9 h-9 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-acid-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white truncate">
                          {current.label}
                        </p>
                        <p className="text-xs text-night-400 truncate">
                          {current.hint
                            ? current.hint
                            : `Dokument ${index + 1} von ${total}`}
                        </p>
                      </div>
                      {total > 1 && (
                        <span className="text-xs font-mono text-night-400 flex-shrink-0">
                          {index + 1}/{total}
                        </span>
                      )}
                    </div>

                    {!hasPodPolicy ? (
                      <EmptyPodPolicyHint />
                    ) : (
                      <>
                        {/* Schnellwahl */}
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-night-300">
                            <Users className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                            {selectedForCurrent.size} von {podAllowlist.length} Rollen
                            ausgewählt
                          </p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => setAll(true)}
                              disabled={saving}
                              className="text-xs font-semibold text-acid-300 hover:text-acid-200 transition-colors disabled:opacity-50"
                            >
                              Alle
                            </button>
                            <span className="text-night-600">·</span>
                            <button
                              onClick={() => setAll(false)}
                              disabled={saving}
                              className="text-xs font-semibold text-night-300 hover:text-white transition-colors disabled:opacity-50"
                            >
                              Keine
                            </button>
                          </div>
                        </div>

                        <RoleCheckList
                          selected={selectedForCurrent}
                          onToggle={toggle}
                          available={podAllowlist}
                          disabled={saving}
                        />

                        {selectedForCurrent.size === 0 && (
                          <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 leading-relaxed">
                            Dieses Dokument wird für niemanden freigegeben — nur
                            Sie selbst können es dann noch abrufen.
                          </p>
                        )}
                      </>
                    )}

                    {/* Beim letzten Schritt: was insgesamt gespeichert wird */}
                    {isLast && total > 1 && hasPodPolicy && (
                      <div className="rounded-2xl border border-white/10 bg-night-700/30 px-4 py-3">
                        <h4 className="text-[11px] font-bold tracking-[0.14em] text-night-300 uppercase mb-2">
                          Übersicht
                        </h4>
                        <dl className="space-y-1">
                          {summary.map((entry) => (
                            <div
                              key={entry.label}
                              className="flex items-baseline gap-3 text-xs"
                            >
                              <dt className="text-night-400 flex-1 min-w-0 truncate">
                                {entry.label}
                              </dt>
                              <dd className="text-white font-medium flex-shrink-0">
                                {entry.count === 0
                                  ? 'niemand'
                                  : `${entry.count} ${entry.count === 1 ? 'Rolle' : 'Rollen'}`}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Steuerung */}
              <div className="border-t border-white/10 px-5 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-2">
                  {index > 0 ? (
                    <button
                      onClick={() => setIndex((i) => i - 1)}
                      disabled={saving}
                      className="px-3.5 py-2.5 rounded-xl bg-night-700/60 hover:bg-night-700 text-night-200 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Zurück
                    </button>
                  ) : (
                    <button
                      onClick={onSkip}
                      disabled={saving}
                      className="px-3.5 py-2.5 rounded-xl bg-night-700/60 hover:bg-night-700 text-night-200 text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      Später festlegen
                    </button>
                  )}

                  {isLast ? (
                    <button
                      onClick={finish}
                      disabled={saving}
                      className="btn btn-acid flex-1"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Freigaben werden gespeichert...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Freigaben speichern</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => setIndex((i) => i + 1)}
                      disabled={saving}
                      className="btn btn-acid flex-1"
                    >
                      <span>Weiter</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-night-400 mt-2 text-center leading-relaxed">
                  {index === 0
                    ? 'Ohne Festlegung gilt Ihre allgemeine Freigabe. Änderbar bleibt das jederzeit unter „Zugriff verwalten".'
                    : 'Änderbar bleibt das jederzeit unter „Zugriff verwalten".'}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
