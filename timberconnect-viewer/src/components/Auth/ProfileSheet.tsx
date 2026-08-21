/**
 * Profil bearbeiten
 *
 * Formular für das WebID-Profil des angemeldeten Nutzers. Ersetzt den früheren
 * Link auf die Solid-Server-Oberfläche: dort ist für Nicht-Techniker nicht
 * erkennbar, wie man seinen Namen ändert, weshalb im Menü dauerhaft
 * "Solid User" stand.
 *
 * Rolle und Company Prefix werden nur angezeigt, nicht bearbeitet — beide sind
 * bei der Registrierung write-once festgelegt (siehe RoleSetup).
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Loader2,
  User,
  Check,
  Shield,
  Lock,
  ExternalLink,
  Building2,
  Mail,
  Phone,
  Image as ImageIcon,
  FileText,
  Copy,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import {
  getProfile,
  isValidEmail,
  isValidPhotoUrl,
  EMPTY_PROFILE,
  type UserProfile,
} from "../../services/profileService";
import { SheetPortal, useBodyScrollLock } from "../UI/SheetPortal";

interface ProfileSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Ein beschriftetes Eingabefeld im Sheet-Stil. */
function Field({
  id,
  label,
  icon: Icon,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  icon: typeof User;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-white">
        <Icon className="w-3.5 h-3.5 text-night-300" />
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-night-400 leading-relaxed">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT_CLASS =
  "w-full px-4 py-3 bg-night-900 border border-white/10 rounded-xl text-white placeholder:text-night-400 focus:outline-none focus:border-acid-400/60 focus:ring-4 focus:ring-acid-400/10 transition-all disabled:opacity-50";

export function ProfileSheet({ isOpen, onClose }: ProfileSheetProps) {
  const { webId, role, companyPrefix, saveUserProfile } = useAuth();
  const [form, setForm] = useState<UserProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copiedWebId, setCopiedWebId] = useState(false);

  useBodyScrollLock(isOpen);

  // Aktuellen Profilstand laden, sobald das Sheet geöffnet wird.
  useEffect(() => {
    if (!isOpen || !webId) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    getProfile(webId)
      .then(setForm)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Profil konnte nicht geladen werden"),
      )
      .finally(() => setLoading(false));
  }, [isOpen, webId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const update = useCallback(
    (key: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setForm((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
    },
    [],
  );

  const emailError =
    form.email.trim() !== "" && !isValidEmail(form.email.trim())
      ? "Bitte eine gültige E-Mail-Adresse eingeben."
      : null;
  const photoError =
    form.photo.trim() !== "" && !isValidPhotoUrl(form.photo.trim())
      ? "Bitte eine vollständige URL angeben (https://...)."
      : null;
  const canSave = !loading && !saving && !emailError && !photoError;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await saveUserProfile(form);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Speichern fehlgeschlagen — hat Ihr Pod Schreibrechte für das Profil?",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetPortal>
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
              {/* Kopf */}
              <div className="flex items-start justify-between px-5 sm:px-6 pt-5 pb-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center overflow-hidden">
                    {form.photo && !photoError ? (
                      <img
                        src={form.photo}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <User className="w-5 h-5 text-acid-300" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Profil bearbeiten</h2>
                    <p className="text-xs text-night-300 mt-0.5">
                      Wird in Ihrem Solid Pod gespeichert
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/5 transition-colors text-night-300"
                  aria-label="Schließen"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Inhalt */}
              <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto scroll-touch space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-night-300">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm">Profil wird geladen...</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-night-300 leading-relaxed">
                      Diese Angaben stehen in Ihrem WebID-Profil und sind für andere
                      Teilnehmer der Lieferkette sichtbar. Der Name erscheint überall
                      dort, wo Sie in der App auftreten.
                    </p>

                    <Field id="profile-name" label="Anzeigename" icon={User}>
                      <input
                        id="profile-name"
                        type="text"
                        value={form.name}
                        onChange={update("name")}
                        disabled={saving}
                        placeholder="z. B. Anna Bergmann"
                        className={INPUT_CLASS}
                      />
                    </Field>

                    <Field
                      id="profile-org"
                      label="Unternehmen"
                      icon={Building2}
                      hint="Betrieb oder Organisation, in deren Namen Sie Daten einstellen."
                    >
                      <input
                        id="profile-org"
                        type="text"
                        value={form.organization}
                        onChange={update("organization")}
                        disabled={saving}
                        placeholder="z. B. Sägewerk Bergmann GmbH"
                        className={INPUT_CLASS}
                      />
                    </Field>

                    <Field id="profile-email" label="E-Mail" icon={Mail} error={emailError}>
                      <input
                        id="profile-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={form.email}
                        onChange={update("email")}
                        disabled={saving}
                        placeholder="kontakt@beispiel.de"
                        className={INPUT_CLASS}
                      />
                    </Field>

                    <Field id="profile-phone" label="Telefon" icon={Phone}>
                      <input
                        id="profile-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={form.phone}
                        onChange={update("phone")}
                        disabled={saving}
                        placeholder="+49 30 1234567"
                        className={INPUT_CLASS}
                      />
                    </Field>

                    <Field
                      id="profile-photo"
                      label="Profilbild (URL)"
                      icon={ImageIcon}
                      error={photoError}
                      hint="Öffentlich erreichbare Bild-URL, z. B. aus Ihrem Pod."
                    >
                      <input
                        id="profile-photo"
                        type="url"
                        value={form.photo}
                        onChange={update("photo")}
                        disabled={saving}
                        placeholder="https://..."
                        className={INPUT_CLASS}
                      />
                    </Field>

                    <Field
                      id="profile-note"
                      label="Kurzbeschreibung"
                      icon={FileText}
                      hint="Optionaler Freitext, z. B. Tätigkeitsschwerpunkt."
                    >
                      <textarea
                        id="profile-note"
                        value={form.note}
                        onChange={update("note")}
                        disabled={saving}
                        rows={3}
                        placeholder="z. B. Familienbetrieb mit Einschnitt von Nadelholz aus der Region."
                        className={`${INPUT_CLASS} resize-none`}
                      />
                    </Field>

                    {/* Unveränderliche Registrierungsdaten */}
                    <div className="border-t border-white/5 pt-4 space-y-2">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-white">
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                        Bei der Registrierung festgelegt
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {role && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-acid-400/10 border border-acid-400/30 rounded-full">
                            <Shield className="w-3 h-3 text-acid-300" />
                            <span className="text-xs font-medium text-acid-300">
                              {role.label}
                            </span>
                          </span>
                        )}
                        {companyPrefix && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-night-700/60 border border-white/10 rounded-full">
                            <span className="text-xs text-night-300">GCP</span>
                            <span className="text-xs font-mono text-night-200">
                              {companyPrefix}
                            </span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-night-400 leading-relaxed">
                        Rolle und GS1 Company Prefix sind Teil Ihrer Identität in der
                        Lieferkette und lassen sich nachträglich nicht ändern.
                      </p>
                      {/* Technische Kennung: eingeklappt. Die WebID ist fuer
                          Partner-Austausch und Support nuetzlich, aber fuer den
                          Alltag der Nutzer nur Rauschen -- deshalb auf Wunsch
                          sichtbar statt dauerhaft im Formular. */}
                      {webId && (
                        <details className="group pt-1">
                          <summary className="text-xs text-night-400 hover:text-night-200 cursor-pointer transition-colors list-none">
                            Technische Kennung anzeigen
                          </summary>
                          <div className="mt-2 space-y-2">
                            <p className="text-xs text-night-400 leading-relaxed">
                              Ihre WebID — die eindeutige Adresse Ihres Kontos im
                              Datenraum. Partner können Ihnen darüber Zugriff auf
                              ihre Daten geben.
                            </p>
                            <div className="flex items-start gap-2">
                              <code className="flex-1 min-w-0 text-[11px] font-mono text-night-200 bg-night-900 border border-white/10 rounded-lg px-2.5 py-2 break-all">
                                {webId}
                              </code>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(webId);
                                  setCopiedWebId(true);
                                  window.setTimeout(
                                    () => setCopiedWebId(false),
                                    1500,
                                  );
                                }}
                                className="flex-shrink-0 px-2.5 py-2 rounded-lg bg-night-700 border border-white/10 text-night-200 hover:text-acid-300 hover:border-acid-400/30 transition-colors"
                                aria-label="WebID kopieren"
                              >
                                {copiedWebId ? (
                                  <Check className="w-3.5 h-3.5 text-acid-300" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            <a
                              href={webId}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-night-400 hover:text-acid-300 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Rohdaten öffnen
                            </a>
                          </div>
                        </details>
                      )}
                    </div>

                    {error && (
                      <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                        {error}
                      </div>
                    )}

                    <button
                      onClick={handleSave}
                      disabled={!canSave}
                      className="btn btn-acid w-full"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Speichere in Ihrem Pod...
                        </>
                      ) : saved ? (
                        <>
                          <Check className="w-5 h-5" />
                          Gespeichert
                        </>
                      ) : (
                        "Profil speichern"
                      )}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
