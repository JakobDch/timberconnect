import { describe, it, expect } from 'vitest';
import { classifyAddressParts, mapToProvenance, parseDate } from './provenanceMapper';
import type { ProductDataResult, SparqlBinding } from './sparqlService';
import type { Product, SupplyChainStep } from '../types';

/**
 * Herkunftsnachweis im Umfang "Vorangegangene Kette" fuer eine Lamelle
 * (Befund 18.09.2026): Saegewerk hiess nur "Saegewerk" ohne Anschrift, das
 * Saegewerk stand zusaetzlich als Holzwerkstoffproduzent, und das Datum des
 * Rundholz-Auftrags stand im Fremdformat.
 */

const row = (values: Record<string, string>): SparqlBinding =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }]));

function data(partial: Partial<ProductDataResult>): ProductDataResult {
  return {
    product: [],
    stem: [],
    forest: [],
    sawmill: [],
    bspWerk: [],
    transportOrders: [],
    certificates: [],
    declarations: [],
    epcisEvents: [],
    ...partial,
  } as unknown as ProductDataResult;
}

const product: Product = { id: 'urn:epc:id:sgtin:1.2.L1', name: 'Lamelle', woodType: 'Fichte' };

/** So wie productMapper die Stationen mit Gattungsnamen auffuellt. */
const steps: SupplyChainStep[] = [
  { id: 3, stage: 'sawmill', company: 'Sägewerk', date: '', location: '', description: '', details: [], icon: 'factory' },
  { id: 4, stage: 'manufacturer', company: 'BSP-Werk', date: '', location: '', description: '', details: [], icon: 'building' },
] as SupplyChainStep[];

/**
 * Partner-Feedback 22.09.2026: in der Akteurskarte des Saegewerks standen
 * Name und Anschrift vertauscht -- "Im Kissen 19" fett als Firma, die Firma
 * klein darunter. Ursache war die Reihenfolge im Adress-Beutel: eine Strasse
 * ohne Stichwort ("Kissen" ist keine "-strasse") fiel durch beide Muster und
 * beanspruchte als erster Rest den Namen.
 */
describe('classifyAddressParts', () => {
  it('erkennt die Firma an der Rechtsform, auch wenn die Strasse zuerst kommt', () => {
    const parts = classifyAddressParts([
      'Im Kissen 19',
      'EGGER Sägewerk Brilon GmbH',
      '59929 Brilon',
    ]);

    expect(parts.name).toBe('EGGER Sägewerk Brilon GmbH');
    expect(parts.street).toBe('Im Kissen 19');
    expect(parts.city).toBe('59929 Brilon');
  });

  it('sortiert eine Strasse mit Stichwort weiterhin richtig', () => {
    const parts = classifyAddressParts([
      'Poppensieker & Derix GmbH & Co.KG',
      'Industriestraße 24',
      '49492 Westerkappeln-Velpe',
    ]);

    expect(parts.name).toBe('Poppensieker & Derix GmbH & Co.KG');
    expect(parts.street).toBe('Industriestraße 24');
    expect(parts.city).toBe('49492 Westerkappeln-Velpe');
  });

  it('haelt einen Ortsnamen ohne Hausnummer vom Strassenfeld fern', () => {
    const parts = classifyAddressParts(['Forstbetrieb A1 GmbH', 'Arnsberg']);

    expect(parts.name).toBe('Forstbetrieb A1 GmbH');
    expect(parts.street).toBe('Arnsberg');
  });
});

describe('parseDate', () => {
  it('liest das Datum der Rundholz-Vorlage (TT/MM/JJJJ)', () => {
    expect(parseDate('20/07/2026')).toBe('20.07.2026');
    expect(parseDate('5/7/2026')).toBe('05.07.2026');
  });

  it('laesst ISO wie bisher', () => {
    expect(parseDate('2026-08-10')).toBe('10.08.2026');
  });
});

