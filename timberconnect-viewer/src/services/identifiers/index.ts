/**
 * Scan-Erkennung — oeffentliche Schnittstelle.
 *
 * `parseScan` deutet den Rohwert (Form), `resolveScan` bestimmt daraus die
 * tatsaechliche Bauteil-ID (Inhalt). Die Trennung ist beim Testen am Geraet
 * entscheidend: sie macht sichtbar, ob ein Scan falsch gelesen wurde oder ob
 * er korrekt war und lediglich die Daten fehlen.
 */

export { parseScan, gtinSplitCandidates, isValidGtin, gtinCheckDigit } from './gs1';
export { parseEpcHex, looksLikeEpcHex } from './epcTds';
export { describeProblem } from './types';
export type { ParsedIdentifier, ScanSource, ScanKind, ScanProblem } from './types';

import { parseScan } from './gs1';
import type { ParsedIdentifier, ScanSource } from './types';

/** Pruefung, ob eine ID im Datenbestand existiert. */
export type ExistsCheck = (urn: string) => Promise<boolean>;

export interface ResolveResult {
  /** Die verwendbare ID, oder null wenn keine bestimmt werden konnte. */
  id: string | null;
  parsed: ParsedIdentifier;
  /** True, wenn die ID durch Abgleich mit den Daten gewaehlt wurde. */
  verified: boolean;
}

/**
 * Aus einem Rohwert die Bauteil-ID bestimmen.
 *
 * Ist die ID eindeutig (URN, Trace-ID, RFID-Tag), wird sie direkt genutzt.
 * Bei Barcodes bleibt die Aufteilung des GTIN mehrdeutig — dann entscheidet
 * `exists` anhand der tatsaechlichen Daten. Fehlt diese Pruefung oder passt
 * kein Kandidat, wird die wahrscheinlichste Lesart zurueckgegeben und
 * `verified` bleibt false; die Oberflaeche kann das kenntlich machen.
 */
export async function resolveScan(
  raw: string,
  source: ScanSource,
  exists?: ExistsCheck,
): Promise<ResolveResult> {
  const parsed = parseScan(raw, source);

  if (parsed.urn) {
    return { id: parsed.urn, parsed, verified: true };
  }

  const candidates = parsed.candidates ?? [];
  if (candidates.length === 0) {
    return { id: null, parsed, verified: false };
  }

  if (exists) {
    for (const candidate of candidates) {
      try {
        if (await exists(candidate)) {
          return { id: candidate, parsed: { ...parsed, urn: candidate }, verified: true };
        }
      } catch {
        // Netzfehler beim Pruefen eines Kandidaten darf die uebrigen nicht
        // blockieren — die Aufloesung laeuft weiter.
      }
    }
  }

  // Kein Treffer: wahrscheinlichste Lesart melden, aber als ungesichert.
  return {
    id: candidates[0],
    parsed: { ...parsed, problem: parsed.problem ?? 'ambiguous-gtin' },
    verified: false,
  };
}
