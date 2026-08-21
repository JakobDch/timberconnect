import { describe, it, expect, vi, beforeEach } from 'vitest';

// executeQuery muss vor dem Import des Prueflings ersetzt werden -- sonst zoege
// der Test Comunica und echte Netzaufrufe nach sich.
const executeQuery = vi.fn();
vi.mock('../sparqlService', () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
}));

import { runScopedQuery, MAX_ROWS, DEFAULT_LIMIT } from './agentSparqlService';
import type { EpcScope } from './epcScopeService';

const EPC = 'urn:epc:id:sgtin:4047111124.015.S1605T56441L1';
const OTHER_EPC = 'urn:epc:class:lgtin:4047111124.091.CHARGE-7';

const scope = (over: Partial<EpcScope> = {}): EpcScope => ({
  epc: EPC,
  relatedEpcs: new Set([EPC, OTHER_EPC]),
  sources: ['https://pod.example/data/a/a_forst.ttl'],
  events: [],
  eventsReturned: 0,
  eventsFilteredOut: 0,
  degraded: false,
  notes: [],
  ...over,
});

const q = (body: string) => `PREFIX tc: <https://timberconnect.org/ontology#>\n${body}`;

beforeEach(() => {
  executeQuery.mockReset();
  executeQuery.mockResolvedValue([]);
});

