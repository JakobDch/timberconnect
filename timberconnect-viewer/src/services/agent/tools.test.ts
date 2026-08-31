import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeQuery = vi.fn();
const queryPlantingAreas = vi.fn();
const queryPlantingAreaByEpc = vi.fn();
vi.mock('../sparqlService', () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
  queryPlantingAreas: (...args: unknown[]) => queryPlantingAreas(...args),
  queryPlantingAreaByEpc: (...args: unknown[]) => queryPlantingAreaByEpc(...args),
}));

// Der Suchraum fuer Pflanzflaechen geht ueber den Katalog und wird
// rollengefiltert -- beides hier neutral gestellt, geprueft wird die
// Verdrahtung des Werkzeugs.
vi.mock('../accessControlService', () => ({
  filterSourcesByRole: (urls: string[]) => Promise.resolve({ allowed: urls, denied: [] }),
}));
vi.mock('../authFetch', () => ({ getCurrentRole: () => null }));
vi.mock('../../config/solidPods', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Ohne Katalog bleibt der Suchraum die Scope-Liste -- so pruefen die
  // Tests das Werkzeug und nicht den Katalogdienst.
  getAllProductsAsync: () => Promise.resolve([]),
}));
vi.mock('../geoService', () => ({
  // Punkt-in-Polygon ist in geoService getestet; hier zaehlt nur die
  // Verdrahtung -- jede Flaeche gilt als Treffer.
  areasContaining: (_p: unknown, areas: unknown[]) => areas,
}));

const queryEpcisEvents = vi.fn();
vi.mock('../epcisService', () => ({
  queryEpcisEvents: (...args: unknown[]) => queryEpcisEvents(...args),
  collectEpcs: (events: Array<{ epcList?: string[] }>) =>
    events.flatMap((e) => e.epcList ?? []),
}));

import { executeTool, TOOL_SCHEMAS } from './tools';
import { parseSemanticModel, renderSchemaPrompt, toCurie, PREFIX_BLOCK } from './schemaContextService';
import type { SchemaPack } from './schemaContextService';
import type { EpcScope } from './epcScopeService';

const EPC = 'urn:epc:id:sgtin:4047111124.015.S1605T56441L1';
const RELATED = 'urn:epc:class:lgtin:4047111124.091.CHARGE-7';
const FOREIGN = 'urn:epc:id:sgtin:9999999999.015.FREMD';

// Ein echter Ausschnitt im Format, das der Konverter erzeugt.
const MODEL_TTL = `
@prefix tc: <http://timberconnect.2050.de/ontology#> .
@prefix vlex: <http://timberconnect.2050.de/ontology/vlex#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

vlex:BSPPanel vlex:artikel xsd:string ;
    tc:traceId xsd:string ;
    tc:hasForestSource tc:ForestSource .

tc:ForestSource tc:district xsd:string ;
    tc:harvestDate xsd:dateTime .
`;

const annotations = new Map([
  ['vlex:BSPPanel', { labelDe: 'Brettsperrholz-Platte', labelEn: 'CLT panel', comment: null }],
  ['tc:harvestDate', { labelDe: 'Erntedatum', labelEn: 'harvest date', comment: null }],
  ['tc:ForestSource', { labelDe: 'Waldquelle', labelEn: null, comment: 'Herkunft im Wald' }],
]);

const classes = parseSemanticModel(MODEL_TTL, 'vlex_semantic_model.ttl', annotations);
const pack: SchemaPack = {
  classes,
  prompt: renderSchemaPrompt(classes),
  prefixes: PREFIX_BLOCK,
  notes: [],
};

const scope = (over: Partial<EpcScope> = {}): EpcScope => ({
  epc: EPC,
  relatedEpcs: new Set([EPC, RELATED]),
  sources: ['https://pod.example/data/a/a_forst.ttl'],
  events: [{ type: 'ObjectEvent', eventTime: '2026-08-01T10:00:00Z', epcList: [EPC] }],
  eventsReturned: 1,
  eventsFilteredOut: 2,
  degraded: false,
  notes: [],
  ...over,
});

const ctx = (over: Partial<EpcScope> = {}) => ({ scope: scope(over), pack });

