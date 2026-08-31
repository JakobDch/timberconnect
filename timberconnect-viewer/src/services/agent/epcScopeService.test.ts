import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeQuery = vi.fn();
const filterAvailableSources = vi.fn();
const sourcesFromBizTransactions = vi.fn(() => [] as string[]);
vi.mock('../sparqlService', () => ({
  executeQuery: (...a: unknown[]) => executeQuery(...a),
  filterAvailableSources: (...a: unknown[]) => filterAvailableSources(...a),
  sourcesFromBizTransactions: (...a: unknown[]) => sourcesFromBizTransactions(...a),
}));
const queryEpcisEvents = vi.fn();
vi.mock('../epcisService', () => ({
  queryEpcisEvents: (...a: unknown[]) => queryEpcisEvents(...a),
  collectEpcs: (evs: Array<Record<string, string[]>>) =>
    evs.flatMap((e) => [...(e.inputEPCList ?? []), ...(e.outputEPCList ?? []), ...(e.epcList ?? [])]),
  collectBizTransactions: (evs: Array<{ bizTransactionList?: Array<{ bizTransaction?: string }> }>) =>
    evs.flatMap((e) => (e.bizTransactionList ?? []).map((b) => b.bizTransaction).filter(Boolean)),
}));
vi.mock('../accessControlService', () => ({
  filterSourcesByRole: (s: string[]) => Promise.resolve({ allowed: s }),
}));
// Der Wert wird nie interpretiert (filterSourcesByRole ist oben gemockt),
// soll aber wie eine echte Rollen-IRI aussehen.
vi.mock('../authFetch', () => ({
  getCurrentRole: () => 'https://timberconnect.org/ontology#Forstbetrieb',
}));
vi.mock('../../config/solidPods', () => ({
  getAllProductsAsync: () =>
    Promise.resolve([
      { id: 'TC-9999-001', sources: ['https://pod.example/fremd.ttl'] },
      { id: 'TC-9999-002', sources: ['https://pod.example/panel.ttl'] },
    ]),
  NAMESPACES: { tc: 'http://timberconnect.2050.de/ontology#' },
}));

import { buildEpcScope } from './epcScopeService';

const EPC = 'urn:epc:id:sgtin:404711148.0401.718871462389';

beforeEach(() => {
  executeQuery.mockReset();
  filterAvailableSources.mockReset();
  queryEpcisEvents.mockReset();
  queryEpcisEvents.mockResolvedValue({ events: [], returned: 0, filteredOut: 0 });
  sourcesFromBizTransactions.mockReset();
  sourcesFromBizTransactions.mockReturnValue([]);
});

describe('Identprüfung der Kandidatenquellen', () => {
  it('stellt die Prüfabfrage als SELECT, nicht als ASK', async () => {
    // Regression: executeQuery ruft Comunicas queryBindings auf. Ein ASK wirft
    // dort "Query result type 'bindings' was expected, while 'boolean' was
    // found" -- die Prüfung war dadurch wirkungslos und der Scope fiel immer
    // in den degradierten Zustand.
    filterAvailableSources
      .mockResolvedValueOnce({ available: [] })                                 // belegte Quellen
      .mockResolvedValue({ available: ['https://pod.example/fremd.ttl'] });     // Kandidaten
    executeQuery.mockResolvedValue([{ s: { value: 'urn:x', type: 'uri' } }]);

    const scope = await buildEpcScope(EPC);

    expect(executeQuery).toHaveBeenCalled();
    const query = executeQuery.mock.calls[0][0] as string;
    expect(query).toMatch(/^\s*PREFIX[\s\S]*\bSELECT\b/);
    expect(query).not.toMatch(/\bASK\b/);
    expect(scope.degraded).toBe(false);
    expect(scope.sources).toContain('https://pod.example/fremd.ttl');
  });

  it('degradiert, wenn keine Kandidatenquelle den Ident führt', async () => {
    filterAvailableSources
      .mockResolvedValueOnce({ available: [] })
      .mockResolvedValueOnce({ available: ['https://pod.example/fremd.ttl'] })
      .mockResolvedValue({ available: ['https://pod.example/fremd.ttl'] });
    executeQuery.mockResolvedValue([]); // kein Treffer

    const scope = await buildEpcScope(EPC);
    expect(scope.degraded).toBe(true);
  });
});

