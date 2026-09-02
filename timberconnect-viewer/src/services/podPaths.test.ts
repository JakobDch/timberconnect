import { describe, it, expect } from 'vitest';
import { containerForPdf } from './podPaths';

/**
 * Wohin ein PDF im Pod gehoert.
 *
 * Anlass: Ein Vorgang zerfiel im Pod in mehrere Container -- der Vorgang selbst
 * plus einen je PDF-Anhang, benannt nach dem Dokument-Hash. In der Loeschliste
 * standen sie als gleichrangige Eintraege nebeneinander, obwohl der
 * Transportauftrag ein Anhang des Faellvorgangs ist.
 */

const POD = 'https://solid-community-server.tmdt.info/epcisrepository/';
const DOC = '0de0b1aafc5e9c26';

describe('containerForPdf', () => {
  it('legt das PDF in den Vorgangs-Container', () => {
    const out = containerForPdf(POD, DOC, `${POD}data/VG-2026-0902-4128/`);

    expect(out).toBe(`${POD}data/VG-2026-0902-4128/`);
  });

  it('faellt ohne Vorgang auf einen eigenen Container zurueck', () => {
    // Der Weg fuer PDFs, die nicht zu einem registrierten Vorgang gehoeren.
    expect(containerForPdf(POD, DOC)).toBe(`${POD}data/${DOC}/`);
    expect(containerForPdf(POD, DOC, null)).toBe(`${POD}data/${DOC}/`);
  });

  it('behandelt einen leeren String wie "kein Vorgang"', () => {
    expect(containerForPdf(POD, DOC, '   ')).toBe(`${POD}data/${DOC}/`);
  });

  it('erzwingt den abschliessenden Slash', () => {
    // Ohne ihn entstuende ein Geschwisterpfad statt eines Kindes:
    // "data/VG-1_dokument.pdf" statt "data/VG-1/_dokument.pdf".
    expect(containerForPdf(POD, DOC, `${POD}data/VG-1`)).toBe(`${POD}data/VG-1/`);
  });

  it('setzt keinen zweiten Slash, wenn schon einer da ist', () => {
    expect(containerForPdf(POD, DOC, `${POD}data/VG-1/`).endsWith('//')).toBe(false);
  });

  it('haelt mehrere PDFs desselben Vorgangs im selben Container', () => {
    const proc = `${POD}data/VG-2026-0902-4128/`;

    expect(containerForPdf(POD, 'hash-a', proc)).toBe(containerForPdf(POD, 'hash-b', proc));
  });
});
