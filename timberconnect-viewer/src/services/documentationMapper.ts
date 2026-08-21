/**
 * Adapter fuer den Anwendungsfall "Dokumentation".
 *
 * Uebersetzt die rohen SPARQL-Ergebnisse in die Informationsanforderungen der
 * Informationsbedarfstiefe (I-1..I-89) und ordnet sie den VIER Kategorien der
 * Visualisierung zu: Verortung im Gebaeude, Gewicht und Abmessungen, Einbau,
 * Hersteller. Reine Funktion, kein I/O -- der Dokumentenabruf passiert
 * ausserhalb (DocumentDownloadSection).
 *
 * Der Anwendungsfall ist die "produktbegleitende Dokumentation des Bauteils
 * bis zum Einbau im Gebaeude". Er teilt sich den Grossteil seiner Merkmale
 * mit der Rueckbaubarkeit (Handelsname, Holzart, Abmessungen, Hersteller-
 * anschrift) und liest sie aus DERSELBEN Quelle: data.deconstruction. Die
 * Helfer dafuer werden aus deconstructionMapper importiert statt kopiert --
 * zwei Kopien der Adressheuristik liefen unweigerlich auseinander.
 *
 * Vier Eigenheiten der Datenlage praegen diese Datei:
 *
 * 1. NEU gegenueber der Rueckbaubarkeit ist die Kategorie "Verortung im
 *    Gebaeude" (I-79..I-87). Sie stammt aus der Ausfuehrungsplanung (IFC,
 *    M-1168..M-1180) und kommt ueber tc:BuildingPart -- einen eigenen Knoten
 *    neben tc:Panel, weil Planung und Fertigung zwei Aussagen ueber dasselbe
 *    Bauteil sind (siehe mappings/ifc_planung.rml.ttl).
 * 2. Die Beispiel-IFC (Revit-Export) traegt NICHT alle Planungsmerkmale:
 *    Bauabschnitt, Sichtqualitaet, Abbund/BVN und Produktionsliste fehlen,
 *    weil der Export projektspezifische Parameter nicht mitschreibt. Sie
 *    werden als Luecke mit Begruendung ausgewiesen, nicht verschwiegen --
 *    "es koennen aktuell nicht alle Merkmale befuellt werden (auch wichtig zu
 *    zeigen!)", Visualisierung S. 1.
 * 3. Die Kategorie "Einbau" ist laut Vorgabe AKTUELL NICHT BEFUELLBAR. Sie
 *    erscheint trotzdem -- leer waere sie eine unbeantwortete Frage, mit
 *    Begruendung ist sie eine Aussage ueber die Grenzen des Datenraums.
 * 4. I-14 (Bundesland) und I-62 (CO2) sind laut Tabelle ABGELEITETE Merkmale:
 *    das Bundesland aus den Erntekoordinaten, die CO2-Bilanz aus dem
 *    gleichnamigen Anwendungsfall. Beide brauchen Dienste, die dieser reine
 *    Mapper nicht aufrufen darf (Geocoding bzw. Distanzaufloesung) -- sie
 *    verweisen deshalb auf den jeweiligen Anwendungsfall.
 */

import type { Product } from '../types';
import type { ProductDataResult, SparqlBinding } from './sparqlService';
import { SPECIES_SCIENTIFIC } from '../config/solidPods';
import { classifyManufacturerAddress } from './deconstructionMapper';

/**
 * Warum ein Merkmal (nicht) angezeigt werden kann -- identisch zur
 * Rueckbaubarkeit, damit beide Ansichten dieselbe Sprache sprechen.
 *
 * ``available``  -- Wert aus dem Datenraum.
 * ``derived``    -- aus einem anderen Merkmal abgeleitet (Regel in ``note``).
 * ``missing``    -- im Datenmodell vorgesehen, in DIESEN Daten nicht befuellt.
 * ``unsupported``-- im Datenmodell (noch) gar nicht vorgesehen.
 */
export type DocFieldAvailability = 'available' | 'derived' | 'missing' | 'unsupported';

/** Ein Merkmal der Informationsbedarfstiefe, anzeigefertig. */
export interface DocumentationField {
  /** Id der Informationsanforderung, z.B. "I-79" -- Nachweis der Abdeckung. */
  id: string;
  label: string;
  value: string | null;
  availability: DocFieldAvailability;
  /** Begruendung bei derived/missing/unsupported; sonst undefined. */
  note?: string;
}

