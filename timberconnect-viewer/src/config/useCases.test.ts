import { describe, it, expect } from 'vitest';
import {
  USE_CASES,
  findUseCase,
  useCaseAvailability,
  type ProductDataFacts,
} from './useCases';
import type { ChainScope } from '../services/supplyChainWalk';
import type { ProductStage } from '../services/productImageService';

/** Vollstaendige Datenlage -- so bleibt im Test nur der Scope die Variable. */
function facts(stage: ProductStage | null, scope: ChainScope): ProductDataFacts {
  return {
    hasProduct: true,
    hasForest: true,
    hasSupplyChain: true,
    hasDeconstruction: true,
    hasCertificates: true,
    hasCertifications: true,
    productStage: stage,
    scope,
  };
}

const verfuegbar = (id: string, stage: ProductStage | null, scope: ChainScope) =>
  useCaseAvailability(findUseCase(id)!, facts(stage, scope)).available;

const ALLE_IDS = USE_CASES.map((uc) => uc.id);

describe('Anwendungsfaelle im Umfang "Ganze Kette"', () => {
  it('gibt bei der BSP-Platte alle Faelle frei', () => {
    for (const id of ALLE_IDS) {
      expect(verfuegbar(id, 'clt-panel', 'full'), id).toBe(true);
    }
  });

  it('gibt auch bei einem Vorprodukt alle bis auf die CO2-Bilanz frei', () => {
    // Unveraendertes Verhalten: der Umfang schraenkt nichts ein, nur die
    // bestehenden Datenregeln greifen. Die CO2-Bilanz ist unabhaengig davon
    // auf die fertige Platte begrenzt (Awf-Vorgabe).
    for (const id of ALLE_IDS.filter((i) => i !== 'co2')) {
      expect(verfuegbar(id, 'lamella', 'full'), id).toBe(true);
    }
    expect(verfuegbar('co2', 'lamella', 'full')).toBe(false);
  });
});

describe('Anwendungsfaelle im eingeschraenkten Umfang', () => {
  it.each<ChainScope>(['self', 'upstream'])(
    'laesst der BSP-Platte in "%s" alles offen',
    (scope) => {
      // Bei der fertigen Platte ist die Kette nach oben zu Ende -- ihre
      // Angaben sind auch ohne Nachfolger vollstaendig.
      for (const id of ALLE_IDS) {
        expect(verfuegbar(id, 'clt-panel', scope), id).toBe(true);
      }
    },
  );

  it.each<ChainScope>(['self', 'upstream'])(
    'zeigt bei einem Vorprodukt in "%s" nur Herkunft und Assistent',
    (scope) => {
      // Ein Produktpass oder eine Rueckbaubarkeit fuer eine Lamelle waere
      // zwangslaeufig halb befuellt -- das fuehrt nur Luecken vor.
      expect(verfuegbar('origin-proof', 'lamella', scope)).toBe(true);
      expect(verfuegbar('chatbot', 'lamella', scope)).toBe(true);
      for (const id of ALLE_IDS.filter(
        (i) => i !== 'origin-proof' && i !== 'chatbot',
      )) {
        expect(verfuegbar(id, 'lamella', scope), id).toBe(false);
      }
    },
  );

  it('behandelt unbestimmbare Produktart wie ein Vorprodukt', () => {
    // Geraten wird nicht (Philosophie von detectProductStage); die
    // vorsichtige Richtung ist die engere.
    expect(verfuegbar('dbpp', null, 'self')).toBe(false);
    expect(verfuegbar('origin-proof', null, 'self')).toBe(true);
  });

  it('gilt fuer jede Vorstufe, nicht nur fuer Lamellen', () => {
    for (const stage of ['seedling', 'stem', 'lamella'] as ProductStage[]) {
      expect(verfuegbar('deconstruction', stage, 'upstream'), stage).toBe(false);
      expect(verfuegbar('origin-proof', stage, 'upstream'), stage).toBe(true);
    }
  });

  it('nennt den Umfang als Grund und den Weg heraus', () => {
    // Ausgegraut ohne Begruendung laesst den Nutzer den Fehler bei sich
    // suchen -- der Text muss sagen, was zu tun ist.
    const { reason } = useCaseAvailability(
      findUseCase('dbpp')!,
      facts('lamella', 'self'),
    );
    expect(reason).toContain('Ganze Kette');
  });
});

describe('Bestehende Datenregeln bleiben wirksam', () => {
  it('sperrt den Herkunftsnachweis ohne Wald- und Lieferkettendaten', () => {
    // Der Umfang hebt die Datenpruefung nicht auf: ist nichts da, hilft
    // auch "Ganze Kette" nicht.
    const leer: ProductDataFacts = {
      ...facts('clt-panel', 'full'),
      hasForest: false,
      hasSupplyChain: false,
    };
    expect(useCaseAvailability(findUseCase('origin-proof')!, leer).available).toBe(false);
  });

  it('sperrt ohne Bauteil ausnahmslos alles', () => {
    for (const useCase of USE_CASES) {
      expect(useCaseAvailability(useCase, null).available, useCase.id).toBe(false);
    }
  });
});
