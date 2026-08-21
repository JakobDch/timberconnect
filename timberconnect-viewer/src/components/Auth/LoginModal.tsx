/**
 * Login Modal
 *
 * Einstieg in die Anmeldung -- bewusst ohne Solid-Vokabular.
 *
 * Hintergrund: Die eigentliche Passworteingabe passiert IMMER beim Solid-Server
 * (OIDC), nicht in dieser App -- die App darf das Passwort per Design nie sehen.
 * Diese Fremdseite laesst sich also nicht wegdesignen. Was sie aber weniger
 * irritierend macht, ist der Rahmen drumherum: Der Nutzer waehlt hier keinen
 * "Identity Provider" und tippt keine WebID, sondern klickt "Anmelden" und
 * erfaehrt vorher in einem Satz, dass gleich eine Server-Seite kommt und warum.
 * Die Server-Auswahl bleibt hinter "Anderes Konto verwenden" fuer die wenigen
 * Nutzer, die einen eigenen Pod betreiben.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight, ShieldCheck, ExternalLink, Loader2, ChevronLeft } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { getLastIssuer } from "../../auth/solidSession";
import { SheetPortal, useBodyScrollLock } from "../UI/SheetPortal";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Der Server, auf dem die Konten der Demonstrator-Partner liegen. */
const DEFAULT_ISSUER = "https://solid-community-server.tmdt.info";

/** Alternativen fuer Nutzer mit eigenem Pod -- absichtlich nachrangig. */
const ALTERNATIVE_ISSUERS = [
  {
    id: "solidcommunity",
    name: "solidcommunity.net",
    description: "Öffentlicher Solid-Server",
    url: "https://solidcommunity.net",
  },
];

