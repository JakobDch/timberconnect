import { describe, it, expect } from 'vitest';
import { Parser } from 'sparqljs';
import { QueryEngine } from '@comunica/query-sparql';
import { Store, Parser as N3Parser } from 'n3';
import {
  identGuard,
  createCertificateDataQuery,
  createTransportOrdersQuery,
  createDeclarationQuery,
  createDeconstructionQuery,
  createDocumentationQuery,
  createLiabilityQuery,
  createLcaQuery,
  createDbppQuery,
  createStemQuery,
  createProductQuery,
  createForestQuery,
  createSawmillQuery,
  createBspWerkQuery,
  createSupplyChainQuery,
  createBusinessPartnersQuery,
} from './sparqlQueries';

const PLATTE = 'urn:epc:id:sgtin:404711145.0401.P1';
const LAMELLE = 'urn:epc:id:sgtin:404711145.0212.L1';
const TRACE_ID = 'TC-2026-001';

describe('Ident-Schranke der Dokumentabfragen', () => {
  it('bindet die Idente der Kette als Werteliste ein', () => {
    const guard = identGuard([PLATTE, LAMELLE]);
    expect(guard).toContain(`<${PLATTE}>`);
    expect(guard).toContain(`<${LAMELLE}>`);
    expect(guard).toContain('?epc IN (');
  });

  it('laesst Dokumente ohne tc:epc durch', () => {
    // Eine Datei, die ihren Materialbezug nicht angibt, gehoert zur einzigen
    // Quelle, die sie liefert -- sie herauszufiltern wuerde Awf leeren.
    expect(identGuard([PLATTE])).toContain('!BOUND(?epc)');
  });

  it('entfaellt ohne bekannte Kette', () => {
    // Kein Filter statt eines Filters ohne Werte: "?epc IN ()" wuerde jede
    // Zeile verwerfen und die Ansicht leeren, statt sie nur unscharf zu lassen.
    expect(identGuard([])).toBe('');
  });

  it('beachtet den uebergebenen Variablennamen', () => {
    // Die UNION-Abfragen haben je Sparte eine eigene EPC-Variable.
    const guard = identGuard([PLATTE], '?dopEpc');
    expect(guard).toContain('?dopEpc IN (');
    expect(guard).toContain('!BOUND(?dopEpc)');
  });
});

describe('Zertifikatsabfrage (der Fall, der den Bug zeigte)', () => {
  it('filtert auf die Idente des Bauteils', () => {
    const query = createCertificateDataQuery([PLATTE, LAMELLE]);
    expect(query).toContain('?epc IN (');
    expect(query).toContain(`<${PLATTE}>`);
  });

  it('bleibt ohne Idente ungefiltert — abwaertskompatibel', () => {
    // Der Trace-Id-Pfad kennt keine EPC-Kette. Dort bleibt es beim alten
    // Verhalten, statt die Ansicht zu leeren.
    const query = createCertificateDataQuery();
    expect(query).not.toContain('FILTER');
    expect(query).toContain('?doc a tc:Certificate');
  });

  it('erzeugt syntaktisch geschlossene Klammern', () => {
    const query = createCertificateDataQuery([PLATTE]);
    const open = (query.match(/\(/g) ?? []).length;
    const close = (query.match(/\)/g) ?? []).length;
    expect(open).toBe(close);
  });

  it('trennt mehrere Idente mit Komma — SPARQL verlangt das', () => {
    // Ohne Komma ("IN (<a> <b>)") ist die Abfrage ungueltig. Der Fehler
    // greift erst ab ZWEI Identen und blieb deshalb lange unbemerkt: mit
    // einem Ident und mit leerer Liste ist die Ausgabe zufaellig gueltig.
    const guard = identGuard([PLATTE, LAMELLE]);
    expect(guard).toContain(`<${PLATTE}>, <${LAMELLE}>`);
  });
});

