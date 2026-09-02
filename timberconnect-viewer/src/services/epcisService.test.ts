import { describe, it, expect } from 'vitest';
import {
  collectEpcs,
  collectBizTransactions,
  classifyEpcs,
  type EpcisEvent,
} from './epcisService';

const PANEL = 'urn:epc:id:sgtin:404711148.0401.718871462389';
const LAMELLE_A = 'urn:epc:id:sgtin:404711146.0212.123456789101';
const LAMELLE_B = 'urn:epc:id:sgtin:404711146.0212.922600357468';
const STAMM = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';
const SAATGUT = 'urn:epc:class:lgtin:404711145.0001.CHARGE7';

describe('collectEpcs', () => {
  it('liest die Vorprodukte aus inputEPCList eines TransformationEvent', () => {
    // Der reale Fall: die BSP-Produktion ist ein TransformationEvent
    // (Lamellen rein, Platte raus) und hat GAR KEINE epcList. Wurde die
    // inputEPCList uebersehen, blieb die gesamte Vorkette unsichtbar und der
    // Assistent durfte die Lamellen nicht abfragen.
    const events: EpcisEvent[] = [
      {
        type: 'TransformationEvent',
        inputEPCList: [LAMELLE_A, LAMELLE_B],
        outputEPCList: [PANEL],
      },
    ];
    const epcs = collectEpcs(events);
    expect(epcs).toEqual(expect.arrayContaining([LAMELLE_A, LAMELLE_B, PANEL]));
  });

  it('liest weiterhin epcList und childEPCs', () => {
    const epcs = collectEpcs([{ epcList: [PANEL], childEPCs: [LAMELLE_A] } as EpcisEvent]);
    expect(epcs).toEqual(expect.arrayContaining([PANEL, LAMELLE_A]));
  });

  it('liest epcClass aus allen Mengenlisten', () => {
    const epcs = collectEpcs([
      {
        quantityList: [{ epcClass: 'urn:epc:class:lgtin:1.2.A' }],
        inputQuantityList: [{ epcClass: 'urn:epc:class:lgtin:1.2.B' }],
        outputQuantityList: [{ epcClass: 'urn:epc:class:lgtin:1.2.C' }],
      } as EpcisEvent,
    ]);
    expect(epcs).toEqual(
      expect.arrayContaining([
        'urn:epc:class:lgtin:1.2.A',
        'urn:epc:class:lgtin:1.2.B',
        'urn:epc:class:lgtin:1.2.C',
      ]),
    );
  });

  it('dedupliziert ueber mehrere Events', () => {
    const epcs = collectEpcs([
      { outputEPCList: [PANEL] } as EpcisEvent,
      { epcList: [PANEL] } as EpcisEvent,
    ]);
    expect(epcs).toEqual([PANEL]);
  });

  it('kommt mit einem Event ohne jede Liste zurecht', () => {
    expect(collectEpcs([{ type: 'ObjectEvent' } as EpcisEvent])).toEqual([]);
  });
});

describe('classifyEpcs — Richtung relativ zum Bezugs-Ident', () => {
  // Das BSP-Ereignis: 169 Lamellen rein, eine Platte raus. Dasselbe Ereignis
  // kommt beim Fragen nach der Platte UND beim Fragen nach einer Lamelle
  // zurueck -- der Server matcht positionsunabhaengig. Erst der Bezugs-Ident
  // entscheidet, in welche Richtung es zeigt.
  const bspEvent: EpcisEvent = {
    type: 'TransformationEvent',
    inputEPCList: [LAMELLE_A, LAMELLE_B],
    outputEPCList: [PANEL],
  };

  it('sieht vom Erzeugnis aus das Vormaterial (upstream)', () => {
    const { upstream, downstream } = classifyEpcs(bspEvent, PANEL);
    expect(upstream).toEqual([LAMELLE_A, LAMELLE_B]);
    expect(downstream).toEqual([]);
  });

  it('sieht vom Vormaterial aus das Erzeugnis (downstream)', () => {
    // DER Fall, der die Trennung noetig macht: Wer eine Lamelle scannt, soll
    // in "Herkunft" NICHT die Platte sehen -- die gab es zum Zeitpunkt der
    // Lamelle noch gar nicht.
    const { upstream, downstream } = classifyEpcs(bspEvent, LAMELLE_A);
    expect(downstream).toEqual([PANEL]);
    expect(upstream).toEqual([]);
  });

  it('nennt die Geschwister-Lamellen NICHT upstream', () => {
    // Sonst liefe ein Upstream-Walk von einer Lamelle ueber die Platte in
    // deren 168 andere Lamellen -- also in fremde Chargen.
    const { upstream, downstream } = classifyEpcs(bspEvent, LAMELLE_A);
    expect(upstream).not.toContain(LAMELLE_B);
    expect(downstream).not.toContain(LAMELLE_B);
  });

  it('behandelt Mengenidente wie EPC-Listen', () => {
    // Der Faellvorgang: Saatgut-Charge (LGTIN) rein, Rundholz-SGTINs raus.
    const faellung: EpcisEvent = {
      type: 'TransformationEvent',
      inputQuantityList: [{ epcClass: SAATGUT }],
      outputEPCList: [STAMM],
    };
    expect(classifyEpcs(faellung, STAMM).upstream).toEqual([SAATGUT]);
    expect(classifyEpcs(faellung, SAATGUT).downstream).toEqual([STAMM]);
  });

  it('trifft keine Aussage, wenn der Bezug gar nicht vorkommt', () => {
    // Bei einem Walk ueber mehrere Idente koennen Ereignisse hereinkommen,
    // die einen ANDEREN Ident betreffen. Dann ist keine Richtung ableitbar.
    const { upstream, downstream, sibling } = classifyEpcs(bspEvent, STAMM);
    expect(upstream).toEqual([]);
    expect(downstream).toEqual([]);
    expect(sibling).toEqual([LAMELLE_A, LAMELLE_B, PANEL]);
  });

  it('behandelt ObjectEvent-Idente als Geschwister', () => {
    // Erfassung, kein Materialfluss: alle Idente stehen auf derselben Stufe.
    const objectEvent: EpcisEvent = {
      type: 'ObjectEvent',
      epcList: [LAMELLE_A, LAMELLE_B],
    };
    const { upstream, downstream, sibling } = classifyEpcs(objectEvent, LAMELLE_A);
    expect(upstream).toEqual([]);
    expect(downstream).toEqual([]);
    expect(sibling).toEqual([LAMELLE_A, LAMELLE_B]);
  });

  it('kommt mit einem Ereignis ohne jede Liste zurecht', () => {
    const leer = classifyEpcs({ type: 'ObjectEvent' } as EpcisEvent, PANEL);
    expect(leer).toEqual({ upstream: [], downstream: [], sibling: [] });
  });
});

describe('collectBizTransactions', () => {
  it('sammelt die Dokumentlinks', () => {
    const urls = collectBizTransactions([
      { bizTransactionList: [{ bizTransaction: 'https://pod.example/uploads/VA-1' }] } as EpcisEvent,
    ]);
    expect(urls).toEqual(['https://pod.example/uploads/VA-1']);
  });
});
