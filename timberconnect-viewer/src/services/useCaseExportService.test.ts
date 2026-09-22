import { describe, it, expect } from 'vitest';
import {
  buildDeconstructionExport,
  buildDocumentationExport,
  buildOriginExport,
  exportFilename,
} from './useCaseExportService';
import { mapToDeconstruction } from './deconstructionMapper';
import { mapToDocumentation } from './documentationMapper';
import type { ProvenanceData } from './provenanceMapper';
import type { ProductDataResult, SparqlBinding } from './sparqlService';

/**
 * Der JSON-Export gibt heraus, was die Ansicht zeigt. Diese Tests halten die
 * drei Zusagen fest, an denen ein Empfaenger haengt: das Format ist ueber die
 * Awf hinweg gleich, die Begruendungen fehlender Angaben sind mit drin, und
 * nichts steht doppelt.
 */

const row = (values: Record<string, string>): SparqlBinding =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }]));

function data(partial: Partial<ProductDataResult>): ProductDataResult {
  return {
    product: [],
    stem: [],
    forest: [],
    sawmill: [],
    bspWerk: [],
    transportOrders: [],
    certificates: [],
    declarations: [],
    epcisEvents: [],
    deconstruction: [],
    documentation: [],
    ...partial,
  } as unknown as ProductDataResult;
}

const EPC = 'urn:epc:id:sgtin:404711148.0401.143138262901';

describe('exportFilename', () => {
  it('nimmt Awf und Ident auf, damit mehrere Exporte unterscheidbar bleiben', () => {
    const name = exportFilename('deconstruction', EPC);

    expect(name).toContain('deconstruction');
    // Nur der unterscheidende Teil des Idents, nicht das urn-Praefix.
    expect(name).toContain('404711148.0401.143138262901');
    expect(name.endsWith('.json')).toBe(true);
  });

  it('kommt ohne Ident aus', () => {
    expect(exportFilename('co2', null)).toMatch(/^timberconnect_co2_\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe('JSON-Export — gemeinsames Format', () => {
  it('liefert fuer jeden Awf denselben Kopf', () => {
    const deconstruction = buildDeconstructionExport(
      mapToDeconstruction(data({}), null),
      EPC,
    );
    const documentation = buildDocumentationExport(
      mapToDocumentation(data({}), null),
      EPC,
    );

    for (const exported of [deconstruction, documentation]) {
      expect(exported.anwendungsfall).toHaveProperty('id');
      expect(exported.anwendungsfall).toHaveProperty('titel');
      expect(exported.bauteil.ident).toBe(EPC);
      expect(Array.isArray(exported.kategorien)).toBe(true);
      expect(typeof exported.erzeugtAm).toBe('string');
    }
  });

  it('nimmt die Begruendung fehlender Angaben mit -- sie gehoert zur Aussage', () => {
    const exported = buildDocumentationExport(mapToDocumentation(data({}), null), EPC);
    const einbau = exported.kategorien.find((c) => c.id === 'installation');
    const abnahme = einbau?.merkmale.find((f) => f.id === 'I-92');

    expect(abnahme?.wert).toBeNull();
    expect(abnahme?.verfuegbarkeit).toBe('unsupported');
    expect(abnahme?.hinweis).toBe(
      'Keine Bauwerksdokumentation/ kein Abnahmeprotokoll vorliegend.',
    );
  });

  it('schreibt die allgemeinen Angaben nur einmal, obwohl der Mapper sie doppelt fuehrt', () => {
    // documentationMapper haelt `general` zusaetzlich als categories[0].
    const exported = buildDocumentationExport(mapToDocumentation(data({}), null), EPC);
    const ids = exported.kategorien.flatMap((c) => c.merkmale.map((f) => f.id));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('meldet die Abdeckung so, wie die Ansicht sie zeigt', () => {
    const view = mapToDeconstruction(data({}), null);
    const exported = buildDeconstructionExport(view, EPC);

    expect(exported.abdeckung).toEqual({
      belegt: view.coverage.filled,
      gesamt: view.coverage.total,
    });
  });
});

describe('JSON-Export — Herkunftsnachweis', () => {
  const provenance: ProvenanceData = {
    tradeName: 'X-LAM C24 Brettsperrholz nach ETA11/0189',
    description: 'X-LAM als tragendes Element in Gebäuden',
    volumeM3: '5.22',
    pieces: null,
    speciesGerman: 'Fichte',
    speciesBotanical: 'Picea abies',
    maturityYear: '2025',
    productKind: 'Brettsperrholz',
    hsCode: '4412',
    fellingCoordinates: { lat: 51.45147, lng: 7.9977 },
    fellingDate: '14.07.2026',
    fellingCountry: 'Deutschland',
    fellingState: 'Nordrhein-Westfalen',
    certifications: ['PEFC'],
    actors: [
      {
        id: 'sawmill',
        kind: 'sawmill',
        name: 'Egger Sägewerk Brilon GmbH',
        address: 'Im Kissen 19, 59929',
        reference: 'Polter-Nr. 7',
        transportDate: '20.07.2026',
        coordinates: { lat: 51.4, lng: 8.57 },
        coordinateSource: 'geocoded',
      },
    ],
    buyerName: 'Holzbau Sauerland GmbH',
    buyerAddress: 'Industriestraße 7, 59821 Arnsberg',
  };

  it('bringt die flachen Merkmale in dasselbe Kategorienformat', () => {
    const exported = buildOriginExport(provenance, EPC);
    const general = exported.kategorien.find((c) => c.id === 'general');

    expect(general?.merkmale.find((f) => f.id === 'I-1')?.wert).toBe(
      'X-LAM C24 Brettsperrholz nach ETA11/0189',
    );
    expect(
      exported.kategorien.find((c) => c.id === 'felling')?.merkmale.find((f) => f.id === 'I-12')
        ?.wert,
    ).toBe('14.07.2026');
  });

  it('haelt bei Akteuren fest, ob die Koordinate gemessen oder geschaetzt ist', () => {
    const exported = buildOriginExport(provenance, EPC);
    const actors = exported.akteure as Array<Record<string, unknown>>;
    const coords = actors[0].koordinaten as Record<string, unknown>;

    expect(actors[0].name).toBe('Egger Sägewerk Brilon GmbH');
    // Ohne diesen Marker koennte ein Empfaenger eine genaeherte Position
    // fuer eine gemessene halten.
    expect(coords.herkunft).toBe('geocoded');
    expect(coords.lon).toBe(8.57);
  });

  it('kennzeichnet fehlende Merkmale statt sie wegzulassen', () => {
    const exported = buildOriginExport(provenance, EPC);
    const pieces = exported.kategorien
      .flatMap((c) => c.merkmale)
      .find((f) => f.id === 'I-4');

    expect(pieces?.wert).toBeNull();
    expect(pieces?.verfuegbarkeit).toBe('missing');
  });
});
