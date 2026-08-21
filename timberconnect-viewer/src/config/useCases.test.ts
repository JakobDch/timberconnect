import { describe, it, expect } from 'vitest';
import { Hammer } from 'lucide-react';
import {
  USE_CASES,
  findUseCase,
  isAvailable,
  useCaseAvailability,
  type ProductDataFacts,
  type UseCaseDefinition,
} from './useCases';

const FULL: ProductDataFacts = {
  hasProduct: true,
  hasForest: true,
  hasSupplyChain: true,
  hasDeconstruction: true,
  hasCertificates: true,
  hasCertifications: true,
  productStage: 'clt-panel',
};

const EMPTY: ProductDataFacts = {
  hasProduct: false,
  hasForest: false,
  hasSupplyChain: false,
  hasDeconstruction: false,
  hasCertificates: false,
  hasCertifications: false,
  productStage: null,
};

const uc = (id: string) => findUseCase(id)!;

describe('Verfuegbarkeit je Bauteil', () => {
  it('gibt bei vollstaendigen Daten alle gebauten Faelle frei', () => {
    for (const id of ['dbpp', 'co2', 'origin-proof', 'deconstruction']) {
      expect(useCaseAvailability(uc(id), FULL).available).toBe(true);
    }
  });

  it('sperrt den Herkunftsnachweis ohne Wald- und Lieferkettendaten', () => {
    const r = useCaseAvailability(uc('origin-proof'), EMPTY);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/Wald|Lieferketten/i);
  });

  it('gibt den Herkunftsnachweis frei, sobald eine der beiden Quellen da ist', () => {
    expect(
      useCaseAvailability(uc('origin-proof'), { ...EMPTY, hasForest: true }).available,
    ).toBe(true);
    expect(
      useCaseAvailability(uc('origin-proof'), { ...EMPTY, hasSupplyChain: true })
        .available,
    ).toBe(true);
  });

  it('sperrt die Rueckbaubarkeit ohne Verbindungsdaten', () => {
    const r = useCaseAvailability(uc('deconstruction'), EMPTY);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/Rückbau|Verbindung/i);
  });

  it('nennt bei ungebauten Faellen die Entwicklung als Grund', () => {
    // Seit dem 21.08.2026 hat JEDER Eintrag der Registry ein ``view`` -- die
    // drei "Demnaechst"-Platzhalter sind entfernt. Die Mechanik bleibt aber
    // bestehen und wird hier an einem konstruierten Eintrag geprueft, damit
    // sie nicht unbemerkt zerfaellt, bevor der naechste Fall sie braucht.
    const ungebaut: UseCaseDefinition = {
      id: 'noch-nicht-gebaut',
      title: 'Noch nicht gebaut',
      description: 'Platzhalter fuer den Test',
      icon: Hammer,
    };
    const r = useCaseAvailability(ungebaut, FULL);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/Entwicklung/i);
  });

  it('haelt die Registry frei von Platzhaltern', () => {
    // Gegenprobe zur Awf-Vorgabe: nicht umgesetzte Faelle sollen gar nicht
    // erst in der Anzeige erscheinen.
    for (const useCase of USE_CASES) {
      expect(isAvailable(useCase), `${useCase.id} hat kein view`).toBe(true);
    }
  });

  it('gibt den Assistenten frei, sobald Produktdaten vorliegen', () => {
    expect(useCaseAvailability(uc('chatbot'), FULL).available).toBe(true);
  });

  it('sperrt den Assistenten ohne Produktdaten', () => {
    const r = useCaseAvailability(uc('chatbot'), EMPTY);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/keine Daten/i);
  });

  it('liefert fuer jeden gesperrten Fall eine Begruendung', () => {
    for (const useCase of USE_CASES) {
      for (const facts of [FULL, EMPTY, null]) {
        const r = useCaseAvailability(useCase, facts);
        if (!r.available) {
          expect(r.reason, `${useCase.id} ohne Begruendung`).toBeTruthy();
        }
      }
    }
  });

  it('erlaubt ohne Bauteil nur eigenstaendige Ansichten', () => {
    expect(useCaseAvailability(uc('co2'), null).available).toBe(true);
    const r = useCaseAvailability(uc('dbpp'), null);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/Bauteil erfassen/i);
  });

  // Awf-Vorgabe (Rueckmeldung Anni, 18.08.2026): CO2-Bilanz nur fuer die
  // fertige BSP-Platte -- fuer Vorprodukte verschoeben sich die Module.
  it('sperrt die CO2-Bilanz fuer Vorprodukte', () => {
    for (const stage of ['stem', 'lamella', 'seedling'] as const) {
      const r = useCaseAvailability(uc('co2'), { ...FULL, productStage: stage });
      expect(r.available, `co2 darf fuer ${stage} nicht verfuegbar sein`).toBe(false);
      expect(r.reason).toMatch(/BSP-Platte/i);
    }
  });

  it('sperrt die CO2-Bilanz bei unbestimmbarer Produktart', () => {
    const r = useCaseAvailability(uc('co2'), { ...FULL, productStage: null });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/nicht bestimmbar/i);
  });

  it('gibt die CO2-Bilanz fuer die BSP-Platte frei', () => {
    expect(
      useCaseAvailability(uc('co2'), { ...EMPTY, productStage: 'clt-panel' }).available,
    ).toBe(true);
  });
});
