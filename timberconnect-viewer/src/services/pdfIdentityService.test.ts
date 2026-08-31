import { describe, it, expect, vi } from 'vitest';

// pdfjs-dist wird nur zum LESEN der Datei gebraucht; sein Canvas-Teil greift
// beim Import auf DOMMatrix zu, das weder in node noch in jsdom existiert.
// Geprueft wird hier die reine Auswertung bereits gelesener Felder — der
// Platzhalter haelt den Import davon fern.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({ promise: Promise.reject(new Error('nicht benutzt')) }),
}));

import { identityFromFields } from './pdfIdentityService';

/** AcroForm-Feldobjekt, wie pdf.js es liefert. */
const field = (value: string) => [{ value, defaultValue: null }];

const LAMELLE_A = 'urn:epc:id:sgtin:404711146.0212.120231002917';
const LAMELLE_B = 'urn:epc:id:sgtin:404711146.0212.186323687879';
const STAMM = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';

describe('Ident aus AcroForm-Feldern', () => {
  it('liest einen einzelnen Ident', () => {
    const identity = identityFromFields({ Identity: field(LAMELLE_A) });
    expect(identity?.epc).toBe(LAMELLE_A);
  });

  /**
   * Der eigentliche Fehlerfall: Der Fertigungsauftrag des Saegewerks nennt in
   * EINEM Feld alle erzeugten Lamellen, semikolongetrennt. Frueher wurde der
   * Gesamtwert gegen das EPC-Muster geprueft -- das passt bei einer Liste nie,
   * also galt der Ident als nicht vorhanden und der Upload brach mit
   * "Pflichtfeld 'Bezieht sich auf' fehlt" ab.
   */
  it('liest den ersten Ident aus einer semikolongetrennten Liste', () => {
    const identity = identityFromFields({
      Identity: field(`${LAMELLE_A};${LAMELLE_B}`),
    });
    expect(identity?.epc).toBe(LAMELLE_A);
  });

  it('vertraegt Leerzeichen und Zeilenumbrueche als Trenner', () => {
    const identity = identityFromFields({
      Identity: field(`${LAMELLE_A} ; ${LAMELLE_B}`),
    });
    expect(identity?.epc).toBe(LAMELLE_A);
  });

  it('trennt Vormaterial vom Ident des Dokuments', () => {
    const identity = identityFromFields({
      Identity: field(`${LAMELLE_A};${LAMELLE_B}`),
      IdentityInput: field(STAMM),
    });
    expect(identity?.epc).toBe(LAMELLE_A);
    expect(identity?.inputEpc).toBe(STAMM);
  });

  it('liest den Ident auch aus epcClass', () => {
    // Das Stammzertifikat nennt sein Feld so, weil dort eine LGTIN steht.
    const lot = 'urn:epc:class:lgtin:404711145.0001.Pflanzung01';
    expect(identityFromFields({ epcClass: field(lot) })?.epc).toBe(lot);
  });

  it('liefert null, wenn kein Feld einen gueltigen EPC traegt', () => {
    expect(identityFromFields({ Identity: field('keine Angabe') })).toBeNull();
  });

  it('erkennt Saegevorgaenge als n:m-Umwandlung', () => {
    // Nummerierte Paare beschreiben je einen Stamm und seine Lamellen; hier
    // gibt es keinen EINEN Dokument-Ident.
    const identity = identityFromFields({
      Identity_1: field(`${LAMELLE_A};${LAMELLE_B}`),
      IdentityInput_1: field(STAMM),
    });
    expect(identity?.sawings).toHaveLength(1);
    expect(identity?.sawings?.[0].materialInputEpc).toContain(STAMM);
    expect(identity?.sawings?.[0].materialEpc).toEqual([LAMELLE_A, LAMELLE_B]);
  });
});
