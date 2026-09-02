/**
 * Der durchgaengige Weg: Rohscan -> Praefix aus der Foederation -> Bauteil-ID.
 *
 * Ergaenzt gs1.test.ts, das die reine Formdeutung prueft. Hier geht es um den
 * Schritt danach — die Entscheidung, WO der Firmenpraefix endet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseScan, splitAtPrefix } from './gs1';

// Die Foederation wird gemockt: der Test soll die Aufloesungslogik pruefen,
// nicht die Erreichbarkeit der Pods.
const mockPrefixes = vi.hoisted(() => ({ value: [] as string[] }));
vi.mock('../companyPrefixService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../companyPrefixService')>();
  return {
    ...actual,
    getKnownCompanyPrefixes: vi.fn(async () => mockPrefixes.value),
  };
});

const { resolveScan } = await import('./index');

/** Der Rundholz-DotCode aus dem Fehlerbericht vom 02.09.2026. */
const RUNDHOLZ_DOTCODE = '01040471114510062112A3D4567';
/** So steht der Ident in den Pod-Daten (demo-dateien/2_Faellvorgang). */
const RUNDHOLZ_URN = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';

beforeEach(() => {
  mockPrefixes.value = ['404711148', '404711146', '404711145'];
});

describe('splitAtPrefix', () => {
  it('bildet den URN bei bekannter Praefixgrenze', () => {
    const parsed = parseScan(RUNDHOLZ_DOTCODE, 'wedge-barcode');
    expect(splitAtPrefix(parsed, '404711145')).toBe(RUNDHOLZ_URN);
  });

  it('liefert null, wenn der Praefix nicht zum GTIN passt', () => {
    const parsed = parseScan(RUNDHOLZ_DOTCODE, 'wedge-barcode');
    expect(splitAtPrefix(parsed, '999999999')).toBeNull();
  });

  it('liefert null ohne Serien- oder Chargennummer', () => {
    // Ein halb gebildeter Ident waere schlimmer als gar keiner.
    const parsed = parseScan('0104047111451006', 'wedge-barcode');
    expect(splitAtPrefix(parsed, '404711145')).toBeNull();
  });

  it('nutzt das LGTIN-Schema bei einer Charge', () => {
    // Der Pflanzvorgang fuehrt ein Saatgut-Los, keine Einzelstuecke.
    const parsed = parseScan('010404711145100610Pflanzung01', 'wedge-barcode');
    const urn = splitAtPrefix(parsed, '404711145');
    expect(urn).toContain('urn:epc:class:lgtin:404711145.0100.');
  });
});

describe('resolveScan mit Foederations-Praefixen', () => {
  it('loest den Rundholz-DotCode korrekt auf — der eigentliche Fix', () => {
    return resolveScan(RUNDHOLZ_DOTCODE, 'wedge-barcode').then((r) => {
      expect(r.id).toBe(RUNDHOLZ_URN);
      expect(r.verified).toBe(true);
      expect(r.origin).toBe('registry');
    });
  });

  it('waehlt NICHT mehr blind die laengste Lesart', async () => {
    const r = await resolveScan(RUNDHOLZ_DOTCODE, 'wedge-barcode');
    // Das war das fehlerhafte Ergebnis vor dem Fix.
    expect(r.id).not.toBe('urn:epc:id:sgtin:40471114510.00.12A3D4567');
  });

  it('reicht eine fertige URN unveraendert durch', async () => {
    const r = await resolveScan(RUNDHOLZ_URN, 'manual');
    expect(r.id).toBe(RUNDHOLZ_URN);
    expect(r.origin).toBe('direct');
  });

  it('faellt bei unbekanntem Praefix auf den Datenabgleich zurueck', async () => {
    mockPrefixes.value = []; // niemand in der Foederation fuehrt den Praefix
    const exists = vi.fn(async (urn: string) => urn === RUNDHOLZ_URN);
    const r = await resolveScan(RUNDHOLZ_DOTCODE, 'wedge-barcode', exists);
    expect(r.id).toBe(RUNDHOLZ_URN);
    expect(r.origin).toBe('data');
    expect(r.verified).toBe(true);
  });

  it('kennzeichnet ein Ergebnis als ungesichert, wenn nichts greift', async () => {
    mockPrefixes.value = [];
    const r = await resolveScan(RUNDHOLZ_DOTCODE, 'wedge-barcode');
    expect(r.verified).toBe(false);
    expect(r.origin).toBe('guessed');
    expect(r.parsed.problem).toBe('ambiguous-gtin');
    // Eine ID kommt trotzdem — der Nutzer soll nicht in einer Sackgasse stehen.
    expect(r.id).not.toBeNull();
  });

  it('gibt der Foederation Vorrang vor dem Datenabgleich', async () => {
    // Kein exists-Aufruf noetig, wenn der Praefix bekannt ist: das spart bis
    // zu sechs Netzabfragen pro Scan.
    const exists = vi.fn(async () => true);
    const r = await resolveScan(RUNDHOLZ_DOTCODE, 'wedge-barcode', exists);
    expect(r.origin).toBe('registry');
    expect(exists).not.toHaveBeenCalled();
  });
});
