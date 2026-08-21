import { describe, it, expect } from 'vitest';
import { Parser } from 'sparqljs';
import { mapToDbpp, type DbppCarbonInput } from './dbppMapper';
import { createDbppQuery } from './sparqlQueries';
import type { ProductDataResult, SparqlBinding } from './sparqlService';

const lit = (value: string): { value: string; type: string } => ({
  value,
  type: 'Literal',
});

const iri = (value: string): { value: string; type: string } => ({
  value,
  type: 'IRI',
});

/** Minimales ProductDataResult -- nur die Felder, die der Mapper liest. */
function dataWith(
  dbpp: SparqlBinding[] = [],
  stem: SparqlBinding[] = [],
  forest: SparqlBinding[] = [],
): ProductDataResult {
  return { dbpp, stem, forest } as unknown as ProductDataResult;
}

/** Alle Merkmale einer Antwort flach, zum bequemen Nachschlagen. */
function fieldsOf(data: ReturnType<typeof mapToDbpp>) {
  return data.categories.flatMap((category) => category.fields);
}

function fieldById(data: ReturnType<typeof mapToDbpp>, id: string) {
  const found = fieldsOf(data).find((f) => f.id === id);
  if (!found) throw new Error(`Merkmal ${id} fehlt`);
  return found;
}

/** ERP-Panel, wie erp_bsp.rml.ttl es erzeugt. */
const PANEL_ROW: SparqlBinding = {
  panel: iri('http://timberconnect.2050.de/resource/bspPanel/1'),
  panelEpc: iri('urn:epc:id:sgtin:404711148.0401.718871462389'),
  artikel: lit('X-LAM L-150/5s'),
  panelHoehe: lit('150'),
  panelBreite: lit('2.95'),
  panelLaenge: lit('11.8'),
  panelVolumen: lit('5.22'),
  panelHolzart: lit('Fichte'),
  panelNorm: lit('EN 16351'),
  panelSchichten: lit('5'),
  panelStandort: lit('Werk Ost'),
  panelDatum: lit('2026-03-02T08:00:00'),
} as unknown as SparqlBinding;

/** Leistungserklaerung BSP -- erkennbar am Feuchtegehalt. */
const BSP_DOP_ROW: SparqlBinding = {
  bspDop: iri('http://timberconnect.2050.de/resource/dopbsp/1'),
  bspMoisture: lit('12 %'),
  bspStrengthClass: lit('C24'),
  bspAdhesiveType: lit('PUR'),
  bspFireClass: lit('D-s2, d0'),
  bspManufacturer: lit('Holzwerk Westfalen GmbH'),
  bspAddress: lit('Sägewerkstraße 5'),
  bspNotifiedBody: lit('MPA Stuttgart'),
  bspConformity: lit('System 1'),
} as unknown as SparqlBinding;

/** Zweite Adresszeile -- der Beutel kommt mehrfach am selben Praedikat. */
const BSP_DOP_ADDRESS_ROW: SparqlBinding = {
  bspDop: iri('http://timberconnect.2050.de/resource/dopbsp/1'),
  bspMoisture: lit('12 %'),
  bspAddress: lit('33098 Paderborn'),
} as unknown as SparqlBinding;

/** Leistungserklaerung Schnittholz -- erkennbar an der Zertifikatsnummer. */
const SAWN_DOP_ROW: SparqlBinding = {
  dop: iri('http://timberconnect.2050.de/resource/dop/1'),
  dopZertifikatsnummer: lit('0123-CPR-4711'),
  dopSpecies: lit('Fichte'),
  dopDensity: lit('420'),
} as unknown as SparqlBinding;

const STEM_ROW: SparqlBinding = {
  stem: iri('http://timberconnect.2050.de/resource/stem/1'),
  forestryOffice: lit('Forstamt Beispiel'),
  district: lit('Revier Nord'),
  harvestDate: lit('2025-11-14T09:30:00'),
  fsc: lit('ja'),
  lat: lit('51.7189'),
  long: lit('8.7575'),
} as unknown as SparqlBinding;

