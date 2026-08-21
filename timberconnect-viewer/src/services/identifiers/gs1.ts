/**
 * Scan-Erkennung: beliebige Scanner-Ausgaben in die kanonische Bauteil-ID.
 *
 * Dieselbe ID erreicht die App je nach Traeger anders:
 *
 *   Barcode   010404711140592421123456789101   (Elementstring, ohne Klammern)
 *   DotCode   01040471114510062112A3D4567
 *   RFID      301134C52500941CBE991A6D         (binaer, siehe epcTds.ts)
 *   manuell   urn:epc:id:sgtin:404711145.0100.12A3D4567
 *
 * Ohne Uebersetzung meldet die App "Keine Daten gefunden", obwohl der Scan
 * korrekt war.
 *
 * ## Warum der GTIN nicht aufgeteilt wird
 *
 * Die App erwartet Praefix und Artikelnummer getrennt
 * (`urn:epc:id:sgtin:<gcp>.<itemref>.<serial>`). Aus einem Barcode ist diese
 * Grenze aber nicht ableitbar: `404711140592` laesst sich als
 * `40471114` + `00592` oder als `404711140` + `0592` lesen. Nur ein Abgleich
 * mit den tatsaechlichen Daten entscheidet das. Deshalb wird hier **nicht
 * geraten**, sondern `candidates` gefuellt; die Aufloesung uebernimmt
 * `resolveScan()` in index.ts.
 *
 * Beim RFID-Tag entfaellt das Problem, weil das Partition-Feld die Grenze
 * mitliefert.
 */

import { isEpc, isTraceId } from '../sparqlQueries';
import { parseEpcHex, looksLikeEpcHex } from './epcTds';
import type { ParsedIdentifier, ScanSource } from './types';

/**
 * GS1-Trennzeichen (FNC1), ASCII 29. Bewusst als Escape-Sequenz notiert und
 * nicht als echtes Steuerzeichen im Quelltext — sonst geht es beim Kopieren
 * oder Umkodieren der Datei unbemerkt verloren.
 */
const GS = String.fromCharCode(29);

/**
 * Anwendungsbezeichner mit fester Gesamtlaenge (inkl. der zwei Kennziffern).
 * Wichtig, damit auch dann korrekt getrennt wird, wenn die Tastatur-Emulation
 * das nicht druckbare GS-Zeichen verschluckt hat — was haeufig vorkommt.
 */
const FIXED_LENGTH_AIS: Record<string, number> = {
  '00': 20, '01': 16, '02': 16,
  '11': 8, '12': 8, '13': 8, '15': 8, '16': 8, '17': 8,
  '20': 4,
  '410': 16, '411': 16, '412': 16, '413': 16, '414': 16, '415': 16, '416': 16, '417': 16,
  '422': 6,
  '8006': 22,
};

/** Bezeichner mit variabler Laenge (durch GS oder Ende begrenzt). */
const VARIABLE_AIS = new Set([
  '10', '21', '22', '240', '241', '250', '251', '30', '37',
  '90', '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

/**
 * Symbologie-Kennungen, die "es folgen GS1-Bezeichner" bedeuten.
 * Fehlt eine solche Kennung, darf nicht blind AI-geparst werden — sonst wird
 * ein gewoehnlicher Code-128-Inhalt faelschlich zerlegt.
 */
const GS1_SYMBOLOGY = /^\](d2|C1|Q3|e0|E0)/;
const ANY_SYMBOLOGY = /^\][A-Za-z][0-9A-Za-z]/;

