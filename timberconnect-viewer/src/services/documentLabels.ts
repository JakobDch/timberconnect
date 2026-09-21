/**
 * Lesbare Namen fuer die Dateien im Pod.
 *
 * Im Pod heisst eine Datei "15db340fdd300779_pdf_transportauftrag.json" —
 * der Hash ist die Dokument-ID, der Rest die Kennung der Vorlage. Fuer den
 * Nutzer ist davon nichts brauchbar: er hat einen "Transportauftrag Rundholz"
 * hochgeladen und sucht genau diesen Namen wieder.
 *
 * Dieselbe Uebersetzung leistet describeContainer in podResetService fuer die
 * Loeschliste. Hier steht sie fuer den Downloadbereich — mit zwei Zusaetzen,
 * die dort nicht gebraucht werden:
 *
 *   - die VOLLE Vorlagenliste (pdf_template_service.py), nicht nur die
 *     Dokumentarten, die in der Loeschliste vorkommen
 *   - die Unterscheidung Originaldokument / Strukturdaten, denn im
 *     Downloadbereich stehen beide nebeneinander und der Nutzer muss waehlen
 *
 * Die Kennungen sind mit dem Backend abgeglichen (TEMPLATES in
 * services/pdf_template_service.py). Kommt dort eine Vorlage hinzu, ohne dass
 * sie hier eingetragen wird, faellt die Anzeige auf die aufgehuebschte
 * Kennung zurueck ("Fertigungsauftrag Saege") — unschoen, aber nie ein Hash.
 */

import type { PodFileEntry } from './fileBrowserService';

/**
 * Vorlagen-Kennung -> Anzeigename.
 *
 * Die Namen sind die der Vorlagen im Backend, aber ohne die klammernden
 * Zusaetze ("Pruefzertifikat Saatgut (KJZ)" -> "Prüfzertifikat Saatgut"):
 * in einer Liste zaehlt, was das Dokument IST, nicht welche Stelle das
 * Formular herausgibt.
 */
const TEMPLATE_LABELS: Record<string, string> = {
  pdf_stammzertifikat: 'Stammzertifikat Vermehrungsgut',
  pdf_pruefzertifikat: 'Prüfzertifikat Saatgut',
  pdf_transportauftrag_rundholz: 'Transportauftrag Rundholz',
  pdf_leistungserklaerung_bsp: 'Leistungserklärung Brettsperrholz',
  pdf_leistungserklaerung: 'Leistungserklärung Schnittholz',
  pdf_fertigungsauftrag_saege: 'Fertigungsauftrag Säge',
  pdf_transportauftrag: 'Transportauftrag Schnittholz',
  pdf_klebstoffdatenblatt: 'Klebstoff-Datenblatt',
  pdf_biegepruefung: 'Biegeprüfung Schnittholz',
  pdf_schnittbild: 'Schnittbild',
};

/**
 * Kennungen der maschinenlesbaren Pflichtdateien -> Anzeigename.
 *
 * Diese Dateien tragen keine Vorlagen-Kennung, sondern den data_type der
 * Backend-Erkennung (siehe leadDoc.expectedDataType in processService).
 */
const MACHINE_LABELS: Record<string, string> = {
  forst: 'Harvesterprotokoll',
  saegewerk: 'Sägewerk-Protokoll',
  bspwerk: 'BSP-Werk-Daten',
  herstellung: 'ERP-Export',
  eldat: 'Lieferschein (ELDAT)',
  planung: 'Werk- und Montageplanung',
};

/** Verwaltungsdateien des Pods — keine Belege, aber erklaerbar. */
const SYSTEM_LABELS: Record<string, string> = {
  'process.ttl': 'Vorgangsbeschreibung',
  'pricing.ttl': 'Preisangaben',
  'doc-policy.ttl': 'Dokumentfreigaben',
  'role-policy.ttl': 'Rollenfreigaben',
};

/** Die Art der Datei — sie entscheidet, welcher Knopf sie anbietet. */
export type FileVariant =
  /** Das hochgeladene Dokument selbst (PDF, .hpr, .xlsx, .ifc). */
  | 'original'
  /** Die daraus erzeugten Strukturdaten (.ttl/.json). */
  | 'structured';

export interface DocumentLabel {
  /** Anzeigename, z.B. "Transportauftrag Rundholz". */
  title: string;
  /** Original oder Strukturdaten. */
  variant: FileVariant;
  /**
   * Schluessel, unter dem Original und Strukturdaten desselben Dokuments
   * zusammenfinden: die Dokument-ID (Hash). Beide Dateien eines Dokuments
   * teilen ihn, verschiedene Dokumente nie.
   */
  docKey: string;
  /** True fuer Verwaltungsdateien (process.ttl & Co.). */
  isSystem: boolean;
}

/** Endungen, die fuer Strukturdaten stehen. */
const STRUCTURED_EXT = /\.(ttl|json|jsonld|nt|rdf)$/i;

