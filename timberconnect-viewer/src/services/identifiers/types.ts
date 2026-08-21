/**
 * Gemeinsame Typen fuer die Scan-Erkennung.
 *
 * Ein Scanner liefert dieselbe Bauteil-ID je nach Traeger in ganz
 * unterschiedlichen Schreibweisen. Diese Typen beschreiben das Ergebnis der
 * Uebersetzung in die kanonische Form, die der Rest der App erwartet
 * (urn:epc:id:sgtin:... bzw. urn:epc:class:lgtin:...).
 */

/** Woher eine ID stammt — steuert Badge und Fehlertexte. */
export type ScanSource =
  | 'wedge-barcode'
  | 'wedge-rfid'
  | 'camera'
  | 'manual'
  | 'simulated';

/** Art des erkannten Traegers. */
export type ScanKind =
  | 'urn'
  | 'element-string'
  | 'digital-link'
  | 'epc-hex'
  | 'trace-id'
  | 'unknown';

/**
 * Warum keine eindeutige ID gebildet werden konnte. Bewusst benannt statt
 * einer allgemeinen "ungueltig"-Meldung: der Unterschied zwischen "Scan war
 * fehlerhaft" und "Scan war korrekt, aber das Bauteil ist unbekannt" ist beim
 * Testen am Geraet der wichtigste Hinweis ueberhaupt.
 */
export type ScanProblem =
  | 'ambiguous-gtin'
  | 'no-serial-or-lot'
  | 'undecodable-epc'
  | 'bad-checkdigit'
  | 'unsupported-epc-scheme'
  | 'unparseable';

export interface ParsedIdentifier {
  /**
   * Die kanonische ID, sofern eindeutig bestimmbar. Bei Barcodes ohne bekannte
   * Praefixgrenze bleibt sie null — dann traegt `candidates` die moeglichen
   * Lesarten und der Aufloeser entscheidet anhand der Daten.
   */
  urn: string | null;
  kind: ScanKind;
  source: ScanSource;
  /** Eingabe, unveraendert — fuer Fehlermeldungen und Debug-Anzeige. */
  raw: string;

  /** 14-stelliger GTIN, sofern der Traeger einen enthielt. */
  gtin?: string;
  /** Seriennummer (AI 21) bzw. Chargennummer (AI 10). */
  serial?: string;
  lot?: string;
  /** Firmenpraefix und Artikelnummer, sofern eindeutig (z.B. aus RFID). */
  gcp?: string;
  itemRef?: string;
  /** Alle erkannten GS1-Anwendungsbezeichner, auch die hier nicht genutzten. */
  ais?: Record<string, string>;

  /**
   * Moegliche URNs, wenn die Aufteilung des GTIN nicht eindeutig ist.
   * Sortiert: wahrscheinlichste zuerst.
   */
  candidates?: string[];

  problem?: ScanProblem;
}

/** Kurzer, im UI anzeigbarer Grund. */
export function describeProblem(p: ParsedIdentifier): string | null {
  switch (p.problem) {
    case 'ambiguous-gtin':
      return `GTIN ${p.gtin ?? '?'}, Serie ${p.serial ?? p.lot ?? '?'} — kein Bauteil gefunden`;
    case 'no-serial-or-lot':
      return `GTIN ${p.gtin ?? '?'} ohne Serien- oder Chargennummer — kein einzelnes Bauteil bestimmbar`;
    case 'undecodable-epc':
      return 'RFID-Tag konnte nicht gelesen werden';
    case 'bad-checkdigit':
      return `Pruefziffer des GTIN ${p.gtin ?? ''} stimmt nicht`;
    case 'unsupported-epc-scheme':
      return 'RFID-Tag enthaelt kein Produkt-Ident (SGTIN)';
    case 'unparseable':
      return 'Scan konnte nicht gedeutet werden';
    default:
      return null;
  }
}
