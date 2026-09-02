import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Layers,
  ScanSearch,
  Handshake,
  FolderSearch,
  ChevronDown,
  RotateCcw,
  Info,
  ExternalLink,
} from 'lucide-react';
import { BrandWordmark } from '../Brand/TreeRingLogo';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { UseCaseIcon } from '../UseCases';
import { USE_CASES, isAvailable } from '../../config/useCases';
import logoNrwMunv from '/logo-nrw-munv.png';
import logoEuKofinanziert from '/logo-eu-kofinanziert.png';

/**
 * Seitenfenstermenü (PDF-Vorgabe "Stand 1507", S. 2–3):
 * Drawer von links mit Navigation — Anwendungsfälle (aufklappbar),
 * Holzbauteil identifizieren, Dateien durchsuchen, Mehr erfahren,
 * Praxispartner — plus Förderlogos unten.
 *
 * Reihenfolge nach Vorgabe Anni (26.08.2026): Praxispartner steht als
 * letzter Punkt, davor "Mehr erfahren" mit dem Link zum Forschungsprojekt.
 */

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onScanClick: () => void;
  onPartnersClick: () => void;
  onFilesClick: () => void;
  /** Oeffnet das Zuruecksetzen der eigenen Uploads. Nur bei Anmeldung sichtbar. */
  onResetClick: () => void;
  /** Steuert die Sichtbarkeit des Zuruecksetzens: ohne Session gibt es keinen
      eigenen Pod, auf den es sich beziehen koennte. */
  isLoggedIn: boolean;
  /** Waehlt einen Anwendungsfall. Fehlt noch ein Produkt, fuehrt App.tsx
      zuerst zum Scan und springt danach automatisch hierhin. */
  onUseCaseClick: (useCaseId: string) => void;
}

