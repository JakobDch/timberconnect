import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, ArrowLeft, Check, MapPin, Scale } from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';

/**
 * Ausgebrachte Saatgutmenge — der Schritt direkt nach der Pflanzflaeche.
 *
 * Warum eigenstaendig und nicht im PDF: Das Stammzertifikat nennt unter Punkt
 * 12 die Menge der ZERTIFIZIERTEN PARTIE (tc:amount, kg). Das ist eine Aussage
 * ueber das Saatgut im Sack, nicht darueber, wie viel davon auf dieser einen
 * Flaeche gelandet ist. Beides zu vermischen waere fachlich falsch: eine Partie
 * wird in aller Regel auf mehrere Flaechen verteilt.
 *
 * Die hier erhobene Menge gehoert zur gezeichneten Flaeche und wird deshalb
 * zusammen mit ihr erhoben. Sie ist die Mengenangabe zur LGTIN des Saatguts
 * und wird als ``quantity``/``uom`` (GRM) in die ``quantityList`` des
 * ObjectEvents uebernommen — genau der Platz, den EPCIS fuer klassenbezogene
 * Idente vorsieht.
 *
 * Gramm statt Kilogramm, weil Forstsaatgut in dieser Groessenordnung
 * ausgebracht wird; ein Feld, in dem ueblicherweise "0,04" steht, laedt zu
 * Kommafehlern ein.
 */

interface SeedQuantitySheetProps {
  isOpen: boolean;
  /** Name der Datei, zu der die Menge gehoert. */
  fileName: string | null;
  /** Groesse der zuvor gezeichneten Flaeche — Bezugsgroesse der Eingabe. */
  hectares: number | null;
  onConfirm: (grams: number) => void;
  /** Zurueck zur Karte, ohne dass irgendetwas hochgeladen wird. */
  onBack: () => void;
}

/** Zustand pro Datei; der Wechsel remountet statt zurueckzusetzen. */
export function SeedQuantitySheet({ fileName, ...props }: SeedQuantitySheetProps) {
  return <SeedQuantitySheetContent key={fileName ?? ''} fileName={fileName} {...props} />;
}

function SeedQuantitySheetContent({
  isOpen,
  fileName,
  hectares,
  onConfirm,
  onBack,
}: SeedQuantitySheetProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(isOpen);

  // Deutsche Eingabe: das Komma ist hier das uebliche Dezimaltrennzeichen.
  const grams = Number(value.replace(',', '.'));
  const isValid = value.trim() !== '' && Number.isFinite(grams) && grams > 0;

  // Ausbringungsmenge je Hektar — die Zahl, an der ein Forstwirt einen
  // Zahlendreher sofort erkennt.
  const perHectare = isValid && hectares && hectares > 0 ? grams / hectares : null;

  const handleConfirm = () => {
    if (!isValid) {
      setError('Bitte geben Sie die ausgebrachte Menge in Gramm an.');
      return;
    }
    onConfirm(grams);
  };

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-night-950/70 backdrop-blur-sm flex items-stretch justify-center"
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full h-full sm:h-auto sm:my-auto sm:max-w-lg bg-night-800 sm:border border-white/10 sm:rounded-3xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
            >
              <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
                    <Scale className="w-5 h-5 text-acid-300" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-white">Ausgebrachte Saatgutmenge</h2>
                    {fileName && (
                      <p className="text-xs text-night-400 truncate mt-0.5">{fileName}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-5 sm:px-6 py-5 space-y-4">
                {hectares !== null && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-night-700/50 border border-white/10">
                    <MapPin className="w-4 h-4 text-acid-300 flex-shrink-0" />
                    <span className="text-xs text-night-200">
                      Eingezeichnete Fläche:{' '}
                      <span className="font-semibold text-acid-300">
                        {hectares.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ha
                      </span>
                    </span>
                  </div>
                )}

                <p className="text-sm text-night-300 leading-relaxed">
                  Wie viel Saatgut wurde auf dieser Fläche ausgebracht? Die
                  Angabe bezieht sich auf die eingezeichnete Fläche — nicht auf
                  die Gesamtmenge der Partie, die im Stammzertifikat steht.
                </p>

                <div>
                  <label
                    htmlFor="seed-grams"
                    className="block text-xs font-semibold text-night-300 mb-1.5"
                  >
                    Menge in Gramm
                  </label>
                  <div className="relative">
                    <input
                      id="seed-grams"
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      value={value}
                      onChange={(e) => {
                        setValue(e.target.value);
                        if (error) setError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirm();
                      }}
                      placeholder="z. B. 250"
                      className={`w-full px-4 py-3 pr-12 bg-night-900 border rounded-xl text-white text-sm placeholder:text-night-400 focus:outline-none focus:ring-4 focus:ring-acid-400/10 ${
                        error ? 'border-red-400/60' : 'border-white/10 focus:border-acid-400/60'
                      }`}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-night-400 pointer-events-none">
                      g
                    </span>
                  </div>
                  {perHectare !== null && (
                    <p className="text-xs text-night-400 mt-1.5">
                      entspricht{' '}
                      {perHectare.toLocaleString('de-DE', { maximumFractionDigits: 1 })} g
                      je Hektar
                    </p>
                  )}
                </div>

                {error && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs">{error}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 px-5 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-2">
                <button
                  onClick={onBack}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-night-700/60 hover:bg-night-700 text-night-200 text-sm font-semibold transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Zurück
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!isValid}
                  className="btn btn-acid flex-1"
                >
                  <Check className="w-4 h-4" />
                  <span>Übernehmen</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