describe('Lieferkette über mehrere Stufen', () => {
  const PANEL = EPC;
  const LAMELLE = 'urn:epc:id:sgtin:404711146.0212.102562567980';
  const STAMM = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';

  it('folgt der Kette bis zu den Stämmen, nicht nur bis zu den Lamellen', async () => {
    // Der reale Aufbau: Platte <- Lamellen (Event 1), Lamellen <- Staemme
    // (Event 2, im Saegewerks-Pod). An den STAEMMEN haengen die Forstdaten.
    // Wer nur eine Stufe aufloest, findet den Wald nie.
    queryEpcisEvents.mockImplementation((epc: string) => {
      if (epc === PANEL) {
        return Promise.resolve({
          events: [{ inputEPCList: [LAMELLE], outputEPCList: [PANEL] }],
          returned: 1,
          filteredOut: 0,
        });
      }
      if (epc === LAMELLE) {
        return Promise.resolve({
          events: [{ inputEPCList: [STAMM], outputEPCList: [LAMELLE] }],
          returned: 1,
          filteredOut: 0,
        });
      }
      return Promise.resolve({ events: [], returned: 0, filteredOut: 0 });
    });
    filterAvailableSources.mockResolvedValue({ available: [] });

    const scope = await buildEpcScope(PANEL);

    expect(scope.relatedEpcs.has(LAMELLE)).toBe(true);
    expect(scope.relatedEpcs.has(STAMM), 'Stamm-EPC fehlt — Forstdaten unerreichbar').toBe(true);
  });

  it('fragt pro Stufe nur einen Vertreter je Produktart ab', async () => {
    // 169 Lamellen stammen aus demselben Vorgang; die 169. Abfrage liefert
    // dieselben Pods wie die erste.
    const viele = Array.from(
      { length: 60 },
      (_, i) => `urn:epc:id:sgtin:404711146.0212.${String(i).padStart(9, '0')}`,
    );
    queryEpcisEvents.mockImplementation((epc: string) =>
      Promise.resolve(
        epc === PANEL
          ? { events: [{ inputEPCList: viele, outputEPCList: [PANEL] }], returned: 1, filteredOut: 0 }
          : { events: [], returned: 0, filteredOut: 0 },
      ),
    );
    filterAvailableSources.mockResolvedValue({ available: [] });

    await buildEpcScope(PANEL);

    // 1x Panel + 1 Vertreter der Lamellen -- nicht 61.
    expect(queryEpcisEvents.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('meldet für die Anzeige die Events der ERSTEN Stufe', async () => {
    queryEpcisEvents.mockImplementation((epc: string) =>
      Promise.resolve(
        epc === PANEL
          ? { events: [{ inputEPCList: [LAMELLE] }], returned: 2, filteredOut: 5 }
          : { events: [], returned: 99, filteredOut: 99 },
      ),
    );
    filterAvailableSources.mockResolvedValue({ available: [] });

    const scope = await buildEpcScope(PANEL);
    expect(scope.eventsReturned).toBe(2);
    expect(scope.eventsFilteredOut).toBe(5);
  });

  it('bricht die Kette nicht ab, wenn eine Stufe fehlschlägt', async () => {
    queryEpcisEvents.mockImplementation((epc: string) =>
      epc === PANEL
        ? Promise.resolve({ events: [{ inputEPCList: [LAMELLE] }], returned: 1, filteredOut: 0 })
        : Promise.reject(new Error('EPCAT nicht erreichbar')),
    );
    filterAvailableSources.mockResolvedValue({ available: [] });

    const scope = await buildEpcScope(PANEL);
    expect(scope.relatedEpcs.has(LAMELLE)).toBe(true);
  });
});

describe('Kandidatenprüfung läuft IMMER, nicht nur im Notfall', () => {
  const PANEL_SOURCE = 'https://pod.example/panel.ttl';
  const CHAIN_SOURCE = 'https://sawmill.example/stamm.ttl';

  it('ergänzt Katalogquellen, auch wenn die Kette schon Quellen geliefert hat', async () => {
    // Der reale Regressionsfall: seit dem mehrstufigen Ketten-Walk liefern die
    // bizTransactions erreichbare Quellen aus dem Saegewerks-Pod. Lief die
    // Kandidatenpruefung nur bei "gar nichts erreichbar", blieben die
    // Katalogquellen mit den Daten der PLATTE liegen -- die Waldherkunft war
    // auffindbar, das gescannte Bauteil selbst nicht.
    sourcesFromBizTransactions.mockReturnValue([CHAIN_SOURCE]);
    filterAvailableSources.mockImplementation((urls: string[]) =>
      Promise.resolve({ available: urls }),
    );
    executeQuery.mockResolvedValue([{ s: { value: 'urn:x', type: 'uri' } }]);

    const scope = await buildEpcScope(EPC);

    expect(scope.sources).toContain(CHAIN_SOURCE);
    expect(scope.sources, 'Plattendaten fehlen im Scope').toContain(PANEL_SOURCE);
    expect(scope.degraded).toBe(false);
  });

  it('nimmt eine Kandidatenquelle NICHT auf, die den Ident nicht führt', async () => {
    sourcesFromBizTransactions.mockReturnValue([CHAIN_SOURCE]);
    filterAvailableSources.mockImplementation((urls: string[]) =>
      Promise.resolve({ available: urls }),
    );
    executeQuery.mockResolvedValue([]); // kein Treffer

    const scope = await buildEpcScope(EPC);
    expect(scope.sources).toContain(CHAIN_SOURCE);
    expect(scope.sources).not.toContain(PANEL_SOURCE);
  });
});

describe('Materialfluss aus den Pod-Daten', () => {
  const CHAIN_SOURCE = 'https://pod.example/chain.ttl';
  const STAMM = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';

  it('nimmt einen Stamm auf, der nur per tc:derivedFrom im Pod steht', async () => {
    // Der Fall aus der Praxis: EPCIS liefert die Lamellen, der Stamm steht
    // nur als tc:derivedFrom in den Pod-Daten. Ohne diesen Schritt lehnte der
    // Agent ihn ab ("gehoert nicht zu diesem Bauteil") -- und genau an ihm
    // haengt die Waldherkunft.
    sourcesFromBizTransactions.mockReturnValue([CHAIN_SOURCE]);
    filterAvailableSources.mockImplementation((urls: string[]) =>
      Promise.resolve({ available: urls }),
    );
    executeQuery.mockImplementation((query: string) => {
      if (query.includes('tc:derivedFrom')) {
        return Promise.resolve([{ vorEpc: { value: STAMM } }]);
      }
      return Promise.resolve([{ s: { value: 'urn:subject:1' } }]);
    });

    const scope = await buildEpcScope(EPC);

    expect(scope.relatedEpcs.has(STAMM)).toBe(true);
  });

  it('holt den Stamm auch, wenn tc:derivedFrom direkt auf den Ident-IRI zeigt', async () => {
    // Die Form, die die Leistungserklärung Schnittholz erzeugt:
    //
    //   <…/saegevorgang/1> a tc:SawingProcess ;
    //       tc:epc        <…0212.120231002917> ;   # Lamelle
    //       tc:derivedFrom <…0100.12A3D4567> .     # Stamm, als blosser IRI
    //
    // Der Stamm ist hier KEIN Subjekt mit eigenem tc:epc. Ein Rueckfallzweig
    // `UNION { BIND(?vor AS ?vorEpc) }` liefert dafuer null Zeilen -- ein BIND
    // sieht Variablen ausserhalb seiner Gruppe nicht. Genau daran scheiterte
    // die Waldherkunft: der Stamm-Ident kam nie in den Scope.
    sourcesFromBizTransactions.mockReturnValue([CHAIN_SOURCE]);
    filterAvailableSources.mockImplementation((urls: string[]) =>
      Promise.resolve({ available: urls }),
    );
    executeQuery.mockImplementation((query: string) => {
      if (query.includes('tc:derivedFrom')) {
        // Der Rueckfall auf ?vor selbst muss im SELECT stehen -- sonst kann
        // die Abfrage diese Datenform gar nicht ausdruecken.
        expect(query).toContain('COALESCE');
        expect(query).not.toMatch(/UNION\s*\{\s*BIND/);
        return Promise.resolve([{ vorEpc: { value: STAMM } }]);
      }
      return Promise.resolve([{ s: { value: 'urn:subject:1' } }]);
    });

    const scope = await buildEpcScope(EPC);

    expect(scope.relatedEpcs.has(STAMM)).toBe(true);
  });

  it('nimmt die Quelle auf, die erst der neu entdeckte Stamm-Ident erschliesst', async () => {
    // Der eigentliche Fall der Waldherkunft, ueber ZWEI Pods:
    //
    //   chain.ttl  (Saegewerk) -- fuehrt die Lamellen, nennt den Stamm per
    //                             tc:derivedFrom
    //   fremd.ttl  (Forst)     -- fuehrt NUR den Stamm-Ident, traegt Forstamt,
    //                             Revier und Einschlagdatum
    //
    // Ein einzelner Durchlauf findet fremd.ttl nie: zum Zeitpunkt der
    // Quellenpruefung ist der Stamm-Ident noch unbekannt, und wenn er bekannt
    // ist, wird nicht mehr gesucht. Der Agent sah dann den Ident, bekam aber
    // auf jede Abfrage dazu null Zeilen.
    const FOREST_SOURCE = 'https://pod.example/fremd.ttl';
    sourcesFromBizTransactions.mockReturnValue([CHAIN_SOURCE]);
    filterAvailableSources.mockImplementation((urls: string[]) =>
      Promise.resolve({ available: urls }),
    );
    executeQuery.mockImplementation((query: string, sources: string[]) => {
      if (query.includes('tc:derivedFrom')) {
        // Nur der Saegewerks-Pod kennt den Materialfluss.
        return Promise.resolve(
          sources.includes(CHAIN_SOURCE) ? [{ vorEpc: { value: STAMM } }] : [],
        );
      }
      // Identpruefung: fremd.ttl antwortet NUR, wenn nach dem Stamm gefragt
      // wird -- die Lamellen kennt der Forst-Pod nicht.
      if (sources.includes(FOREST_SOURCE)) {
        return Promise.resolve(query.includes(STAMM) ? [{ s: { value: 'urn:stamm' } }] : []);
      }
      return Promise.resolve([{ s: { value: 'urn:subject:1' } }]);
    });

    const scope = await buildEpcScope(EPC);

    expect(scope.relatedEpcs.has(STAMM)).toBe(true);
    // Der Kern: die Forst-Quelle ist im Scope und damit abfragbar.
    expect(scope.sources).toContain(FOREST_SOURCE);
  });

  it('nimmt keine Ressourcen-IRIs auf, die keine EPCs sind', async () => {
    // tc:derivedFrom kann auf eine beliebige IRI zeigen -- als Ident taugt
    // die nicht und wuerde nur Abfragen ins Leere schicken.
    sourcesFromBizTransactions.mockReturnValue([CHAIN_SOURCE]);
    filterAvailableSources.mockImplementation((urls: string[]) =>
      Promise.resolve({ available: urls }),
    );
    executeQuery.mockImplementation((query: string) => {
      if (query.includes('tc:derivedFrom')) {
        return Promise.resolve([
          { vorEpc: { value: 'http://timberconnect.2050.de/resource/stem/4711' } },
        ]);
      }
      return Promise.resolve([{ s: { value: 'urn:subject:1' } }]);
    });

    const scope = await buildEpcScope(EPC);

    expect([...scope.relatedEpcs].some((e) => e.startsWith('http'))).toBe(false);
  });

  it('bleibt beim EPCIS-Stand, wenn die Abfrage fehlschlaegt', async () => {
    sourcesFromBizTransactions.mockReturnValue([CHAIN_SOURCE]);
    filterAvailableSources.mockImplementation((urls: string[]) =>
      Promise.resolve({ available: urls }),
    );
    executeQuery.mockImplementation((query: string) => {
      if (query.includes('tc:derivedFrom')) return Promise.reject(new Error('kaputt'));
      return Promise.resolve([{ s: { value: 'urn:subject:1' } }]);
    });

    const scope = await buildEpcScope(EPC);

    // Der gescannte Ident bleibt -- kein Absturz, nur kein Zugewinn.
    expect(scope.relatedEpcs.has(EPC)).toBe(true);
  });
});
