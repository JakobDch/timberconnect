/**
 * Grobe Geo-Zuordnung fuer den Herkunftsnachweis (I-13 Land, I-14 Bundesland).
 *
 * Die Informationsbedarfstiefe verlangt Land und Bundesland des Faellvorgangs,
 * fuehrt sie aber selbst als "nicht vorhanden, aber ermittelbar aus
 * Koordinaten" -- StanForD liefert nur Lat/Lon. Genau das passiert hier.
 *
 * Bewusst als Bounding-Box-Tabelle und nicht per Reverse-Geocoding: die Angabe
 * ist ein Anzeigelabel, kein Rechtsdokument, und sie muss ohne Netz
 * funktionieren (der Geocoder in geocodingService.ts ist optional und darf
 * ausfallen). Boxen ueberlappen an den Grenzen; getroffen wird die Box mit dem
 * naechstgelegenen Mittelpunkt. Kein Treffer -> null -> "Keine Daten
 * verfuegbar", statt einer erfundenen Angabe.
 */

import type { Coordinates } from '../types';

interface BoundingBox {
  name: string;
  /** [minLat, maxLat, minLon, maxLon] */
  box: [number, number, number, number];
}

/** Deutschland gesamt -- grobe Huelle inkl. Inseln. */
const GERMANY_BOX: [number, number, number, number] = [47.2, 55.1, 5.8, 15.1];

/**
 * Die 16 Bundeslaender als Bounding-Boxen (WGS84).
 * Werte auf eine Nachkommastelle gerundet -- feiner waere Scheingenauigkeit,
 * weil ein Rechteck ein Bundesland ohnehin nur annaehert.
 */
const STATES: BoundingBox[] = [
  { name: 'Baden-Württemberg', box: [47.5, 49.8, 7.5, 10.5] },
  { name: 'Bayern', box: [47.3, 50.6, 8.9, 13.9] },
  { name: 'Berlin', box: [52.3, 52.7, 13.1, 13.8] },
  { name: 'Brandenburg', box: [51.4, 53.6, 11.3, 14.8] },
  { name: 'Bremen', box: [53.0, 53.6, 8.5, 8.99] },
  { name: 'Hamburg', box: [53.4, 53.7, 9.7, 10.3] },
  { name: 'Hessen', box: [49.4, 51.7, 7.8, 10.2] },
  { name: 'Mecklenburg-Vorpommern', box: [53.1, 54.7, 10.6, 14.4] },
  { name: 'Niedersachsen', box: [51.3, 53.9, 6.6, 11.6] },
  { name: 'Nordrhein-Westfalen', box: [50.3, 52.5, 5.9, 9.5] },
  { name: 'Rheinland-Pfalz', box: [48.9, 50.9, 6.1, 8.5] },
  { name: 'Saarland', box: [49.1, 49.6, 6.3, 7.4] },
  { name: 'Sachsen', box: [50.2, 51.7, 11.9, 15.0] },
  { name: 'Sachsen-Anhalt', box: [50.9, 53.0, 10.6, 13.2] },
  { name: 'Schleswig-Holstein', box: [53.4, 55.1, 7.9, 11.3] },
  { name: 'Thüringen', box: [50.2, 51.6, 9.9, 12.7] },
];

function inBox(point: Coordinates, box: [number, number, number, number]): boolean {
  const [minLat, maxLat, minLon, maxLon] = box;
  return point.lat >= minLat && point.lat <= maxLat && point.lng >= minLon && point.lng <= maxLon;
}

/** Quadratische Distanz zum Boxmittelpunkt -- reicht zum Vergleichen. */
function distanceToCenter(point: Coordinates, box: [number, number, number, number]): number {
  const [minLat, maxLat, minLon, maxLon] = box;
  const dLat = point.lat - (minLat + maxLat) / 2;
  const dLon = point.lng - (minLon + maxLon) / 2;
  return dLat * dLat + dLon * dLon;
}

/**
 * Land aus Koordinaten (I-13). Nur Deutschland wird erkannt -- die
 * Wertschoepfungskette des Projekts ist national; alles ausserhalb liefert
 * ehrlich ``null`` statt einer Vermutung.
 */
export function countryFromCoordinates(point: Coordinates | null): string | null {
  if (!point || (point.lat === 0 && point.lng === 0)) return null;
  return inBox(point, GERMANY_BOX) ? 'Deutschland' : null;
}

/**
 * Bundesland aus Koordinaten (I-14). Bei mehreren passenden Boxen gewinnt die
 * mit dem naechstgelegenen Mittelpunkt -- entschaerft die Ueberlappungen an
 * den Landesgrenzen.
 */
export function stateFromCoordinates(point: Coordinates | null): string | null {
  if (!point || (point.lat === 0 && point.lng === 0)) return null;

  const hits = STATES.filter((s) => inBox(point, s.box));
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0].name;

  return hits.reduce((best, candidate) =>
    distanceToCenter(point, candidate.box) < distanceToCenter(point, best.box) ? candidate : best,
  ).name;
}
