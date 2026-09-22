import { describe, it, expect } from 'vitest';
import { Parser } from 'sparqljs';
import { mapToLiability, companyPrefixOf, LIABILITY_GAPS } from './liabilityMapper';
import { createLiabilityQuery } from './sparqlQueries';
import type { ProductDataResult, SparqlBinding } from './sparqlService';

const lit = (value: string): { value: string; type: string } => ({
  value,
  type: 'Literal',
});

const iri = (value: string): { value: string; type: string } => ({
  value,
  type: 'IRI',
});

/** Minimales ProductDataResult -- nur die Felder, die der Mapper liest. */
function dataWith(
  liability: SparqlBinding[] = [],
  deconstruction: SparqlBinding[] = [],
  epcisEvents: unknown[] = [],
): ProductDataResult {
  return { liability, deconstruction, epcisEvents } as unknown as ProductDataResult;
}

/** Zeile der Biegepruefung, wie sie pdf_biegepruefung.rml.ttl erzeugt. */
const TEST_REPORT_ROW: SparqlBinding = {
  report: iri('http://timberconnect.2050.de/resource/bendingtest/abc'),
  tester: lit('M. Beispiel'),
  testDateTime: lit('2026-03-02T10:15:00'),
} as unknown as SparqlBinding;

const SAMPLE_ROW: SparqlBinding = {
  sample: iri('http://timberconnect.2050.de/resource/bendingtest/abc/probe/1'),
  sampleId: lit('P-001'),
} as unknown as SparqlBinding;

/** Leistungserklaerung Schnittholz -- erkennbar an der Zertifikatsnummer. */
const SAWN_DOP_ROW: SparqlBinding = {
  dop: iri('http://timberconnect.2050.de/resource/dop/schnittholz'),
  zertifikatsnummer: lit('0123-CPR-4711'),
  conformitySystem: lit('System 2+'),
  notifiedBody: lit('MPA Stuttgart'),
  dopDensity: lit('420'),
  dopBendingStrength: lit('24'),
} as unknown as SparqlBinding;

/** Leistungserklaerung BSP -- erkennbar am Feuchtegehalt. */
const BSP_DOP_ROW: SparqlBinding = {
  bspDop: iri('http://timberconnect.2050.de/resource/dop/bsp'),
  moistureContent: lit('12'),
  delamination: lit('bestanden'),
  bendingFlatwise: lit('24'),
  rollingShear: lit('1.1'),
  bspStrengthClass: lit('C24'),
} as unknown as SparqlBinding;

const ADHESIVE_ROW: SparqlBinding = {
  adhesive: iri('http://timberconnect.2050.de/resource/adhesive/x'),
  adhesiveProductName: lit('Loctite HB S309'),
  curingType: lit('Feuchtigkeitshärtend'),
  storageConditions: lit('trocken, 15–25 °C'),
  safetyNote: lit('Keine Haftung bei Verarbeitung außerhalb der Spezifikation.'),
} as unknown as SparqlBinding;

const PANEL_ROW: SparqlBinding = {
  panel: iri('http://timberconnect.2050.de/resource/panel/1'),
  mitarbeiter: lit('K. Muster'),
  qsKontrolle: lit('ja'),
} as unknown as SparqlBinding;

/** Zeile der Rueckbaubarkeits-Query (Hersteller + Anschrift). */
const DECON_ROW: SparqlBinding = {
  dopTypeNumber: lit('X-LAM L-150/5s'),
  dopManufacturer: lit('Holzwerk Muster GmbH'),
  dopAddress: lit('Sägewerkstraße 1'),
  dopIntendedUse: lit('Tragende Anwendung im Hochbau'),
} as unknown as SparqlBinding;

