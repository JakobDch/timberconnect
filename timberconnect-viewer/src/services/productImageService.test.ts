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
}) =>
  ({
    product: opts.product ?? [],
    stem: opts.stem ?? [],
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
