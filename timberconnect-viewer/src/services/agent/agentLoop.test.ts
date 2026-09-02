import { describe, it, expect, vi, afterEach } from 'vitest';

// Der Katalog haengt am echten Netz (Federation Registry). Ohne diesen Mock
// versucht der Herkunfts-Abgleich, Pods im Internet zu finden, laeuft in
// Zeitgrenzen und reisst den Test mit -- eine Testisolationsluecke, die nichts
// mit dem Pruefgegenstand zu tun hat.
vi.mock('../plantingLookupService', () => ({
  resolvePlantingSources: () => Promise.resolve([]),
  queryPlantingAreas: () => Promise.resolve([]),
}));

import {
  citedIndices,
  billableKeys,
  stripRawToolCalls,
  runAgent,
  isForestQuestion,
  type AgentAnswer,
} from './agentLoop';
import { ANSWER_TOOL } from './tools';
import { queryDatapointKey } from '../purchaseService';
import type { EpcScope } from './epcScopeService';
import type { SchemaPack } from './schemaContextService';

const answer = (
  content: string,
  ledger: AgentAnswer['ledger'],
  used?: AgentAnswer['used'],
): AgentAnswer => ({
  content,
  ledger,
  used,
  traces: [],
  messages: [],
  exhausted: false,
});

const entry = (index: number, keys: string[]) => ({
  index,
  keys: new Set(keys),
  rowCount: keys.length,
});

describe('Zitate erkennen', () => {
  it('liest die Abfragenummer aus [Q3.variable]', () => {
    expect([...citedIndices('Herkunft [Q1.forestryOffice], Datum [Q3.harvestDate].')]).toEqual([
      1, 3,
    ]);
  });

  it('akzeptiert auch [Q2] ohne Variablenteil', () => {
    expect([...citedIndices('Das ist so [Q2].')]).toEqual([2]);
  });

  it('zaehlt eine mehrfach zitierte Abfrage nur einmal', () => {
    expect([...citedIndices('[Q1.a] und [Q1.b] und nochmal [Q1.c]')]).toEqual([1]);
  });

  it('erkennt Zitate AUCH ohne eckige Klammern', () => {
    // Modelle lassen die Klammern in Tabellenzellen regelmaessig weg. Streng
    // zu parsen haette die schlechteste Folge: keine Zitate = fail-closed =
    // der Nutzer zahlt fuer ALLES, weil zwei Klammern fehlten.
    expect([...citedIndices('Fichte Q3.holzart_v3, Q25.holzart.')].sort((a, b) => a - b)).toEqual([3, 25]);
  });

  it('haelt eine blosse Quartalsangabe nicht fuer ein Zitat', () => {
    expect(citedIndices('Im Q3 wurden 12 Platten gefertigt.').size).toBe(0);
  });

  it('findet nichts in einem Text ohne Zitate', () => {
    expect(citedIndices('Das Holz stammt aus Arnsberg.').size).toBe(0);
  });
});

describe('Abrechnung nach Zitaten', () => {
  const ledger = [entry(1, ['q:aaa', 'q:bbb']), entry(2, ['q:ccc']), entry(3, ['q:ddd'])];

  it('berechnet nur die zitierten Abfragen', () => {
    const keys = billableKeys(answer('Herkunft [Q1.ort], Datum [Q3.datum].', ledger));
    expect([...keys].sort()).toEqual(['q:aaa', 'q:bbb', 'q:ddd']);
    // Q2 wurde nicht zitiert -> nicht berechnet.
    expect(keys.has('q:ccc')).toBe(false);
  });

  it('berechnet OHNE Zitate alles — fail-closed', () => {
    // Ein Modell, das die Zitate vergisst, darf keine Daten verschenken.
    const keys = billableKeys(answer('Das Holz stammt aus Arnsberg.', ledger));
    expect([...keys].sort()).toEqual(['q:aaa', 'q:bbb', 'q:ccc', 'q:ddd']);
  });

  it('uebergeht eine zitierte Nummer ohne Ledger-Eintrag', () => {
    // Q9 gibt es nicht (Modell verzaehlt oder auf eine Sondierung verwiesen) --
    // dafuer existieren keine Datenpunkte, also auch nichts zu bezahlen.
    const keys = billableKeys(answer('Laut [Q9.irgendwas] und [Q2.ccc].', ledger));
    expect([...keys]).toEqual(['q:ccc']);
  });

  it('ergibt bei leerem Ledger nichts zu bezahlen', () => {
    expect(billableKeys(answer('Dazu liegen keine Angaben vor.', [])).size).toBe(0);
  });

  it('dedupliziert Schluessel ueber mehrere zitierte Abfragen', () => {
    const overlapping = [entry(1, ['q:same', 'q:one']), entry(2, ['q:same', 'q:two'])];
    const keys = billableKeys(answer('[Q1.a] [Q2.b]', overlapping));
    expect([...keys].sort()).toEqual(['q:one', 'q:same', 'q:two']);
  });
});