/** GTIN-Pruefziffer nach Modulo 10. */
export function gtinCheckDigit(first13: string): number {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(first13[i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(gtin14: string): boolean {
  if (!/^\d{14}$/.test(gtin14)) return false;
  return gtinCheckDigit(gtin14.slice(0, 13)) === Number(gtin14[13]);
}

/**
 * Alle plausiblen Aufteilungen eines GTIN in Firmenpraefix + Artikelnummer.
 *
 * Der GS1-Firmenpraefix ist 6 bis 12 Stellen lang. Aus 14 Stellen GTIN wird
 * die Indikatorziffer vorne und die Pruefziffer hinten entfernt; der Rest
 * teilt sich auf. Die Artikelnummer traegt die Indikatorziffer als erste
 * Stelle — so entsteht `0100` aus Indikator `0` und Rest `100`.
 *
 * Laengere Praefixe zuerst: sie sind in diesem Datenbestand die Regel.
 */
export function gtinSplitCandidates(gtin14: string): Array<{ gcp: string; itemRef: string }> {
  const indicator = gtin14[0];
  const body = gtin14.slice(1, 13);
  const out: Array<{ gcp: string; itemRef: string }> = [];
  for (let gcpLen = 12; gcpLen >= 6; gcpLen--) {
    if (gcpLen >= body.length) continue;
    out.push({ gcp: body.slice(0, gcpLen), itemRef: indicator + body.slice(gcpLen) });
  }
  return out;
}

/** Zerlegt einen GS1-Elementstring in seine Anwendungsbezeichner. */
function parseElementString(data: string): Record<string, string> | null {
  const ais: Record<string, string> = {};
  let i = 0;
  let guard = 0;

  while (i < data.length) {
    if (guard++ > 64) return null;

    // Fuehrende Trennzeichen ueberspringen.
    if (data[i] === GS) {
      i++;
      continue;
    }

    // Bezeichner ermitteln: 2 bis 4 Stellen, laengste bekannte Zuordnung gewinnt.
    let ai = '';
    for (const len of [4, 3, 2]) {
      const cand = data.slice(i, i + len);
      if (cand.length === len && (FIXED_LENGTH_AIS[cand] !== undefined || VARIABLE_AIS.has(cand))) {
        ai = cand;
        break;
      }
    }
    if (!ai) return null;

    i += ai.length;
    const fixed = FIXED_LENGTH_AIS[ai];

    if (fixed !== undefined) {
      const valueLen = fixed - ai.length;
      const value = data.slice(i, i + valueLen);
      if (value.length !== valueLen) return null;
      ais[ai] = value;
      i += valueLen;
    } else {
      const stop = data.indexOf(GS, i);
      const end = stop === -1 ? data.length : stop;
      ais[ai] = data.slice(i, end);
      i = end;
    }
  }

  return Object.keys(ais).length > 0 ? ais : null;
}

/** Erkennt und zerlegt eine GS1-Digital-Link-URL. */
function parseDigitalLink(raw: string): Record<string, string> | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const ais: Record<string, string> = {};

  // Pfad-Paare einlesen, beginnend beim ersten bekannten Schluessel.
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    if (FIXED_LENGTH_AIS[key] !== undefined || VARIABLE_AIS.has(key)) {
      ais[key] = decodeURIComponent(segments[i + 1]);
      i++;
    }
  }
  // Zusatzangaben aus dem Query-Teil (z.B. ?10=LOT&17=261231).
  url.searchParams.forEach((value, key) => {
    if (FIXED_LENGTH_AIS[key] !== undefined || VARIABLE_AIS.has(key)) ais[key] = value;
  });

  return ais['01'] ? ais : null;
}

/** Baut das Ergebnis aus erkannten Anwendungsbezeichnern. */
function fromAis(
  ais: Record<string, string>,
  kind: 'element-string' | 'digital-link',
  raw: string,
  source: ScanSource,
): ParsedIdentifier {
  const base: ParsedIdentifier = { urn: null, kind, source, raw, ais };
  const gtin = ais['01'];
  if (!gtin || !/^\d{14}$/.test(gtin)) {
    return { ...base, problem: 'unparseable' };
  }

  base.gtin = gtin;
  const serial = ais['21'];
  const lot = ais['10'];
  if (serial) base.serial = serial;
  if (lot) base.lot = lot;

  if (!isValidGtin(gtin)) {
    // Nicht fatal: im Pilotbetrieb kommen handgemachte Etiketten vor. Der
    // Hinweis ist trotzdem wichtig, weil er auf ein fehlerhaftes Etikett deutet.
    base.problem = 'bad-checkdigit';
  }

  // Serie (AI 21) schlaegt Charge (AI 10): sie bezeichnet das einzelne Stueck.
  const value = serial || lot;
  if (!value) {
    return { ...base, problem: base.problem ?? 'no-serial-or-lot' };
  }

  const scheme = serial ? 'urn:epc:id:sgtin' : 'urn:epc:class:lgtin';
  base.candidates = gtinSplitCandidates(gtin).map(
    ({ gcp, itemRef }) => `${scheme}:${gcp}.${itemRef}.${value}`,
  );

  return base;
}

/**
 * Einen beliebigen Scan-Rohwert deuten.
 *
 * Reihenfolge ist bewusst: bestehende Formate (URN, Trace-ID) zuerst und
 * unveraendert durchreichen, damit der heutige Weg unangetastet bleibt.
 */
export function parseScan(raw: string, source: ScanSource): ParsedIdentifier {
  const input = (raw ?? '').trim();
  if (!input) {
    return { urn: null, kind: 'unknown', source, raw, problem: 'unparseable' };
  }

  // 1) Bereits die kanonische Form.
  if (isEpc(input)) {
    return { urn: input, kind: 'urn', source, raw: input };
  }

  // 2) Bestehende Trace-ID — unveraendert weiterreichen.
  if (isTraceId(input)) {
    return { urn: input, kind: 'trace-id', source, raw: input };
  }

  // 3) Digital-Link-URL.
  if (/^https?:\/\//i.test(input)) {
    const ais = parseDigitalLink(input);
    if (ais) return fromAis(ais, 'digital-link', input, source);
    return { urn: null, kind: 'unknown', source, raw: input, problem: 'unparseable' };
  }

  // 4) Symbologie-Kennung auswerten und entfernen.
  let body = input;
  let gs1Declared = false;
  if (GS1_SYMBOLOGY.test(input)) {
    gs1Declared = true;
    body = input.slice(3);
  } else if (ANY_SYMBOLOGY.test(input)) {
    // Ausdruecklich kein GS1-Inhalt: nicht zerlegen.
    const rest = input.slice(3);
    if (isEpc(rest)) return { urn: rest, kind: 'urn', source, raw: input };
    return { urn: null, kind: 'unknown', source, raw: input, problem: 'unparseable' };
  }

  // 5) Klammerform (01)...(21)... normalisieren.
  const hasParens = /^\(\d{2,4}\)/.test(body);
  if (hasParens) {
    body = body.replace(/\((\d{2,4})\)/g, (_m, ai) => ai);
    gs1Declared = true;
  }

  // 6) Hex-EPC vom RFID-Leser. Nach der Klammerpruefung, damit reine Ziffern
  //    nicht faelschlich als Hex gelten — ein Elementstring beginnt mit "01".
  if (!gs1Declared && looksLikeEpcHex(body) && !/^01\d{14}/.test(body)) {
    const epc = parseEpcHex(body, source);
    if (epc && epc.urn) return epc;
    if (epc && epc.problem !== 'undecodable-epc') return epc;
  }

  // 7) Elementstring.
  if (/^\d{2}/.test(body)) {
    const ais = parseElementString(body);
    if (ais) return fromAis(ais, 'element-string', input, source);
  }

  // 8) Letzter Versuch: doch ein Hex-EPC.
  if (looksLikeEpcHex(body)) {
    const epc = parseEpcHex(body, source);
    if (epc) return epc;
  }

  return { urn: null, kind: 'unknown', source, raw: input, problem: 'unparseable' };
}
