/**
 * Welches Produkt liegt vor -- und welches Foto zeigt es?
 *
 * Die App zeigte bisher zu jedem Produkt eine von genau ZWEI Illustrationen
 * ("finished" = BSP-Platte, "raw_material" = Baumstumpf). Damit bekam das
 * Schnittholz aus dem Saegewerk dasselbe Bild wie ein Stamm im Wald, und ein
 * Saatgut-Vorgang zeigte einen Baumstumpf. Diese Datei loest beides:
 *
 *   1. ``detectProductStage`` bestimmt die Stufe der Wertschoepfungskette aus
 *      den vorhandenen Daten -- feiner als der bestehende ``productType``, der
 *      dafuer weiterhin als Rueckfallebene dient.
 *   2. ``productImageFor`` liefert das dazugehoerige Foto samt Beschriftung.
 *
 * Die Fotos liegen als statische Dateien unter ``public/images/`` und werden
 * NICHT gebundelt -- sie lassen sich also austauschen, ohne den Viewer neu zu
 * bauen (im Container: die Datei im nginx-Verzeichnis ersetzen). Fehlt ein
 * Foto, greift automatisch die bisherige SVG-Illustration; die Ansicht bleibt
 * dadurch in jedem Fall vollstaendig.
 */

import type { Product, ProductType } from '../types';
import type { ProductDataResult } from './sparqlService';

/**
 * Stufe der Wertschoepfungskette -- eine je Produktart, die im Datenraum
 * TATSAECHLICH einen eigenen Ident bekommt:
 *
 *   Pflanzvorgang      -> LGTIN des Saatgut-Loses      (…0001.Pflanzung01)
 *   Faellvorgang       -> SGTIN je Stamm               (…0100.*)
 *   Aufsaegevorgang    -> SGTIN je Lamelle
 *   Herstellungsvorgang-> SGTIN der BSP-Platte         (…0401.*)
 *
 * Die Kette endet bei der Platte: einen fuenften Vorgang "Einbau" gibt es
 * nicht, ein verbautes Bauteil erhaelt keinen eigenen Ident (vgl.
 * processService.ts, das genau diese vier Vorgaenge fuehrt). Eine Stufe
 * "Bauwerk" waere darum nie erkennbar und wird bewusst nicht gefuehrt --
 * sonst stuende in der Auswahl eine Produktart, die kein Scan je trifft.
 */
export type ProductStage =
  | 'seedling' // Saatgut-Los / Pflanzvorgang
  | 'stem' // Rundholz / Stamm nach dem Faellvorgang
  | 'lamella' // Schnittholz / Lamelle aus dem Saegewerk
  | 'clt-panel'; // Brettsperrholzplatte -- letzte identifizierte Stufe

export interface ProductImage {
  stage: ProductStage;
  /** Pfad zum Foto -- unter Vites BASE_URL, damit /timberconnect/ stimmt. */
  src: string;
  /** Illustration, falls das Foto (noch) fehlt. */
  fallbackSrc: string;
  /** Beschriftung im Badge, z.B. "BSP-Platte". */
  label: string;
  /** Bildbeschreibung fuer Screenreader. */
  alt: string;
}

const BASE_URL = import.meta.env.BASE_URL;

/**
 * Dateinamen der realen Fotos.
 *
 * Zum Austauschen genau diese Namen unter ``public/images/`` ablegen -- der
 * Code muss dafuer nicht angefasst werden. Bewusst ``.jpg``: Fotos, keine
 * Illustrationen. Der Fallback zeigt bis dahin die vorhandene SVG-Grafik.
 */