describe('createLiabilityQuery', () => {
  it('ist syntaktisch gueltiges SPARQL', () => {
    // Ein Syntaxfehler faellt sonst erst im Browser auf -- und dort still,
    // weil die Abfrage im Promise.all-Batch abgefangen wird und die Ansicht
    // einfach leer bliebe.
    const parsed = new Parser().parse(createLiabilityQuery()) as { variables: unknown[] };
    expect(parsed.variables.length).toBeGreaterThan(30);
  });

  it('liest die Praedikate, die bis hierher keine Query angefasst hat', () => {
    // Das ist der Kernbefund des Anwendungsfalls: die RML-Mappings schreiben
    // diese Werte laengst in den Pod, gelesen hat sie nie jemand. Faellt eines
    // wieder heraus, ist der Haftungsnachweis an dieser Stelle blind.
    const query = createLiabilityQuery();
    for (const predicate of [
      'tc:bendingStrength',
      'tc:density',
      'tc:testerName',
      'tc:sampleId',
      'tc:conformitySystem',
      'tc:notifiedBody',
      'tc:curingType',
      'tc:storageConditions',
      'tc:zustaendiger_Mitarbeiter',
      'tc:qS_Kontrolle',
      'tc:moistureContent',
      'tc:delaminationResistance',
      'tc:rollingShearStrength',
    ]) {
      expect(query, `${predicate} fehlt in der Abfrage`).toContain(predicate);
    }
  });
});

describe('companyPrefixOf', () => {
  it('liest den Prefix aus SGTIN, LGTIN und SGLN', () => {
    expect(companyPrefixOf('urn:epc:id:sgtin:404711148.0401.143138262901')).toBe('404711148');
    expect(companyPrefixOf('urn:epc:class:lgtin:404711145.0001.Pflanzung01')).toBe('404711145');
    expect(companyPrefixOf('urn:epc:id:sgln:404711146.00000.201')).toBe('404711146');
  });

  it('kommt mit abweichender Prefix-Laenge zurecht', () => {
    // Der GCP ist 4 bis 12 Ziffern lang -- ein fester Schnitt auf die Laenge
    // der Beispieldaten (9) wuerde bei jedem anderen Teilnehmer den falschen
    // Akteur ausweisen.
    expect(companyPrefixOf('urn:epc:id:sgtin:4012345.012345.LOT2026')).toBe('4012345');
    expect(companyPrefixOf('urn:epc:id:sgtin:123456789012.01.1')).toBe('123456789012');
  });

  it('liefert null fuer Unbrauchbares', () => {
    expect(companyPrefixOf(null)).toBeNull();
    expect(companyPrefixOf('')).toBeNull();
    expect(companyPrefixOf('HB-2026-0047')).toBeNull();
    // Ohne Punkt ist der Prefix nicht abgrenzbar.
    expect(companyPrefixOf('urn:epc:id:sgtin:404711148')).toBeNull();
  });
});

