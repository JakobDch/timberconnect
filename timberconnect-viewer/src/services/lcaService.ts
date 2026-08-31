/**
 * Anwendungsfall "CO2-Bilanz" -- Berechnung und Aufbereitung.
 *
 * Rechnet die Treibhausgasemissionen (GWP, kg CO2e) einer BSP-Platte ueber
 * die Lebenszyklusmodule A1-A5, in Anlehnung an EN 15804+A2 (KEINE
 * Konformitaet, keine Verifizierung -- Modul B sowie C/D bewusst out of
 * scope). Grundlage ist die Informationsbedarfstiefe_Awf_CO2-Bilanz.xlsx
 * (Blatt "Berechnung", Spalte "Formel App") der Awf-Vorgabe.
 *
 * Aufbau nach dem Muster von deconstructionMapper.ts: reine Funktionen ohne
 * I/O. Die einzige asynchrone Zutat -- das Geocoding der Transportstrecken
 * A2/A4 -- laeuft AUSSERHALB in der Ansicht; computeLca() bekommt fertige
 * Distanzen und bleibt dadurch vollstaendig unit-testbar.
 *
 * Drei Eigenheiten der Datenlage:
 *
 * 1. Der Rundholz-Transportauftrag liefert deutsche Formularwerte als Text
 *    ("18 km", "13,20"). Ohne die Parser unten waeren A1.1/A1.2 still NaN.
 * 2. Die Gesamtmenge der Schnittholzlamellen (Spec: M-584) existiert nicht als
 *    eigenes Merkmal im Datenraum; ersatzweise dient tc:volume des
 *    Schnittholz-Transportauftrags -- als "derived" gekennzeichnet.
 * 3. Die Strecke zur Baustelle (Spec: M-849, Boardcomputer) hat kein Mapping.
 *    Fallback: Abhol- und Lieferort aus dem ERP-Vorgang werden geocodiert und
 *    die Luftlinie mit dem Umwegfaktor beaufschlagt -- ebenfalls "derived".
 */

import type { Product } from '../types';
import type { ProductDataResult, SparqlBinding } from './sparqlService';
import { SPECIES_SCIENTIFIC } from '../config/solidPods';

// ---------------------------------------------------------------------------
// Konstanten (Blatt "Hintergrunddaten" der Informationsbedarfstiefe)
// ---------------------------------------------------------------------------

/** Hintergrundwerte mit Quellenangabe -- fest, nicht produktspezifisch. */
export const LCA_CONSTANTS = {
  /** Menge Schnittholzlamellen je m³ BSP [m³] (Materialfluss). */
  sawnTimberPerBsp: 1.2,
  /** Menge Rundholz je m³ BSP [m³] (Materialfluss). */
  roundwoodPerBsp: 2.95,
  /** Menge Baeume (Derbholz) je m³ BSP [m³] (Materialfluss). */
  treesPerBsp: 5.13,
  /** CO2-Gehalt Fichte, biogene Speicherung [kg CO2/m³] (Kaulen et al. 2024). */
  biogenicCo2PerM3: 722.39,
  /** Holzernte inkl. Transport zum Polter [kg CO2/m³ RH] (Kaulen et al. 2024). */
  harvestPerM3: 4,
  /** Verladung am Polter [kg CO2/m³ RH] (Handler et al. 2014). */
  loadingPerM3: 0.963,
  /** Dieselverbrauch 40-t-LKW [l/km] (fleetgo.de). */
  dieselPerKm: 0.35,
  /** Emissionen je Liter Diesel [kg CO2/l] (Handler et al. 2014, HarvestCO2). */
  co2PerLitre: 3.28,
  /** Herstellung Schnittholz im Saegewerk [kg CO2e/m³ SH] (Rueter & Diederichs 2012). */
  sawmillPerM3: 37.5,
  /** Herstellung BSP inkl. Leim [kg CO2e/m³ BSP] (EPD Derix XLAM, MRPI). */
  bspPlantPerM3: 125,
  /** Einbau auf der Baustelle [kg CO2e/m³ BSP] (EPD Derix XLAM, MRPI). */
  installationPerM3: 8,
  /** Umwegfaktor Luftlinie -> Strasse fuer geocodierte Strecken. */
  detourFactor: 1.3,
} as const;

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/** Gleiche Semantik wie FieldAvailability der Rueckbaubarkeit. */
export type LcaAvailability = 'available' | 'derived' | 'missing' | 'unsupported';

/** Ein Eingangswert der Berechnung mit Herkunftsstatus. */
export interface LcaValue {
  value: number | null;
  availability: LcaAvailability;
  /** Begruendung bei derived/missing; sonst undefined. */
  note?: string;
}