const STAGE_IMAGES: Record<ProductStage, { file: string; fallback: string; label: string; alt: string }> = {
  seedling: {
    file: 'product-seedling.jpg',
    fallback: 'tree-stump-placeholder.svg',
    label: 'Saatgut / Pflanzung',
    alt: 'Forstpflanze beziehungsweise Saatgut der erfassten Partie',
  },
  stem: {
    file: 'product-stem.jpg',
    fallback: 'tree-stump-placeholder.svg',
    label: 'Rundholz',
    alt: 'Gefaellter Baumstamm am Polter im Wald',
  },
  lamella: {
    file: 'product-lamella.jpg',
    fallback: 'tree-stump-placeholder.svg',
    label: 'Schnittholz / Lamelle',
    alt: 'Gestapelte Schnittholzlamellen im Saegewerk',
  },
  'clt-panel': {
    file: 'product-clt-panel.jpg',
    fallback: 'bsp-plate-placeholder.svg',
    label: 'BSP-Platte',
    alt: 'Brettsperrholzplatte mit sichtbarem Schichtaufbau',
  },
};

// ---------------------------------------------------------------------------
// Erkennung
// ---------------------------------------------------------------------------

/**
 * Stufe der Wertschoepfungskette bestimmen.
 *
 * Ausgewertet wird von der spaetesten zur fruehesten Stufe: ein Bauteil, das
 * bereits eine BSP-Platte IST, hat auch noch Stamm- und Lamellendaten in der
 * Kette haengen (die Herkunft bleibt ja erhalten). Wer von vorne pruefte,
 * bekaeme fuer jede BSP-Platte "Rundholz" -- deshalb gewinnt die am weitesten
 * fortgeschrittene Stufe, fuer die es einen Beleg gibt.
 *
 * ``productType`` aus dem bestehenden Mapper bleibt die Rueckfallebene, damit
 * diese Funktion nie schlechter liegt als der bisherige Zustand.
 */
export function detectProductStage(
  product: Product | null,
  data?: ProductDataResult | null,
): ProductStage | null {
  // Ausschliesslich der RDF-Typ der Stammdaten.
  //
  // Frueher standen hier Ersatzwege — Textabgleich auf Artikelnamen und
  // Rueckschluesse aus der Datenlage ("BSP-Werk-Daten geladen, also Platte").
  // Beim Scan wird jedoch die GESAMTE Lieferkette geladen: zu einem Stamm
  // gehoeren auch die Platte, in die er verbaut wurde, und deren Werksdaten.
  // Damit galt jedes Rundholz als BSP-Platte.
  //
  // Solche Ersatzwege sind bewusst entfernt: Sie liefern im Zweifel eine
  // falsche Angabe, ohne dass nachvollziehbar waere, wie sie zustande kommt.
  // Fehlt der Typ, wird null geliefert — die Oberflaeche zeigt dann keine
  // Produktart an, statt eine falsche zu behaupten.
  return stageFromMasterData(product?.id, data);
}

/**
 * Stufe aus dem RDF-Typ der Stammdaten bestimmen.
 *
 * Der Typ steht am Subjekt, das den Ident traegt — die Mappings des
 * Konverters schreiben ihn (``rr:class tc:Stem``, ``tc:Log``, ``tc:LogPile``
 * usw.), und die Ontologie fuehrt die passenden Klassen.
 *
 * Bewusst KEIN Rateschluss aus Artikelnummern oder aus der Rolle in den
 * EPCIS-Events: Ersteres gilt nur fuer die heutigen Demo-Idente, Letzteres
 * ist ein Rueckschluss ("wurde verarbeitet, also Rohstoff"), der bei jeder
 * unerwarteten Ereignisfolge still danebenliegt. Der Typ ist eine Auskunft,
 * keine Vermutung — und wenn er fehlt, soll das sichtbar sein statt durch
 * eine Ersatzlogik verdeckt zu werden.
 *
 * Die Zuordnung geht ueber lokale Klassennamen, nicht ueber ganze URIs:
 * dadurch bleibt sie fuer weitere Namensraeume gueltig.
 */
