/**
 * Vorgangs-Service ("Lebensabschnitte des Produkts")
 *
 * Umstellung des Uploads: Nicht mehr einzelne Dateien werden hochgeladen,
 * sondern ein VORGANG im Leben des Produkts wird registriert. Alle Dateien,
 * die zu diesem Lebensabschnitt gehoeren, werden gemeinsam hochgeladen.
 *
 * Jeder Vorgangstyp hat GENAU EINE Pflichtdatei ("Leitdokument"). Sie traegt
 * die Verknuepfung zur Material-ID, auf deren Basis spaeter
 *   a) die EPCIS-Events gebaut werden und
 *   b) die Daten im Knowledge Graph mit der Material-ID verknuepft werden.
 * Ohne Leitdokument entsteht kein Vorgang — das wird hart erzwungen
 * (siehe validateProcessDraft).
 *
 * Wiederfinden eines Vorgangs (zum Nachreichen einzelner Dateien):
 *   - HEUTE:  ueber den Zeitstempel der Registrierung (registeredAt).
 *   - SPAETER: zusaetzlich ueber die Event-IDs bzw. die Material-ID (EPC).
 *     Die Felder eventIds/materialEpcs existieren bereits im Datenmodell und
 *     werden von der Suche beruecksichtigt, sind aber noch leer, solange der
 *     Event-Ausloeser fehlt.
 */

import {
  stampContainerAcl,
  getAllowedRoles,
  podBaseFromUrl,
  podBaseFromWebId,
  writeEpcisConsent,
} from './accessControlService';
import { isDemoRole } from '../config/roles';

// ---------------------------------------------------------------------------
// Vorgangstypen
// ---------------------------------------------------------------------------

export type ProcessTypeId =
  | 'pflanzung'
  | 'faellung'
  | 'aufsaegung'
  | 'herstellung'
  | 'planung';

/**
 * Verfuegbarkeit des Pflichtdatei-FORMATS (nicht des Vorgangs):
 *   'machine'  — maschinenlesbares Format, wird inhaltlich erkannt
 *                (file_detector liefert den data_type). Strikt validiert.
 *   'template' — es existiert eine ausfuellbare PDF-Vorlage im
 *                Template-Registry. Der Nutzer laedt die ausgefuellte Vorlage
 *                hoch; erkannt wird nur "ist ein PDF", welches Dokument es ist,
 *                waehlt er beim Zuordnen der Datei.
 *   'pending'  — Format ist fachlich definiert, aber es existiert weder
 *                Erkennung noch Vorlage. Der Slot akzeptiert vorerst eine
 *                beliebige Datei als Platzhalter.
 */
export type LeadDocStatus = 'machine' | 'template' | 'pending';

