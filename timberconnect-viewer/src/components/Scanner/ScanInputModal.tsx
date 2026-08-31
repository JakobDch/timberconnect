import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine,
  Search,
  X,
  Loader2,
  AlertCircle,
  Zap,
  PencilLine,
} from 'lucide-react';
import { parseScan, describeProblem } from '../../services/identifiers';
import type { ScanSource } from '../../services/identifiers';
import { ScanSourceBadge } from './ScanSourceBadge';

/**
 * Bauteil erfassen — Eingabe, Suche und Ergebnis an einer Stelle.
 *
 * Zwei Betriebsarten:
 *
 *   sofort  (Standard) Ein Scan loest die Suche unmittelbar aus. Das Geraet
 *           tippt die ID als Tastatureingabe; ein zusaetzlicher Enter-Druck
 *           waere ein ueberfluessiger Handgriff, wenn ohnehin gescannt wird.
 *   pruefen Der Scan landet im Feld und wird erst auf Knopfdruck gesucht —
 *           fuer manuelle Eingabe oder wenn man die ID vorher sehen will.
 *
 * Ladezustand und Fehler werden hier im Dialog gezeigt. Vorher stand die
 * Fehlermeldung dahinter im Hintergrund und war erst nach dem Schliessen zu
 * sehen — der Scan wirkte dadurch folgenlos.
 */

export type ScanMode = 'instant' | 'review';

const MODE_KEY = 'tc-scan-mode';

/** Zeichenabstand, unterhalb dessen von einem Geraet ausgegangen wird. */
const BURST_GAP_MS = 50;
/** Kuerzeste Folge, die als Scan gilt. */
const MIN_SCAN_LENGTH = 6;
/** Ruhe nach dem letzten Zeichen, nach der ohne Enter abgeschickt wird. */
const SETTLE_MS = 120;

export function loadScanMode(): ScanMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'review' ? 'review' : 'instant';
  } catch {
    return 'instant';
  }
}

function saveScanMode(mode: ScanMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* Speichern ist optional. */
  }
}

interface ScanInputModalProps {
  isOpen: boolean;
  isLoading?: boolean;
  /** Fehlermeldung der letzten Suche — wird hier im Dialog angezeigt. */
  error?: string | null;
  onClose: () => void;
  onSubmit: (value: string, source: ScanSource) => void;
}