describe('Abrechnung nach VERWENDETEN Datenpunkten', () => {
  // Eine Abfrage, die viel geliefert hat -- der typische Fall aus der Praxis:
  // "SELECT ?p ?o" ueber den Saegevorgang mit 9 Zeilen.
  const holzart = queryDatapointKey('holzart', 'Fichte');
  const standort = queryDatapointKey('standort', 'Westerkappeln-Velpe');
  const ballast = ['q:x1', 'q:x2', 'q:x3', 'q:x4', 'q:x5'];

  const ledger = [
    entry(11, [holzart, ...ballast]),
    entry(12, [standort, ...ballast]),
  ];

  it('berechnet NUR die genannten Werte, nicht die ganze Abfrage', () => {
    // Der Kern: Q11 lieferte 6 Werte, die Antwort nennt einen.
    const keys = billableKeys(
      answer('Die Holzart ist Fichte [Q11.holzart].', ledger, [
        { index: 11, variable: 'holzart', value: 'Fichte' },
      ]),
    );
    expect([...keys]).toEqual([holzart]);
    for (const key of ballast) expect(keys.has(key)).toBe(false);
  });

  it('kostet nichts, wenn die Antwort keine Daten nennt', () => {
    // Der Fall aus der Praxis: eine reine Fehlanzeige. Kein Zitat, keine
    // Deklaration -- und damit auch keine Rechnung.
    const keys = billableKeys(
      answer('Zur Waldherkunft liegen keine Angaben vor.', ledger, []),
    );
    expect(keys.size).toBe(0);
  });

  it('rechnet ueber mehrere Abfragen hinweg nur die genannten Werte ab', () => {
    const keys = billableKeys(
      answer('Fichte [Q11.holzart], Standort Westerkappeln-Velpe [Q12.standort].', ledger, [
        { index: 11, variable: 'holzart', value: 'Fichte' },
        { index: 12, variable: 'standort', value: 'Westerkappeln-Velpe' },
      ]),
    );
    expect([...keys].sort()).toEqual([holzart, standort].sort());
  });

  it('ignoriert erfundene Werte, die die Abfrage nie geliefert hat', () => {
    // Das Modell darf sich keine Datenpunkte ausdenken -- abgerechnet wird
    // nur, was im Ledger steht.
    const keys = billableKeys(
      answer('Die Holzart ist Buche [Q11.holzart].', ledger, [
        { index: 11, variable: 'holzart', value: 'Buche' },
      ]),
    );
    expect(keys.size).toBe(0);
  });

  it('ignoriert Verweise auf Abfragen ohne Ledger-Eintrag', () => {
    const keys = billableKeys(
      answer('Laut [Q99.irgendwas].', ledger, [
        { index: 99, variable: 'irgendwas', value: 'egal' },
      ]),
    );
    expect(keys.size).toBe(0);
  });

  it('faellt auf Zitatabrechnung zurueck, wenn Belege ohne Deklaration kommen', () => {
    // Zitate ohne passende Deklaration heissen: das Modell hat geschlampt.
    // Fail-closed -- sonst waere Vergesslichkeit der Gratis-Weg.
    const keys = billableKeys(answer('Die Holzart ist Fichte [Q11.holzart].', ledger, []));
    expect(keys.has(holzart)).toBe(true);
    expect(keys.size).toBeGreaterThan(1);
  });

  it('rechnet ohne Deklaration wie bisher nach Zitaten ab', () => {
    // Altes Verhalten bleibt erhalten, wenn used gar nicht gesetzt ist.
    const keys = billableKeys(answer('Die Holzart ist Fichte [Q11.holzart].', ledger));
    expect(keys.has(holzart)).toBe(true);
    expect(keys.size).toBeGreaterThan(1);
  });
});

