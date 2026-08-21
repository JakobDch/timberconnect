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
vi.mock('../authFetch', () => ({ getCurrentRole: () => 'forst' }));
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