describe('Akteurszuordnung ueber den Company Prefix', () => {
  /**
   * Die reale Kette: drei Transformationen mit drei verschiedenen GCPs --
   * Forstbetrieb 404711145, Saegewerk 404711146, Holzwerkstoffproduzent
   * 404711148 (Nummernkreise aus den Beispieldaten).
   */
  const CHAIN = [
    {
      type: 'TransformationEvent',
      eventTime: '2026-08-02T08:00:00+02:00',
      inputQuantityList: [
        { epcClass: 'urn:epc:class:lgtin:404711145.0001.Pflanzung01', quantity: 1 },
      ],
      outputEPCList: ['urn:epc:id:sgtin:404711145.0100.12A3D4567'],
    },
    {
      type: 'TransformationEvent',
      eventTime: '2026-08-02T14:34:34+02:00',
      inputEPCList: ['urn:epc:id:sgtin:404711145.0100.12A3D4567'],
      outputEPCList: [
        'urn:epc:id:sgtin:404711146.0212.120231002917',
        'urn:epc:id:sgtin:404711146.0212.186323687879',
      ],
    },
    {
      type: 'TransformationEvent',
      eventTime: '2026-08-03T09:00:00+02:00',
      inputEPCList: ['urn:epc:id:sgtin:404711146.0212.120231002917'],
      outputEPCList: ['urn:epc:id:sgtin:404711148.0401.143138262901'],
    },
  ];

  it('weist jeder Stufe den Prefix ihrer eigenen Idente zu', () => {
    const result = mapToLiability(dataWith([], [], CHAIN), null);
    const prefixOf = (id: string) =>
      result.categories.find((c) => c.id === id)!.companyPrefix;

    expect(prefixOf('origin')).toBe('404711145');
    expect(prefixOf('sawmill')).toBe('404711146');
    expect(prefixOf('production')).toBe('404711148');
  });

  it('haelt Rundhoelzer und Lamellen auseinander (I-2 vs. I-5)', () => {
    // Frueher sammelte der Mapper outputEPCList ueber ALLE Transformationen
    // in eine Liste -- damit trugen Rundholz- und Lamellenstufe dieselben
    // Idente und die Akteurszuordnung waere in beiden Faellen falsch.
    const result = mapToLiability(dataWith([], [], CHAIN), null);
    const logs = result.categories.find((c) => c.id === 'origin')!
      .fields.find((f) => f.id === 'I-2')!;
    const lamellae = result.categories.find((c) => c.id === 'sawmill')!
      .fields.find((f) => f.id === 'I-5')!;

    expect(logs.value).toContain('404711145');
    expect(logs.value).not.toContain('404711146');
    expect(lamellae.value).toBe('2 Lamelle(n) erfasst');
  });

  it('nennt den Prefix bei I-3 und I-6, ohne sie als belegt zu zaehlen', () => {
    const result = mapToLiability(dataWith([], [], CHAIN), null);
    const forest = result.categories.find((c) => c.id === 'origin')!
      .fields.find((f) => f.id === 'I-3')!;
    const sawmill = result.categories.find((c) => c.id === 'sawmill')!
      .fields.find((f) => f.id === 'I-6')!;

    // Der GCP ist bekannt und wird genannt ...
    expect(forest.value).toBe('GCP 404711145');
    expect(sawmill.value).toBe('GCP 404711146');
    expect(forest.note).toContain('404711145');
    // ... die Ausfuehrung bleibt aber unbelegt.
    expect(forest.availability).toBe('assumed');
    expect(sawmill.availability).toBe('assumed');
    expect(forest.note).toContain('bizLocation');
  });

  it('bleibt ohne Idente bei der reinen Annahme', () => {
    const result = mapToLiability(dataWith(), null);
    const forest = result.categories.find((c) => c.id === 'origin')!
      .fields.find((f) => f.id === 'I-3')!;

    expect(result.categories.find((c) => c.id === 'origin')!.companyPrefix).toBeNull();
    expect(forest.value).toBeNull();
    expect(forest.note).toContain('kein Ident');
  });

  it('laesst die Logistikstufe ohne Prefix -- sie erzeugt keine Idente', () => {
    const result = mapToLiability(dataWith([], [], CHAIN), null);
    expect(result.categories.find((c) => c.id === 'logistics')!.companyPrefix).toBeNull();
  });

  it('laesst sich von einem einzelnen Fremd-Ident nicht kippen', () => {
    const events = [
      {
        type: 'TransformationEvent',
        outputEPCList: [
          'urn:epc:id:sgtin:404711146.0212.1',
          'urn:epc:id:sgtin:404711146.0212.2',
          'urn:epc:id:sgtin:999999999.0001.zugekauft',
        ],
      },
    ];
    const result = mapToLiability(dataWith([], [], events), null);
    expect(result.categories.find((c) => c.id === 'origin')!.companyPrefix).toBe('404711146');
  });
});