/** Produktspezifische Eingangsgroessen aus dem Datenraum. */
export interface LcaInputs {
  /** M-927 Nettovolumen der Platte [m³] -- Pflichtgroesse. */
  volumeBsp: LcaValue;
  /** M-665 Strecke Polter -> Saegewerk [km]. */
  distancePolterSawmillKm: LcaValue;
  /** M-675 Gesamtmenge des Rundholztransports [fm]. */
  roundwoodTransportTotalM3: LcaValue;
  /** Ersatz fuer M-584: tc:volume des Schnittholz-Transportauftrags [m³]. */
  sawnTimberTransportTotalM3: LcaValue;
  /** M-997 Gesamtmenge der BSP-Lieferung [m³]. */
  bspTransportTotalM3: LcaValue;
  /** Beladeadresse (Saegewerk) fuer die Anzeige (I-71), als Freitext. */
  sawmillAddress: string | null;
  /** Entladeadresse (Holzwerkstoffproduzent) fuer die Anzeige (I-72). */
  bspWerkAddress: string | null;
  /** ERP-Abholort (PLZ + Ort) -- A4-Fallback fuer die fehlende M-849. */
  pickupLocation: string | null;
  /** ERP-Lieferort (PLZ + Ort) -- A4-Fallback. */
  deliveryLocation: string | null;
  /** Geocoding-Kandidaten je Station, bester zuerst (siehe
      buildAddressCandidates) -- die Ansicht probiert sie der Reihe nach. */
  sawmillGeoCandidates: string[];
  bspWerkGeoCandidates: string[];
  pickupGeoCandidates: string[];
  deliveryGeoCandidates: string[];
}

/**
 * Geocoding-Kandidaten aus einem Adressbeutel bauen, bester zuerst.
 *
 * Die Transportadressen kommen als drei ununterscheidbare Literale (Name,
 * Strasse, "PLZ Ort") in beliebiger Reihenfolge. Nominatim findet NICHTS,
 * sobald der Firmenname im Suchstring steht ("Sägewerk Sauerland GmbH,
 * Ruhrstraße 45, ..." -> 0 Treffer) -- deshalb zuerst Strasse + Ort ohne
 * Namen, dann nur "PLZ Ort", und der Volljoin nur als letzter Versuch.
 *
 *   - "PLZ Ort"  : beginnt mit 4-5 Ziffern
 *   - Strasse    : endet auf eine Hausnummer und ist kein "PLZ Ort"
 *   - alles andere (Firmenname) fliegt aus den vorderen Kandidaten raus
 *
 * Der Ortsteil darf dabei FEHLEN. Wird die Vorlage unvollstaendig ausgefuellt
 * ("59929" statt "59929 Brilon" -- so im Transportauftrag der Demodaten), war
 * frueher weder ein "PLZ Ort" noch eine Strasse erkennbar: die Ziffernfolge
 * sah wie eine Hausnummer aus und beanspruchte die Strassen-Rolle. Uebrig
 * blieb einzig der Volljoin MIT Firmenname -- also genau der Kandidat, an dem
 * Nominatim scheitert, und A2 der CO2-Bilanz blieb dauerhaft unberechenbar.
 * Eine nackte PLZ zaehlt deshalb ebenfalls als Ort; "Im Kissen 19, 59929"
 * findet Nominatim genauso zuverlaessig wie mit ausgeschriebenem Ortsnamen.
 */
export function buildAddressCandidates(values: Array<string | null | undefined>): string[] {
  const cleaned = values
    .map((v) => (v ?? '').trim())
    .filter((v) => v.length > 0);

  const PLZ_CITY = /^\d{4,5}\s+\S/;
  const PLZ_ONLY = /^\d{4,5}$/;
  const HOUSE_NUMBER_END = /\d+\s*[a-zA-Z]?\s*$/;

  // Vollstaendiges "PLZ Ort" schlaegt die nackte PLZ -- der Ortsname macht die
  // Suche eindeutiger, wenn er denn dasteht.
  const isPlace = (v: string) => PLZ_CITY.test(v) || PLZ_ONLY.test(v);
  const plzCity =
    cleaned.find((v) => PLZ_CITY.test(v)) ?? cleaned.find((v) => PLZ_ONLY.test(v)) ?? null;
  // isPlace() vor der Hausnummer pruefen: "59929" endet auf Ziffern und wuerde
  // sonst als Strasse durchgehen.
  const street =
    cleaned.find((v) => !isPlace(v) && HOUSE_NUMBER_END.test(v)) ?? null;

  const candidates: string[] = [];
  if (street && plzCity) candidates.push(`${street}, ${plzCity}`);
  if (plzCity) candidates.push(plzCity);
  if (cleaned.length > 0) candidates.push(cleaned.join(', '));
  return [...new Set(candidates)];
}

/** In der Ansicht aufgeloeste Transportstrecken (Geocoding + Umwegfaktor). */
export interface ResolvedDistances {
  /** A2: Saegewerk -> BSP-Werk [km]. */
  sawmillToBspKm: LcaValue;
  /** A4: BSP-Werk -> Baustelle/Lieferort [km]. */
  bspToSiteKm: LcaValue;
}

