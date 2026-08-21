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
