import { describe, it, expect } from 'vitest';
import { mapToDocumentation } from './documentationMapper';
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
  documentation: SparqlBinding[] = [],
  deconstruction: SparqlBinding[] = [],
): ProductDataResult {
  return { documentation, deconstruction } as unknown as ProductDataResult;
}

/**
 * Planungsdatensatz, wie ihn mappings/ifc_planung.rml.ttl aus der
 * Beispieldatei M24_Auszug.ifc erzeugt. Bewusst OHNE Bauabschnitt,
 * Sichtqualitaet, Abbund und Produktionsliste -- der Revit-Export schreibt
 * diese projektspezifischen Parameter nicht mit, und genau dieser Zustand
 * muss die Ansicht erreichen.
 */
const PLANNING_ROW: SparqlBinding = {
  buildingElement: iri('http://timberconnect.2050.de/resource/buildingElement/abc123'),
  ifcGlobalId: lit('3vyFm6FjX9mhMTaYZ8JVH7'),
  ifcTyp: lit('IfcSlab'),
  planBezeichnung: lit('BSP-Boden'),
  planMaterial: lit('BSP-5 lagig'),
  planBauteil: lit('Boden'),
  geschoss: lit('Geschoss 1'),
  planSourceFile: lit('M24_Auszug.ifc'),
  geplanteNettoflaeche: lit('32.887207999999987'),
  geplantesNettovolumen: lit('4.0458212399999978'),
} as unknown as SparqlBinding;

const PROJECT_ROW: SparqlBinding = {
  project: iri('http://timberconnect.2050.de/resource/buildingElement/abc123/projekt'),
  projektnummer: lit('2018_01'),
} as unknown as SparqlBinding;

/** ERP-/Leistungserklaerungs-Zeile, wie sie die Rueckbaubarkeits-Query liefert. */
const PANEL_ROW: SparqlBinding = {
  dopTypeNumber: lit('X-LAM L-150/5s'),
  artikel: lit('BSP 150 5s'),
  hoehe: lit('150.0'),
  breite: lit('2.95'),
  laenge: lit('11.8'),
  schichten: lit('5'),
  menge: lit('5.22'),
  pefc: lit('ja'),
  dopManufacturer: lit('Holzwerk Muster GmbH'),
  dopAddress: lit('Sägewerkstraße 1'),
  produktionsdatum: lit('2026-03-31T00:00:00'),
} as unknown as SparqlBinding;

function findField(
  result: ReturnType<typeof mapToDocumentation>,
  id: string,
) {
  const all = [...result.general, ...result.categories.flatMap((c) => c.fields)];
  return all.find((f) => f.id === id);
}

describe('mapToDocumentation — Struktur', () => {
  it('liefert die vier Kategorien der Visualisierung in der vorgegebenen Reihenfolge', () => {
    const result = mapToDocumentation(dataWith(), null);
    expect(result.categories.map((c) => c.id)).toEqual([
      'location',
      'dimensions',
      'installation',
      'manufacturer',
    ]);
  });

  it('zaehlt nur belegte Merkmale als abgedeckt', () => {
    const result = mapToDocumentation(dataWith(), null);
    // Ohne jede Datenquelle bleibt nur die abgeleitete Materialherkunft.
    expect(result.coverage.filled).toBeGreaterThan(0);
    expect(result.coverage.filled).toBeLessThan(result.coverage.total);
  });
});

describe('mapToDocumentation — Verortung im Gebaeude', () => {
  it('uebernimmt die Merkmale, die die IFC hergibt', () => {
    const result = mapToDocumentation(
      dataWith([PLANNING_ROW, PROJECT_ROW]),
      null,
    );
    expect(findField(result, 'I-79')?.value).toBe('3vyFm6FjX9mhMTaYZ8JVH7');
    expect(findField(result, 'I-80')?.value).toBe('IfcSlab');
    expect(findField(result, 'I-82')?.value).toBe('Geschoss 1');
    expect(findField(result, 'I-83')?.value).toBe('Boden');
    expect(findField(result, 'I-88')?.value).toBe('M24_Auszug.ifc');
  });

  it('weist in der IFC fehlende Parameter als Luecke MIT Begruendung aus', () => {
    const result = mapToDocumentation(dataWith([PLANNING_ROW]), null);

    for (const id of ['I-81', 'I-86', 'I-87', 'I-85']) {
      const field = findField(result, id);
      expect(field?.value, `${id} darf keinen erfundenen Wert tragen`).toBeNull();
      expect(field?.availability).toBe('missing');
      // Die Begruendung muss den Grund nennen, nicht nur "fehlt".
      expect(field?.note).toMatch(/projektspezifisch/i);
    }
  });

  it('unterscheidet "keine Planung vorhanden" von "Planung ohne dieses Merkmal"', () => {
    const withoutPlanning = mapToDocumentation(dataWith(), null);
    expect(findField(withoutPlanning, 'I-81')?.note).toMatch(
      /keine Ausführungsplanung/i,
    );

    const withPlanning = mapToDocumentation(dataWith([PLANNING_ROW]), null);
    expect(findField(withPlanning, 'I-81')?.note).not.toMatch(
      /keine Ausführungsplanung/i,
    );
  });

  it('nutzt die Projektnummer als Gebaeudebezug (I-78 ist sonst nicht belegbar)', () => {
    const result = mapToDocumentation(dataWith([PLANNING_ROW, PROJECT_ROW]), null);
    expect(findField(result, 'I-78')?.value).toBe('2018_01');
  });
});

