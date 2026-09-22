/**
 * Adapter fuer den Anwendungsfall "Rueckbaubarkeit".
 *
 * Uebersetzt die rohen SPARQL-Ergebnisse in genau die Informations-
 * anforderungen der Informationsbedarfstiefe (I-1, I-5/I-6, I-15, I-29..I-56)
 * und ordnet sie den sechs Kategorien der Visualisierung zu. Reine Funktion,
 * kein I/O -- der Dokumentenabruf passiert ausserhalb.
 *
 * Vier Eigenheiten der Datenlage praegen diese Datei:
 *
 * 1. NICHT alle Merkmale lassen sich aus den Beispieldateien befuellen. Das ist
 *    kein Mangel der Umsetzung, sondern eine Aussage des Anwendungsfalls
 *    ("auch wichtig zu zeigen!", Visualisierung S. 1). Fehlende Merkmale werden
 *    deshalb nicht verschwiegen, sondern mit einer Begruendung ausgewiesen --
 *    siehe ``availability`` und ``note`` an DeconstructionField.
 * 2. Formaldehydklasse (I-38) und gefaehrliche Inhaltsstoffe (I-39) liegen im
 *    RML-Mapping auf DEMSELBEN Praedikat (tc:hazardousSubstanceEmission) und
 *    kommen als ununterscheidbarer Beutel zurueck; splitHazardousValues()
 *    sortiert sie anhand der Emissionsklassen-Notation (E0/E1/E2).
 * 3. Die Herstelleranschrift (I-42..I-45) steht -- wie beim Herkunftsnachweis
 *    die Transportadressen -- vierfach auf tc:manufacturerAddress. Getrennt
 *    wird ueber PLZ-, Land- und Strassenerkennung.
 * 4. Die Materialherkunft (I-37) ist nirgends gespeichert, sondern laut
 *    Beschreibung Kap. 6 aus der Holzzertifizierung ABGELEITET. Diese Regel
 *    steht als einzige Ableitung in deriveMaterialOrigin().
 */

import type { Product } from '../types';
import type { ProductDataResult, SparqlBinding } from './sparqlService';
import { SPECIES_SCIENTIFIC } from '../config/solidPods';

/**
 * Warum ein Merkmal (nicht) angezeigt werden kann.
 *
 * ``available``  -- Wert aus dem Datenraum.
 * ``derived``    -- aus einem anderen Merkmal abgeleitet (Regel in ``note``).
 * ``missing``    -- im Datenmodell vorgesehen, in DIESEN Daten nicht befuellt.
 * ``unsupported``-- im Datenmodell (noch) gar nicht vorgesehen.
 *
 * Die letzten beiden bewusst getrennt: "die Beispieldatei sagt dazu nichts"
 * und "das kann der Datenraum noch nicht" sind fuer die Bewertung des
 * Anwendungsfalls zwei sehr verschiedene Aussagen.
 */
export type FieldAvailability = 'available' | 'derived' | 'missing' | 'unsupported';

/** Ein Merkmal der Informationsbedarfstiefe, anzeigefertig. */
export interface DeconstructionField {
  /** Id der Informationsanforderung, z.B. "I-32" -- Nachweis der Abdeckung. */
  id: string;
  label: string;
  value: string | null;
  availability: FieldAvailability;
  /** Begruendung bei derived/missing/unsupported; sonst undefined. */
  note?: string;
}

/** Eine der sechs aufklappbaren Kategorien der Visualisierung. */
export interface DeconstructionCategory {
  id: string;
  title: string;
  /** Einleitungstext im aufgeklappten Zustand. */
  description: string;
  fields: DeconstructionField[];
}

/** Vollstaendiges View-Model der Rueckbaubarkeit. */
export interface DeconstructionData {
  /** Kopfbereich: Bauteilbezeichnung (I-1). */
  componentName: string | null;
  /** Kopfbereich: Kurzform fuer die Unterzeile. */
  componentType: string | null;
  categories: DeconstructionCategory[];
  /** Zaehlwerk fuer den Abdeckungshinweis. */
  coverage: { filled: number; total: number };
}

// ---------------------------------------------------------------------------
// Kleine Helfer (Stil aus provenanceMapper.ts uebernommen)
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

/** Vierstellige Jahreszahl aus einem Datum. */
function yearOf(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{4})/);
  return match ? match[1] : null;
}

