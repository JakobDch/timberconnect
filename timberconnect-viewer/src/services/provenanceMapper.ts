/**
 * Adapter fuer den Anwendungsfall "Herkunftsnachweis".
 *
 * Uebersetzt die rohen SPARQL-Ergebnisse in genau die 28 Informations-
 * anforderungen (I-1..I-28) der Informationsbedarfstiefe. Reine Funktion,
 * kein I/O -- Geocoding und Dokumentenabruf passieren ausserhalb.
 *
 * Zwei Eigenheiten der Datenlage praegen diese Datei:
 *
 * 1. Die PDF-Templates schreiben Name, Strasse und Ort auf DASSELBE Praedikat
 *    (tc:loadingAddress / tc:unloadingAddress). Die Abfrage liefert sie
 *    deshalb als ununterscheidbaren Beutel; classifyAddressParts() sortiert
 *    sie heuristisch. Solange das Backend keine getrennten Praedikate vergibt,
 *    ist das der einzige Weg an I-19..I-25.
 * 2. Fehlt eine Quelle, wird ``null`` geliefert und in der Ansicht als
 *    "Keine Daten verfuegbar" gezeigt -- nie geraten, nie mit Demo-Werten
 *    aufgefuellt. Ausnahme: ein Akteur ohne Namen wird ganz weggelassen.
 */

import type { Coordinates, Product, SupplyChainStep } from '../types';
import type { ProductDataResult, SparqlBinding } from './sparqlService';
import type { EpcisEvent } from './epcisService';
import { SPECIES_SCIENTIFIC } from '../config/solidPods';
import { countryFromCoordinates, stateFromCoordinates } from '../config/geoLookup';

export type ActorKind = 'forest' | 'sawmill' | 'manufacturer';

/** Ein Akteur der Lieferkette -- eine Karte in der Liste, ein Marker. */
export interface ProvenanceActor {
  id: string;
  kind: ActorKind;
  /** I-16 / I-19 / I-23 */
  name: string;
  /** I-17 / I-20+I-21 / I-24+I-25 -- ggf. unvollstaendig. */
  address: string | null;
  /** Trace-/Belegnummer fuer die Zeile unter dem Namen. */
  reference: string | null;
  /** I-18 / I-22 / I-26 */
  transportDate: string | null;
  /** null = kein Kartenmarker. */
  coordinates: Coordinates | null;
  /** Woher die Koordinate stammt -- steuert den Genauigkeitshinweis. */
  coordinateSource: 'measured' | 'geocoded' | null;
}

/** Vollstaendiges View-Model des Herkunftsnachweises. */
export interface ProvenanceData {
  tradeName: string | null; // I-1
  description: string | null; // I-2
  volumeM3: string | null; // I-3
  pieces: string | null; // I-4
  speciesGerman: string | null; // I-5
  speciesBotanical: string | null; // I-6
  maturityYear: string | null; // I-7
  productKind: string | null; // I-8
  hsCode: string | null; // I-9
  fellingCoordinates: Coordinates | null; // I-10 / I-11
  fellingDate: string | null; // I-12
  fellingCountry: string | null; // I-13
  fellingState: string | null; // I-14
  certifications: string[]; // I-15
  actors: ProvenanceActor[]; // I-16..I-26
  buyerName: string | null; // I-27
  buyerAddress: string | null; // I-28
}

// ---------------------------------------------------------------------------
// Kleine Helfer (Stil aus productMapper.ts uebernommen)
// ---------------------------------------------------------------------------

function getValue(binding: SparqlBinding | undefined, key: string): string | undefined {
  const value = binding?.[key]?.value;
  return value && value.trim() !== '' ? value : undefined;
}

/** Leere Strings zu null normalisieren -- die UI unterscheidet nur "da"/"nicht da". */
function orNull(value: string | undefined | null): string | null {
  return value && value.trim() !== '' ? value.trim() : null;
}

/**
 * Datum zu "TT.MM.JJJJ"; unparsbares bleibt unveraendert.
 *
 * Neben ISO auch "TT/MM/JJJJ": so schreibt die Rundholz-Transportvorlage ihr
 * tc:datum ("20/07/2026"). ``new Date`` liest das amerikanisch (Monat 20 --
 * ungueltig), und der ISO-Regex greift nicht; der Wert stand deshalb im
 * Fremdformat neben den uebrigen Daten der Liste.
 */
