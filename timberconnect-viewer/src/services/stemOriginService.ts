/**
 * Herkunft eines Fällvorgangs: Stammkoordinate -> Pflanzfläche.
 *
 * Die Lücke, die dieser Dienst schließt: Ein Pflanzvorgang erzeugt ein
 * ObjectEvent über sein Saatgut, ein Fällvorgang eines über das Rundholz —
 * beide sind Wurzelknoten. Zwischen ihnen liegt keine Kante, und deshalb endet
 * jede Abfrage, die bei der Pflanzung beginnt, sofort wieder bei ihr (siehe
 * `fetchProductDataByEpc`: `collectEpcs` findet nichts als den Ident, mit dem
 * gestartet wurde).
 *
 * Die Kante ist aber ableitbar. Das Harvesterprotokoll führt pro Stamm eine
 * GPS-Koordinate, das Stammzertifikat führt die gepflanzte Fläche als Polygon.
 * Liegt die eine im anderen, ist der Stamm auf dieser Fläche gewachsen. Genau
 * dafür wird die Fläche beim Pflanzvorgang überhaupt erhoben — der
 * Kopfkommentar von `geoService.areasContaining` benennt diesen Fall als seinen
 * Zweck.
 *
 * ## Warum im Browser und nicht im Python-Dienst
 *
 * Die Polygone liegen in den Pods und sind nur mit der Solid-Session des
 * Nutzers lesbar. Der EPCIS-Dienst hat diese Session nicht; er müsste sie
 * durchgereicht bekommen und Punkt-in-Polygon ein zweites Mal implementieren.
 * Hier ist beides schon da.
 *
 * ## Was dieser Dienst NICHT tut
 *
 * Er schreibt nichts. Er liefert einen Vorschlag, den der Nutzer im Prüfschritt
 * sieht und bestätigt, bevor irgendetwas ins EPCAT geht. Die Zuordnung ist
 * geometrisch erschlossen und damit schwächer belegt als eine Kante aus einer
 * Leistungserklärung, die zwei Akteure namentlich nennt — sie ungefragt ins
 * LIVE-Repository zu schreiben wäre die falsche Voreinstellung. Aus demselben
 * Grund trägt das erzeugte Event `tc:linkBasis "geometric"`: später soll
 * niemand raten müssen, woher die Verbindung kam.
 */

import { areasContaining, type GeoPoint } from './geoService';
import type { PlantingAreaResult } from './sparqlService';
import { plantingLabel, type PlantingAreaLoad } from './plantingLookupService';

/** Ein Stamm aus dem Harvesterprotokoll mit seiner Fällposition. */
export interface HarvestedStem {
  /** StemKey aus dem Protokoll — die Nummer, die der Maschinenführer sieht. */
  stemKey: string;
  /** GS1-EPC des Stamms (aus <Identity>), sofern vorhanden. */
  epc: string | null;
  /** Fällposition (Kranspitze, sonst Basismaschine). */
  position: GeoPoint | null;
  /**
   * Welche Empfängerposition die Koordinate liefert. Die Kranspitze steht beim
   * Fällen am Baum, die Basismaschine auf der Rückegasse daneben — an einer
   * Flächengrenze entscheidet das über die Zuordnung.
   */
  positionSource: 'crane' | 'machine' | null;
}

/** Eine Gruppe von Stämmen, die derselben Pflanzfläche zugeordnet wurden. */
export interface OriginGroup {
  area: PlantingAreaResult;
  /** Anzeigename der Fläche (Stammzertifikat-Nr., sonst Baumart/Jahr). */
  label: string;
  /** EPC des Vermehrungsguts — die Eingangsseite des Events. */
  seedEpc: string;
  /** Die Stämme, deren Position in dieser Fläche liegt. */
  stems: HarvestedStem[];
}

/**
 * Warum ein Vorschlag leer blieb.
 *
 * Ohne diese Unterscheidung sieht „auf keiner registrierten Fläche gewachsen"
 * genauso aus wie „die Flächen waren nicht ladbar" — in beiden Fällen null
 * Gruppen. Der erste Fall ist Alltag (Altbestand), der zweite ein Fehler, der
 * eine belegbare Herkunftskante verschluckt. Am 02.09.2026 trat der zweite
 * ein: ein veralteter Katalog lieferte tote Datensatz-URLs, der Fällvorgang
 * ging ohne TransformationEvent ins EPCAT, und nichts wies darauf hin.
 */
