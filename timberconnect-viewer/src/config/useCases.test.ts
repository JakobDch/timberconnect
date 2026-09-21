import { describe, it, expect } from 'vitest';
import {
  USE_CASES,
  findUseCase,
  useCaseAvailability,
  type ProductDataFacts,
} from './useCases';
import type { ChainScope } from '../services/supplyChainWalk';
import type { ProductStage } from '../services/productImageService';

/**
 * Vollstaendige Datenlage -- so bleiben im Test nur Stufe, Umfang und die
 * Frage, ob downstream eine Platte liegt, die Variablen.
 *
 * ``downstream`` ist standardmaessig LEER: die meisten Faelle hier pruefen
 * ein Vorprodukt ohne weiterverarbeitetes Erzeugnis.
 */
function facts(
  stage: ProductStage | null,
  scope: ChainScope,
  downstream: ProductStage[] = [],
): ProductDataFacts {
  return {
    hasProduct: true,
    hasForest: true,
    hasSupplyChain: true,
    hasDeconstruction: true,
    hasCertificates: true,
    hasCertifications: true,
    productStage: stage,
    downstreamStages: downstream,
    scope,
  };
}

const verfuegbar = (
  id: string,
  stage: ProductStage | null,
  scope: ChainScope,
  downstream: ProductStage[] = [],
) => useCaseAvailability(findUseCase(id)!, facts(stage, scope, downstream)).available;

const ALLE_IDS = USE_CASES.map((uc) => uc.id);
/** Vorgabe Folie 8 (17.09.2026): diese beiden gibt es nur fuer BSP. */
const NUR_BSP = ['co2', 'deconstruction'];
const VORSTUFEN: ProductStage[] = ['seedling', 'stem', 'lamella'];
const UMFAENGE: ChainScope[] = ['full', 'upstream', 'self'];

describe('Verfuegbarkeit je Produktart (Vorgabe Praxispartner, Folie 8)', () => {
  it('gibt bei der BSP-Platte alle Faelle frei -- in jedem Umfang', () => {
    for (const scope of UMFAENGE) {
      for (const id of ALLE_IDS) {
        expect(verfuegbar(id, 'clt-panel', scope), `${id}/${scope}`).toBe(true);
      }
    }
  });

  it.each(VORSTUFEN)(
    'gibt bei %s ohne Platte downstream alle Faelle bis auf CO2-Bilanz und Rueckbaubarkeit frei',
    (stage) => {
      for (const scope of UMFAENGE) {
        for (const id of ALLE_IDS) {
          expect(verfuegbar(id, stage, scope), `${id}/${scope}`).toBe(
            !NUR_BSP.includes(id),
          );
        }
      }
    },
  );

  it('behandelt unbestimmbare Produktart wie ein Vorprodukt', () => {
    // Geraten wird nicht (Philosophie von detectProductStage); die
    // vorsichtige Richtung ist die engere.
    expect(verfuegbar('co2', null, 'full')).toBe(false);
    expect(verfuegbar('deconstruction', null, 'full')).toBe(false);
    expect(verfuegbar('dbpp', null, 'full')).toBe(true);
    expect(verfuegbar('origin-proof', null, 'self')).toBe(true);
  });

  it('schraenkt der Umfang allein nichts mehr ein', () => {
    // Bis 17.09.2026 sperrte "Vorangegangene Kette" bei Vorprodukten den
    // Produktpass; seit der Vorgabe entscheidet nur noch die Produktart.
    expect(verfuegbar('dbpp', 'lamella', 'upstream')).toBe(true);
    expect(verfuegbar('documentation', 'stem', 'upstream')).toBe(true);
    expect(verfuegbar('liability', 'seedling', 'self')).toBe(true);
  });

  it.each(VORSTUFEN)(
    'gibt bei %s auch CO2-Bilanz und Rueckbaubarkeit frei, wenn die Platte downstream liegt',
    (stage) => {
      // Der Sinn von "Gesamte Kette": Wer ein Vorprodukt erfasst, bekommt die
      // Angaben der Platte, die daraus entstanden ist. Sie zu verschweigen,
      // waere das Gegenteil dessen, was der Umfang verspricht.
      for (const id of ALLE_IDS) {
        expect(verfuegbar(id, stage, 'full', ['clt-panel']), id).toBe(true);
      }
    },
  );

  it('bleibt bei unbestimmbarer Produktart gesperrt, auch mit Platte downstream', () => {
    // Nicht ganz symmetrisch zu oben, und zwar absichtlich: Ohne bekannte
    // Stufe ist nicht gesagt, dass das Erfasste ueberhaupt ein Vorprodukt
    // DIESER Platte ist. Geraten wird nicht.
    expect(verfuegbar('co2', null, 'full', ['clt-panel'])).toBe(false);
    expect(verfuegbar('deconstruction', null, 'full', ['clt-panel'])).toBe(false);
  });

  it('nennt den Grund je Fall', () => {
    // Ausgegraut ohne Begruendung laesst den Nutzer den Fehler bei sich
    // suchen -- der Text muss sagen, warum.
    const co2 = useCaseAvailability(findUseCase('co2')!, facts('lamella', 'full'));
    expect(co2.reason).toContain('CO₂');
    const rueckbau = useCaseAvailability(
      findUseCase('deconstruction')!,
      facts('stem', 'full'),
    );
    expect(rueckbau.reason).toContain('Rückbaubarkeit');
  });

  it('verweist bei eingeschraenktem Umfang auf die Gesamte Kette', () => {
    // Bei "Vorangegangene Kette" wurde downstream gar nicht gesucht -- es
    // KANN also eine Platte geben. Der Grund muss den Weg nennen, den der
    // Nutzer selbst gehen kann, statt die Sperre als endgueltig darzustellen.
    const co2 = useCaseAvailability(findUseCase('co2')!, facts('lamella', 'upstream'));
    expect(co2.available).toBe(false);
    expect(co2.reason).toContain('Gesamte Kette');
  });
});

describe('Bestehende Datenregeln bleiben wirksam', () => {
  it('sperrt den Herkunftsnachweis ohne Wald- und Lieferkettendaten', () => {
    // Die Produktart hebt die Datenpruefung nicht auf: ist nichts da, hilft
    // auch die BSP-Platte nicht.
    const leer: ProductDataFacts = {
      ...facts('clt-panel', 'full'),
      hasForest: false,
      hasSupplyChain: false,
    };
    expect(useCaseAvailability(findUseCase('origin-proof')!, leer).available).toBe(false);
  });

  it('sperrt die Rueckbaubarkeit auch bei BSP ohne Verbindungsdaten', () => {
    const leer: ProductDataFacts = {
      ...facts('clt-panel', 'full'),
      hasDeconstruction: false,
    };
    expect(useCaseAvailability(findUseCase('deconstruction')!, leer).available).toBe(false);
  });

  it('sperrt ohne Bauteil ausnahmslos alles', () => {
    for (const useCase of USE_CASES) {
      expect(useCaseAvailability(useCase, null).available, useCase.id).toBe(false);
    }
  });
});
