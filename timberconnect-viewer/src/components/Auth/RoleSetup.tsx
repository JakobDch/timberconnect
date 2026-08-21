/**
 * Role Setup Modal
 *
 * Shown once, on first login with a pod that has no declared role yet.
 * The chosen role is written to {pod}profile/role.ttl and used across the
 * dataspace for role-based access control.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TreePine, Factory, Building2, Ruler, Truck, Landmark, Loader2, ArrowRight, UserCog, Lock } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ROLES, isValidCompanyPrefix, type RoleDef } from "../../config/roles";
import { SheetPortal, useBodyScrollLock } from "../UI/SheetPortal";

const ROLE_ICONS: Record<string, typeof TreePine> = {
  Forst: TreePine,
  Saegewerk: Factory,
  BspWerk: Building2,
  // Ruler wie beim Planungsvorgang (ProcessTypePicker) -- die Planung ist
  // kein Werksbetrieb und soll sich von den Fabrik-Ikonen abheben.
  Holzbauplanung: Ruler,
  Haendler: Truck,
  Behoerde: Landmark,
};

export function RoleSetup() {
  const { needsRoleSetup, setRole, role: currentRole } = useAuth();
  const [selected, setSelected] = useState<RoleDef | null>(null);
  const [prefix, setPrefix] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(needsRoleSetup);

  // Migrationsfall: Rolle existiert schon (Bestandsnutzer), nur der Company
  // Prefix fehlt noch — Rolle dann vorauswählen.
  useEffect(() => {
    if (currentRole) setSelected(currentRole);
  }, [currentRole]);

  if (!needsRoleSetup) return null;

  const prefixValid = isValidCompanyPrefix(prefix.trim());
  const canConfirm = selected !== null && prefixValid && !saving;

  const handleConfirm = async () => {
    if (!selected || !prefixValid) return;
    setSaving(true);
    setError(null);
    try {
      await setRole(selected, prefix.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registrierung konnte nicht gespeichert werden");
      setSaving(false);
    }
  };

  return (
    <SheetPortal>
      <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night-950/80 backdrop-blur-sm sm:p-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={{ duration: 0.2 }}
          className="w-full sm:max-w-lg bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[88%] flex flex-col"
        >
          {/* Kopf (immer sichtbar) */}
          <div className="flex items-center gap-3 px-5 sm:px-6 pt-5 pb-4 flex-shrink-0">
            <div className="w-11 h-11 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
              <UserCog className="w-5 h-5 text-acid-300" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Registrierung abschließen</h2>
              <p className="text-xs text-night-300 mt-0.5">
                Rolle &amp; Company Prefix einmalig festlegen
              </p>
            </div>
          </div>

          {/* Inhalt (scrollbar) */}
          <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto scroll-touch space-y-4">
            <p className="text-sm text-night-300 leading-relaxed">
              Legen Sie einmalig fest, welche Rolle Sie in der Lieferkette einnehmen.
              Diese Angabe wird dezentral in Ihrem Solid Pod gespeichert und steuert,
              wer Ihre Daten abfragen darf.
            </p>

            {/* Einspaltig: die Rolle ist unveraenderlich, deshalb steht die
                Beschreibung neben jeder Option — nebeneinander waeren die
                Texte zu schmal, um gelesen zu werden. */}
            <div className="space-y-2">
              {ROLES.map((role) => {
                const Icon = ROLE_ICONS[role.id] ?? Building2;
                const isSelected = selected?.id === role.id;
                return (
                  <button
                    key={role.id}
                    onClick={() => setSelected(role)}
                    disabled={saving}
                    className={`w-full px-4 py-3 rounded-2xl border text-left transition-all disabled:opacity-50 ${
                      isSelected
                        ? "border-acid-400/50 bg-acid-400/10"
                        : "border-white/10 bg-night-700/50 hover:border-acid-400/30"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0 ${
                          isSelected
                            ? "bg-acid-400 border-acid-300 text-night-950"
                            : "bg-night-700 border-white/5 text-acid-300"
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{role.label}</div>
                        <p className="text-xs text-night-300 mt-0.5 leading-relaxed">
                          {role.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* GS1 Company Prefix — Pflichtfeld, nach der Registrierung unveränderlich */}
            <div className="border-t border-white/5 pt-4 space-y-2">
              <label htmlFor="company-prefix" className="block text-sm font-medium text-white">
                GS1 Company Prefix <span className="text-red-400">*</span>
              </label>
              <input
                id="company-prefix"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.replace(/\s/g, ""))}
                disabled={saving}
                placeholder="z. B. 4047111124"
                className="w-full px-4 py-3 bg-night-900 border border-white/10 rounded-xl text-white font-mono placeholder:text-night-400 placeholder:font-sans focus:outline-none focus:border-acid-400/60 focus:ring-4 focus:ring-acid-400/10 transition-all disabled:opacity-50"
              />
              {prefix.trim() !== "" && !prefixValid && (
                <p className="text-xs text-red-400">
                  Der Company Prefix muss aus 4–12 Ziffern bestehen.
                </p>
              )}
              <p className="flex items-start gap-1.5 text-xs text-night-300 leading-relaxed">
                <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-400" />
                <span>
                  Ihr GS1 Company Prefix identifiziert Ihr Unternehmen in allen
                  GS1-Identen (SGTIN/LGTIN) und EPCIS-Events.{" "}
                  <span className="font-semibold text-night-200">
                    Er wird einmalig in Ihrem Pod gespeichert und kann nach der
                    Registrierung nicht mehr geändert werden.
                  </span>
                </span>
              </p>
            </div>

            {error && (
              <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                {error}
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="btn btn-acid w-full"
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Speichere in Ihrem Pod...
                </>
              ) : (
                <>
                  Registrierung bestätigen
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
      </AnimatePresence>
    </SheetPortal>
  );
}
