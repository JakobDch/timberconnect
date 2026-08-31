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
 *
 * Seit 26.08.2026 gibt es nur noch diesen einen Weg: Die Server-Auswahl hinter
 * "Anderes Konto verwenden" (freie Server-Adresse, solidcommunity.net) ist
 * entfallen. Alle Konten des Demonstrators liegen auf DEFAULT_ISSUER; die
 * Eingabe einer fremden Server-Adresse fuehrte in der Praxis nur zu
 * fehlgeschlagener OIDC-Discovery. Wer wiederkehrend einen anderen Server
 * genutzt hat, wird ueber getLastIssuer() weiterhin dorthin geleitet.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ArrowRight,
  ShieldCheck,
  ExternalLink,
  Loader2,
  UserPlus,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { getLastIssuer, getRegistrationUrl } from "../../auth/solidSession";
import { SheetPortal, useBodyScrollLock } from "../UI/SheetPortal";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Der Server, auf dem die Konten der Demonstrator-Partner liegen. */
const DEFAULT_ISSUER = "https://solid-community-server.tmdt.info";

/**
 * Oeffnet die Konto-Anlage des Solid-Servers ("Create account").
 *
 * Bewusst in einem NEUEN Tab: Die Registrierung ist kein OIDC-Redirect, es
 * kommt also niemand automatisch zurueck. Bliebe die App im selben Tab
 * zurueck, muesste der Nutzer nach dem Anlegen seines Kontos selbst
 * hierherfinden. So liegt TimberConnect weiterhin daneben und er wechselt
 * danach nur den Tab und klickt "Anmelden".
 *
 * Der Zielserver folgt derselben Regel wie der Login: wer zuletzt bei einem
 * anderen Server war, soll sein Konto auch dort anlegen.
 */
export function openRegistration(): void {
  const issuer = getLastIssuer() ?? DEFAULT_ISSUER;
  window.open(getRegistrationUrl(issuer), "_blank", "noopener,noreferrer");
}

/** Anzeigename eines Servers ohne Protokoll-Rauschen. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { login } = useAuth();
  /** Zwischen Klick und Browser-Redirect vergeht ein Moment -- den zeigen wir. */
  const [redirecting, setRedirecting] = useState(false);

  const lastIssuer = getLastIssuer();

  useBodyScrollLock(isOpen);

  // Beim Schliessen zuruecksetzen, damit das Sheet nie im Redirect-Zustand
  // wieder aufgeht.
  useEffect(() => {
    if (isOpen) return;
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
                  <div>
                    <h2 className="text-base font-bold text-white">Anmelden</h2>
                    <p className="text-xs text-night-300 mt-0.5">
                      Zugang zu Ihren Lieferkettendaten
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

                {/* Auch hier ein Weg zur Registrierung: Wer keinen Zugang hat,
                    merkt das oft erst, wenn er schon in der Anmeldung steht. */}
                {!redirecting && (
                  <button
                    onClick={openRegistration}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border border-white/15 text-night-200 hover:bg-white/5 hover:text-white text-sm font-semibold transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    Noch kein Zugang? Registrieren
                  </button>
                )}

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
                      <span className="truncate">{hostOf(primaryIssuer)}</span>
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