export type OriginBlocker =
  /** Das Protokoll enthält keine auswertbaren Stämme. */
  | 'no-stems'
  /** Der Katalog kennt keine Quellen. */
  | 'no-sources'
  /** Quellen bekannt, aber die Flächenabfrage schlug fehl. */
  | 'areas-unavailable'
  /** Flächen geladen, aber keine trägt EPC UND Polygon. */
  | 'no-usable-areas';

/** Ergebnis der Herkunftsprüfung eines Fällvorgangs. */
export interface OriginProposal {
  /** Alle im Protokoll gefundenen Stämme. */
  totalStems: number;
  /** Zuordnungen, je Fläche eine Gruppe. */
  groups: OriginGroup[];
  /**
   * Stämme ohne Flächentreffer. Kein Fehler: Altbestand hat nie ein
   * Stammzertifikat gesehen. Sie bleiben im gewöhnlichen ObjectEvent.
   */
  unmatched: HarvestedStem[];
  /**
   * Stämme, deren Position im Protokoll fehlt. Getrennt von `unmatched`
   * ausgewiesen, weil die Aussage eine andere ist: hier wurde nicht geprüft,
   * dort wurde geprüft und nichts gefunden.
   */
  withoutPosition: HarvestedStem[];
  /**
   * Stämme, die in MEHRERE Flächen fallen. Sie erscheinen in keiner Gruppe.
   * Überlappende Flächen soll es dank der Konfliktprüfung beim Zeichnen nicht
   * geben (siehe plantingAreaConflictService); trifft es doch zu, ist die
   * Herkunft nicht entscheidbar und darf nicht geraten werden.
   */
  ambiguous: HarvestedStem[];
  /**
   * Warum es nichts zu bestätigen gibt — nur gesetzt, wenn `groups` leer ist.
   * `null` heißt: sauber geprüft, es gibt schlicht keine Zuordnung.
   */
  blocker: OriginBlocker | null;
  /** Klartext zum Blocker, für die Anzeige im Upload-Dialog. */
  blockerDetail: string | null;
  /** Wie viele Flächen geladen und wie viele davon brauchbar waren. */
  areasLoaded: number;
  areasUsable: number;
}

/**
 * Die Fällposition eines Stamms aus seinem XML-Block lesen.
 *
 * Bevorzugt die Kranspitze: sie steht beim Fällen am Baum, während die
 * Basismaschine auf der Rückegasse steht. Im Demo-Protokoll trennt die beiden
 * rund 4 m — an einer Flächengrenze ist das der Unterschied zwischen richtiger
 * und falscher Zuordnung.
 *
 * Die StanForD-Attributwerte sind Klartext ("Crane tip position when felling
 * the tree"); geprüft wird auf das Teilwort "crane", damit Schreibvarianten
 * anderer Hersteller nicht durchfallen.
 */
function positionFromStemBlock(block: string): {
  position: GeoPoint | null;
  source: 'crane' | 'machine' | null;
} {
  const coordRe =
    /<StemCoordinates\b([^>]*)>([\s\S]*?)<\/StemCoordinates>/gi;

  let machine: GeoPoint | null = null;
  let crane: GeoPoint | null = null;

  for (const match of block.matchAll(coordRe)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';

    const lat = Number(/<Latitude\b[^>]*>([^<]+)<\/Latitude>/i.exec(body)?.[1]);
    const lon = Number(/<Longitude\b[^>]*>([^<]+)<\/Longitude>/i.exec(body)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // Südliche Breite / westliche Länge kommen in StanForD als positiver Wert
    // mit einer Kategorie daneben. Ohne diese Auswertung landete ein Bestand
    // auf der Südhalbkugel spiegelverkehrt auf der Nordhalbkugel.
    const latCat = /latitudeCategory="([^"]*)"/i.exec(body)?.[1] ?? '';
    const lonCat = /longitudeCategory="([^"]*)"/i.exec(body)?.[1] ?? '';
    const point: GeoPoint = {
      lat: /south/i.test(latCat) ? -Math.abs(lat) : lat,
      lon: /west/i.test(lonCat) ? -Math.abs(lon) : lon,
    };

    if (/crane/i.test(attrs)) crane = point;
    else machine = point;
  }

  if (crane) return { position: crane, source: 'crane' };
  if (machine) return { position: machine, source: 'machine' };
  return { position: null, source: null };
}