export function parseDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const dmy = dateStr.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dmy) return `${dmy[1].padStart(2, '0')}.${dmy[2].padStart(2, '0')}.${dmy[3]}`;
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

/**
 * Erster nicht-leerer Wert einer Spalte ueber ALLE Zeilen.
 *
 * Die Sparten-Abfragen sind UNIONs mehrerer Quellen (Saegewerk: Rundholz-
 * Auftrag, Leistungserklaerung, Maschinendaten). Welche Quelle die erste
 * Zeile stellt, ist nicht festgelegt -- bei "Vorangegangene Kette" fuer eine
 * Lamelle kam zuerst die Maschinendaten-Zeile ohne Firma, und das Saegewerk
 * hiess nur noch "Saegewerk" (Befund 18.09.2026). Deshalb je Feld ueber die
 * Zeilen suchen statt blind ``rows[0]`` zu lesen.
 */
function pick(rows: SparqlBinding[] | undefined, key: string): string | null {
  for (const row of rows ?? []) {
    const value = getValue(row, key);
    if (value) return value.trim();
  }
  return null;
}

/**
 * Gattungsnamen, die productMapper als Rueckfall einsetzt ("Saegewerk",
 * "BSP-Werk"). Als Akteursname sind sie wertlos -- und fuer den Geocoder
 * sogar schaedlich: "Saegewerk" allein fand irgendein Saegewerk bei
 * Stuttgart und setzte dort einen Marker.
 */
const PLACEHOLDER_NAMES = new Set(['Sägewerk', 'Saegewerk', 'BSP-Werk', 'Forstbetrieb', 'Holztransport']);

function realName(value: string | undefined | null): string | null {
  const name = orNull(value);
  return name && !PLACEHOLDER_NAMES.has(name) ? name : null;
}

// ---------------------------------------------------------------------------
// Adress-Beutel aufloesen (siehe Kopfkommentar, Punkt 1)
// ---------------------------------------------------------------------------

export interface AddressParts {
  name: string | null;
  street: string | null;
  city: string | null;
}

const POSTCODE = /\b\d{5}\b/;
const STREET = /(str|straße|strasse|weg|allee|platz|gasse|ring|damm)\.?\s*\d+/i;
/**
 * Rechtsform am Ende des Namens -- das verlaesslichste Merkmal einer Firma.
 * Ohne diese Pruefung entschied die Reihenfolge der Literale, und die ist
 * bei einem SPARQL-Kreuzprodukt beliebig: "Im Kissen 19" stand als Name in
 * der Akteurskarte, "EGGER Saegewerk Brilon GmbH" als Anschrift darunter
 * (Partner-Feedback 22.09.2026).
 */
const COMPANY = /\b(gmbh|mbh|ag|kg|ohg|gbr|se|ug|e\.\s?k|e\.\s?g)\b/i;
/**
 * Strasse ohne Stichwort: Wort(e), dann eine Hausnummer am Ende
 * ("Im Kissen 19", "Am Hang 3a"). Bewusst erst NACH der Firmenpruefung,
 * sonst verschluckte es Namen, die auf eine Zahl enden.
 */
const STREET_WITH_NUMBER = /^[^\d,]+\s\d+\s*[a-z]?$/i;

/**
 * Drei ununterscheidbare Adressliterale nach Name / Strasse / Ort sortieren.
 *
 * Heuristik, bewusst an einer Stelle gebuendelt und exportiert, damit ihre
 * Fehleranfaelligkeit sichtbar und testbar bleibt:
 * Reihenfolge der Pruefungen ist wesentlich -- die spezifischste zuerst:
 *   - Rechtsform (GmbH, KG, ...)     -> Name  ("EGGER Saegewerk Brilon GmbH")
 *   - enthaelt eine 5-stellige Zahl  -> Ort   ("70173 Stuttgart")
 *   - Strassen-Stichwort + Hausnr.   -> Strasse
 *   - Wort(e) + Hausnummer am Ende   -> Strasse ("Im Kissen 19")
 *   - sonst                          -> Name
 * Mehrfachtreffer: der erste gewinnt, weitere landen beim Namen.
 */