describe('Geltungsbereich der Pruefung (I-13a)', () => {
  const LAMELLA_A = 'urn:epc:id:sgtin:404711146.0212.120231002917';
  const LAMELLA_B = 'urn:epc:id:sgtin:404711146.0212.186323687879';

  /** Aufsaegevorgang mit zwei Lamellen als Ausgang. */
  const SAW_EVENT = [
    { type: 'TransformationEvent', outputEPCList: ['urn:epc:id:sgtin:404711145.0100.1'] },
    { type: 'TransformationEvent', outputEPCList: [LAMELLA_A, LAMELLA_B] },
  ];

  const reportFor = (...epcs: string[]): SparqlBinding[] =>
    epcs.map(
      (epc) =>
        ({
          report: iri('http://timberconnect.2050.de/resource/bendingtest/abc'),
          reportEpc: iri(epc),
        }) as unknown as SparqlBinding,
    );

  const scopeOf = (rows: SparqlBinding[], events: unknown[]) =>
    mapToLiability(dataWith(rows, [], events), null)
      .categories.find((c) => c.id === 'sawmill')!
      .fields.find((f) => f.id === 'I-13a')!;

  it('belegt die Zuordnung, wenn geprueftes Material zum Bauteil gehoert', () => {
    const scope = scopeOf(reportFor(LAMELLA_A, LAMELLA_B), SAW_EVENT);
    expect(scope.availability).toBe('available');
    expect(scope.value).toBe('2 Lamelle(n) abgedeckt, davon 2 in diesem Bauteil');
    expect(scope.note).toContain('instanzscharf');
  });

  it('warnt, wenn der Pruefbericht anderes Material betrifft', () => {
    // Der gefaehrlichste Fall: es LIEGT ein Pruefbericht vor, er sagt ueber
    // dieses Bauteil aber nichts aus. Das darf nicht wie ein Beleg aussehen.
    const scope = scopeOf(reportFor('urn:epc:id:sgtin:404711146.0212.999'), SAW_EVENT);
    expect(scope.availability).toBe('available');
    expect(scope.note).toContain('Achtung');
    expect(scope.note).toContain('belegt die Eigenschaften dieses Bauteils daher nicht');
  });

  it('bleibt vorsichtig, wenn die Lamellen des Bauteils unbekannt sind', () => {
    const scope = scopeOf(reportFor(LAMELLA_A), []);
    expect(scope.value).toBe('1 Lamelle(n) abgedeckt');
    expect(scope.note).toContain('nicht abgleichen');
  });

  it('meldet eine echte Luecke, wenn kein Materialbezug vorliegt', () => {
    const scope = scopeOf([], SAW_EVENT);
    expect(scope.availability).toBe('missing');
    expect(scope.value).toBeNull();
  });
});

