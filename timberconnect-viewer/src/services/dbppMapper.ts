/**
 * Adapter fuer den Anwendungsfall "Digitaler Bauproduktpass" (DBPP).
 *
 * Ordnet die Daten des gescannten Bauteils in die Gliederung ein, die die EU
 * fuer einen digitalen Produktpass vorsieht -- und macht damit sichtbar,
 * welche der dort geforderten Angaben dieser Datenraum heute schon hergibt
 * und welche nicht. Reine Funktionen, kein I/O; der Dokumentenabruf und das
 * Geocoding der CO2-Strecken passieren ausserhalb.
 *
 * WICHTIG: Das Ergebnis ist KEIN konformer Digitaler Produktpass. Es gibt
 * bislang keinen Delegierten Rechtsakt, der den Datensatz fuer Bauprodukte
 * festlegt -- ein "konformer" Pass ist derzeit gar nicht herstellbar. Die
 * Kategorien folgen deshalb den Vorgaben, die schon feststehen:
 *
 *   - Bauprodukteverordnung (EU) 2024/3110, Art. 76: Leistungs- und
 *     Konformitaetserklaerung (Art. 15) samt REACH-Art.-31/33-Angaben,
 *     allgemeine Produktinformation und Sicherheitshinweise (Anhang IV),
 *     technische Dokumentation, Umweltkennzeichnung, eindeutige Kennungen
 *     (Art. 79).
 *   - Oekodesign-Verordnung (EU) 2024/1781 (ESPR): vier persistente Kennungen
 *     -- Produkt, Wirtschaftsakteur, Betriebsstaette, Register.
 *   - Fuer Bauprodukte diskutierte Datenfelder: Materialzusammensetzung,
 *     CO2-Fussabdruck, Rezyklatanteil, Herstellungsland, Dauerhaftigkeit,
 *     besorgniserregende Stoffe, Brandverhalten, Waermeschutz; empfohlen
 *     zusaetzlich Zertifizierungen, Schallschutz, Rueckbau, EUDR.
 *
 * Fuenf Eigenheiten der Datenlage praegen diese Datei:
 *
 * 1. Der Pass FASST ZUSAMMEN, er erhebt nicht neu. Herkunft, Ernte und
 *    Zertifizierung kommen aus data.stem/data.forest (dieselbe Quelle wie der
 *    Herkunftsnachweis), die CO2-Zahl aus dem Oekobilanz-Anwendungsfall. Eine
 *    zweite Rechnung im Pass haette bedeutet, dass dasselbe Bauteil je nach
 *    Ansicht eine andere Bilanz hat.
 * 2. Beide Leistungserklaerungen tragen dieselbe Klasse
 *    tc:DeclarationOfPerformance. Getrennt wird ueber das jeweils exklusive
 *    Praedikat (tc:moistureContent beim BSP, tc:zertifikatsnummer beim
 *    Schnittholz) -- die Query liefert sie bereits in getrennten Spalten.
 * 3. Die Herstelleranschrift kommt als "Beutel" gleichartiger Literale auf
 *    tc:manufacturerAddress. Sortiert wird mit classifyManufacturerAddress
 *    aus dem deconstructionMapper -- importiert statt kopiert, zwei Kopien
 *    der Heuristik liefen unweigerlich auseinander.
 * 4. Die Betriebsstaetten- und die Registerkennung der ESPR sind hier
 *    strukturell nicht erfuellbar: es gibt kein EU-DPP-Register, an dem sich
 *    ein Demonstrator registrieren koennte (Betrieb ab 19.07.2026). Sie
 *    erscheinen als ``unsupported`` mit Begruendung -- gerade diese Luecke
 *    ist eine Aussage ueber den Abstand zwischen Datenraum und Verordnung.
 * 5. Kein Wert wird geraten. Der ``C24``-Default und das feste
 *    "Deutschland" aus productMapper.ts fliessen hier bewusst NICHT ein: in
 *    einem Datenraum-Demonstrator sieht ein erfundener Wert aus wie ein
 *    Pod-Wert, und genau das soll der Pass nicht.
 */