export function SideMenu({
  isOpen,
  onClose,
  onScanClick,
  onPartnersClick,
  onFilesClick,
  onResetClick,
  isLoggedIn,
  onUseCaseClick,
}: SideMenuProps) {
  const [useCasesOpen, setUseCasesOpen] = useState(false);

  useBodyScrollLock(isOpen);

  const navigate = (action: () => void) => {
    onClose();
    action();
  };

  // Liste kommt aus der zentralen Registry -- kein eigener Bestand mehr, der
  // gegenueber Startseite und Raster veralten koennte.
  //
  // Jeder fertige Anwendungsfall ist waehlbar, auch ohne gescanntes Produkt:
  // App.tsx merkt sich die Auswahl und fuehrt bei Bedarf erst zum Scan.
  const subItems = USE_CASES.map((useCase) => ({
    ...useCase,
    openable: isAvailable(useCase),
  }));

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-night-950/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="h-full w-[85%] max-w-sm bg-night-950 border-r border-white/10 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kopf: Logo + Schließen */}
            <div className="flex items-center justify-between px-5 h-16 border-b border-white/5 flex-shrink-0">
              <BrandWordmark />
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                aria-label="Menü schließen"
              >
                <X className="w-4 h-4 text-night-300" />
              </button>
            </div>

            {/* Navigation (scrollbar) */}
            <nav className="flex-1 overflow-y-auto scroll-touch px-4 py-5">
              <div className="px-2 mb-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-night-400">
                Navigation
              </div>

              {/* Anwendungsfälle (aufklappbar) */}
              <button
                onClick={() => setUseCasesOpen((v) => !v)}
                className="w-full flex items-center gap-3.5 px-2 py-2.5 rounded-xl hover:bg-white/5 transition-colors text-left"
                aria-expanded={useCasesOpen}
              >
                <span className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <Layers className="w-5 h-5 text-night-200" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-white text-sm">
                    Anwendungsfälle
                  </span>
                  <span className="block text-xs text-night-400">
                    Module &amp; Funktionen
                  </span>
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-night-400 transition-transform ${
                    useCasesOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <AnimatePresence initial={false}>
                {useCasesOpen && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden pl-6 pr-1"
                  >
                    {subItems.map((item) => (
                      <li key={item.id}>
                        <button
                          onClick={
                            item.openable
                              ? () => navigate(() => onUseCaseClick(item.id))
                              : undefined
                          }
                          disabled={!item.openable}
                          className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors ${
                            item.openable
                              ? 'hover:bg-white/5 text-night-100'
                              : 'text-night-400 cursor-default'
                          }`}
                        >
                          <UseCaseIcon
                            useCase={item}
                            size="sm"
                            muted={!item.openable}
                          />
                          <span className="flex-1 text-sm leading-snug">
                            {item.title}
                          </span>
                          {!item.openable && (
                            <span className="px-2 py-0.5 rounded-full bg-white/5 text-night-400 text-[10px] font-medium flex-shrink-0">
                              Demnächst
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>

              {/* Holzbauteil identifizieren */}
              <button
                onClick={() => navigate(onScanClick)}
                className="w-full flex items-center gap-3.5 px-2 py-2.5 mt-1 rounded-xl hover:bg-white/5 transition-colors text-left"
              >
                <span className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <ScanSearch className="w-5 h-5 text-night-200" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-white text-sm">
                    Holzbauteil identifizieren
                  </span>
                  <span className="block text-xs text-night-400">
                    Produkt scannen und zuordnen
                  </span>
                </span>
              </button>

              {/* Dateien durchsuchen (von der Startseite hierher verlagert) */}
              <button
                onClick={() => navigate(onFilesClick)}
                className="w-full flex items-center gap-3.5 px-2 py-2.5 mt-1 rounded-xl hover:bg-white/5 transition-colors text-left"
              >
                <span className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <FolderSearch className="w-5 h-5 text-night-200" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-white text-sm">
                    Dateien durchsuchen
                  </span>
                  <span className="block text-xs text-night-400">
                    Originaldateien &amp; Berechtigungen
                  </span>
                </span>
              </button>

              {/* Mehr erfahren — von der Startseite hierher verlagert
                  (Vorgabe Anni, 26.08.2026). Fuehrt auf die Projektseite des
                  Lehrstuhls DPBB (Uni Wuppertal) und damit aus der Anwendung
                  heraus; deshalb steht es im Menue und nicht mehr neben den
                  beiden Haupthandlungen der Startseite. Als <a> statt
                  <button>, damit Aufziehen in neuem Tab moeglich bleibt. */}
              <a
                href="https://dpbb.uni-wuppertal.de/en/research/current-research-projects/timberconnect/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="w-full flex items-center gap-3.5 px-2 py-2.5 mt-1 rounded-xl hover:bg-white/5 transition-colors text-left"
              >
                <span className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <Info className="w-5 h-5 text-night-200" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-white text-sm">
                    Mehr erfahren
                  </span>
                  <span className="block text-xs text-night-400">
                    Informationen zum Forschungsprojekt
                  </span>
                </span>
                <ExternalLink className="w-4 h-4 text-night-400 flex-shrink-0" />
              </a>

              {/* Praxispartner — letzter Navigationspunkt (Vorgabe Anni) */}
              <button
                onClick={() => navigate(onPartnersClick)}
                className="w-full flex items-center gap-3.5 px-2 py-2.5 mt-1 rounded-xl hover:bg-white/5 transition-colors text-left"
              >
                <span className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <Handshake className="w-5 h-5 text-night-200" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-white text-sm">
                    Praxispartner
                  </span>
                  <span className="block text-xs text-night-400">
                    Netzwerk &amp; Kooperationen
                  </span>
                </span>
              </button>

              {/* Uploads zuruecksetzen — nur mit Session, denn zurueckgesetzt
                  wird ausschliesslich der eigene Pod. Abgesetzt und in
                  Warnfarbe, damit es sich nicht wie normale Navigation anfuehlt. */}
              {isLoggedIn && (
                <>
                  <div className="mt-5 mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-night-400">
                    Verwaltung
                  </div>
                  <button
                    onClick={() => navigate(onResetClick)}
                    className="w-full flex items-center gap-3.5 px-2 py-2.5 rounded-xl hover:bg-red-500/10 transition-colors text-left group"
                  >
                    <span className="w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-center flex-shrink-0">
                      <RotateCcw className="w-5 h-5 text-red-400" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-white text-sm">
                        Vorgänge löschen
                      </span>
                      <span className="block text-xs text-night-400">
                        Einzeln wählbar oder alle
                      </span>
                    </span>
                  </button>
                </>
              )}
            </nav>

            {/* Förderhinweis — lesbare Groesse, siehe Kommentar im Footer */}
            <div className="px-5 py-4 border-t border-white/5 flex-shrink-0">
              <div className="flex items-center justify-center gap-3">
                <div className="bg-white rounded-lg px-3 py-2">
                  <img
                    src={logoEuKofinanziert}
                    alt="Kofinanziert von der Europäischen Union"
                    className="h-8 w-auto object-contain"
                  />
                </div>
                <div className="bg-white rounded-lg px-3 py-2">
                  <img
                    src={logoNrwMunv}
                    alt="Ministerium für Umwelt, Naturschutz und Verkehr des Landes Nordrhein-Westfalen"
                    className="h-11 w-auto object-contain"
                  />
                </div>
              </div>
            </div>
          </motion.aside>
        </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