/** Ein Lebenszyklusmodul (bzw. Teilmodul von A1), anzeigefertig. */
export interface LcaModule {
  id: string;
  /** Anzeige-Code, z.B. "A1" oder "A1.0". */
  code: string;
  label: string;
  /** kg CO2e; null = nicht berechenbar. */
  value: number | null;
  availability: LcaAvailability;
  note?: string;
  /** Formel-Fussnote fuer den aufgeklappten Zustand. */
  formula: string;
  /** true, wenn eine Summe nicht alle Teilmodule enthaelt. */
  isPartial?: boolean;
  sub?: LcaModule[];
}

/** Ein Balken des Diagramms (Speicherung separat, s. Entscheidung 17.08.). */
export interface LcaChartBar {
  id: string;
  label: string;
  value: number | null;
}

/** Vollstaendiges Rechenergebnis. */
export interface LcaResult {
  modules: LcaModule[];
  /** Summe aller berechenbaren Module [kg CO2e]; null = nichts berechenbar. */
  total: number | null;
  /** true, wenn mindestens ein Modul nicht in die Summe eingehen konnte. */
  totalIsPartial: boolean;
  /** Codes der nicht berechenbaren Module, fuer den Teilsummen-Hinweis. */
  missingModules: string[];
  chart: LcaChartBar[];
}

// ---------------------------------------------------------------------------
// Parser fuer deutsche Formularwerte
// ---------------------------------------------------------------------------

/**
 * Zahl aus deutschem oder technischem Format lesen.
 *
 *   "13,20"    -> 13.2   (deutsches Komma)
 *   "1.234,5"  -> 1234.5 (Tausenderpunkt + Komma)
 *   "5.22"     -> 5.22   (xsd:decimal aus SPARQL)
 */
export function parseGermanNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw.replace(/\s+/g, '').match(/-?[\d.,]+/);
  if (!match) return null;

  let text = match[0];
  if (text.includes(',')) {
    // Komma ist das Dezimalzeichen; Punkte sind dann Tausendertrenner.
    text = text.replace(/\./g, '').replace(',', '.');
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Distanzangabe wie "18 km" in Kilometer lesen. */
export function parseDistanceKm(raw: string | null | undefined): number | null {
  if (!raw) return null;
  return parseGermanNumber(raw.replace(/km\s*$/i, ''));
}

/**
 * Postleitzahl normalisieren: RMLMapper schreibt JSON-Zahlen als Dezimal-
 * literal, die PLZ kommt deshalb als "59929.0" aus dem Graph. Ohne diese
 * Bereinigung entstuende der Ort "59929.0 Brilon" -- den erkennt weder die
 * PLZ-Heuristik der Geocoding-Kandidaten noch Nominatim.
 */
export function normalizePostcode(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return String(Math.round(Number(trimmed)));
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Kleine Binding-Helfer (Stil aus deconstructionMapper.ts)
// ---------------------------------------------------------------------------

function getValue(binding: SparqlBinding | undefined, key: string): string | undefined {
  const value = binding?.[key]?.value;
  return value && value.trim() !== '' ? value : undefined;
}

function firstValue(rows: SparqlBinding[], key: string): string | null {
  for (const row of rows) {
    const value = getValue(row, key);
    if (value) return value.trim();
  }
  return null;
}

function allValues(rows: SparqlBinding[], key: string): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = getValue(row, key);
    if (value) seen.add(value.trim());
  }
  return [...seen];
}

function available(value: number | null, note?: string): LcaValue {
  return value !== null
    ? { value, availability: 'available' }
    : { value: null, availability: 'missing', note: note ?? 'Kein Wert im Datenraum.' };
}

function derived(value: number | null, note: string): LcaValue {
  return value !== null
    ? { value, availability: 'derived', note }
    : { value: null, availability: 'missing', note };
}

// ---------------------------------------------------------------------------
// Eingangsgroessen aus den SPARQL-Ergebnissen ziehen
// ---------------------------------------------------------------------------

/**
 * Liest die berechnungsrelevanten Merkmale aus data.lca.
 *
 * Die Query liefert eine UNION ueber Panel, Transportauftraege,
 * Leistungserklaerungen und Klebstoff; die Spaltennamen sind je Block
 * eindeutig, deshalb braucht es keine Zeilen-Zuordnung. Nur die BEIDEN
 * Transportauftraege muessen unterschieden werden -- das geschieht ueber die
 * vorhandenen Spalten (Rundholz hat tc:ladezone_Distanz/tc:menge_Festmeter,
 * Schnittholz hat tc:volume und die Lieferadressen), nicht ueber Reihenfolge.
 */
