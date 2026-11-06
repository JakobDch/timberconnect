/**
 * Vorab-Pruefung der Idente -- VOR dem ersten Schreibzugriff.
 *
 * Befund 19.10.2026: Die Demo-Idente trugen im Live-EPCAT bereits gestapelte
 * Events aus mehreren Pods (Stamm 1: 31 Events). Idente kommen fest aus den
 * Dateien (HPR-Tags, AcroForm "Identity", Excel-Blatt Identifikation); wer
 * dieselbe Datei hochlaedt, vergibt dieselben Idente noch einmal, und der
 * Viewer vermischt dann die Daten aller Pods, die sie fuehren.
 *
 * Deshalb wird jeder Vorgang vor dem Upload gegen das Repository gehalten:
 *
 *   frei      kein Event hat die Ausgangs-Idente erzeugt -> normaler Upload
 *   ersetzen  ein eigener Vorgang mit EXAKT demselben Event liegt schon vor
 *             -> auf Rueckfrage: Produktdaten im Pod ersetzen, KEIN neues
 *             Event (das vorhandene sagt bereits dasselbe aus)
 *   gesperrt  die Idente haelt ein anderer Teilnehmer, niemand Zuordenbares,
 *             oder der eigene fruehere Vorgang hatte andere Ident-Listen
 *
 * Die Entscheidung faellt im EPCIS-Dienst (services/ident_check.py), der
 * das EPCAT ohne Consent-Filter befragt -- die Frage ist "gibt es das
 * schon?", nicht "darf ich das sehen?". Hier werden die Dokumente
 * zusammengestellt, der Befund in Klartext uebersetzt und das Ersetzen
 * vorbereitet.
 */

import { getAuthFetch } from './authFetch';
import { extractPdfIdentity, type PdfIdentity } from './pdfIdentityService';
import { previewIdents, type IdentPreviewFile } from './uploadService';
import {
  forgetProcessesByContainer,
  getProcesses,
  type ProcessRecord,
} from './processService';
import {
  executePodReset,
  planPodReset,
  selectPlanContainers,
} from './podResetService';
import { getAllProductsAsync, type ProductConfig } from '../config/solidPods';
import { invalidateCache as invalidateCatalogCache } from './catalogService';

const EPCIS_BASE =
  import.meta.env.VITE_EPCIS_SERVICE_URL ||
  (typeof window !== 'undefined' ? `${window.location.origin}/api/epcis` : '/api/epcis');

export type ProposedEventType = 'ObjectEvent' | 'TransformationEvent';

/** Was EIN Dokument beim Upload ins EPCAT schreiben wuerde. */
export interface ProposedDocument {
  /** Beschriftung fuer den Nutzer (Vorlagenname bzw. Dateiname). */
  label: string;
  fileName: string;
  eventType: ProposedEventType;
  /** Idente, die das Dokument ERZEUGT (Ausgangsseite). */
  outputEpcs: string[];
  /** Idente, die es VERBRAUCHT (nur Umwandlungen). */
  inputEpcs: string[];
}

/**
 * PDF-Vorlagen, die ein Event ausloesen -- Spiegel von EPCIS_PDF_DATA_TYPES
 * im Konverter (main.py). Beidokumente (Transportauftrag, Biegepruefung ...)
 * erzeugen bewusst kein Event und brauchen deshalb keine Pruefung.
 */
export const EVENT_TEMPLATE_DATA_TYPES: Record<string, ProposedEventType> = {
  pdf_stammzertifikat: 'ObjectEvent',
  pdf_leistungserklaerung: 'TransformationEvent',
};

export type IdentStatus =
  | 'free'
  | 'own-identical'
  | 'own-different'
  | 'foreign'
  | 'unassigned';

/** Befund des EPCIS-Dienstes je Dokument (services/ident_check.py). */
export interface DocumentVerdict {
  label: string;
  status: IdentStatus;
  /** Pods, die erzeugende Events fuer die Ausgangs-Idente halten. */
  ownerPods: string[];
  /** bizTransaction-URLs der eigenen Treffer -- Rueckweg zum Container. */
  ownBizTransactions: string[];
  takenEpcs: string[];
  missingInputs: string[];
  existingEventCount: number;
}