beforeEach(() => {
  executeQuery.mockReset();
  executeQuery.mockResolvedValue([]);
  queryPlantingAreas.mockReset();
  queryPlantingAreas.mockResolvedValue([]);
  // Kein Zertifikat mit direktem Ident-Bezug -- der Regelfall. Tests, die
  // Weg 1 pruefen, setzen ihn selbst.
  queryPlantingAreaByEpc.mockReset();
  queryPlantingAreaByEpc.mockResolvedValue([]);
  queryEpcisEvents.mockReset();
});

describe('Semantisches Modell einlesen', () => {
  it('zerlegt die flache Form in Klassen mit Eigenschaften', () => {
    const panel = classes.find((c) => c.name === 'vlex:BSPPanel');
    expect(panel).toBeDefined();
    expect(panel!.properties.map((p) => p.name)).toContain('tc:traceId');
  });

  it('erkennt Object-Properties am Nicht-xsd-Wertebereich', () => {
    const panel = classes.find((c) => c.name === 'vlex:BSPPanel')!;
    const forest = panel.properties.find((p) => p.name === 'tc:hasForestSource')!;
    const artikel = panel.properties.find((p) => p.name === 'vlex:artikel')!;
    expect(forest.isObjectProperty).toBe(true);
    expect(artikel.isObjectProperty).toBe(false);
    expect(panel.connectsTo).toContain('tc:ForestSource');
  });

  it('kuerzt IRIs auf bekannte Prefixe', () => {
    expect(toCurie('http://timberconnect.2050.de/ontology#traceId')).toBe('tc:traceId');
  });

  it('haengt die deutschen Labels an den Prompt-Block', () => {
    const prompt = renderSchemaPrompt(classes);
    expect(prompt).toContain('Brettsperrholz-Platte');
    expect(prompt).toContain('Erntedatum');
  });

  it('faellt bei kaputtem Turtle auf eine leere Liste zurueck, statt zu werfen', () => {
    expect(parseSemanticModel('das ist kein turtle {{{', 'x.ttl', annotations)).toEqual([]);
  });
});