/** Eine der vier aufklappbaren Kategorien der Visualisierung. */
export interface DocumentationCategory {
  id: string;
  title: string;
  /** Einleitungstext im aufgeklappten Zustand. */
  description: string;
  fields: DocumentationField[];
}

/** Vollstaendiges View-Model der Dokumentation. */
export interface DocumentationData {
  /** Kopfbereich: Bauteilbezeichnung (I-1). */
  componentName: string | null;
  /** Kopfbereich: Bauteilart aus der Planung, z.B. "Boden" (M-1177). */
  componentType: string | null;
  /** Allgemeine Angaben ueber den Kategorien (Visualisierung S. 1). */
  general: DocumentationField[];
  categories: DocumentationCategory[];
  /** Zaehlwerk fuer den Abdeckungshinweis. */
  coverage: { filled: number; total: number };
}

// ---------------------------------------------------------------------------
// Kleine Helfer (Stil aus deconstructionMapper.ts uebernommen)
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

/**
 * Zahl + Einheit, wenn die Einheit nicht schon im Wert steht.
 *
 * Wie in deconstructionMapper: deutsche Darstellung (Komma) ohne die
 * nachlaufende ".0", die eine Scheingenauigkeit vortaeuscht. Die IFC liefert
 * zusaetzlich Fliesskommazahlen mit vollem double-Rauschen
 * ("32.887207999999987") -- die werden auf drei Nachkommastellen gerundet,
 * sonst stuende Messrauschen als Praezision in der Ansicht.
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
): DocumentationField {
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
): DocumentationField {
  return value
    ? { id, label, value, availability: 'derived', note }
    : { id, label, value: null, availability: 'missing', note };
}

function unsupported(id: string, label: string, note: string): DocumentationField {
  return { id, label, value: null, availability: 'unsupported', note };
}

/**
 * Merkmal aus der Ausfuehrungsplanung.
 *
 * Fehlt der Wert, unterscheidet die Begruendung zwei sehr verschiedene Faelle:
 * "es liegt gar keine Planung vor" und "die Planung liegt vor, traegt dieses
 * Merkmal aber nicht". Ohne die Unterscheidung wuerde eine fehlende IFC wie
 * eine unvollstaendige aussehen -- und der Nutzer suchte den Fehler an der
 * falschen Stelle.
 */
function planned(
  id: string,
  label: string,
  value: string | null,
  hasPlanning: boolean,
  note: string,
): DocumentationField {
  if (value) return { id, label, value, availability: 'available' };
  return {
    id,
    label,
    value: null,
    availability: 'missing',
    note: hasPlanning
      ? note
      : 'Zu diesem Bauteil wurde keine Ausführungsplanung (IFC) hinterlegt.',
  };
}

// ---------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------

