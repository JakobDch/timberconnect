import { describe, it, expect } from 'vitest';
import { citedIndices, billableKeys, stripRawToolCalls, type AgentAnswer } from './agentLoop';

const answer = (content: string, ledger: AgentAnswer['ledger']): AgentAnswer => ({
  content,
  ledger,
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
