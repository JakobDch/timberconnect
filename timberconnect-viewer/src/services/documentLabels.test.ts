import { describe, it, expect } from 'vitest';
import { describeFile, groupDocuments, fileExtension, variantLabel } from './documentLabels';
import type { PodFileEntry } from './fileBrowserService';

/**
 * Diese Tests halten die Regel fest, die den Downloadbereich lesbar macht:
 * aus einem Hash-Dateinamen wird der Dokumenttypname, unter dem der Nutzer
 * die Datei hochgeladen hat. Bricht das, steht der Hash wieder da.
 */

const POD = 'https://pod.example/alice/data/';

function file(name: string, container = 'VG-1'): PodFileEntry {
  return {
    url: `${POD}${container}/${name}`,
    name,
    traceId: container,
    pod: POD,
    ownerRoleIri: null,
    ownerRoleLabel: null,
    modified: null,
    isRdf: name.endsWith('.ttl'),
    legacy: false,
  };
}

describe('describeFile', () => {
  it('uebersetzt eine Vorlagen-Kennung in den Dokumenttypnamen', () => {
    const label = describeFile('15db340fdd300779_pdf_transportauftrag.json');
    expect(label.title).toBe('Transportauftrag Schnittholz');
    expect(label.variant).toBe('structured');
  });

  it('verwechselt die BSP-Leistungserklaerung nicht mit der Schnittholz-Variante', () => {
    // "pdf_leistungserklaerung" ist Praefix von "pdf_leistungserklaerung_bsp".
    // Ohne "laengste Kennung zuerst" gewaenne hier der falsche Name.
    expect(describeFile('abc12345_pdf_leistungserklaerung_bsp.ttl').title).toBe(
      'Leistungserklärung Brettsperrholz',
    );
    expect(describeFile('abc12345_pdf_leistungserklaerung.ttl').title).toBe(
      'Leistungserklärung Schnittholz',
    );
  });

  it('nimmt fuer "_dokument.pdf" den Namen aus der Geschwisterdatei', () => {
    const siblings = [
      '15db340fdd300779_dokument.pdf',
      '15db340fdd300779_pdf_transportauftrag_rundholz.ttl',
    ];
    const label = describeFile('15db340fdd300779_dokument.pdf', siblings);
    expect(label.title).toBe('Transportauftrag Rundholz');
    expect(label.variant).toBe('original');
  });

  it('greift nur auf Geschwister MIT derselben Dokument-ID zu', () => {
    // Zwei Dokumente im selben Vorgang: der Name des einen darf nicht auf
    // das andere abfaerben.
    const siblings = [
      'aaaaaaaa11111111_dokument.pdf',
      'bbbbbbbb22222222_pdf_schnittbild.ttl',
    ];
    expect(describeFile('aaaaaaaa11111111_dokument.pdf', siblings).title).toBe('Dokument');
  });

  it('erkennt maschinenlesbare Pflichtdateien am data_type', () => {
    expect(describeFile('abc12345_forst.ttl').title).toBe('Harvesterprotokoll');
    expect(describeFile('abc12345_herstellung.ttl').title).toBe('ERP-Export');
  });

  it('kennzeichnet Verwaltungsdateien als System', () => {
    expect(describeFile('process.ttl').isSystem).toBe(true);
    expect(describeFile('pricing.ttl').isSystem).toBe(true);
    expect(describeFile('abc12345_pdf_schnittbild.ttl').isSystem).toBe(false);
  });

  it('faellt bei unbekannter Kennung auf die aufgehuebschte Kennung zurueck -- nie auf den Hash', () => {
    const label = describeFile('abc12345_pdf_neue_vorlage.ttl');
    expect(label.title).toBe('Neue Vorlage');
    expect(label.title).not.toContain('abc12345');
  });
});

describe('groupDocuments', () => {
  it('buendelt Original und Strukturdaten zu EINEM Dokument', () => {
    const groups = groupDocuments([
      file('15db340fdd300779_pdf_transportauftrag.json'),
      file('15db340fdd300779_dokument.pdf'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Transportauftrag Schnittholz');
    expect(groups[0].original?.name).toBe('15db340fdd300779_dokument.pdf');
    expect(groups[0].structured?.name).toBe('15db340fdd300779_pdf_transportauftrag.json');
  });

  it('haelt verschiedene Dokumente auseinander', () => {
    const groups = groupDocuments([
      file('aaaaaaaa11111111_pdf_schnittbild.ttl'),
      file('aaaaaaaa11111111_dokument.pdf'),
      file('bbbbbbbb22222222_pdf_biegepruefung.ttl'),
      file('bbbbbbbb22222222_dokument.pdf'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.title).sort()).toEqual([
      'Biegeprüfung Schnittholz',
      'Schnittbild',
    ]);
  });

  it('laesst Verwaltungsdateien aus der Liste heraus', () => {
    const groups = groupDocuments([
      file('process.ttl'),
      file('pricing.ttl'),
      file('abc12345_pdf_schnittbild.ttl'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Schnittbild');
  });

  it('nimmt den aussagekraeftigen Namen, egal in welcher Reihenfolge die Dateien kommen', () => {
    // Container-Listen sind unsortiert: kommt "_dokument.pdf" zuerst, darf
    // "Dokument" nicht als Gruppentitel haengenbleiben.
    const forward = groupDocuments([
      file('15db340fdd300779_dokument.pdf'),
      file('15db340fdd300779_pdf_stammzertifikat.ttl'),
    ]);
    expect(forward[0].title).toBe('Stammzertifikat Vermehrungsgut');
  });

  it('zeigt ein Dokument auch ohne Gegenstueck', () => {
    const groups = groupDocuments([file('abc12345_forst.ttl')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].original).toBeNull();
    expect(groups[0].structured?.name).toBe('abc12345_forst.ttl');
  });
});

describe('fileExtension / variantLabel', () => {
  it('liest die Endung', () => {
    expect(fileExtension('abc_dokument.pdf')).toBe('pdf');
    expect(fileExtension('harvester.hpr')).toBe('hpr');
    expect(fileExtension('ohneendung')).toBe('');
  });

  it('benennt die Varianten verstaendlich', () => {
    expect(variantLabel('original', 'pdf')).toBe('Original (PDF)');
    expect(variantLabel('structured', 'ttl')).toBe('Strukturdaten');
  });
});
