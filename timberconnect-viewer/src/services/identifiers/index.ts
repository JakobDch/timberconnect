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

import { parseScan, splitAtPrefix } from './gs1';
import { getKnownCompanyPrefixes, matchPrefix } from '../companyPrefixService';
import type { ParsedIdentifier, ScanSource } from './types';

/** Pruefung, ob eine ID im Datenbestand existiert. */
export type ExistsCheck = (urn: string) => Promise<boolean>;

/**
 * Woher die Entscheidung ueber die Praefixgrenze stammt.
 *
 * Der Unterschied ist beim Testen am Geraet der wichtigste Hinweis ueberhaupt:
 * `registry` heisst "der Teilnehmer fuehrt diesen Praefix nachweislich",
 * `guessed` heisst "niemand im Datenraum fuehrt ihn, das ist die
 * wahrscheinlichste Lesart". Nur Letzteres darf die Oberflaeche kennzeichnen.
 */
export type ResolveOrigin = 'direct' | 'registry' | 'data' | 'guessed';

export interface ResolveResult {
  /** Die verwendbare ID, oder null wenn keine bestimmt werden konnte. */
  id: string | null;
  parsed: ParsedIdentifier;
  /** True, wenn die ID belegt ist statt geraten. */
  verified: boolean;
  /** Wie die ID zustande kam — fuer Anzeige und Fehlersuche. */
  origin: ResolveOrigin;
}

/**
 * Aus einem Rohwert die Bauteil-ID bestimmen.
 *
 * Die Reihenfolge ist die Kernaussage dieser Funktion:
 *
 *   1. **direct** — URN, Trace-ID oder RFID-Tag. Nichts zu entscheiden: beim
 *      RFID-Tag liefert das Partition-Feld die Praefixgrenze bitgenau mit.
 *   2. **registry** — der Firmenpraefix ist im Datenraum gefuehrt. Ein
 *      Teilnehmer hat ihn in seinem eigenen Pod hinterlegt, die Federation
 *      Registry kennt den Pod. Deterministisch, ohne Raten, ohne Netzlast
 *      pro Kandidat.
 *   3. **data** — kein bekannter Praefix, aber ein Kandidat existiert
 *      tatsaechlich im Datenbestand. Rueckfall fuer Ware ausserhalb des
 *      Datenraums.
 *   4. **guessed** — nichts davon traf zu. Die wahrscheinlichste Lesart wird
 *      geliefert, aber `verified` bleibt false.
 *
 * Schritt 2 ist der eigentliche Fix: Ohne ihn nahm die App die erste Lesart
 * der Kandidatenliste (laengster Praefix zuerst) und suchte nach einem Ident,
 * den es nirgends gibt — der Scan war korrekt, die Abfrage lief ins Leere.
 */
export async function resolveScan(
  raw: string,
  source: ScanSource,
  exists?: ExistsCheck,
): Promise<ResolveResult> {
  const parsed = parseScan(raw, source);

  // 1. Bereits eindeutig.
  if (parsed.urn) {
    return { id: parsed.urn, parsed, verified: true, origin: 'direct' };
  }

  const candidates = parsed.candidates ?? [];
  if (candidates.length === 0) {
    return { id: null, parsed, verified: false, origin: 'guessed' };
  }

  // 2. Praefix aus der Foederation. Die Teilnehmer hinterlegen ihn selbst in
  //    profile/role.ttl — die Liste ist dezentral erhoben, nicht gepflegt.
  if (parsed.gtin) {
    try {
      const known = await getKnownCompanyPrefixes();
      const gcp = matchPrefix(parsed.gtin, known);
      if (gcp) {
        const urn = splitAtPrefix(parsed, gcp);
        if (urn) {
          console.log(`[gs1] Präfix ${gcp} aus der Föderation → ${urn}`);
          return {
            id: urn,
            parsed: { ...parsed, urn, gcp, itemRef: itemRefOf(urn) },
            verified: true,
            origin: 'registry',
          };
        }
      }
    } catch (e) {
      // Registry nicht erreichbar: kein Grund, den Scan aufzugeben — die
      // folgenden Schritte kommen ohne sie aus.
      console.warn('[gs1] Präfix-Auflösung übersprungen:', e);
    }
  }

  // 3. Abgleich mit dem tatsaechlichen Datenbestand.
  if (exists) {
    for (const candidate of candidates) {
      try {
        if (await exists(candidate)) {
          return {
            id: candidate,
            parsed: { ...parsed, urn: candidate },
            verified: true,
            origin: 'data',
          };
        }
      } catch {
        // Netzfehler beim Pruefen eines Kandidaten darf die uebrigen nicht
        // blockieren — die Aufloesung laeuft weiter.
      }
    }
  }

  // 4. Kein Treffer: wahrscheinlichste Lesart melden, aber als ungesichert.
  return {
    id: candidates[0],
    parsed: { ...parsed, problem: parsed.problem ?? 'ambiguous-gtin' },
    verified: false,
    origin: 'guessed',
  };
}

/** Artikelnummer aus einem fertigen URN (…:GCP.ITEMREF.SERIAL). */
function itemRefOf(urn: string): string | undefined {
  return urn.split(':')[4]?.split('.')[1];
}
