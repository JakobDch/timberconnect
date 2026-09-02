import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildOriginEvent, buildOriginDocument, captureOriginLink } from './originEventService';
import { collectEpcs } from './epcisService';
import type { OriginGroup, OriginProposal } from './stemOriginService';
import type { PlantingAreaResult } from './sparqlService';

const authFetch = vi.fn();
vi.mock('./authFetch', () => ({
  getAuthFetch: () => authFetch,
}));

function area(iri: string): PlantingAreaResult {
  return {
    certificateIri: iri,
    ring: [[8, 51], [8.01, 51], [8.01, 51.01], [8, 51.01], [8, 51]],
    centroid: null,
    epc: 'urn:epc:class:lgtin:404711145.0001.Pflanzung01',
    certificateNumber: 'SZ-2026-01',
    species: 'Fichte',
    maturityYear: '2026',
  };
}

function group(iri = 'cert-1', epcs = ['urn:epc:id:sgtin:1.1.A']): OriginGroup {
  return {
    area: area(iri),
    label: 'Stammzertifikat SZ-2026-01',
    seedEpc: 'urn:epc:class:lgtin:404711145.0001.Pflanzung01',
    stems: epcs.map((epc, i) => ({
      stemKey: String(i + 1),
      epc,
      position: { lat: 51.005, lon: 8.005 },
      positionSource: 'crane' as const,
    })),
  };
}

describe('buildOriginEvent', () => {
  it('baut ein TransformationEvent: Saatgut rein, Rundholz raus', () => {
    const ev = buildOriginEvent(group('cert-1', ['urn:epc:id:sgtin:1.1.A', 'urn:epc:id:sgtin:1.1.B']));

    expect(ev.type).toBe('TransformationEvent');
    expect(ev.inputQuantityList).toEqual([
      { epcClass: 'urn:epc:class:lgtin:404711145.0001.Pflanzung01' },
    ]);
    expect(ev.outputEPCList).toEqual([
      'urn:epc:id:sgtin:1.1.A',
      'urn:epc:id:sgtin:1.1.B',
    ]);
  });

  it('setzt kein action — der Standard verbietet es am TransformationEvent', () => {
    expect(buildOriginEvent(group())).not.toHaveProperty('action');
  });

  it('haelt den Beleggrad fest', () => {
    // Eine erschlossene Kante, die sich als dokumentbelegte ausgibt, waere
    // schlimmer als gar keine.
    const ev = buildOriginEvent(group('cert-9'));

    expect(ev['tc:linkBasis']).toBe('geometric');
    expect(ev['tc:linkSource']).toBe('cert-9');
  });

  it('nimmt die Faellzeit, nicht die Uploadzeit', () => {
    const ev = buildOriginEvent(group(), { eventTime: '2026-07-14T07:00:00+02:00' });

    expect(ev.eventTime).toBe('2026-07-14T07:00:00+02:00');
  });

  it('uebernimmt die bizTransaction, wenn vorhanden', () => {
    const ev = buildOriginEvent(group(), {
      bizTransactionUrl: 'https://pod.example/uploads/abc',
    });

    expect(ev.bizTransactionList).toEqual([
      { bizTransaction: 'https://pod.example/uploads/abc' },
    ]);
  });

  it('laesst Staemme ohne EPC aus der Ausgangsliste', () => {
    const g = group();
    g.stems.push({ stemKey: '99', epc: null, position: null, positionSource: null });

    expect((buildOriginEvent(g).outputEPCList as string[])).toEqual([
      'urn:epc:id:sgtin:1.1.A',
    ]);
  });
});

describe('buildOriginDocument', () => {
  it('erzeugt je Flaeche ein Event', () => {
    // Ein Event fuer beide wuerde eine gemeinsame Herkunft behaupten.
    const doc = buildOriginDocument([group('cert-A'), group('cert-B')]);
    const events = (doc.epcisBody as { eventList: unknown[] }).eventList;

    expect(events).toHaveLength(2);
  });

  it('deklariert den tc-Namensraum, damit linkBasis aufloesbar ist', () => {
    const ctx = buildOriginDocument([group()])['@context'] as unknown[];

    expect(ctx).toContainEqual({ tc: 'http://timberconnect.2050.de/ontology#' });
  });
});

describe('Kette geschlossen', () => {
  it('collectEpcs loest aus dem Event beide Seiten auf', () => {
    // Der eigentliche Zweck der ganzen Aenderung: Vor ihr fand die Abfrage vom
    // Pflanzungs-Ident aus nichts als sich selbst, weil kein Event Saatgut und
    // Rundholz gemeinsam nannte. Faellt diese Zusicherung, ist die Kette wieder
    // gebrochen — auch wenn alle anderen Tests gruen bleiben.
    const ev = buildOriginEvent(
      group('cert-1', [
        'urn:epc:id:sgtin:404711145.0100.12A3D4567',
        'urn:epc:id:sgtin:404711145.0100.56KCTQMJM',
      ]),
    );

    const found = collectEpcs([ev as never]);

    expect(found).toContain('urn:epc:class:lgtin:404711145.0001.Pflanzung01');
    expect(found).toContain('urn:epc:id:sgtin:404711145.0100.12A3D4567');
    expect(found).toContain('urn:epc:id:sgtin:404711145.0100.56KCTQMJM');
  });
});

describe('captureOriginLink', () => {
  beforeEach(() => {
    authFetch.mockReset();
  });

  const proposal: OriginProposal = {
    totalStems: 2,
    groups: [group('cert-A'), group('cert-B')],
    unmatched: [],
    withoutPosition: [],
    ambiguous: [],
  };

  it('schreibt nur die ausgewaehlten Gruppen', async () => {
    // Wer eine Zuordnung abwaehlt, will sie nicht im Repository haben.
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ submitted: true, dry_run: false }),
    });

    const result = await captureOriginLink(proposal, ['cert-A']);

    const body = JSON.parse(authFetch.mock.calls[0][1].body);
    expect(body.epcis_document.epcisBody.eventList).toHaveLength(1);
    expect(result.eventCount).toBe(1);
  });

  it('schreibt nichts, wenn nichts ausgewaehlt ist', async () => {
    const result = await captureOriginLink(proposal, []);

    expect(authFetch).not.toHaveBeenCalled();
    expect(result.captured).toBe(false);
  });

  it('wirft bei einem Fehler, statt eine Kante vorzuspiegeln', async () => {
    authFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ detail: 'EPCAT capture failed' }),
    });

    await expect(captureOriginLink(proposal, ['cert-A'])).rejects.toThrow(
      'EPCAT capture failed',
    );
  });

  it('meldet den Trockenlauf durch', async () => {
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ submitted: false, dry_run: true }),
    });

    const result = await captureOriginLink(proposal, ['cert-A']);

    expect(result.dryRun).toBe(true);
  });
});