/** "pdf_fertigungsauftrag_saege" -> "Fertigungsauftrag Saege". */
function prettifyKey(key: string): string {
  const words = key.replace(/^pdf_/, '').split('_').filter(Boolean);
  if (words.length === 0) return key;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Den Dateinamen zerlegen.
 *
 * Erwartetes Schema: "<docId>_<kennung>.<ext>", wobei die Kennung entweder
 * eine Vorlage ("pdf_transportauftrag"), ein data_type ("forst") oder das
 * Wort "dokument" ist (die Originaldatei eines PDF-Uploads).
 */
function splitName(name: string): { docId: string | null; key: string; ext: string } {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const stem = dot > 0 ? name.slice(0, dot) : name;

  // Die Dokument-ID ist ein Hex-Hash am Anfang; fehlt er, ist der ganze
  // Stamm die Kennung (Alt-Bestand, z.B. "harvester.hpr").
  const match = stem.match(/^([0-9a-f]{8,})_(.+)$/i);
  if (!match) return { docId: null, key: stem.toLowerCase(), ext };
  return { docId: match[1].toLowerCase(), key: match[2].toLowerCase(), ext };
}

/**
 * Den Anzeigenamen einer Kennung bestimmen.
 *
 * Laengste Kennung zuerst: "pdf_leistungserklaerung_bsp" enthaelt
 * "pdf_leistungserklaerung" als Praefix und wuerde sonst davon verdeckt —
 * dieselbe Falle wie in documentKindFromFiles.
 */
function labelForKey(key: string): string | null {
  const templateKeys = Object.keys(TEMPLATE_LABELS).sort((a, b) => b.length - a.length);
  for (const candidate of templateKeys) {
    if (key.includes(candidate)) return TEMPLATE_LABELS[candidate];
  }
  for (const candidate of Object.keys(MACHINE_LABELS)) {
    if (key === candidate || key.endsWith(`_${candidate}`)) return MACHINE_LABELS[candidate];
  }
  return null;
}

/**
 * Eine Pod-Datei in einen lesbaren Namen uebersetzen.
 *
 * Fuer "<hash>_dokument.pdf" allein reicht der Dateiname nicht: "dokument"
 * sagt nur "irgendein PDF". Welche Vorlage es war, steht in der zugehoerigen
 * "<hash>_pdf_<kennung>.ttl" im selben Container — deshalb nimmt die Funktion
 * die Nachbardateien entgegen und schaut dort nach.
 */
export function describeFile(name: string, siblings: string[] = []): DocumentLabel {
  const system = SYSTEM_LABELS[name.toLowerCase()];
  if (system) {
    return { title: system, variant: 'structured', docKey: `sys:${name}`, isSystem: true };
  }

  const { docId, key } = splitName(name);
  const variant: FileVariant = STRUCTURED_EXT.test(name) ? 'structured' : 'original';

  // Das Original eines PDF-Uploads heisst nur "_dokument.pdf". Die Vorlage
  // steht im Geschwisterkind mit derselben Dokument-ID.
  if (key === 'dokument' && docId) {
    for (const sibling of siblings) {
      const other = splitName(sibling);
      if (other.docId !== docId || other.key === 'dokument') continue;
      const label = labelForKey(other.key);
      if (label) return { title: label, variant, docKey: docId, isSystem: false };
    }
    return { title: 'Dokument', variant, docKey: docId, isSystem: false };
  }

  const label = labelForKey(key);
  return {
    title: label ?? prettifyKey(key),
    // Original und Strukturdaten teilen die Dokument-ID; fehlt sie
    // (Alt-Bestand), trennt die Kennung ohne Endung die Dokumente.
    docKey: docId ?? key,
    variant,
    isSystem: false,
  };
}

/** Die Dateiendung einer Pod-Datei, ohne Punkt. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Wie die Variante im Downloadknopf heisst. */
export function variantLabel(variant: FileVariant, ext: string): string {
  if (variant === 'original') {
    const clean = ext.replace(/^\./, '').toUpperCase();
    return clean ? `Original (${clean})` : 'Original';
  }
  return 'Strukturdaten';
}

export interface DocumentGroup {
  /** Schluessel des Dokuments (Hash bzw. Kennung). */
  docKey: string;
  /** Anzeigename, z.B. "Transportauftrag Rundholz". */
  title: string;
  /** Die Originaldatei, falls vorhanden. */
  original: PodFileEntry | null;
  /** Die Strukturdaten, falls vorhanden. */
  structured: PodFileEntry | null;
}

/**
 * Dateien eines Vorgangs zu Dokumenten buendeln.
 *
 * Aus "<hash>_dokument.pdf" + "<hash>_pdf_transportauftrag.ttl" wird EIN
 * Eintrag "Transportauftrag Rundholz" mit zwei Downloadknoepfen. Das halbiert
 * die Liste und beantwortet die Frage "wieso steht hier alles doppelt?".
 */
export function groupDocuments(files: PodFileEntry[]): DocumentGroup[] {
  const names = files.map((f) => f.name);
  const groups = new Map<string, DocumentGroup>();

  for (const file of files) {
    const label = describeFile(file.name, names);
    if (label.isSystem) continue;

    const group = groups.get(label.docKey) ?? {
      docKey: label.docKey,
      title: label.title,
      original: null,
      structured: null,
    };
    // Ein aussagekraeftiger Name gewinnt gegen den Platzhalter "Dokument":
    // welche Datei zuerst drankommt, ist Zufall der Container-Reihenfolge.
    if (group.title === 'Dokument' && label.title !== 'Dokument') group.title = label.title;
    if (label.variant === 'original') group.original ??= file;
    else group.structured ??= file;
    groups.set(label.docKey, group);
  }

  return Array.from(groups.values());
}