export type PreflightOutcome = 'free' | 'replace' | 'blocked';

export interface PreflightSummary {
  outcome: PreflightOutcome;
  title: string;
  /** Klartext fuer einen Teilnehmer der Kette -- keine Technik. */
  message: string;
  /** Hinweise, die nicht sperren (z.B. unbekanntes Vormaterial). */
  notes: string[];
  verdicts: DocumentVerdict[];
  /** Dateien, deren Event bereits vorliegt (beim Ersetzen kein Capture). */
  replaceFiles: string[];
  /** Ausgangs-Idente aller zu ersetzenden Dokumente. */
  replaceEpcs: string[];
  ownBizTransactions: string[];
  /**
   * Vorhandene eigene Dokumente OHNE Event, die der Upload ersetzt
   * (mergeExistingDocuments). Sie werden einzeln entfernt, nicht ihr Vorgang.
   */
  replaceDocuments?: string[];
}

// ---------------------------------------------------------------------------
// Dokumente zusammenstellen
// ---------------------------------------------------------------------------

function unique(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)));
}

/**
 * Das Event eines PDFs aus seinem eingebetteten Ident ableiten.
 *
 * Nur Vorlagen aus EVENT_TEMPLATE_DATA_TYPES; alles andere liefert null.
 * Saegevorgaenge (Identity_n / IdentityInput_n) werden zu EINEM Dokument mit
 * der Vereinigung aller Eingaenge und Ausgaenge zusammengefasst -- der
 * EPCIS-Dienst vergleicht ohnehin je Quelle, nicht je Einzel-Event.
 */
export function proposedFromPdfIdentity(
  fileName: string,
  template: { label: string; dataType: string } | null,
  identity: PdfIdentity | null,
): ProposedDocument | null {
  if (!template || !identity) return null;
  const eventType = EVENT_TEMPLATE_DATA_TYPES[template.dataType];
  if (!eventType) return null;

  if (identity.sawings && identity.sawings.length > 0) {
    return {
      label: template.label,
      fileName,
      eventType,
      outputEpcs: unique(identity.sawings.flatMap((s) => s.materialEpc)),
      inputEpcs: unique(identity.sawings.flatMap((s) => s.materialInputEpc)),
    };
  }
  return {
    label: template.label,
    fileName,
    eventType,
    outputEpcs: unique([identity.epc]),
    inputEpcs: unique(identity.inputEpc ? [identity.inputEpc] : []),
  };
}

/** Das Event einer maschinenlesbaren Datei aus der Konverter-Vorschau. */
export function proposedFromPreview(file: IdentPreviewFile): ProposedDocument | null {
  if (!file.creates_event || !file.event_type) return null;
  if (file.event_type !== 'ObjectEvent' && file.event_type !== 'TransformationEvent') {
    return null;
  }
  return {
    label: file.filename,
    fileName: file.filename,
    eventType: file.event_type,
    outputEpcs: unique(file.output_epcs ?? []),
    inputEpcs: unique(file.input_epcs ?? []),
  };
}

export interface DraftForPreflight {
  file: File;
  isPdf: boolean;
  template: { label: string; dataType: string; id?: string } | null;
}

interface CollectDeps {
  extractIdentity: (buffer: ArrayBuffer) => Promise<PdfIdentity | null>;
  previewIdents: (files: File[], companyPrefix: string) => Promise<IdentPreviewFile[]>;
}

const defaultCollectDeps: CollectDeps = {
  extractIdentity: extractPdfIdentity,
  previewIdents,
};

/**
 * Alle Event-erzeugenden Dokumente eines Entwurfs.
 *
 * PDFs werden lokal gelesen (das AcroForm steckt in der gewaehlten Datei),
 * maschinenlesbare Dateien fragt der Konverter -- ohne RML, ohne Capture.
 * Fehler einzelner Dateien sperren nicht, sie werden gemeldet: Eine Datei,
 * die sich nicht lesen laesst, scheitert spaeter ohnehin im Upload.
 */
