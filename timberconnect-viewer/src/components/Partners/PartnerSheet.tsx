import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink } from 'lucide-react';
import { partners, type Partner } from '../../data/partners';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import logoNrwMunv from '/logo-nrw-munv.png';
import logoEuKofinanziert from '/logo-eu-kofinanziert.png';

/**
 * "Praxispartner"-Sheet (PDF-Vorgabe "Stand 1507", S. 6):
 * Partnerliste mit Logo, Rollenbeschreibung und Verlinkung zur Website.
 * Mobil als Bottom-Sheet, auf Desktop als zentriertes Modal.
 */

interface PartnerSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Weiße Logo-Kachel.
 *
 * Die Kachel ist bewusst grosszuegig und quadratisch: die Partnerlogos sind
 * teils breit (EGGER, Wald und Holz NRW), teils hoch (Baues Wunder). Eine
 * flache Kachel schnitt die einen klein und liess die anderen verschwinden.
 * Weisser Grund, weil fast alle Logos dunkel auf transparent vorliegen und
 * auf dem Nachtblau sonst nicht lesbar waeren.
 *
 * Das Initialen-Monogramm bleibt als Rueckfall, falls eine Datei fehlt --
 * angezeigt werden soll aber ueberall das Logo (Rueckmeldung Anni).
 */
function PartnerLogo({ partner }: { partner: Partner }) {
  const [failed, setFailed] = useState(false);
  const initials = partner.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="w-24 h-16 rounded-xl bg-white flex items-center justify-center overflow-hidden flex-shrink-0 p-1.5">
      {failed ? (
        <span className="text-night-800 font-extrabold text-sm">{initials}</span>
      ) : (
        <img
          src={partner.logo}
          alt={`${partner.name} Logo`}
          className="max-w-full max-h-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export function PartnerSheet({ isOpen, onClose }: PartnerSheetProps) {
  useBodyScrollLock(isOpen);

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night-950/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="w-full sm:max-w-xl bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[92%] sm:max-h-[85%] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Griff (mobil) */}
            <div className="sm:hidden flex justify-center pt-3">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>

            {/* Kopf */}
            <div className="flex items-start justify-between px-5 sm:px-6 pt-4 pb-3">
              <div>
                <h2 className="text-xl font-bold text-white">Praxispartner</h2>
                <p className="text-sm text-night-300 mt-0.5">
                  Unsere Partner entlang der Lieferkette
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                aria-label="Schließen"
              >
                <X className="w-4 h-4 text-night-300" />
              </button>
            </div>

            {/* Partnerliste (scrollbar) */}
            <div className="px-5 sm:px-6 overflow-y-auto scroll-touch space-y-2.5 pb-4">
              {partners.map((partner) => (
                <a
                  key={partner.id}
                  href={partner.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 p-3.5 rounded-2xl bg-night-700/50 border border-white/5 hover:border-acid-400/40 hover:bg-night-700 transition-colors"
                >
                  <PartnerLogo partner={partner} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white text-sm truncate">
                      {partner.name}
                    </div>
                    <div className="text-xs text-night-300 truncate">
                      {partner.role}
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-night-400 group-hover:text-acid-300 transition-colors flex-shrink-0" />
                </a>
              ))}
            </div>

            {/* Förderhinweis */}
            <div className="px-5 sm:px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-white/5">
              <div className="flex items-center justify-center gap-3">
                <div className="bg-white rounded-lg px-3 py-2">
                  <img
                    src={logoEuKofinanziert}
                    alt="Kofinanziert von der Europäischen Union"
                    className="h-9 w-auto object-contain"
                  />
                </div>
                <div className="bg-white rounded-lg px-3 py-2">
                  <img
                    src={logoNrwMunv}
                    alt="Ministerium für Umwelt, Naturschutz und Verkehr des Landes Nordrhein-Westfalen"
                    className="h-12 w-auto object-contain"
                  />
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
