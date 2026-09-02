/**
 * Belegte Pflanzflächen: „first come, first serve".
 *
 * Zwei Pflanzvorgänge dürfen nicht dieselbe Fläche beanspruchen. Der Grund ist
 * kein formaler, sondern ein handfester: Über die Fläche werden später
 * geerntete Stämme anhand ihrer GPS-Position einem Pflanzvorgang zugeordnet
 * (siehe findPlantingAreasForPosition). Überlappen sich zwei Flächen, liefert
 * dieselbe Position ZWEI Herkünfte, und beide sehen im Graph gleich gültig aus.
 * Welche stimmt, lässt sich hinterher nicht mehr entscheiden.
 *
 * Deshalb wird die Fläche beim Zeichnen gegen alle bereits registrierten
 * geprüft. Wer zuerst da war, behält sie; die neue Fläche muss ausweichen.
 *
 * Die Prüfung läuft vollständig im Browser — die Pods werten kein GeoSPARQL
 * aus (siehe Kopfkommentar in geoService.ts), ein geof:sfOverlaps-Filter im
 * SPARQL bliebe wirkungslos.
 */

import { queryPlantingAreas } from './sparqlService';
import { resolvePlantingSources } from './plantingLookupService';
import { ringAreaHectares } from './geoService';
import { findOverlaps, type OverlapHit, type Ring } from './polygonOverlap';

/** Eine bereits belegte Fläche. */
export interface OccupiedArea {
  certificateIri: string;
  ring: Ring;
  /** Zertifikatsnummer, sofern im Graph vorhanden — für die Meldung. */
  certificateNumber?: string | null;
}

/** Ergebnis der Konfliktprüfung. */
export interface ConflictResult {
  /** Überschneidungen mit bestehenden Flächen. Leer = Fläche ist frei. */
  hits: OverlapHit[];
  /** Zusammengefasste Größe aller Überschneidungen in Hektar. */
  totalHectares: number;
}

/**
 * Alle bereits registrierten Pflanzflächen laden.
 *
 * Breit über alle Quellen, nicht nur den eigenen Pod: Eine Fläche kann von
 * einem anderen Forstbetrieb registriert worden sein, und genau der Fall ist
 * der interessante. Nur die eigenen Flächen zu prüfen würde die
 * Doppelbelegung erst recht zulassen.
 *
 * Die Quellen kommen aus `resolvePlantingSources` und damit ausdrücklich NICHT
 * aus dem Produktkatalog. Der verwirft Datensätze ohne lesbare Bauteil-ID —
 * also gerade die Stammzertifikate, um die es hier geht. Über Produkte gesucht
 * blieben frisch registrierte Flächen unsichtbar, und die Prüfung meldete
 * "frei" für eine längst vergebene Fläche: der Fehler, den zu verhindern ihr
 * einziger Zweck ist.
 *
 * Wirft nie: Ist der Katalog nicht erreichbar, kommt eine leere Liste zurück.
 * Das ist eine bewusste Entscheidung — siehe `checkAreaConflicts`.
 */
export async function loadOccupiedAreas(): Promise<OccupiedArea[]> {
  try {
    const sources = await resolvePlantingSources();
    if (sources.length === 0) return [];

    const areas = await queryPlantingAreas(sources);
    return areas
      .filter((area) => area.ring && area.ring.length >= 3)
      .map((area) => ({
        certificateIri: area.certificateIri,
        ring: area.ring,
        certificateNumber: area.certificateNumber ?? null,
      }));
  } catch (err) {
    console.warn('[planting-conflict] Belegte Flächen nicht ladbar:', err);
    return [];
  }
}

/**
 * Eine gezeichnete Fläche gegen die belegten prüfen.
 *
 * `candidate` ist der Ring des GeoJSON-Polygons ([lon, lat]).
 *
 * Zur Fehlertoleranz: Konnten die bestehenden Flächen nicht geladen werden,
 * meldet diese Funktion KEINEN Konflikt. Das ist Absicht. Die Alternative wäre,
 * bei jedem Netzproblem jede Registrierung zu blockieren — eine Sperre, die
 * niemand auflösen kann, weil sie nichts mit der gezeichneten Fläche zu tun
 * hat. Die Prüfung ist ein Schutz gegen Doppelbelegung, kein Torwächter.
 */
export function checkAreaConflicts(
  candidate: Ring,
  occupied: OccupiedArea[],
): ConflictResult {
  const hits = findOverlaps(candidate, occupied, ringAreaHectares);
  const totalHectares = hits.reduce(
    (sum, hit) => sum + hit.rings.reduce((s, r) => s + ringAreaHectares(r), 0),
    0,
  );
  return { hits, totalHectares };
}

/** Anzeigename einer betroffenen Fläche. */
export function conflictLabel(
  hit: OverlapHit,
  occupied: OccupiedArea[],
): string {
  const area = occupied.find((a) => a.certificateIri === hit.certificateIri);
  if (area?.certificateNumber) return `Stammzertifikat ${area.certificateNumber}`;
  // Ohne Nummer bleibt die IRI — ihr letztes Segment ist noch das Lesbarste.
  const tail = hit.certificateIri.split(/[/#]/).filter(Boolean).pop();
  return tail ? `Zertifikat ${tail}` : 'ein bestehender Pflanzvorgang';
}