describe('mapToProvenance -- Saegewerk', () => {
  it('nimmt Firma und Anschrift aus der Zeile, die sie traegt -- nicht aus der ersten', () => {
    // Erste Zeile: Maschinendaten (nur Bestimmungssaegewerk). Zweite: der
    // Rundholz-Auftrag mit Firma und Anschrift.
    const result = mapToProvenance(
      data({
        sawmill: [
          row({ destinationProduct: 'Fichte Kurzholz BC' }),
          row({
            company: 'EGGER Sägewerk Brilon GmbH',
            street: 'Im Kissen 19',
            postcode: '59929',
            city: 'Brilon',
            deliveryDate: '20/07/2026',
          }),
        ],
      }),
      product,
      steps,
    );
    const sawmill = result.actors.find((a) => a.kind === 'sawmill');
    expect(sawmill?.name).toBe('EGGER Sägewerk Brilon GmbH');
    expect(sawmill?.address).toBe('Im Kissen 19, 59929 Brilon');
    expect(sawmill?.transportDate).toBe('20.07.2026');
  });

  it('sortiert den Adress-Beutel der Leistungserklaerung, wenn kein Auftrag da ist', () => {
    // Ohne Rundholz-Auftrag kommt die Anschrift aus tc:manufacturerAddress --
    // drei Zeilen mit demselben ?street, in beliebiger Reihenfolge.
    const result = mapToProvenance(
      data({
        sawmill: [
          row({ company: 'EGGER Sägewerk Brilon GmbH', street: '59929 Brilon' }),
          row({ company: 'EGGER Sägewerk Brilon GmbH', street: 'EGGER Sägewerk Brilon GmbH' }),
          row({ company: 'EGGER Sägewerk Brilon GmbH', street: 'Im Kissen 19' }),
        ],
      }),
      product,
      steps,
    );
    const sawmill = result.actors.find((a) => a.kind === 'sawmill');
    expect(sawmill?.address).toContain('59929 Brilon');
    expect(sawmill?.address).not.toContain('GmbH');
  });

  it('laesst den Holzwerkstoffproduzenten weg, wenn nur der Gattungsname bliebe', () => {
    // Umfang "Vorangegangene Kette" fuer eine Lamelle: keine Werksdaten.
    // "BSP-Werk" als Akteur waere erfunden -- und der Geocoder suchte danach.
    const result = mapToProvenance(
      data({ sawmill: [row({ company: 'EGGER Sägewerk Brilon GmbH' })] }),
      product,
      steps,
    );
    expect(result.actors.map((a) => a.kind)).toEqual(['sawmill']);
  });

  it('nutzt das Bestimmungssaegewerk der Maschinendaten als letzten Namen', () => {
    const result = mapToProvenance(
      data({ sawmill: [row({ destinationProduct: 'Sägewerk Brilon' })] }),
      product,
      steps,
    );
    expect(result.actors.find((a) => a.kind === 'sawmill')?.name).toBe('Sägewerk Brilon');
  });
});

describe('mapToProvenance -- Holzwerkstoffproduzent', () => {
  it('liest Firma und Volumen aus verschiedenen Zeilen derselben Abfrage', () => {
    // Panel-Zeile traegt die Produktfelder, DoP-Zeile den Hersteller.
    const result = mapToProvenance(
      data({
        bspWerk: [
          row({ nettoVolumen: '3.02', produktionsstandort: 'Westerkappeln' }),
          row({ company: 'Poppensieker & Derix GmbH & Co.KG' }),
        ],
      }),
      product,
      steps,
    );
    const manufacturer = result.actors.find((a) => a.kind === 'manufacturer');
    expect(manufacturer?.name).toBe('Poppensieker & Derix GmbH & Co.KG');
    expect(manufacturer?.address).toBe('Westerkappeln');
    expect(result.volumeM3).toBe('3.02');
  });
});