describe('Stammabfrage (der Leak im Herkunftsnachweis)', () => {
  const parser = new Parser();

  it('filtert beim EPC-Pfad auf die Idente der Kette', () => {
    // DER REGRESSIONSTEST. Vorher hing die einzige Filterzeile an
    // isTraceId(); bei einem EPC schlug das fehl, die Zeile verschwand, und
    // uebrig blieb "?stem a tc:Stem" + LIMIT 1 ueber den ganzen Katalog --
    // ein beliebiger fremder Stamm galt als Herkunft des Bauteils.
    const query = createStemQuery(PLATTE, [PLATTE, LAMELLE]);
    expect(query).toContain(`<${PLATTE}>`);
    expect(query).toContain(`<${LAMELLE}>`);
    expect(query).toMatch(/FILTER|VALUES/);
  });

  it('filtert ueber den Abschnitt, nicht ueber den Stamm', () => {
    // Der Stamm traegt seinen Ident nicht selbst: im HPR steht <Identity>
    // innerhalb von <Log>. Eine Schranke direkt auf ?stem tc:epc haette
    // gar nichts geliefert -- statt falscher Daten dann eben keine.
    const query = createStemQuery(PLATTE, [PLATTE]);
    expect(query).toContain('tc:belongsToStem');
  });

  it('prueft tc:sgtin neben tc:epc', () => {
    // Der Ident-Injektor schreibt tc:sgtin. Das ist in der Ontologie eine
    // Unter-Property von tc:epc, aber Comunica macht kein Reasoning -- eine
    // Abfrage nur auf tc:epc faende den injizierten Ident nicht.
    const query = createStemQuery(PLATTE, [PLATTE]);
    expect(query).toContain('tc:sgtin');
    expect(query).toContain('tc:epc');
  });

  it('bleibt ohne Idente ungefiltert — der Trace-Id-Pfad', () => {
    // Dort filtert die Abfrage ueber tc:stemKey; eine leere Werteliste
    // wuerde jede Zeile verwerfen.
    const query = createStemQuery(TRACE_ID);
    expect(query).toContain('tc:stemKey "TC-2026-001"');
    expect(query).not.toContain('tc:belongsToStem');
  });

  it('ist in allen drei Formen gueltiges SPARQL', () => {
    expect(() => parser.parse(createStemQuery(TRACE_ID))).not.toThrow();
    expect(() => parser.parse(createStemQuery(PLATTE, [PLATTE]))).not.toThrow();
    expect(() => parser.parse(createStemQuery(PLATTE, [PLATTE, LAMELLE]))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// v6-Umstellung: keine toten Klassen mehr
// ---------------------------------------------------------------------------

/**
 * Die Stammdaten-Abfragen fragten bis zuletzt ein Vokabular ab, das die
 * v6-Migration ersetzt hat: ``vlex:BSPPanel`` und die ``*Source``-Knoten aus
 * vlex.rml.ttl (dem einzigen nie migrierten Mapping) sowie ``eldat:Polter``
 * und ``tc:hasTraceReference`` aus dem alten ELDAT-Mapping. Kein aktueller
 * Upload erzeugt das noch -- die Abfragen lieferten beim Ident-Pfad
 * ausnahmslos nichts.
 */
const V6_QUERIES: Array<[string, (epcs: string[]) => string]> = [
  ['Produkt', createProductQuery],
  ['Waldherkunft', createForestQuery],
  ['Saegewerk', createSawmillQuery],
  ['BSP-Werk', createBspWerkQuery],
  ['Lieferkette', createSupplyChainQuery],
  ['Akteure', createBusinessPartnersQuery],
];

/** Klassen und Praedikate, die es in v6 nicht mehr gibt. */
const TOTES_VOKABULAR = [
  'vlex:BSPPanel',
  'tc:ForestSource',
  'tc:SawmillSource',
  'tc:BSPWerkSource',
  'eldat:Polter',
  'eldat:BusinessPartner',
  'tc:hasTraceReference',
  'tc:hasForestSource',
  'tc:hasSawmillSource',
  'tc:hasBSPWerkSource',
  'tc:traceId',
  'vlex:hasConfiguration',
  'vlex:hasDimension',
  'vlex:hasProduction',
];

describe.each(V6_QUERIES)('%s — auf v6 umgestellt', (_name, build) => {
  const parser = new Parser();

  it('nutzt kein Vokabular aus der v5-Welt', () => {
    const query = build([PLATTE, LAMELLE]);
    for (const tot of TOTES_VOKABULAR) {
      expect(query, `${tot} ist in v6 entfallen`).not.toContain(tot);
    }
  });

  it('filtert auf die Idente der Kette', () => {
    // Ohne Schranke lieferten sie ueber den ganzen Katalog -- derselbe Leak
    // wie bei der Stammabfrage. Die Schranke ist je nach Knoten ein FILTER
    // (Wert bereits gebunden) oder ein VALUES (Wert wird gebunden).
    const query = build([PLATTE, LAMELLE]);
    expect(query).toContain(`<${PLATTE}>`);
    expect(query).toMatch(/FILTER|VALUES/);
  });

  it('ist gueltiges SPARQL — ohne, mit einem und mit mehreren Identen', () => {
    expect(() => parser.parse(build([]))).not.toThrow();
    expect(() => parser.parse(build([PLATTE]))).not.toThrow();
    expect(() => parser.parse(build([PLATTE, LAMELLE]))).not.toThrow();
  });
});

describe('v6-Umstellung: die Daten kommen aus den richtigen Quellen', () => {
  it('liest die Plattendaten flach am tc:Panel', () => {
    // In v6 haengen die Felder direkt am Panel; die vlex-Unterknoten
    // (hasConfiguration/hasDimension/hasProduction) sind entfallen.
    const query = createProductQuery([PLATTE]);
    expect(query).toContain('?panel a tc:Panel');
    expect(query).toContain('tc:nettovolumen_Produkt');
    expect(query).toContain('tc:festigkeit__Material_Produkt');
  });

  it('holt die Waldangaben vom Stamm', () => {
    // tc:ForestSource war ein synthetischer vlex-Knoten; die Angaben stehen
    // an den Maschinendaten des Faellvorgangs.
    const query = createForestQuery([PLATTE]);
    expect(query).toContain('?stem a tc:Stem');
    expect(query).toContain('tc:belongsToStem');
  });

  it('leitet das Saegewerk aus dem Rundholzauftrag ab', () => {
    // Eine eigene Saegewerks-Klasse gibt es in v6 nicht -- der Empfaenger
    // des Rundholz-Transportauftrags IST das Saegewerk.
    const query = createSawmillQuery([PLATTE]);
    expect(query).toContain('tc:TransportOrder');
    expect(query).toContain('tc:firmenname');
  });

  it('holt den Herstellernamen aus der Leistungserklaerung', () => {
    // tc:organisation am Panel ist ein ERP-Schluessel, kein Klartextname.
    const query = createBspWerkQuery([PLATTE]);
    expect(query).toContain('tc:manufacturer');
  });

  it('belegt jede Station der Kette einzeln', () => {
    const query = createSupplyChainQuery([PLATTE]);
    expect(query).toContain('tc:Stem');
    expect(query).toContain('tc:TransportOrder');
    expect(query).toContain('tc:DeclarationOfPerformance');
  });
});

// ---------------------------------------------------------------------------
// Lange Kette: vollstaendig, nicht gekappt
// ---------------------------------------------------------------------------

describe('Lange Kette', () => {
  // Die VOLLE reale Kette: eine BSP-Platte aus 169 Lamellen, dazu Staemme,
  // Saatgut und die Dokumente dazwischen -- rund 170 Idente.
  //
  // Frueher stand hier 48, weil sparqlService die Schranke auf 48 Idente
  // kappte. Die Kappung ist entfallen: sie schnitt die Menge in
  // Einfuegereihenfolge ab, und da die Lamellen vorn stehen, fielen die
  // Staemme heraus -- mit ihnen der Faellort im Herkunftsnachweis.
  //
  // Es gibt hier BEWUSST keine Groessengrenze mehr. Eine Obergrenze auf die
  // Abfragelaenge waere nur eine Kappung an anderer Stelle: sie wuerde
  // irgendwann wieder erzwingen, Idente wegzulassen. Vollstaendigkeit geht
  // vor Antwortzeit -- die Ansicht darf langsam sein, aber nicht luegen.
  const langeKette = Array.from(
    { length: 170 },
    (_, i) => `urn:epc:id:sgtin:404711146.0212.${String(i).padStart(12, '0')}`,
  );

  it.each(V6_QUERIES)('%s nimmt JEDEN Ident der Kette auf', (_name, build) => {
    const query = build(langeKette);
    for (const epc of langeKette) {
      expect(query, `${epc} fehlt in der Schranke`).toContain(`<${epc}>`);
    }
  });

  it('nutzt am Stamm VALUES statt einer Filterliste', () => {
    // FILTER(?x IN (...)) im EXISTS zwang Comunica zum Kreuzprodukt ueber
    // alle Log-Knoten je Kandidat -- genau daran hing die Anwendung.
    const query = createStemQuery('urn:epc:id:sgtin:1.2.3', langeKette);
    expect(query).toContain('VALUES ?identValue');
  });

  it('ist auch mit langer Kette gueltiges SPARQL', () => {
    const parser = new Parser();
    for (const [, build] of V6_QUERIES) {
      expect(() => parser.parse(build(langeKette))).not.toThrow();
    }
    expect(() =>
      parser.parse(createStemQuery('urn:epc:id:sgtin:1.2.3', langeKette)),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Echte Syntaxpruefung
// ---------------------------------------------------------------------------

/**
 * Klammern zaehlen reicht nicht -- der Komma-Fehler in der IN-Liste war
 * klammerbalanciert und trotzdem ungueltig. Hier parst ein echter
 * SPARQL-Parser, derselbe, den Comunica verwendet.
 */
const AWF_QUERIES: Array<[string, (epcs: string[]) => string]> = [
  ['Transportauftraege', createTransportOrdersQuery],
  ['Zertifikate', createCertificateDataQuery],
  ['Leistungserklaerungen', createDeclarationQuery],
  ['Rueckbaubarkeit', createDeconstructionQuery],
  ['Dokumentation', createDocumentationQuery],
  ['Haftung', createLiabilityQuery],
  ['CO2-Bilanz', createLcaQuery],
  ['DBPP', createDbppQuery],
];

describe.each(AWF_QUERIES)('%s — gueltiges SPARQL', (_name, build) => {
  const parser = new Parser();

  it('ohne Idente (Trace-Id-Pfad)', () => {
    expect(() => parser.parse(build([]))).not.toThrow();
  });

  it('mit einem Ident', () => {
    expect(() => parser.parse(build([PLATTE]))).not.toThrow();
  });

  it('mit mehreren Identen — die Form, die im Betrieb auftritt', () => {
    expect(() => parser.parse(build([PLATTE, LAMELLE]))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Abdeckung: KEINE Sparte ohne Schranke
// ---------------------------------------------------------------------------

/**
 * Der eigentliche Schutz vor Datenleaks.
 *
 * Die Syntaxpruefung oben sagt nur, dass die Abfrage laeuft -- nicht, dass
 * sie filtert. Eine neue UNION-Sparte ohne Schranke waere syntaktisch
 * einwandfrei und wuerde still fremde Bauteile mitliefern. Genau so ist der
 * urspruengliche Fehler entstanden.
 *
 * Deshalb wird hier jede Sparte gezaehlt: fuer jedes ``?x a tc:Klasse`` muss
 * im selben Block ein FILTER stehen. Schlaegt der Test fehl, fehlt einer
 * neuen Sparte die Schranke -- oder ihre Klasse traegt keinen Ident und
 * braucht eine Kante (siehe relatedIdentGuard).
 */
function unguardedBranches(query: string): string[] {
  const open: string[] = [];
  let branchClass: string | null = null;
  let guarded = false;
  let depth = 0;

  for (const line of query.split('\n')) {
    const cls = /^\s*\?\w+ a ((?:tc|vlex|eldat):\w+)\s*\.?/.exec(line);
    if (cls) {
      branchClass = cls[1];
      guarded = false;
      depth = 0;
    }
    if (branchClass) {
      // VALUES zaehlt als Schranke wie FILTER: es BINDET die zulaessigen
      // Idente, statt jede Zeile gegen eine Liste zu pruefen -- bei langen
      // Ketten der einzige Weg, der im Browser noch antwortet.
      if (/FILTER|VALUES/.test(line)) guarded = true;
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      // Sparte zu Ende (schliessende Klammer auf Blockebene)
      if (depth < 0) {
        if (!guarded) open.push(branchClass);
        branchClass = null;
      }
    }
  }
  if (branchClass && !guarded) open.push(branchClass);
  return open;
}

describe.each([...AWF_QUERIES, ...V6_QUERIES])(
  '%s — jede Sparte gefiltert',
  (_name, build) => {
    it('laesst keine Einstiegsklasse ohne Schranke', () => {
      expect(unguardedBranches(build([PLATTE, LAMELLE]))).toEqual([]);
    });
  },
);

describe('Der Abdeckungspruefer selbst', () => {
  // Ein Pruefer, der nie anschlaegt, ist wertlos -- diese beiden Faelle
  // zeigen, dass er eine fehlende Schranke wirklich findet.
  it('meldet eine Sparte ohne FILTER', () => {
    const query = `
SELECT ?x WHERE {
  {
    ?panel a tc:Panel .
    OPTIONAL { ?panel tc:name ?n }
  }
}`;
    expect(unguardedBranches(query)).toEqual(['tc:Panel']);
  });

  it('meldet nur die ungeschuetzte von zwei Sparten', () => {
    const query = `
SELECT ?x WHERE {
  {
    ?panel a tc:Panel .
    FILTER (?e IN (<a>))
  }
  UNION
  {
    ?order a tc:TransportOrder .
    OPTIONAL { ?order tc:name ?n }
  }
}`;
    expect(unguardedBranches(query)).toEqual(['tc:TransportOrder']);
  });
});

// ---------------------------------------------------------------------------
// Die Stamm-Schranke gegen echte Daten
// ---------------------------------------------------------------------------

/**
 * Die Tests oben pruefen Zeichenketten -- sie haetten den Fehler nicht
 * gefunden, der den Faellort der BSP-Platte aus der Karte verschwinden liess.
 * Die Schranke ENTHIELT das VALUES und den richtigen Pfad, verknuepfte den
 * Stamm aber nicht mehr mit dem Ident: ein `UNION { BIND(?stem AS ?identNode) }`
 * laesst ?identNode ungebunden (ein BIND sieht nichts ausserhalb seiner
 * Gruppe), womit der Zweig JEDEN Stamm durchliess, sobald der Ident irgendwo
 * im Graphen vorkam. Mit LIMIT 1 gewann dann ein beliebiger Stamm.
 *
 * Deshalb wird hier ausgefuehrt statt gelesen.
 */
// Comunica hochzufahren dauert; im vollen Lauf konkurrieren mehrere Suiten
// darum. Die 30s-Voreinstellung reicht dann nicht -- das ist eine Frage der
// Last, nicht der Abfragen (einzeln laufen sie in Millisekunden).
describe('stemIdentGuard — ausgefuehrt gegen einen echten Graphen', { timeout: 120_000 }, () => {
  const tc = 'http://timberconnect.2050.de/ontology#';
  const geo = 'http://www.w3.org/2003/01/geo/wgs84_pos#';

  const EPC_LOG = 'urn:epc:id:sgtin:404711145.0212.L1';
  const EPC_STEM = 'urn:epc:id:sgtin:404711145.0212.S9';
  const EPC_FREMD = 'urn:epc:id:sgtin:999999999.9999.Z9';

  // Zwei Staemme aus VERSCHIEDENEN Ketten. Genau das ist der reale Fall: im
  // Pod liegt mehr als ein Stammzertifikat.
  const TTL = `
@prefix tc: <${tc}> .
@prefix geo: <${geo}> .

<urn:stem:eigen> a tc:Stem ;
  tc:stemKey "EIGEN" ;
  tc:forestryOffice "Forstamt Eigen" ;
  tc:hasMachinePosition [ geo:lat "51.1" ; geo:long "8.5" ] .
<urn:log:eigen> tc:belongsToStem <urn:stem:eigen> ; tc:sgtin <${EPC_LOG}> .

<urn:stem:fremd> a tc:Stem ;
  tc:stemKey "FREMD" ;
  tc:forestryOffice "Forstamt Fremd" ;
  tc:hasMachinePosition [ geo:lat "48.0" ; geo:long "11.0" ] .
<urn:log:fremd> tc:belongsToStem <urn:stem:fremd> ; tc:sgtin <urn:epc:id:sgtin:1.1.X> .

# HPR ohne LogKey: der Injektor haengt den Ident dann an den Stamm.
<urn:stem:ohnelog> a tc:Stem ;
  tc:stemKey "OHNELOG" ;
  tc:forestryOffice "Forstamt Ohnelog" ;
  tc:sgtin <${EPC_STEM}> .
`;

  // Engine und Store EINMAL bauen. Beides je Test neu aufzusetzen war der
  // teuerste Teil und liess im vollen Lauf fremde Suiten in ihr Zeitlimit
  // laufen; die Abfragen selbst dauern Millisekunden. Gelesen wird nur --
  // ein geteilter Store ist hier unbedenklich.
  const engine = new QueryEngine();
  const store = new Store();
  store.addQuads(new N3Parser().parse(TTL));

  async function frage(query: string) {
    const res = await engine.queryBindings(query, { sources: [store] });
    const rows = await res.toArray();
    return rows.map((b) =>
      Object.fromEntries([...b].map(([k, v]) => [k.value, v.value])),
    );
  }

  it('liefert NUR den Stamm der eigenen Kette', async () => {
    // DER REGRESSIONSTEST. Vorher kam hier auch "Forstamt Fremd" zurueck.
    const rows = await frage(createStemQuery(EPC_LOG, [EPC_LOG]));
    expect(rows.map((r) => r.forestryOffice)).toEqual(['Forstamt Eigen']);
  });

  it('findet den Faellort der eigenen Kette — nicht irgendeinen', async () => {
    // createForestQuery hat LIMIT 1: griff die Schranke nicht, entschied der
    // Zufall, welcher Stamm gewinnt. Ein Stamm ohne Erntekoordinate liess die
    // Karte dann ohne Wald-Markierung zurueck.
    const rows = await frage(createForestQuery([EPC_LOG]));
    expect(rows).toHaveLength(1);
    expect(rows[0].forestryOffice).toBe('Forstamt Eigen');
    expect(rows[0].lat).toBe('51.1');
    expect(rows[0].long).toBe('8.5');
  });

  it('deckt den Injektor-Fallback ab: Ident direkt am Stamm', async () => {
    const rows = await frage(createStemQuery(EPC_STEM, [EPC_STEM]));
    expect(rows.map((r) => r.forestryOffice)).toEqual(['Forstamt Ohnelog']);
  });

  it('gibt bei fremdem Ident nichts zurueck statt irgendetwas', async () => {
    // Lieber eine ehrliche Luecke als ein fremder Wald als Herkunft.
    expect(await frage(createStemQuery(EPC_FREMD, [EPC_FREMD]))).toHaveLength(0);
    expect(await frage(createForestQuery([EPC_FREMD]))).toHaveLength(0);
  });

  it('bleibt bei mehreren Identen der Kette INNERHALB der Kette', async () => {
    // createStemQuery hat LIMIT 1 -- welcher der beiden eigenen Staemme
    // gewinnt, ist nicht festgelegt und auch nicht wichtig. Wichtig ist, dass
    // der FREMDE Stamm nicht gewinnen kann. Genau das war der Fehler.
    const rows = await frage(createStemQuery(EPC_LOG, [EPC_LOG, EPC_STEM]));
    expect(rows).toHaveLength(1);
    expect(['Forstamt Eigen', 'Forstamt Ohnelog']).toContain(
      rows[0].forestryOffice,
    );
  });

  it('nimmt in der Lieferkette (ohne LIMIT) alle Staemme der Kette', async () => {
    // Hier laesst sich pruefen, was LIMIT 1 oben verdeckt: beide eigenen
    // Staemme kommen mit, der fremde nicht.
    const rows = await frage(createSupplyChainQuery([EPC_LOG, EPC_STEM]));
    const forst = rows.filter((r) => r.station === 'Forst');
    expect(new Set(forst.map((r) => r.company))).toEqual(
      new Set(['Forstamt Eigen', 'Forstamt Ohnelog']),
    );
  });

  it('bindet den Stamm auch in der Lieferkette an seinen Ident', async () => {
    const rows = await frage(createSupplyChainQuery([EPC_LOG]));
    const forst = rows.filter((r) => r.station === 'Forst');
    expect(forst.map((r) => r.company)).toEqual(['Forstamt Eigen']);
  });
});
