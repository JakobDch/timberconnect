import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EpcisEvent } from './epcisService';

const queryEpcisEvents = vi.fn();

vi.mock('./epcisService', async (importOriginal) => {
  // classifyEpcs und collectBizTransactions bleiben ECHT -- an ihnen haengt
  // die Richtungslogik, die hier geprueft wird. Ein Mock davon wuerde die
  // Tests gruen halten und blind machen.
  const actual = await importOriginal<typeof import('./epcisService')>();
  return { ...actual, queryEpcisEvents: (epc: string) => queryEpcisEvents(epc) };
});

const { walkChain, itemRefOf } = await import('./supplyChainWalk');

const PANEL = 'urn:epc:id:sgtin:404711148.0401.718871462389';
const LAMELLE_A = 'urn:epc:id:sgtin:404711146.0212.123456789101';
const LAMELLE_B = 'urn:epc:id:sgtin:404711146.0212.922600357468';
const STAMM = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';
const SAATGUT = 'urn:epc:class:lgtin:404711145.0001.CHARGE7';

/** Die reale Kette: Saatgut -> Stamm -> Lamellen -> Platte. */
const BSP_EVENT: EpcisEvent = {
  type: 'TransformationEvent',
  inputEPCList: [LAMELLE_A, LAMELLE_B],
  outputEPCList: [PANEL],
  bizTransactionList: [{ bizTransaction: 'https://pod.example/bsp' }],
};
const SAEGE_EVENT: EpcisEvent = {
  type: 'TransformationEvent',
  inputEPCList: [STAMM],
  outputEPCList: [LAMELLE_A, LAMELLE_B],
  bizTransactionList: [{ bizTransaction: 'https://pod.example/saege' }],
};
const FAELL_EVENT: EpcisEvent = {
  type: 'TransformationEvent',
  inputQuantityList: [{ epcClass: SAATGUT }],
  outputEPCList: [STAMM],
};

/**
 * Der Server matcht positionsunabhaengig: jedes Ereignis, in dem der gefragte
 * Ident IRGENDWO vorkommt, kommt zurueck. Genau das bildet dieser Mock nach --
 * sonst wuerde der Test die eigentliche Schwierigkeit wegdefinieren.
 */
function eventsFor(epc: string): EpcisEvent[] {
  const all = [BSP_EVENT, SAEGE_EVENT, FAELL_EVENT];
  return all.filter((ev) =>
    [
      ...(ev.inputEPCList ?? []),
      ...(ev.outputEPCList ?? []),
      ...(ev.inputQuantityList ?? []).map((q) => q.epcClass),
    ].includes(epc),
  );
}

beforeEach(() => {
  queryEpcisEvents.mockReset();
  queryEpcisEvents.mockImplementation(async (epc: string) => ({
    events: eventsFor(epc),
    totalBeforeFilter: 0,
    returned: eventsFor(epc).length,
    filteredOut: 0,
    callerWebId: null,
    callerRole: null,
    authEnforced: true,
  }));
});

describe('walkChain — Scope "self"', () => {
  it('bleibt beim erfassten Ident', () => {
    return walkChain(PANEL, 'self').then((r) => {
      expect([...r.epcs]).toEqual([PANEL]);
      expect(r.upstreamEpcs.size).toBe(0);
      expect(r.downstreamEpcs.size).toBe(0);
    });
  });

  it('sammelt trotzdem die Dokumentlinks', async () => {
    // Ohne bizTransaction faende die Ansicht keine Pod-Quellen und bliebe
    // leer statt nur eng.
    const r = await walkChain(PANEL, 'self');
    expect(r.bizTxUrls).toContain('https://pod.example/bsp');
  });

  it('fragt genau einmal ab', async () => {
    await walkChain(PANEL, 'self');
    expect(queryEpcisEvents).toHaveBeenCalledTimes(1);
  });
});