export interface ProcessType {
  id: ProcessTypeId;
  /** Anzeigename des Vorgangs, z.B. "Fällvorgang". */
  label: string;
  /** Kurzbeschreibung des Lebensabschnitts. */
  description: string;
  /** Reihenfolge in der Produktlebenslinie (1 = Pflanzung). */
  order: number;
  /** Lucide-Icon-Name; die Zuordnung passiert in der UI. */
  icon: 'sprout' | 'axe' | 'saw' | 'factory' | 'blueprint';
  /** Das Pflichtdokument dieses Vorgangs. */
  leadDoc: {
    /** Anzeigename, z.B. "Harvesterprotokoll". */
    label: string;
    /**
     * Erwartete Dateiendung als Klartext, z.B. ".hpr".
     *
     * Bewusst getrennt vom Label und nicht hineingeschrieben: das Label
     * steht auch mitten in Saetzen ("Nicht als Harvesterprotokoll erkannt",
     * "Die Pflichtdatei ... muss ein PDF sein"). Mit angehaengter Endung
     * lesen sich diese Meldungen wie ein Dateiname. Angezeigt wird die
     * Endung dort, wo sie hilft: in der Vorgangsliste hinter dem Namen
     * (Vorgabe Anni, 26.08.2026).
     */
    fileExt: string;
    /** Warum diese Datei zwingend ist. */
    note: string;
    status: LeadDocStatus;
    /**
     * data_type der Backend-Erkennung, gegen den validiert wird.
     * Bei 'template' ist das 'dokument' (jedes PDF), bei 'pending' null
     * (es wird nur geprueft, dass ueberhaupt eine Datei im Slot liegt).
     */
    expectedDataType: string | null;
    /**
     * Bei status 'template': die ID der PDF-Vorlage im Template-Registry.
     * Sie ist beim Zuordnen der Pflichtdatei vorausgewaehlt — welches Dokument
     * dort erwartet wird, steht durch den Vorgangstyp bereits fest.
     */
    templateId?: string;
    /** Dateiendungen fuer den Datei-Dialog. */
    accept: string;
  };
  /**
   * Vorschlagsliste der PDF-Templates, die in diesem Vorgang typischerweise
   * anfallen (Template-IDs aus pdf_template_service.py). Steuert nur die
   * Vorsortierung im Template-Picker, schraenkt die Auswahl nicht ein.
   */
  suggestedTemplates: string[];
  /**
   * Rollen-IDs (aus config/roles.ts), die diesen Vorgang durchfuehren duerfen.
   *
   * SPERRE, nicht nur Sortierung: Wer den Vorgang fachlich nicht umsetzt, soll
   * ihn gar nicht erst sehen. Ein Fachplaner, der einen Faellvorgang
   * registriert, erzeugt Daten, fuer die er nicht die ausstellende Stelle ist —
   * das Dokument im Datenraum behauptet dann eine Urheberschaft, die es nicht
   * gibt. Wer mehrere Stufen abdeckt (integriertes Saegewerk), traegt das ueber
   * die Rollenliste hier ein, statt die Grenze im Formular aufzuweichen.
   *
   * Die Demo-Rolle (config/roles.ts) steht hier bewusst NICHT drin: sie geht
   * in processTypesForRole an der Liste vorbei, damit sie auch kuenftige
   * Vorgaenge automatisch sieht.
   */
  typicalRoles: string[];
}

