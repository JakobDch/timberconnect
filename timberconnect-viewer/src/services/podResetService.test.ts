import { describe, it, expect } from 'vitest';
import {
  assertDeletable,
  removeCatalogRefs,
  selectPlanContainers,
  describeContainer,
  documentKindFromFiles,
  type ResetPlan,
} from './podResetService';

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

/**
 * Auswahl einzelner Vorgaenge.
 *
 * Der gefaehrliche Fall ist nicht das Loeschen zu weniger, sondern zu vieler
 * Dinge: Ein Katalog-Eintrag, der zu einem BEHALTENEN Vorgang gehoert, darf
 * nicht mitgehen -- sonst verschwindet ein noch vorhandener Vorgang aus dem
 * Katalog und ist im Datenraum nicht mehr auffindbar.
 */
describe('selectPlanContainers', () => {
  const POD_B = 'https://solid-community-server.tmdt.info/epcisrepository/';
  const pflanzung = `${POD_B}data/proc-pflanzung/`;
  const faellung = `${POD_B}data/proc-faellung/`;

  const container = (url: string, files: string[]) => ({
    url,
    traceId: url.split('/').filter(Boolean).pop() as string,
    files: files.map((n) => ({ url: `${url}${n}`, name: n, modified: null })),
    modified: null,
    ownerWebId: null,
    isOwn: true,
  });

  const entry = (uuid: string, target: string | null) => ({
    uuid,
    datasetUrl: `${POD_B}catalog/ds/${uuid}.ttl`,
    recordUrl: `${POD_B}catalog/records/${uuid}.ttl`,
    targetContainer: target,
  });

  const plan: ResetPlan = {
    podBase: POD_B,
    containers: [
      container(pflanzung, ['a.ttl', 'a.pdf']),
      container(faellung, ['b.ttl', 'b.hpr', 'process.ttl']),
    ],
    foreign: [],
    catalogEntries: [entry('uuid-p', pflanzung), entry('uuid-f', faellung)],
    keptCatalogEntries: [entry('uuid-x', null)],
    fileCount: 5,
    warnings: [],
  };

  it('behaelt nur den gewaehlten Vorgang', () => {
    const out = selectPlanContainers(plan, [faellung]);

    expect(out.containers).toHaveLength(1);
    expect(out.containers[0].url).toBe(faellung);
  });

  it('zaehlt die Dateien der Auswahl neu', () => {
    expect(selectPlanContainers(plan, [faellung]).fileCount).toBe(3);
  });

  it('nimmt den Katalog-Eintrag des gewaehlten Vorgangs mit', () => {
    // Bliebe er stehen, zeigte der Katalog auf einen Container, den es nicht
    // mehr gibt.
    const out = selectPlanContainers(plan, [faellung]);

    expect(out.catalogEntries.map((e) => e.uuid)).toEqual(['uuid-f']);
  });

  it('schuetzt den Katalog-Eintrag des behaltenen Vorgangs', () => {
    // Der eigentliche Fallstrick: uuid-p stand im Ausgangsplan unter
    // catalogEntries und muss beim Abwaehlen der Pflanzung dort verschwinden.
    const out = selectPlanContainers(plan, [faellung]);

    expect(out.catalogEntries.map((e) => e.uuid)).not.toContain('uuid-p');
    expect(out.keptCatalogEntries.map((e) => e.uuid)).toContain('uuid-p');
  });

  it('fuehrt abgewaehlte Vorgaenge als unantastbar', () => {
    const out = selectPlanContainers(plan, [faellung]);

    expect(out.foreign.map((c) => c.url)).toContain(pflanzung);
  });

  it('liefert einen leeren Plan, wenn nichts gewaehlt ist', () => {
    const out = selectPlanContainers(plan, []);

    expect(out.containers).toHaveLength(0);
    expect(out.catalogEntries).toHaveLength(0);
    expect(out.fileCount).toBe(0);
  });

  it('ignoriert unbekannte URLs, statt zu werfen', () => {
    const out = selectPlanContainers(plan, [`${POD_B}data/gibt-es-nicht/`]);

    expect(out.containers).toHaveLength(0);
  });

  it('laesst den Pod-Basispfad unveraendert', () => {
    // executePodReset leitet daraus den Schutzschild ab.
    expect(selectPlanContainers(plan, [faellung]).podBase).toBe(POD_B);
  });
});

/**
 * Lesbare Beschriftung der Vorgaenge.
 *
 * Anlass war die Loeschliste, die Container-Hashes wie "0de0b1aafc5e9c26"
 * anzeigte. Die sind der Dokument-Hash und sagen niemandem etwas -- der Nutzer
 * soll erkennen, WAS er loescht und WANN es hochgeladen wurde.
 */
