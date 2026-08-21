/**
 * RFID-Tag-Inhalte (EPC Tag Data Standard) in die kanonische URN uebersetzen.
 *
 * Ein UHF-Tag speichert im EPC-Speicher keine Textform, sondern eine binaere
 * Kodierung. Der Zebra-Leser gibt sie als Hex-Zeichenkette aus, z.B.
 *
 *     301134C52500941CBE991A6D
 *       -> urn:epc:id:sgtin:40471114.00592.123456789101
 *
 * Nur Dekodieren: die Tags beschreibt das EECC, die App liest sie ausschliesslich.
 *
 * Anders als beim Barcode ist hier die Grenze zwischen Firmenpraefix und
 * Artikelnummer eindeutig — sie steckt im Partition-Feld. Deshalb liefert ein
 * RFID-Scan immer eine exakte URN, waehrend ein Barcode mehrdeutig bleibt.
 */

import type { ParsedIdentifier, ScanSource } from './types';

/** Sieht der Rohwert nach einem Hex-EPC aus? */
export function looksLikeEpcHex(raw: string): boolean {
  const s = raw.trim();
  // Mindestens 96 Bit (24 Zeichen), gerade Laenge, nur Hex-Ziffern.
  return s.length >= 16 && s.length % 2 === 0 && /^[0-9A-Fa-f]+$/.test(s);
}

/**
 * Partitionstabelle nach EPC TDS: bestimmt, wie sich die Bits zwischen
 * Firmenpraefix und Artikelnummer aufteilen.
 * [GCP-Bits, GCP-Stellen, ItemRef-Bits, ItemRef-Stellen]
 */
const PARTITIONS: Record<number, [number, number, number, number]> = {
  0: [40, 12, 4, 1],
  1: [37, 11, 7, 2],
  2: [34, 10, 10, 3],
  3: [30, 9, 14, 4],
  4: [27, 8, 17, 5],
  5: [24, 7, 20, 6],
  6: [20, 6, 24, 7],
};

const HEADER_SGTIN_96 = 0x30;
const HEADER_SGTIN_198 = 0x36;

function pad(value: bigint, digits: number): string {
  return value.toString().padStart(digits, '0');
}

/**
 * Liest die 7-Bit-ASCII-Seriennummer einer SGTIN-198 (140 Bit, mit Null
 * abgeschlossen).
 */
function decodeSerial198(bits: bigint): string {
  let out = '';
  for (let i = 0; i < 20; i++) {
    const shift = BigInt(140 - 7 * (i + 1));
    const code = Number((bits >> shift) & 0x7fn);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Hex-EPC in eine ParsedIdentifier-Struktur uebersetzen.
 * Gibt null zurueck, wenn der Wert offensichtlich kein EPC ist.
 */
export function parseEpcHex(raw: string, source: ScanSource): ParsedIdentifier | null {
  const hex = raw.trim().toUpperCase();
  if (!looksLikeEpcHex(hex)) return null;

  const base: ParsedIdentifier = { urn: null, kind: 'epc-hex', source, raw };

  let value: bigint;
  try {
    value = BigInt(`0x${hex}`);
  } catch {
    return { ...base, problem: 'undecodable-epc' };
  }

  const totalBits = hex.length * 4;
  const header = Number((value >> BigInt(totalBits - 8)) & 0xffn);

  if (header !== HEADER_SGTIN_96 && header !== HEADER_SGTIN_198) {
    // Andere gueltige EPC-Schemata (SSCC, GDTI, GRAI ...) bezeichnen keine
    // Bauteile in diesem System — klar benennen statt Unsinn zu liefern.
    return { ...base, problem: 'unsupported-epc-scheme' };
  }

  const partition = Number((value >> BigInt(totalBits - 14)) & 0x7n);
  const entry = PARTITIONS[partition];
  if (!entry) return { ...base, problem: 'undecodable-epc' };

  const [gcpBits, gcpDigits, itemBits, itemDigits] = entry;
  // Nach Header (8) + Filter (3) + Partition (3) folgen GCP und ItemRef.
  const afterPartition = totalBits - 14;
  const gcpShift = BigInt(afterPartition - gcpBits);
  const itemShift = BigInt(afterPartition - gcpBits - itemBits);

  const gcpRaw = (value >> gcpShift) & ((1n << BigInt(gcpBits)) - 1n);
  const itemRaw = (value >> itemShift) & ((1n << BigInt(itemBits)) - 1n);

  const gcp = pad(gcpRaw, gcpDigits);
  const itemRef = pad(itemRaw, itemDigits);

  let serial: string;
  if (header === HEADER_SGTIN_96) {
    const serialBits = afterPartition - gcpBits - itemBits;
    serial = ((value >> 0n) & ((1n << BigInt(serialBits)) - 1n)).toString();
  } else {
    const serialField = value & ((1n << 140n) - 1n);
    serial = decodeSerial198(serialField);
  }

  if (!serial) return { ...base, gcp, itemRef, problem: 'undecodable-epc' };

  return {
    ...base,
    urn: `urn:epc:id:sgtin:${gcp}.${itemRef}.${serial}`,
    gcp,
    itemRef,
    serial,
  };
}
