/**
 * JSON-Export der Anwendungsfaelle.
 *
 * Jeder Awf zeigt seine Merkmale als Kategorien mit Feldern; diese Ansicht
 * laesst sich abschreiben, aber nicht weiterverarbeiten. Der Export gibt
 * genau das heraus, was die Ansicht zeigt -- nicht mehr (keine Rohtripel aus
 * dem Pod) und nicht weniger (auch die Begruendungen fehlender Angaben, denn
 * die gehoeren zur Aussage des Awf).
 *
 * Ein gemeinsames Format ueber alle Awf hinweg, damit ein Empfaenger nur
 * einen Parser braucht:
 *
 *   { erzeugtAm, anwendungsfall, bauteil, abdeckung, kategorien[], ... }
 *
 * Fuenf der sechs Awf liefern bereits `{ categories, coverage }` und gehen
 * durch dieselbe Normalisierung. Der Herkunftsnachweis ist flach gebaut
 * (I-1..I-28 als Einzelfelder plus Akteursliste) und bekommt deshalb eine
 * eigene Umformung -- das Ergebnis sieht aber gleich aus.
 */

import type { ProvenanceData } from './provenanceMapper';
import type { DeconstructionData } from './deconstructionMapper';
import type { DocumentationData } from './documentationMapper';
import type { LiabilityData } from './liabilityMapper';
import type { DbppData } from './dbppMapper';
import type { LcaInfo, LcaResult } from './lcaService';
import type { ProvenanceActor } from './provenanceMapper';

// ---------------------------------------------------------------------------
// Gemeinsames Ausgabeformat
// ---------------------------------------------------------------------------

export interface ExportField {
  id: string;
  merkmal: string;
  wert: string | number | null;
  /** available | derived | missing | unsupported -- bzw. 'assumed' (Haftung). */
  verfuegbarkeit: string;
  /** Begruendung bei abgeleiteten und fehlenden Angaben. */
  hinweis?: string;
}

export interface ExportCategory {
  id: string;
  titel: string;
  beschreibung?: string;
  /** Nur Haftungsnachweis: wer fuer diese Stufe einsteht. */
  akteur?: string | null;
  /** Nur Bauproduktpass: Bezug zum Rechtsrahmen. */
  rechtsgrundlage?: string;
  merkmale: ExportField[];
}