const TYPE_TO_STAGE: Array<{ classes: string[]; stage: ProductStage }> = [
  // Endprodukte: Brettsperrholz und andere Platten.
  { classes: ['clt', 'panel', 'buildingproduct', 'buildingelement', 'wall', 'ceiling', 'roof'], stage: 'clt-panel' },
  // Schnittholz aus dem Saegewerk.
  { classes: ['sawntimber', 'lamella', 'board', 'buildingmaterial'], stage: 'lamella' },
  // Rundholz: Stamm, Abschnitt, Baum, Polter, Sortiment.
  { classes: ['stem', 'log', 'tree', 'logpile', 'assortment'], stage: 'stem' },
  // Vor dem Wald: Saatgut und Jungpflanze.
  { classes: ['seed', 'seedling'], stage: 'seedling' },
];

/**
 * Klassen, die den Ident zwar tragen, aber nichts ueber die Produktart sagen.
 *
 * Ein Ident haengt an MEHREREN Subjekten: am Erzeugnis selbst (``tc:Panel``
 * aus dem ERP-Auszug) und an jedem Dokument, das sich darauf bezieht. Die
 * Leistungserklaerung etwa fuehrt ihren Materialbezug ueber ``tc:epc``
 * (``materialEpc``) und ist damit unter demselben Ident auffindbar -- das ist
 * so gewollt, sonst faende ein Scan die zugehoerigen Papiere nicht.
 *
 * Fuer die Produktart sind diese Traeger aber ohne Aussage: eine
 * Leistungserklaerung IST keine Produktart, sie BESCHREIBT eine. Welches
 * Subjekt zuerst in den Bindings steht, haengt an der Reihenfolge der
 * geladenen Quellen -- ohne diese Liste entschiede der Zufall, ob eine Platte
 * als "BSP-Platte" oder als gar nichts gilt.
 */
const NON_PRODUCT_CLASSES = [
  'declarationofperformance',
  'epcisdocument',
  'testreport',
  'certificate',
  'deliveryorder',
  'transportorder',
  'invoice',
  'article',
  'warehouse',
  'carrier',
  'deliverycondition',
];

/**
 * Vorgangstypen, die am Ident haengen.
 *
 * Die Idente tragen nicht immer eine Produktklasse — haeufig haengt an ihnen
 * der VORGANG, aus dem sie hervorgegangen sind (``tc:SawingProcess`` aus der
 * Leistungserklaerung). Der Vorgang bestimmt das Erzeugnis eindeutig:
 * was aus einem Saegevorgang kommt, ist Schnittholz.
 */
const PROCESS_TO_STAGE: Array<{ classes: string[]; stage: ProductStage }> = [
  { classes: ['sawingprocess', 'sawing'], stage: 'lamella' },
  { classes: ['manufacturingprocess', 'pressingprocess'], stage: 'clt-panel' },
  { classes: ['fellingprocess', 'harvestingprocess'], stage: 'stem' },
  { classes: ['plantingprocess', 'seedingprocess'], stage: 'seedling' },
];

/** Lokalen Namen einer Klassen-URI ermitteln (nach # oder letztem /). */
function localName(uri: string): string {
  const withoutPrefix = uri.includes('#') ? uri.split('#').pop()! : uri.split('/').pop()!;
  // Auch die Praefixform "tc:Stem" abdecken.
  return (withoutPrefix.includes(':') ? withoutPrefix.split(':').pop()! : withoutPrefix)
    .trim()
    .toLowerCase();
}

/**
 * Alle RDF-Typen einsammeln, die zum erfassten Ident gehoeren.
 *
 * Wichtig ist die Einschraenkung auf das Subjekt mit DIESEM Ident: beim Scan
 * wird die ganze Lieferkette geladen, in den Bindings stehen also auch die
 * Typen der Platte, in die ein Stamm verbaut wurde.
 */