export const PROCESS_TYPES: ProcessType[] = [
  {
    id: 'pflanzung',
    label: 'Pflanzvorgang',
    description: 'Anpflanzen des forstlichen Vermehrungsguts.',
    order: 1,
    icon: 'sprout',
    leadDoc: {
      label: 'Stammzertifikat',
      fileExt: '.pdf',
      note: 'Enthält die Verknüpfung zur Material-ID des Vermehrungsguts.',
      status: 'template',
      expectedDataType: 'dokument',
      templateId: 'pdf_stammzertifikat',
      accept: '.pdf',
    },
    // Pflichtdatei (pdf_stammzertifikat) wird separat vorangestellt.
    suggestedTemplates: ['pdf_pruefzertifikat'],
    // Das Stammzertifikat fuer Vermehrungsgut stellt der Forstbetrieb aus,
    // der die Flaeche begruendet.
    typicalRoles: ['Forstbetrieb'],
  },
  {
    id: 'faellung',
    label: 'Fällvorgang',
    description: 'Ernte der Bäume und Bereitstellen des Rundholz.',
    order: 2,
    icon: 'axe',
    leadDoc: {
      label: 'Harvesterprotokoll',
      fileExt: '.hpr',
      note: 'Enthält Stamm-Idente (StemKey), aus denen die EPCIS-Events gebaut werden.',
      status: 'machine',
      expectedDataType: 'forst',
      accept: '.xml,.hpr',
    },
    // Der Transportauftrag Rundholz begleitet die Abfuhr vom Polter --
    // laut Uebersichtstabelle Teil des Faellvorgangs.
    suggestedTemplates: ['pdf_transportauftrag_rundholz'],
    // Das Forstunternehmen erntet im Auftrag und registriert den Vorgang
    // in der Praxis genauso oft wie der Forstbetrieb selbst.
    typicalRoles: ['Forstbetrieb', 'Forstunternehmen'],
  },
  {
    id: 'aufsaegung',
    label: 'Aufsägevorgang',
    description: 'Verarbeitung des Rundholz zu Schnittholzlamellen im Sägewerk.',
    order: 3,
    icon: 'saw',
    leadDoc: {
      label: 'Leistungserklärung Schnittholzlamelle',
      fileExt: '.pdf',
      note: 'Enthält die Verknüpfung des Schnittholzes zur Material-ID.',
      status: 'template',
      expectedDataType: 'dokument',
      templateId: 'pdf_leistungserklaerung',
      accept: '.pdf',
    },
    // Pflichtdatei (pdf_leistungserklaerung) wird separat vorangestellt.
    // Der Fertigungsauftrag ist der Auftrag, mit dem das Saegewerk den
    // Einschnitt fahrt; der Transportauftrag Schnittholz begleitet die
    // Auslieferung des Ergebnisses. Beide gehoeren hierher, nicht zur
    // Herstellung -- so auch die Uebersichtstabelle.
    suggestedTemplates: [
      'pdf_schnittbild',
      'pdf_biegepruefung',
      'pdf_fertigungsauftrag_saege',
      'pdf_transportauftrag',
    ],
    typicalRoles: ['Saegewerk'],
  },
  {
    id: 'herstellung',
    label: 'Herstellungsvorgang',
    description:
      'Produktion des Holzbauteils z.B. Brettsperrholz beim Holzwerkstoffproduzenten.',
    order: 4,
    icon: 'factory',
    leadDoc: {
      label: 'ERP-Export',
      fileExt: '.xlsx',
      note: 'Enthält im Blatt "Identifikation" die Material-ID des hergestellten Bauteils (Identity) und die Lamellen-Idente aus dem Aufsägevorgang (IdentityInput).',
      status: 'machine',
      expectedDataType: 'herstellung',
      accept: '.xlsx',
    },
    suggestedTemplates: ['pdf_klebstoffdatenblatt', 'pdf_leistungserklaerung_bsp'],
    typicalRoles: ['Holzwerkstoffproduzent'],
  },
  {
    id: 'planung',
    label: 'Ausführungsplanung',
    description: 'Digitales Modell der Arbeitsvorbereitung.',
    order: 5,
    icon: 'blueprint',
    leadDoc: {
      label: 'Werk- und Montageplanung',
      fileExt: '.ifc',
      note: 'Bauteilbezogener Auszug des Planungsmodells. Anders als die übrigen Vorgänge entsteht hier KEIN neues Bauteil — die Planung beschreibt ein bestehendes. Deshalb trägt die Datei keinen Ident: die Material-ID des Bauteils wird beim Upload angegeben.',
      status: 'machine',
      expectedDataType: 'planung',
      accept: '.ifc',
    },
    suggestedTemplates: [],
    typicalRoles: ['FachplanerHolzbau', 'Holzbauunternehmen'],
  },
];

/**
 * Die Vorgaenge, die diese Rolle registrieren darf — und nur diese.
 *
 * Vorgaenge, die eine andere Rolle umsetzt, werden gar nicht erst angezeigt.
 * Der Grund ist inhaltlich: Ein Vorgang belegt einen Abschnitt im Leben des
 * Produkts, und wer ihn registriert, tritt als die Stelle auf, die ihn
 * durchgefuehrt hat. Eine Auswahl, die das nicht abbildet, erzeugt Daten mit
 * falscher Urheberschaft.
 *
 * Ohne Rolle (noch nicht registriert) bleibt die Liste vollstaendig — die
 * Rollenwahl folgt ohnehin unmittelbar nach dem Login, und eine hier leere
 * Liste waere an dieser Stelle nur verwirrend.
 *
 * Eine Rolle OHNE eigenen Vorgang (die Mehrzahl der 25 — Versicherer,
 * Finanzamt, Forschung) bekommt bewusst eine leere Liste zurueck: sie
 * registriert keine Vorgaenge, sie liest sie. Die UI erklaert das, statt eine
 * Auswahl anzubieten, die fachlich keine ist.
 *
 * Die Demo-Rolle bekommt alles: Sie ist das Vorfuehrkonto, das die gesamte
 * Kette in einem Pod durchspielt. Die Sperre schuetzt vor falscher
 * Urheberschaft im Regelbetrieb -- fuer die Vorfuehrung ist genau diese
 * Buendelung gewollt.
 */