describe('mapToDocumentation — Einbau', () => {
  it('bleibt laut Awf-Vorgabe unbefuellt, weist die Gruende aber aus', () => {
    const result = mapToDocumentation(dataWith([PLANNING_ROW]), null);
    const installation = result.categories.find((c) => c.id === 'installation');

    expect(installation?.fields.every((f) => f.value === null)).toBe(true);
    expect(installation?.fields.every((f) => !!f.note)).toBe(true);
  });
});

describe('mapToDocumentation — Abmessungen und Hersteller', () => {
  it('haengt Einheiten an und zeigt Zahlen in deutscher Schreibweise', () => {
    const result = mapToDocumentation(dataWith([], [PANEL_ROW]), null);
    expect(findField(result, 'I-33')?.value).toBe('150 mm');
    expect(findField(result, 'I-34')?.value).toBe('2,95 m');
    expect(findField(result, 'I-32')?.value).toBe('5,22 m³');
  });

  it('rundet das double-Rauschen der IFC-Geometrie weg', () => {
    const result = mapToDocumentation(dataWith([PLANNING_ROW]), null);
    // 32.887207999999987 darf nicht als Praezision durchgereicht werden.
    expect(findField(result, 'P-1')?.value).toBe('32,887 m²');
  });

  it('kommt ohne Mengen in der IFC aus (cadwork-Export)', () => {
    // Die cadwork-Beispieldatei traegt alle Planungsmerkmale, aber KEINE
    // IfcElementQuantity. Die Masse kommen ohnehin aus dem ERP -- die
    // Kategorie muss deshalb vollstaendig bleiben, nur ohne Soll-Werte.
    const ohneMengen = { ...PLANNING_ROW } as Record<string, unknown>;
    delete ohneMengen.geplanteNettoflaeche;
    delete ohneMengen.geplantesNettovolumen;

    const result = mapToDocumentation(
      dataWith([ohneMengen as SparqlBinding], [PANEL_ROW]),
      null,
    );

    expect(findField(result, 'P-1')).toBeUndefined();
    expect(findField(result, 'P-2')).toBeUndefined();
    // Die Ist-Masse aus dem ERP stehen unveraendert da.
    expect(findField(result, 'I-33')?.value).toBe('150 mm');
    expect(findField(result, 'I-36')?.value).toBe('5');
  });

  it('liest die Herstelleranschrift ueber die geteilte Heuristik', () => {
    const result = mapToDocumentation(dataWith([], [PANEL_ROW]), null);
    expect(findField(result, 'I-41')?.value).toBe('Holzwerk Muster GmbH');
    expect(findField(result, 'I-42')?.value).toBe('Sägewerkstraße 1');
    expect(findField(result, 'I-30')?.value).toBe('31.03.2026');
  });
});

describe('mapToDocumentation — abgeleitete und verwiesene Merkmale', () => {
  it('leitet die Materialherkunft aus der Zertifizierung ab', () => {
    const certified = mapToDocumentation(dataWith([], [PANEL_ROW]), null);
    expect(findField(certified, 'I-37')?.value).toBe(
      'Primärrohstoff, erneuerbar, zertifiziert',
    );
    expect(findField(certified, 'I-37')?.availability).toBe('derived');

    const uncertified = mapToDocumentation(dataWith(), null);
    expect(findField(uncertified, 'I-37')?.value).toBe(
      'Primärrohstoff, erneuerbar',
    );
  });

  it('verweist fuer CO2 und Bundesland auf die zustaendigen Anwendungsfaelle', () => {
    const result = mapToDocumentation(dataWith(), null);
    expect(findField(result, 'I-62')?.availability).toBe('unsupported');
    expect(findField(result, 'I-62')?.note).toMatch(/CO₂ Bilanzierung/);
    expect(findField(result, 'I-14')?.note).toMatch(/Herkunftsnachweis/);
  });
});

describe('mapToDocumentation — Kopfbereich', () => {
  it('zeigt den Handelsname, nicht den Dokumenttitel', () => {
    const result = mapToDocumentation(dataWith([], [PANEL_ROW]), null);
    expect(result.componentName).toBe('X-LAM L-150/5s');
  });

  it('nutzt die Bauteilart der Planung als Unterzeile', () => {
    const result = mapToDocumentation(dataWith([PLANNING_ROW], [PANEL_ROW]), null);
    expect(result.componentType).toBe('Boden');
  });
});