export function classifyAddressParts(values: string[]): AddressParts {
  const parts: AddressParts = { name: null, street: null, city: null };
  const leftovers: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;

    if (COMPANY.test(value) && !parts.name) {
      parts.name = value;
    } else if (POSTCODE.test(value) && !parts.city) {
      parts.city = value;
    } else if (STREET.test(value) && !parts.street) {
      parts.street = value;
    } else if (STREET_WITH_NUMBER.test(value) && !parts.street) {
      parts.street = value;
    } else {
      leftovers.push(value);
    }
  }

  for (const value of leftovers) {
    if (!parts.name) parts.name = value;
    else if (!parts.street) parts.street = value;
    else if (!parts.city) parts.city = value;
  }

  return parts;
}

/**
 * Belegnummer mit ihrer Bedeutung beschriften.
 *
 * Die nackte Zahl sagte nichts: unter dem Forstbetrieb stand bloss "1", und
 * die Praxispartner fragten zurecht, was das sei (Feedback 22.09.2026). Es
 * ist die laufende Stammnummer aus der Maschinendatei -- mit Beschriftung
 * ist sie eine Angabe, ohne war sie ein Raetsel.
 */
function labelled(label: string, value: string | null): string | null {
  return value ? `${label} ${value}` : null;
}

/** Strasse + Ort zu einer Anzeigezeile; null, wenn beides fehlt. */
function joinAddress(street: string | null, city: string | null): string | null {
  const pieces = [street, city].filter((p): p is string => !!p);
  return pieces.length > 0 ? pieces.join(', ') : null;
}

/**
 * Anschrift aus den Sparten-Zeilen (Saegewerk / Werk).
 *
 * Zwei Formen laufen hier zusammen: der Rundholz-Auftrag liefert Strasse,
 * PLZ und Ort GETRENNT (?street ?postcode ?city) -- die haben Vorrang. Die
 * Leistungserklaerung schreibt Name, Strasse und Ort dagegen alle auf
 * tc:manufacturerAddress, also kommt je Literal eine Zeile mit ?street; das
 * ist derselbe Beutel wie bei den Transportauftraegen und wird genauso ueber
 * classifyAddressParts sortiert, statt das erste Literal als Strasse zu
 * nehmen (das waere oft der Firmenname).
 */
function addressFromRows(rows: SparqlBinding[]): string | null {
  const postcode = pick(rows, 'postcode');
  const city = pick(rows, 'city');
  if (postcode || city) {
    const cityLine = postcode && city ? `${postcode} ${city}` : city;
    return joinAddress(pick(rows, 'street'), cityLine);
  }
  const bag = rows
    .map((r) => getValue(r, 'street'))
    .filter((v): v is string => !!v);
  if (bag.length === 0) return null;
  const parts = classifyAddressParts(bag);
  return joinAddress(parts.street, parts.city);
}

/**
 * Botanischen von deutschem Artnamen unterscheiden.
 *
 * Das Pruefzertifikat schreibt beide auf tc:species. Ein botanischer Name ist
 * entweder in SPECIES_SCIENTIFIC bekannt oder sieht aus wie eine binaere
 * Nomenklatur (zwei kleingeschriebene lateinische Woerter, ggf. mit
 * Autorenkuerzel).
 */
function looksBotanical(value: string): boolean {
  const known = Object.values(SPECIES_SCIENTIFIC).some((sci) =>
    value.toLowerCase().startsWith(sci.toLowerCase()),
  );
  if (known) return true;
  return /^[A-Z][a-z]+\s+[a-z]+/.test(value.trim());
}

// ---------------------------------------------------------------------------
// I-9: HS-Code (Zolltarif Kapitel 44)
// ---------------------------------------------------------------------------

/**
 * HS-Code aus der Erzeugnisart ableiten -- im Datenraum ist er nirgends
 * hinterlegt, laut Spezifikation aber "ermittelbar ueber die Art der
 * relevanten Erzeugnisse".
 *
 * Brettsperrholz fuehrt die Vorlage als "4412/4418"; hier wird 4412
 * (verleimtes Holz) gesetzt, denn 4418 ist Bautischlerei und trifft die
 * BSP-Platte als Halbzeug nicht.
 */