export async function collectProposedDocuments(
  drafts: DraftForPreflight[],
  companyPrefix: string,
  deps: CollectDeps = defaultCollectDeps,
): Promise<{ documents: ProposedDocument[]; errors: string[] }> {
  const documents: ProposedDocument[] = [];
  const errors: string[] = [];

  for (const draft of drafts.filter((d) => d.isPdf)) {
    if (!draft.template || !EVENT_TEMPLATE_DATA_TYPES[draft.template.dataType]) continue;
    try {
      const identity = await deps.extractIdentity(await draft.file.arrayBuffer());
      const doc = proposedFromPdfIdentity(draft.file.name, draft.template, identity);
      if (doc) documents.push(doc);
    } catch (err) {
      errors.push(
        `${draft.file.name}: ${err instanceof Error ? err.message : 'Ident nicht lesbar'}`,
      );
    }
  }

  const machine = drafts.filter((d) => !d.isPdf).map((d) => d.file);
  if (machine.length > 0) {
    const preview = await deps.previewIdents(machine, companyPrefix);
    for (const entry of preview) {
      if (entry.error) errors.push(`${entry.filename}: ${entry.error}`);
      const doc = proposedFromPreview(entry);
      if (doc) documents.push(doc);
    }
  }

  return { documents, errors };
}

// ---------------------------------------------------------------------------
// Pruefung am EPCIS-Dienst
// ---------------------------------------------------------------------------

/**
 * Die Dokumente gegen das Repository halten. Laeuft ueber die angemeldete
 * Session: Nur so weiss der Dienst, wessen Vorgaenge "eigene" sind.
 */