export function extractLcaInputs(data: ProductDataResult | null): LcaInputs {
  const rows = data?.lca ?? [];
  // Rueckfallebene: das Nettovolumen steht auch in der Rueckbaubarkeits-Query
  // (Spalte "menge"), falls die LCA-Query gegen aeltere Quellen laeuft.
  const fallbackVolume = parseGermanNumber(firstValue(data?.deconstruction ?? [], 'menge'));

  const volumeBsp = parseGermanNumber(firstValue(rows, 'nettovolumen')) ?? fallbackVolume;

  // M-675: bevorzugt die ausgewiesene Summe; sonst Summe der Positionsmengen.
  const roundwoodSum = parseGermanNumber(firstValue(rows, 'summeFestmeter'));
  const roundwoodPositions = allValues(rows, 'mengeFestmeter')
    .map(parseGermanNumber)
    .filter((v): v is number => v !== null);
  const roundwoodTotal =
    roundwoodSum ??
    (roundwoodPositions.length > 0
      ? roundwoodPositions.reduce((sum, v) => sum + v, 0)
      : null);

  const joinBag = (values: string[]): string | null =>
    values.length > 0 ? values.join(', ') : null;

  const joinPlace = (plz: string | null, ort: string | null): string | null => {
    const text = [plz, ort].filter(Boolean).join(' ').trim();
    return text.length > 0 ? text : null;
  };

  const loadingBag = allValues(rows, 'loadingAddress');
  const unloadingBag = allValues(rows, 'unloadingAddress');
  const abholungPlz = normalizePostcode(firstValue(rows, 'abholungPlz'));
  const abholungOrt = firstValue(rows, 'abholungOrt');
  const lieferungPlz = normalizePostcode(firstValue(rows, 'lieferungPlz'));
  const lieferungOrt = firstValue(rows, 'lieferungOrt');

  return {
    volumeBsp: available(
      volumeBsp,
      'Nettovolumen (M-927) nicht im Datenraum -- ohne Bezugsgröße ist keine Berechnung möglich.',
    ),
    distancePolterSawmillKm: available(
      parseDistanceKm(firstValue(rows, 'ladezoneDistanz')),
      'Strecke zum Sägewerk (M-665) nicht im Transportauftrag Rundholz gefunden.',
    ),
    roundwoodTransportTotalM3: available(
      roundwoodTotal,
      'Gesamtmenge des Rundholztransports (M-675) nicht im Transportauftrag gefunden.',
    ),
    sawnTimberTransportTotalM3: derived(
      parseGermanNumber(firstValue(rows, 'orderVolume')),
      'Gesamtmenge Schnittholzlamelle (M-584) existiert nicht als Merkmal; ersatzweise das Transportvolumen des Schnittholz-Transportauftrags.',
    ),
    bspTransportTotalM3: available(
      parseGermanNumber(firstValue(rows, 'gesamtmengeBsp')),
      'Gesamtmenge der BSP-Lieferung (M-997) nicht im ERP-Vorgang gefunden.',
    ),
    sawmillAddress: joinBag(loadingBag),
    bspWerkAddress: joinBag(unloadingBag),
    pickupLocation: joinPlace(abholungPlz, abholungOrt),
    deliveryLocation: joinPlace(lieferungPlz, lieferungOrt),
    sawmillGeoCandidates: buildAddressCandidates(loadingBag),
    bspWerkGeoCandidates: buildAddressCandidates(unloadingBag),
    pickupGeoCandidates: buildAddressCandidates([
      joinPlace(abholungPlz, abholungOrt),
      abholungOrt,
    ]),
    deliveryGeoCandidates: buildAddressCandidates([
      joinPlace(lieferungPlz, lieferungOrt),
      lieferungOrt,
    ]),
  };
}

// ---------------------------------------------------------------------------
// Berechnung (Blatt "Berechnung", Spalte "Formel App")
// ---------------------------------------------------------------------------

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Module A1-A5 aus Eingangsgroessen und aufgeloesten Strecken berechnen.
 *
 * Reine, synchrone Funktion. Fehlt der Input eines Moduls, wird das Modul mit
 * value=null und Begruendung ausgewiesen und geht NICHT in die Summe ein --
 * die Summe traegt dann totalIsPartial (Luecken-Prinzip der Rueckbaubarkeit).
 */