function deriveHsCode(text: string | null): string | null {
  if (!text) return null;
  const value = text.toLowerCase();
  if (/(brettsperrholz|bsp|clt|cross laminated)/.test(value)) return '4412';
  if (/(schnittholz|lamelle|brett)/.test(value)) return '4407';
  if (/(rundholz|stamm|log)/.test(value)) return '4403';
  return null;
}

// ---------------------------------------------------------------------------
// I-18 / I-22 / I-26: Transportdaten aus EPCIS-Events
// ---------------------------------------------------------------------------

/**
 * Versanddatumsliste aus den EPCIS-Events, chronologisch.
 *
 * Die Uebergaben zwischen den Unternehmen sind genau das, was EPCIS abbildet.
 * Gefiltert wird auf shipping/departing; ohne passenden bizStep werden alle
 * Events genommen, damit wenigstens eine Reihenfolge entsteht.
 */
function shippingDates(events: EpcisEvent[] | undefined): string[] {
  if (!events || events.length === 0) return [];

  const relevant = events.filter((e) => /shipping|departing/i.test(e.bizStep ?? ''));
  const source = relevant.length > 0 ? relevant : events;

  return source
    .map((e) => e.eventTime)
    .filter((t): t is string => !!t)
    .sort()
    .map((t) => parseDate(t))
    .filter((d): d is string => !!d);
}

// ---------------------------------------------------------------------------
// Transportauftraege: Kreuzprodukt zu Lieferungen gruppieren
// ---------------------------------------------------------------------------

interface DeliveryInfo {
  loading: AddressParts;
  unloading: AddressParts;
  startDate: string | null;
  endDate: string | null;
  transportNumber: string | null;
  /** true = Rundholz-Vorlage (flache Felder, Empfaenger ist das Saegewerk). */
  isRoundwood: boolean;
}

/**
 * Das Kreuzprodukt der Adressabfrage zu einer Lieferung je ?delivery falten.
 * Duplikate entstehen bauartbedingt (3x3 Zeilen) und werden ueber Sets
 * eingesammelt, bevor classifyAddressParts sortiert.
 *
 * Zwei Auftragsformen laufen hier zusammen (siehe createTransportOrdersQuery):
 *
 *   - Schnittholz: Adressen als Beutel am Lieferauftrag -> Heuristik noetig.
 *   - Rundholz: tc:firmenname/tc:strasse/tc:stadt liegen bereits GETRENNT am
 *     Auftrag. Diese Felder werden direkt uebernommen, nicht geraten -- die
 *     Heuristik darf gute Daten nicht wieder verschlechtern.
 *
 * Gruppiert wird immer nach ?order: der flache Rundholz-Auftrag hat gar keinen
 * ?delivery, sonst fielen alle Rundholz-Auftraege in einen Topf.
 */
