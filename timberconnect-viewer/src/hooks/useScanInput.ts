/**
 * Scans aus allen Quellen buendeln und deuten.
 *
 * Ein RFID-Sweep erfasst viele Tags auf einmal, die App kennt aber nur "eine
 * ID". Deshalb werden eingehende Scans kurz gesammelt:
 *
 *   ein Treffer   -> laeuft durch wie bisher, ohne zusaetzlichen Klick
 *   mehrere       -> Auswahlliste (MultiTagSheet)
 *
 * Bewusst kein gleichzeitiges Laden aller Treffer: jede Abfrage kostet
 * EPCAT- und Pod-Anfragen und laeuft durch die Token-Bezahlschranke. Der Sweep
 * ist eine Auswahlhilfe, kein Stapelabruf.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useHardwareScan } from './useHardwareScan';
import { parseScan } from '../services/identifiers';
import type { ParsedIdentifier, ScanSource } from '../services/identifiers';

/** Sammelfenster nach dem ersten Scan. */
const SESSION_MS = 700;

/** Obergrenze, damit ein Dauersweep das Fenster nicht endlos verlaengert. */
const SESSION_MAX_MS = 3000;

export interface ScanInputOptions {
  enabled?: boolean;
  /** Genau ein Treffer — der Normalfall beim Barcode-Scan. */
  onSingle: (parsed: ParsedIdentifier) => void;
  /** Mehrere Treffer — typisch fuer einen RFID-Sweep. */
  onMultiple: (parsed: ParsedIdentifier[]) => void;
}

export interface ScanInputApi {
  /** Scan von aussen einspeisen (Kamera, manuelle Eingabe, Test-Panel). */
  submit: (raw: string, source: ScanSource) => void;
  /** Laeuft gerade ein Sammelfenster? Fuer eine dezente Anzeige im UI. */
  collecting: boolean;
}

export function useScanInput({
  enabled = true,
  onSingle,
  onMultiple,
}: ScanInputOptions): ScanInputApi {
  const [collecting, setCollecting] = useState(false);

  const bufferRef = useRef<ParsedIdentifier[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const singleRef = useRef(onSingle);
  const multipleRef = useRef(onMultiple);
  useEffect(() => {
    singleRef.current = onSingle;
    multipleRef.current = onMultiple;
  }, [onSingle, onMultiple]);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (hardStopRef.current) clearTimeout(hardStopRef.current);
    timerRef.current = null;
    hardStopRef.current = null;

    const items = bufferRef.current;
    bufferRef.current = [];
    setCollecting(false);

    if (items.length === 0) return;
    if (items.length === 1) {
      singleRef.current(items[0]);
    } else {
      multipleRef.current(items);
    }
  }, []);

  const push = useCallback(
    (raw: string, source: ScanSource) => {
      const parsed = parseScan(raw, source);

      // Doppelte Lesungen desselben Tags verwerfen — ein UHF-Sweep meldet
      // denselben Tag oft mehrfach.
      const key = parsed.urn ?? parsed.candidates?.[0] ?? parsed.raw;
      const known = bufferRef.current.some(
        (p) => (p.urn ?? p.candidates?.[0] ?? p.raw) === key,
      );
      if (!known) bufferRef.current.push(parsed);

      setCollecting(true);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SESSION_MS);

      if (!hardStopRef.current) {
        hardStopRef.current = setTimeout(flush, SESSION_MAX_MS);
      }
    },
    [flush],
  );

  useHardwareScan({
    enabled,
    onScan: (raw, meta) => push(raw, meta.source),
  });

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (hardStopRef.current) clearTimeout(hardStopRef.current);
    },
    [],
  );

  const submit = useCallback(
    (raw: string, source: ScanSource) => {
      // Aus Kamera oder Eingabefeld kommt genau ein Wert — direkt weiterreichen,
      // ohne Sammelfenster.
      singleRef.current(parseScan(raw, source));
    },
    [],
  );

  return { submit, collecting };
}