function stageFromMasterData(
  id: string | undefined,
  data: ProductDataResult | null | undefined,
): ProductStage | null {
  if (!id || !data) return null;

  // Nur die Treffer des GESCANNTEN Idents auswerten.
  //
  // ``data.product`` taugt dafuer nicht: Beim EPC-Abruf laeuft createEpcQuery
  // fuer jeden Ident der Kette, und alle Treffer landen in EINER Liste. Beim
  // Scan einer BSP-Platte stehen darin auch die Typen ihrer 169 Lamellen --
  // die Leistungserklaerung der Lamellen steuert ``tc:SawingProcess`` bei,
  // und damit galt die Platte als "Schnittholz / Lamelle".
  //
  // ``scannedEpc`` enthaelt ausschliesslich die Treffer zu ``<epc>`` selbst.
  // Fehlt das Feld (traceId-Abruf, aeltere Aufrufer), bleibt ``data.product``
  // die Rueckfallebene -- dort ist die Liste nicht vermischt, weil ohne
  // EPCIS-Kette nur ein Ident abgefragt wurde.
  const rows = data.scannedEpc ?? data.product ?? [];
  const types = rows
    .map((row) => row.type?.value)
    .filter((t): t is string => !!t)
    .map(localName)
    // Belegdokumente aussortieren: sie tragen den Ident, sagen aber nichts
    // ueber die Produktart. Ohne diesen Schritt entschiede die Reihenfolge der
    // geladenen Quellen, ob die Platte erkannt wird -- kommt die
    // Leistungserklaerung zuerst, bliebe die Angabe leer.
    .filter((t) => !NON_PRODUCT_CLASSES.includes(t));

  // 1. Produktklasse am Ident (tc:Stem, tc:SawnTimber, tc:CLT ...).
  for (const { classes, stage } of TYPE_TO_STAGE) {
    if (types.some((t) => classes.includes(t))) return stage;
  }

  // 2. Vorgang am Ident: er bestimmt das Erzeugnis eindeutig.
  for (const { classes, stage } of PROCESS_TO_STAGE) {
    if (types.some((t) => classes.includes(t))) return stage;
  }

  // 3. Stammdaten des Rundholzes. `createStemQuery` bindet ``?stem a tc:Stem``
  //    und liefert die Messwerte eines einzelnen Stammes (Durchmesser,
  //    Erntedatum, Stammnummer).
  //
  //    Nur zulaessig, wenn der Scan KEINE Kette aufgeloest hat. Beim EPC-Abruf
  //    laeuft diese Abfrage ohne Ident-Filter ueber alle geladenen Quellen --
  //    zu jeder BSP-Platte gehoeren auch die Stammdaten ihrer Vorkette, sonst
  //    gaelte jede Platte ohne eigene Typangabe als Rundholz. Ohne Kette
  //    stammen die Quellen dagegen von genau diesem Ident, und ein Stamm ist
  //    dann der einzige Beleg, den die Daten hergeben.
  const chainResolved = (data.epcisInfo?.epcsResolved ?? 0) > 1;
  if (!chainResolved && (data.stem?.length ?? 0) > 0) return 'stem';

  return null;
}

/** Die alte Zweiteilung auf die neuen Stufen abbilden. */
export function stageFromProductType(productType: ProductType | undefined): ProductStage {
  return productType === 'raw_material' ? 'stem' : 'clt-panel';
}

// ---------------------------------------------------------------------------
// Bildauswahl
// ---------------------------------------------------------------------------

/** Foto, Beschriftung und Fallback zu einer Stufe. */
export function productImageForStage(stage: ProductStage): ProductImage {
  const entry = STAGE_IMAGES[stage];
  return {
    stage,
    src: `${BASE_URL}images/${entry.file}`,
    fallbackSrc: `${BASE_URL}images/${entry.fallback}`,
    label: entry.label,
    alt: entry.alt,
  };
}

/** Bequemer Einstieg: erkennen und Bild liefern in einem Schritt. */
export function productImageFor(
  product: Product | null,
  data?: ProductDataResult | null,
): ProductImage | null {
  const stage = detectProductStage(product, data);
  return stage ? productImageForStage(stage) : null;
}
