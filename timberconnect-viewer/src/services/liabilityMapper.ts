/**
 * Adapter fuer den Anwendungsfall "Nachweis der Haftung".
 *
 * Uebersetzt die rohen SPARQL-Ergebnisse in die 44 Informationsanforderungen
 * der Informationsbedarfstiefe (I-1..I-44) und ordnet sie FUENF Kategorien
 * entlang der Prozesskette zu: Herkunft & Faellung, Einschnitt & Lamelle,
 * Klebstoff, Herstellung BSP, Versand & Uebergabe. Reine Funktion, kein I/O --
 * das Speichern einer Schadensmeldung passiert ausserhalb
 * (damageReportService), der Dokumentenabruf ebenfalls
 * (DocumentDownloadSection).
 *
 * Der Fall ist aus VERSICHERUNGSTECHNISCHER Sicht gedacht: im Schadensfall
 * soll belegbar sein, ob und in welcher Herstellungsstufe eine Abweichung von
 * den geforderten Eigenschaften vorlag (Festigkeit, Verklebung, Feuchte) und
 * welcher Akteur dafuer verantwortlich war. Die Gliederung nach Prozessstufe
 * ist deshalb keine Geschmacksfrage: erst sie macht sichtbar, an welcher
 * Station der Kette ein Nachweis fehlt.
 *
 * Vier Eigenheiten der Datenlage praegen diese Datei:
 *
 * 1. EPCIS allein reicht NICHT. Die Object-/TransformationEvents liefern nur
 *    das Rueckverfolgungsgeruest -- das "WAS/WANN". Qualitaets- und
 *    Konformitaetswerte stehen ausschliesslich in den Dokumentquellen; erst
 *    beides zusammen ergibt einen belastbaren Haftungsnachweis
 *    (Blatt "Begruendung_und_Luecken" der Informationsbedarfstiefe).
 * 2. Sechs Merkmale (I-3, I-6, I-41..I-44) existieren NUR als Annahme
 *    ANN-1..ANN-6 -- Akteur/Standort je Vorgang sowie Verpackung,
 *    Feuchteschutz, Uebergabe und Lagerung des fertigen Bauteils. In den
 *    realen EPCIS-Events fehlen sie. Sie erhalten den eigenen Zustand
 *    ``assumed`` und werden mit Begruendung gezeigt, nicht mit erfundenem
 *    Wert und nicht verschwiegen -- "es koennen aktuell nicht alle Merkmale
 *    befuellt werden (auch wichtig zu zeigen!)", Visualisierung S. 1.
 * 3. Die M-IDs der Awf-Tabelle taugen NICHT als Nachschlageschluessel: von 39
 *    loesen in timberconnect_ontology_v6.ttl nur zwei auf (M-984, M-1026), und
 *    M-1173/M-1175/M-1177/M-1179 sind dort bereits an die IFC-Planung
 *    vergeben (tc:buildingStorey, tc:productionListNumber, tc:ifcObjectType,
 *    tc:constructionPhase). Gemappt wird deshalb ueber PRAEDIKATNAMEN; die
 *    M-IDs stehen nur als Herkunftsnachweis im Kommentar. Die Nummernkollision
 *    gehoert in die Ontologie-Pflege und wird hier bewusst nicht zementiert.
 * 4. Ein Teil der Merkmale kommt aus DERSELBEN Quelle wie die
 *    Rueckbaubarkeit (data.deconstruction: ERP-Panel, Herstelleranschrift,
 *    Klebstoffname). Die wird wiederverwendet statt erneut abgefragt, und die
 *    Adressheuristik wird aus deconstructionMapper importiert statt kopiert --
 *    zwei Kopien liefen unweigerlich auseinander.
 */

import type { Product } from '../types';
import type { ProductDataResult, SparqlBinding } from './sparqlService';
import { classifyManufacturerAddress } from './deconstructionMapper';

/**
 * Warum ein Merkmal (nicht) angezeigt werden kann.
 *
 * ``available``  -- Wert aus dem Datenraum.
 * ``derived``    -- aus einem anderen Merkmal abgeleitet (Regel in ``note``).
 * ``assumed``    -- nur als Annahme ANN-x modelliert; es gibt dafuer KEINE
 *                   reale Datenquelle.
 * ``missing``    -- im Datenmodell vorgesehen, in DIESEN Daten nicht befuellt.
 * ``unsupported``-- im Datenmodell (noch) gar nicht vorgesehen.
 *
 * ``assumed`` ist bewusst von ``missing`` getrennt. "In den Beispieldaten
 * nicht befuellt" und "dafuer existiert ueberhaupt keine Datenquelle, nur eine
 * Modellannahme" sind zwei sehr verschiedene Aussagen ueber den Datenraum --
 * fuer einen Haftungsnachweis der Unterschied zwischen einer Luecke im
 * Datensatz und einer Luecke im Verfahren.
 */
export type LiabilityAvailability =
  | 'available'
  | 'derived'
  | 'assumed'
  | 'missing'
  | 'unsupported';

/** Ein Merkmal der Informationsbedarfstiefe, anzeigefertig. */
export interface LiabilityField {
  /** Id der Informationsanforderung, z.B. "I-10" -- Nachweis der Abdeckung. */
  id: string;
  label: string;
  value: string | null;
  availability: LiabilityAvailability;
  /** Begruendung bei derived/assumed/missing/unsupported; sonst undefined. */
  note?: string;
}