describe('describeContainer', () => {
  const base = {
    url: 'https://pod/data/x/',
    traceId: 'x',
    files: [],
    modified: null,
    ownerWebId: null,
    isOwn: true,
    processLabel: null,
    title: null,
    registeredAt: null,
    processId: null,
  };

  const file = (name: string) => ({ url: `https://pod/data/x/${name}`, name, modified: null });

  it('nimmt den Vorgangstyp als Ueberschrift', () => {
    const d = describeContainer({
      ...base,
      processLabel: 'Fällvorgang',
      registeredAt: new Date('2026-09-02T14:28:00Z'),
      processId: 'VG-2026-0902-4128',
    });

    expect(d.title).toBe('Fällvorgang');
    expect(d.subtitle).toContain('VG-2026-0902-4128');
  });

  it('nennt den Zeitpunkt der Registrierung', () => {
    const d = describeContainer({
      ...base,
      processLabel: 'Pflanzvorgang',
      registeredAt: new Date('2026-09-02T14:28:00Z'),
    });

    expect(d.subtitle).toMatch(/02\.09\.2026/);
  });

  it('wiederholt den Titel nicht, wenn er dem Typ gleicht', () => {
    const d = describeContainer({
      ...base,
      processLabel: 'Fällvorgang',
      title: 'Fällvorgang',
    });

    expect(d.subtitle ?? '').not.toMatch(/Fällvorgang/);
  });

  it('ergaenzt einen abweichenden Titel', () => {
    const d = describeContainer({
      ...base,
      processLabel: 'Fällvorgang',
      title: 'Schlag Nordhang',
    });

    expect(d.subtitle).toContain('Schlag Nordhang');
  });

  it('erkennt die Dokumentart, wenn kein Vorgang registriert ist', () => {
    // Genau der Fall aus dem Screenshot: Container heisst nach dem Hash,
    // aber die Dateinamen verraten, worum es geht.
    const d = describeContainer({
      ...base,
      traceId: '0de0b1aafc5e9c26',
      files: [
        file('0de0b1aafc5e9c26_pdf_stammzertifikat.ttl'),
        file('pricing.ttl'),
        file('0de0b1aafc5e9c26_dokument.pdf'),
      ],
    });

    expect(d.title).toBe('Stammzertifikat');
    expect(d.subtitle).toContain('ohne Vorgangsregistrierung');
  });

  it('unterscheidet Leistungserklaerung und BSP-Variante', () => {
    // "pdf_leistungserklaerung" ist Praefix von "..._bsp" -- ohne Sortierung
    // nach Laenge gewinnt die falsche.
    const bsp = describeContainer({
      ...base,
      files: [file('abc_pdf_leistungserklaerung_bsp.ttl')],
    });
    const normal = describeContainer({
      ...base,
      files: [file('abc_pdf_leistungserklaerung.ttl')],
    });

    expect(bsp.title).toBe('Leistungserklärung BSP');
    expect(normal.title).toBe('Leistungserklärung');
  });

  it('erkennt das Harvesterprotokoll am Dateinamen', () => {
    const d = describeContainer({ ...base, files: [file('f65cf310_forst.hpr')] });

    expect(d.title).toBe('Harvesterprotokoll');
  });

  it('faellt auf den Zeitpunkt zurueck, wenn nichts bekannt ist', () => {
    // Der Hash darf nie die Ueberschrift sein -- hoechstens Beiwerk.
    const d = describeContainer({
      ...base,
      traceId: 'deadbeef',
      modified: new Date('2026-08-01T09:00:00Z'),
    });

    expect(d.title).toMatch(/Upload vom/);
    expect(d.subtitle).toBe('deadbeef');
  });

  it('kommt ohne jede Angabe zurecht', () => {
    expect(describeContainer(base).title).toBe('Unbenannter Upload');
  });
});

describe('documentKindFromFiles', () => {
  const file = (name: string) => ({ url: `https://pod/${name}`, name, modified: null });

  it('liefert null, wenn keine Kennung passt', () => {
    expect(documentKindFromFiles([file('irgendwas.ttl')])).toBeNull();
  });

  it('findet die Kennung unabhaengig von der Dateireihenfolge', () => {
    expect(
      documentKindFromFiles([file('pricing.ttl'), file('abc_pdf_pruefzertifikat.ttl')]),
    ).toBe('Prüfzertifikat');
  });
});