describe('Rohe Werkzeugaufrufe aus dem Antworttext entfernen', () => {
  it('schneidet DeepSeeks DSML-Block ab', () => {
    // Genau der Fall aus der Praxis: das Modell wollte noch abfragen, hatte
    // aber keine Werkzeuge mehr und schrieb den Aufruf in den Text.
    const raw =
      'Ich sehe, dass der Produktionsstandort Brilon ist.\n\n' +
      '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="run_sparql">\n' +
      'PREFIX tc: <...>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>';
    const clean = stripRawToolCalls(raw);
    expect(clean).toBe('Ich sehe, dass der Produktionsstandort Brilon ist.');
    expect(clean).not.toContain('DSML');
    expect(clean).not.toContain('run_sparql');
  });

  it('laesst eine normale Antwort unveraendert', () => {
    const normal = 'Das Holz stammt aus Arnsberg [Q1.ort].';
    expect(stripRawToolCalls(normal)).toBe(normal);
  });

  it('laesst SPARQL in der Antwort stehen, solange es kein DSML-Block ist', () => {
    const withCode = 'Die Abfrage lautete:\n```sparql\nSELECT ?s WHERE { ?s ?p ?o }\n```';
    expect(stripRawToolCalls(withCode)).toBe(withCode);
  });
});

// ---------------------------------------------------------------------------
// Kanaltrennung: nur der Werkzeugaufruf erreicht den Nutzer
// ---------------------------------------------------------------------------