/**
 * Stämme samt Position aus einem Harvesterprotokoll lesen.
 *
 * Bewusst über reguläre Ausdrücke auf den <Stem>-Blöcken statt über einen
 * DOM-Parse des ganzen Dokuments: Gebraucht werden drei Werte je Stamm, und die
 * Blockgrenze ist das, was Koordinate und Ident zusammenhält. Ein DOMParser
 * wäre hier nicht falsch, aber er brächte die Frage nach Namensräumen mit
 * (StanForD-Dateien tragen wechselnde Default-Namespaces), ohne etwas zu
 * lösen, was hier gebraucht wird.
 *
 * Wirft nicht. Ein Protokoll ohne verwertbare Stämme liefert eine leere Liste;
 * der Aufrufer erkennt das an `totalStems === 0` und lässt den Upload
 * unverändert durchlaufen.
 */
export function extractStems(hprText: string): HarvestedStem[] {
  const stems: HarvestedStem[] = [];
  const stemRe = /<Stem\b[^>]*>([\s\S]*?)<\/Stem>/gi;

  for (const match of hprText.matchAll(stemRe)) {
    const block = match[1] ?? '';
    const stemKey =
      /<StemKey\b[^>]*>([^<]+)<\/StemKey>/i.exec(block)?.[1]?.trim() ?? '';

    // Der Ident steht am Log, nicht am Stamm. Im vorliegenden Protokoll trägt
    // jeder Stamm genau einen Log; gibt es mehrere, ist der erste der des
    // Erdstamms — er repräsentiert den Baum.
    const epc =
      /<Identity\b[^>]*>\s*(urn:epc:[^<\s]+)\s*<\/Identity>/i
        .exec(block)?.[1]
        ?.trim() ?? null;

    const { position, source } = positionFromStemBlock(block);

    if (!stemKey && !epc) continue;
    stems.push({ stemKey: stemKey || '—', epc, position, positionSource: source });
  }

  return stems;
}

/**
 * Stämme den Pflanzflächen zuordnen.
 *
 * Die Gruppierung je Fläche ist wesentlich und nicht bloß Kosmetik: Ein
 * Einschlag kann über zwei Flächen laufen. Alle Stämme in ein Event zu pressen
 * würde eine gemeinsame Herkunft behaupten, die die Koordinaten nicht hergeben
 * — je Fläche ein eigenes TransformationEvent ist die Aussage, die zutrifft.
 *
 * Flächen ohne `epc` werden übersprungen: ohne Ident des Vermehrungsguts gibt
 * es keine Eingangsseite für das Event, und eine Kante ins Leere ist keine.
 */
export function matchStemsToAreas(
  stems: HarvestedStem[],
  areas: PlantingAreaResult[],
): OriginProposal {
  const usable = areas.filter((a) => a.epc && a.ring && a.ring.length >= 3);

  const byIri = new Map<string, OriginGroup>();
  const unmatched: HarvestedStem[] = [];
  const withoutPosition: HarvestedStem[] = [];
  const ambiguous: HarvestedStem[] = [];

  for (const stem of stems) {
    if (!stem.position) {
      withoutPosition.push(stem);
      continue;
    }

    const hits = areasContaining(stem.position, usable) as PlantingAreaResult[];

    if (hits.length === 0) {
      unmatched.push(stem);
      continue;
    }
    if (hits.length > 1) {
      // Zwei gültige Herkünfte für denselben Stamm — nicht entscheidbar.
      ambiguous.push(stem);
      continue;
    }

    const area = hits[0];
    const existing = byIri.get(area.certificateIri);
    if (existing) {
      existing.stems.push(stem);
    } else {
      byIri.set(area.certificateIri, {
        area,
        label: plantingLabel(area),
        // `usable` ist auf Flächen mit EPC gefiltert; der Wert ist hier gesetzt.
        seedEpc: area.epc as string,
        stems: [stem],
      });
    }
  }

  // Größte Gruppe zuerst — sie ist die Hauptherkunft des Vorgangs.
  const groups = Array.from(byIri.values()).sort(
    (a, b) => b.stems.length - a.stems.length,
  );

  // Flächen da, aber keine brauchbar: Das ist kein "nichts gefunden", sondern
  // ein Datenmangel (Fläche ohne EPC oder ohne Polygon) — er gehört benannt.
  const blocker: OriginBlocker | null =
    groups.length === 0 && areas.length > 0 && usable.length === 0
      ? 'no-usable-areas'
      : null;

  return {
    totalStems: stems.length,
    groups,
    unmatched,
    withoutPosition,
    ambiguous,
    blocker,
    blockerDetail:
      blocker === 'no-usable-areas'
        ? `${areas.length} Fläche(n) geladen, aber keine trägt sowohl einen ` +
          'Saatgut-Ident als auch ein Polygon.'
        : null,
    areasLoaded: areas.length,
    areasUsable: usable.length,
  };
}