import type { Product } from '../types';
import type { ProductDataResult, SparqlBinding } from './sparqlService';
import { SPECIES_SCIENTIFIC } from '../config/solidPods';
import {
  classifyManufacturerAddress,
  splitHazardousValues,
} from './deconstructionMapper';

/**
 * Warum ein Merkmal (nicht) angezeigt werden kann -- gleiche Semantik wie in
 * der Rueckbaubarkeit und der Dokumentation, damit alle Anwendungsfaelle
 * dieselbe Sprache sprechen.
 *
 * ``available``   -- Wert aus dem Datenraum.
 * ``derived``     -- aus einem anderen Merkmal abgeleitet (Regel in ``note``).
 * ``missing``     -- im Datenmodell vorgesehen, in DIESEN Daten nicht befuellt.
 * ``unsupported`` -- im Datenmodell (noch) gar nicht vorgesehen.
 */
export type DbppAvailability = 'available' | 'derived' | 'missing' | 'unsupported';

/** Ein Merkmal des Produktpasses, anzeigefertig. */
export interface DbppField {
  /** Stabile Id, zugleich Nachweis der Abdeckung (z.B. "DPP-1.1"). */
  id: string;
  label: string;
  value: string | null;
  availability: DbppAvailability;
  /** Begruendung bei derived/missing/unsupported; sonst undefined. */
  note?: string;
}

/** Eine der sieben aufklappbaren Kategorien (die Lieferkette ist die achte, sie kommt aus provenanceMapper). */
export interface DbppCategory {
  id: string;
  title: string;
  /** Einleitungstext im aufgeklappten Zustand. */
  description: string;
  /** Bezug zum Rechtsrahmen, z.B. "CPR Art. 76 Abs. 1 lit. a". */
  legalBasis: string;
  fields: DbppField[];
}

/** Vollstaendiges View-Model des Produktpasses. */
export interface DbppData {
  /** Kopfbereich: Handelsname bzw. Bauteilbezeichnung. */
  productName: string | null;
  /** Kopfbereich: Bauteilart aus der Planung, z.B. "Boden". */
  productType: string | null;
  /** Eindeutige Produktkennung (EPC/SGTIN) -- Art. 79 CPR / Art. 9 ESPR. */
  uniqueProductId: string | null;
  categories: DbppCategory[];
  /** Zaehlwerk fuer den Abdeckungshinweis. */
  coverage: { filled: number; total: number };
}

/** CO2-Gesamtwert aus dem Oekobilanz-Anwendungsfall. */
export interface DbppCarbonInput {
  /** Summe A1-A5 [kg CO2e]; null = nicht berechenbar. */
  total: number | null;
  /** true, wenn die Summe nicht alle Module enthaelt. */
  isPartial: boolean;
  /** Codes der fehlenden Module, fuer den Teilsummen-Hinweis. */
  missingModules: string[];
}

// ---------------------------------------------------------------------------
// Kleine Helfer (Stil aus deconstructionMapper.ts uebernommen)
// ---------------------------------------------------------------------------