export interface UseCaseExport {
  /** ISO-Zeitstempel der Ausgabe. */
  erzeugtAm: string;
  anwendungsfall: { id: string; titel: string };
  bauteil: {
    ident: string | null;
    bezeichnung: string | null;
    art: string | null;
  };
  abdeckung: { belegt: number; gesamt: number } | null;
  kategorien: ExportCategory[];
  /** Awf-spezifische Zusatzdaten (Akteure, Schadensmeldungen, Rechnung ...). */
  [weitere: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

interface GenericField {
  id: string;
  label: string;
  value: string | null;
  availability: string;
  note?: string;
}

interface GenericCategory {
  id: string;
  title: string;
  description?: string;
  actor?: string | null;
  legalBasis?: string;
  fields: GenericField[];
}

function mapField(field: GenericField): ExportField {
  return {
    id: field.id,
    merkmal: field.label,
    wert: field.value,
    verfuegbarkeit: field.availability,
    // Nur setzen, wenn vorhanden -- ein leeres Feld im JSON waere Rauschen.
    ...(field.note ? { hinweis: field.note } : {}),
  };
}

function mapCategories(categories: GenericCategory[]): ExportCategory[] {
  return categories.map((category) => ({
    id: category.id,
    titel: category.title,
    ...(category.description ? { beschreibung: category.description } : {}),
    ...(category.actor !== undefined ? { akteur: category.actor } : {}),
    ...(category.legalBasis ? { rechtsgrundlage: category.legalBasis } : {}),
    merkmale: category.fields.map(mapField),
  }));
}

function baseExport(
  useCaseId: string,
  useCaseTitle: string,
  epc: string | null,
  name: string | null,
  kind: string | null,
): Pick<UseCaseExport, 'erzeugtAm' | 'anwendungsfall' | 'bauteil'> {
  return {
    erzeugtAm: new Date().toISOString(),
    anwendungsfall: { id: useCaseId, titel: useCaseTitle },
    bauteil: { ident: epc, bezeichnung: name, art: kind },
  };
}

/** Akteure ohne die internen Marker der Kartendarstellung. */
function mapActors(actors: ProvenanceActor[]) {
  return actors.map((actor) => ({
    rolle: actor.kind,
    name: actor.name,
    anschrift: actor.address,
    beleg: actor.reference,
    datum: actor.transportDate,
    ...(actor.coordinates
      ? {
          koordinaten: {
            lat: actor.coordinates.lat,
            lon: actor.coordinates.lng,
            // Gemessen oder nur aus der Anschrift geschaetzt -- der
            // Unterschied entscheidet, ob man die Koordinate zitieren darf.
            herkunft: actor.coordinateSource,
          },
        }
      : {}),
  }));
}

// ---------------------------------------------------------------------------
// Je Anwendungsfall
// ---------------------------------------------------------------------------

/**
 * Herkunftsnachweis: flache Merkmalsliste statt Kategorien. Damit das
 * Ausgabeformat trotzdem passt, werden die Felder in zwei sachliche
 * Gruppen gebuendelt -- so, wie die Ansicht sie auch zeigt.
 */
export function buildOriginExport(
  data: ProvenanceData,
  epc: string | null,
): UseCaseExport {
  const f = (id: string, label: string, value: string | null): ExportField => ({
    id,
    merkmal: label,
    wert: value,
    verfuegbarkeit: value ? 'available' : 'missing',
  });

  const coords = data.fellingCoordinates;

  return {
    ...baseExport('origin-proof', 'Herkunftsnachweis', epc, data.tradeName, data.productKind),
    abdeckung: null,
    kategorien: [
      {
        id: 'general',
        titel: 'Allgemeine Angaben',
        merkmale: [
          f('I-1', 'Handelsname', data.tradeName),
          f('I-2', 'Beschreibung', data.description),
          f('I-3', 'Menge (m³)', data.volumeM3),
          f('I-4', 'Stückzahl', data.pieces),
          f('I-5', 'Holzart (deutsch)', data.speciesGerman),
          f('I-6', 'Holzart (botanisch)', data.speciesBotanical),
          f('I-7', 'Reifejahr Vermehrungsgut', data.maturityYear),
          f('I-8', 'Erzeugnisart', data.productKind),
          f('I-9', 'HS-Code (Zolltarif)', data.hsCode),
        ],
      },
      {
        id: 'felling',
        titel: 'Einschlag',
        merkmale: [
          f('I-10/I-11', 'Fällkoordinate', coords ? `${coords.lat}, ${coords.lng}` : null),
          f('I-12', 'Fälldatum', data.fellingDate),
          f('I-13', 'Land', data.fellingCountry),
          f('I-14', 'Bundesland', data.fellingState),
          f('I-15', 'Zertifizierungen', data.certifications.join(', ') || null),
        ],
      },
      {
        id: 'buyer',
        titel: 'Käufer',
        merkmale: [
          f('I-27', 'Käufer', data.buyerName),
          f('I-28', 'Käufer (Anschrift)', data.buyerAddress),
        ],
      },
    ],
    // I-16..I-26: eigene Liste, weil ein Akteur mehrere Merkmale traegt.
    akteure: mapActors(data.actors),
  };
}

export function buildDeconstructionExport(
  data: DeconstructionData,
  epc: string | null,
): UseCaseExport {
  return {
    ...baseExport(
      'deconstruction',
      'Rückbaubarkeit & Zirkularität',
      epc,
      data.componentName,
      data.componentType,
    ),
    abdeckung: { belegt: data.coverage.filled, gesamt: data.coverage.total },
    kategorien: mapCategories(data.categories),
  };
}

export function buildDocumentationExport(
  data: DocumentationData,
  epc: string | null,
): UseCaseExport {
  // `general` steckt bereits als erste Kategorie in `categories` -- nur von
  // dort lesen, sonst stuenden die allgemeinen Merkmale zweimal im JSON.
  return {
    ...baseExport(
      'documentation',
      'Dokumentation',
      epc,
      data.componentName,
      data.componentType,
    ),
    abdeckung: { belegt: data.coverage.filled, gesamt: data.coverage.total },
    kategorien: mapCategories(data.categories),
  };
}

export function buildLiabilityExport(
  data: LiabilityData,
  epc: string | null,
): UseCaseExport {
  return {
    ...baseExport(
      'liability',
      'Nachweis der Haftung',
      epc,
      data.componentName,
      data.strengthClass,
    ),
    abdeckung: { belegt: data.coverage.filled, gesamt: data.coverage.total },
    kategorien: mapCategories(
      data.categories.map((c) => ({ ...c, legalBasis: undefined })),
    ),
    // Die Luecken sind hier Teil der Aussage: sie benennen, wo die
    // Haftungskette nicht belegt ist.
    luecken: data.gaps.map((gap) => ({ titel: gap.title, detail: gap.detail })),
    schadensmeldungen: data.damageReports.map((report) => ({
      datum: report.date,
      art: report.kind,
      beschreibung: report.description,
      gemeldetVon: report.reportedBy,
      holzfeuchte: report.moisture,
    })),
  };
}

export function buildProductPassExport(
  data: DbppData,
  stations: ProvenanceActor[],
  epc: string | null,
): UseCaseExport {
  return {
    ...baseExport(
      'dbpp',
      'Digitaler Bauproduktpass (DBPP)',
      // Der Pass fuehrt den Ident als eigenes Merkmal -- den nehmen, sonst
      // den gescannten.
      data.uniqueProductId ?? epc,
      data.productName,
      data.productType,
    ),
    abdeckung: { belegt: data.coverage.filled, gesamt: data.coverage.total },
    kategorien: mapCategories(data.categories),
    lieferkette: mapActors(stations),
  };
}

export function buildCo2Export(
  info: LcaInfo,
  lca: LcaResult,
  epc: string | null,
): UseCaseExport {
  /** Ein Modul samt Untermodulen -- die Formel gehoert dazu, sonst ist die
      Zahl nicht nachvollziehbar. */
  const mapModule = (module: LcaResult['modules'][number]): Record<string, unknown> => ({
    code: module.code,
    bezeichnung: module.label,
    wert: module.value,
    einheit: 'kg CO2e',
    verfuegbarkeit: module.availability,
    formel: module.formula,
    ...(module.isPartial ? { teilwert: true } : {}),
    ...(module.note ? { hinweis: module.note } : {}),
    ...(module.sub?.length ? { teilmodule: module.sub.map(mapModule) } : {}),
  });

  return {
    ...baseExport('co2', 'CO₂-Bilanz', epc, info.componentName, null),
    abdeckung: { belegt: info.coverage.filled, gesamt: info.coverage.total },
    kategorien: mapCategories(info.categories),
    bilanz: {
      summe: lca.total,
      einheit: 'kg CO2e',
      // Ohne diese Kennzeichnung liest jemand die Summe als vollstaendig.
      summeUnvollstaendig: lca.totalIsPartial,
      fehlendeModule: lca.missingModules,
      module: lca.modules.map(mapModule),
    },
    hersteller: info.manufacturer,
    bezugsgroesse: info.referenceSize,
    hinweis:
      'Berechnung in Anlehnung an EN 15804+A2 — keine Konformität, keine Verifizierung.',
  };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/** Blob als Datei anbieten. Geteilt, damit der Anker-Tanz nur einmal steht. */
export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Dateiname aus Awf und Ident: beide Bestandteile sind noetig, weil ein
 * Nutzer mehrere Awf desselben Bauteils exportiert -- und derselbe Awf fuer
 * mehrere Bauteile.
 */
export function exportFilename(useCaseId: string, epc: string | null): string {
  // Aus "urn:epc:id:sgtin:404711148.0401.143138262901" wird
  // "404711148.0401.143138262901" -- der Rest ist bei jedem Ident gleich.
  const shortId = epc?.split(':').pop()?.replace(/[^A-Za-z0-9._-]+/g, '-');
  const date = new Date().toISOString().slice(0, 10);
  return ['timberconnect', useCaseId, shortId, date].filter(Boolean).join('_') + '.json';
}

/** Export anstossen: JSON bauen, formatieren, herunterladen. */
export function downloadUseCaseExport(data: UseCaseExport): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, exportFilename(data.anwendungsfall.id, data.bauteil.ident));
}
