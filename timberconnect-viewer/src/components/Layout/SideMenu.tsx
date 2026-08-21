import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Layers,
  ScanSearch,
  Handshake,
  FolderSearch,
  ChevronDown,
} from 'lucide-react';
import { BrandWordmark } from '../Brand/TreeRingLogo';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { USE_CASES, isAvailable } from '../../config/useCases';
import logoNrwMunv from '/logo-nrw-munv.png';
import logoEuKofinanziert from '/logo-eu-kofinanziert.png';

/**
 * Seitenfenstermenü (PDF-Vorgabe "Stand 1507", S. 2–3):
 * Drawer von links mit Navigation — Anwendungsfälle (aufklappbar),
 * Holzbauteil identifizieren, Praxispartner — plus Förderlogos unten.
 */

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onScanClick: () => void;
  onPartnersClick: () => void;
  onFilesClick: () => void;
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
                          <span className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                            <item.icon
                              className={`w-4 h-4 ${
                                item.openable ? 'text-acid-300' : 'text-night-400'
                              }`}
                            />
                          </span>
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
                    Bauteil scannen &amp; zuordnen
                  </span>
                </span>
              </button>

              {/* Praxispartner */}
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
            </nav>

            {/* Förderhinweis */}
            <div className="px-5 py-4 border-t border-white/5 flex-shrink-0">
              <div className="flex items-center justify-center gap-3">
                <div className="bg-white rounded-lg px-2 py-1">
                  <img
                    src={logoEuKofinanziert}
                    alt="Kofinanziert von der Europäischen Union"
                    className="h-7 w-auto object-contain"
                  />
                </div>
                <div className="w-px h-7 bg-white/15" />
                <div className="bg-white rounded-lg px-2 py-1">
                  <img
                    src={logoNrwMunv}
                    alt="Ministerium für Umwelt, Naturschutz und Verkehr des Landes Nordrhein-Westfalen"
                    className="h-7 w-auto object-contain"
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