/** Eine der fuenf Prozessstufen. */
export interface LiabilityCategory {
  id: string;
  title: string;
  /** Einleitungstext im aufgeklappten Zustand. */
  description: string;
  /** Die Rolle, die fuer diese Stufe haftet -- Kern des Anwendungsfalls. */
  actor: string | null;
  /**
   * GS1 Company Prefix der Idente dieser Stufe, aus den EPCIS-Events
   * abgeleitet. Das ist die einzige Akteursangabe, die BELEGT ist: jeder
   * Teilnehmer erzeugt seine Idente unter seinem eigenen, bei der
   * Registrierung festgelegten GCP (erzwungen in main.py des Konverters).
   * null = zu dieser Stufe liegt kein Ident vor.
   */
  companyPrefix: string | null;
  fields: LiabilityField[];
}

/** Eine benannte Informationsluecke aus dem Blatt "Begruendung_und_Luecken". */
export interface LiabilityGap {
  title: string;
  detail: string;
}

/** Eine erfasste Schadensmeldung, wie sie aus dem Pod zurueckkommt. */
export interface DamageReportEntry {
  id: string;
  date: string | null;
  kind: string | null;
  description: string | null;
  reportedBy: string | null;
  moisture: string | null;
}

/** Vollstaendiges View-Model des Haftungsnachweises. */
export interface LiabilityData {
  /** Kopfbereich: Handelsname des Bauteils. */
  componentName: string | null;
  /** Kopfbereich: Festigkeitsklasse, das haftungsrelevante Kernmerkmal. */
  strengthClass: string | null;
  categories: LiabilityCategory[];
  /** Die benannten Luecken der fachlichen Analyse. */
  gaps: LiabilityGap[];
  /** Bereits erfasste Schadensmeldungen zu diesem Bauteil. */
  damageReports: DamageReportEntry[];
  /** Zaehlwerk fuer den Abdeckungshinweis. */
  coverage: { filled: number; total: number };
}

// ---------------------------------------------------------------------------
// Kleine Helfer (Stil aus documentationMapper.ts uebernommen)
// ---------------------------------------------------------------------------

function getValue(binding: SparqlBinding | undefined, key: string): string | undefined {
  const value = binding?.[key]?.value;
  return value && value.trim() !== '' ? value : undefined;
}

function orNull(value: string | undefined | null): string | null {
  return value && value.trim() !== '' ? value.trim() : null;
}

/** Erster nicht-leerer Wert einer Spalte ueber alle Zeilen. */
function firstValue(rows: SparqlBinding[], key: string): string | null {
  for (const row of rows) {
    const value = getValue(row, key);
    if (value) return value.trim();
  }
  return null;
}

/** Alle verschiedenen Werte einer Spalte, Reihenfolge erhalten. */
function allValues(rows: SparqlBinding[], key: string): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = getValue(row, key);
    if (value) seen.add(value.trim());
  }
  return [...seen];
}

/** ISO-Datum zu "TT.MM.JJJJ"; unparsbares bleibt unveraendert. */
function parseDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toLocaleDateString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : dateStr;
}