export function computeLca(inputs: LcaInputs, distances: ResolvedDistances): LcaResult {
  const C = LCA_CONSTANTS;
  const V = inputs.volumeBsp.value;

  const noVolume: LcaValue = {
    value: null,
    availability: 'missing',
    note: inputs.volumeBsp.note,
  };

  /** Modul-Rohbau; haelt value/availability/note konsistent. */
  const module = (
    id: string,
    code: string,
    label: string,
    formula: string,
    result: LcaValue,
  ): LcaModule => ({
    id,
    code,
    label,
    value: result.value !== null ? round1(result.value) : null,
    availability: result.value !== null ? result.availability : 'missing',
    note: result.note,
    formula,
  });

  // --- A1.0 Biogene Speicherung (negativ) ---------------------------------
  const a10 = module(
    'a1_0',
    'A1.0',
    'Biogene Speicherung',
    `−${C.biogenicCo2PerM3} kg CO₂/m³ × (${C.treesPerBsp} m³ Derbholz/m³ BSP × Nettovolumen)`,
    V === null
      ? noVolume
      : { value: -C.biogenicCo2PerM3 * C.treesPerBsp * V, availability: 'available' },
  );

  // --- A1.1 Holzernte ------------------------------------------------------
  const a11 = module(
    'a1_1',
    'A1.1',
    'Holzernte',
    `${C.harvestPerM3} kg CO₂/m³ RH × (${C.roundwoodPerBsp} m³ RH/m³ BSP × Nettovolumen)`,
    V === null
      ? noVolume
      : { value: C.harvestPerM3 * C.roundwoodPerBsp * V, availability: 'available' },
  );

  // --- A1.2 Transport zum Saegewerk ---------------------------------------
  // Verladung am Polter + streckenabhaengiger Anteil an der LKW-Fahrt.
  const dist665 = inputs.distancePolterSawmillKm;
  const total675 = inputs.roundwoodTransportTotalM3;
  let a12Result: LcaValue;
  if (V === null) {
    a12Result = noVolume;
  } else if (dist665.value === null || total675.value === null) {
    a12Result = {
      value: null,
      availability: 'missing',
      note: dist665.value === null ? dist665.note : total675.note,
    };
  } else {
    const roundwoodM3 = C.roundwoodPerBsp * V;
    a12Result = {
      value:
        C.loadingPerM3 * roundwoodM3 +
        C.dieselPerKm * dist665.value * C.co2PerLitre * (roundwoodM3 / total675.value),
      availability: 'available',
    };
  }
  const a12 = module(
    'a1_2',
    'A1.2',
    'Transport zum Sägewerk',
    `${C.loadingPerM3} kg CO₂/m³ RH (Verladung) + (${C.dieselPerKm} l/km × Strecke × ${C.co2PerLitre} kg CO₂/l) × Mengenanteil`,
    a12Result,
  );

  // --- A1.3 Produktion Schnittholz ----------------------------------------
  const a13 = module(
    'a1_3',
    'A1.3',
    'Produktion Schnittholz',
    `${C.sawmillPerM3} kg CO₂e/m³ SH × (${C.roundwoodPerBsp} m³ RH/m³ BSP × Nettovolumen)`,
    V === null
      ? noVolume
      : { value: C.sawmillPerM3 * C.roundwoodPerBsp * V, availability: 'available' },
  );

  // --- A1 als Summe der Teilmodule ----------------------------------------
  const a1Subs = [a10, a11, a12, a13];
  const a1Computable = a1Subs.filter((m) => m.value !== null);
  const a1: LcaModule = {
    id: 'a1',
    code: 'A1',
    label: 'Rohstoffbereitstellung',
    value:
      a1Computable.length > 0
        ? round1(a1Computable.reduce((sum, m) => sum + (m.value ?? 0), 0))
        : null,
    availability: a1Computable.length > 0 ? 'available' : 'missing',
    isPartial: a1Computable.length > 0 && a1Computable.length < a1Subs.length,
    note:
      a1Computable.length === 0
        ? 'Keines der Teilmodule ist berechenbar.'
        : a1Computable.length < a1Subs.length
          ? `Teilsumme ohne ${a1Subs
              .filter((m) => m.value === null)
              .map((m) => m.code)
              .join(', ')}.`
          : undefined,
    formula: 'Summe A1.0 – A1.3',
    sub: a1Subs,
  };

  // --- A2 Transport zum BSP-Werk ------------------------------------------
  const distA2 = distances.sawmillToBspKm;
  const total584 = inputs.sawnTimberTransportTotalM3;
  let a2Result: LcaValue;
  if (V === null) {
    a2Result = noVolume;
  } else if (distA2.value === null || total584.value === null) {
    a2Result = {
      value: null,
      availability: 'missing',
      note: distA2.value === null ? distA2.note : total584.note,
    };
  } else {
    a2Result = {
      value:
        C.dieselPerKm *
        distA2.value *
        C.co2PerLitre *
        ((C.sawnTimberPerBsp * V) / total584.value),
      // Strecke geocodiert + Ersatzmerkmal fuer die Gesamtmenge -> abgeleitet.
      availability: 'derived',
      note: [distA2.note, total584.note].filter(Boolean).join(' '),
    };
  }
  const a2 = module(
    'a2',
    'A2',
    'Transport zum BSP-Werk',
    `(${C.dieselPerKm} l/km × Strecke × ${C.co2PerLitre} kg CO₂/l) × Mengenanteil Schnittholz`,
    a2Result,
  );

  // --- A3 Herstellung BSP --------------------------------------------------
  // 125 x 1,2 x V -- der Faktor wird auf den Schnittholz-INPUT angewendet
  // (1,2 m³ SH je m³ BSP), nicht auf das fertige Plattenvolumen. Von der
  // Awf-Autorin am 18.08.2026 ausdruecklich so bestaetigt: "es muss immer
  // der Input in m³ berechnet werden". Die Einheiten-Beschriftung im Blatt
  // Hintergrunddaten ("je m³ BSP") ist dazu inkonsistent, die Formel gilt.
  const a3 = module(
    'a3',
    'A3',
    'Herstellung BSP',
    `${C.bspPlantPerM3} kg CO₂e/m³ × (${C.sawnTimberPerBsp} m³ SH/m³ BSP × Nettovolumen)`,
    V === null
      ? noVolume
      : { value: C.bspPlantPerM3 * C.sawnTimberPerBsp * V, availability: 'available' },
  );

  // --- A4 Transport zur Baustelle ------------------------------------------
  const distA4 = distances.bspToSiteKm;
  const total997 = inputs.bspTransportTotalM3;
  let a4Result: LcaValue;
  if (V === null) {
    a4Result = noVolume;
  } else if (distA4.value === null || total997.value === null) {
    a4Result = {
      value: null,
      availability: 'missing',
      note: distA4.value === null ? distA4.note : total997.note,
    };
  } else {
    a4Result = {
      value: C.dieselPerKm * distA4.value * C.co2PerLitre * (V / total997.value),
      availability: 'derived',
      note: distA4.note,
    };
  }
  const a4 = module(
    'a4',
    'A4',
    'Transport zur Baustelle',
    `(${C.dieselPerKm} l/km × Strecke × ${C.co2PerLitre} kg CO₂/l) × Mengenanteil BSP`,
    a4Result,
  );

  // --- A5 Einbau -----------------------------------------------------------
  const a5 = module(
    'a5',
    'A5',
    'Einbau Baustelle',
    `${C.installationPerM3} kg CO₂e/m³ BSP × Nettovolumen`,
    V === null
      ? noVolume
      : { value: C.installationPerM3 * V, availability: 'available' },
  );

  // --- Gesamtergebnis ------------------------------------------------------
  const modules = [a1, a2, a3, a4, a5];
  const computable = modules.filter((m) => m.value !== null);
  const missingModules = modules
    .filter((m) => m.value === null)
    .map((m) => m.code)
    // Ein partielles A1 gehoert ebenfalls in den Hinweis.
    .concat(a1.isPartial ? a1.sub!.filter((m) => m.value === null).map((m) => m.code) : []);

  const total =
    computable.length > 0
      ? round1(computable.reduce((sum, m) => sum + (m.value ?? 0), 0))
      : null;

  // Diagramm: Speicherung als eigener Balken, A1 nur mit Emissionen --
  // sonst erdrueckt die biogene Speicherung (Faktor ~100) alle anderen Balken.
  const a1Emissions = [a11, a12, a13].filter((m) => m.value !== null);
  const chart: LcaChartBar[] = [
    { id: 'bio', label: 'Speicherung', value: a10.value },
    {
      id: 'a1e',
      label: 'A1*',
      value:
        a1Emissions.length > 0
          ? round1(a1Emissions.reduce((sum, m) => sum + (m.value ?? 0), 0))
          : null,
    },
    { id: 'a2', label: 'A2', value: a2.value },
    { id: 'a3', label: 'A3', value: a3.value },
    { id: 'a4', label: 'A4', value: a4.value },
    { id: 'a5', label: 'A5', value: a5.value },
  ];

  return {
    modules,
    total,
    totalIsPartial: computable.length < modules.length || Boolean(a1.isPartial),
    missingModules,
    chart,
  };
}