/** Ein SSE-Stream, wie ihn ein OpenAI-kompatibler Anbieter liefert. */
function sseResponse(chunks: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** Ein Zug des Modells: Fliesstext plus optionaler Antwortaufruf. */
let turnSeq = 0;
function turn(text: string, antwort?: string, verwendete_daten: unknown[] = []) {
  const chunks: unknown[] = [{ choices: [{ delta: { content: text } }] }];
  if (antwort !== undefined) {
    chunks.push({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call_${++turnSeq}`,
                type: 'function',
                function: {
                  name: ANSWER_TOOL,
                  arguments: JSON.stringify({ antwort, verwendete_daten }),
                },
              },
            ],
          },
        },
      ],
    });
  }
  chunks.push({ choices: [{ delta: {}, finish_reason: 'stop' }] });
  return chunks;
}

/**
 * Wie oft ging eine Anfrage AN DAS MODELL?
 *
 * Nicht `fetchMock.mock.calls.length`: Werkzeuge duerfen waehrend einer Runde
 * selbst ins Netz gehen (`match_forest_origin` laedt den Katalog, um
 * Pflanzflaechen zu finden). Solche Abrufe sind keine zusaetzliche Runde der
 * Antwortschleife -- genau die zaehlen diese Tests aber. Ein blosser
 * fetch-Zaehler machte sie davon abhaengig, welche Werkzeuge zufaellig
 * mitlaufen, und schlaege bei einer harmlosen Erweiterung fehl.
 */
function modelCalls(mock: ReturnType<typeof vi.spyOn>): number {
  return mock.mock.calls.filter((args) =>
    String(args[0]).includes('/chat/completions'),
  ).length;
}

const scope = {
  epc: 'urn:epc:id:sgtin:404711145.0100.12A3D4567',
  relatedEpcs: new Set<string>(),
  sources: [],
  degraded: false,
  eventsFilteredOut: 0,
} as unknown as EpcScope;

const pack = { prefixes: '', prompt: '' } as unknown as SchemaPack;

describe('Herkunftsfragen erkennen', () => {
  it.each([
    'Woher stammt das Holz?',
    'Aus welchem Wald kommt das?',
    'Welches Forstamt?',
    'Zeig mir die Pflanzfläche',
    'Wann war der Einschlag?',
    'In welchem Revier wurde gefällt?',
    'Was ist der Ursprung dieses Bauteils?',
  ])('erkennt: %s', (frage) => {
    expect(isForestQuestion(frage)).toBe(true);
  });

  it.each([
    'Welche Holzart?',
    'Wie sind die Abmessungen?',
    'Welcher Klebstoff wurde verwendet?',
    'Zeig mir die Leistungserklärung',
  ])('loest nicht aus bei: %s', (frage) => {
    expect(isForestQuestion(frage)).toBe(false);
  });
});

describe('Kanaltrennung zwischen Nachdenken und Antwort', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gibt den Werkzeug-Text aus, nicht den Fliesstext daneben', async () => {
    // Genau der Fall aus der Praxis: das Modell gruebelt im Fliesstext und
    // liefert die eigentliche Antwort ueber das Werkzeug.
    const gruebeln =
      'Lassen Sie mich prüfen, ob es ein Stammzertifikat gibt. Ich habe das ' +
      'bereits in Q13 versucht. Eigentlich sollte ich über die Lamelle einsteigen.';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(turn(gruebeln, 'Das Holz stammt aus dem Forstamt Arnsberg [Q1.forestryOffice].')),
    );

    const result = await runAgent({ apiKey: 'k', question: 'Welche Holzart?', scope, pack });

    expect(result.content).toBe(
      'Das Holz stammt aus dem Forstamt Arnsberg [Q1.forestryOffice].',
    );
    expect(result.content).not.toContain('Lassen Sie mich');
    expect(result.content).not.toContain('Q13');
  });

  it('zeigt reinen Fliesstext ohne Werkzeugaufruf NIE an', async () => {
    // Das Modell redet nur. Frueher war genau das die "Antwort" -- der Bug.
    // Jetzt wird es erinnert, und erst der Werkzeugaufruf zaehlt.
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(sseResponse(turn('Lassen Sie mich prüfen, ob…')))
      .mockResolvedValueOnce(sseResponse(turn('', 'Dazu liegen keine Angaben vor.')));

    const result = await runAgent({ apiKey: 'k', question: 'Welche Holzart?', scope, pack });

    expect(result.content).toBe('Dazu liegen keine Angaben vor.');
    expect(modelCalls(fetchMock)).toBe(2);
  });

  it('faellt auf einen ehrlichen Satz zurueck, wenn das Argument leer ist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse(turn('etwas Text', '   ')));

    const result = await runAgent({ apiKey: 'k', question: 'Welche Holzart?', scope, pack });

    expect(result.content).toContain('keine belastbare');
    expect(result.content).not.toContain('etwas Text');
  });

  it('reicht die verwendeten Datenpunkte bis zur Abrechnung durch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(
        turn('', 'Die Holzart ist Fichte [Q1.holzart].', [
          { abfrage: 1, variable: 'holzart', wert: 'Fichte' },
        ]),
      ),
    );

    const result = await runAgent({ apiKey: 'k', question: 'Holzart?', scope, pack });

    expect(result.used).toEqual([{ index: 1, variable: 'holzart', value: 'Fichte' }]);
  });

  it('liest "Q3" und Zahlenwerte nachsichtig', async () => {
    // Modelle schreiben die Nummer gelegentlich als "Q3" und Messwerte als Zahl.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(
        turn('', 'Volumen 2,4 m³ [Q3.volumen].', [
          { abfrage: 'Q3', variable: 'volumen', wert: 2.4 },
        ]),
      ),
    );

    const result = await runAgent({ apiKey: 'k', question: 'Volumen?', scope, pack });

    expect(result.used).toEqual([{ index: 3, variable: 'volumen', value: '2.4' }]);
  });

  it('unterscheidet leere Deklaration von fehlender Deklaration', async () => {
    // Leere Liste = "diese Antwort nennt keine Daten" -> kostet nichts.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(turn('', 'Dazu liegen keine Angaben vor.', [])),
    );

    // Bewusst KEINE Herkunftsfrage: hier geht es um die Deklaration, nicht
    // um das Herkunfts-Gate.
    const result = await runAgent({ apiKey: 'k', question: 'Welcher Klebstoff?', scope, pack });

    expect(result.used).toEqual([]);
    expect(billableKeys(result).size).toBe(0);
  });

  it('fuehrt den Herkunfts-Abgleich SELBST aus, statt darum zu bitten', async () => {
    // Der Fall aus der Praxis: das Modell arbeitet Weg 1 per SPARQL ab,
    // findet nichts und antwortet "keine Angaben" -- ohne je das
    // Stammzertifikat im anderen Pod angesehen zu haben.
    //
    // Eine Bitte ("rufe match_forest_origin auf") hat es ignoriert und mit
    // SPARQL weitergemacht. Deshalb fuehrt die Schleife das Werkzeug jetzt
    // selbst aus und legt das Ergebnis in den Verlauf.
    const modelTurns: unknown[][] = [
      // 1. Zug: sofort antworten -> Werkzeug laeuft, Antwort zurueckgestellt
      turn('', 'Dazu liegen keine Angaben vor.'),
      // 2. Zug: mit dem beigelegten Ergebnis antworten
      turn('', 'Das Holz stammt aus dem Forstamt Arnsberg [Q1.forstamt].'),
    ];

    let modelCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('/deepseek')) return new Response('{}', { status: 200 });
      const chunks = modelTurns[modelCalls] ?? modelTurns[modelTurns.length - 1];
      modelCalls += 1;
      return sseResponse(chunks);
    });

    const result = await runAgent({
      apiKey: 'k',
      question: 'Woher stammt das Holz?',
      scope,
      pack,
    });

    // Nur zwei Modellrunden -- das Werkzeug lief dazwischen ohne Aufforderung.
    expect(modelCalls).toBe(2);
    expect(result.content).toContain('Arnsberg');
    // Und es steht in der Trace, ist also fuer den Nutzer nachvollziehbar.
    expect(result.traces.some((t) => t.name === 'match_forest_origin')).toBe(true);
  });

  it('haelt das Gate bei Fragen ohne Herkunftsbezug heraus', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse(turn('', 'Fichte [Q1.holzart].')));

    const result = await runAgent({ apiKey: 'k', question: 'Welche Holzart?', scope, pack });

    // Direkt durch -- kein Rueckschicken.
    expect(modelCalls(fetchMock)).toBe(1);
    expect(result.content).toBe('Fichte [Q1.holzart].');
  });

  it('greift hoechstens einmal — die zweite Antwort geht durch', async () => {
    // Verweigert das Modell den Werkzeugaufruf und antwortet erneut, wird es
    // NICHT ein zweites Mal zurueckgeschickt. Sonst haenge die Schleife bis
    // zum Notanker, und der Nutzer wartet fuer nichts.
    //
    // Die tool_call_id muss sich je Runde unterscheiden, sonst beantwortet
    // der Verlauf denselben Aufruf zweimal -- das lehnt die echte API ab.
    let round = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      round += 1;
      return sseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call_${round}`,
                    type: 'function',
                    function: {
                      name: ANSWER_TOOL,
                      arguments: JSON.stringify({
                        antwort: 'Dazu liegen keine Angaben vor.',
                        verwendete_daten: [],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]);
    });

    const result = await runAgent({
      apiKey: 'k',
      question: 'Woher stammt das Holz?',
      scope,
      pack,
    });

    // Genau zwei Runden: einmal zurueckgeschickt, dann durchgelassen.
    expect(modelCalls(fetchMock)).toBe(2);
    expect(result.content).toBe('Dazu liegen keine Angaben vor.');
    expect(result.exhausted).toBe(false);
  });

  it('haelt reasoning_content aus der Antwort heraus', async () => {
    // Anbieter mit eigenem Denkkanal: er wird gesammelt, aber nie angezeigt.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        { choices: [{ delta: { reasoning_content: 'Ich sollte zuerst die Lamelle prüfen…' } }] },
        ...turn('', 'Fichte [Q1.holzart].'),
      ]),
    );

    const result = await runAgent({ apiKey: 'k', question: 'Welche Holzart?', scope, pack });

    expect(result.content).toBe('Fichte [Q1.holzart].');
    expect(result.content).not.toContain('Ich sollte');
  });
});
