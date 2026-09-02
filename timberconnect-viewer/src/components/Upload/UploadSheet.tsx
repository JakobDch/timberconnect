import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { ProcessUploadPanel } from '../Process';
import { LoginModal } from '../Auth/LoginModal';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';

/**
 * "Vorgang registrieren" Bottom-Sheet (Startseite).
 *
 * Der Upload ist vorgangsbasiert: nicht einzelne Dateien werden hochgeladen,
 * sondern ein Lebensabschnitt des Produkts wird registriert, zu dem alle
 * zugehoerigen Dateien gemeinsam gehoeren (ProcessUploadPanel).
 */

interface UploadSheetProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading?: boolean;
}

export function UploadSheet({
  isOpen,
  onClose,
  isLoading = false,
}: UploadSheetProps) {
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  useBodyScrollLock(isOpen);

  return (
    <>
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
              <div className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3">
                <h2 className="text-xl font-bold text-white">Vorgang registrieren</h2>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              {/* Inhalt (scrollbar) */}
              <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto scroll-touch">
                <ProcessUploadPanel
                  isLoading={isLoading}
                  onLoginClick={() => setLoginModalOpen(true)}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </SheetPortal>

      {/* Solid-Login aus dem Upload-Kontext */}
      <LoginModal
        isOpen={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
      />
    </>
  );
}
