import { motion, AnimatePresence } from 'framer-motion';
import { Nfc, X } from 'lucide-react';
import type { UseCaseDefinition } from '../../config/useCases';
import { UseCaseIcon } from './UseCaseIcon';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';

/**
 * Infoblock zu einem Anwendungsfall (Vorgabe Anni, 26.08.2026).
 *
 * Ein Klick auf eine Kachel der Startseite fuehrt NICHT mehr direkt zum
 * Scanner, sondern zeigt zuerst, worum es in diesem Anwendungsfall geht.
 * Erst der Knopf "Jetzt Produkt scannen" startet die Erfassung.
 *
 * Der Umweg ist Absicht: Auf der Startseite steht der Besucher noch vor der
 * Frage, WAS die Anwendung ihm liefert. Der Sprung in den Scanner beantwortet
 * sie nicht, er setzt sie voraus. Deshalb traegt die Kachel selbst auch keinen
 * Untertitel mehr -- der ganze Text steht hier.
 *
 * Nur fuer die Startseite gedacht. Nach dem Scan waehlt man den Fall im
 * Anwendungsfall-Raster, und dort ist die Frage "was ist das?" bereits
 * beantwortet -- ein zweiter Zwischenschritt waere dort nur eine Huerde.
 */

interface UseCaseInfoSheetProps {
  /** Der anzuzeigende Fall; null schliesst das Sheet. */
  useCase: UseCaseDefinition | null;
  onClose: () => void;
  /** Startet die Erfassung fuer genau diesen Anwendungsfall. */
  onScan: (useCaseId: string) => void;
}

export function UseCaseInfoSheet({
  useCase,
  onClose,
  onScan,
}: UseCaseInfoSheetProps) {
  useBodyScrollLock(useCase !== null);

  return (
    <SheetPortal>
      <AnimatePresence>
        {useCase && (
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
              className="w-full sm:max-w-lg bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 flex flex-col"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="usecase-info-title"
            >
              {/* Griff (mobil) */}
              <div className="sm:hidden flex justify-center pt-3">
                <div className="w-10 h-1 rounded-full bg-white/15" />
              </div>

              <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-2">
                <div className="flex items-center gap-3 min-w-0">
                  <UseCaseIcon useCase={useCase} size="md" />
                  <h2
                    id="usecase-info-title"
                    className="text-lg sm:text-xl font-bold text-white leading-snug"
                  >
                    {useCase.title}
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              <div className="px-5 sm:px-6 pt-2 pb-4">
                <p className="text-sm sm:text-base text-night-200 leading-relaxed">
                  {useCase.longDescription}
                </p>
              </div>

              <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                <button
                  onClick={() => onScan(useCase.id)}
                  className="btn btn-acid btn-lg w-full"
                >
                  <Nfc className="w-5 h-5" />
                  <span>Jetzt Produkt scannen</span>
                </button>
                {/* Jeder Anwendungsfall trifft eine Aussage ueber ein
                    bestimmtes Bauteil -- ohne erfasstes Produkt gibt es
                    nichts anzuzeigen. Das gehoert hier gesagt, damit der
                    Scan nicht als willkuerliche Huerde erscheint. */}
                <p className="text-xs text-night-400 text-center mt-3 leading-relaxed">
                  Der Anwendungsfall bezieht sich immer auf ein bestimmtes
                  Bauteil.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
