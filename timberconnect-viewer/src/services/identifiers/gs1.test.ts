import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseScan, gtinSplitCandidates, isValidGtin } from './gs1';
import { parseEpcHex } from './epcTds';
import { resolveScan } from './index';

/**
 * Der Testschatz: demo-dateien/tools/ids.json enthaelt fuer jeden Demo-Ident
 * beide Schreibweisen nebeneinander (GS1-Elementstring und URN). Damit laesst
 * sich die Erkennung gegen ueber 200 echte Faelle pruefen, ohne einen einzigen
 * Testfall von Hand zu schreiben.
 */
interface IdEntry {
  gs1: string;
  urn: string;
}

function loadIds(): IdEntry[] {
  const path = resolve(__dirname, '../../../../demo-dateien/tools/ids.json');
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  const seen = new Map<string, string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (typeof obj.gs1 === 'string' && typeof obj.urn === 'string') {
        seen.set(obj.gs1, obj.urn);
      }
      Object.values(obj).forEach(walk);
    }
  };
  walk(data);

  return [...seen].map(([gs1, urn]) => ({ gs1, urn }));
}

const ENTRIES = loadIds();

/** Der Datenbestand, gegen den mehrdeutige GTIN-Aufteilungen gepruefT werden. */
const KNOWN = new Set(ENTRIES.map((e) => e.urn));
const existsInDemoData = async (urn: string) => KNOWN.has(urn);

describe('Testdaten', () => {
  it('findet die Demo-Idente', () => {
    expect(ENTRIES.length).toBeGreaterThan(200);
  });
});

describe('Elementstring -> URN (alle Demo-Idente)', () => {
  it('loest jeden Eintrag korrekt auf', async () => {
    const failures: string[] = [];

    for (const { gs1, urn } of ENTRIES) {
      // Klammerform, wie in ids.json hinterlegt.
      const withParens = await resolveScan(gs1, 'wedge-barcode', existsInDemoData);
      if (withParens.id !== urn) {
        failures.push(`${gs1} -> ${withParens.id} (erwartet ${urn})`);
        continue;
      }

      // Klammerlose Form, wie sie der Scanner tatsaechlich liefert.
      const bare = gs1.replace(/[()]/g, (m) => (m === '(' ? '' : ''));
      const withoutParens = await resolveScan(bare, 'wedge-barcode', existsInDemoData);
      if (withoutParens.id !== urn) {
        failures.push(`(ohne Klammern) ${bare} -> ${withoutParens.id} (erwartet ${urn})`);
      }
    }

    expect(failures.slice(0, 10)).toEqual([]);
  });
});

describe('Die echten Scanner-Muster', () => {
  const DOTCODE = '01040471114510062112A3D4567';
  const BARCODE = '010404711140592421123456789101';
  const RFID = '301134C52500941CBE991A6D';

  it('DotCode trifft den Stamm aus dem Demo-Bestand', async () => {
    const r = await resolveScan(DOTCODE, 'wedge-barcode', existsInDemoData);
    expect(r.id).toBe('urn:epc:id:sgtin:404711145.0100.12A3D4567');
    expect(r.verified).toBe(true);
  });

  it('RFID-Tag wird eindeutig dekodiert (Partition liefert die Praefixgrenze)', () => {
    const p = parseEpcHex(RFID, 'wedge-rfid');
    expect(p?.gcp).toBe('40471114');
    expect(p?.itemRef).toBe('00592');
    expect(p?.serial).toBe('123456789101');
    expect(p?.urn).toBe('urn:epc:id:sgtin:40471114.00592.123456789101');
  });

  it('Barcode und RFID bezeichnen dasselbe Bauteil', async () => {
    const rfid = parseEpcHex(RFID, 'wedge-rfid');
    const barcode = parseScan(BARCODE, 'wedge-barcode');

    // Gleiche Seriennummer ...
    expect(barcode.serial).toBe(rfid?.serial);
    // ... und die RFID-Lesart steckt unter den Barcode-Kandidaten.
    expect(barcode.candidates).toContain(rfid?.urn);
  });

  it('Barcode ohne passende Daten meldet den Grund konkret', async () => {
    const r = await resolveScan(BARCODE, 'wedge-barcode', existsInDemoData);
    // Zu diesem Etikettenmuster existieren keine Events -> nicht gesichert.
    expect(r.verified).toBe(false);
    expect(r.parsed.gtin).toBe('04047111405924');
    expect(r.parsed.serial).toBe('123456789101');
  });
});

describe('GTIN', () => {
  it('erkennt gueltige Pruefziffern der echten Muster', () => {
    expect(isValidGtin('04047111451006')).toBe(true);
    expect(isValidGtin('04047111405924')).toBe(true);
    expect(isValidGtin('04047111462125')).toBe(true);
  });

  it('erkennt eine falsche Pruefziffer', () => {
    expect(isValidGtin('04047111451007')).toBe(false);
  });

  it('deckt mit den Kandidaten beide Praefixlaengen ab', () => {
    const nine = gtinSplitCandidates('04047111451006').map((c) => `${c.gcp}.${c.itemRef}`);
    expect(nine).toContain('404711145.0100');

    const eight = gtinSplitCandidates('04047111405924').map((c) => `${c.gcp}.${c.itemRef}`);
    expect(eight).toContain('40471114.00592');
  });
});

describe('Bestehende Formate bleiben unangetastet', () => {
  it('reicht eine URN unveraendert durch', () => {
    const urn = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';
    expect(parseScan(urn, 'manual').urn).toBe(urn);
  });

  it('reicht ein Saatgut-Los (LGTIN) unveraendert durch', () => {
    const urn = 'urn:epc:class:lgtin:404711145.0001.Pflanzung01';
    expect(parseScan(urn, 'manual').urn).toBe(urn);
  });

  it('reicht eine Trace-ID unveraendert durch', () => {
    expect(parseScan('TC-2025-001', 'manual').urn).toBe('TC-2025-001');
  });
});

describe('Weitere Traegerformen', () => {
  it('versteht eine Digital-Link-URL', async () => {
    const url = 'https://id.gs1.org/01/04047111451006/21/12A3D4567';
    const r = await resolveScan(url, 'camera', existsInDemoData);
    expect(r.id).toBe('urn:epc:id:sgtin:404711145.0100.12A3D4567');
  });

  it('versteht das GS-Trennzeichen bei variabler Laenge', async () => {
    const gs = String.fromCharCode(29);
    const raw = `010404711145001610Pflanzung01${gs}`;
    const r = await resolveScan(raw, 'wedge-barcode', existsInDemoData);
    expect(r.id).toBe('urn:epc:class:lgtin:404711145.0001.Pflanzung01');
  });

  it('entfernt die Symbologie-Kennung ]d2', async () => {
    const r = await resolveScan(']d201040471114510062112A3D4567', 'wedge-barcode', existsInDemoData);
    expect(r.id).toBe('urn:epc:id:sgtin:404711145.0100.12A3D4567');
  });

  it('meldet unbrauchbare Eingaben statt zu raten', () => {
    expect(parseScan('Hallo Welt', 'manual').problem).toBe('unparseable');
    expect(parseScan('', 'manual').problem).toBe('unparseable');
  });

  it('erkennt einen GTIN ohne Serie als solchen', () => {
    const p = parseScan('0104047111451006', 'wedge-barcode');
    expect(p.problem).toBe('no-serial-or-lot');
    expect(p.gtin).toBe('04047111451006');
  });
});
