/**
 * Pflanzung über den Standort finden.
 *
 * Der zweite Weg zur Identifikation neben dem Scannen: Ein Pflanzvorgang trägt
 * keinen aufgedruckten Code, den man im Wald abscannen könnte — er ist über
 * seine FLÄCHE identifiziert. Wer auf der Fläche steht, steht im Pflanzvorgang;
 * die Position ist damit selbst die ID.
 *
 * Der Weg dorthin ist die Umkehrung des Uploads: Beim Stammzertifikat wird die
 * Fläche gezeichnet und landet als geo:asWKT am selben Subjekt wie tc:epc
 * (siehe pdf_stammzertifikat.rml.ttl). Hier wird das Polygon wieder eingelesen,
 * per Punkt-in-Polygon geprüft und der EPC daneben herausgelesen — der geht
 * anschließend durch denselben Ablauf wie ein gescannter Barcode.
 *
 * Nur echte Treffer: Liegt der Punkt in keiner Fläche, wird nichts geraten und
 * keine „nächstgelegene" Fläche angeboten. Eine Herkunftsangabe, die auf
 * Nähe statt auf Zugehörigkeit beruht, wäre im Datenraum nicht belegbar — und
 * genau die Belegbarkeit ist der Zweck der ganzen Kette.
 */

import { getAllCatalogSources } from './catalogService';
import { filterSourcesByRole } from './accessControlService';
import { getCurrentRole } from './authFetch';
import { queryPlantingAreas, type PlantingAreaResult } from './sparqlService';
import { areasContaining, ringAreaHectares, type GeoPoint } from './geoService';

/** Eine über den Standort gefundene Pflanzung. */
export interface PlantingHit {
  /** Die Fläche samt Begleitdaten aus dem Stammzertifikat. */
  area: PlantingAreaResult;
  /** Der EPC des Vermehrungsguts — die ID, mit der es weitergeht. */
  epc: string;
  /** Anzeigename für die Auswahl. */
  label: string;
  /** Flächengröße in Hektar. */
  hectares: number;
}

/** Ergebnis einer Standortsuche. */
export interface PlantingLookupResult {
  hits: PlantingHit[];
  /**
   * Flächen, die den Punkt einschließen, aber keinen EPC tragen. Sie werden
   * getrennt gezählt, damit die Meldung „hier liegt eine Fläche, aber ohne
   * Materialbezug" möglich ist statt eines irreführenden „nichts gefunden".
   */
  withoutEpc: number;
}

/**
 * Anzeigename einer Fläche.
 *
 * Zertifikatsnummer zuerst — sie ist das, was auch auf dem Papier steht. Sonst
 * Baumart und Reifejahr, notfalls das letzte Segment der IRI.
 */