/** Datum MIT Uhrzeit -- fuer die zeitliche Einordnung der Pruefung (I-15). */
function parseDateTime(value: string | undefined | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return parseDate(value);
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Zahl + Einheit, wenn die Einheit nicht schon im Wert steht.
 *
 * Wie in documentationMapper: deutsche Darstellung ohne die nachlaufende
 * ".0", die eine Scheingenauigkeit vortaeuscht.
 */
function withUnit(value: string | null, unit: string): string | null {
  if (!value) return null;
  if (new RegExp(`${unit.replace(/[/²³]/g, '\\$&')}\\s*$`, 'i').test(value)) return value;

  const asNumber = Number(value);
  const text = Number.isFinite(asNumber)
    ? asNumber.toLocaleString('de-DE', { maximumFractionDigits: 3 })
    : value;

  return `${text} ${unit}`;
}

/** "ja"/"nein" normalisieren. */
function normalizeYesNo(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  if (/^(ja|yes|true|1)$/i.test(text)) return 'Ja';
  if (/^(nein|no|false|0)$/i.test(text)) return 'Nein';
  return text;
}

// --- Feld-Konstruktoren, damit die Kategorien unten lesbar bleiben ----------

function field(
  id: string,
  label: string,
  value: string | null,
  note?: string,
): LiabilityField {
  return value
    ? { id, label, value, availability: 'available' }
    : {
        id,
        label,
        value: null,
        availability: 'missing',
        note: note ?? 'Für dieses Bauteil wurde kein Wert übermittelt.',
      };
}

function derived(
  id: string,
  label: string,
  value: string | null,
  note: string,
): LiabilityField {
  return value
    ? { id, label, value, availability: 'derived', note }
    : { id, label, value: null, availability: 'missing', note };
}

/**
 * Merkmal, das nur als Annahme ANN-x existiert.
 *
 * Es gibt hierfuer bewusst KEINEN Wert-Parameter: die Annahmen liegen als
 * EPCIS-Beispieldateien vor, sind aber nie in ein Repository geschrieben
 * worden. Einen Wert anzuzeigen hiesse, ein Beispiel als Nachweis auszugeben --
 * fuer einen Haftungsnachweis die gefaehrlichste aller Verwechslungen.
 */
function assumed(id: string, label: string, ann: string, note: string): LiabilityField {
  return {
    id,
    label,
    value: null,
    availability: 'assumed',
    note: `${ann}: ${note}`,
  };
}

/**
 * Akteursmerkmal einer Prozessstufe (I-3, I-6).
 *
 * Sonderfall der Annahme, weil hier eben NICHT nichts bekannt ist: der GS1
 * Company Prefix der Idente benennt das Unternehmen, dessen Nummernkreis die
 * Objekte dieser Stufe tragen. Was fehlt, ist die Bestaetigung, dass dieses
 * Unternehmen den Vorgang auch selbst AUSGEFUEHRT hat -- bei einem
 * Lohnunternehmer faellt beides auseinander, und genau das entscheidet den
 * Regress.
 *
 * Die Begruendung nennt den Prefix deshalb ausdruecklich, statt die Stufe
 * unbenannt zu lassen: "wir wissen ungefaehr, wer" ist eine andere Aussage
 * als "wir wissen es nicht".
 */
function assumedActor(
  id: string,
  label: string,
  ann: string,
  companyPrefix: string | null,
  vorgang: string,
): LiabilityField {
  const base = companyPrefix
    ? `Die Idente dieser Stufe tragen den GS1 Company Prefix ${companyPrefix} — das benennt das Unternehmen, dessen Nummernkreis die Objekte führt. Ob es den Vorgang selbst ausgeführt hat, belegen die Daten nicht: bizLocation und readPoint fehlen in den Quelldaten des ${vorgang}.`
    : `Der ausführende Akteur wäre in GS1-EPCIS über bizLocation/readPoint (GLN) abzubilden. In den Quelldaten des ${vorgang} fehlen beide Felder, und es liegt auch kein Ident vor, aus dem sich ein Company Prefix ableiten ließe.`;
  return {
    id,
    label,
    value: companyPrefix ? `GCP ${companyPrefix}` : null,
    availability: 'assumed',
    note: `${ann}: ${base}`,
  };
}

/**
 * Geltungsbereich eines Pruefergebnisses (I-13a).
 *
 * Die entscheidende Frage im Regressfall lautet nicht "wurde geprueft?",
 * sondern "war DIESE Lamelle von der Pruefung erfasst?". Der Pruefbericht
 * traegt dafuer die SGTINs aller abgedeckten Lamellen an tc:epc -- der
 * Materialbezug ist in der Vorlage ein Pflichtfeld.
 *
 * Ueberschneiden sich die geprueften Idente mit denen des Bauteils, ist die
 * Aussage belegt. Ueberschneiden sie sich NICHT, ist das kein fehlender Wert,
 * sondern ein Befund: das Pruefergebnis gilt fuer anderes Material. Das als
 * "keine Daten" auszuweisen waere die gefaehrlichere Darstellung -- es klaenge
 * nach Datenluecke, wo in Wahrheit ein belegter Nichtbezug steht.
 */
function testScope(
  id: string,
  label: string,
  testedEpcs: string[],
  componentEpcs: string[],
): LiabilityField {
  if (!testedEpcs.length) {
    return {
      id,
      label,
      value: null,
      availability: 'missing',
      note: 'Zu diesem Bauteil liegt kein Prüfbericht mit Materialbezug vor.',
    };
  }

  const tested = new Set(testedEpcs);
  const covered = componentEpcs.filter((epc) => tested.has(epc));
  const count = `${testedEpcs.length} Lamelle(n) abgedeckt`;

  if (!componentEpcs.length) {
    return {
      id,
      label,
      value: count,
      availability: 'available',
      note: 'Der Prüfbericht nennt die geprüften Lamellen. Ob die Lamellen dieses Bauteils darunter sind, lässt sich nicht abgleichen — zum Aufsägevorgang liegt kein EPCIS-Event vor.',
    };
  }

  return covered.length
    ? {
        id,
        label,
        value: `${count}, davon ${covered.length} in diesem Bauteil`,
        availability: 'available',
        note: 'Der Prüfbericht führt die geprüften Lamellen instanzscharf über ihre SGTIN — das Ergebnis ist diesem Bauteil damit eindeutig zuzuordnen.',
      }
    : {
        id,
        label,
        value: count,
        availability: 'available',
        note: 'Achtung: Keine der geprüften Lamellen gehört zu diesem Bauteil. Das Prüfergebnis belegt die Eigenschaften dieses Bauteils daher nicht.',
      };
}

/**
 * Die verbleibenden Informationsluecken.
 *
 * Ergebnis der fachlichen Analyse (Blatt "Begruendung_und_Luecken"), nicht der
 * Daten -- deshalb Konstante und keine Ableitung. Sie gehoeren sichtbar in die
 * Ansicht: ein Haftungsnachweis, der seine eigenen Grenzen verschweigt, waere
 * als Nachweis wertlos.
 *
 * Das Blatt nennt FUENF Luecken; hier stehen nur VIER. Die fuenfte -- "keine
 * Chargen-/Losnummer, die das Stichproben-Pruefergebnis mit den betroffenen
 * SGTINs verknuepft" -- beschreibt die Papierwelt zutreffend, gilt fuer diesen
 * Datenraum aber NICHT: die Vorlage der Biegepruefung fuehrt den Materialbezug
 * als PFLICHTFELD (MATERIAL_REF_REQUIRED in pdf_template_service.py), und
 * materialEpc ist eine LISTE. Der Pruefbericht traegt damit die SGTINs aller
 * abgedeckten Lamellen direkt an tc:epc -- instanzscharf und damit praeziser,
 * als eine Chargennummer es waere. Der Geltungsbereich wird bei I-13
 * ausgewiesen.
 *
 * Die Luecke hier stehen zu lassen waere schlimmer als eine fehlende Angabe:
 * sie wuerde einen loesbaren Regress als aussichtslos darstellen.
 */
export const LIABILITY_GAPS: LiabilityGap[] = [
  {
    title: 'Keine Akteurs- und Standortdaten in den EPCIS-Events',
    detail:
      'bizLocation und readPoint fehlen in allen vier Vorgangs-Dateien. Wer einen Schritt ausgeführt hat, ist damit aus den Events nicht belegbar — die Voraussetzung für jeden Regress. ANN-1 und ANN-2 sind Annahmen und müssten in der Praxis durch echte GLNs ersetzt werden.',
  },
  {
    title: 'Keine strukturierten Daten zu Transport, Verpackung und Zwischenlagerung',
    detail:
      'Zwischen Herstellung und Einbau des fertigen Bauteils liegt keine Datenspur, obwohl genau dieser Abschnitt im Interview als zentrales Schadensrisiko genannt wurde. ANN-3 bis ANN-6 sind Annahmen ohne reale Datenquelle.',
  },
  {
    title: 'Kein Nachweis des IST-Zustands zum Schadenszeitpunkt',
    detail:
      'Feuchtemessung vor Ort oder Sensordaten liegen nicht vor. Der Abgleich zwischen dokumentiertem Soll und tatsächlichem Zustand — die eigentliche Aufgabe der Gutachterin — bleibt manuell. Die Schadensmeldung in dieser Ansicht ist der erste Schritt, diese Lücke zu schließen.',
  },
  {
    title: 'Klebstoffcharge nur als Massenangabe',
    detail:
      'Der Klebstoff ist in kg ohne Los- oder Chargennummer erfasst. Eine präzise Rückverfolgung zur Produktionscharge — Voraussetzung für einen Regress gegenüber dem Klebstoffhersteller — bleibt unscharf.',
  },
];

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

export function mapToLiability(
  data: ProductDataResult | null,
  product: Product | null,
): LiabilityData {
  const rows = data?.liability ?? [];
  // Rueckbaubarkeit liefert ERP-Panel, Herstelleranschrift und Klebstoffname
  // -- dieselben Quellen, die auch der Haftungsnachweis braucht.
  const deconRows = data?.deconstruction ?? [];
  const declarations = data?.declarations ?? [];
  const events = data?.epcisEvents ?? [];

  // --- Kopfbereich --------------------------------------------------------
  const tradeName =
    firstValue(deconRows, 'dopTypeNumber') ??
    firstValue(declarations, 'typeNumber') ??
    firstValue(deconRows, 'artikel') ??
    orNull(product?.name);

  const strengthClass =
    firstValue(rows, 'bspStrengthClass') ??
    firstValue(deconRows, 'festigkeit') ??
    firstValue(deconRows, 'dopStrengthClass') ??
    firstValue(declarations, 'strengthClass');

  // --- 1. Herkunft & Faellung (I-1..I-3) ----------------------------------
  // Die Identifikatoren stammen aus den EPCIS-Events, nicht aus dem Pod: sie
  // sind das Rueckverfolgungsgeruest, das die Dokumentnachweise ueberhaupt
  // erst einem konkreten Bauteil zuordnet.
  //
  // Die Ausgaenge der Transformationen werden nach Vorgang GETRENNT gehalten:
  // eine gemeinsame Liste ueber alle TransformationEvents wuerde Rundhoelzer,
  // Lamellen und Platte vermischen -- und damit sowohl I-2/I-5 als auch die
  // Akteurszuordnung je Stufe verfaelschen.
  const transformationOutputs = outputsPerTransformation(events);
  const plantingLgtin = firstEpcMatching(events, /^urn:epc:class:lgtin:/);
  // Faellvorgang = erste Transformation der Kette.
  const logSgtins = transformationOutputs[0] ?? [];
  const originPrefix = dominantPrefix([plantingLgtin, ...logSgtins]);

  const originFields: LiabilityField[] = [
    field(
      'I-1',
      'LGTIN Pflanzung',
      plantingLgtin,
      'In den vorliegenden EPCIS-Events ist kein Pflanzvorgang zu diesem Bauteil enthalten.',
    ),
    field(
      'I-2',
      'SGTINs Rundhölzer',
      logSgtins.length ? logSgtins.slice(0, 3).join(', ') : null,
      'Zu diesem Bauteil liegt kein Fällvorgang als EPCIS-Event vor.',
    ),
    assumedActor(
      'I-3',
      'Ausführender Forstbetrieb',
      'Annahme ANN-1',
      originPrefix,
      'Fällvorgangs',
    ),
  ];

  // --- 2. Einschnitt & Lamelle (I-4..I-15) --------------------------------
  // Aufsaegevorgang = zweite Transformation; ihre Ausgaenge sind die Lamellen.
  // Frueher stand hier dieselbe Liste wie bei den Rundhoelzern -- damit haette
  // die Lamellenstufe die Idente des Forstbetriebs ausgewiesen.
  const sawEventTime = eventTimeOf(events, 'TransformationEvent', 1);
  const lamellaEpcs = transformationOutputs[1] ?? [];
  const sawmillPrefix = dominantPrefix(lamellaEpcs);

  const conformitySystem = firstValue(rows, 'conformitySystem');
  const notifiedBody = firstValue(rows, 'notifiedBody');
  const certNumber = firstValue(rows, 'zertifikatsnummer');

  const density = firstValue(rows, 'dopDensity');
  const bendingStrength = firstValue(rows, 'dopBendingStrength');
  const durability = firstValue(rows, 'dopDurability');
  const sampleIds = allValues(rows, 'sampleId');
  const tester = firstValue(rows, 'tester');
  // Kein Rueckfall auf tc:printedAt: das Druckdatum des Berichts ist ein
  // anderes Ereignis als der Pruefzeitpunkt und liegt oft Wochen spaeter.
  // Fuer den Regress ist "wann wurde geprueft" die Frage -- ein Druckdatum
  // an dieser Stelle waere ein falscher Nachweis, keine Naeherung.
  const testDateTime = firstValue(rows, 'testDateTime');

  // Geltungsbereich des Pruefergebnisses: Die Vorlage der Biegepruefung
  // verlangt den Materialbezug als Pflichtfeld, und materialEpc ist eine
  // Liste -- der Bericht traegt die SGTINs ALLER Lamellen, die er abdeckt,
  // an tc:epc. Fuer den Regress ist das die entscheidende Angabe: sie sagt,
  // ob die geschaedigte Lamelle von dieser Pruefung ueberhaupt erfasst war.
  const testedEpcs = allValues(rows, 'reportEpc');

  const sawmillFields: LiabilityField[] = [
    field(
      'I-4',
      'Ereigniszeitpunkt Aufsägevorgang',
      parseDateTime(sawEventTime),
      'Zu diesem Bauteil liegt kein Aufsägevorgang als EPCIS-Event vor.',
    ),
    field(
      'I-5',
      'SGTINs Schnittholzlamellen',
      lamellaEpcs.length ? `${lamellaEpcs.length} Lamelle(n) erfasst` : null,
      'Die Ausgangsobjekte des Aufsägevorgangs sind in den Events nicht enthalten.',
    ),
    assumedActor(
      'I-6',
      'Ausführendes Sägewerk',
      'Annahme ANN-2',
      sawmillPrefix,
      'Aufsägevorgangs',
    ),
    field('I-7', 'Leistungserklärung Nummer', certNumber),
    field('I-8', 'Konformitätssystem', conformitySystem),
    field('I-9', 'Zertifizierungsstelle', notifiedBody),
    field('I-10', 'Rohdichte', withUnit(density, 'kg/m³')),
    field('I-11', 'Biegefestigkeit (EN 338)', withUnit(bendingStrength, 'N/mm²')),
    field('I-12', 'Dauerhaftigkeit gegen Pilze', durability),
    field(
      'I-13',
      'Prüfung Proben-Nr.',
      sampleIds.length ? sampleIds.join(', ') : null,
      'Zu diesem Bauteil liegt kein Prüfbericht der Biegeprüfung vor.',
    ),
    testScope('I-13a', 'Geltungsbereich der Prüfung', testedEpcs, lamellaEpcs),
    field('I-14', 'Prüfer', tester),
    field('I-15', 'Datum/Uhrzeit der Prüfung', parseDateTime(testDateTime)),
  ];

  // --- 3. Klebstoff (I-16..I-21) ------------------------------------------
  // I-16/I-17 sind in der Awf-Tabelle als "EPCIS ergaenzt (unsicher)"
  // gefuehrt: der Klebstoff geht als Mengenangabe in den Herstellungsvorgang
  // ein, aber ohne Los-/Chargennummer. Anders als bei der Biegepruefung gibt
  // es hier auch keinen Materialbezug, der das aufwiegen wuerde -- das
  // Klebstoff-Datenblatt ist mit MATERIAL_REF_NONE registriert, es beschreibt
  // das PRODUKT, nicht eine Charge. Deshalb bleibt das die letzte der
  // Luecken, die den Regress gegen den Klebstoffhersteller unscharf laesst.
  const adhesiveLgtin = firstEpcMatching(events, /lgtin.*(?:kleb|adhes)/i);
  const adhesiveQuantity = quantityFromEvents(events);
  // Zwei benachbarte, aber nicht deckungsgleiche Praedikate: tc:productName
  // ist die "Herstellerbezeichnung" des Datenblatts, tc:name die
  // "Produktbezeichnung" aus der Rueckbau-Abfrage. Statt sie stillschweigend
  // gleichzusetzen, wird der Ersatzwert als abgeleitet ausgewiesen.
  const adhesiveProductName = firstValue(rows, 'adhesiveProductName');
  const adhesiveName = firstValue(deconRows, 'adhesiveName');
  const curingType = firstValue(rows, 'curingType');
  const storageConditions = firstValue(rows, 'storageConditions');
  // Kein Rueckfall auf tc:processingNote: das Sicherheitsdatenblatt fuehrt
  // "Sicherheitsmassnahmen" und "Verarbeitungshinweise" als zwei getrennte
  // Felder. Einen Verarbeitungshinweis als Sicherheitsangabe auszugeben,
  // waere im Haftungsfall die folgenreichste der moeglichen Verwechslungen.
  const disclaimer = firstValue(rows, 'safetyNote');

  const adhesiveFields: LiabilityField[] = [
    field(
      'I-16',
      'LGTIN Klebstoff',
      adhesiveLgtin,
      'Der Klebstoff ist im Herstellungsvorgang nur als Mengenangabe erfasst, nicht als eigener Ident.',
    ),
    field(
      'I-17',
      'Menge Klebstoff',
      adhesiveQuantity,
      'Zu diesem Bauteil liegt kein Herstellungsvorgang mit Klebstoffmenge vor.',
    ),
    adhesiveProductName
      ? field('I-18', 'Produktbezeichnung', adhesiveProductName)
      : derived(
          'I-18',
          'Produktbezeichnung',
          adhesiveName,
          'Das Sicherheitsdatenblatt führt keine Herstellerbezeichnung (tc:productName). Gezeigt wird ersatzweise die Produktbezeichnung aus den Rückbaudaten (tc:name).',
        ),
    field('I-19', 'Aushärtung', curingType),
    field('I-20', 'Lagerbedingungen', storageConditions),
    field(
      'I-21',
      'Haftungsausschluss des Herstellers',
      disclaimer,
      'Das technische Datenblatt enthält keinen ausgewiesenen Haftungsausschluss.',
    ),
  ];

  // --- 4. Herstellung BSP (I-22..I-40) ------------------------------------
  const productionEventTime = eventTimeOf(events, 'TransformationEvent', -1);
  const panelEpc = orNull(product?.id) ?? firstValue(rows, 'bspEpc');
  const employee = firstValue(rows, 'mitarbeiter');
  const qsControl = normalizeYesNo(firstValue(rows, 'qsKontrolle'));

  const bspDopNumber =
    firstValue(deconRows, 'dopTypeNumber') ?? firstValue(declarations, 'typeNumber');
  const intendedUse =
    firstValue(deconRows, 'dopIntendedUse') ?? firstValue(declarations, 'intendedUse');
  const species =
    orNull(product?.woodType) ??
    firstValue(deconRows, 'dopHolzart') ??
    firstValue(declarations, 'holzart');
  const manufacturer =
    firstValue(deconRows, 'dopManufacturer') ?? firstValue(declarations, 'manufacturer');
  // Vier ununterscheidbare Adressliterale -- die Heuristik der
  // Rueckbaubarkeit sortiert sie nach Strasse/PLZ/Ort/Land (I-31..I-34).
  const address = classifyManufacturerAddress(allValues(deconRows, 'dopAddress'));
  const moisture = firstValue(rows, 'moistureContent');
  // I-37 verlangt den Klebstoff-NORMBEZUG (tc:adhesiveType, z.B.
  // "PUR-EN 15425:2017: I90GP 0,3w"). Ein Handelsname ist keine Norm --
  // frueher fiel das Feld stillschweigend auf den Produktnamen zurueck und
  // gab damit im Haftungsnachweis etwas anderes aus, als die Zeile behauptet.
  const adhesiveType =
    firstValue(rows, 'bspAdhesiveType') ?? firstValue(deconRows, 'adhesiveType');
  const delamination = firstValue(rows, 'delamination');
  const bendingFlatwise = firstValue(rows, 'bendingFlatwise');
  const rollingShear = firstValue(rows, 'rollingShear');

  const productionFields: LiabilityField[] = [
    field(
      'I-22',
      'Ereigniszeitpunkt Herstellung',
      parseDateTime(productionEventTime),
      'Zu diesem Bauteil liegt kein Herstellungsvorgang als EPCIS-Event vor.',
    ),
    field('I-23', 'SGTIN der BSP-Platte', panelEpc),
    field('I-24', 'Zuständiger Mitarbeiter Fertigung', employee),
    field('I-25', 'QS-Kontrolle', qsControl),
    // I-26 und I-27 zeigen in der Awf-Tabelle auf zwei verschiedene Merkmale
    // (M-1076 Nummer der Leistungserklaerung, M-1077 Produkttyp-Kenncode). Das
    // BSP-Mapping fuehrt beide auf tc:typeNumber zusammen -- der Kenncode IST
    // dort die Nummer. Ausgewiesen wird deshalb einmal der Wert und einmal die
    // Ableitung, statt denselben Wert zweimal als eigenstaendigen Nachweis
    // auszugeben.
    field('I-26', 'Leistungserklärung Nummer BSP', bspDopNumber),
    derived(
      'I-27',
      'Produkttyp-Kenncode',
      bspDopNumber,
      'Die Leistungserklärung führt Nummer und Produkttyp-Kenncode auf demselben Feld (tc:typeNumber).',
    ),
    field('I-28', 'Holzart', species),
    field('I-29', 'Verwendungszweck', intendedUse),
    field('I-30', 'Hersteller', manufacturer),
    field('I-31', 'Straße', address.street),
    field('I-32', 'PLZ', address.postcode),
    field('I-33', 'Stadt', address.city),
    field('I-34', 'Land', address.country),
    field('I-35', 'Festigkeitsklasse', strengthClass),
    field('I-36', 'Feuchte im Lieferzustand', withUnit(moisture, '%')),
    field(
      'I-37',
      'Verwendete Klebstoffe',
      adhesiveType,
      'Die Leistungserklärung weist keinen Klebstoff-Normbezug (tc:adhesiveType) aus.',
    ),
    field('I-38', 'Klebfugenintegrität / Delaminierung', delamination),
    field('I-39', 'Biegefestigkeit senkrecht', withUnit(bendingFlatwise, 'N/mm²')),
    field('I-40', 'Rollschubfestigkeit', withUnit(rollingShear, 'N/mm²')),
  ];

  // --- 5. Versand, Uebergabe & Lagerung (I-41..I-44) ----------------------
  // Vollstaendig Annahme. Das ist die sichtbarste der Luecken und laut
  // Interview das zentrale Schadensrisiko: genau der Abschnitt, in dem
  // Feuchteschaeden entstehen, hat keine Datenspur.
  const logisticsFields: LiabilityField[] = [
    assumed(
      'I-41',
      'Verpackungsart und -material',
      'Annahme ANN-3',
      'Entspräche einem ObjectEvent mit bizStep "packing" am Ende des Herstellungsvorgangs.',
    ),
    assumed(
      'I-42',
      'Transport- und Feuchteschutzbestätigung',
      'Annahme ANN-4',
      'Entspräche einem ObjectEvent mit bizStep "shipping" inklusive bestätigtem Feuchteschutz.',
    ),
    assumed(
      'I-43',
      'Übergabebestätigung Baustelle',
      'Annahme ANN-5',
      'Entspräche einem ObjectEvent mit bizStep "receiving" und markiert den Verantwortungsübergang an das Bauunternehmen.',
    ),
    assumed(
      'I-44',
      'Lagerbedingungen vor Einbau',
      'Annahme ANN-6',
      'Entspräche einem ObjectEvent mit bizStep "storing", idealerweise mit Temperatur- und Feuchtemesswerten, um spätere Streitfälle (Bauteil vs. Baustelle) aufzulösen.',
    ),
  ];

  // --- Akteurszuordnung ueber den GS1 Company Prefix ----------------------
  // Der GCP ist die EINZIGE belegte Akteursangabe im Datenraum: jeder
  // Teilnehmer legt ihn bei der Registrierung fest, und der Konverter lehnt
  // Uploads ohne gueltigen Prefix ab (main.py). Jeder erzeugte Ident traegt
  // ihn daher im ersten Abschnitt.
  //
  // Er ersetzt bizLocation/readPoint NICHT: der GCP sagt, WESSEN Nummernkreis
  // ein Objekt traegt, nicht, WER den Vorgang ausgefuehrt hat. Bei einem
  // Lohnunternehmer faellt beides auseinander. Deshalb bleiben I-3 und I-6
  // Annahmen -- der GCP grenzt den Verantwortlichen aber ein, statt die Stufe
  // voellig unbenannt zu lassen.
  const adhesivePrefix = dominantPrefix([adhesiveLgtin]);
  const productionPrefix = dominantPrefix([panelEpc, ...(transformationOutputs[2] ?? [])]);

  const categories: LiabilityCategory[] = [
    {
      id: 'origin',
      title: 'Herkunft & Fällung',
      description:
        'Identität und Rückverfolgbarkeit des Rohstoffs bis zum Fällvorgang — die Grundlage jeder weiteren Zuordnung.',
      actor: 'Forstbetrieb',
      companyPrefix: originPrefix,
      fields: originFields,
    },
    {
      id: 'sawmill',
      title: 'Einschnitt & Lamelle',
      description:
        'Einschnitt zur Schnittholzlamelle sowie die geprüften Festigkeits- und Dauerhaftigkeitswerte aus Leistungserklärung und Biegeprüfung.',
      actor: 'Sägewerk',
      companyPrefix: sawmillPrefix,
      fields: sawmillFields,
    },
    {
      id: 'adhesive',
      title: 'Klebstoff',
      description:
        'Eingesetzter Klebstoff mit Aushärtung, Lagerbedingungen und dem haftungsdefinierenden Ausschluss des Herstellers.',
      actor: 'Klebstoffhersteller',
      companyPrefix: adhesivePrefix,
      fields: adhesiveFields,
    },
    {
      id: 'production',
      title: 'Herstellung BSP',
      description:
        'Verpressung zur Brettsperrholzplatte, Verantwortung in der Fertigung und die deklarierten Leistungsmerkmale des fertigen Bauteils.',
      actor: 'Holzwerkstoffproduzent',
      companyPrefix: productionPrefix,
      fields: productionFields,
    },
    {
      id: 'logistics',
      title: 'Versand, Übergabe & Lagerung',
      description:
        'Der Weg vom Werk bis zum Einbau. Laut Interview das zentrale Schadensrisiko — und zugleich der Abschnitt ohne jede Datenspur.',
      actor: 'Spedition / Bauunternehmen',
      // Kein eigener Ident: diese Stufe erzeugt in den vorliegenden Daten
      // keine Objekte und traegt deshalb auch keinen Company Prefix.
      companyPrefix: null,
      fields: logisticsFields,
    },
  ];

  // --- Abdeckung ----------------------------------------------------------
  const allFields = categories.flatMap((category) => category.fields);
  const coverage = {
    filled: allFields.filter(
      (item) => item.availability === 'available' || item.availability === 'derived',
    ).length,
    total: allFields.length,
  };

  return {
    componentName: tradeName,
    strengthClass,
    categories,
    gaps: LIABILITY_GAPS,
    damageReports: extractDamageReports(rows),
    coverage,
  };
}

// ---------------------------------------------------------------------------
// EPCIS-Helfer
// ---------------------------------------------------------------------------

/**
 * Die EPCIS-Events kommen als rohe JSON-Objekte aus dem Proxy. Sie werden hier
 * bewusst defensiv gelesen: fehlt ein Feld, ist das Merkmal eine Luecke, kein
 * Fehler -- genau das ist die Aussage, die dieser Anwendungsfall treffen soll.
 */
type RawEvent = Record<string, unknown>;

function listOf(event: RawEvent, key: string): string[] {
  const value = event[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function firstEpcMatching(events: unknown[], pattern: RegExp): string | null {
  for (const raw of events as RawEvent[]) {
    const candidates = [
      ...listOf(raw, 'epcList'),
      ...listOf(raw, 'inputEPCList'),
      ...listOf(raw, 'outputEPCList'),
      ...quantityEpcClasses(raw),
    ];
    const hit = candidates.find((epc) => pattern.test(epc));
    if (hit) return hit;
  }
  return null;
}

/**
 * GS1 Company Prefix aus einem EPC.
 *
 * Aufbau laut GS1: ``urn:epc:id:sgtin:<gcp>.<itemref>.<serial>`` bzw.
 * ``urn:epc:class:lgtin:<gcp>.<itemref>.<lot>``. Der GCP ist der Abschnitt vor
 * dem ERSTEN Punkt.
 *
 * Bewusst am Punkt getrennt und nicht auf feste Laenge geschnitten: der Prefix
 * ist 4 bis 12 Ziffern lang (so prueft ihn auch der Konverter beim Upload).
 * Ein fester Schnitt bei 9 Stellen -- der Laenge der Beispieldaten -- wuerde
 * bei jedem anderen Teilnehmer stillschweigend den falschen Akteur ausweisen.
 */
export function companyPrefixOf(epc: string | null | undefined): string | null {
  if (!epc) return null;
  const match = epc.match(/^urn:epc:(?:id|class):(?:sgtin|lgtin|sgln|giai|gdti):(\d{4,12})\./);
  return match ? match[1] : null;
}

/**
 * Der GCP, der die Idente einer Prozessstufe traegt.
 *
 * Kommen mehrere vor, gewinnt der haeufigste: eine Stufe wird von genau einem
 * Unternehmen verantwortet, vereinzelte Fremd-Idente (etwa ein zugekauftes
 * Vorprodukt in derselben Liste) duerfen die Zuordnung nicht kippen.
 */
function dominantPrefix(epcs: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const epc of epcs) {
    const prefix = companyPrefixOf(epc);
    if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      best = prefix;
      bestCount = count;
    }
  }
  return best;
}

function quantityEpcClasses(event: RawEvent): string[] {
  const out: string[] = [];
  for (const key of ['quantityList', 'inputQuantityList', 'outputQuantityList']) {
    const list = event[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const epcClass = (entry as Record<string, unknown>)?.epcClass;
      if (typeof epcClass === 'string') out.push(epcClass);
    }
  }
  return out;
}

/**
 * Ausgangsobjekte je TransformationEvent, Reihenfolge der Kette erhalten.
 *
 * Bewusst NICHT zu einer Liste zusammengefasst: Faellvorgang, Aufsaegevorgang
 * und Herstellung sind drei Transformationen mit drei verschiedenen Akteuren.
 * Erst getrennt laesst sich sagen, welcher Ident zu welcher Stufe -- und damit
 * zu welchem Unternehmen -- gehoert.
 */
function outputsPerTransformation(events: unknown[]): string[][] {
  return (events as RawEvent[])
    .filter((raw) => raw.type === 'TransformationEvent')
    .map((raw) => [...new Set(listOf(raw, 'outputEPCList'))]);
}

/**
 * Zeitpunkt eines Events eines bestimmten Typs.
 *
 * ``index`` erlaubt es, das LETZTE Event dieses Typs zu nehmen (-1). Die
 * Herstellung der Platte ist das spaeteste TransformationEvent der Kette, der
 * Einschnitt eines der frueheren -- ohne diese Unterscheidung stuende an
 * beiden Stellen derselbe Zeitpunkt.
 */
function eventTimeOf(events: unknown[], type: string, index = 0): string | null {
  const matching = (events as RawEvent[]).filter((raw) => raw.type === type);
  if (!matching.length) return null;
  const picked = index < 0 ? matching[matching.length + index] : matching[index];
  const time = picked?.eventTime;
  return typeof time === 'string' ? time : null;
}

/** Klebstoffmenge aus den Mengenlisten des Herstellungsvorgangs (I-17). */
function quantityFromEvents(events: unknown[]): string | null {
  for (const raw of events as RawEvent[]) {
    for (const key of ['inputQuantityList', 'quantityList']) {
      const list = raw[key];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const item = entry as Record<string, unknown>;
        const epcClass = typeof item.epcClass === 'string' ? item.epcClass : '';
        if (!/kleb|adhes/i.test(epcClass)) continue;
        const quantity = item.quantity;
        const uom = typeof item.uom === 'string' ? item.uom : '';
        if (typeof quantity === 'number') {
          return `${quantity.toLocaleString('de-DE')}${uom ? ` ${uom}` : ''}`;
        }
      }
    }
  }
  return null;
}

/** Erfasste Schadensmeldungen aus dem Abfrageergebnis. */
function extractDamageReports(rows: SparqlBinding[]): DamageReportEntry[] {
  const byId = new Map<string, DamageReportEntry>();
  for (const row of rows) {
    const id = getValue(row, 'damage');
    if (!id) continue;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      date: parseDate(getValue(row, 'damageDate')),
      kind: orNull(getValue(row, 'damageKind')),
      description: orNull(getValue(row, 'damageDescription')),
      reportedBy: orNull(getValue(row, 'damageReporter')),
      moisture: withUnit(orNull(getValue(row, 'damageMoisture')), '%'),
    });
  }
  return [...byId.values()];
}
