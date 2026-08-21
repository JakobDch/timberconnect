/**
 * Geo-Hilfen fuer die Pflanzflaeche.
 *
 * Die Flaeche wird beim Pflanzvorgang im Stammzertifikat gezeichnet und landet
 * als GeoSPARQL-WKT (geo:asWKT) plus Zentroid (wgs84:lat/long) im Graph. Hier
 * liegt die Gegenrichtung: WKT wieder einlesen und pruefen, ob die GPS-Position
 * eines Produkts in einer Flaeche liegt.
 *
 * Warum clientseitig? Die Pods sprechen kein GeoSPARQL -- ein
 * geof:sfWithin-Filter im SPARQL waere zwar die elegante Formulierung, wird
 * aber von Comunica/den Pod-Endpunkten nicht ausgewertet. Die Flaechen sind
 * wenige und klein; der Punkt-in-Polygon-Test kostet hier praktisch nichts.
 */

/** Ein Punkt in WGS84. */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Eine Pflanzflaeche, wie sie aus dem Graph zurueckkommt. */
export interface PlantingArea {
  /** IRI des Zertifikats, das die Flaeche traegt. */
  certificateIri: string;
  /** Ring als [lon, lat] (CRS84), geschlossen. */
  ring: number[][];
  /** Zentroid aus dem Graph (wgs84:lat/long). */
  centroid: GeoPoint | null;
}

/**
 * GeoSPARQL-WKT-Polygon in einen Ring [[lon, lat], ...] uebersetzen.
 *
 * Akzeptiert "POLYGON((...))" mit optionalem CRS-Praefix
 * ("<http://www.opengis.net/def/crs/OGC/1.3/CRS84> POLYGON((...))").
 * Gibt ``null`` zurueck, wenn das Literal kein Polygon ist -- ein kaputtes
 * Literal soll die Anzeige nicht abstuerzen lassen.
 */
export function parseWktPolygon(wkt: string | null | undefined): number[][] | null {
  if (!wkt) return null;
  const match = /POLYGON\s*\(\s*\((.+?)\)\s*\)/i.exec(wkt);
  if (!match) return null;

  const ring: number[][] = [];
  for (const pair of match[1].split(',')) {
    const parts = pair.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    ring.push([lon, lat]);
  }
  return ring.length >= 3 ? ring : null;
}

/** Ring [[lon, lat], ...] als GeoJSON-Polygon (fuer die Kartenanzeige). */
export function ringToGeoJson(ring: number[][]): {
  type: 'Polygon';
  coordinates: number[][][];
} {
  const closed = [...ring];
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    closed.push([...first]);
  }
  return { type: 'Polygon', coordinates: [closed] };
}

/**
 * Liegt der Punkt im Polygon? (Ray-Casting, Ring als [lon, lat]).
 *
 * Punkte exakt auf der Kante sind nicht eindeutig zugeordnet -- fuer
 * Waldflaechen ist das ohne Belang.
 */
export function isPointInRing(point: GeoPoint, ring: number[][]): boolean {
  const { lat, lon } = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Die Flaechen finden, in denen eine GPS-Position liegt.
 *
 * Das ist der Kern der Rueckwaerts-Suche "aus welchem Pflanzvorgang stammt
 * dieses Produkt?": die Position eines Stamms/Polters aus den Maschinendaten
 * gegen die gezeichneten Pflanzflaechen halten.
 */
export function areasContaining(
  point: GeoPoint,
  areas: PlantingArea[],
): PlantingArea[] {
  return areas.filter((area) => isPointInRing(point, area.ring));
}

/**
 * Pflanzflaeche als GeoJSON-FeatureCollection fuer den EUDR/TRACES-Import.
 *
 * TRACES nimmt Geolokalisierungsdaten als GeoJSON-Datei in EPSG:4326 entgegen
 * (EUDR-Benutzerhandbuch, Abschnitt 2.2 b). GeoJSON ist per RFC 7946 ohnehin
 * WGS84 mit [lon, lat]-Achsen -- der Ring kann unveraendert uebernommen
 * werden. Unbekannte properties ignoriert TRACES; dort landen die
 * Begleitdaten aus dem Stammzertifikat fuer den menschlichen Leser.
 */
export function areaToTracesFeatureCollection(
  area: PlantingArea,
  properties: Record<string, string | number> = {},
): {
  type: 'FeatureCollection';
  features: object[];
} {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: ringToGeoJson(area.ring),
        properties: {
          // "Area" (ha) ist eine im EUDR-GeoJSON vorgesehene Eigenschaft.
          Area: Number(ringAreaHectares(area.ring).toFixed(2)),
          ...properties,
        },
      },
    ],
  };
}

/**
 * Luftlinie zwischen zwei WGS84-Punkten in Kilometern (Haversine).
 *
 * Grundlage der Streckenschaetzung im Awf "CO2-Bilanz": geocodierte
 * Adressen liefern Luftlinien, die dort mit einem Umwegfaktor auf
 * Strassenkilometer hochgerechnet werden.
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Naeherung der Flaechengroesse in Hektar (sphaerischer Exzess). */
export function ringAreaHectares(ring: number[][]): number {
  if (ring.length < 3) return 0;
  const R = 6378137;
  const rad = Math.PI / 180;
  // Geschlossenen Ring nicht doppelt zaehlen
  const pts =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const [lon1, lat1] = pts[i];
    const [lon2, lat2] = pts[(i + 1) % pts.length];
    total +=
      (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((total * R * R) / 2) / 10_000;
}
