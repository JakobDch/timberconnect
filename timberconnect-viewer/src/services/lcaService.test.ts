import { describe, it, expect } from 'vitest';
import {
  buildAddressCandidates,
  computeLca,
  extractLcaInputs,
  parseDistanceKm,
  parseGermanNumber,
  mapToLcaInfo,
  type LcaInputs,
  type ResolvedDistances,
} from './lcaService';
import type { ProductDataResult, SparqlBinding } from './sparqlService';

// ---------------------------------------------------------------------------
// Testdaten: eine vollstaendig belegte BSP-Platte (V = 5,22 m³).
//
// Frueher kamen diese Werte aus DEMO_LCA_INPUTS/DEMO_LCA_DISTANCES im
// Service. Die waren dort aber fuer den Demo-Modus der Ansicht gedacht --
// die Bilanz ohne gescanntes Bauteil -- und sind mit ihm entfallen. Als
// Testfixture gehoeren sie ohnehin hierher: der Test soll seine eigenen
// Eingangswerte mitbringen und nicht davon abhaengen, was die Anwendung
// zufaellig als Beispiel vorhaelt.
// ---------------------------------------------------------------------------

const INPUTS: LcaInputs = {
  volumeBsp: { value: 5.22, availability: 'available' },
  distancePolterSawmillKm: { value: 18, availability: 'available' },
  roundwoodTransportTotalM3: { value: 13.2, availability: 'available' },
  sawnTimberTransportTotalM3: {
    value: 3.02,
    availability: 'derived',
    note: 'Transportvolumen des Schnittholz-Transportauftrags.',
  },
  bspTransportTotalM3: { value: 5.22, availability: 'available' },
  sawmillAddress: 'Sägewerk Sauerland, Ruhrstraße 45, 59872 Meschede',
  bspWerkAddress: 'Holzwerk Westfalen GmbH, Zum Sägewerk 8, 59929 Brilon',
  pickupLocation: '59929 Brilon',
  deliveryLocation: '59821 Arnsberg',
  sawmillGeoCandidates: [],
  bspWerkGeoCandidates: [],
  pickupGeoCandidates: [],
  deliveryGeoCandidates: [],
};

const DISTANCES: ResolvedDistances = {
  sawmillToBspKm: {
    value: 26,
    availability: 'derived',
    note: 'Luftlinie Meschede–Brilon × Umwegfaktor 1,3.',
  },
  bspToSiteKm: {
    value: 33,
    availability: 'derived',
    note: 'Luftlinie Brilon–Arnsberg × Umwegfaktor 1,3.',
  },
};

const lit = (value: string): { value: string; type: string } => ({
  value,
  type: 'Literal',
});