function getValue(binding: SparqlBinding | undefined, key: string): string | undefined {
  const value = binding?.[key]?.value;
  return value && value.trim() !== '' ? value : undefined;
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

/** Erster nicht-leerer Wert aus mehreren Spalten, in Reihenfolge. */
function firstOf(rows: SparqlBinding[], ...keys: string[]): string | null {
  for (const key of keys) {
    const value = firstValue(rows, key);
    if (value) return value;
  }
  return null;
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

/**
 * Zahl + Einheit, wenn die Einheit nicht schon im Wert steht.
 *
 * Wie im deconstructionMapper: deutsche Darstellung (Komma) ohne die
 * nachlaufende ".0", die eine Scheingenauigkeit vortaeuscht. Die IFC liefert
 * zusaetzlich Fliesskommazahlen mit vollem double-Rauschen -- die werden auf
 * drei Nachkommastellen gerundet.
 */
function withUnit(value: string | null, unit: string): string | null {
  if (!value) return null;
  if (new RegExp(`${unit}\\s*$`, 'i').test(value)) return value;

  const asNumber = Number(value);
  const text = Number.isFinite(asNumber)
    ? asNumber.toLocaleString('de-DE', { maximumFractionDigits: 3 })
    : value;

  return `${text} ${unit}`;
}

/** "ja"/"nein" normalisieren; alles andere bleibt stehen. */
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
): DbppField {
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
): DbppField {
  return value
    ? { id, label, value, availability: 'derived', note }
    : { id, label, value: null, availability: 'missing', note };
}

function unsupported(id: string, label: string, note: string): DbppField {
  return { id, label, value: null, availability: 'unsupported', note };
}

// ---------------------------------------------------------------------------
// CO2: die Zahl des Oekobilanz-Anwendungsfalls uebernehmen
// ---------------------------------------------------------------------------

/**
 * Den CO2-Gesamtwert als Merkmal formulieren.
 *
 * Immer ``derived``, auch wenn alle Module vorliegen: der Wert steht nirgends
 * im Pod, sondern wird aus Volumen, Strecken und Hintergrunddaten gerechnet
 * (lcaService.ts). Eine Kennzeichnung als ``available`` wuerde eine
 * Messgroesse vortaeuschen, wo eine Modellrechnung steht.
 */
function carbonField(carbon: DbppCarbonInput | null): DbppField {
  const label = 'CO₂-Bilanz A1–A5 (GWP)';
  const id = 'DPP-6.1';

  if (!carbon || carbon.total === null) {
    return {
      id,
      label,
      value: null,
      availability: 'missing',
      note: 'Die Lebenszyklusmodule konnten aus den vorliegenden Daten nicht berechnet werden. Einzelheiten im Anwendungsfall „CO₂ Bilanzierung“.',
    };
  }

  const formatted = `${carbon.total.toLocaleString('de-DE', {
    maximumFractionDigits: 1,
  })} kg CO₂e`;

  const note = carbon.isPartial
    ? `Teilsumme: berechnet in Anlehnung an EN 15804+A2 (keine Konformität, keine Verifizierung). Nicht enthalten sind ${carbon.missingModules.join(', ')} — siehe Anwendungsfall „CO₂ Bilanzierung“.`
    : 'Berechnet aus den Pod-Daten in Anlehnung an EN 15804+A2 (keine Konformität, keine Verifizierung). Einzelheiten im Anwendungsfall „CO₂ Bilanzierung“.';

  return {
    id,
    label: carbon.isPartial ? `${label} — Teilsumme` : label,
    value: formatted,
    availability: 'derived',
    note,
  };
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

export function mapToDbpp(
  data: ProductDataResult | null,
  product: Product | null,
  carbon: DbppCarbonInput | null = null,
): DbppData {
  const rows = data?.dbpp ?? [];
  const stem = data?.stem?.[0];
  const forest = data?.forest?.[0];

  // --- Identifikation -----------------------------------------------------
  // Die eindeutige Produktkennung ist der EPC. Steht er nicht am Panel,
  // greift die gescannte Id -- beim EPC-Scan ist sie derselbe Wert.
  const panelEpc = firstValue(rows, 'panelEpc');
  const scannedId = product?.id ?? null;
  const uniqueProductId =
    panelEpc ?? (scannedId && /^urn:epc:/i.test(scannedId) ? scannedId : null);

  const artikel = firstValue(rows, 'artikel');
  const elementName = firstValue(rows, 'elementName');
  const elementIfcClass = firstValue(rows, 'elementIfcClass');
  const productName = artikel ?? elementName ?? product?.name ?? null;

  const manufacturer = firstValue(rows, 'bspManufacturer');
  const address = classifyManufacturerAddress(allValues(rows, 'bspAddress'));
  const manufacturerAddress =
    [address.street, [address.postcode, address.city].filter(Boolean).join(' ')]
      .filter((part) => part && part.trim() !== '')
      .join(', ') || null;

  const productionSite = firstValue(rows, 'panelStandort');
  const buyer = firstValue(rows, 'rechnungsempfaenger');
  const productionDate = parseDate(firstValue(rows, 'panelDatum'));

  // --- Leistungserklaerung ------------------------------------------------
  const strengthClass =
    firstOf(rows, 'bspStrengthClass', 'panelFestigkeit') ?? null;
  const productNorm = firstOf(rows, 'panelNorm', 'bspStandard');
  const intendedUse = firstValue(rows, 'bspIntendedUse');
  const notifiedBody = firstValue(rows, 'bspNotifiedBody');
  const conformitySystem = firstValue(rows, 'bspConformity');
  const certificateNumber = firstValue(rows, 'dopZertifikatsnummer');

  // --- Geometrie ----------------------------------------------------------
  const thickness = withUnit(firstValue(rows, 'panelHoehe'), 'mm');
  const width = withUnit(firstValue(rows, 'panelBreite'), 'm');
  const length = withUnit(firstValue(rows, 'panelLaenge'), 'm');
  const volume = withUnit(firstValue(rows, 'panelVolumen'), 'm³');
  const weight = withUnit(firstValue(rows, 'panelGewicht'), 'kg');
  const surface = withUnit(firstValue(rows, 'panelFlaeche'), 'm²');

  // --- Material -----------------------------------------------------------
  const speciesGerman = firstOf(rows, 'panelHolzart', 'dopSpecies', 'certSpecies');
  // Schluessel der Tabelle sind grossgeschrieben ("Fichte") -- wie in den
  // uebrigen Mappern ohne Normalisierung nachschlagen.
  const speciesBotanical =
    product?.woodTypeScientific ??
    (speciesGerman ? (SPECIES_SCIENTIFIC[speciesGerman] ?? null) : null);
  const layers = firstValue(rows, 'panelSchichten');
  const adhesiveName = firstOf(rows, 'adhesiveProductName', 'adhesiveName');
  const adhesiveType = firstOf(rows, 'bspAdhesiveType', 'adhesiveType');
  const adhesiveBase = firstValue(rows, 'adhesiveBaseMaterial');
  const coating = normalizeYesNo(firstValue(rows, 'panelAnstrich'));
  const density = withUnit(firstValue(rows, 'dopDensity'), 'kg/m³');

  // --- Sicherheit / besorgniserregende Stoffe -----------------------------
  // Formaldehydklasse und Stoffangabe teilen sich ein Praedikat, siehe
  // splitHazardousValues im deconstructionMapper.
  const hazardous = splitHazardousValues([
    ...allValues(rows, 'bspHazard'),
    ...allValues(rows, 'dopHazard'),
  ]);
  const fireClass = firstOf(rows, 'bspFireClass', 'panelBrandschutz');
  const charringRate = firstValue(rows, 'bspCharring');
  const adhesiveSafety = firstValue(rows, 'adhesiveSafety');
  const adhesiveLabeling = firstValue(rows, 'adhesiveLabeling');

  // --- Bauphysik / Dauerhaftigkeit ----------------------------------------
  const moisture = firstValue(rows, 'bspMoisture');
  const serviceClass = firstValue(rows, 'bspServiceClass');
  const durability = firstOf(rows, 'bspDurability', 'dopDurability');
  const delamination = firstValue(rows, 'bspDelamination');
  const thermal = firstValue(rows, 'bspThermal');
  const vapour = firstValue(rows, 'bspVapour');
  const airborneSound = firstValue(rows, 'bspAirborneSound');
  const impactSound = firstValue(rows, 'bspImpactSound');

  // --- Herkunft (aus Stamm-, Wald- und Zertifikatsdaten) ------------------
  const forestryOffice =
    getValue(stem, 'forestryOffice') ?? getValue(forest, 'forestryOffice') ?? null;
  const district = getValue(stem, 'district') ?? getValue(forest, 'district') ?? null;
  const harvestDate = parseDate(
    getValue(stem, 'harvestDate') ?? getValue(forest, 'harvestDate') ?? null,
  );
  const fsc = normalizeYesNo(getValue(stem, 'fsc') ?? null);
  const pefc = normalizeYesNo(
    getValue(stem, 'pefc') ?? firstValue(rows, 'panelPefc') ?? null,
  );
  const certifications = [fsc === 'Ja' ? 'FSC' : null, pefc === 'Ja' ? 'PEFC' : null]
    .filter(Boolean)
    .join(', ');
  const provenanceRegion = firstValue(rows, 'certProvenanceName');
  const provenanceNumber = firstValue(rows, 'certProvenanceNumber');
  const originCountry = firstValue(rows, 'certCountry');
  const registerSign = firstValue(rows, 'certRegisterSign');
  const certificateId = firstValue(rows, 'certIdentifier');

  const harvestLat = getValue(stem, 'lat');
  const harvestLong = getValue(stem, 'long');
  const harvestCoordinates =
    harvestLat && harvestLong
      ? `${Number(harvestLat).toFixed(5)}° N, ${Number(harvestLong).toFixed(5)}° E`
      : null;

  // --- Verortung im Gebaeude ----------------------------------------------
  const ifcGlobalId = firstValue(rows, 'elementIfcId');
  const storey = firstValue(rows, 'elementStorey');
  const projectName = firstValue(rows, 'projectName');
  const projectNumber = firstValue(rows, 'projectNumber');

  const categories: DbppCategory[] = [
    {
      id: 'identification',
      // "Hersteller" statt "Akteure" (Projektpartner, 17.09.2026): die
      // Kategorie identifiziert das Bauteil und seinen Hersteller -- die
      // uebrigen Akteure stehen in der Lieferkette.
      title: 'Produkt- und Herstelleridentifikation',
      description:
        'Die Kennungen, über die das Bauteil und sein Hersteller eindeutig ansprechbar sind. Die Bauprodukteverordnung verlangt eine eindeutige Produktkennung; die Ökodesign-Verordnung verlangt zusätzlich Kennungen für Wirtschaftsakteur, Betriebsstätte und Register.',
      legalBasis: 'CPR Art. 79 Abs. 1 · ESPR Art. 9',
      fields: [
        field(
          'DPP-1.1',
          'Eindeutige Produktkennung',
          uniqueProductId,
          'Diesem Bauteil ist kein GS1-Ident (SGTIN/LGTIN) zugeordnet.',
        ),
        field('DPP-1.2', 'Artikel-/Typenbezeichnung', artikel),
        field('DPP-1.3', 'Hersteller', manufacturer),
        field('DPP-1.4', 'Herstelleranschrift', manufacturerAddress),
        field('DPP-1.5', 'Produktionsstandort', productionSite),
        field('DPP-1.6', 'Produktionsdatum', productionDate),
        field('DPP-1.7', 'Erwerber (Rechnungsempfänger)', buyer),
        field(
          'DPP-1.8',
          'Kennung in der Ausführungsplanung (IFC GlobalId)',
          ifcGlobalId,
          'Zu diesem Bauteil liegt keine Ausführungsplanung im Datenraum.',
        ),
        unsupported(
          'DPP-1.9',
          'Betriebsstättenkennung',
          'Die ESPR verlangt eine eigene Kennung der Betriebsstätte nach anerkannter Norm (z. B. GS1 GLN). Der Datenraum führt Betriebsstätten bislang nur als Anschrift, nicht als normierte Kennung.',
        ),
        unsupported(
          'DPP-1.10',
          'Registrierung im EU-Produktpass-Register',
          'Das zentrale EU-Register für digitale Produktpässe soll ab dem 19.07.2026 in Betrieb gehen. Dieser Demonstrator ist dort nicht registriert und trägt deshalb auch keine Registerkennung.',
        ),
      ],
    },
    {
      id: 'performance',
      title: 'Leistungserklärung',
      description:
        'Die Angaben, die die Leistungs- und Konformitätserklärung nach Artikel 15 der Bauprodukteverordnung trägt: harmonisierte technische Spezifikation, erklärte Leistung, Verwendungszweck und die notifizierte Stelle, die das System der Konformitätsbewertung begleitet.',
      legalBasis: 'CPR Art. 76 Abs. 1 lit. a i. V. m. Art. 15',
      fields: [
        field('DPP-2.1', 'Produktnorm', productNorm),
        field('DPP-2.2', 'Festigkeitsklasse', strengthClass),
        field('DPP-2.3', 'Vorgesehener Verwendungszweck', intendedUse),
        field('DPP-2.4', 'Notifizierte Stelle', notifiedBody),
        field('DPP-2.5', 'System der Konformitätsbewertung', conformitySystem),
        field(
          'DPP-2.6',
          'Zertifikatsnummer (Vorprodukt Schnittholz)',
          certificateNumber,
        ),
        field('DPP-2.7', 'Dicke', thickness),
        field('DPP-2.8', 'Breite', width),
        field('DPP-2.9', 'Länge', length),
        field('DPP-2.10', 'Nettovolumen', volume),
        field('DPP-2.11', 'Nettogewicht', weight),
        field('DPP-2.12', 'Oberfläche (alle Seiten)', surface),
      ],
    },
    {
      id: 'material',
      title: 'Materialzusammensetzung',
      description:
        'Woraus das Bauteil besteht. Für Bauprodukte ist die Materialzusammensetzung eines der Kernfelder des künftigen Produktpasses — bei Brettsperrholz sind das die Holzart, der Schichtaufbau und der Klebstoff.',
      legalBasis: 'CPR Art. 76 Abs. 1 lit. b · ESPR Anhang III',
      fields: [
        field('DPP-3.1', 'Holzart', speciesGerman),
        derived(
          'DPP-3.2',
          'Holzart (botanisch)',
          speciesBotanical,
          'Aus der deutschen Holzartbezeichnung übersetzt (Nachschlagetabelle SPECIES_SCIENTIFIC).',
        ),
        field('DPP-3.3', 'Anzahl der Schichten', layers),
        field('DPP-3.4', 'Klebstoff (Handelsname)', adhesiveName),
        field('DPP-3.5', 'Klebstoffart', adhesiveType),
        field('DPP-3.6', 'Klebstoff-Basismaterial', adhesiveBase),
        field('DPP-3.7', 'Beschichtung/Anstrich vorhanden', coating),
        field('DPP-3.8', 'Rohdichte', density),
        unsupported(
          'DPP-3.9',
          'Rezyklatanteil',
          'Das Bauteil besteht aus Primärrohstoff (Frischholz); ein Rezyklatanteil ist im Datenmodell nicht vorgesehen, weil er für diese Produktkette derzeit nicht auftritt.',
        ),
      ],
    },
    {
      id: 'safety',
      title: 'Sicherheit und besorgniserregende Stoffe',
      description:
        'Die Bauprodukteverordnung verweist für gefährliche Stoffe ausdrücklich auf die REACH-Verordnung. Für Brettsperrholz sind das vor allem die Formaldehydemissionsklasse aus der Verklebung und das Brandverhalten.',
      legalBasis: 'CPR Art. 76 Abs. 1 lit. a i. V. m. REACH Art. 31/33',
      fields: [
        field('DPP-4.1', 'Formaldehydemissionsklasse', hazardous.emissionClass),
        field(
          'DPP-4.2',
          'Gefährliche Inhaltsstoffe',
          hazardous.substances,
          'Die Leistungserklärung enthält keine Angabe zu gefährlichen Inhaltsstoffen.',
        ),
        field('DPP-4.3', 'Brandverhaltensklasse', fireClass),
        field('DPP-4.4', 'Abbrandrate', charringRate),
        field('DPP-4.5', 'Sicherheitshinweis Klebstoff', adhesiveSafety),
        field('DPP-4.6', 'Kennzeichnung Klebstoff', adhesiveLabeling),
      ],
    },
    {
      id: 'physics',
      title: 'Bauphysik und Dauerhaftigkeit',
      description:
        'Wärmeschutz, Feuchte, Schallschutz und Dauerhaftigkeit — die Leistungsmerkmale, die über die Eignung des Bauteils im Gebäude und über seine Lebensdauer entscheiden.',
      legalBasis: 'CPR Anhang I (Grundanforderungen an Bauwerke)',
      fields: [
        field('DPP-5.1', 'Holzfeuchte im Lieferzustand', moisture),
        field('DPP-5.2', 'Nutzungsklasse', serviceClass),
        field('DPP-5.3', 'Dauerhaftigkeitsklasse', durability),
        field('DPP-5.4', 'Delaminierungsbeständigkeit', delamination),
        field('DPP-5.5', 'Wärmedurchgangskoeffizient', thermal),
        field('DPP-5.6', 'Wasserdampfdiffusionswiderstand', vapour),
        field('DPP-5.7', 'Luftschalldämmung', airborneSound),
        field('DPP-5.8', 'Trittschalldämmung', impactSound),
      ],
    },
    {
      id: 'environment',
      title: 'Umweltwirkung und Herkunft',
      description:
        'Der CO₂-Fußabdruck und die Herkunft des Holzes. Die Bauprodukteverordnung führt Umweltindikatoren in Anhang II ein; die Entwaldungsverordnung (EUDR) verlangt darüber hinaus die geografische Herkunft des Rohstoffs.',
      legalBasis: 'CPR Anhang II · EUDR (EU) 2023/1115',
      fields: [
        carbonField(carbon),
        field('DPP-6.2', 'Forstamt', forestryOffice),
        field('DPP-6.3', 'Revier', district),
        field('DPP-6.4', 'Einschlagdatum', harvestDate),
        field(
          'DPP-6.5',
          'Erntekoordinaten',
          harvestCoordinates,
          'Zu diesem Bauteil sind keine Erntekoordinaten hinterlegt — die Rückverfolgung endet vor dem Fällvorgang.',
        ),
        field('DPP-6.6', 'Herkunftsgebiet', provenanceRegion),
        field('DPP-6.7', 'Herkunftsgebiets-Nummer', provenanceNumber),
        field('DPP-6.8', 'Ursprungsland des Ausgangsmaterials', originCountry),
        field('DPP-6.9', 'Registerzeichen', registerSign),
        field('DPP-6.10', 'Stammzertifikat-Nummer', certificateId),
        field(
          'DPP-6.11',
          'Waldzertifizierung',
          certifications || null,
          'Für dieses Bauteil ist weder eine FSC- noch eine PEFC-Zertifizierung hinterlegt.',
        ),
      ],
    },
    {
      id: 'lifecycle',
      // "Einbau" statt "Verbau" (Projektpartner, 17.09.2026) -- der Begriff
      // der Bauprodukteverordnung und des Awf "Dokumentation".
      title: 'Einbau, Rückbau und Lebensende',
      description:
        'Wo das Bauteil eingebaut ist und was am Ende seiner Nutzung mit ihm geschieht. Die Zirkularität ist ein erklärtes Ziel beider Verordnungen; die Angaben dazu vertieft der Anwendungsfall „Rückbaubarkeit“.',
      legalBasis: 'CPR Art. 76 · ESPR Art. 5 Abs. 1 (Zirkularität)',
      fields: [
        field('DPP-7.1', 'Bauteilart', elementIfcClass ?? elementName),
        field(
          'DPP-7.2',
          'Geschoss',
          storey,
          'Zu diesem Bauteil liegt keine Ausführungsplanung im Datenraum.',
        ),
        field('DPP-7.3', 'Projekt', projectName),
        field('DPP-7.4', 'Projektnummer', projectNumber),
        derived(
          'DPP-7.5',
          'Wiederverwendbarkeit',
          volume ? 'Sortenrein rückbaubar (Vollholz, verklebt)' : null,
          'Abgeleitet aus dem Materialaufbau: Brettsperrholz ist sortenreines Vollholz ohne Fremdstoffe in der Fläche. Einzelheiten im Anwendungsfall „Rückbaubarkeit“.',
        ),
        unsupported(
          'DPP-7.6',
          'Verbindungstechnik',
          'Die Verbindungsmittel zwischen Bauteil und Tragwerk werden im Datenraum nicht erfasst — sie entstehen erst auf der Baustelle und sind in keiner der hochgeladenen Quellen enthalten.',
        ),
        unsupported(
          'DPP-7.7',
          'Datenträger wesentlicher Bauteile',
          'Die Bauprodukteverordnung verlangt, dass der Pass die Datenträger wesentlicher Bauteile mitführt, sofern diese selbst einen Produktpass haben. Solche Pässe existieren für die Vorprodukte noch nicht; ihre GS1-Idente sind über die Lieferkette dennoch nachvollziehbar.',
        ),
      ],
    },
  ];

  const all = categories.flatMap((category) => category.fields);

  return {
    productName,
    productType:
      elementIfcClass ?? (product?.productType === 'finished' ? 'BSP-Platte' : null),
    uniqueProductId,
    categories,
    coverage: {
      filled: all.filter((f) => f.value !== null).length,
      total: all.length,
    },
  };
}