/** Anzeigename eines Servers ohne Protokoll-Rauschen. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type Step = "intro" | "advanced";

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { login } = useAuth();
  const [step, setStep] = useState<Step>("intro");
  const [customIssuer, setCustomIssuer] = useState("");
  /** Zwischen Klick und Browser-Redirect vergeht ein Moment -- den zeigen wir. */
  const [redirecting, setRedirecting] = useState(false);

  const lastIssuer = getLastIssuer();

  useBodyScrollLock(isOpen);

  // Beim Schliessen zuruecksetzen, damit das Sheet nie im Fortgeschrittenen-
  // Schritt oder im Redirect-Zustand wieder aufgeht.
  useEffect(() => {
    if (isOpen) return;
    setStep("intro");
    setCustomIssuer("");
    setRedirecting(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !redirecting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, redirecting]);

  const startLogin = (issuer: string) => {
    setRedirecting(true);
    login(issuer);
    // Kein onClose(): der Browser verlaesst gleich die Seite. Das Modal bleibt
    // mit Ladeanzeige stehen, damit nicht kurz die alte Ansicht aufblitzt.
  };

  const handleCustomLogin = () => {
    const value = customIssuer.trim();
    if (!value) return;
    // Nutzer tippen "meinserver.de" -- ohne Schema scheitert die OIDC-Discovery.
    startLogin(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  };

  /** Meldet sich der Nutzer wieder bei einem fremden Server an? Dann zeigen
   *  wir ihn, statt stillschweigend den Standard-Server zu nehmen. */
  const returningToOther =
    lastIssuer !== null && lastIssuer !== DEFAULT_ISSUER;
  const primaryIssuer = returningToOther ? (lastIssuer as string) : DEFAULT_ISSUER;

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/80 backdrop-blur-sm p-4"
            onClick={redirecting ? undefined : onClose}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md bg-night-800 border border-white/10 rounded-3xl shadow-2xl shadow-black/50 max-h-[88%] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-5 sm:px-6 pt-5 pb-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                  {step === "advanced" && (
                    <button
                      onClick={() => setStep("intro")}
                      className="w-9 h-9 -ml-1 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                      aria-label="Zurück"
                    >
                      <ChevronLeft className="w-4 h-4 text-night-300" />
                    </button>
                  )}
                  <div>
                    <h2 className="text-base font-bold text-white">
                      {step === "advanced" ? "Anderes Konto verwenden" : "Anmelden"}
                    </h2>
                    <p className="text-xs text-night-300 mt-0.5">
                      {step === "advanced"
                        ? "Eigener Datenspeicher"
                        : "Zugang zu Ihren Lieferkettendaten"}
                    </p>
                  </div>
                </div>
                {!redirecting && (
                  <button
                    onClick={onClose}
                    className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                    aria-label="Schließen"
                  >
                    <X className="w-4 h-4 text-night-300" />
                  </button>
                )}
              </div>

              {/* Content */}
              <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto scroll-touch space-y-4">
                {step === "intro" ? (
                  <>
                    <p className="text-sm text-night-300 leading-relaxed">
                      Melden Sie sich mit Ihrem TimberConnect-Zugang an, um
                      Dokumente hochzuladen und geschützte Daten Ihrer Partner zu
                      sehen.
                    </p>

                    <button
                      onClick={() => startLogin(primaryIssuer)}
                      disabled={redirecting}
                      className="btn btn-acid w-full"
                    >
                      {redirecting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Weiterleitung...
                        </>
                      ) : (
                        <>
                          Anmelden
                          <ArrowRight className="w-5 h-5" />
                        </>
                      )}
                    </button>

                    {/* Erwartungsmanagement: Die naechste Seite sieht anders aus
                        als die App. Wer vorher weiss, dass das so gehoert und
                        warum, stutzt dort nicht. */}
                    <div className="flex gap-3 rounded-2xl border border-white/10 bg-night-700/40 px-4 py-3">
                      <ShieldCheck className="w-4 h-4 text-acid-300 flex-shrink-0 mt-0.5" />
                      <div className="space-y-1.5">
                        <p className="text-xs text-night-200 leading-relaxed">
                          Ihr Passwort geben Sie im nächsten Schritt direkt bei
                          Ihrem Datenspeicher ein — TimberConnect bekommt es nie
                          zu sehen.
                        </p>
                        <p className="text-[11px] text-night-400 leading-relaxed flex items-center gap-1.5">
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">
                            {hostOf(primaryIssuer)}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-4">
                      <button
                        onClick={() => setStep("advanced")}
                        disabled={redirecting}
                        className="w-full text-center text-sm text-night-300 hover:text-acid-300 font-medium transition-colors disabled:opacity-50"
                      >
                        Anderes Konto verwenden
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-night-300 leading-relaxed">
                      Wenn Sie Ihre Daten auf einem eigenen Server halten, geben
                      Sie hier dessen Adresse an.
                    </p>

                    <div className="space-y-2.5">
                      {ALTERNATIVE_ISSUERS.map((issuer) => (
                        <button
                          key={issuer.id}
                          onClick={() => startLogin(issuer.url)}
                          disabled={redirecting}
                          className="w-full px-4 py-3 rounded-2xl border border-white/10 bg-night-700/50 hover:border-acid-400/30 text-left transition-all disabled:opacity-50"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-white">
                                {issuer.name}
                              </div>
                              <div className="text-xs text-night-300 mt-0.5">
                                {issuer.description}
                              </div>
                            </div>
                            <ArrowRight className="w-5 h-5 text-night-400 flex-shrink-0" />
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="space-y-3 border-t border-white/5 pt-4">
                      <label
                        htmlFor="custom-issuer"
                        className="block text-sm font-medium text-white"
                      >
                        Adresse Ihres Servers
                      </label>
                      <input
                        id="custom-issuer"
                        type="text"
                        inputMode="url"
                        autoComplete="url"
                        value={customIssuer}
                        onChange={(e) => setCustomIssuer(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCustomLogin();
                        }}
                        placeholder="pod.mein-unternehmen.de"
                        className="w-full px-4 py-3 bg-night-900 border border-white/10 rounded-xl text-white placeholder:text-night-400 focus:outline-none focus:border-acid-400/60 focus:ring-4 focus:ring-acid-400/10 transition-all"
                      />
                      <button
                        onClick={handleCustomLogin}
                        disabled={!customIssuer.trim() || redirecting}
                        className="btn btn-acid w-full"
                      >
                        {redirecting ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Weiterleitung...
                          </>
                        ) : (
                          <>
                            Weiter
                            <ArrowRight className="w-5 h-5" />
                          </>
                        )}
                      </button>
                    </div>
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