/** Gibt es überhaupt etwas zu bestätigen? */
export function hasOriginLink(proposal: OriginProposal | null): boolean {
  return !!proposal && proposal.groups.length > 0;
}

/** Leerer Vorschlag mit benanntem Grund. */
function emptyProposal(
  totalStems: number,
  blocker: OriginBlocker,
  detail: string | null,
  areasLoaded = 0,
  areasUsable = 0,
): OriginProposal {
  return {
    totalStems,
    groups: [],
    unmatched: [],
    withoutPosition: [],
    ambiguous: [],
    blocker,
    blockerDetail: detail,
    areasLoaded,
    areasUsable,
  };
}

/**
 * Den Vorschlag für ein Harvesterprotokoll erstellen.
 *
 * Wirft nie: Die Herkunftsverknüpfung ist eine Zugabe zum Upload, keine
 * Voraussetzung. Scheitert das Laden der Flächen (Netz, Rechte), soll der
 * Fällvorgang trotzdem hochladbar bleiben — dann eben ohne Kante, wie bisher.
 *
 * Liefert aber NICHT mehr `null` für jeden Fehlschlag: Der Aufrufer soll
 * unterscheiden können, ob nichts zu verknüpfen war oder ob die Prüfung
 * ausgefallen ist. Nur ein Protokoll ohne Stämme ergibt gar keinen Vorschlag.
 */
export async function proposeOrigin(
  hprText: string,
  loadAreas: () => Promise<PlantingAreaLoad>,
): Promise<OriginProposal> {
  let stems: HarvestedStem[] = [];
  try {
    stems = extractStems(hprText);
  } catch (err) {
    console.warn('[stem-origin] Protokoll nicht lesbar:', err);
    return emptyProposal(0, 'no-stems', 'Das Protokoll war nicht lesbar.');
  }

  if (stems.length === 0) {
    console.info('[stem-origin] Keine auswertbaren Stämme im Protokoll.');
    return emptyProposal(0, 'no-stems', null);
  }

  let load: PlantingAreaLoad;
  try {
    load = await loadAreas();
  } catch (err) {
    // loadPlantingAreasWithReason wirft eigentlich nicht; ein eigener Aufrufer
    // koennte es aber. Der Fällvorgang soll daran nicht scheitern.
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[stem-origin] Flächen nicht ladbar:', err);
    return emptyProposal(stems.length, 'areas-unavailable', detail);
  }

  if (load.reason === 'no-sources') {
    return emptyProposal(
      stems.length,
      'no-sources',
      'Der Katalog kennt keine Datenquellen.',
    );
  }
  if (load.reason === 'query-failed') {
    return emptyProposal(
      stems.length,
      'areas-unavailable',
      load.error ??
        `Die Flächenabfrage über ${load.sourceCount} Quelle(n) schlug fehl.`,
    );
  }

  const proposal = matchStemsToAreas(stems, load.areas);
  console.info(
    `[stem-origin] ${proposal.totalStems} Stamm/Stämme, ` +
      `${proposal.areasUsable}/${proposal.areasLoaded} Fläche(n) brauchbar, ` +
      `${proposal.groups.length} Zuordnung(en), ` +
      `${proposal.unmatched.length} ohne Treffer, ` +
      `${proposal.withoutPosition.length} ohne Position.`,
  );
  return proposal;
}
