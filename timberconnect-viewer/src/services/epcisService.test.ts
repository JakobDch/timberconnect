import { describe, it, expect } from 'vitest';
import { collectEpcs, collectBizTransactions, type EpcisEvent } from './epcisService';

const PANEL = 'urn:epc:id:sgtin:404711148.0401.718871462389';
const LAMELLE_A = 'urn:epc:id:sgtin:404711146.0212.123456789101';
const LAMELLE_B = 'urn:epc:id:sgtin:404711146.0212.922600357468';

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

describe('collectBizTransactions', () => {
  it('sammelt die Dokumentlinks', () => {
    const urls = collectBizTransactions([
      { bizTransactionList: [{ bizTransaction: 'https://pod.example/uploads/VA-1' }] } as EpcisEvent,
    ]);
    expect(urls).toEqual(['https://pod.example/uploads/VA-1']);
  });
});