/**
 * Zahl + Einheit, wenn die Einheit nicht schon im Wert steht.
 *
 * Die ERP-Tabelle liefert Zahlen als xsd:decimal; ueber SPARQL kommen sie als
 * "150.0" oder "11.8" zurueck. Angezeigt wird deutsch (Komma) und ohne die
 * nachlaufende ".0", die eine Scheingenauigkeit vortaeuscht.
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

// --- Feld-Konstruktoren, damit die Kategorien unten lesbar bleiben ----------

function field(id: string, label: string, value: string | null, note?: string): DeconstructionField {
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
): DeconstructionField {
  return value
    ? { id, label, value, availability: 'derived', note }
    : { id, label, value: null, availability: 'missing', note };
}

function unsupported(id: string, label: string, note: string): DeconstructionField {
  return { id, label, value: null, availability: 'unsupported', note };
}

// ---------------------------------------------------------------------------
// I-38 / I-39: einen Beutel auf zwei Merkmale aufteilen
// ---------------------------------------------------------------------------

const EMISSION_CLASS = /^(E\s?[0-2]|E1\b|K\s?\d)/i;

/**
 * Formaldehydemissionsklasse von den gefaehrlichen Inhaltsstoffen trennen.
 *
 * Beide stehen im Mapping auf tc:hazardousSubstanceEmission. Die
 * Emissionsklasse ist eine kurze Notation ("E1"), die Stoffangabe ein Satz
 * ("keine (NPD)") -- daran laesst sich sicher unterscheiden.
 */
export function splitHazardousValues(values: string[]): {
  emissionClass: string | null;
  substances: string | null;
} {
  let emissionClass: string | null = null;
  const rest: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    if (!emissionClass && EMISSION_CLASS.test(value) && value.length <= 6) {
      emissionClass = value;
    } else {
      rest.push(value);
    }
  }

  return { emissionClass, substances: rest.length > 0 ? rest.join('; ') : null };
}

// ---------------------------------------------------------------------------
// I-42..I-45: Herstelleranschrift aus dem Adressbeutel
// ---------------------------------------------------------------------------

const POSTCODE_ONLY = /^\d{4,5}$/;
const POSTCODE_CITY = /^\d{4,5}\s+\S/;
const STREET = /(str|straße|strasse|weg|allee|platz|gasse|ring|damm|sägewerk)\.?\s*\d*/i;
const COUNTRIES = /^(deutschland|österreich|schweiz|germany|austria|france|italien|polen)$/i;

export interface ManufacturerAddress {
  street: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
}

/**
 * Vier ununterscheidbare Adressliterale nach Strasse / PLZ / Ort / Land
 * sortieren. Bewusst exportiert, damit die Heuristik testbar bleibt.
 *
 *   - bekannter Landesname          -> Land
 *   - reine 4-5-stellige Zahl       -> PLZ
 *   - "12345 Ort"                   -> PLZ + Ort zusammen
 *   - Strassen-Stichwort            -> Strasse
 *   - sonst (uebrig)                -> Ort
 */
export function classifyManufacturerAddress(values: string[]): ManufacturerAddress {
  const parts: ManufacturerAddress = {
    street: null,
    postcode: null,
    city: null,
    country: null,
  };
  const leftovers: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;

    if (COUNTRIES.test(value) && !parts.country) {
      parts.country = value;
    } else if (POSTCODE_ONLY.test(value) && !parts.postcode) {
      parts.postcode = value;
    } else if (POSTCODE_CITY.test(value) && !parts.postcode) {
      const [code, ...city] = value.split(/\s+/);
      parts.postcode = code;
      if (!parts.city) parts.city = city.join(' ');
    } else if (STREET.test(value) && !parts.street) {
      parts.street = value;
    } else {
      leftovers.push(value);
    }
  }

  for (const value of leftovers) {
    if (!parts.city) parts.city = value;
    else if (!parts.street) parts.street = value;
  }

  return parts;
}

// ---------------------------------------------------------------------------
// I-37: Materialherkunft ableiten (Beschreibung Kap. 6, Uebersetzungstabelle)
// ---------------------------------------------------------------------------