// ---------------------------------------------------------------------------
// Zusatzinformationen (Klassen der Informationsbedarfstiefe)
// ---------------------------------------------------------------------------

/** Eine Merkmalszeile -- gleiche Form wie DeconstructionField. */
export interface LcaInfoField {
  id: string;
  label: string;
  value: string | null;
  availability: LcaAvailability;
  note?: string;
}

export interface LcaInfoCategory {
  id: string;
  title: string;
  description: string;
  fields: LcaInfoField[];
}

/** Kopf- und Zusatzdaten der Ansicht (alles ausser der Rechnung selbst). */
export interface LcaInfo {
  /** Handelsname der Platte (I-1) fuer die Bauteilkarte. */
  componentName: string | null;
  /** Hersteller (I-41). */
  manufacturer: string | null;
  /** Titel der Leistungserklaerung -- "Deklaration" der Bauteilkarte. */
  declarationTitle: string | null;
  /** Bezugsgroesse, z.B. "Dieses Bauteil (5,22 m³ netto)". */
  referenceSize: string | null;
  /** Masse [kg], formatiert. */
  mass: string | null;
  /** Abmessungen, formatiert (Staerke x Breite x Laenge). */
  dimensions: string | null;
  categories: LcaInfoCategory[];
  coverage: { filled: number; total: number };
}