export function processTypesForRole(roleId: string | null | undefined): ProcessType[] {
  if (!roleId || isDemoRole(roleId)) return PROCESS_TYPES;
  return PROCESS_TYPES.filter((t) => t.typicalRoles.includes(roleId));
}

export function getProcessType(id: ProcessTypeId): ProcessType {
  const found = PROCESS_TYPES.find((p) => p.id === id);
  if (!found) throw new Error(`Unbekannter Vorgangstyp: ${id}`);
  return found;
}

/** Anzeigename eines Vorgangstyps, robust gegen unbekannte IDs. */
export function processLabel(id: string): string {
  return PROCESS_TYPES.find((p) => p.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// Vorgangs-Datensatz
// ---------------------------------------------------------------------------

export interface ProcessFileRef {
  name: string;
  size: number;
  /** URL im Pod (Original oder konvertierte TTL). */
  url: string;
  /** true = die Pflichtdatei dieses Vorgangs. */
  isLeadDoc: boolean;
  /** data_type der Backend-Erkennung, sofern vorhanden. */
  dataType: string | null;
  /** ISO-Zeitstempel des Hinzufuegens (Nachreichungen sind spaeter). */
  addedAt: string;
}

export interface ProcessRecord {
  /** Interne Vorgangs-ID, z.B. "VG-2026-0803-4f2a". */
  id: string;
  type: ProcessTypeId;
  /** Zeitstempel der Registrierung — HEUTE der Suchschluessel. */
  registeredAt: string;
  /** Container im Pod: <podBase>data/<id>/ */
  containerUrl: string;
  ownerWebId: string;
  /** Frei waehlbare Bezeichnung, hilft beim Wiederfinden. */
  title: string;
  files: ProcessFileRef[];
  /**
   * EPCIS-Event-IDs dieses Vorgangs. NOCH LEER — der Event-Ausloeser fehlt.
   * Sobald vorhanden, wird hierueber gesucht.
   */
  eventIds: string[];
  /**
   * Material-IDs (EPC) aus der Pflichtdatei. NOCH LEER — die Bereitstellung
   * der Material-ID folgt. Sobald vorhanden, wird hierueber gesucht.
   */
  materialEpcs: string[];
}

const PROCESS_KEY = 'tc.processes';

function readProcesses(): ProcessRecord[] {
  try {
    const raw = localStorage.getItem(PROCESS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProcessRecord[]) : [];
  } catch {
    return [];
  }
}

function writeProcesses(list: ProcessRecord[]): void {
  try {
    localStorage.setItem(PROCESS_KEY, JSON.stringify(list));
  } catch {
    // localStorage nicht verfuegbar -> Index entfaellt, Pod-Daten bleiben
  }
}

/** Alle Vorgaenge, neueste Registrierung zuerst. */
export function getProcesses(): ProcessRecord[] {
  return readProcesses().sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
}

export function getProcess(id: string): ProcessRecord | null {
  return readProcesses().find((p) => p.id === id) ?? null;
}

function upsertProcess(record: ProcessRecord): void {
  const list = readProcesses().filter((p) => p.id !== record.id);
  list.unshift(record);
  writeProcesses(list);
}

/**
 * Vorgaenge aus dem lokalen Index entfernen, deren Container geloescht wurde.
 *
 * Der Index liegt im localStorage und weiss nichts davon, dass im Pod etwas
 * verschwunden ist. Ohne diesen Abgleich zeigte die Vorgangssuche nach dem
 * Loeschen weiter Eintraege an, deren Dateien 404 liefern — und schlimmer: ein
 * neuer Upload desselben Vorgangs stuende doppelt in der Liste.
 *
 * Verglichen wird ueber `containerUrl`, weil genau die der Loeschdienst kennt.
 * Gibt die Zahl der entfernten Eintraege zurueck.
 */
export function forgetProcessesByContainer(containerUrls: string[]): number {
  const gone = new Set(containerUrls);
  const before = readProcesses();
  const after = before.filter((p) => !gone.has(p.containerUrl));
  if (after.length !== before.length) writeProcesses(after);
  return before.length - after.length;
}

/** Dateien zu einem bestehenden Vorgang nachtragen. */
export function appendProcessFiles(processId: string, files: ProcessFileRef[]): ProcessRecord | null {
  const record = getProcess(processId);
  if (!record) return null;
  const updated: ProcessRecord = { ...record, files: [...record.files, ...files] };
  upsertProcess(updated);
  return updated;
}

/**
 * Material-ID / Event-IDs an einen Vorgang heften.
 * Wird genutzt, sobald die Pflichtdatei die Material-ID liefert und der
 * Event-Ausloeser existiert — heute noch von niemandem aufgerufen.
 */
export function attachProcessIdents(
  processId: string,
  idents: { eventIds?: string[]; materialEpcs?: string[] },
): ProcessRecord | null {
  const record = getProcess(processId);
  if (!record) return null;
  const updated: ProcessRecord = {
    ...record,
    eventIds: Array.from(new Set([...record.eventIds, ...(idents.eventIds ?? [])])),
    materialEpcs: Array.from(new Set([...record.materialEpcs, ...(idents.materialEpcs ?? [])])),
  };
  upsertProcess(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Suche (heute Zeitstempel, spaeter Event-/Material-ID)
// ---------------------------------------------------------------------------

export interface ProcessSearchFilter {
  /** Freitext: Vorgangs-ID, Titel, Dateiname — und Event-/Material-ID. */
  query?: string;
  type?: ProcessTypeId | null;
  /** Registrierung ab diesem Datum (ISO oder yyyy-mm-dd). */
  from?: string | null;
  /** Registrierung bis einschliesslich diesem Datum. */
  to?: string | null;
}

export function searchProcesses(filter: ProcessSearchFilter): ProcessRecord[] {
  const q = filter.query?.trim().toLowerCase() ?? '';
  return getProcesses().filter((p) => {
    if (filter.type && p.type !== filter.type) return false;
    if (filter.from && p.registeredAt < filter.from) return false;
    // "bis" ist tagesinklusiv: yyyy-mm-dd < yyyy-mm-ddT23:59
    if (filter.to && p.registeredAt.slice(0, 10) > filter.to.slice(0, 10)) return false;
    if (!q) return true;
    return (
      p.id.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q) ||
      processLabel(p.type).toLowerCase().includes(q) ||
      p.files.some((f) => f.name.toLowerCase().includes(q)) ||
      // Noch leer, aber die Suche ist bereits darauf vorbereitet:
      p.eventIds.some((e) => e.toLowerCase().includes(q)) ||
      p.materialEpcs.some((e) => e.toLowerCase().includes(q))
    );
  });
}

// ---------------------------------------------------------------------------
// Entwurf + Validierung (harte Pflichtdatei-Sperre)
// ---------------------------------------------------------------------------

export interface ProcessDraftFile {
  file: File;
  /** data_type aus der Backend-Erkennung, null solange unerkannt. */
  dataType: string | null;
  isRecognized: boolean;
  /**
   * Material-Idente, die in der Datei stehen — schon VOR dem Upload gelesen
   * (PDF: verstecktes AcroForm-Feld; Maschinendaten: trace_id der Erkennung).
   *
   * Grundlage der Zusammengehoerigkeitspruefung: alle Dateien eines Vorgangs
   * sollen dasselbe Material beschreiben. ``undefined`` = noch nicht
   * ermittelt, ``[]`` = geprueft, aber keiner gefunden.
   */
  epcs?: string[];
}

export interface ProcessDraft {
  type: ProcessTypeId | null;
  title: string;
  /** Die Pflichtdatei. null = Vorgang kann nicht registriert werden. */
  leadDoc: ProcessDraftFile | null;
  /** Alle weiteren Dateien dieses Lebensabschnitts. */
  attachments: ProcessDraftFile[];
}

export interface ProcessValidation {
  ok: boolean;
  /** Blockierender Grund, sonst null. */
  error: string | null;
  /** Nicht blockierender Hinweis (z.B. Format-Erkennung folgt noch). */
  hint: string | null;
}

// ---------------------------------------------------------------------------
// Zusammengehoerigkeit: beschreiben die Dateien dasselbe Material?
// ---------------------------------------------------------------------------

/**
 * Der Produkt-Teil eines GS1-EPC ohne die laufende Nummer:
 * "urn:epc:id:sgtin:404711145.0100.12A3D4567" -> "404711145.0100".
 *
 * Auf dieser Ebene wird verglichen, nicht auf der vollen ID. Ein Vorgang
 * verarbeitet viele Einzelstuecke derselben Art -- 24 Staemme im Faellvorgang,
 * 168 Lamellen im Aufsaegevorgang. Die Serials sind dabei zwangslaeufig
 * verschieden; gemeinsam ist ihnen Company Prefix und Item Reference. Genau
 * das trennt "andere Nummer desselben Materials" von "Datei aus einem ganz
 * anderen Vorgang", und nur Letzteres ist ein Fehler.
 */
export function epcProductKey(epc: string): string | null {
  const match = /^urn:epc:(?:id|class):(?:sgtin|lgtin):([0-9]+\.[0-9]+)\./i.exec(
    epc.trim(),
  );
  return match ? match[1] : null;
}

export interface IdentCheck {
  /** true = keine widersprechenden Idente gefunden. */
  ok: boolean;
  /** Warnung fuer den Nutzer, sonst null. Blockiert die Registrierung NICHT. */
  warning: string | null;
  /** Dateien ohne erkennbaren Ident (nur nachrichtlich). */
  withoutIdent: string[];
}

/**
 * Prueft, ob die Dateien eines Vorgangs dasselbe Material beschreiben.
 *
 * Warum eine Warnung und keine Sperre: Es gibt zwei voellig legitime Faelle
 * ohne passenden Ident. Erstens Dokumente, die einen Produkt-TYP beschreiben
 * (Klebstoff-Datenblatt, Leistungserklaerung) -- sie gehoeren fachlich zum
 * Vorgang, tragen aber bewusst keine Charge. Zweitens Umwandlungen: der
 * Aufsaegevorgang nennt Rundholz UND Lamellen, also zwangslaeufig zwei
 * Produktschluessel. Eine harte Sperre wuerde genau die richtigen Dateien
 * abweisen.
 *
 * Gemeldet wird deshalb nur, was zu nichts anderem im Vorgang passt: eine
 * Datei, deren Produktschluessel mit keiner anderen Datei ueberlappt. Das ist
 * der Fall, den der Nutzer sehen will -- die versehentlich mitgewaehlte Datei
 * aus einem anderen Vorgang.
 */
export function checkProcessIdents(files: ProcessDraftFile[]): IdentCheck {
  const relevant = files.filter((f) => f.epcs !== undefined);
  const withoutIdent = relevant
    .filter((f) => (f.epcs?.length ?? 0) === 0)
    .map((f) => f.file.name);

  const withIdent = relevant.filter((f) => (f.epcs?.length ?? 0) > 0);
  if (withIdent.length < 2) {
    // Unter zwei Dateien mit Ident gibt es nichts zu vergleichen.
    return { ok: true, warning: null, withoutIdent };
  }

  const keysOf = (f: ProcessDraftFile) =>
    new Set((f.epcs ?? []).map(epcProductKey).filter((k): k is string => !!k));

  const alle = withIdent.map((f) => ({ name: f.file.name, keys: keysOf(f) }));
  const fremd = alle.filter((eintrag) =>
    eintrag.keys.size > 0 &&
    !alle.some(
      (other) =>
        other !== eintrag &&
        Array.from(eintrag.keys).some((k) => other.keys.has(k)),
    ),
  );

  if (fremd.length === 0) {
    return { ok: true, warning: null, withoutIdent };
  }

  const namen = fremd.map((f) => f.name).join(', ');
  return {
    ok: false,
    withoutIdent,
    warning:
      fremd.length === 1
        ? `"${namen}" bezieht sich auf ein anderes Material als die übrigen Dateien. Bitte prüfen, ob die Datei zu diesem Vorgang gehört.`
        : `Diese Dateien beziehen sich auf anderes Material als die übrigen: ${namen}. Bitte prüfen, ob sie zu diesem Vorgang gehören.`,
  };
}

/**
 * Harte Sperre: ohne Pflichtdatei kein Vorgang.
 *
 * Wie streng geprueft wird, haengt vom Format ab:
 *   'machine'  — der erkannte data_type muss passen (Fällvorgang/StanForD).
 *                Eine falsche Datei im Slot erzeugt sonst einen Vorgang, dem
 *                die Material-ID fehlt.
 *   'template' — es muss ein PDF sein. WELCHES Dokument es ist, sagt die
 *                Vorlagen-Zuordnung beim Sammeln der Dateien; die Erkennung
 *                liefert bei PDFs nur "dokument".
 *   'pending'  — nur Anwesenheit (derzeit von keinem Vorgangstyp genutzt).
 */
export function validateProcessDraft(draft: ProcessDraft): ProcessValidation {
  if (!draft.type) {
    return { ok: false, error: 'Bitte zuerst den Vorgang auswählen.', hint: null };
  }
  const type = getProcessType(draft.type);

  if (!draft.leadDoc) {
    return {
      ok: false,
      error: `Pflichtdatei fehlt: ${type.leadDoc.label}. Ohne diese Datei kann der ${type.label} nicht registriert werden.`,
      hint: null,
    };
  }

  if (type.leadDoc.status === 'pending') {
    return {
      ok: true,
      error: null,
      hint: `Für "${type.leadDoc.label}" gibt es noch kein festgelegtes Format — die Datei wird vorerst nur als Pflichtdokument abgelegt.`,
    };
  }

  const expected = type.leadDoc.expectedDataType;
  if (expected && draft.leadDoc.dataType !== expected) {
    return {
      ok: false,
      error:
        type.leadDoc.status === 'template'
          ? `Die Pflichtdatei "${type.leadDoc.label}" muss ein PDF sein.`
          : `Die gewählte Pflichtdatei wurde nicht als ${type.leadDoc.label} erkannt. Bitte die korrekte Datei wählen.`,
      hint: null,
    };
  }

  if (type.leadDoc.status === 'template') {
    return {
      ok: true,
      error: null,
      hint: `Die im ${type.leadDoc.label} eingetragenen Werte werden beim Registrieren automatisch übernommen.`,
    };
  }

  return { ok: true, error: null, hint: null };
}

// ---------------------------------------------------------------------------
// Registrierung im Pod
// ---------------------------------------------------------------------------

/** Vorgangs-ID: VG-<yyyy>-<mmdd>-<4 zufaellige Hex>. */
export function generateProcessId(now: Date = new Date()): string {
  const year = now.getFullYear();
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `VG-${year}-${mmdd}-${suffix}`;
}

/** Vorschlagstitel, wenn der Nutzer keinen eigenen vergibt. */
export function defaultProcessTitle(type: ProcessTypeId, now: Date = new Date()): string {
  return `${getProcessType(type).label} vom ${now.toLocaleDateString('de-DE')}`;
}

// Muss der Namespace der v6-Ontologie sein — mit dem frueheren
// 'https://timberconnect.org/ontology#' waeren alle process.ttl-Tripel fuer
// Abfragen gegen das tc:-Vokabular unsichtbar gewesen.
const TC = 'http://timberconnect.2050.de/ontology#';

/** process.ttl — der Vorgang selbst als RDF, Suchschluessel ist der Zeitstempel. */
function buildProcessTtl(record: ProcessRecord): string {
  const type = getProcessType(record.type);
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = [
    `@prefix tc: <${TC}> .`,
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '',
    `<${record.containerUrl}> a tc:LifecycleProcess ;`,
    `    tc:processId "${esc(record.id)}" ;`,
    `    tc:processType "${esc(record.type)}" ;`,
    `    tc:processLabel "${esc(type.label)}" ;`,
    `    tc:title "${esc(record.title)}" ;`,
    `    tc:registeredAt "${record.registeredAt}"^^xsd:dateTime ;`,
    `    tc:owner <${record.ownerWebId}> ;`,
  ];
  for (const f of record.files) {
    lines.push(`    ${f.isLeadDoc ? 'tc:leadDocument' : 'tc:processDocument'} <${f.url}> ;`);
  }
  // Material-ID folgt: sobald bekannt, kommt hier tc:epc dazu (gleiches
  // Praedikat wie bei hpr/eldat, damit EPC-Abfragen ohne Sonderfall greifen).
  for (const epc of record.materialEpcs) {
    lines.push(`    tc:epc <${epc}> ;`);
  }
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .');
  return lines.join('\n') + '\n';
}

async function putToPod(
  authenticatedFetch: typeof fetch,
  url: string,
  content: ArrayBuffer | Blob | string,
  contentType: string,
): Promise<string> {
  const body =
    typeof content === 'string'
      ? new Blob([content], { type: contentType })
      : content instanceof Blob
        ? content
        : new Blob([content], { type: contentType });
  const response = await authenticatedFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error(`Authentifizierung fehlgeschlagen für ${url}`);
    if (response.status === 403) throw new Error(`Keine Berechtigung für ${url}`);
    throw new Error(`Upload fehlgeschlagen (${response.status}): ${url}`);
  }
  return url;
}

/** process.ttl (neu) schreiben bzw. nach Nachreichungen aktualisieren. */
export async function writeProcessDoc(
  record: ProcessRecord,
  authenticatedFetch: typeof fetch,
): Promise<void> {
  await putToPod(
    authenticatedFetch,
    `${record.containerUrl}process.ttl`,
    buildProcessTtl(record),
    'text/turtle',
  );
}

/**
 * Vorgang anlegen: Container im Pod, ACL wie beim bisherigen Upload,
 * process.ttl schreiben, lokal indizieren.
 *
 * Die Dateien selbst werden NICHT hier hochgeladen — das erledigen die
 * bestehenden Pfade (convertAndUploadWithSession fuer maschinenlesbare
 * Dateien, uploadPdfOriginal fuer PDFs). Ihre URLs werden anschliessend per
 * registerProcessFiles nachgetragen.
 */
export async function createProcess(
  params: {
    type: ProcessTypeId;
    title: string;
    ownerWebId: string;
  },
  authenticatedFetch: typeof fetch,
): Promise<ProcessRecord> {
  const id = generateProcessId();
  const podBase = podBaseFromWebId(params.ownerWebId);
  const containerUrl = `${podBase}data/${id}/`;

  const record: ProcessRecord = {
    id,
    type: params.type,
    registeredAt: new Date().toISOString(),
    containerUrl,
    ownerWebId: params.ownerWebId,
    title: params.title.trim() || defaultProcessTitle(params.type),
    files: [],
    eventIds: [],
    materialEpcs: [],
  };

  await writeProcessDoc(record, authenticatedFetch);

  try {
    const pod = podBaseFromUrl(containerUrl);
    const allowedRoles = await getAllowedRoles(pod);
    await stampContainerAcl(containerUrl, params.ownerWebId, allowedRoles);
    await writeEpcisConsent(params.ownerWebId, allowedRoles);
  } catch (err) {
    console.warn('[process] ACL konnte nicht gesetzt werden:', err);
  }

  upsertProcess(record);
  return record;
}

/** Hochgeladene Dateien dem Vorgang zuordnen und process.ttl auffrischen. */
export async function registerProcessFiles(
  processId: string,
  files: Omit<ProcessFileRef, 'addedAt'>[],
  authenticatedFetch: typeof fetch,
): Promise<ProcessRecord | null> {
  const now = new Date().toISOString();
  const updated = appendProcessFiles(
    processId,
    files.map((f) => ({ ...f, addedAt: now })),
  );
  if (!updated) return null;
  try {
    await writeProcessDoc(updated, authenticatedFetch);
  } catch (err) {
    console.warn('[process] process.ttl konnte nicht aktualisiert werden:', err);
  }
  return updated;
}

/** Zeitstempel der Registrierung, lesbar: "03.08.2026, 14:22". */
export function formatRegisteredAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
