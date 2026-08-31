import { describe, it, expect } from 'vitest';
import { assertDeletable, removeCatalogRefs } from './podResetService';

/**
 * Der Schutzschild ist der Kern dieses Dienstes: er entscheidet, ob eine URL
 * geloescht werden darf. Ein Fehler hier trifft Infrastruktur, die die
 * Teilhabe am Datenraum traegt — deshalb wird jede geschuetzte Ecke einzeln
 * geprueft, nicht nur der Gutfall.
 */

const POD = 'https://solid-community-server.tmdt.info/epcisrepository/';

describe('assertDeletable — erlaubt', () => {
  it('laesst Dateien in einem Vorgangs-Container zu', () => {
    expect(() =>
      assertDeletable(`${POD}data/TC-2026-001/TC-2026-001_forst.ttl`, POD),
    ).not.toThrow();
  });

  it('laesst den Vorgangs-Container selbst zu', () => {
    expect(() => assertDeletable(`${POD}data/TC-2026-001/`, POD)).not.toThrow();
  });

  it('laesst PDF, Foto und process.ttl im Vorgang zu', () => {
    for (const name of ['a1b2c3_dokument.pdf', 'produkt.jpg', 'process.ttl', 'pricing.ttl']) {
      expect(() => assertDeletable(`${POD}data/TC-2026-001/${name}`, POD)).not.toThrow();
    }
  });

  it('laesst Katalog-Datensatz und -Record zu', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(() => assertDeletable(`${POD}catalog/ds/${uuid}.ttl`, POD)).not.toThrow();
    expect(() => assertDeletable(`${POD}catalog/records/${uuid}.ttl`, POD)).not.toThrow();
  });
});

describe('assertDeletable — geschuetzte Infrastruktur', () => {
  it('verweigert profile/ (WebID und Rolle)', () => {
    expect(() => assertDeletable(`${POD}profile/card`, POD)).toThrow(/Geschuetzter Bereich/);
    expect(() => assertDeletable(`${POD}profile/role.ttl`, POD)).toThrow(/Geschuetzter Bereich/);
  });

  it('verweigert access/ (WAC-Grundlage)', () => {
    expect(() => assertDeletable(`${POD}access/role-policy.ttl`, POD)).toThrow(
      /Geschuetzter Bereich/,
    );
    expect(() => assertDeletable(`${POD}access/groups/forst.ttl`, POD)).toThrow(
      /Geschuetzter Bereich/,
    );
  });

  it('verweigert wallet/ (Guthaben bleibt)', () => {
    expect(() => assertDeletable(`${POD}wallet/wallet.ttl`, POD)).toThrow(/Geschuetzter Bereich/);
    expect(() => assertDeletable(`${POD}wallet/transactions.ttl`, POD)).toThrow(
      /Geschuetzter Bereich/,
    );
  });

  it('verweigert public/ (Demo-Fundament und Fremdbestand)', () => {
    expect(() => assertDeletable(`${POD}public/01_Forst_StanForD_HPR.ttl`, POD)).toThrow(
      /Geschuetzter Bereich/,
    );
    expect(() => assertDeletable(`${POD}public/npd_daten.sqlite`, POD)).toThrow(
      /Geschuetzter Bereich/,
    );
  });

  it('verweigert die uebrigen Infrastruktur-Container', () => {
    for (const seg of ['Settings', 'inbox', 'connections', 'registry', 'statistics', 'token']) {
      expect(() => assertDeletable(`${POD}${seg}/irgendwas`, POD)).toThrow(
        /Geschuetzter Bereich/,
      );
    }
  });
});