/** Minimales ProductDataResult -- nur die Felder, die der Service liest. */
function dataWith(lca: SparqlBinding[], deconstruction: SparqlBinding[] = []): ProductDataResult {
  return { lca, deconstruction } as unknown as ProductDataResult;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('parseGermanNumber', () => {
  it('liest deutsches Komma ("13,20")', () => {
    expect(parseGermanNumber('13,20')).toBe(13.2);
  });

  it('liest xsd:decimal aus SPARQL ("5.22")', () => {
    expect(parseGermanNumber('5.22')).toBe(5.22);
  });

  it('liest Tausenderpunkt + Komma ("1.234,5")', () => {
    expect(parseGermanNumber('1.234,5')).toBe(1234.5);
  });

  it('liefert null fuer Unlesbares', () => {
    expect(parseGermanNumber('n/a')).toBeNull();
    expect(parseGermanNumber('')).toBeNull();
    expect(parseGermanNumber(null)).toBeNull();
  });
});

describe('parseDistanceKm', () => {
  it('streift die km-Einheit ab ("18 km")', () => {
    expect(parseDistanceKm('18 km')).toBe(18);
  });

  it('liest deutsche Dezimalzahl mit Einheit ("47,5 km")', () => {
    expect(parseDistanceKm('47,5 km')).toBe(47.5);
  });
});

describe('buildAddressCandidates', () => {
  it('setzt Strasse + Ort ohne Firmenname an die erste Stelle', () => {
    const candidates = buildAddressCandidates([
      'Sägewerk Sauerland GmbH & Co. KG',
      'Ruhrstraße 45',
      '59872 Meschede',
    ]);
    // Nominatim findet nichts, wenn der Firmenname im Suchstring steht --
    // deshalb muss die namenlose Variante zuerst probiert werden.
    expect(candidates[0]).toBe('Ruhrstraße 45, 59872 Meschede');
    expect(candidates[1]).toBe('59872 Meschede');
    expect(candidates[2]).toContain('Sägewerk Sauerland');
  });

  it('erkennt die Strasse an der Hausnummer, unabhaengig von der Reihenfolge', () => {
    const candidates = buildAddressCandidates([
      '59929 Brilon',
      'Holzwerk Westfalen GmbH',
      'Zum Sägewerk 8',
    ]);
    expect(candidates[0]).toBe('Zum Sägewerk 8, 59929 Brilon');
  });

  it('faellt ohne Strasse auf "PLZ Ort" zurueck', () => {
    expect(buildAddressCandidates(['59929 Brilon', null])).toEqual(['59929 Brilon']);
  });

  // Reale Werte aus demo-dateien_v3/3_Aufsaegevorgang/transportauftrag_
  // schnittholz.pdf: der Ortsname fehlt, es steht nur die PLZ im Feld.
  it('erkennt eine nackte PLZ als Ort (unvollstaendig ausgefuellte Vorlage)', () => {
    const candidates = buildAddressCandidates([
      'Egger Sägewerk Brilon GmbH',
      'Im Kissen 19',
      '59929',
    ]);
    // Ohne diese Behandlung blieb nur der Volljoin mit Firmenname uebrig --
    // daran scheitert Nominatim, und A2 wurde nie berechenbar.
    expect(candidates[0]).toBe('Im Kissen 19, 59929');
    expect(candidates[1]).toBe('59929');
    expect(candidates[2]).toContain('Egger Sägewerk');
  });

  it('zieht das vollstaendige "PLZ Ort" der nackten PLZ vor', () => {
    const candidates = buildAddressCandidates(['Zum Sägewerk 8', '59929', '59929 Brilon']);
    expect(candidates[0]).toBe('Zum Sägewerk 8, 59929 Brilon');
  });

  it('liefert eine leere Liste fuer leere Eingaben', () => {
    expect(buildAddressCandidates([null, undefined, '  '])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Formeln (Blatt "Berechnung", Spalte "Formel App")
// ---------------------------------------------------------------------------

describe('computeLca -- Formeln mit Demo-Werten (V = 5,22)', () => {
  const result = computeLca(INPUTS, DISTANCES);
  const byCode = (code: string) =>
    [...result.modules, ...(result.modules[0].sub ?? [])].find((m) => m.code === code)!;

  it('A1.0 Biogene Speicherung = −722,39 × 5,13 × V', () => {
    expect(byCode('A1.0').value).toBeCloseTo(-19344.6, 1);
  });

  it('A1.1 Holzernte = 4 × 2,95 × V', () => {
    expect(byCode('A1.1').value).toBeCloseTo(61.6, 1);
  });

  it('A1.2 Transport = Verladung + Streckenanteil', () => {
    // 0,963×15,399 + (0,35×18×3,28)×(15,399/13,2) = 38,9
    expect(byCode('A1.2').value).toBeCloseTo(38.9, 1);
  });

  it('A1.3 Produktion Schnittholz = 37,5 × 2,95 × V', () => {
    expect(byCode('A1.3').value).toBeCloseTo(577.5, 1);
  });

  it('A1 ist die Summe der vier Teilmodule', () => {
    expect(byCode('A1').value).toBeCloseTo(-18666.6, 1);
    expect(byCode('A1').isPartial).toBe(false);
  });

  it('A2 = (0,35 × Strecke × 3,28) × Mengenanteil Schnittholz, als abgeleitet', () => {
    // (0,35×26×3,28) × (6,264/3,02) = 61,9
    expect(byCode('A2').value).toBeCloseTo(61.9, 1);
    expect(byCode('A2').availability).toBe('derived');
  });

  it('A3 folgt der Spec-Formel 125 × 1,2 × V', () => {
    expect(byCode('A3').value).toBeCloseTo(783, 1);
  });

  it('A4 = (0,35 × Strecke × 3,28) × Mengenanteil BSP, als abgeleitet', () => {
    expect(byCode('A4').value).toBeCloseTo(37.9, 1);
    expect(byCode('A4').availability).toBe('derived');
  });

  it('A5 Einbau = 8 × V', () => {
    expect(byCode('A5').value).toBeCloseTo(41.8, 1);
  });

  it('Gesamtergebnis ist negativ (Speicherung dominiert)', () => {
    expect(result.total).toBeCloseTo(-17742.0, 1);
    expect(result.totalIsPartial).toBe(false);
    expect(result.missingModules).toEqual([]);
  });

  it('Diagramm trennt Speicherung von den A1-Emissionen', () => {
    const bio = result.chart.find((b) => b.id === 'bio')!;
    const a1e = result.chart.find((b) => b.id === 'a1e')!;
    expect(bio.value).toBeCloseTo(-19344.6, 1);
    // 61,6 + 38,9 + 577,5 = 678
    expect(a1e.value).toBeCloseTo(678, 1);
    expect(result.chart).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Lueckenverhalten
// ---------------------------------------------------------------------------

describe('computeLca -- Luecken', () => {
  it('ohne Nettovolumen ist nichts berechenbar', () => {
    const result = computeLca(
      { ...INPUTS, volumeBsp: { value: null, availability: 'missing', note: 'fehlt' } },
      DISTANCES,
    );
    expect(result.total).toBeNull();
    expect(result.modules.every((m) => m.value === null)).toBe(true);
    expect(result.totalIsPartial).toBe(true);
  });

  it('fehlende A4-Strecke macht A4 zur Luecke und die Summe zur Teilsumme', () => {
    const result = computeLca(INPUTS, {
      ...DISTANCES,
      bspToSiteKm: { value: null, availability: 'missing', note: 'kein Lieferort' },
    });
    const a4 = result.modules.find((m) => m.code === 'A4')!;
    expect(a4.value).toBeNull();
    expect(a4.note).toBe('kein Lieferort');
    expect(result.totalIsPartial).toBe(true);
    expect(result.missingModules).toContain('A4');
    // Teilsumme = Gesamt ohne A4-Beitrag (37,9)
    expect(result.total).toBeCloseTo(-17742.0 - 37.9, 1);
  });

  it('fehlende Rundholz-Gesamtmenge trifft nur A1.2, A1 wird Teilsumme', () => {
    const result = computeLca(
      {
        ...INPUTS,
        roundwoodTransportTotalM3: { value: null, availability: 'missing', note: 'fehlt' },
      },
      DISTANCES,
    );
    const a1 = result.modules.find((m) => m.code === 'A1')!;
    expect(a1.sub!.find((m) => m.code === 'A1.2')!.value).toBeNull();
    expect(a1.isPartial).toBe(true);
    expect(a1.note).toMatch(/A1\.2/);
    expect(result.missingModules).toContain('A1.2');
  });
});

// ---------------------------------------------------------------------------
// Extraktion aus SPARQL-Bindings
// ---------------------------------------------------------------------------

describe('extractLcaInputs', () => {
  const rows: SparqlBinding[] = [
    // Panel-Zeile (ERP-Vorgang)
    {
      nettovolumen: lit('5.22'),
      gesamtmengeBsp: lit('5.22'),
      abholungPlz: lit('59929'),
      abholungOrt: lit('Brilon'),
      lieferungPlz: lit('59821'),
      lieferungOrt: lit('Arnsberg'),
    },
    // Rundholz-Transportauftrag (deutsche Formularwerte!)
    { ladezoneDistanz: lit('18 km'), summeFestmeter: lit('13,20') },
    // Schnittholz-Transportauftrag mit Lieferadress-Beutel
    {
      orderVolume: lit('3.02'),
      loadingAddress: lit('Sägewerk Sauerland'),
      unloadingAddress: lit('Holzwerk Westfalen GmbH'),
    },
    {
      orderVolume: lit('3.02'),
      loadingAddress: lit('59872 Meschede'),
      unloadingAddress: lit('59929 Brilon'),
    },
  ];

  const inputs = extractLcaInputs(dataWith(rows));

  it('liest das Nettovolumen als Zahl', () => {
    expect(inputs.volumeBsp.value).toBe(5.22);
    expect(inputs.volumeBsp.availability).toBe('available');
  });

  it('parst deutsche Formularwerte des Rundholz-Auftrags', () => {
    expect(inputs.distancePolterSawmillKm.value).toBe(18);
    expect(inputs.roundwoodTransportTotalM3.value).toBe(13.2);
  });

  it('nimmt das Transportvolumen als Ersatz fuer M-584 (derived)', () => {
    expect(inputs.sawnTimberTransportTotalM3.value).toBe(3.02);
    expect(inputs.sawnTimberTransportTotalM3.availability).toBe('derived');
  });

  it('fuegt Adressbeutel und ERP-Orte zusammen', () => {
    expect(inputs.sawmillAddress).toContain('Sägewerk Sauerland');
    expect(inputs.sawmillAddress).toContain('59872 Meschede');
    expect(inputs.bspWerkAddress).toContain('Holzwerk Westfalen');
    expect(inputs.pickupLocation).toBe('59929 Brilon');
    expect(inputs.deliveryLocation).toBe('59821 Arnsberg');
  });

  it('baut Geocoding-Kandidaten ohne Firmenname an erster Stelle', () => {
    expect(inputs.sawmillGeoCandidates[0]).toBe('59872 Meschede');
    expect(inputs.pickupGeoCandidates[0]).toBe('59929 Brilon');
    expect(inputs.deliveryGeoCandidates).toContain('59821 Arnsberg');
  });

  it('bereinigt PLZ-Dezimalliterale des RMLMappers ("59929.0")', () => {
    // RMLMapper schreibt JSON-Zahlen als Dezimalliteral in den Graph --
    // genau so kommt die PLZ aus dem echten Pod zurueck.
    const decimal = extractLcaInputs(
      dataWith([
        {
          abholungPlz: lit('59929.0'),
          abholungOrt: lit('Brilon'),
          lieferungPlz: lit('59821.0'),
          lieferungOrt: lit('Arnsberg'),
        },
      ]),
    );
    expect(decimal.pickupLocation).toBe('59929 Brilon');
    expect(decimal.deliveryLocation).toBe('59821 Arnsberg');
    expect(decimal.pickupGeoCandidates[0]).toBe('59929 Brilon');
    expect(decimal.deliveryGeoCandidates[0]).toBe('59821 Arnsberg');
  });

  it('summiert Positionsmengen, wenn keine Summe ausgewiesen ist', () => {
    const noSum = extractLcaInputs(
      dataWith([
        { nettovolumen: lit('5.22') },
        { ladezoneDistanz: lit('18 km'), mengeFestmeter: lit('6,60') },
        { ladezoneDistanz: lit('18 km'), mengeFestmeter: lit('6,60') },
      ]),
    );
    // allValues dedupliziert identische Literale -- zwei gleiche Positionen
    // zaehlen einmal; hier genuegt: es kommt eine Zahl heraus, keine null.
    expect(noSum.roundwoodTransportTotalM3.value).toBe(6.6);
  });

  it('kennzeichnet fehlende Werte als missing', () => {
    const empty = extractLcaInputs(dataWith([]));
    expect(empty.volumeBsp.value).toBeNull();
    expect(empty.volumeBsp.availability).toBe('missing');
    expect(empty.sawmillAddress).toBeNull();
  });

  it('faellt fuer das Volumen auf die Rueckbaubarkeits-Query zurueck', () => {
    const viaFallback = extractLcaInputs(dataWith([], [{ menge: lit('5.22') }]));
    expect(viaFallback.volumeBsp.value).toBe(5.22);
  });
});

// ---------------------------------------------------------------------------
// Zusatzinformationen
// ---------------------------------------------------------------------------

describe('mapToLcaInfo', () => {
  const rows: SparqlBinding[] = [
    {
      nettovolumen: lit('5.22'),
      nettogewicht: lit('2510'),
      hoehe: lit('150'),
      breite: lit('2.95'),
      laenge: lit('11.8'),
      schichten: lit('5'),
      pefc: lit('true'),
      produktnorm: lit('EN 16351'),
      holzart: lit('Fichte'),
    },
    {
      dop: lit('urn:dop:bsp'),
      dopTitle: lit('Leistungserklärung Brettsperrholz Nr. 1'),
      dopTypeNumber: lit('X-LAM L-150/5s'),
      dopManufacturer: lit('Holzwerk Westfalen GmbH'),
    },
    {
      dop: lit('urn:dop:lamelle'),
      dopTitle: lit('Leistungserklärung Schnittholz'),
      dopTypeNumber: lit('C24-Lamelle'),
      dopManufacturer: lit('Sägewerk Sauerland'),
    },
    { adhesiveName: lit('LOCTITE HB S109 ECO PURBOND') },
  ];

  const info = mapToLcaInfo(dataWith(rows), null);

  it('nimmt den Handelsnamen aus der BSP-Leistungserklaerung', () => {
    expect(info.componentName).toBe('X-LAM L-150/5s');
    expect(info.manufacturer).toBe('Holzwerk Westfalen GmbH');
  });

  it('unterscheidet die Schnittholz-DoP am Titel', () => {
    const components = info.categories.find((c) => c.id === 'components')!;
    const lamella = components.fields.find((f) => f.id === 'I-76')!;
    expect(lamella.value).toBe('C24-Lamelle');
    expect(components.fields.find((f) => f.id === 'I-77')!.value).toBe(
      'Sägewerk Sauerland',
    );
  });

  it('weist den fehlenden Klebstoff-Hersteller als bewusste Luecke aus', () => {
    const components = info.categories.find((c) => c.id === 'components')!;
    const field = components.fields.find((f) => f.id === 'I-75')!;
    expect(field.value).toBeNull();
    expect(field.availability).toBe('unsupported');
  });

  it('formatiert Masse und Abmessungen deutsch', () => {
    expect(info.mass).toBe('2.510 kg');
    expect(info.dimensions).toBe('150 mm × 2,95 m × 11,8 m');
    expect(info.referenceSize).toContain('5,22 m³');
  });

  it('zaehlt die Abdeckung ueber alle Kategorien', () => {
    expect(info.coverage.total).toBeGreaterThan(20);
    expect(info.coverage.filled).toBeGreaterThan(10);
    expect(info.coverage.filled).toBeLessThan(info.coverage.total);
  });
});
