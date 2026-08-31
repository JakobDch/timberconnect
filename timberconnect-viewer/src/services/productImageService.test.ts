import { describe, it, expect } from 'vitest';
import { detectProductStage } from './productImageService';
import type { Product } from '../types';
import type { ProductDataResult } from './sparqlService';

/**
 * Die Produktart kommt aus den Stammdaten am erfassten Ident.
 *
 * Die Testdaten bilden nach, was die App laut Konsolenausgabe TATSAECHLICH
 * liefert — nicht, was sie liefern sollte:
 *
 *   data.product = Treffer aus createEpcQuery, Spalten
 *                  ['type', 'subject', 'bizTransaction', 'epcisDoc'].
 *                  KEIN Feld 'epc' — die Abfrage filtert bereits auf die ID.
 *   Typen dort:    tc:EpcisDocument (Traegerdokument) und tc:SawingProcess
 *                  (der Vorgang, aus dem das Stueck hervorging).
 *   data.stem =    23 Spalten mit den Messwerten eines Rundholzes.
 *
 * Eine frueher hier gepruefte Ident-Spalte gab es nie — deshalb blieb die
 * Trefferliste leer und die Erkennung lieferte fuer jede ID nichts.
 */

const TC = 'http://timberconnect.2050.de/ontology#';
const ID = 'urn:epc:id:sgtin:404711146.0212.102562567980';

const product = (id: string): Product => ({ id, name: 'Holzprodukt', woodType: 'Fichte' });

/** Zeile aus createEpcQuery — genau die Spalten der echten Ausgabe. */
const epcRow = (type: string) => ({
  type: { value: type },
  subject: { value: 'https://example.org/s1' },
  bizTransaction: { value: 'https://example.org/tx' },
  epcisDoc: { value: 'https://example.org/doc' },
});

const data = (opts: {
  product?: Array<Record<string, { value: string }>>;
  stem?: Array<Record<string, { value: string }>>;
  scannedEpc?: Array<Record<string, { value: string }>>;
  /** Zahl der ueber EPCIS aufgeloesten Idente (>1 = Vorkette geladen). */
  epcsResolved?: number;
}) =>
  ({
    product: opts.product ?? [],
    stem: opts.stem ?? [],
    ...(opts.scannedEpc ? { scannedEpc: opts.scannedEpc } : {}),
    ...(opts.epcsResolved !== undefined
      ? { epcisInfo: { epc: ID, eventsReturned: 1, eventsFilteredOut: 0, epcsResolved: opts.epcsResolved } }
      : {}),
    forest: [],
    sawmill: [],
    // Plattendaten sind bei JEDEM Scan dabei — sie duerfen nicht abfaerben.
    bspWerk: [{ bspTypBezeichnung: { value: 'BSP 100 C24' } }],
  }) as unknown as ProductDataResult;

describe('Produktart — echte Datenform aus der Konsole', () => {
  it('erkennt Schnittholz am Saegevorgang', () => {
    // Genau der gemeldete Fall: die Lamelle lieferte EpcisDocument +
    // SawingProcess und wurde bisher gar nicht erkannt.
    const d = data({
      product: [
        epcRow(`${TC}EpcisDocument`),
        epcRow(`${TC}EpcisDocument`),
        epcRow(`${TC}SawingProcess`),
      ],
      stem: [{ stemNumber: { value: '1' }, dbh: { value: '32' } }],
    });
    expect(detectProductStage(product(ID), d)).toBe('lamella');
  });

  it('erkennt ein Rundholz an den Stammdaten', () => {
    // Nur Traegerdokumente am Ident, aber Messwerte eines Stammes.
    const d = data({
      product: [epcRow(`${TC}EpcisDocument`)],
      stem: [{ stemNumber: { value: '4711' }, harvestDate: { value: '2026-07-14' } }],
    });
    expect(detectProductStage(product(ID), d)).toBe('stem');
  });

  it('bevorzugt die Produktklasse vor dem Vorgang', () => {
    const d = data({
      product: [epcRow(`${TC}CLT`), epcRow(`${TC}SawingProcess`)],
    });
    expect(detectProductStage(product(ID), d)).toBe('clt-panel');
  });

  it('erkennt tc:Stem als Produktklasse', () => {
    expect(detectProductStage(product(ID), data({ product: [epcRow(`${TC}Stem`)] }))).toBe(
      'stem',
    );
  });

  it('erkennt tc:LogPile', () => {
    expect(
      detectProductStage(product(ID), data({ product: [epcRow(`${TC}LogPile`)] })),
    ).toBe('stem');
  });

  it('laesst sich von Plattendaten NICHT taeuschen', () => {
    // bspWerk ist immer gefuellt; ohne Beleg am Ident darf daraus nichts folgen.
    const d = data({ product: [epcRow(`${TC}EpcisDocument`)] });
    expect(detectProductStage(product(ID), d)).toBeNull();
  });

  it('ist unabhaengig vom Namensraum', () => {
    expect(
      detectProductStage(product(ID), data({ product: [epcRow('https://x.org/o#Stem')] })),
    ).toBe('stem');
  });

  it('versteht die Praefixform tc:SawingProcess', () => {
    expect(
      detectProductStage(product(ID), data({ product: [epcRow('tc:SawingProcess')] })),
    ).toBe('lamella');
  });

  it('liefert null ohne jeden Beleg', () => {
    expect(detectProductStage(product(ID), data({}))).toBeNull();
    expect(detectProductStage(null, data({}))).toBeNull();
    expect(detectProductStage(product(ID), null)).toBeNull();
  });
});