function infoField(
  id: string,
  label: string,
  value: string | null,
  note?: string,
): LcaInfoField {
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

function infoDerived(
  id: string,
  label: string,
  value: string | null,
  note: string,
): LcaInfoField {
  return value
    ? { id, label, value, availability: 'derived', note }
    : { id, label, value: null, availability: 'missing', note };
}

function infoUnsupported(id: string, label: string, note: string): LcaInfoField {
  return { id, label, value: null, availability: 'unsupported', note };
}

/** Zahl + Einheit im deutschen Format (Logik wie deconstructionMapper). */
function withUnit(value: string | null, unit: string): string | null {
  if (!value) return null;
  if (new RegExp(`${unit}\\s*$`, 'i').test(value)) return value;
  const asNumber = Number(value);
  const text = Number.isFinite(asNumber)
    ? asNumber.toLocaleString('de-DE', { maximumFractionDigits: 3 })
    : value;
  return `${text} ${unit}`;
}

/** "ja"/"nein" normalisieren (pEFC kommt als boolean-Literal). */
function normalizeBoolean(value: string | null): string | null {
  if (!value) return null;
  if (/^(ja|yes|true|1)$/i.test(value.trim())) return 'Ja';
  if (/^(nein|no|false|0)$/i.test(value.trim())) return 'Nein';
  return value;
}

/** Eine Leistungserklaerung, nach dop-IRI gruppiert. */
interface DopDoc {
  iri: string;
  title: string | null;
  typeNumber: string | null;
  manufacturer: string | null;
  intendedUse: string | null;
  holzart: string | null;
}

function collectDops(rows: SparqlBinding[]): DopDoc[] {
  const byIri = new Map<string, DopDoc>();
  for (const row of rows) {
    const iri = getValue(row, 'dop');
    if (!iri) continue;
    const doc = byIri.get(iri) ?? {
      iri,
      title: null,
      typeNumber: null,
      manufacturer: null,
      intendedUse: null,
      holzart: null,
    };
    doc.title ??= getValue(row, 'dopTitle') ?? null;
    doc.typeNumber ??= getValue(row, 'dopTypeNumber') ?? null;
    doc.manufacturer ??= getValue(row, 'dopManufacturer') ?? null;
    doc.intendedUse ??= getValue(row, 'dopIntendedUse') ?? null;
    doc.holzart ??= getValue(row, 'dopHolzart') ?? null;
    byIri.set(iri, doc);
  }
  return [...byIri.values()];
}

/** Erkennt die Schnittholz-Leistungserklaerung am Titel/Typ. */
const LAMELLA_RE = /schnittholz|lamelle/i;

/**
 * Zusatzinformationen der Informationsbedarfstiefe zusammensetzen:
 * Allgemeine Informationen, Einheiten & Masse, Eingangsgroessen und
 * eingegangene Produkte -- inklusive der bewussten Luecke "Hersteller
 * Klebstoff" (laut Vorgabe "nicht vorhanden").
 */
export function mapToLcaInfo(
  data: ProductDataResult | null,
  product: Product | null,
): LcaInfo {
  const rows = data?.lca ?? [];
  const inputs = extractLcaInputs(data);

  // Zwei Leistungserklaerungen moeglich (BSP-Platte + Schnittholzlamelle);
  // unterschieden wird am Titel -- eine IRI-Konvention gibt es nicht.
  const dops = collectDops(rows);
  const lamellaDop = dops.find((d) => LAMELLA_RE.test(d.title ?? d.typeNumber ?? ''));
  const bspDop = dops.find((d) => d !== lamellaDop) ?? null;

  const componentName =
    bspDop?.typeNumber ?? firstValue(rows, 'artikel') ?? product?.name ?? null;

  const speciesGerman =
    firstValue(rows, 'holzart') ?? bspDop?.holzart ?? product?.woodType ?? null;
  const speciesBotanical =
    product?.woodTypeScientific ??
    (speciesGerman ? (SPECIES_SCIENTIFIC[speciesGerman] ?? null) : null);

  const volumeText = firstValue(rows, 'nettovolumen');
  const massText = firstValue(rows, 'nettogewicht');
  const thickness = firstValue(rows, 'hoehe');
  const width = firstValue(rows, 'breite');
  const length = firstValue(rows, 'laenge');

  const dimensionParts = [
    withUnit(thickness, 'mm'),
    withUnit(width, 'm'),
    withUnit(length, 'm'),
  ];
  const dimensions = dimensionParts.every(Boolean)
    ? dimensionParts.join(' × ')
    : null;

  const formatKm = (v: LcaValue): string | null =>
    v.value !== null ? withUnit(String(v.value), 'km') : null;
  const formatM3 = (v: LcaValue): string | null =>
    v.value !== null ? withUnit(String(v.value), 'm³') : null;

  const categories: LcaInfoCategory[] = [
    {
      id: 'general',
      title: 'Allgemeine Informationen',
      description:
        'Produktkennzeichnung und Herkunftsangaben der Brettsperrholzplatte.',
      fields: [
        infoField('I-1', 'Handelsname', componentName),
        infoField('I-2', 'Beschreibung', bspDop?.intendedUse ?? firstValue(rows, 'beschreibung')),
        infoField('I-41', 'Hersteller', bspDop?.manufacturer ?? null),
        infoField('I-52', 'Verwendungszweck', bspDop?.intendedUse ?? null),
        infoField('I-57', 'Produktnorm', firstValue(rows, 'produktnorm')),
        infoField('I-5', 'Holzart (deutsch)', speciesGerman),
        infoField('I-6', 'Holzart (botanisch)', speciesBotanical),
        infoField('I-15', 'Holzzertifizierung', normalizeBoolean(firstValue(rows, 'pefc'))),
      ],
    },
    {
      id: 'units',
      title: 'Einheiten und Maße',
      description:
        'Bezugsgrößen der Berechnung: Volumen, Gewicht und Abmessungen der Platte.',
      fields: [
        infoDerived(
          'I-58',
          'Einheit',
          'kg CO₂e je Bauteil',
          'Bezugsgröße ist das gescannte Bauteil, nicht 1 m³ (Festlegung des Awf).',
        ),
        infoField('I-32', 'Nettovolumen', withUnit(volumeText, 'm³')),
        infoField('I-33', 'Höhe / Stärke', withUnit(thickness, 'mm')),
        infoField('I-34', 'Breite', withUnit(width, 'm')),
        infoField('I-35', 'Länge', withUnit(length, 'm')),
        infoField('I-59', 'Nettogewicht', withUnit(massText, 'kg')),
        infoField(
          'I-60',
          'Oberfläche einer Plattenseite',
          withUnit(firstValue(rows, 'oberflaeche'), 'm²'),
        ),
        infoField('I-61', 'Anzahl der Schichten', firstValue(rows, 'schichten')),
      ],
    },
    {
      id: 'inputs',
      title: 'Eingangsgrößen der Berechnung',
      description:
        'Produktspezifische Werte aus dem Datenraum, die in die Module A1–A5 einfließen.',
      fields: [
        infoField(
          'I-68',
          'Gesamtmenge Rundholztransport',
          formatM3(inputs.roundwoodTransportTotalM3),
          inputs.roundwoodTransportTotalM3.note,
        ),
        infoField(
          'I-69',
          'Strecke zum Sägewerk',
          formatKm(inputs.distancePolterSawmillKm),
          inputs.distancePolterSawmillKm.note,
        ),
        infoDerived(
          'I-70',
          'Gesamtmenge Schnittholzlamelle',
          formatM3(inputs.sawnTimberTransportTotalM3),
          inputs.sawnTimberTransportTotalM3.note ?? '',
        ),
        infoField('I-71', 'Adresse Sägewerk', inputs.sawmillAddress),
        infoField('I-72', 'Adresse Holzwerkstoffproduzent', inputs.bspWerkAddress),
        infoField(
          'I-73',
          'Gesamtmenge BSP-Lieferung',
          formatM3(inputs.bspTransportTotalM3),
          inputs.bspTransportTotalM3.note,
        ),
        infoDerived(
          'I-74',
          'Strecke zur Baustelle',
          inputs.pickupLocation && inputs.deliveryLocation
            ? `${inputs.pickupLocation} → ${inputs.deliveryLocation}`
            : null,
          'GPS-Gesamtstrecke (M-849) nicht im Datenraum; geschätzt aus Abhol- und Lieferort des ERP-Vorgangs.',
        ),
      ],
    },
    {
      id: 'components',
      title: 'Eingegangene Produkte',
      description:
        'Vorprodukte der Platte: Klebstoff und Schnittholzlamellen mit ihren Herstellern.',
      fields: [
        infoField('I-49', 'Produktbezeichnung Klebstoff', firstValue(rows, 'adhesiveName')),
        // Laut Informationsbedarfstiefe ausdruecklich "nicht vorhanden" --
        // eine bewusste Luecke des Awf, kein Versaeumnis der Umsetzung.
        infoUnsupported(
          'I-75',
          'Hersteller Klebstoff',
          'Im technischen Datenblatt nicht enthalten (laut Awf-Vorgabe „nicht vorhanden").',
        ),
        infoField(
          'I-76',
          'Produktbezeichnung Schnittholzlamelle',
          lamellaDop?.typeNumber ?? lamellaDop?.title ?? null,
          'Keine Leistungserklärung der Schnittholzlamelle in den geladenen Quellen.',
        ),
        infoField(
          'I-77',
          'Hersteller Schnittholzlamelle',
          lamellaDop?.manufacturer ?? null,
          'Keine Leistungserklärung der Schnittholzlamelle in den geladenen Quellen.',
        ),
      ],
    },
  ];

  const all = categories.flatMap((c) => c.fields);
  const volume = inputs.volumeBsp.value;

  return {
    componentName,
    manufacturer: bspDop?.manufacturer ?? null,
    declarationTitle: bspDop?.title ?? null,
    referenceSize:
      volume !== null
        ? `Dieses Bauteil (${volume.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m³ netto)`
        : null,
    mass: withUnit(massText, 'kg'),
    dimensions,
    categories,
    coverage: {
      filled: all.filter((f) => f.value !== null).length,
      total: all.length,
    },
  };
}