const FULL_CARBON: DbppCarbonInput = {
  total: -2145.6,
  isPartial: false,
  missingModules: [],
};

describe('createDbppQuery', () => {
  it('ist syntaktisch gueltiges SPARQL', () => {
    expect(() => new Parser().parse(createDbppQuery())).not.toThrow();
  });

  it('trennt die beiden Leistungserklaerungen ueber ihr exklusives Praedikat', () => {
    // Beide tragen tc:DeclarationOfPerformance; ohne diese Pflichttripel
    // waeren sie per rdf:type nicht auseinanderzuhalten.
    const query = createDbppQuery();
    expect(query).toContain('?bspDop tc:moistureContent ?bspMoisture .');
    expect(query).toContain('?dop tc:zertifikatsnummer ?dopZertifikatsnummer .');
  });
});

describe('mapToDbpp', () => {
  it('liefert bei leerer Eingabe lauter Luecken statt Platzhalterwerten', () => {
    const result = mapToDbpp(null, null, null);
    const fields = fieldsOf(result);

    expect(result.coverage.filled).toBe(0);
    expect(result.coverage.total).toBe(fields.length);
    expect(fields.every((f) => f.value === null)).toBe(true);
    // Jede Luecke traegt eine Begruendung -- eine wortlos leere Zeile laesst
    // den Betrachter den Fehler bei sich suchen.
    expect(fields.every((f) => !!f.note)).toBe(true);
  });

  it('erfindet auch bei leerer Eingabe keine Werte', () => {
    // Gegenprobe zu den fest verdrahteten Werten der alten Ansicht: Gewicht
    // "~15 kg", Feuchte "12%", Norm "DIN EN 14080", CO2 "-45/-33 kg" und die
    // Festigkeit "C24" standen dort unabhaengig von den Daten.
    const serialized = JSON.stringify(mapToDbpp(null, null, null));
    for (const invented of [
      '~15 kg',
      '12%',
      '-30°C bis +60°C',
      'DIN EN 14080',
      '-45',
      '-33',
      'C24',
      'Deutschland',
      'klimapositiv',
    ]) {
      expect(serialized, `"${invented}" darf nicht erfunden werden`).not.toContain(
        invented,
      );
    }
  });

  it('nimmt den EPC als eindeutige Produktkennung', () => {
    const result = mapToDbpp(dataWith([PANEL_ROW]), null, null);

    expect(result.uniqueProductId).toBe(
      'urn:epc:id:sgtin:404711148.0401.718871462389',
    );
    expect(fieldById(result, 'DPP-1.1').availability).toBe('available');
  });

  it('liest beide Leistungserklaerungen und haelt sie auseinander', () => {
    const result = mapToDbpp(
      dataWith([PANEL_ROW, BSP_DOP_ROW, SAWN_DOP_ROW]),
      null,
      null,
    );

    // Aus der BSP-DoP
    expect(fieldById(result, 'DPP-5.1').value).toBe('12 %');
    expect(fieldById(result, 'DPP-2.4').value).toBe('MPA Stuttgart');
    // Aus der Schnittholz-DoP -- die Zertifikatsnummer gehoert dem Vorprodukt
    expect(fieldById(result, 'DPP-2.6').value).toBe('0123-CPR-4711');
    expect(fieldById(result, 'DPP-3.8').value).toBe('420 kg/m³');
  });

  it('sortiert den Adressbeutel der Herstelleranschrift', () => {
    const result = mapToDbpp(
      dataWith([BSP_DOP_ROW, BSP_DOP_ADDRESS_ROW]),
      null,
      null,
    );

    expect(fieldById(result, 'DPP-1.4').value).toBe(
      'Sägewerkstraße 5, 33098 Paderborn',
    );
  });

  it('uebersetzt die Holzart und markiert sie als abgeleitet', () => {
    const result = mapToDbpp(dataWith([PANEL_ROW]), null, null);
    const botanical = fieldById(result, 'DPP-3.2');

    expect(botanical.value).toBe('Picea abies');
    expect(botanical.availability).toBe('derived');
  });

  it('uebernimmt Herkunft und Ernte aus den Stammdaten', () => {
    const result = mapToDbpp(dataWith([PANEL_ROW], [STEM_ROW]), null, null);

    expect(fieldById(result, 'DPP-6.2').value).toBe('Forstamt Beispiel');
    expect(fieldById(result, 'DPP-6.3').value).toBe('Revier Nord');
    expect(fieldById(result, 'DPP-6.4').value).toBe('14.11.2025');
    expect(fieldById(result, 'DPP-6.5').value).toMatch(/51\.71890° N/);
    expect(fieldById(result, 'DPP-6.11').value).toBe('FSC');
  });

  it('zeigt die CO2-Zahl des Oekobilanz-Anwendungsfalls als abgeleitet', () => {
    const result = mapToDbpp(dataWith([PANEL_ROW]), null, FULL_CARBON);
    const carbon = fieldById(result, 'DPP-6.1');

    // Immer "derived": der Wert ist gerechnet, nicht gemessen.
    expect(carbon.availability).toBe('derived');
    expect(carbon.value).toContain('kg CO₂e');
    expect(carbon.label).not.toMatch(/Teilsumme/);
  });

  it('kennzeichnet eine unvollstaendige CO2-Summe als Teilsumme', () => {
    const result = mapToDbpp(dataWith([PANEL_ROW]), null, {
      total: -1900,
      isPartial: true,
      missingModules: ['A2', 'A4'],
    });
    const carbon = fieldById(result, 'DPP-6.1');

    expect(carbon.availability).toBe('derived');
    expect(carbon.label).toMatch(/Teilsumme/);
    expect(carbon.note).toContain('A2, A4');
  });

  it('weist eine nicht berechenbare CO2-Bilanz als Luecke aus', () => {
    const result = mapToDbpp(dataWith([PANEL_ROW]), null, {
      total: null,
      isPartial: true,
      missingModules: ['A1', 'A2', 'A3', 'A4', 'A5'],
    });
    const carbon = fieldById(result, 'DPP-6.1');

    expect(carbon.value).toBeNull();
    expect(carbon.availability).toBe('missing');
  });

  it('haelt die strukturellen Luecken der Verordnungen als unsupported fest', () => {
    const result = mapToDbpp(dataWith([PANEL_ROW]), null, FULL_CARBON);

    // Betriebsstaetten- und Registerkennung sind nicht "noch nicht befuellt",
    // sondern in diesem Aufbau gar nicht erfuellbar -- der Unterschied ist
    // die eigentliche Aussage des Anwendungsfalls.
    for (const id of ['DPP-1.9', 'DPP-1.10', 'DPP-7.6', 'DPP-7.7']) {
      const field = fieldById(result, id);
      expect(field.availability, `${id} sollte unsupported sein`).toBe('unsupported');
      expect(field.value).toBeNull();
      expect(field.note).toBeTruthy();
    }
  });

  it('gibt jeder Kategorie eine Rechtsgrundlage', () => {
    const result = mapToDbpp(dataWith([PANEL_ROW]), null, FULL_CARBON);

    expect(result.categories).toHaveLength(7);
    for (const category of result.categories) {
      expect(category.legalBasis, `${category.id} ohne Bezug`).toBeTruthy();
      expect(category.fields.length).toBeGreaterThan(0);
    }
  });

  it('zaehlt belegte Angaben korrekt', () => {
    const result = mapToDbpp(
      dataWith([PANEL_ROW, BSP_DOP_ROW], [STEM_ROW]),
      null,
      FULL_CARBON,
    );

    const filled = fieldsOf(result).filter((f) => f.value !== null).length;
    expect(result.coverage.filled).toBe(filled);
    expect(result.coverage.filled).toBeGreaterThan(0);
    expect(result.coverage.filled).toBeLessThan(result.coverage.total);
  });
});