describe('walkChain — Scope "upstream"', () => {
  it('loest die Kette ueber MEHRERE Stufen bis zum Saatgut auf', async () => {
    // Der Kern des Umbaus: vorher endete der Produktpass bei den Lamellen.
    const r = await walkChain(PANEL, 'upstream');
    expect(r.epcs).toContain(LAMELLE_A);
    expect(r.epcs).toContain(STAMM);
    expect(r.epcs).toContain(SAATGUT);
  });

  it('nimmt von einer Lamelle aus die Platte NICHT mit', async () => {
    // Die Platte gab es zum Zeitpunkt der Lamelle noch nicht -- sie als
    // "Herkunft" auszuweisen waere eine Aussage ueber deren Zukunft.
    const r = await walkChain(LAMELLE_A, 'upstream');
    expect(r.epcs).toContain(STAMM);
    expect(r.epcs).not.toContain(PANEL);
  });

  it('laeuft nicht ueber die Platte in die Geschwister-Lamellen', async () => {
    // Ohne Richtungsvererbung landete man hier in fremden Chargen.
    const r = await walkChain(LAMELLE_A, 'upstream');
    expect(r.epcs).not.toContain(LAMELLE_B);
  });
});

describe('walkChain — Scope "full"', () => {
  it('nimmt von einer Lamelle aus die Platte mit', async () => {
    // Die Produzentensicht: was ist aus meinem Material geworden?
    const r = await walkChain(LAMELLE_A, 'full');
    expect(r.epcs).toContain(PANEL);
    expect(r.downstreamEpcs).toContain(PANEL);
  });

  it('haelt beide Richtungen getrennt', async () => {
    const r = await walkChain(LAMELLE_A, 'full');
    expect(r.upstreamEpcs).toContain(STAMM);
    expect(r.downstreamEpcs).toContain(PANEL);
    expect(r.upstreamEpcs).not.toContain(PANEL);
    expect(r.downstreamEpcs).not.toContain(STAMM);
  });

  it('zaehlt nur die erste Stufe als gefundene Ereignisse', async () => {
    // Die Anzeige "N Ereignisse" beschreibt das erfasste Bauteil, nicht die
    // halbe Lieferkette.
    const r = await walkChain(PANEL, 'full');
    expect(r.eventsReturned).toBe(1);
  });
});

describe('walkChain — Robustheit', () => {
  it('laesst die Kette bei einem Abfragefehler nicht abreissen', async () => {
    queryEpcisEvents.mockImplementation(async (epc: string) => {
      if (epc === STAMM) throw new Error('EPCIS nicht erreichbar');
      return {
        events: eventsFor(epc),
        totalBeforeFilter: 0,
        returned: eventsFor(epc).length,
        filteredOut: 0,
        callerWebId: null,
        callerRole: null,
        authEnforced: true,
      };
    });
    const r = await walkChain(PANEL, 'upstream');
    // Bis zum Stamm kommt die Kette trotzdem; nur dahinter bricht sie ab.
    expect(r.epcs).toContain(LAMELLE_A);
    expect(r.epcs).toContain(STAMM);
    expect(r.epcs).not.toContain(SAATGUT);
  });

  it('fragt jeden Ident je Richtung nur einmal ab', async () => {
    await walkChain(PANEL, 'upstream');
    const gefragt = queryEpcisEvents.mock.calls.map((c) => c[0]);
    expect(new Set(gefragt).size).toBe(gefragt.length);
  });

  it('verfolgt je Produktart nur einen Vertreter weiter', async () => {
    // 169 Lamellen stammen aus demselben Vorgang -- die 169. Abfrage liefert
    // dieselben Pods wie die erste.
    await walkChain(PANEL, 'upstream');
    const lamellen = queryEpcisEvents.mock.calls
      .map((c) => c[0])
      .filter((e: string) => itemRefOf(e) === '0212');
    expect(lamellen.length).toBe(1);
  });
});

describe('itemRefOf', () => {
  it('liest die Produktart aus dem SGTIN', () => {
    expect(itemRefOf(PANEL)).toBe('0401');
    expect(itemRefOf(LAMELLE_A)).toBe('0212');
    expect(itemRefOf(STAMM)).toBe('0100');
  });

  it('faellt bei unbekannter Form auf den Ident selbst zurueck', () => {
    expect(itemRefOf('kein-epc')).toBe('kein-epc');
  });
});