describe('run_sparql über die Werkzeugschicht', () => {
  it('reicht einen Guard-Fehler als Ergebnis durch, ohne zu werfen', async () => {
    const { result, billable } = await executeTool(
      { name: 'run_sparql', args: { query: 'SELECT ?s ?p ?o WHERE {?s ?p ?o}', purpose: 'alles' } },
      ctx(),
    );
    expect(result.ok).toBe(false);
    expect(billable).toBe(false);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('markiert echte Datenabfragen als abrechenbar', async () => {
    executeQuery.mockResolvedValue([{ s: { value: 'urn:x', type: 'uri' } }]);
    const { result, rows, billable } = await executeTool(
      {
        name: 'run_sparql',
        args: { query: `SELECT ?s WHERE { ?s tc:epc <${EPC}> }`, purpose: 'Herkunft' },
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(billable).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('nimmt Sondierungen vom Kaufledger aus', async () => {
    executeQuery.mockResolvedValue([{ t: { value: 'urn:t', type: 'uri' } }]);
    const { result, billable } = await executeTool(
      {
        name: 'run_sparql',
        args: { query: 'SELECT ?t WHERE { ?s a ?t } LIMIT 3', purpose: 'Typen', kind: 'probe' },
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(billable).toBe(false);
  });
});

describe('get_related_epcs', () => {
  it('antwortet fuer den gescannten EPC aus dem Scope, ohne erneut zu fragen', async () => {
    const { result } = await executeTool({ name: 'get_related_epcs', args: {} }, ctx());
    expect(result.ok).toBe(true);
    expect(result.related_epcs).toEqual(expect.arrayContaining([EPC, RELATED]));
    expect(queryEpcisEvents).not.toHaveBeenCalled();
  });

  it('nennt die per Consent gefilterten Ereignisse ehrlich', async () => {
    const { result } = await executeTool({ name: 'get_related_epcs', args: {} }, ctx());
    expect(result.events_filtered_out).toBe(2);
    expect(String(result.note)).toMatch(/Consent/i);
  });

  it('weist einen FREMDEN EPC ab, statt den Graphen nach aussen zu laufen', async () => {
    const { result } = await executeTool(
      { name: 'get_related_epcs', args: { epc: FOREIGN } },
      ctx(),
    );
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain(FOREIGN);
    expect(queryEpcisEvents).not.toHaveBeenCalled();
  });

  it('fragt fuer einen verknuepften EPC nach', async () => {
    queryEpcisEvents.mockResolvedValue({ events: [{ epcList: [RELATED] }], filteredOut: 0 });
    const { result } = await executeTool(
      { name: 'get_related_epcs', args: { epc: RELATED } },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(queryEpcisEvents).toHaveBeenCalledWith(RELATED);
  });

  it('gibt einen EPCIS-Fehler als Ergebnis zurueck', async () => {
    queryEpcisEvents.mockRejectedValue(new Error('Nicht authentifiziert'));
    const { result } = await executeTool(
      { name: 'get_related_epcs', args: { epc: RELATED } },
      ctx(),
    );
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/Nicht authentifiziert/);
  });
});

describe('Werkzeugregister', () => {
  it('beantwortet einen unbekannten Namen lehrend, statt zu werfen', async () => {
    const { result } = await executeTool({ name: 'gibts_nicht', args: {} }, ctx());
    expect(result.ok).toBe(false);
    expect(String(result.hint)).toContain('run_sparql');
  });

  it('haelt Schemas und Ausfuehrung deckungsgleich', async () => {
    // Jedes angebotene Werkzeug muss ausfuehrbar sein -- ein Schema ohne
    // Handler waere zur Laufzeit ein "unbekanntes Werkzeug".
    for (const schema of TOOL_SCHEMAS) {
      const { result } = await executeTool({ name: schema.function.name, args: {} }, ctx());
      expect(String(result.hint ?? '')).not.toContain('Unbekanntes Werkzeug');
    }
  });
});

describe('match_forest_origin', () => {
  it('meldet ehrlich, wenn keine Pflanzfläche hinterlegt ist', async () => {
    queryPlantingAreas.mockResolvedValue([]);
    const { result } = await executeTool({ name: 'match_forest_origin', args: {} }, ctx());
    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([]);
    expect(String(result.note)).toMatch(/kein Stammzertifikat|nicht bestimmbar/i);
  });

  it('gibt einen Fehler zurück, statt zu werfen', async () => {
    queryPlantingAreas.mockRejectedValue(new Error('Pod nicht erreichbar'));
    const { result } = await executeTool({ name: 'match_forest_origin', args: {} }, ctx());
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/Pod nicht erreichbar/);
  });

  it('fließt nicht in den Kaufledger', async () => {
    queryPlantingAreas.mockResolvedValue([]);
    const { billable } = await executeTool({ name: 'match_forest_origin', args: {} }, ctx());
    expect(billable).toBe(false);
  });
});

describe('match_forest_origin — Zuordnung', () => {
  it('ordnet eine Einschlagsposition der Pflanzfläche zu', async () => {
    queryPlantingAreas.mockResolvedValue([
      {
        certificateIri: 'urn:cert:1',
        ring: [],
        certificateNumber: 'KJZ-2024-7',
        species: 'Fichte',
        maturityYear: '2024',
        epc: 'urn:epc:id:sgtin:1.2.SAAT',
      },
    ]);
    const { result } = await executeTool(
      { name: 'match_forest_origin', args: { lat: 51.4, lon: 8.6 } },
      ctx(),
    );
    expect(result.ok).toBe(true);
    const matches = result.matches as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(1);
    expect(matches[0].certificate_number).toBe('KJZ-2024-7');
    // Ohne Koordinaten-Argument haette erst gesucht werden muessen.
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('sucht ohne Koordinaten die Positionen der Lieferkette', async () => {
    queryPlantingAreas.mockResolvedValue([{ certificateIri: 'urn:cert:1', ring: [] }]);
    executeQuery.mockResolvedValue([
      { subject: { value: 'urn:stamm:1' }, lat: { value: '51.4' }, long: { value: '8.6' } },
    ]);
    const { result } = await executeTool({ name: 'match_forest_origin', args: {} }, ctx());
    expect(result.ok).toBe(true);
    expect(result.positions_checked).toBe(1);
    expect(executeQuery).toHaveBeenCalled();
  });

  it('sucht die Koordinate AUCH an einem Nachbarknoten', async () => {
    // Der Grund, warum die Zuordnung nie zustande kam: in den Erntedaten
    // haengt die Position an einem eigenen Subjekt
    // (tc:Stem --tc:hasMachinePosition--> tc:MachinePosition), nicht am
    // Ident-Traeger. Eine Abfrage, die beides am selben Knoten verlangt,
    // findet konstant nichts.
    queryPlantingAreas.mockResolvedValue([{ certificateIri: 'urn:cert:1', ring: [] }]);
    executeQuery.mockResolvedValue([]);

    await executeTool({ name: 'match_forest_origin', args: {} }, ctx());

    const query = String(executeQuery.mock.calls[0][0]);
    // Der Ident haengt an einem eigenen Traeger, nicht am Koordinatenknoten.
    expect(query).toMatch(/\?traeger tc:(epc|sgtin|lgtin) \?ident/);
    // Und es gibt einen Weg ueber eine Kante zum Nachbarn.
    expect(query).toMatch(/\?traeger \?kante \?subject/);
    expect(query).toContain('geo:lat');
    expect(query).toContain('geo:long');
  });

  it('erzeugt gueltiges SPARQL fuer die Positionssuche', async () => {
    // Klammern zaehlen reicht nicht -- hier parst derselbe Parser, den
    // Comunica verwendet.
    const { Parser } = await import('sparqljs');
    queryPlantingAreas.mockResolvedValue([{ certificateIri: 'urn:cert:1', ring: [] }]);
    executeQuery.mockResolvedValue([]);

    await executeTool({ name: 'match_forest_origin', args: {} }, ctx());

    const query = String(executeQuery.mock.calls[0][0]);
    expect(() => new Parser().parse(query)).not.toThrow();
  });

  it('nimmt den direkten Ident-Bezug vor der Punkt-in-Polygon-Suche', async () => {
    // Zeigt ein Zertifikat per tc:epc auf einen Ident der Kette, ist das die
    // belastbarere Aussage -- dieselbe Reihenfolge wie im Produktpass.
    queryPlantingAreas.mockResolvedValue([{ certificateIri: 'urn:cert:1', ring: [] }]);
    queryPlantingAreaByEpc.mockResolvedValue([
      {
        certificateIri: 'urn:cert:direkt',
        ring: [],
        certificateNumber: 'KJZ-2024-9',
        species: 'Fichte',
        maturityYear: '2024',
        epc: 'urn:epc:id:sgtin:1.2.SAAT',
      },
    ]);

    const { result } = await executeTool({ name: 'match_forest_origin', args: {} }, ctx());

    expect(result.ok).toBe(true);
    const matches = result.matches as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(1);
    expect(matches[0].bezug).toBe('direkt');
    expect(matches[0].certificate_number).toBe('KJZ-2024-9');
    // Der Geo-Weg wurde gar nicht erst beschritten.
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('dedupliziert Zertifikate, die an mehreren Identen haengen', async () => {
    queryPlantingAreas.mockResolvedValue([{ certificateIri: 'urn:cert:1', ring: [] }]);
    // Derselbe Treffer fuer jeden abgefragten Ident.
    queryPlantingAreaByEpc.mockResolvedValue([
      { certificateIri: 'urn:cert:direkt', ring: [], certificateNumber: 'KJZ-1' },
    ]);

    const { result } = await executeTool({ name: 'match_forest_origin', args: {} }, ctx());

    expect((result.matches as unknown[])).toHaveLength(1);
  });
});

describe('Abrechnung folgt dem Ergebnis, nicht der Deklaration', () => {
  it('rechnet eine als probe getarnte Datenabfrage ab', async () => {
    executeQuery.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ v: { value: `wert-${i}`, type: 'literal' } })),
    );
    const { result, billable } = await executeTool(
      {
        name: 'run_sparql',
        args: {
          query: `SELECT ?v WHERE { ?s tc:epc <${EPC}> ; tc:forestryOffice ?v }`,
          purpose: 'Forstamt',
          kind: 'probe',
        },
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(billable, 'Antwortdaten müssen abgerechnet werden').toBe(true);
    expect(String(result.hinweis)).toMatch(/Datenabruf/i);
  });

  it('lässt eine echte Sondierung unberechnet', async () => {
    executeQuery.mockResolvedValue([{ t: { value: 'tc:Stem', type: 'uri' } }]);
    const { billable } = await executeTool(
      {
        name: 'run_sparql',
        args: { query: 'SELECT ?t WHERE { ?s a ?t } LIMIT 3', purpose: 'Typen', kind: 'probe' },
      },
      ctx(),
    );
    expect(billable).toBe(false);
  });
});
