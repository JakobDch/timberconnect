import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildWelcomeMessage } from './prompts';
import type { EpcScope } from './epcScopeService';
import type { SchemaPack } from './schemaContextService';

const PANEL = 'urn:epc:id:sgtin:404711148.0401.718871462389';
const LAMELLEN = Array.from(
  { length: 40 },
  (_, i) => `urn:epc:id:sgtin:404711146.0212.${String(i).padStart(9, '0')}`,
);
const STAMM = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';

const pack: SchemaPack = {
  classes: [],
  prompt: 'vlex:BSPPanel vlex:artikel xsd:string .',
  prefixes: 'PREFIX tc: <http://timberconnect.2050.de/ontology#>',
  notes: [],
};

const scope = (over: Partial<EpcScope> = {}): EpcScope => ({
  epc: PANEL,
  relatedEpcs: new Set([PANEL, ...LAMELLEN, STAMM]),
  sources: ['https://pod.example/a.ttl'],
  events: [],
  eventsReturned: 1,
  eventsFilteredOut: 0,
  degraded: false,
  notes: [],
  ...over,
});

describe('Systemprompt', () => {
  it('nennt den gescannten Ident und das Datenmodell', () => {
    const p = buildSystemPrompt({ scope: scope(), pack });
    expect(p).toContain(PANEL);
    expect(p).toContain('vlex:BSPPanel');
    expect(p).toContain('PREFIX tc:');
  });

  it('gruppiert die Vorkette nach Verarbeitungsstufe statt 40 Zeilen aufzulisten', () => {
    const p = buildSystemPrompt({ scope: scope(), pack });
    expect(p).toContain('Itemreference 0212');
    expect(p).toContain('Itemreference 0100');
    // Gekuerzt: nicht jede der 40 Lamellen steht im Prompt.
    expect(p).toContain('weitere mit demselben Muster');
    const genannt = LAMELLEN.filter((id) => p.includes(id)).length;
    expect(genannt).toBeLessThan(LAMELLEN.length);
  });

  it('erklärt, dass die Forstdaten an der Stamm-Stufe hängen', () => {
    const p = buildSystemPrompt({ scope: scope(), pack });
    expect(p).toMatch(/MEHRSTUFIG/);
    expect(p).toMatch(/Forstamt/);
  });

  it('unterscheidet Trace-Id von GS1-EPC', () => {
    const gs1 = buildSystemPrompt({ scope: scope(), pack });
    expect(gs1).toMatch(/GS1-EPC/);

    const trace = buildSystemPrompt({
      scope: scope({ epc: 'TC-2024-001', relatedEpcs: new Set(['TC-2024-001']) }),
      pack,
    });
    expect(trace).toMatch(/tc:traceId/);
  });

  it('weist auf gefilterte Ereignisse hin, statt sie zu verschweigen', () => {
    const p = buildSystemPrompt({ scope: scope({ eventsFilteredOut: 3 }), pack });
    expect(p).toMatch(/3 EPCIS-Ereignis/);
  });

  it('verlangt eine auf die Frage zugeschnittene Antwort statt des ganzen Fundes', () => {
    // Der Prompt sagte frueher unbedingt "ZEIGE die Daten" und "Fasse NIE
    // zusammen" -- worauf simple Fragen ganze Datenblaetter zurueckbekamen.
    const p = buildSystemPrompt({ scope: scope(), pack });
    expect(p).toMatch(/nur die/i);
    expect(p).toMatch(/Frage nach EINEM Merkmal/);
    expect(p).not.toMatch(/Fasse NIE zusammen/);
  });

  it('haelt die Arbeitsweise aus der Antwort heraus', () => {
    const p = buildSystemPrompt({ scope: scope(), pack });
    expect(p).toContain('Was intern bleibt');
    // Der alte Prompt verlangte woertlich das Gegenteil.
    expect(p).not.toMatch(/nenne immer, welcher gegriffen hat/i);
    expect(p).toMatch(/gehört NICHT in die Antwort/);
  });

  it('nimmt die Belege ausdruecklich von der Verschwiegenheit aus', () => {
    // Sonst wuerde das Modell die Zitate als "interne Mechanik" mitunterdruecken
    // -- und ohne Zitate wird fail-closed alles berechnet.
    const p = buildSystemPrompt({ scope: scope(), pack });
    expect(p).toMatch(/einzige Ausnahme/);
  });

  it('ist ein vollständiger Text ohne Platzhalterreste', () => {
    // Faengt ein zerbrochenes Template-Literal ab: Backticks im Prompt (etwa
    // in einer Markdown-Tabelle) beenden sonst den String, und der Fehler
    // faellt erst beim Build auf.
    const p = buildSystemPrompt({ scope: scope(), pack });
    expect(p.length).toBeGreaterThan(500);
    expect(p).not.toContain('undefined');
    expect(p).not.toContain('[object Object]');
  });
});

/**
 * Der Weg von einem Stamm-Ident zu den Forstdaten.
 *
 * Gemessen an den echten Daten (Konvertierung + Ident-Injektion der
 * StanForD-HPR-Datei): der Ident landet auf dem ABSCHNITT
 * (…/stem/56400/log/1), Forstamt/Revier/Einschlagdatum stehen am STAMM
 * (…/stem/56400). Ohne tc:belongsToStem liefert jede Abfrage null Zeilen --
 * der Assistent meldete daraufhin faelschlich "keine Herkunftsdaten",
 * obwohl "Forstamt Oberes Sauerland" im Pod steht.
 */
describe('Waldherkunft — der Sprung vom Abschnitt zum Stamm', () => {
  it('nennt tc:belongsToStem als Brücke', () => {
    expect(buildSystemPrompt({ scope: scope(), pack })).toContain('tc:belongsToStem');
  });

  it('nennt den Weg zur Einschlagsposition über tc:hasMachinePosition', () => {
    const p = buildSystemPrompt({ scope: scope(), pack });
    expect(p).toContain('tc:hasMachinePosition');
    expect(p).toMatch(/geo:lat/);
  });

  it('warnt vor der leeren Bündel-Ressource tc:EpcisDocument', () => {
    // Sie traegt tc:epc fuer ALLE Idente eines Uploads, aber keine Fachdaten.
    // Ein Treffer darauf sieht nach Erfolg aus und liefert leere Spalten.
    expect(buildSystemPrompt({ scope: scope(), pack })).toContain('tc:EpcisDocument');
  });

  it('weist bei wiederholt leeren Ergebnissen auf die Klassen-Sondierung hin', () => {
    const p = buildSystemPrompt({ scope: scope(), pack });
    expect(p).toMatch(/Strukturfehler, nicht Datenlücke/);
    expect(p).toMatch(/a tc:Stem/);
  });
});

describe('Begrüßung', () => {
  it('nennt den Produktnamen', () => {
    expect(buildWelcomeMessage(scope(), 'BSP-Platte')).toContain('BSP-Platte');
  });

  it('wiederholt die degradierte Warnung NICHT — dafür gibt es das Banner', () => {
    const w = buildWelcomeMessage(scope({ degraded: true }), 'X');
    expect(w).not.toMatch(/Herkunftsprüfung konnte nicht/);
  });

  it('meldet, wenn gar keine Quelle erreichbar ist', () => {
    const w = buildWelcomeMessage(scope({ sources: [] }), 'X');
    expect(w).toMatch(/keine Datenquelle erreichbar/i);
  });
});