/**
 * Materialherkunft aus der Holzzertifizierung ableiten.
 *
 *   "ja"                    -> Primärrohstoff, erneuerbar, zertifiziert
 *   "nein" oder unbefuellt  -> Primärrohstoff, erneuerbar
 *
 * Holz ist in jedem Fall ein nachwachsender Primaerrohstoff -- deshalb liefert
 * auch der unbefuellte Fall einen Wert und nicht ``null``.
 */
export function deriveMaterialOrigin(certification: string | null): string {
  const certified = !!certification && /^(ja|yes|true|1|pefc|fsc)/i.test(certification.trim());
  return certified
    ? 'Primärrohstoff, erneuerbar, zertifiziert'
    : 'Primärrohstoff, erneuerbar';
}

/** "ja"/"nein" aus einem Zertifizierungsfeld normalisieren. */
function normalizeCertification(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  if (/^(ja|yes|true|1)$/i.test(text)) return 'Ja';
  if (/^(nein|no|false|0)$/i.test(text)) return 'Nein';
  return text;
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

export function mapToDeconstruction(
  data: ProductDataResult | null,
  product: Product | null,
): DeconstructionData {
  const rows = data?.deconstruction ?? [];
  const bspWerk = data?.bspWerk?.[0];
  const declarations = data?.declarations ?? [];

  // --- Allgemeine Informationen (I-1, I-29..I-31) -------------------------
  // I-1 ist der HANDELSNAME der Platte (M-1077), nicht der Dokumenttitel. Die
  // Leistungserklaerung fuehrt ihn als "eindeutigen Kenncode des Produkttyps"
  // (tc:typeNumber, z.B. "X-LAM L-150/5s"); tc:title traegt dagegen den Titel
  // des Dokuments selbst ("Leistungserklärung Nr. ..."). Ohne diese
  // Unterscheidung stuende im Kopf der Ansicht der Dokumentname statt des
  // Bauteils. Die ERP-Artikelbezeichnung ist die naechstbeste Quelle.
  const typeNumber = firstValue(rows, 'dopTypeNumber') ?? firstValue(declarations, 'typeNumber');
  const articleName = firstValue(rows, 'artikel');

  const tradeName = typeNumber ?? articleName ?? orNull(product?.name);

  /** Titel des Dokuments -- nur als Untertitel, nicht als Bauteilname. */
  const documentTitle = firstValue(rows, 'dopTitle') ?? firstValue(declarations, 'title');

  // Festigkeitsklasse: das ERP fuehrt sie als Materialfestigkeit; die
  // Leistungserklaerung nennt dieselbe Klasse noch einmal und dient als
  // Rueckfallebene, wenn die ERP-Tabelle das Feld leer laesst.
  const strengthClass =
    firstValue(rows, 'festigkeit') ??
    firstValue(rows, 'dopStrengthClass') ??
    firstValue(declarations, 'strengthClass');

  const productionDate =
    parseDate(firstValue(rows, 'produktionsdatum')) ??
    parseDate(getValue(bspWerk, 'productionDate'));

  // I-31: Einbaujahr ist nirgends erfasst. Da BSP auftragsbezogen gefertigt
  // wird, entspricht es laut Informationsbedarfstiefe dem Produktionsjahr.
  const installationYear = yearOf(productionDate);

  // --- Abmessungen (I-32..I-36) -------------------------------------------
  const quantity =
    firstValue(rows, 'menge') ??
    orNull(getValue(bspWerk, 'nettoVolumen')) ??
    orNull(getValue(bspWerk, 'bruttoVolumen'));
  const thickness = firstValue(rows, 'hoehe');
  const width = firstValue(rows, 'breite');
  const length = firstValue(rows, 'laenge');
  const layers = firstValue(rows, 'schichten') ?? orNull(getValue(bspWerk, 'anzahlSchichten'));

  // --- Materialherkunft (I-37, I-5/I-6, I-15, I-38, I-39) -----------------
  const certificationRaw =
    firstValue(rows, 'pefc') ??
    (product?.certifications?.length ? product.certifications.join(', ') : null);
  const certification = normalizeCertification(certificationRaw);

  // Die Holzart steht an zwei Stellen: in der Leistungserklaerung (tc:holzart)
  // und am ERP-Panel (tc:holzart_v3). Beide werden abgefragt, damit das Merkmal
  // nicht ausfaellt, wenn nur eine der beiden Quellen hochgeladen wurde.
  const speciesGerman =
    orNull(product?.woodType) ??
    firstValue(rows, 'dopHolzart') ??
    firstValue(rows, 'panelHolzart') ??
    firstValue(declarations, 'holzart');
  const speciesBotanical =
    orNull(product?.woodTypeScientific) ??
    (speciesGerman ? orNull(SPECIES_SCIENTIFIC[speciesGerman]) : null);

  const hazardous = splitHazardousValues(allValues(rows, 'dopHazard'));

  // --- Hersteller (I-40..I-48) --------------------------------------------
  const manufacturerName =
    firstValue(rows, 'dopManufacturer') ?? firstValue(declarations, 'manufacturer');
  const address = classifyManufacturerAddress(allValues(rows, 'dopAddress'));
  const phone = firstValue(rows, 'dopPhone');
  const fax = firstValue(rows, 'dopFax');
  const website = firstValue(rows, 'dopWebsite');

  // --- Stofflichkeit und Verbindungsmittel (I-49..I-51) -------------------
  const adhesiveName = firstValue(rows, 'adhesiveName');
  const adhesiveLabeling = firstValue(rows, 'adhesiveLabeling');
  const coating = firstValue(rows, 'anstrich');

  // --- Materialverwertung (I-52..I-54) ------------------------------------
  const intendedUse =
    firstValue(rows, 'dopIntendedUse') ?? firstValue(declarations, 'intendedUse');

  const categories: DeconstructionCategory[] = [
    // Kategorie "Allgemeine Informationen" der Informationsbedarfstiefe. In der
    // Visualisierung steht der Handelsname (I-1) bereits in der Bauteilkarte
    // ueber den Kategorien; die uebrigen allgemeinen Merkmale brauchen aber
    // trotzdem einen Platz, sonst fielen I-29..I-31 aus dem Awf heraus.
    {
      id: 'general',
      title: 'Allgemeine Informationen',
      description:
        'Produktkennzeichnung, Festigkeit und zeitliche Einordnung der BSP-Platte im Bauwerk.',
      fields: [
        field('I-1', 'Handelsname', tradeName),
        field('I-29', 'Festigkeitsklasse', strengthClass),
        field('I-30', 'Produktionsdatum', productionDate),
        derived(
          'I-31',
          'Einbaujahr',
          installationYear,
          'Nicht erfasst; da BSP auftragsbezogen gefertigt wird, entspricht das Einbaujahr dem Produktionsjahr.',
        ),
      ],
    },
    {
      id: 'manufacturer',
      title: 'Hersteller',
      description:
        'Angaben zum Holzwerkstoffproduzenten für die Rücknahme und Rückfragen beim Rückbau.',
      fields: [
        field('I-40', 'Artikelbezeichnung', articleName),
        field('I-41', 'Hersteller', manufacturerName),
        field('I-42', 'Straße', address.street),
        field('I-43', 'PLZ', address.postcode),
        field('I-44', 'Stadt', address.city),
        field('I-45', 'Land', address.country),
        field('I-46', 'Telefon', phone),
        field('I-47', 'Fax', fax),
        field('I-48', 'Website', website),
      ],
    },
    {
      id: 'dimensions',
      title: 'Gewicht & Abmessungen',
      description:
        'Maße und Schichtaufbau der BSP-Platte — Grundlage für Demontageplanung, Rückbau und Transport.',
      fields: [
        // Einheiten laut ERP-Tabelle: Volumen in m³, Staerke in mm, Breite und
        // Laenge in m. Die Leistungserklaerung bringt sie als Text schon mit
        // ("150 mm"); withUnit erkennt das und haengt nichts doppelt an.
        field('I-32', 'Menge', withUnit(quantity, 'm³')),
        field('I-33', 'Höhe / Stärke', withUnit(thickness, 'mm')),
        field('I-34', 'Breite', withUnit(width, 'm')),
        field('I-35', 'Länge', withUnit(length, 'm')),
        field('I-36', 'Anzahl der Schichten', layers),
      ],
    },
    {
      id: 'origin',
      title: 'Materialherkunft',
      description:
        'Herkunft und Zusammensetzung des verbauten Holzes sowie Angaben zu Emissionen und Schadstoffen.',
      fields: [
        derived(
          'I-37',
          'Materialherkunft',
          deriveMaterialOrigin(certification),
          certification
            ? `Abgeleitet aus der Holzzertifizierung „${certification}".`
            : 'Ohne hinterlegte Zertifizierung gilt Holz als erneuerbarer Primärrohstoff.',
        ),
        field('I-15', 'Holzzertifizierung', certification),
        field('I-5', 'Holzart (deutsch)', speciesGerman),
        field('I-6', 'Holzart (botanisch)', speciesBotanical),
        field('I-38', 'Formaldehydemissionsklasse', hazardous.emissionClass),
        field('I-39', 'Gefährliche Inhaltsstoffe', hazardous.substances),
      ],
    },
    {
      id: 'material',
      title: 'Stofflichkeit & Leim',
      description:
        'Eingesetzter Klebstoff und Oberflächenbehandlung — entscheidend dafür, ob das Holz stofflich verwertet werden darf.',
      fields: [
        field('I-49', 'Produktbezeichnung Klebstoff', adhesiveName),
        field('I-50', 'Schadstoffe Klebstoff', adhesiveLabeling),
        field(
          'I-51',
          'Anstrich vorhanden',
          normalizeCertification(coating) ?? coating,
          'Der Hersteller hat zur Oberflächenbehandlung keine Angabe übermittelt.',
        ),
      ],
    },
    {
      id: 'recycling',
      title: 'Materialverwertung',
      description:
        'Informationen zum Recyclingpotenzial und zur Wiederverwendbarkeit des Produkts sowie zur Entsorgung.',
      fields: [
        field('I-52', 'Verwendungszweck', intendedUse),
        unsupported(
          'I-53',
          'Materialverwertung(-spotenzial)',
          'Erfordert eine Umweltproduktdeklaration (EPD); für dieses Bauteil liegt keine vor.',
        ),
        // I-54: laut Informationsbedarfstiefe im Demonstrator fest "ja". Das
        // ist eine Festlegung des Anwendungsfalls, keine Messung -- deshalb
        // als abgeleitet gekennzeichnet und nicht als Datenraum-Wert.
        derived(
          'I-54',
          'Herstellerrücknahme möglich',
          'Ja',
          'Der Hersteller nimmt Bauteile grundsätzlich zurück; eine bauteilbezogene Zusage liegt nicht vor.',
        ),
      ],
    },
    {
      id: 'joints',
      title: 'Verbindungstechnik & Demontierbarkeit',
      description:
        'Art der Verbindungsmittel zu angrenzenden Bauteilen und Aufwand für eine zerstörungsfreie Demontage. Die Verklebung der Lamellen innerhalb der Platte steht unter „Stofflichkeit & Leim".',
      fields: [
        // Haeufige Rueckfrage: "Wir haben doch das Klebstoff-Datenblatt
        // hochgeladen?" -- Ja, aber der Klebstoff verbindet die LAMELLEN
        // INNERHALB der Platte (I-49/I-50, Kategorie "Stofflichkeit & Leim").
        // Hier geht es um die Verbindung der Platte MIT ANDEREN BAUTEILEN im
        // Bauwerk (Schrauben, Winkel, Duebel) -- die entscheidet ueber die
        // zerstoerungsfreie Demontage. Dafuer gibt es keine Quelle: die
        // Informationsbedarfstiefe fuehrt beide Merkmale als "aktuell nicht
        // vorhanden" und ordnet sie der Klasse Brettsperrholz zu, nicht dem
        // Klebstoff.
        unsupported(
          'I-55',
          'Verbindungsart',
          'Betrifft die Verbindung zu angrenzenden Bauteilen (z. B. geschraubt, geklebt, etc.) — nicht die Verklebung der Lamellen. Angaben des Verbindungsmittelherstellers liegen nicht vor.',
        ),
        unsupported(
          'I-56',
          'Demontierbarkeit',
          'Bewertung setzt die Verbindungsart voraus; diese ist nicht dokumentiert.',
        ),
      ],
    },
  ];

  const all = categories.flatMap((c) => c.fields);

  return {
    componentName: tradeName,
    // Unterzeile der Bauteilkarte: der Titel der Leistungserklaerung belegt,
    // WOHER die Angaben stammen -- als Bauteilname waere er dagegen falsch.
    componentType: documentTitle ?? (product?.productType === 'finished' ? 'BSP-Platte' : null),
    categories,
    coverage: {
      filled: all.filter((f) => f.value !== null).length,
      total: all.length,
    },
  };
}