describe('Schicht 1 — schreibende und graph-verlassende Konstrukte', () => {
  it.each([
    ['INSERT', `INSERT DATA { <urn:a> <urn:b> "${EPC}" }`],
    ['DELETE', `DELETE WHERE { ?s ?p "${EPC}" }`],
    ['DROP', 'DROP GRAPH <urn:g>'],
    ['LOAD', 'LOAD <https://evil.example/x.ttl>'],
  ])('weist %s ab', async (_label, body) => {
    const r = await runScopedQuery(q(body), scope());
    expect(r.ok).toBe(false);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('weist SERVICE ab — der Weg zu einem fremden Endpunkt', async () => {
    const r = await runScopedQuery(
      q(`SELECT ?x WHERE { SERVICE <https://evil.example/sparql> { ?s tc:epc <${EPC}> } }`),
      scope(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toMatch(/SERVICE/i);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('weist FROM ab — der Weg zu einem Graph ausserhalb der Quellen', async () => {
    const r = await runScopedQuery(
      q(`SELECT ?x FROM <https://other.example/all.ttl> WHERE { ?x tc:epc <${EPC}> }`),
      scope(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toMatch(/FROM/i);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('weist CONSTRUCT und DESCRIBE ab', async () => {
    for (const body of [
      `CONSTRUCT { ?s ?p ?o } WHERE { ?s tc:epc <${EPC}> }`,
      `DESCRIBE <${EPC}>`,
    ]) {
      const r = await runScopedQuery(q(body), scope());
      expect(r.ok).toBe(false);
    }
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('laesst sich nicht durch ein Literal oder einen Kommentar taeuschen', async () => {
    // "SERVICE"/"FROM" nur als Text -> die Abfrage ist harmlos und muss laufen.
    const r = await runScopedQuery(
      q(`# kein FROM hier\nSELECT ?s WHERE { ?s tc:epc <${EPC}> ; tc:note "SERVICE" }`),
      scope(),
    );
    expect(r.ok).toBe(true);
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });
});

describe('Schicht 2 — EPC-Bezug', () => {
  it('weist eine Abfrage ohne Identbezug ab und nennt die verfuegbaren Idente', async () => {
    const r = await runScopedQuery(q('SELECT ?s ?p ?o WHERE { ?s ?p ?o }'), scope());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/keinen der zu diesem Bauteil gehörenden Idente/i);
      expect(r.hint).toContain(EPC);
      // Die Unter-Property-Falle muss im Hinweis stehen, sonst laeuft das
      // Modell direkt in den naechsten Fehler.
      expect(r.hint).toMatch(/tc:sgtin/);
      expect(r.hint).toMatch(/tc:lgtin/);
    }
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('nennt bei einer Trace-Id den Weg ueber tc:traceId statt tc:epc', async () => {
    // Eine Trace-Id haengt NICHT an tc:epc. Wuerde der Hinweis trotzdem auf
    // tc:epc zeigen, liefe das Modell zuverlaessig ins Leere.
    const traceScope = scope({
      epc: 'TC-2024-001',
      relatedEpcs: new Set(['TC-2024-001']),
    });
    const r = await runScopedQuery(q('SELECT ?s ?p ?o WHERE { ?s ?p ?o }'), traceScope);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.hint).toMatch(/tc:traceId/);
      expect(r.hint).toContain('TC-2024-001');
      expect(r.hint).not.toMatch(/tc:sgtin/);
    }
  });

  it('laesst eine Abfrage mit Trace-Id-Bezug durch', async () => {
    const traceScope = scope({
      epc: 'TC-2024-001',
      relatedEpcs: new Set(['TC-2024-001']),
    });
    const r = await runScopedQuery(
      q('SELECT ?s WHERE { ?s tc:traceId "TC-2024-001" }'),
      traceScope,
    );
    expect(r.ok).toBe(true);
  });

  it('akzeptiert den gescannten EPC als IRI', async () => {
    const r = await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc <${EPC}> }`), scope());
    expect(r.ok).toBe(true);
  });

  it('akzeptiert einen verknuepften EPC, nicht nur den gescannten', async () => {
    const r = await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:lgtin <${OTHER_EPC}> }`), scope());
    expect(r.ok).toBe(true);
  });

  it('akzeptiert den EPC auch als Literal', async () => {
    const r = await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc "${EPC}" }`), scope());
    expect(r.ok).toBe(true);
  });

  it('ignoriert Gross-/Kleinschreibung im Ident', async () => {
    const r = await runScopedQuery(
      q(`SELECT ?s WHERE { ?s tc:epc <${EPC.toUpperCase()}> }`),
      scope(),
    );
    expect(r.ok).toBe(true);
  });

  it('weist einen FREMDEN EPC ab', async () => {
    const r = await runScopedQuery(
      q('SELECT ?s WHERE { ?s tc:epc <urn:epc:id:sgtin:9999999999.015.FREMD> }'),
      scope(),
    );
    expect(r.ok).toBe(false);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('laesst Sondierungen ohne EPC zu, damit die Datenlage erkundbar bleibt', async () => {
    const r = await runScopedQuery(q('SELECT ?type WHERE { ?s a ?type } LIMIT 3'), scope(), {
      kind: 'probe',
    });
    expect(r.ok).toBe(true);
  });
});

describe('Quellen und Ausfuehrung', () => {
  it('uebergibt IMMER die Scope-Quellen an Comunica', async () => {
    const s = scope({ sources: ['https://pod.example/x.ttl', 'https://pod.example/y.ttl'] });
    await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc <${EPC}> }`), s);
    expect(executeQuery).toHaveBeenCalledWith(expect.any(String), s.sources);
  });

  it('ruestet ein fehlendes LIMIT nach', async () => {
    await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc <${EPC}> }`), scope());
    expect(executeQuery.mock.calls[0][0]).toMatch(new RegExp(`LIMIT ${DEFAULT_LIMIT}`));
  });

  it('laesst ein vorhandenes LIMIT unangetastet', async () => {
    await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc <${EPC}> } LIMIT 5`), scope());
    const sent = executeQuery.mock.calls[0][0];
    expect(sent).toMatch(/LIMIT 5/);
    expect(sent).not.toMatch(new RegExp(`LIMIT ${DEFAULT_LIMIT}`));
  });

  it('kappt die Zeilen und meldet die Kappung ehrlich', async () => {
    executeQuery.mockResolvedValue(
      Array.from({ length: MAX_ROWS + 20 }, (_, i) => ({
        s: { value: `urn:x:${i}`, type: 'uri' },
      })),
    );
    const r = await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc <${EPC}> }`), scope());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(MAX_ROWS);
      expect(r.row_count).toBe(MAX_ROWS + 20);
      expect(r.truncated).toBe(true);
    }
  });

  it('gibt einen Abfragefehler zurueck statt zu werfen', async () => {
    executeQuery.mockRejectedValue(new Error('Syntaxfehler bei Zeile 2'));
    const r = await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc <${EPC}> }`), scope());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Syntaxfehler/);
  });

  it('meldet fehlende Quellen, statt eine leere Abfrage zu fahren', async () => {
    const r = await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc <${EPC}> }`), scope({ sources: [] }));
    expect(r.ok).toBe(false);
    expect(executeQuery).not.toHaveBeenCalled();
  });
});

describe('Sondierung lässt sich nicht als Schlupfloch nutzen', () => {
  it('wertet eine "Sondierung" mit vielen Zeilen als Datenabruf', async () => {
    // Der reale Fall: das Modell deklarierte JEDE Abfrage als probe -- das ist
    // billiger und entbindet von der Ident-Pflicht. Ergebnis war eine
    // vollstaendige Antwort, fuer die nichts abgerechnet wurde.
    executeQuery.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ s: { value: `urn:x:${i}`, type: 'uri' } })),
    );
    const r = await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc <${EPC}> }`), scope(), {
      kind: 'probe',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.effectiveKind).toBe('data');
  });

  it('lässt eine echte Sondierung Sondierung bleiben', async () => {
    executeQuery.mockResolvedValue([
      { t: { value: 'tc:Stem', type: 'uri' } },
      { t: { value: 'tc:Log', type: 'uri' } },
    ]);
    const r = await runScopedQuery(q('SELECT ?t WHERE { ?s a ?t } LIMIT 3'), scope(), {
      kind: 'probe',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.effectiveKind).toBe('probe');
  });

  it('bleibt bei kind=data immer Datenabruf, auch bei null Zeilen', async () => {
    executeQuery.mockResolvedValue([]);
    const r = await runScopedQuery(q(`SELECT ?s WHERE { ?s tc:epc <${EPC}> }`), scope());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.effectiveKind).toBe('data');
  });
});