describe('assertDeletable — Struktur bleibt erhalten', () => {
  it('verweigert die Pod-Wurzel', () => {
    expect(() => assertDeletable(POD, POD)).toThrow(/Pod-Wurzel/);
  });

  it('verweigert den data-Container selbst', () => {
    expect(() => assertDeletable(`${POD}data/`, POD)).toThrow(/data-Container selbst/);
  });

  it('verweigert cat.ttl — ohne sie ist der Pod nicht auffindbar', () => {
    expect(() => assertDeletable(`${POD}catalog/cat.ttl`, POD)).toThrow(/nur ds\/ und records\//);
  });

  it('verweigert catalog/ und seine Unterordner als Ganzes', () => {
    expect(() => assertDeletable(`${POD}catalog/`, POD)).toThrow(/nur ds\/ und records\//);
    expect(() => assertDeletable(`${POD}catalog/ds/`, POD)).toThrow(/nur ds\/ und records\//);
    expect(() => assertDeletable(`${POD}catalog/series/`, POD)).toThrow(/nur ds\/ und records\//);
  });

  it('verweigert den README im Wurzelverzeichnis', () => {
    expect(() => assertDeletable(`${POD}README`, POD)).toThrow(/Nicht als Upload erkannt/);
  });
});

describe('assertDeletable — fremde Pods', () => {
  it('verweigert alles ausserhalb des eigenen Pods', () => {
    const fremd = 'https://solid-community-server.tmdt.info/anderer-pod/';
    expect(() => assertDeletable(`${fremd}data/TC-1/datei.ttl`, POD)).toThrow(
      /Ausserhalb des eigenen Pods/,
    );
  });

  it('verweigert einen anderen Host', () => {
    expect(() => assertDeletable('https://boese.example/data/x.ttl', POD)).toThrow(
      /Ausserhalb des eigenen Pods/,
    );
  });

  it('faellt nicht auf einen Pod-Namen herein, der mit dem eigenen beginnt', () => {
    // "epcisrepository-backup" beginnt mit "epcisrepository", ist aber ein
    // anderer Pod. Ohne den Slash in der Basis wuerde startsWith() das
    // durchlassen.
    const aehnlich = 'https://solid-community-server.tmdt.info/epcisrepository-backup/data/x/';
    expect(() => assertDeletable(aehnlich, POD)).toThrow(/Ausserhalb des eigenen Pods/);
  });

  it('verlangt eine Pod-Basis mit abschliessendem Slash', () => {
    expect(() =>
      assertDeletable(`${POD}data/TC-1/x.ttl`, POD.replace(/\/$/, '')),
    ).toThrow(/abschliessenden Slash/);
  });
});

describe('removeCatalogRefs', () => {
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';

  it('entfernt einen Eintrag und laesst den anderen stehen', () => {
    const cat = `@prefix dcat: <http://www.w3.org/ns/dcat#>.
@prefix dcterms: <http://purl.org/dc/terms/>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.

<#it> a dcat:Catalog ;
  dcterms:title "Test" ;
  dcterms:modified "2026-01-01T00:00:00.000Z"^^xsd:dateTime ;
  dcat:dataset
    <ds/${A}.ttl#it> ,
    <ds/${B}.ttl#it> .

<#it> dcat:record
    <https://pod/catalog/records/${A}.ttl#desc> ,
    <https://pod/catalog/records/${B}.ttl#desc> .
`;
    const out = removeCatalogRefs(cat, [A]);
    expect(out).not.toContain(A);
    expect(out).toContain(`ds/${B}.ttl#it`);
    expect(out).toContain(`records/${B}.ttl#desc`);
    // Der Katalog selbst bleibt intakt.
    expect(out).toContain('a dcat:Catalog');
    expect(out).toContain('dcat:dataset');
  });

  it('aktualisiert den Aenderungszeitpunkt', () => {
    const cat = `<#it> a dcat:Catalog ;
  dcterms:modified "2026-01-01T00:00:00.000Z"^^xsd:dateTime ;
  dcat:dataset
    <ds/${A}.ttl#it> ,
    <ds/${B}.ttl#it> .
`;
    const out = removeCatalogRefs(cat, [A]);
    expect(out).not.toContain('2026-01-01T00:00:00.000Z');
  });

  it('entfernt den ersten Eintrag einer Liste sauber', () => {
    const cat = `<#it> a dcat:Catalog ;
  dcat:dataset
    <ds/${A}.ttl#it> ,
    <ds/${B}.ttl#it> .
`;
    const out = removeCatalogRefs(cat, [A]);
    expect(out).not.toContain(A);
    expect(out).toContain(`<ds/${B}.ttl#it> .`);
  });

  it('laesst den Katalog unveraendert, wenn nichts zutrifft', () => {
    const cat = `<#it> a dcat:Catalog ;
  dcat:dataset
    <ds/${B}.ttl#it> .
`;
    const out = removeCatalogRefs(cat, [A]);
    expect(out).toContain(`ds/${B}.ttl#it`);
  });
});