export function ScanInputModal({
  isOpen,
  isLoading = false,
  error = null,
  onClose,
  onSubmit,
}: ScanInputModalProps) {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<ScanMode>(loadScanMode);
  const [justScanned, setJustScanned] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Burst-Erkennung: unterscheidet Geraeteeingabe von getipptem Text.
  const lastKeyRef = useRef(0);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Der verzoegerte Ausloeser laeuft ausserhalb des Renders — er darf nicht auf
  // eingefrorene Werte zugreifen, sonst sucht er im falschen Modus oder
  // waehrend bereits eine Suche laeuft.
  const modeRef = useRef(mode);
  const loadingRef = useRef(isLoading);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    loadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    if (!isOpen) return;
    setValue('');
    setJustScanned(false);
    lastKeyRef.current = 0;
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Nach einer fehlgeschlagenen Suche zurueck ins Feld, damit sofort der
  // naechste Scan moeglich ist.
  useEffect(() => {
    if (error && !isLoading && isOpen) inputRef.current?.focus();
  }, [error, isLoading, isOpen]);

  useEffect(
    () => () => {
      if (settleRef.current) clearTimeout(settleRef.current);
    },
    [],
  );

  const submit = (raw: string, source: ScanSource) => {
    const id = raw.trim();
    if (id && !loadingRef.current) onSubmit(id, source);
  };

  const preview = useMemo(() => {
    const raw = value.trim();
    if (!raw) return null;
    const parsed = parseScan(raw, 'manual');
    return {
      id: parsed.urn ?? parsed.candidates?.[0] ?? null,
      hint: describeProblem(parsed),
    };
  }, [value]);

  /**
   * Enter abfangen: das Geraet schliesst den Scan damit ab.
   *
   * Die Scan-Erkennung selbst haengt bewusst NICHT an keydown. DataWedge fuegt
   * den Text je nach Konfiguration als Block ein; die Tastenereignisse tragen
   * dann `Unidentified` als key und liefern keine brauchbaren Zeichen. Deshalb
   * wird unten in handleChange die tatsaechliche Wertaenderung ausgewertet.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;

    if (settleRef.current) {
      clearTimeout(settleRef.current);
      settleRef.current = null;
    }
    const fast = performance.now() - lastKeyRef.current < 1500;
    e.preventDefault();
    submit(e.currentTarget.value, fast ? 'wedge-barcode' : 'manual');
  };

  /**
   * Wertaenderungen auswerten — das ist der verlaessliche Weg.
   *
   * Ein Scan zeigt sich daran, dass in einem Zug viele Zeichen dazukommen
   * (Blockeinfuegung) oder sehr schnell hintereinander (Zeichenweise). Tippen
   * erzeugt einzelne Zeichen mit menschlichen Pausen und loest deshalb nicht aus.
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    const added = next.length - value.length;
    const now = performance.now();
    const gap = now - lastKeyRef.current;
    lastKeyRef.current = now;

    setValue(next);
    setJustScanned(false);

    if (settleRef.current) {
      clearTimeout(settleRef.current);
      settleRef.current = null;
    }

    if (modeRef.current !== 'instant') return;

    // Blockeinfuegung oder schnelle Folge = Geraet. Einzelne Zeichen mit
    // Tipp-Pause zaehlen nicht.
    const looksScanned = added > 1 || gap < BURST_GAP_MS;
    if (!looksScanned || next.trim().length < MIN_SCAN_LENGTH) return;

    settleRef.current = setTimeout(() => {
      const current = inputRef.current?.value ?? '';
      if (current.trim().length < MIN_SCAN_LENGTH) return;
      setJustScanned(true);
      submit(current, 'wedge-barcode');
    }, SETTLE_MS);
  };

  const switchMode = (next: ScanMode) => {
    setMode(next);
    saveScanMode(next);
    inputRef.current?.focus();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/80 backdrop-blur-sm p-4"
          onClick={isLoading ? undefined : onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md bg-night-800 border border-white/10 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kopf */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center">
                  <ScanLine className="w-5 h-5 text-acid-300" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Produkt erfassen</h2>
                  <p className="text-xs text-night-300 mt-0.5">
                    Scannen oder ID eingeben
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                disabled={isLoading}
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors disabled:opacity-40"
                aria-label="Schließen"
              >
                <X className="w-4 h-4 text-night-300" />
              </button>
            </div>

            {/* Betriebsart */}
            <div
              role="radiogroup"
              aria-label="Betriebsart"
              className="grid grid-cols-2 gap-2 p-1 bg-night-900 border border-white/5 rounded-xl mb-5"
            >
              {(
                [
                  { key: 'instant', label: 'Sofort suchen', Icon: Zap },
                  { key: 'review', label: 'Vorher prüfen', Icon: PencilLine },
                ] as const
              ).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  role="radio"
                  aria-checked={mode === key}
                  onClick={() => switchMode(key)}
                  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                    mode === key
                      ? 'bg-acid-400 text-night-950'
                      : 'text-night-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Ladezustand — ersetzt Feld und Aktionen, damit klar ist,
                dass gerade gesucht wird */}
            {isLoading ? (
              <div className="py-10 flex flex-col items-center justify-center text-center">
                <div className="relative w-20 h-20 flex items-center justify-center mb-4">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="absolute rounded-full border border-acid-400"
                      style={{ inset: `${i * 10}px` }}
                      animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0.15, 0.5] }}
                      transition={{
                        duration: 1.3,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
                  <Loader2 className="w-7 h-7 text-acid-300 animate-spin" />
                </div>
                <p className="text-sm font-semibold text-white">Bauteil wird gesucht …</p>
                {value.trim() && (
                  <p className="text-[11px] font-mono text-night-400 mt-1.5 break-all px-2">
                    {value.trim()}
                  </p>
                )}
              </div>
            ) : (
              <>
                <label
                  htmlFor="scan-product-id"
                  className="block text-[11px] font-semibold tracking-[0.12em] text-night-300 uppercase mb-2"
                >
                  Produkt-ID
                </label>
                <div className="relative">
                  <input
                    ref={inputRef}
                    id="scan-product-id"
                    type="text"
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      mode === 'instant'
                        ? 'Scan-Taste drücken …'
                        : 'urn:epc:id:sgtin:404711145.0100.12A3D4567'
                    }
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="w-full px-4 py-3.5 rounded-xl bg-night-900 border border-white/10 text-white font-mono text-sm placeholder:text-night-400 focus:outline-none focus:border-acid-400/60 focus:ring-4 focus:ring-acid-400/10 transition-all"
                  />
                  {mode === 'instant' && !value && (
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-acid-400 opacity-60" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-acid-400" />
                    </span>
                  )}
                </div>

                {/* Fehler der letzten Suche — direkt hier, nicht dahinter */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2.5 mt-3 px-3.5 py-3 bg-red-500/10 border border-red-500/30 rounded-xl"
                  >
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300 leading-relaxed">{error}</p>
                  </motion.div>
                )}

                {/* Erkannte ID */}
                {!error && preview && (
                  <div className="mt-3 px-3.5 py-2.5 rounded-xl bg-night-900/70 border border-white/5">
                    <div className="flex items-center gap-2 mb-1">
                      <ScanSourceBadge source={justScanned ? 'wedge-barcode' : 'manual'} />
                    </div>
                    {preview.id ? (
                      <p className="text-[11px] font-mono text-acid-300 break-all">
                        → {preview.id}
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-300/90">
                        {preview.hint ?? 'Nicht erkannt'}
                      </p>
                    )}
                  </div>
                )}

                {!error && !preview && (
                  <p className="text-xs text-night-400 mt-2.5 leading-relaxed">
                    {mode === 'instant'
                      ? 'Gescannte Codes werden sofort gesucht — RFID, DotCode und Barcode.'
                      : 'EPC-URN, GS1-Elementstring, Digital-Link-URL oder Trace-ID.'}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => submit(value, 'manual')}
                  disabled={!value.trim()}
                  className="btn btn-acid w-full mt-5"
                >
                  <Search className="w-5 h-5" />
                  <span>Bauteil suchen</span>
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