export async function checkProposedDocuments(
  documents: ProposedDocument[],
): Promise<{ verdicts: DocumentVerdict[]; callerPod: string | null }> {
  const response = await getAuthFetch()(`${EPCIS_BASE}/check-idents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documents: documents.map((d) => ({
        label: d.label,
        event_type: d.eventType,
        output_epcs: d.outputEpcs,
        input_epcs: d.inputEpcs,
      })),
    }),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Nicht angemeldet — bitte zuerst mit dem Solid Pod anmelden.');
    }
    const detail = await response
      .json()
      .then((b) => b.detail)
      .catch(() => null);
    throw new Error(detail || `Ident-Prüfung fehlgeschlagen (${response.status})`);
  }
  const body = await response.json();
  const verdicts: DocumentVerdict[] = (body.documents ?? []).map(
    (d: Record<string, unknown>) => ({
      label: String(d.label ?? ''),
      status: (d.status as IdentStatus) ?? 'free',
      ownerPods: (d.owner_pods as string[]) ?? [],
      ownBizTransactions: (d.own_biz_transactions as string[]) ?? [],
      takenEpcs: (d.taken_epcs as string[]) ?? [],
      missingInputs: (d.missing_inputs as string[]) ?? [],
      existingEventCount: Number(d.existing_event_count ?? 0),
    }),
  );
  return { verdicts, callerPod: (body.caller_pod as string | null) ?? null };
}

// ---------------------------------------------------------------------------
// Befund in Klartext
// ---------------------------------------------------------------------------

/** "https://host/sawmill/" -> "sawmill" */
export function podLabel(podBase: string): string {
  const segments = podBase.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? podBase;
}

function joinLabels(labels: string[]): string {
  const list = unique(labels).map((l) => `„${l}“`);
  if (list.length <= 1) return list[0] ?? 'diesem Dokument';
  return `${list.slice(0, -1).join(', ')} und ${list[list.length - 1]}`;
}

/**
 * Aus den Befunden je Dokument die eine Entscheidung fuer den Vorgang.
 *
 * Sperren wiegt schwerer als Ersetzen: Liegt auch nur ein Dokument bei
 * einem anderen Teilnehmer, darf nichts hochgeladen werden -- sonst
 * entstuende genau die halbe Dublette, die am schwersten zu bereinigen ist.
 */
export function summarizePreflight(
  verdicts: DocumentVerdict[],
  documents: ProposedDocument[] = [],
): PreflightSummary {
  const notes: string[] = [];
  for (const v of verdicts) {
    if (v.missingInputs.length > 0) {
      notes.push(
        `Vormaterial unbekannt: ${v.missingInputs.length === 1 ? 'Eine Material-ID' : `${v.missingInputs.length} Material-IDs`} ` +
          `des Vormaterials aus „${v.label}“ ${v.missingInputs.length === 1 ? 'ist' : 'sind'} im Datenraum noch nicht registriert. ` +
          'Der Vorgang lässt sich trotzdem hochladen, die Herkunftskette bleibt dort aber unterbrochen.',
      );
    }
  }

  const byLabel = (status: IdentStatus) =>
    verdicts.filter((v) => v.status === status).map((v) => v.label);
  const base = {
    notes,
    verdicts,
    replaceFiles: [] as string[],
    replaceEpcs: [] as string[],
    ownBizTransactions: verdicts.flatMap((v) => v.ownBizTransactions),
  };

  const foreign = verdicts.filter((v) => v.status === 'foreign');
  if (foreign.length > 0) {
    const pods = unique(foreign.flatMap((v) => v.ownerPods).map(podLabel));
    return {
      ...base,
      outcome: 'blocked',
      title: 'Material-IDs bereits vergeben',
      message:
        `Die Material-IDs aus ${joinLabels(foreign.map((v) => v.label))} sind im Datenraum schon vergeben. ` +
        `Die zugehörigen Daten liegen bei ${pods.length === 1 ? 'einem anderen Teilnehmer' : 'anderen Teilnehmern'}` +
        (pods.length ? ` (${pods.join(', ')})` : '') +
        '. Ein Vorgang kann im Datenraum nur einmal registriert werden. ' +
        'Bitte prüfen Sie, ob Sie die richtige Datei gewählt haben – für einen neuen Vorgang brauchen Sie Dokumente mit neuen Material-IDs.',
    };
  }

  const unassigned = byLabel('unassigned');
  if (unassigned.length > 0) {
    return {
      ...base,
      outcome: 'blocked',
      title: 'Material-IDs bereits vergeben',
      message:
        `Die Material-IDs aus ${joinLabels(unassigned)} sind im Datenraum schon vergeben, lassen sich aber keinem Teilnehmer zuordnen. ` +
        'Ein Upload ist deshalb nicht möglich. Bitte wenden Sie sich an den Betreiber des Datenraums.',
    };
  }

  const ownDifferent = byLabel('own-different');
  if (ownDifferent.length > 0) {
    return {
      ...base,
      outcome: 'blocked',
      title: 'Vorgang mit geänderten Material-IDs',
      message:
        `Sie haben die Material-IDs aus ${joinLabels(ownDifferent)} schon in einem früheren Vorgang registriert – dort mit anderen Material-IDs für Vormaterial oder Erzeugnis. ` +
        'Ein Vorgang mit geänderten IDs lässt sich nicht ersetzen. Bitte prüfen Sie, ob Sie die richtige Datei gewählt haben.',
    };
  }

  const identical = verdicts.filter((v) => v.status === 'own-identical');
  if (identical.length > 0) {
    const labels = identical.map((v) => v.label);
    const files = documents.filter((d) => labels.includes(d.label));
    return {
      ...base,
      outcome: 'replace',
      title: 'Diesen Vorgang haben Sie bereits registriert',
      message:
        `Die Material-IDs aus ${joinLabels(labels)} sind im Datenraum schon vergeben – durch einen früheren Vorgang aus Ihrem eigenen Pod mit denselben Angaben. ` +
        'Die Ereignisse im Datenraum bleiben bestehen. Wenn Sie fortfahren, werden nur die Produktdaten in Ihrem Pod durch die neuen Dateien ersetzt.',
      replaceFiles: files.map((d) => d.fileName),
      replaceEpcs: unique(files.flatMap((d) => d.outputEpcs)),
    };
  }

  return {
    ...base,
    outcome: 'free',
    title: 'Material-IDs sind frei',
    message: 'Keine der Material-IDs ist im Datenraum vergeben.',
  };
}

// ---------------------------------------------------------------------------
// Ersetzen: den fruehere Vorgang im eigenen Pod finden und raeumen
// ---------------------------------------------------------------------------

export interface OwnContainerMatch {
  containerUrl: string;
  /** Vorgangs-ID (VG-...), falls der Container eine traegt. */
  processId: string | null;
  /** Ueber welchen Weg der Container gefunden wurde. */
  via: 'local-index' | 'biz-transaction' | 'catalog';
}

interface ResolveDeps {
  getProcesses: () => ProcessRecord[];
  getProducts: () => Promise<ProductConfig[]>;
  exists: (url: string) => Promise<boolean>;
}

async function headExists(url: string): Promise<boolean> {
  try {
    const response = await getAuthFetch()(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

const defaultResolveDeps: ResolveDeps = {
  getProcesses,
  getProducts: getAllProductsAsync,
  exists: headExists,
};

function processIdOf(containerUrl: string): string | null {
  const match = containerUrl.match(/\/(VG-\d{4}-\d{4}-[0-9a-f]+)\/$/i);
  return match ? match[1] : null;
}

/**
 * Den Container des frueheren Vorgangs finden -- in DIESER Reihenfolge:
 *
 *   1. lokaler Vorgangsindex (kennt Container und Idente, kostet nichts)
 *   2. bizTransaction des vorhandenen Events: sie zeigt in den Pod, bei
 *      Maschinendaten auf data/<hash> bzw. in den Vorgangscontainer. Bei
 *      PDFs steht dort die Dokumentnummer, die kein Container ist -- dann
 *      greift die Probe nicht, und es geht weiter mit 3.
 *   3. Katalog: der Datensatz zum Ident liegt im eigenen Pod, sein
 *      Ordner ist der Container.
 *
 * null = nicht gefunden. Dann wird NICHT geraten: Ein Ersetzen in den
 * falschen Container liesse die alten Daten stehen, und die Dublette, die
 * die Pruefung verhindern soll, entstuende im eigenen Pod.
 */
export async function resolveOwnContainer(
  outputEpcs: string[],
  ownBizTransactions: string[],
  podBase: string,
  deps: ResolveDeps = defaultResolveDeps,
): Promise<OwnContainerMatch | null> {
  const wanted = new Set(outputEpcs);

  const local = deps
    .getProcesses()
    .find(
      (p) =>
        p.containerUrl.startsWith(podBase) &&
        p.materialEpcs.some((e) => wanted.has(e)),
    );
  if (local) {
    return { containerUrl: local.containerUrl, processId: local.id, via: 'local-index' };
  }

  for (const url of ownBizTransactions) {
    if (!url.startsWith(podBase)) continue;
    const candidates: string[] = [];
    const vg = url.match(/^(.*\/data\/VG-\d{4}-\d{4}-[0-9a-f]+\/)/i);
    if (vg) candidates.push(vg[1]);
    const last = url.split('/').filter(Boolean).pop();
    if (last) candidates.push(`${podBase}data/${last}/`);
    for (const candidate of candidates) {
      if (await deps.exists(candidate)) {
        return { containerUrl: candidate, processId: processIdOf(candidate), via: 'biz-transaction' };
      }
    }
  }

  try {
    const products = await deps.getProducts();
    for (const product of products) {
      if (!wanted.has(product.id)) continue;
      const source = product.sources.find((s) => s.startsWith(podBase));
      if (!source) continue;
      const containerUrl = source.slice(0, source.lastIndexOf('/') + 1);
      return { containerUrl, processId: processIdOf(containerUrl), via: 'catalog' };
    }
  } catch (err) {
    console.warn('[preflight] Katalog fuer die Container-Suche nicht erreichbar:', err);
  }

  return null;
}

/**
 * Den frueheren Vorgang aus dem eigenen Pod raeumen, damit der neue Upload
 * an dieselbe Stelle kann.
 *
 * Nutzt den Loeschdienst des Verwaltungsbereichs: derselbe Plan, dieselben
 * Schutzregeln (nur eigene Container unter data/), dieselbe Bereinigung der
 * Katalogeintraege. Das EPCAT bleibt unberuehrt -- das ist der Sinn des
 * Ersetzens.
 */
export async function clearOwnContainer(
  containerUrl: string,
  webId: string,
): Promise<{ deletedFiles: number }> {
  const plan = await planPodReset(webId);
  const scoped = selectPlanContainers(plan, [containerUrl]);
  if (scoped.containers.length === 0) {
    throw new Error(
      'Der frühere Vorgang wurde in Ihrem Pod nicht gefunden. Bitte löschen Sie ihn unter „Verwaltung → Vorgänge löschen“ und laden Sie danach erneut hoch.',
    );
  }
  const outcome = await executePodReset(scoped);
  if (outcome.errors.length > 0) {
    throw new Error(`Frühere Daten konnten nicht entfernt werden: ${outcome.errors.join('; ')}`);
  }
  forgetProcessesByContainer([containerUrl]);
  // Der Katalog kennt die geloeschten Datensaetze noch; der naechste Aufruf
  // soll den neuen Stand lesen.
  invalidateCatalogCache();
  return { deletedFiles: outcome.deletedFiles };
}

// ---------------------------------------------------------------------------
// Dokumente OHNE eigenes Event: Pruefung im Datenraum statt im EPCAT
// ---------------------------------------------------------------------------

/**
 * Beidokumente (Transportauftrag, Pruefzertifikat ...) und die
 * Ausfuehrungsplanung erzeugen kein Event. Im EPCAT hinterlassen sie keine
 * Spur, an der eine Dublette zu erkennen waere -- der Fall vom 06.11.2026:
 * dieselbe Ausfuehrungsplanung ging ein zweites Mal durch.
 *
 * Fuer sie wird deshalb der Datenraum selbst befragt: Liegt zu derselben
 * Material-ID schon ein Dokument DERSELBEN ART vor? Die Art steht im
 * Dateinamen ("<Dokument-ID>_<Art>.ttl", z.B. "..._planung.ttl" oder
 * "..._pdf_transportauftrag.ttl").
 *
 * Grenze: Sichtbar ist nur, was der Katalog kennt und die eigene Rolle lesen
 * darf. Was ein anderer Teilnehmer nicht freigegeben hat, entgeht der
 * Pruefung -- anders als am EPCAT, das ohne Freigabefilter gefragt wird.
 */
export interface ReferenceDocument {
  label: string;
  fileName: string;
  /** Dokumentart wie im Dateinamen: Vorlagen-ID bzw. "planung". */
  kind: string;
  epcs: string[];
}

export interface ExistingDocument {
  label: string;
  /** URL der vorhandenen Datei (TTL bzw. Original). */
  url: string;
  own: boolean;
  podBase: string | null;
}

/** "…/data/VG-…/1a2b_pdf_transportauftrag.ttl" -> "pdf_transportauftrag" */
export function documentKindOfUrl(url: string): string | null {
  const name = url.slice(url.lastIndexOf('/') + 1);
  const match = /^[^_]+_(.+?)\.[a-z0-9]+$/i.exec(name);
  return match ? match[1] : null;
}

/** Die Pod-Basis einer URL ("https://host/pod/"). */
function podBaseOf(url: string): string | null {
  const match = url.match(/^(https?:\/\/[^/]+\/[^/]+\/)/);
  return match ? match[1] : null;
}

export interface ReferenceDraft extends DraftForPreflight {
  /** Bauteil-ID der Ausfuehrungsplanung (aus der Datei oder eingegeben). */
  ifcEpc?: string | null;
}

/**
 * Die Dokumente ohne eigenes Event samt ihrer Material-IDs. PDFs werden
 * lokal gelesen, die IFC-ID kommt aus dem Upload-Formular.
 */
export async function collectReferenceDocuments(
  drafts: ReferenceDraft[],
  extractIdentity: (buffer: ArrayBuffer) => Promise<PdfIdentity | null> = extractPdfIdentity,
): Promise<ReferenceDocument[]> {
  const out: ReferenceDocument[] = [];
  for (const draft of drafts) {
    const name = draft.file.name.toLowerCase();
    if (!draft.isPdf && name.endsWith('.ifc')) {
      if (draft.ifcEpc) {
        out.push({ label: 'Ausführungsplanung', fileName: draft.file.name, kind: 'planung', epcs: [draft.ifcEpc] });
      }
      continue;
    }
    if (!draft.isPdf || !draft.template) continue;
    const template = draft.template;
    if (EVENT_TEMPLATE_DATA_TYPES[template.dataType]) continue;
    try {
      const identity = await extractIdentity(await draft.file.arrayBuffer());
      if (!identity) continue;
      const epcs = identity.sawings?.length
        ? unique(identity.sawings.flatMap((s) => s.materialEpc))
        : unique([identity.epc]);
      out.push({
        label: template.label,
        fileName: draft.file.name,
        kind: template.id ?? template.dataType,
        epcs,
      });
    } catch {
      // Unlesbares PDF: Ohne ID gibt es nichts zu vergleichen.
    }
  }
  return out;
}

interface ExistingDeps {
  getProducts: () => Promise<ProductConfig[]>;
  getProcesses: () => ProcessRecord[];
}

/**
 * Vorhandene Dokumente gleicher Art zu denselben Material-IDs.
 *
 * Zwei Quellen: der Katalog des Datenraums (alle Pods) und der lokale
 * Vorgangsindex (eigene Uploads dieser Sitzung, die der zwischengespeicherte
 * Katalog noch nicht kennt).
 */
export async function findExistingDocuments(
  documents: ReferenceDocument[],
  ownPodBase: string,
  deps: ExistingDeps = { getProducts: getAllProductsAsync, getProcesses },
): Promise<ExistingDocument[]> {
  if (documents.length === 0) return [];
  const products = await deps.getProducts();
  const found = new Map<string, ExistingDocument>();

  for (const doc of documents) {
    const wanted = new Set(doc.epcs);
    const candidates: string[] = [];
    for (const product of products) {
      if (wanted.has(product.id)) candidates.push(...product.sources);
    }
    for (const process of deps.getProcesses()) {
      if (process.materialEpcs.some((e) => wanted.has(e))) {
        candidates.push(...process.files.map((f) => f.url));
      }
    }
    for (const url of candidates) {
      if (documentKindOfUrl(url) !== doc.kind || found.has(`${doc.fileName}|${url}`)) continue;
      const podBase = podBaseOf(url);
      found.set(`${doc.fileName}|${url}`, {
        label: doc.label,
        url,
        own: podBase === ownPodBase,
        podBase,
      });
    }
  }

  // Original und TTL desselben Dokuments sind EIN Treffer.
  const byDocument = new Map<string, ExistingDocument>();
  for (const hit of found.values()) {
    const key = `${hit.label}|${hit.url.replace(/_[^/]+$/, '')}`;
    if (!byDocument.has(key) || hit.url.endsWith('.ttl')) byDocument.set(key, hit);
  }
  return [...byDocument.values()];
}

/**
 * Den Befund fuer Dokumente ohne Event mit dem EPCAT-Befund zusammenfuehren.
 * Fremd sperrt, eigen fuehrt zur Rueckfrage -- dieselben Regeln wie fuer
 * Dokumente mit Event.
 */
export function mergeExistingDocuments(
  summary: PreflightSummary,
  existing: ExistingDocument[],
): PreflightSummary {
  if (existing.length === 0 || summary.outcome === 'blocked') return summary;

  const foreign = existing.filter((e) => !e.own);
  if (foreign.length > 0) {
    const pods = unique(foreign.map((e) => (e.podBase ? podLabel(e.podBase) : '')));
    return {
      ...summary,
      outcome: 'blocked',
      title: 'Dokument bereits vorhanden',
      message:
        `${joinLabels(foreign.map((e) => e.label))} zu diesem Material liegt im Datenraum bereits vor – ` +
        `bei ${pods.length === 1 ? 'einem anderen Teilnehmer' : 'anderen Teilnehmern'}` +
        (pods.length ? ` (${pods.join(', ')})` : '') +
        '. Ein Dokument dieser Art kann es je Material nur einmal geben. Bitte prüfen Sie, ob Sie die richtige Datei gewählt haben.',
    };
  }

  const labels = existing.map((e) => e.label);
  return {
    ...summary,
    outcome: 'replace',
    title: 'Dieses Dokument haben Sie bereits hochgeladen',
    message:
      summary.outcome === 'replace'
        ? `${summary.message} Zusätzlich wird ${joinLabels(labels)} durch die neue Datei ersetzt.`
        : `${joinLabels(labels)} zu diesem Material liegt bereits in Ihrem Pod. Wenn Sie fortfahren, wird das vorhandene Dokument durch die neue Datei ersetzt.`,
    replaceDocuments: existing.map((e) => e.url),
  };
}