function groupDeliveries(bindings: SparqlBinding[]): DeliveryInfo[] {
  const byDelivery = new Map<
    string,
    {
      loading: Set<string>;
      unloading: Set<string>;
      startDate?: string;
      endDate?: string;
      transportNumber?: string;
      flatName?: string;
      flatStreet?: string;
      flatCity?: string;
      flatPostcode?: string;
      flatDate?: string;
      supplier?: string;
    }
  >();

  for (const row of bindings) {
    const order = getValue(row, 'order') ?? '_';
    const key = `${order}|${getValue(row, 'delivery') ?? ''}`;
    let entry = byDelivery.get(key);
    if (!entry) {
      entry = { loading: new Set(), unloading: new Set() };
      byDelivery.set(key, entry);
    }

    const loading = getValue(row, 'loadingAddress');
    if (loading) entry.loading.add(loading);
    const unloading = getValue(row, 'unloadingAddress');
    if (unloading) entry.unloading.add(unloading);

    entry.startDate ??= getValue(row, 'startDate');
    entry.endDate ??= getValue(row, 'endDate');
    entry.transportNumber ??= getValue(row, 'transportNumber');

    entry.flatName ??= getValue(row, 'flatName');
    entry.flatStreet ??= getValue(row, 'flatStreet');
    entry.flatCity ??= getValue(row, 'flatCity');
    entry.flatPostcode ??= getValue(row, 'flatPostcode');
    entry.flatDate ??= getValue(row, 'flatDate');
    entry.supplier ??= getValue(row, 'supplier');
  }

  return Array.from(byDelivery.values()).map((entry) => {
    const isRoundwood = !!(entry.flatName || entry.flatStreet || entry.flatCity);

    // PLZ + Ort zusammenziehen, wie es die Anzeige und der Geocoder erwarten.
    const flatCity =
      entry.flatPostcode && entry.flatCity
        ? `${entry.flatPostcode} ${entry.flatCity}`
        : (entry.flatCity ?? null);

    const unloading: AddressParts = isRoundwood
      ? {
          name: orNull(entry.flatName),
          street: orNull(entry.flatStreet),
          city: orNull(flatCity),
        }
      : classifyAddressParts([...entry.unloading]);

    const loading: AddressParts = isRoundwood
      ? { name: orNull(entry.supplier), street: null, city: null }
      : classifyAddressParts([...entry.loading]);

    return {
      loading,
      unloading,
      startDate: parseDate(entry.startDate) ?? parseDate(entry.flatDate),
      endDate: parseDate(entry.endDate) ?? parseDate(entry.flatDate),
      transportNumber: orNull(entry.transportNumber),
      isRoundwood,
    };
  });
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

export function mapToProvenance(
  data: ProductDataResult | null,
  product: Product | null,
  supplyChain: SupplyChainStep[] = [],
): ProvenanceData {
  const stem = data?.stem?.[0];
  const forest = data?.forest?.[0];
  // Saegewerk und Werk: Felder ueber alle Zeilen suchen (siehe ``pick``).
  const sawmillRows = data?.sawmill ?? [];
  const bspWerkRows = data?.bspWerk ?? [];

  const deliveries = groupDeliveries(data?.transportOrders ?? []);
  const transportDates = shippingDates(data?.epcisEvents);

  // Wer steht in welchem Transportauftrag? Die Vorlagen sind hier NICHT
  // symmetrisch -- das ist die Falle an dieser Stelle:
  //
  //   Rundholz-Auftrag (Wald -> Saegewerk):
  //     "Auftraggeber" (tc:firmenname) ist der FORSTBETRIEB, der das Holz
  //     verkauft, und "Lieferant" das Forstamt. Ein Empfaengerfeld hat die
  //     Vorlage gar nicht -- das Saegewerk kommt darin schlicht nicht vor.
  //     Verwertbar ist daraus nur das Transportdatum (I-18).
  //
  //   Schnittholz-Auftrag (Saegewerk -> Holzwerkstoffproduzent):
  //     Beladestelle = SAEGEWERK      (I-19..I-21)
  //     Entladestelle = HOLZWERKSTOFFPRODUZENT (I-23..I-25)
  //
  // Der Holzwerkstoffproduzent steht also in der ENTladestelle, das Saegewerk
  // in der BEladestelle -- beide im selben Dokument.
  const roundwoodDelivery = deliveries.find((d) => d.isRoundwood);
  const lamellaDelivery = deliveries.find((d) => !d.isRoundwood);

  // --- Allgemeine Angaben (I-1..I-9) --------------------------------------
  // Handelsname und Beschreibung stammen laut Informationsbedarfstiefe aus der
  // Leistungserklaerung (I-1 = M-1077, I-2 = M-1078). Das Produktobjekt kennt
  // sie nicht -- es speist sich nur aus den Maschinendaten -- deshalb hat hier
  // das Dokument Vorrang und das Produkt dient als Rueckfallebene.
  //
  // Der Handelsname ist tc:typeNumber ("X-LAM C24 Brettsperrholz nach
  // ETA11/0189"), NICHT tc:title: letzteres ist der Titel des Dokuments, und
  // in den Vorlagen steht dort schlicht "Leistungserklaerung". Genau das
  // stand deshalb als Handelsname in der Ansicht (Partner-Feedback
  // 22.09.2026). Die Rueckbaubarkeit loest es seit jeher so; der
  // Herkunftsnachweis zieht nach.
  const declarations = data?.declarations ?? [];
  const declaredType = declarations.map((r) => getValue(r, 'typeNumber')).find((v) => !!v);
  const declaredUse = declarations.map((r) => getValue(r, 'intendedUse')).find((v) => !!v);

  const tradeName = orNull(declaredType) ?? orNull(product?.name);
  const description = orNull(declaredUse) ?? orNull(product?.description);

  const volumeM3 =
    pick(bspWerkRows, 'nettoVolumen') ??
    pick(bspWerkRows, 'bruttoVolumen') ??
    pick(sawmillRows, 'totalVolume');
  const pieces = pick(sawmillRows, 'totalPieces');

  const speciesGerman = orNull(product?.woodType);

  // Zertifikate koennen die botanische Bezeichnung praeziser liefern als die
  // Ableitung aus der deutschen Bezeichnung -- deshalb Vorrang.
  const certificateSpecies = (data?.certificates ?? [])
    .map((row) => getValue(row, 'species'))
    .filter((v): v is string => !!v);
  const speciesBotanical =
    orNull(certificateSpecies.find(looksBotanical)) ??
    orNull(product?.woodTypeScientific) ??
    (speciesGerman ? orNull(SPECIES_SCIENTIFIC[speciesGerman]) : null);

  const maturityYear = orNull(
    (data?.certificates ?? []).map((row) => getValue(row, 'maturityYear')).find((v) => !!v),
  );

  const productKind =
    pick(bspWerkRows, 'bspTypBezeichnung') ??
    (product?.productType === 'finished' ? 'Brettsperrholz' : null) ??
    tradeName;
  const hsCode = deriveHsCode(productKind ?? tradeName);

  // --- Faellvorgang (I-10..I-15) ------------------------------------------
  const rawCoordinates = product?.origin?.coordinates ?? null;
  const fellingCoordinates =
    rawCoordinates && (rawCoordinates.lat !== 0 || rawCoordinates.lng !== 0)
      ? rawCoordinates
      : null;

  const fellingDate =
    parseDate(getValue(stem, 'harvestDate')) ??
    parseDate(getValue(forest, 'harvestDate')) ??
    orNull(product?.harvestDate);

  const certifications = product?.certifications ?? [];

  // --- Akteure (I-16..I-26) -----------------------------------------------
  const actors: ProvenanceActor[] = [];
  const stepFor = (stage: SupplyChainStep['stage']) => supplyChain.find((s) => s.stage === stage);

  // Wald: Name aus dem Maschinenbesitzer (HPR), sonst Forstamt oder
  // Lieferant aus der Lieferkette. Koordinaten sind hier echt gemessen.
  const forestStep = stepFor('forest');
  const forestName =
    orNull(getValue(stem, 'ownerName')) ??
    orNull(getValue(stem, 'forestryOffice')) ??
    orNull(getValue(forest, 'forestryOffice')) ??
    realName(forestStep?.company);
  if (forestName) {
    actors.push({
      id: 'forest',
      kind: 'forest',
      name: forestName,
      address: joinAddress(
        null,
        orNull(getValue(stem, 'ownerCity')) ??
          orNull(getValue(stem, 'district')) ??
          orNull(forestStep?.location),
      ),
      reference: labelled(
        'Stamm-Nr.',
        orNull(getValue(stem, 'stemNumber')) ?? orNull(getValue(stem, 'stemKey')),
      ),
      transportDate: transportDates[0] ?? parseDate(pick(sawmillRows, 'deliveryDate')),
      coordinates: fellingCoordinates,
      coordinateSource: fellingCoordinates ? 'measured' : null,
    });
  }

  // Saegewerk (I-19..I-21): die BELADEstelle des Schnittholz-Auftrags -- dort
  // wird die Lamelle abgeholt, also steht dort das Saegewerk. Der
  // Rundholz-Auftrag taugt dafuer als ADRESSQUELLE sehr wohl: sein
  // Empfaenger (tc:firmenname/strasse/pLZ/stadt) IST das Saegewerk -- genau
  // so liest ihn createSawmillQuery. Nur sein "Auftraggeber"/"Lieferant" ist
  // der Forstbetrieb; der wird hier nicht verwendet.
  //
  // Ohne Schnittholz-Auftrag (Umfang "Vorangegangene Kette" fuer Rundholz
  // oder Lamelle) blieb die Anschrift bisher leer, obwohl sie in der
  // Saegewerks-Zeile stand -- der Mapper las von dort nur den Namen.
  const sawmillStep = stepFor('sawmill');
  const sawmillName =
    orNull(lamellaDelivery?.loading.name) ??
    pick(sawmillRows, 'company') ??
    // Bestimmungssaegewerk aus den Maschinendaten -- nur ein Name.
    pick(sawmillRows, 'destinationProduct') ??
    realName(sawmillStep?.company);
  if (sawmillName) {
    actors.push({
      id: 'sawmill',
      kind: 'sawmill',
      name: sawmillName,
      address:
        joinAddress(
          lamellaDelivery?.loading.street ?? null,
          lamellaDelivery?.loading.city ?? null,
        ) ??
        addressFromRows(sawmillRows) ??
        joinAddress(null, orNull(sawmillStep?.location)),
      reference:
        labelled('Polter-Nr.', pick(sawmillRows, 'polterId')) ??
        labelled('Transport-Nr.', orNull(lamellaDelivery?.transportNumber)),
      transportDate:
        // I-18: Ankunft des Rundholzes im Saegewerk -- das Datum des
        // Rundholz-Auftrags, das Einzige, was dieser beisteuert.
        roundwoodDelivery?.endDate ??
        transportDates[1] ??
        lamellaDelivery?.startDate ??
        parseDate(pick(sawmillRows, 'deliveryDate')),
      coordinates: null, // wird spaeter geocodiert
      coordinateSource: null,
    });
  }

  // Holzwerkstoffproduzent (I-23..I-25): die ENTladestelle des
  // Schnittholz-Auftrags -- dorthin gehen die Lamellen.
  //
  // Kein Gattungsname als Rueckfall (realName): fehlt die Werksstufe -- etwa
  // bei "Vorangegangene Kette" fuer eine Lamelle -- gibt es hier schlicht
  // keinen Akteur, und die Liste endet beim Saegewerk.
  const manufacturerStep = stepFor('manufacturer');
  const manufacturerDelivery = lamellaDelivery;
  const manufacturerName =
    orNull(manufacturerDelivery?.unloading.name) ??
    pick(bspWerkRows, 'company') ??
    realName(manufacturerStep?.company);
  if (manufacturerName) {
    actors.push({
      id: 'manufacturer',
      kind: 'manufacturer',
      name: manufacturerName,
      address:
        joinAddress(
          manufacturerDelivery?.unloading.street ?? null,
          manufacturerDelivery?.unloading.city ?? null,
        ) ??
        addressFromRows(bspWerkRows) ??
        joinAddress(null, pick(bspWerkRows, 'produktionsstandort')) ??
        joinAddress(null, orNull(manufacturerStep?.location)),
      reference:
        labelled('Konstruktions-Nr.', pick(bspWerkRows, 'konstruktionsnummer')) ??
        labelled('Transport-Nr.', orNull(manufacturerDelivery?.transportNumber)),
      transportDate:
        // I-22/I-26: Datum der Entladung beim Produzenten. Das Dokument ist
        // hier belastbarer als der Positionsindex in den EPCIS-Events.
        manufacturerDelivery?.endDate ??
        transportDates[2] ??
        parseDate(pick(bspWerkRows, 'productionDate')),
      coordinates: null, // wird spaeter geocodiert
      coordinateSource: null,
    });
  }

  return {
    tradeName,
    description,
    volumeM3,
    pieces,
    speciesGerman,
    speciesBotanical,
    maturityYear,
    productKind,
    hsCode,
    fellingCoordinates,
    fellingDate,
    fellingCountry: countryFromCoordinates(fellingCoordinates),
    fellingState: stateFromCoordinates(fellingCoordinates),
    certifications,
    actors,
    // I-27/I-28: Rechnungsempfaenger des ERP-Herstellungsvorgangs. Der
    // proprietaere ERP-Standard fuehrt den Kaeufer als Rechnungsempfaenger --
    // ein eigenes Kaeufer-Praedikat gibt es dort nicht.
    buyerName: orNull(declarations.map((r) => getValue(r, 'buyerName')).find((v) => !!v)),
    buyerAddress: orNull(declarations.map((r) => getValue(r, 'buyerAddress')).find((v) => !!v)),
  };
}
