/**
 * Hardware-Scanner als Tastatureingabe erkennen.
 *
 * Die Zebra-Geraete (TC22R-Imager, TC22R-RFID, EM45-Kamerascan) geben ueber
 * DataWedge im Modus "Tastatur" die gelesene ID zeichenweise aus und schliessen
 * mit Enter ab. Fuer eine Web-App ist das der einzige gangbare Weg: einen
 * Android-Intent kann eine Seite im Browser nicht empfangen.
 *
 * Unterschieden wird ein Scan von getipptem Text allein an der Geschwindigkeit —
 * ein Scanner liefert die Zeichen praktisch ohne Pause, ein Mensch nicht.
 * Dadurch funktioniert die Erkennung global, ohne dass ein Eingabefeld den
 * Fokus haben muss. Das ist bei einem Pistolengriff-Geraet die Erwartung: der
 * Auslöser wirkt aus jeder Ansicht heraus.
 */

import { useEffect, useRef } from 'react';
import type { ScanSource } from '../services/identifiers';

/** Groesster Abstand zwischen zwei Zeichen, der noch als Scan gilt (ms). */
const DEFAULT_BURST_GAP_MS = 50;

/** Kuerzeste Zeichenfolge, die als Scan durchgeht. */
const DEFAULT_MIN_LENGTH = 6;

export interface HardwareScanOptions {
  enabled?: boolean;
  onScan: (raw: string, meta: { source: ScanSource; durationMs: number }) => void;
  burstGapMs?: number;
  minLength?: number;
}

type Listener = (raw: string, source: ScanSource) => void;

const listeners = new Set<Listener>();

/**
 * Einen Scan von aussen einspeisen — genutzt vom Test-Panel und, falls die App
 * spaeter in eine Android-Huelle wandert, von deren Bruecke.
 */
export function injectScan(raw: string, source: ScanSource = 'simulated'): void {
  listeners.forEach((fn) => fn(raw, source));
}

/**
 * Ob eine Zeichenfolge eher von einem RFID-Tag stammt (reine Hex-Ausgabe) als
 * von einem Barcode. Nur fuer die Quellenanzeige — die Deutung selbst macht
 * der Uebersetzer.
 */
function guessSource(value: string): ScanSource {
  const s = value.trim();
  if (s.length >= 16 && s.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(s) && /[A-Fa-f]/.test(s)) {
    return 'wedge-rfid';
  }
  return 'wedge-barcode';
}

export function useHardwareScan({
  enabled = true,
  onScan,
  burstGapMs = DEFAULT_BURST_GAP_MS,
  minLength = DEFAULT_MIN_LENGTH,
}: HardwareScanOptions): void {
  // Ueber ein Ref, damit ein Wechsel des Callbacks den Listener nicht neu bindet
  // und dabei einen laufenden Scan zerreisst.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyAt = 0;
    let startedAt = 0;

    const reset = () => {
      buffer = '';
      startedAt = 0;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Tastenkombinationen sind nie ein Scan.
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const now = event.timeStamp || performance.now();
      const gap = now - lastKeyAt;
      lastKeyAt = now;

      if (event.key === 'Enter') {
        const value = buffer;
        const duration = startedAt ? now - startedAt : 0;
        reset();

        if (value.length >= minLength) {
          // Enter gehoert zum Scan — nicht an ein Formular weiterreichen,
          // sonst wuerde nebenher ein Dialog abgeschickt.
          event.preventDefault();
          event.stopPropagation();
          const source = guessSource(value);
          onScanRef.current(value, { source, durationMs: duration });
        }
        return;
      }

      // Nur druckbare Zeichen und das GS-Trennzeichen sammeln.
      const isPrintable = event.key.length === 1;
      if (!isPrintable) return;

      if (gap > burstGapMs) {
        // Zu langsam fuer einen Scanner: als Anfang einer neuen Folge werten.
        buffer = event.key;
        startedAt = now;
        return;
      }

      buffer += event.key;
      if (!startedAt) startedAt = now;
    };

    // Capture-Phase: der Scan soll erkannt werden, bevor ein Feld ihn verarbeitet.
    document.addEventListener('keydown', handleKeyDown, true);

    const external: Listener = (raw, source) => {
      onScanRef.current(raw, { source, durationMs: 0 });
    };
    listeners.add(external);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      listeners.delete(external);
    };
  }, [enabled, burstGapMs, minLength]);
}