/**
 * Der gemeldete Fall: eine BSP-Platte wurde als "Schnittholz / Lamelle"
 * ausgewiesen.
 *
 * Beim Scan der Platte loest die EPCIS-Abfrage ihr TransformationEvent auf;
 * ``collectEpcs`` liest daraus auch die ``inputEPCList`` — die 169 Lamellen,
 * aus denen sie gepresst wurde. Fuer JEDEN dieser Idente lief createEpcQuery,
 * und alle Treffer landeten in einer gemeinsamen Liste. Darin steht der
 * ``tc:SawingProcess`` der Lamellen gleichberechtigt neben dem ``tc:Panel``
 * der Platte — und weil PROCESS_TO_STAGE griff, gewann die Lamelle.
 */
describe('Produktart — gescannter Ident vs. Vorkette', () => {
  const PANEL = 'urn:epc:id:sgtin:404711148.0401.143138262901';

  it('meldet die BSP-Platte trotz Lamellen-Treffern in der Kette', () => {
    const d = data({
      // Nur der Ident der Platte: tc:Panel aus dem ERP-Herstellungsvorgang.
      scannedEpc: [epcRow(`${TC}Panel`), epcRow(`${TC}EpcisDocument`)],
      // Die verschmolzene Liste ueber alle 170 Idente der Kette. Genau hier
      // stand die Ursache: der Saegevorgang der Lamellen.
      product: [
        epcRow(`${TC}Panel`),
        epcRow(`${TC}SawingProcess`),
        epcRow(`${TC}EpcisDocument`),
      ],
      stem: [{ stemNumber: { value: '1' }, dbh: { value: '32' } }],
      epcsResolved: 170,
    });
    expect(detectProductStage(product(PANEL), d)).toBe('clt-panel');
  });

  it('wertet ausschliesslich den gescannten Ident aus', () => {
    // Selbst wenn die Kette NUR Lamellen-Belege liefert, darf daraus fuer die
    // Platte nichts folgen: ohne eigenen Typ lieber keine Angabe.
    const d = data({
      scannedEpc: [epcRow(`${TC}EpcisDocument`)],
      product: [epcRow(`${TC}SawingProcess`)],
      epcsResolved: 170,
    });
    expect(detectProductStage(product(PANEL), d)).toBeNull();
  });

  it('haelt die Stammdaten der Vorkette von der Platte fern', () => {
    // Zu jeder Platte gehoeren die Stammdaten ihrer Vorkette. Solange eine
    // Kette aufgeloest wurde, darf Stufe 3 daraus kein Rundholz ableiten.
    const d = data({
      scannedEpc: [epcRow(`${TC}EpcisDocument`)],
      stem: [{ stemNumber: { value: '4711' }, dbh: { value: '32' } }],
      epcsResolved: 170,
    });
    expect(detectProductStage(product(PANEL), d)).toBeNull();
  });

  it('erkennt ein Rundholz weiterhin, wenn keine Kette aufgeloest wurde', () => {
    // Gegenprobe: ohne Vorkette (epcsResolved = 1, nur der Ident selbst)
    // gehoeren die Stammdaten zum gescannten Stamm.
    const d = data({
      scannedEpc: [epcRow(`${TC}EpcisDocument`)],
      stem: [{ stemNumber: { value: '4711' }, dbh: { value: '32' } }],
      epcsResolved: 1,
    });
    expect(detectProductStage(product(ID), d)).toBe('stem');
  });

  it('laesst die Leistungserklaerung die Platte nicht verdecken', () => {
    // Der zweite gemeldete Fall: Am Ident der Platte haengen ZWEI Subjekte --
    // der ERP-Knoten (tc:Panel) und die Leistungserklaerung, die per
    // materialEpc auf dieselbe Platte verweist. Welches zuerst kommt, haengt
    // an der Reihenfolge der Quellen; die Produktart darf davon nicht
    // abhaengen.
    const d = data({
      scannedEpc: [epcRow(`${TC}DeclarationOfPerformance`), epcRow(`${TC}Panel`)],
      epcsResolved: 170,
    });
    expect(detectProductStage(product(PANEL), d)).toBe('clt-panel');
  });

  it('meldet nichts, wenn NUR Belegdokumente den Ident tragen', () => {
    // Genau der beobachtete Zustand: die Leistungserklaerung kam an, der
    // ERP-Auszug nicht. Eine Leistungserklaerung ist keine Produktart --
    // dann lieber keine Angabe als eine erfundene.
    const d = data({
      scannedEpc: [epcRow(`${TC}DeclarationOfPerformance`)],
      epcsResolved: 170,
    });
    expect(detectProductStage(product(PANEL), d)).toBeNull();
  });

  it('faellt ohne scannedEpc auf product zurueck', () => {
    // traceId-Abruf und aeltere Aufrufer setzen das Feld nicht; dort ist die
    // Liste nicht vermischt und bleibt die richtige Quelle.
    const d = data({ product: [epcRow(`${TC}Panel`)] });
    expect(detectProductStage(product(PANEL), d)).toBe('clt-panel');
  });
});