export function plantingLabel(area: PlantingAreaResult): string {
  if (area.certificateNumber) return `Stammzertifikat ${area.certificateNumber}`;

  const parts = [area.species, area.maturityYear].filter(Boolean);
  if (parts.length > 0) return `Pflanzung ${parts.join(', ')}`;

  const tail = area.certificateIri.split(/[/#]/).filter(Boolean).pop();
  return tail ? `Pflanzung ${tail}` : 'Pflanzvorgang';
}

/**
 * Alle Quellen, in denen eine Pflanzfläche liegen kann.
 *
 * Bewusst NICHT über `getAllProductsAsync()`. Das ist der naheliegende Weg und
 * der falsche: Die Produktgruppierung verwirft jeden Datensatz ohne lesbare
 * ID, und ein Stammzertifikat hat für sie keine — es beschreibt kein Bauteil,
 * sondern Vermehrungsgut (`urn:epc:class:lgtin`, während der Katalog-Regex nur
 * `urn:epc:id:` sucht). Über Produkte gefundene Flächen wären genau die, die
 * schon zu einem geernteten Bauteil gehören; die frisch registrierte Pflanzung,
 * um die es hier geht, fiele heraus.
 *
 * Es darf auch nicht auf einen bestimmten Pod gesetzt werden: Zu einer Rolle
 * können mehrere Pods gehören, und jeder davon kann Flächen führen. Welche
 * lesbar sind, entscheidet die Rolle — nicht eine Annahme über Pod-Namen.
 *
 * Der Rollenfilter ist ein VORfilter, kein Torwächter: Er spart Abfragen an
 * Pods, die ohnehin ablehnen würden. Die verbindliche Grenze bleibt die ACL
 * des Servers.
 */
export async function resolvePlantingSources(): Promise<string[]> {
  const all = await getAllCatalogSources();
  if (all.length === 0) return [];

  try {
    const { allowed } = await filterSourcesByRole(all, getCurrentRole());
    return allowed;
  } catch (err) {
    // Ist die Zugriffskontrolle nicht erreichbar, lieber alles versuchen als
    // nichts: Die Pods weisen unerlaubte Zugriffe selbst ab, und ein stiller
    // Totalausfall der Suche wäre die schlechtere Antwort.
    console.warn('[planting-lookup] Rollenfilter nicht anwendbar:', err);
    return all;
  }
}

/**
 * Warum die Flächensuche nichts geliefert hat.
 *
 * „Keine Fläche" und „Fläche nicht ladbar" sehen im Ergebnis gleich aus — beide
 * sind eine leere Liste. Für die Karte ist der Unterschied belanglos, für die
 * Herkunftsprüfung eines Fällvorgangs ist er der ganze Punkt: Im ersten Fall
 * gibt es nichts zu verknüpfen, im zweiten geht eine belegbare Kante verloren,
 * ohne dass jemand es merkt. Genau das ist am 02.09.2026 passiert — der Katalog
 * lieferte vier tote Datensatz-URLs, und der Upload lief kommentarlos ohne
 * TransformationEvent durch.
 */
export type PlantingLoadReason =
  /** Flächen geladen (auch wenn es null gibt — die Abfrage lief sauber). */
  | 'ok'
  /** Der Katalog kennt keine Quellen, oder alle sind weggefiltert. */
  | 'no-sources'
  /** Quellen bekannt, aber die Abfrage schlug fehl (Netz, Rechte, tote URLs). */
  | 'query-failed';

/** Flächen samt Auskunft darüber, wie das Ergebnis zustande kam. */
export interface PlantingAreaLoad {
  areas: PlantingAreaResult[];
  reason: PlantingLoadReason;
  /** Wie viele Quellen befragt wurden — zur Einordnung eines leeren Ergebnisses. */
  sourceCount: number;
  /** Fehlertext, falls die Abfrage scheiterte. */
  error: string | null;
}

/**
 * Alle sichtbaren Pflanzflächen laden — mit Begründung.
 *
 * Wirft nie: Aufrufer, die nur zeichnen wollen, sollen nicht an einem lahmen
 * Katalog scheitern. Wer den Unterschied braucht, liest `reason`.
 */
export async function loadPlantingAreasWithReason(): Promise<PlantingAreaLoad> {
  let sources: string[] = [];
  try {
    sources = await resolvePlantingSources();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[planting-lookup] Quellen nicht ermittelbar:', err);
    return { areas: [], reason: 'query-failed', sourceCount: 0, error };
  }

  if (sources.length === 0) {
    console.warn(
      '[planting-lookup] Keine Datenquellen — der Katalog ist leer oder nicht erreichbar.',
    );
    return { areas: [], reason: 'no-sources', sourceCount: 0, error: null };
  }

  try {
    const areas = await queryPlantingAreas(sources);
    const usable = areas.filter((a) => a.ring && a.ring.length >= 3);
    console.info(
      `[planting-lookup] ${sources.length} Quelle(n) befragt, ` +
        `${areas.length} Fläche(n) gefunden, ${usable.length} mit Polygon.`,
    );
    return { areas: usable, reason: 'ok', sourceCount: sources.length, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[planting-lookup] Flächen nicht ladbar:', err);
    return {
      areas: [],
      reason: 'query-failed',
      sourceCount: sources.length,
      error,
    };
  }
}

/**
 * Alle sichtbaren Pflanzflächen laden — für die Anzeige auf der Karte.
 *
 * Damit muss niemand raten, wo eine Fläche liegt: Was der Nutzer laut seiner
 * Rolle sehen darf, ist eingezeichnet, bevor er den ersten Punkt setzt.
 *
 * Wirft nie. Der Kartenhintergrund ist Orientierung, keine Voraussetzung —
 * fällt er aus, bleibt die Suche selbst bedienbar und meldet ihre Fehler
 * getrennt.
 */
export async function loadVisiblePlantingAreas(): Promise<PlantingAreaResult[]> {
  const { areas } = await loadPlantingAreasWithReason();
  return areas;
}

/**
 * Die Pflanzungen an einer Position finden.
 *
 * Wirft bei Netz-/Katalogproblemen — anders als die Konfliktprüfung beim
 * Upload, die bewusst schweigend durchlässt. Hier ist die Suche der Zweck der
 * Handlung: Ein stilles leeres Ergebnis wäre von „an dieser Stelle wurde nichts
 * gepflanzt" nicht zu unterscheiden, und der Nutzer würde am falschen Ort
 * suchen.
 */
export async function findPlantingsAt(
  point: GeoPoint,
  sources?: string[],
): Promise<PlantingLookupResult> {
  const effectiveSources =
    sources && sources.length > 0 ? sources : await resolvePlantingSources();

  if (effectiveSources.length === 0) {
    throw new Error(
      'Es sind keine Datenquellen bekannt — der Katalog konnte nicht geladen werden.',
    );
  }

  const areas = await queryPlantingAreas(effectiveSources);
  const containing = areasContaining(point, areas) as PlantingAreaResult[];

  const hits: PlantingHit[] = [];
  let withoutEpc = 0;

  for (const area of containing) {
    if (!area.epc) {
      withoutEpc++;
      continue;
    }
    hits.push({
      area,
      epc: area.epc,
      label: plantingLabel(area),
      hectares: ringAreaHectares(area.ring),
    });
  }

  // Die kleinste Fläche zuerst. Liegen Flächen ineinander (Teilbestand
  // innerhalb eines größeren Schlags), ist die kleinere die genauere Aussage
  // über den Standort.
  hits.sort((a, b) => a.hectares - b.hectares);

  return { hits, withoutEpc };
}

/** Fehlertext der Geolocation-API in einen brauchbaren Satz übersetzen. */
export function describeGeolocationError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Der Zugriff auf den Standort wurde abgelehnt. Erlauben Sie ihn in den Browsereinstellungen, oder wählen Sie den Ort auf der Karte.';
    case err.POSITION_UNAVAILABLE:
      return 'Der Standort ist nicht ermittelbar — unter dichtem Kronendach kommt das vor. Wählen Sie den Ort auf der Karte.';
    case err.TIMEOUT:
      return 'Die Standortbestimmung hat zu lange gedauert. Erneut versuchen oder den Ort auf der Karte wählen.';
    default:
      return err.message || 'Der Standort konnte nicht bestimmt werden.';
  }
}

/**
 * Steht die Geolocation-API zur Verfügung?
 *
 * Browser geben sie nur in einem "secure context" frei: HTTPS oder localhost.
 * Auf dem Zebra-Gerät im LAN über http:// fehlt sie deshalb — dieselbe Hürde,
 * an der schon der Kamera-Scanner scheiterte (siehe ScanView). Die Karte ist
 * dort der Weg, und der Nutzer soll das als Hinweis lesen und nicht als
 * kaputten Knopf.
 */
export function isGeolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator && window.isSecureContext;
}

/** Aktuelle Position des Geräts holen. */
export function getCurrentPosition(): Promise<{ point: GeoPoint; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!isGeolocationAvailable()) {
      reject(
        new Error(
          'Die Standortbestimmung ist hier nicht verfügbar. Sie setzt eine gesicherte Verbindung (HTTPS) voraus — wählen Sie den Ort auf der Karte.',
        ),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          point: { lat: pos.coords.latitude, lon: pos.coords.longitude },
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(new Error(describeGeolocationError(err))),
      // Hohe Genauigkeit: Die Flächen sind klein, eine netzbasierte Ortung
      // von mehreren hundert Metern träfe regelmäßig die falsche oder gar
      // keine. Lieber länger warten und das GPS abfragen.
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    );
  });
}