export function mapToDocumentation(
  data: ProductDataResult | null,
  product: Product | null,
): DocumentationData {
  // Die Rueckbaubarkeits-Query liefert ERP-Panel, Leistungserklaerung und
  // Klebstoff -- dieselben Quellen, die auch die Dokumentation braucht.
  const rows = data?.deconstruction ?? [];
  const docRows = data?.documentation ?? [];
  const declarations = data?.declarations ?? [];
  const bspWerk = data?.bspWerk?.[0];

  /** Liegt ueberhaupt ein Planungsdatensatz vor? */
  const hasPlanning = docRows.some(
    (row) => getValue(row, 'buildingElement') !== undefined,
  );

  // --- Allgemeine Informationen (I-1, I-2, I-5, I-6, I-29, I-57) ----------
  // I-1 ist der HANDELSNAME (M-1077, tc:typeNumber der Leistungserklaerung),
  // NICHT der Dokumenttitel -- dieselbe Unterscheidung wie im
  // deconstructionMapper, sonst stuende der Dokumentname im Kopf der Ansicht.
  const typeNumber = firstValue(rows, 'dopTypeNumber') ?? firstValue(declarations, 'typeNumber');
  const articleName = firstValue(rows, 'artikel');
  const tradeName = typeNumber ?? articleName ?? orNull(product?.name);

  // I-2 Beschreibung / I-52 Verwendungszweck: beide zeigen laut Tabelle auf
  // M-1078 (tc:intendedUse der Leistungserklaerung).
  const intendedUse =
    firstValue(rows, 'dopIntendedUse') ?? firstValue(declarations, 'intendedUse');
  const description = firstValue(docRows, 'beschreibung') ?? intendedUse;

  const speciesGerman =
    orNull(product?.woodType) ??
    firstValue(rows, 'dopHolzart') ??
    firstValue(rows, 'panelHolzart') ??
    firstValue(declarations, 'holzart');
  const speciesBotanical =
    orNull(product?.woodTypeScientific) ??
    (speciesGerman ? orNull(SPECIES_SCIENTIFIC[speciesGerman]) : null);

  const certification = normalizeYesNo(
    firstValue(rows, 'pefc') ??
      (product?.certifications?.length ? product.certifications.join(', ') : null),
  );

  const strengthClass =
    firstValue(rows, 'festigkeit') ??
    firstValue(rows, 'dopStrengthClass') ??
    firstValue(declarations, 'strengthClass');

  const productNorm = firstValue(docRows, 'produktnorm');
  const coating = normalizeYesNo(firstValue(rows, 'anstrich'));

  // I-37 Materialherkunft: dieselbe Ableitungsregel wie in der
  // Rueckbaubarkeit (Beschreibung Kap. 6). Holz ist in jedem Fall ein
  // nachwachsender Primaerrohstoff, deshalb gibt es hier immer einen Wert.
  const certified = !!certification && /^(ja|pefc|fsc)/i.test(certification);
  const materialOrigin = certified
    ? 'Primärrohstoff, erneuerbar, zertifiziert'
    : 'Primärrohstoff, erneuerbar';

  // --- Verortung im Gebaeude (I-78..I-89) ---------------------------------
  const ifcGlobalId = firstValue(docRows, 'ifcGlobalId');
  const ifcType = firstValue(docRows, 'ifcTyp');
  const storey = firstValue(docRows, 'geschoss');
  const constructionSection = firstValue(docRows, 'bauabschnitt');
  const componentKind = firstValue(docRows, 'planBauteil');
  const installation = firstValue(docRows, 'einbau');
  const productionList = firstValue(docRows, 'noProductionList');
  const visualQuality = firstValue(docRows, 'sichtqualitaet');
  const abbund = firstValue(docRows, 'abbundBvn');
  const planFileName = firstValue(docRows, 'planSourceFile');
  const projectName = firstValue(docRows, 'projektname');
  const projectNumber = firstValue(docRows, 'projektnummer');

  // I-78 Gebaeudetyp: laut Tabelle "aktuell nicht verfuegbar". Der IFC-Auszug
  // beschreibt ein Bauteil, nicht das Bauwerk; IfcBuilding traegt im
  // Revit-Export keine Typangabe. Projektname/-nummer sind das Naechste, was
  // die Datei ueber das Bauvorhaben aussagt.
  const buildingReference = projectName ?? projectNumber;

  // --- Gewicht und Abmessungen (I-32..I-36, I-59, I-60) -------------------
  const quantity =
    firstValue(rows, 'menge') ??
    orNull(getValue(bspWerk, 'nettoVolumen')) ??
    orNull(getValue(bspWerk, 'bruttoVolumen'));
  const thickness = firstValue(rows, 'hoehe');
  const width = firstValue(rows, 'breite');
  const length = firstValue(rows, 'laenge');
  const layers = firstValue(rows, 'schichten') ?? orNull(getValue(bspWerk, 'anzahlSchichten'));
  const netWeight = firstValue(docRows, 'nettogewicht');
  const surfaceArea = firstValue(docRows, 'oberflaeche');

  // Geplante Geometrie aus der IFC -- Grundlage des Soll-Ist-Abgleichs.
  const plannedArea = firstValue(docRows, 'geplanteNettoflaeche');
  const plannedVolume = firstValue(docRows, 'geplantesNettovolumen');

  // --- Hersteller (I-30, I-40..I-48) --------------------------------------
  const manufacturerName =
    firstValue(rows, 'dopManufacturer') ?? firstValue(declarations, 'manufacturer');
  const address = classifyManufacturerAddress(allValues(rows, 'dopAddress'));
  const phone = firstValue(rows, 'dopPhone');
  const fax = firstValue(rows, 'dopFax');
  const website = firstValue(rows, 'dopWebsite');
  const productionDate =
    parseDate(firstValue(rows, 'produktionsdatum')) ??
    parseDate(getValue(bspWerk, 'productionDate'));

  // --- Allgemeine Angaben ueber den Kategorien ----------------------------
  const general: DocumentationField[] = [
    field('I-2', 'Beschreibung', description),
    field('I-5', 'Holzart (deutsch)', speciesGerman),
    field('I-6', 'Holzart (botanisch)', speciesBotanical),
    // I-14: aus den Erntekoordinaten (M-183/M-184) ermittelbar, aber das
    // erfordert eine Rueckwaertsgeokodierung -- ein Netzaufruf, den dieser
    // reine Mapper nicht machen darf. Der Herkunftsnachweis loest genau das.
    unsupported(
      'I-14',
      'Herkunft (Bundesland)',
      'Nicht direkt erfasst; aus den Erntekoordinaten ermittelbar — die Karte im Anwendungsfall „Herkunftsnachweis" zeigt den Einschlagsort.',
    ),
    field('I-15', 'Holzzertifizierung', certification),
    field('I-29', 'Festigkeitsklasse', strengthClass),
    field('I-57', 'Produktnorm', productNorm),
    field(
      'I-51',
      'Anstrich vorhanden',
      coating,
      'Der Hersteller hat zur Oberflächenbehandlung keine Angabe übermittelt.',
    ),
    field('I-52', 'Verwendungszweck', intendedUse),
    derived(
      'I-37',
      'Materialherkunft',
      materialOrigin,
      certification
        ? `Abgeleitet aus der Holzzertifizierung „${certification}".`
        : 'Ohne hinterlegte Zertifizierung gilt Holz als erneuerbarer Primärrohstoff.',
    ),
    // I-62: die Berechnung braucht aufgeloeste Transportdistanzen
    // (Geocoding), die erst der CO2-Anwendungsfall beschafft. Hier wird
    // deshalb verwiesen statt gerechnet -- eine zweite, abweichende
    // Berechnung waere schlimmer als keine.
    unsupported(
      'I-62',
      'CO₂-Emissionen gesamt (A1–A5)',
      'Wird im Anwendungsfall „CO₂ Bilanzierung" aus denselben Pod-Daten berechnet.',
    ),
  ];

  const categories: DocumentationCategory[] = [
    {
      id: 'location',
      title: 'Verortung im Gebäude',
      description:
        'Wo das Bauteil im Bauwerk sitzt — aus der Ausführungsplanung (IFC-Modell).',
      fields: [
        planned(
          'I-78',
          'Gebäude / Bauvorhaben',
          buildingReference,
          hasPlanning,
          'Der Bauteilauszug beschreibt das Bauteil, nicht das Bauwerk; eine Gebäudetypangabe enthält er nicht.',
        ),
        planned(
          'I-79',
          'IFC-GlobalId',
          ifcGlobalId,
          hasPlanning,
          'Das Planungsmodell nennt keine GlobalId für dieses Bauteil.',
        ),
        planned(
          'I-80',
          'IFC-Typ',
          ifcType,
          hasPlanning,
          'Die Bauteilklasse konnte dem Planungsmodell nicht entnommen werden.',
        ),
        planned(
          'I-81',
          'Bauabschnitt',
          constructionSection,
          hasPlanning,
          'Der Bauabschnitt ist ein projektspezifischer Parameter; der vorliegende IFC-Export schreibt ihn nicht mit.',
        ),
        planned(
          'I-82',
          'Geschoss',
          storey,
          hasPlanning,
          'Das Bauteil ist im Planungsmodell keinem Geschoss zugeordnet.',
        ),
        planned(
          'I-83',
          'Bauteil',
          componentKind,
          hasPlanning,
          'Die Bauteilart konnte aus Typ und Bezeichnung nicht bestimmt werden.',
        ),
        planned(
          'I-85',
          'Nummer Produktionsliste',
          productionList,
          hasPlanning,
          'Projektspezifischer Parameter; der vorliegende IFC-Export schreibt ihn nicht mit.',
        ),
        planned(
          'I-86',
          'Sichtqualität',
          visualQuality,
          hasPlanning,
          'Projektspezifischer Parameter; der vorliegende IFC-Export schreibt ihn nicht mit.',
        ),
        planned(
          'I-87',
          'Abbund / BVN',
          abbund,
          hasPlanning,
          'Projektspezifischer Parameter; der vorliegende IFC-Export schreibt ihn nicht mit.',
        ),
        planned(
          'I-88',
          'BIM-Modell (Datei)',
          planFileName,
          hasPlanning,
          'Zum Planungsdatensatz ist kein Dateiname hinterlegt.',
        ),
        // I-89: Das Modell selbst wird im Downloadbereich angeboten, sofern
        // es hochgeladen wurde -- ein eigenes Merkmal waere eine Dublette.
        unsupported(
          'I-89',
          'BIM-Modell (Upload)',
          'Das hinterlegte Planungsmodell steht im Downloadbereich unten zur Verfügung.',
        ),
      ],
    },
    {
      id: 'dimensions',
      title: 'Gewicht und Abmessungen',
      description:
        'Maße, Gewicht und Schichtaufbau der Platte — Grundlage für Transport, Hebezeug und Einbauplanung.',
      fields: [
        // Einheiten laut ERP-Tabelle: Volumen in m³, Staerke in mm, Breite
        // und Laenge in m; withUnit haengt nichts doppelt an.
        field('I-32', 'Menge', withUnit(quantity, 'm³')),
        field('I-33', 'Höhe / Stärke', withUnit(thickness, 'mm')),
        field('I-34', 'Breite', withUnit(width, 'm')),
        field('I-35', 'Länge', withUnit(length, 'm')),
        field('I-36', 'Anzahl der Schichten', layers),
        field('I-59', 'Nettogewicht', withUnit(netWeight, 'kg')),
        field('I-60', 'Oberfläche einer Plattenseite', withUnit(surfaceArea, 'm²')),
        // Geplante Geometrie: nicht Teil der Informationsbedarfstiefe, aber
        // die Planung ist die einzige Quelle fuer den Soll-Ist-Abgleich.
        ...(plannedArea
          ? [
              derived(
                'P-1',
                'Fläche (geplant)',
                withUnit(plannedArea, 'm²'),
                'Aus dem Planungsmodell (IFC) — Sollwert der Ausführungsplanung.',
              ),
            ]
          : []),
        ...(plannedVolume
          ? [
              derived(
                'P-2',
                'Volumen (geplant)',
                withUnit(plannedVolume, 'm³'),
                'Aus dem Planungsmodell (IFC) — Sollwert der Ausführungsplanung.',
              ),
            ]
          : []),
      ],
    },
    {
      id: 'installation',
      title: 'Einbau',
      description:
        'Anlieferung und Einbau des Bauteils auf der Baustelle. Diese Angaben entstehen erst während der Bauausführung — im Demonstrator liegt dazu noch keine Datenquelle vor.',
      fields: [
        planned(
          'I-84',
          'Einbau & Anlieferung',
          installation,
          hasPlanning,
          'Die Ausführungsplanung unterscheidet Werks- und Baustelleneinbau; der vorliegende IFC-Export schreibt diesen Parameter nicht mit.',
        ),
        // Laut Visualisierung ist die gesamte Kategorie "aktuell nicht
        // befuellbar". Der Einbau wird von der ausfuehrenden Firma
        // dokumentiert -- eine Wertschoepfungsstufe, die im Demonstrator
        // keine Daten liefert.
        unsupported(
          'I-90',
          'Einbaudatum',
          'Wird beim Einbau von der ausführenden Firma erfasst; für dieses Bauteil liegt keine Baustellendokumentation vor.',
        ),
        unsupported(
          'I-91',
          'Einbauort im Bauwerk',
          'Die genaue Einbaulage entsteht erst bei der Montage; im Datenraum ist bislang nur die geplante Verortung hinterlegt.',
        ),
        unsupported(
          'I-92',
          'Abnahme / Protokoll',
          'Abnahmeprotokolle der Bauausführung sind im Demonstrator nicht angebunden.',
        ),
      ],
    },
    {
      id: 'manufacturer',
      title: 'Hersteller',
      description:
        'Angaben zum Holzwerkstoffproduzenten für Rückfragen zum Bauteil und zur Gewährleistung.',
      fields: [
        field('I-40', 'Artikelbezeichnung', articleName),
        field('I-30', 'Produktionsdatum', productionDate),
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
  ];

  const all = [...general, ...categories.flatMap((c) => c.fields)];

  return {
    componentName: tradeName,
    // Unterzeile der Bauteilkarte: die Bauteilart aus der Planung ("Boden",
    // "Wand") sagt mehr ueber das Bauteil als der Dokumenttitel. Fehlt die
    // Planung, faellt es auf die Bezeichnung des Planungsmodells und zuletzt
    // auf die generische Produktart zurueck.
    componentType:
      componentKind ??
      firstValue(docRows, 'planBezeichnung') ??
      (product?.productType === 'finished' ? 'BSP-Platte' : null),
    general,
    categories,
    coverage: {
      filled: all.filter((f) => f.value !== null).length,
      total: all.length,
    },
  };
}
