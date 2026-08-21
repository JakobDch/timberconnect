/**
 * Role Access Settings Modal
 *
 * Lets the pod owner choose which roles may query their data. Writes the
 * allowlist to {pod}access/role-policy.ttl, (re)materialises the per-role
 * vcard:Group documents, and re-stamps existing data-container ACLs so the
 * change takes effect in WAC immediately.
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Shield, Check } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ROLES } from "../../config/roles";
import {
  getAllowedRoles,
  setAllowedRoles,
  podBaseFromWebId,
} from "../../services/accessControlService";
import { resolveRoleMembers } from "../../services/registryService";
import { useBodyScrollLock } from "../UI/SheetPortal";

interface RoleAccessSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RoleAccessSettings({ isOpen, onClose }: RoleAccessSettingsProps) {
  const { webId } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useBodyScrollLock(isOpen);

  // Load the current allowlist when the modal opens.
  useEffect(() => {
    if (!isOpen || !webId) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    const pod = podBaseFromWebId(webId);
    getAllowedRoles(pod)
      .then((iris) => setSelected(new Set(iris)))
      .catch((e) => setError(e instanceof Error ? e.message : "Laden fehlgeschlagen"))
      .finally(() => setLoading(false));
  }, [isOpen, webId]);

  // Escape schliesst das Modal (X kann bei kleinen Fenstern sonst schwer erreichbar sein)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  };

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
            className="w-full sm:max-w-md bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[88%] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kopf (immer sichtbar) */}
            <div className="flex items-start justify-between px-5 sm:px-6 pt-5 pb-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-acid-300" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Zugriff verwalten</h2>
                  <p className="text-xs text-night-300 mt-0.5">
                    Rollenbasierte Freigabe Ihrer Daten
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

            {/* Inhalt (scrollbar) */}
            <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto scroll-touch space-y-4">
              <p className="text-sm text-night-300 leading-relaxed">
                Wählen Sie, welche Rollen Ihre Daten abfragen dürfen. Die Auswahl
                wird in Ihrem Pod gespeichert und sofort als Zugriffsregel
                durchgesetzt.
              </p>

              {loading ? (
                <div className="flex items-center justify-center py-8 text-night-300">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-2.5">
                  {ROLES.map((role) => {
                    const isOn = selected.has(role.iri);
                    return (
                      <button
                        key={role.id}
                        onClick={() => toggle(role.iri)}
                        disabled={saving}
                        className={`w-full px-4 py-3 rounded-2xl border text-left transition-all flex items-start justify-between disabled:opacity-50 ${
                          isOn
                            ? "border-acid-400/50 bg-acid-400/10"
                            : "border-white/10 bg-night-700/50 hover:border-acid-400/30"
                        }`}
                      >
                        <span className="min-w-0 pr-3">
                          <span className="block text-sm font-semibold text-white">
                            {role.label}
                          </span>
                          <span className="block text-xs text-night-300 mt-0.5 leading-relaxed">
                            {role.description}
                          </span>
                        </span>
                        <span
                          className={`w-6 h-6 rounded-md flex items-center justify-center border transition-colors flex-shrink-0 ${
                            isOn
                              ? "bg-acid-400 border-acid-400 text-night-950"
                              : "border-white/20"
                          }`}
                        >
                          {isOn && <Check className="w-4 h-4" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {error && (
                <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}

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
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