describe('mapToLiability', () => {
  it('liefert ohne Daten alle fuenf Kategorien und keine Belegung', () => {
    const result = mapToLiability(null, null);

    expect(result.categories).toHaveLength(5);
    expect(result.categories.map((c) => c.id)).toEqual([
      'origin',
      'sawmill',
      'adhesive',
      'production',
      'logistics',
    ]);
    expect(result.coverage.filled).toBe(0);
    expect(result.coverage.total).toBeGreaterThan(40);
    expect(result.damageReports).toEqual([]);
  });

  it('weist die Informationsluecken immer aus', () => {
    // Die Luecken sind Ergebnis der fachlichen Analyse, nicht der Daten --
    // sie duerfen deshalb auch bei vollstaendigen Daten nicht verschwinden.
    const empty = mapToLiability(null, null);
    const filled = mapToLiability(
      dataWith([SAWN_DOP_ROW, BSP_DOP_ROW, ADHESIVE_ROW, PANEL_ROW], [DECON_ROW]),
      null,
    );

    expect(empty.gaps).toHaveLength(4);
    expect(filled.gaps).toEqual(LIABILITY_GAPS);
  });

  it('fuehrt die Chargenverknuepfung NICHT als Luecke', () => {
    // Das Blatt "Begruendung_und_Luecken" nennt sie als fuenfte Luecke, sie
    // beschreibt aber die Papierwelt: die Vorlage der Biegepruefung verlangt
    // den Materialbezug als Pflichtfeld, und materialEpc ist eine Liste. Eine
    // geloeste Luecke stehen zu lassen wuerde einen moeglichen Regress als
    // aussichtslos darstellen.
    // Gemeint ist die Verknuepfung Stichprobe -> Lamelle. Die Klebstoffcharge
    // bleibt eine echte Luecke und darf hier nicht mitgezaehlt werden.
    const sampleGap = LIABILITY_GAPS.find((gap) =>
      /Stichprobe|Losnummer/i.test(gap.title),
    );
    expect(sampleGap).toBeUndefined();
    // Gegenprobe: die Klebstoffcharge steht weiterhin drin.
    expect(LIABILITY_GAPS.some((gap) => /Klebstoffcharge/i.test(gap.title))).toBe(true);
  });

  it('kennzeichnet die Logistikstufe vollstaendig als Annahme', () => {
    // I-41..I-44 haben keine reale Datenquelle (ANN-3..ANN-6). Sie duerfen
    // niemals als "belegt" gelten, auch nicht versehentlich ueber die
    // Abdeckungszaehlung.
    const result = mapToLiability(
      dataWith([SAWN_DOP_ROW, BSP_DOP_ROW, ADHESIVE_ROW, PANEL_ROW], [DECON_ROW]),
      null,
    );
    const logistics = result.categories.find((c) => c.id === 'logistics');

    expect(logistics).toBeDefined();
    expect(logistics!.fields).toHaveLength(4);
    expect(logistics!.fields.every((f) => f.availability === 'assumed')).toBe(true);
    expect(logistics!.fields.every((f) => f.value === null)).toBe(true);
    // Die Begruendung nennt die Annahme, damit sie nicht als Datenluecke
    // missverstanden wird.
    expect(logistics!.fields[0].note).toContain('ANN-3');
    expect(logistics!.fields[3].note).toContain('ANN-6');
  });

  it('weist Akteur und Standort der Vorgaenge als Annahme aus (I-3, I-6)', () => {
    const result = mapToLiability(dataWith([], [DECON_ROW]), null);

    const origin = result.categories.find((c) => c.id === 'origin')!;
    const sawmill = result.categories.find((c) => c.id === 'sawmill')!;

    const forestActor = origin.fields.find((f) => f.id === 'I-3')!;
    const sawmillActor = sawmill.fields.find((f) => f.id === 'I-6')!;

    expect(forestActor.availability).toBe('assumed');
    expect(forestActor.note).toContain('ANN-1');
    expect(sawmillActor.availability).toBe('assumed');
    expect(sawmillActor.note).toContain('ANN-2');
  });

  it('liest die Pruefwerte, die bislang keine Query gelesen hat', () => {
    // Der Kern des Anwendungsfalls: diese Praedikate lagen im Pod, wurden
    // aber von keiner bestehenden Abfrage angefasst.
    const result = mapToLiability(
      dataWith([TEST_REPORT_ROW, SAMPLE_ROW, SAWN_DOP_ROW], [DECON_ROW]),
      null,
    );
    const sawmill = result.categories.find((c) => c.id === 'sawmill')!;
    const byId = (id: string) => sawmill.fields.find((f) => f.id === id)!;

    expect(byId('I-7').value).toBe('0123-CPR-4711');
    expect(byId('I-8').value).toBe('System 2+');
    expect(byId('I-9').value).toBe('MPA Stuttgart');
    expect(byId('I-10').value).toBe('420 kg/m³');
    expect(byId('I-11').value).toBe('24 N/mm²');
    expect(byId('I-13').value).toBe('P-001');
    expect(byId('I-14').value).toBe('M. Beispiel');
    expect(byId('I-14').availability).toBe('available');
  });

  it('liest Klebstoffmerkmale inklusive Haftungsausschluss', () => {
    const result = mapToLiability(dataWith([ADHESIVE_ROW]), null);
    const adhesive = result.categories.find((c) => c.id === 'adhesive')!;
    const byId = (id: string) => adhesive.fields.find((f) => f.id === id)!;

    expect(byId('I-18').value).toBe('Loctite HB S309');
    expect(byId('I-19').value).toBe('Feuchtigkeitshärtend');
    expect(byId('I-20').value).toBe('trocken, 15–25 °C');
    expect(byId('I-21').value).toContain('Keine Haftung');
  });

  // Die folgenden vier Faelle sichern Merkmale ab, die frueher still auf ein
  // NACHBARPRAEDIKAT zurueckfielen. Im Haftungsnachweis ist ein plausibler
  // Ersatzwert schaedlicher als eine sichtbare Luecke: er sieht aus wie ein
  // Beleg. Geprueft wird deshalb jeweils, dass die Luecke Luecke bleibt.

  it('gibt den Klebstoff-Normbezug nicht aus dem Handelsnamen aus (I-37)', () => {
    // BSP-DoP ohne tc:adhesiveType. Beide Handelsnamen-Quellen sind belegt:
    // tc:productName im Datenblatt und tc:name in den Rueckbaudaten -- genau
    // die zwei Werte, auf die I-37 frueher ausgewichen ist.
    const deconWithAdhesiveName = {
      ...DECON_ROW,
      adhesiveName: lit('Purbond HB S309'),
    } as unknown as SparqlBinding;
    const result = mapToLiability(
      dataWith([BSP_DOP_ROW, ADHESIVE_ROW], [deconWithAdhesiveName]),
      null,
    );
    const production = result.categories.find((c) => c.id === 'production')!;
    const field = production.fields.find((f) => f.id === 'I-37')!;

    expect(field.value).toBeNull();
    expect(field.availability).toBe('missing');
    // Kein Handelsname darf an der Stelle des Normbezugs erscheinen.
    expect(field.value ?? '').not.toContain('Loctite');
    expect(field.value ?? '').not.toContain('Purbond');
  });

  it('weist den Klebstoff-Normbezug aus, wenn er vorliegt (I-37)', () => {
    const withType = {
      ...BSP_DOP_ROW,
      bspAdhesiveType: lit('PUR-EN 15425:2017: I90GP 0,3w'),
    } as unknown as SparqlBinding;
    const result = mapToLiability(dataWith([withType, ADHESIVE_ROW], [DECON_ROW]), null);
    const production = result.categories.find((c) => c.id === 'production')!;
    const field = production.fields.find((f) => f.id === 'I-37')!;

    expect(field.value).toBe('PUR-EN 15425:2017: I90GP 0,3w');
    expect(field.availability).toBe('available');
  });

  it('setzt kein Druckdatum an die Stelle des Pruefzeitpunkts (I-15)', () => {
    const printedOnly = {
      report: iri('http://timberconnect.2050.de/resource/bendingtest/abc'),
      tester: lit('M. Beispiel'),
      printedAt: lit('2026-04-30T08:00:00'),
    } as unknown as SparqlBinding;
    const result = mapToLiability(dataWith([printedOnly]), null);
    const sawmill = result.categories.find((c) => c.id === 'sawmill')!;
    const field = sawmill.fields.find((f) => f.id === 'I-15')!;

    expect(field.value).toBeNull();
    expect(field.availability).toBe('missing');
    // Gegenprobe ueber alle Felder der Stufe: das Druckdatum darf nirgends
    // als Pruefangabe erscheinen.
    const values = sawmill.fields.map((f) => f.value ?? '').join(' | ');
    expect(values).not.toContain('2026-04-30');
  });

  it('gibt Verarbeitungshinweise nicht als Haftungsausschluss aus (I-21)', () => {
    const noSafetyNote = {
      adhesive: iri('http://timberconnect.2050.de/resource/adhesive/x'),
      adhesiveProductName: lit('Loctite HB S309'),
      processingNote: lit('Offene Zeit 20 Minuten bei 20 °C einhalten.'),
    } as unknown as SparqlBinding;
    const result = mapToLiability(dataWith([noSafetyNote]), null);
    const adhesive = result.categories.find((c) => c.id === 'adhesive')!;
    const field = adhesive.fields.find((f) => f.id === 'I-21')!;

    expect(field.value).toBeNull();
    expect(field.availability).toBe('missing');
    expect(field.value ?? '').not.toContain('Offene Zeit');
  });

  it('kennzeichnet die ersatzweise Produktbezeichnung als abgeleitet (I-18)', () => {
    // Kein tc:productName im Datenblatt, aber ein tc:name aus dem Rueckbau.
    const withoutProductName = {
      adhesive: iri('http://timberconnect.2050.de/resource/adhesive/x'),
      curingType: lit('Feuchtigkeitshärtend'),
    } as unknown as SparqlBinding;
    const deconWithName = {
      ...DECON_ROW,
      adhesiveName: lit('Purbond HB S309'),
    } as unknown as SparqlBinding;
    const result = mapToLiability(dataWith([withoutProductName], [deconWithName]), null);
    const adhesive = result.categories.find((c) => c.id === 'adhesive')!;
    const field = adhesive.fields.find((f) => f.id === 'I-18')!;

    expect(field.value).toBe('Purbond HB S309');
    expect(field.availability).toBe('derived');
    expect(field.note).toContain('Herstellerbezeichnung');
  });

  it('liest die Verantwortung in der Fertigung (M-984, M-1026)', () => {
    const result = mapToLiability(dataWith([PANEL_ROW, BSP_DOP_ROW], [DECON_ROW]), null);
    const production = result.categories.find((c) => c.id === 'production')!;
    const byId = (id: string) => production.fields.find((f) => f.id === id)!;

    expect(byId('I-24').value).toBe('K. Muster');
    expect(byId('I-25').value).toBe('Ja');
    expect(byId('I-36').value).toBe('12 %');
    expect(byId('I-38').value).toBe('bestanden');
    expect(byId('I-40').value).toBe('1,1 N/mm²');
  });

  it('zerlegt die Herstelleranschrift in Strasse, PLZ, Ort und Land', () => {
    const row = {
      ...DECON_ROW,
      dopAddress: lit('Sägewerkstraße 1'),
    } as unknown as SparqlBinding;
    const second = { dopAddress: lit('83022 Rosenheim') } as unknown as SparqlBinding;
    const third = { dopAddress: lit('Deutschland') } as unknown as SparqlBinding;

    const result = mapToLiability(dataWith([], [row, second, third]), null);
    const production = result.categories.find((c) => c.id === 'production')!;
    const byId = (id: string) => production.fields.find((f) => f.id === id)!;

    expect(byId('I-31').value).toBe('Sägewerkstraße 1');
    expect(byId('I-32').value).toBe('83022');
    expect(byId('I-33').value).toBe('Rosenheim');
    expect(byId('I-34').value).toBe('Deutschland');
  });

  it('weist den Produkttyp-Kenncode als abgeleitet aus (I-27)', () => {
    // I-26 und I-27 liegen im Mapping auf demselben Feld. Beide als
    // eigenstaendigen Nachweis zu zaehlen, waere doppelte Buchfuehrung.
    const result = mapToLiability(dataWith([], [DECON_ROW]), null);
    const production = result.categories.find((c) => c.id === 'production')!;

    expect(production.fields.find((f) => f.id === 'I-26')!.availability).toBe('available');
    expect(production.fields.find((f) => f.id === 'I-27')!.availability).toBe('derived');
  });

  it('liest Ereigniszeitpunkte und Idente aus den EPCIS-Events', () => {
    const events = [
      {
        type: 'TransformationEvent',
        eventTime: '2026-08-02T14:34:34+02:00',
        inputQuantityList: [
          { epcClass: 'urn:epc:class:lgtin:404711145.0001.Pflanzung01', quantity: 1 },
        ],
        outputEPCList: [
          'urn:epc:id:sgtin:404711145.0100.12A3D4567',
          'urn:epc:id:sgtin:404711145.0100.56KCTQMJM',
        ],
      },
    ];

    const result = mapToLiability(dataWith([], [], events), null);
    const origin = result.categories.find((c) => c.id === 'origin')!;

    expect(origin.fields.find((f) => f.id === 'I-1')!.value).toContain('Pflanzung01');
    expect(origin.fields.find((f) => f.id === 'I-2')!.value).toContain('12A3D4567');
  });

  it('zaehlt Annahmen nicht als belegt', () => {
    const result = mapToLiability(
      dataWith([SAWN_DOP_ROW, BSP_DOP_ROW, ADHESIVE_ROW, PANEL_ROW], [DECON_ROW]),
      null,
    );

    const assumedCount = result.categories
      .flatMap((c) => c.fields)
      .filter((f) => f.availability === 'assumed').length;

    // I-3, I-6 und I-41..I-44 -- die sechs Annahmen ANN-1..ANN-6.
    expect(assumedCount).toBe(6);
    expect(result.coverage.filled).toBeLessThan(result.coverage.total - assumedCount + 1);
  });

  it('liest erfasste Schadensmeldungen aus dem Abfrageergebnis', () => {
    const damageRow = {
      damage: iri('https://pod.example/data/schaden/SD-2026-0821-ab12/report.ttl#meldung'),
      damageDate: lit('2026-08-20'),
      damageKind: lit('Feuchte / Schimmel'),
      damageDescription: lit('Dunkle Verfärbung an der Unterseite'),
      damageReporter: lit('Bauleitung HB-2026-0047'),
      damageMoisture: lit('22.4'),
    } as unknown as SparqlBinding;

    const result = mapToLiability(dataWith([damageRow]), null);

    expect(result.damageReports).toHaveLength(1);
    expect(result.damageReports[0].kind).toBe('Feuchte / Schimmel');
    expect(result.damageReports[0].date).toBe('20.08.2026');
    expect(result.damageReports[0].moisture).toBe('22,4 %');
  });
});
