/**
 * Die Praefixaufloesung — der Kern des Rundholz-Scan-Fehlers vom 02.09.2026.
 *
 * Gescannt wurde ein DotCode mit GTIN 04047111451006. Die App bildete daraus
 * `urn:epc:id:sgtin:40471114510.00.12A3D4567` (laengste Lesart zuerst), in den
 * Pods steht aber `…404711145.0100.…`. Ergebnis: kein Treffer, und die
 * Oberflaeche meldete "Produktart nicht bestimmbar", obwohl der Scan korrekt
 * und die Daten vorhanden waren.
 */

import { describe, it, expect } from 'vitest';
import { matchPrefix } from './companyPrefixService';

/** Die Praefixe, wie sie in den Teilnehmer-Pods hinterlegt sind. */
const FEDERATION = ['404711148', '404711146', '404711145', '404711147'];

describe('matchPrefix', () => {
  it('loest den Rundholz-DotCode auf die Lesart der Pod-Daten auf', () => {
    // Genau der Fall aus dem Fehlerbericht.
    expect(matchPrefix('04047111451006', FEDERATION)).toBe('404711145');
  });

  it('trifft alle vier Produktarten', () => {
    // Pflanzung und Rundholz teilen sich den Praefix des Forstbetriebs,
    // Lamelle und Platte haben eigene.
    expect(matchPrefix('04047111451006', FEDERATION)).toBe('404711145'); // Rundholz
    expect(matchPrefix('04047111462120', FEDERATION)).toBe('404711146'); // Lamelle
    expect(matchPrefix('04047111484010', FEDERATION)).toBe('404711148'); // BSP-Platte
  });

  it('meldet null fuer einen unbekannten Praefix statt zu raten', () => {
    // Fremde Ware: lieber gar keine Aussage als eine falsche. Der Aufrufer
    // faellt sichtbar gekennzeichnet auf das Durchprobieren zurueck.
    expect(matchPrefix('09999999991006', FEDERATION)).toBeNull();
  });

  it('nimmt den laengeren Praefix, wenn beide passen', () => {
    // GS1-Ausschlussregel: die Vergabe eines Praefixes schliesst laengere
    // Zeichenketten mit demselben Anfang aus, der laengere Treffer ist also
    // der spezifischere. Die Liste kommt absteigend sortiert.
    const prefixes = ['4047111451', '404711145'];
    expect(matchPrefix('04047111451006', prefixes)).toBe('4047111451');
  });

  it('ignoriert einen Praefix, der den ganzen Rumpf verbrauchen wuerde', () => {
    // Ohne Rest bliebe keine Artikelnummer uebrig — das waere kein gueltiger
    // Ident, sondern ein halb gebildeter.
    expect(matchPrefix('04047111451006', ['404711145100'])).toBeNull();
  });

  it('weist alles zurueck, was kein 14-stelliger GTIN ist', () => {
    expect(matchPrefix('4047111451006', FEDERATION)).toBeNull();
    expect(matchPrefix('', FEDERATION)).toBeNull();
    expect(matchPrefix('0404711145100X', FEDERATION)).toBeNull();
  });

  it('kommt mit leerer Foederation zurecht', () => {
    // Registry nicht erreichbar: kein Absturz, nur kein Treffer.
    expect(matchPrefix('04047111451006', [])).toBeNull();
  });
});
