/**
 * Den Vorgang zu einem Container nachschlagen — auch in fremden Pods.
 *
 * Der lokale Vorgangsindex (processService, localStorage) kennt nur die
 * Vorgaenge, die AUF DIESEM GERAET registriert wurden. Im Downloadbereich
 * stehen aber die Dokumente der ganzen Lieferkette: das Harvesterprotokoll
 * liegt im Pod des Forstbetriebs, der ERP-Auszug im Pod des Produzenten.
 * Deren Vorgangsnamen stehen nur in der jeweiligen process.ttl.
 *
 * DREI WEGE, in dieser Reihenfolge:
 *
 *   1. Lokaler Index — kostet nichts. Er kennt den Container UND die
 *      Datei-URLs jedes Vorgangs; letzteres ist der Rueckweg fuer Fall 3.
 *   2. process.ttl im Container der Datei — der Normalfall seit 31.08.2026,
 *      seit Dateien in den Vorgangscontainer gelegt werden.
 *   3. Dokumentverweise anderer Vorgangscontainer im selben Pod. Zwischen
 *      dem 21.08. (Vorgangsregistrierung eingefuehrt) und dem 31.08.
 *      (Dateien wandern in den Vorgangscontainer) zerfiel ein Vorgang im
 *      Pod in mehrere Container: "data/VG-2026-0828-xxxx/" mit nur der
 *      process.ttl, daneben "data/<hash>/" je Datei. Die process.ttl
 *      verweist per tc:leadDocument / tc:processDocument auf diese Dateien
 *      — darueber findet die Datei ihren Vorgang zurueck. Die
 *      bspwerk-Uploads vom 28.08.2026 sind genau dieser Bestand; ohne
 *      Weg 3 standen sie als "ohne Vorgang" da, obwohl der Vorgang
 *      registriert war.
 *
 * Weg 3 setzt voraus, dass der Vorgangscontainer ueberhaupt sichtbar ist.
 * Im eigenen Pod ist er das (data/ auflistbar), auf dem Geraet des
 * Hochladenden ueber Weg 1. Fuer Fremde bleibt er unsichtbar, solange
 * weder Katalog noch Auflistung auf ihn zeigen — das ist ein Datenbefund,
 * kein Anzeigefehler, und wird als solcher gemeldet.
 *
 * ZWISCHENSPEICHER: Jede process.ttl wird hoechstens einmal je Sitzung
 * gelesen, inklusive der Fehlschlaege.
 */

import {
  getSolidDataset,
  getThing,
  getDatetime,
  getStringNoLocale,
  getUrlAll,
} from '@inrupt/solid-client';
import { getAuthFetch } from './authFetch';
import { NAMESPACES } from '../config/solidPods';
import { getProcesses, type ProcessRecord } from './processService';

const TC_PROCESS_LABEL = `${NAMESPACES.tc}processLabel`;
const TC_TITLE = `${NAMESPACES.tc}title`;
const TC_REGISTERED_AT = `${NAMESPACES.tc}registeredAt`;
const TC_PROCESS_ID = `${NAMESPACES.tc}processId`;
const TC_LEAD_DOCUMENT = `${NAMESPACES.tc}leadDocument`;
const TC_PROCESS_DOCUMENT = `${NAMESPACES.tc}processDocument`;

/** Ueber welchen Weg der Vorgang gefunden wurde — fuer Diagnose und Tests. */
export type ProcessSource = 'local-index' | 'container' | 'document-link' | 'none';

export interface ProcessInfo {
  /** Vorgangstyp im Klartext, z.B. "Fällvorgang". */
  label: string | null;
  /** Vom Nutzer vergebener Titel, falls er etwas anderes sagt als der Typ. */
  title: string | null;
  /** Zeitpunkt der Registrierung. */
  registeredAt: Date | null;
  /** Fachliche Vorgangs-ID, z.B. "VG-2026-0007". */
  processId: string | null;
  source: ProcessSource;
  /**
   * True, wenn die process.ttl im Container NICHT gelesen werden konnte
   * (403, Netz, kein RDF). Unterscheidet "kein Vorgang" von "Vorgang da,
   * aber unlesbar" -- in der Anzeige sah beides identisch aus.
   */
  unreadable?: boolean;
  /** HTTP-Status des Fehlschlags, sofern bekannt. */
  status?: number | null;
}

const EMPTY: ProcessInfo = {
  label: null,
  title: null,
  registeredAt: null,
  processId: null,
  source: 'none',
  unreadable: false,
  status: null,
};

/** Eine gelesene process.ttl: die Angaben plus die Dateien, auf die sie zeigt. */
interface ProcessDoc {
  info: ProcessInfo;
  /** URLs aus tc:leadDocument / tc:processDocument. */
  documentUrls: string[];
}

/** containerUrl -> gelesene process.ttl (auch negativ belegt). */
const docCache = new Map<string, ProcessDoc>();
/** Laufende Abfragen, damit gleichzeitige Aufrufe sich einen Netzaufruf teilen. */
const inFlight = new Map<string, Promise<ProcessDoc>>();

/** Container-URL einer Datei: alles bis zum letzten Schraegstrich. */
export function containerOf(fileUrl: string): string {
  return fileUrl.slice(0, fileUrl.lastIndexOf('/') + 1);
}

/** Pod-Basis einer URL ("https://host/pod/"), wie in fileBrowserService. */
export function podOf(url: string): string | null {
  const match = url.match(/^(https?:\/\/[^/]+\/[^/]+\/)/);
  return match ? match[1] : null;
}

/**
 * Die Vorgangs-ID aus dem Container-NAMEN lesen.
 *
 * createProcess legt den Container unter "data/<Vorgangs-ID>/" an, die ID
 * hat die Form VG-<jahr>-<mmdd>-<hex>. Steht sie im Pfad, ist der Container
 * nachweislich ein registrierter Vorgang -- auch wenn die process.ttl gerade
 * nicht lesbar ist.
 */
export function containerProcessId(containerUrl: string): string | null {
  const match = containerUrl.match(/\/(VG-\d{4}-\d{4}-[0-9a-f]+)\/$/i);
  return match ? match[1] : null;
}

/**
 * Typ-ID -> Anzeigename.
 *
 * Bewusst hier gespiegelt statt processLabel() aufzurufen: jene Funktion
 * wirft bei unbekannter ID (getProcessType), und ein Alt-Bestand mit einem
 * inzwischen umbenannten Typ soll die Anzeige nicht zum Absturz bringen.
 */
const PROCESS_LABELS: Record<string, string> = {
  pflanzung: 'Pflanzvorgang',
  faellung: 'Fällvorgang',
  aufsaegung: 'Aufsägevorgang',
  herstellung: 'Herstellungsvorgang',
  planung: 'Ausführungsplanung',
};

function infoFromRecord(record: ProcessRecord): ProcessInfo {
  return {
    label: PROCESS_LABELS[record.type] ?? null,
    title: record.title || null,
    registeredAt: record.registeredAt ? new Date(record.registeredAt) : null,
    processId: record.id,
    source: 'local-index',
  };
}

// ---------------------------------------------------------------------------
// Weg 1: lokaler Index (rein, testbar)
// ---------------------------------------------------------------------------

/**
 * Den Container im lokalen Index suchen — direkt ueber seine URL oder
 * rueckwaerts ueber die Datei-URLs der Vorgaenge.
 *
 * Der Rueckweg deckt den Bestand ab, bei dem die Dateien NEBEN dem
 * Vorgangscontainer liegen (siehe Kopfkommentar, Weg 3): der Index hat sich
 * beim Upload gemerkt, welche URL zu welchem Vorgang gehoert.
 */
export function matchLocalIndex(
  containerUrl: string,
  records: ProcessRecord[],
): ProcessInfo | null {
  const direct = records.find((r) => r.containerUrl === containerUrl);
  if (direct) return infoFromRecord(direct);

  const viaFiles = records.find((r) => r.files.some((f) => f.url.startsWith(containerUrl)));
  return viaFiles ? infoFromRecord(viaFiles) : null;
}

// ---------------------------------------------------------------------------
// Weg 3: Dokumentverweise (rein, testbar)
// ---------------------------------------------------------------------------

/**
 * Den Vorgang finden, dessen process.ttl auf eine Datei in diesem Container
 * zeigt.
 */
export function matchDocumentLinks(
  containerUrl: string,
  docs: Iterable<ProcessDoc>,
): ProcessInfo | null {
  for (const doc of docs) {
    if (!doc.info.label) continue;
    if (doc.documentUrls.some((url) => url.startsWith(containerUrl))) {
      return { ...doc.info, source: 'document-link' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Weg 2: process.ttl lesen (Netz)
// ---------------------------------------------------------------------------

async function readProcessDoc(containerUrl: string): Promise<ProcessDoc> {
  const url = `${containerUrl}process.ttl`;
  try {
    const ds = await getSolidDataset(url, { fetch: getAuthFetch() });
    const info: ProcessInfo = { ...EMPTY, source: 'container' };
    const documentUrls: string[] = [];
    // Das Subjekt ist die Container-URL selbst (siehe buildProcessTtl, so
    // seit dem ersten Tag); die zweite Form deckt aeltere Schreibweisen ab.
    for (const subject of [containerUrl, `${url}#process`]) {
      const thing = getThing(ds, subject);
      if (!thing) continue;
      info.label ??= getStringNoLocale(thing, TC_PROCESS_LABEL);
      info.title ??= getStringNoLocale(thing, TC_TITLE);
      info.registeredAt ??= getDatetime(thing, TC_REGISTERED_AT);
      info.processId ??= getStringNoLocale(thing, TC_PROCESS_ID);
      documentUrls.push(
        ...getUrlAll(thing, TC_LEAD_DOCUMENT),
        ...getUrlAll(thing, TC_PROCESS_DOCUMENT),
      );
    }
    if (!info.label) {
      // Datei da und lesbar, aber ohne tc:processLabel -- etwas anderes als
      // "kein Vorgang", und muss deshalb sichtbar sein.
      console.warn('[processLookup] process.ttl ohne tc:processLabel:', url);
    }
    return { info, documentUrls };
  } catch (e) {
    // NICHT stillschweigend schlucken: Ein 403 sieht in der Anzeige genauso
    // aus wie "Container ohne Vorgang", ist aber ein anderer Befund.
    const status =
      (e as { statusCode?: number })?.statusCode ?? (e as { status?: number })?.status ?? null;
    // 404 ist bei Hash-Containern des Alt-Bestands der Regelfall (die
    // process.ttl liegt im Nachbarcontainer) -- nur die uebrigen Faelle
    // sind auffaellig.
    if (status !== 404) {
      console.warn(`[processLookup] process.ttl nicht lesbar (${status ?? 'ohne Status'}):`, url, e);
    }
    return { info: { ...EMPTY, unreadable: true, status }, documentUrls: [] };
  }
}

function fetchProcessDoc(containerUrl: string): Promise<ProcessDoc> {
  const cached = docCache.get(containerUrl);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(containerUrl);
  if (running) return running;

  const promise = readProcessDoc(containerUrl).then((doc) => {
    docCache.set(containerUrl, doc);
    inFlight.delete(containerUrl);
    return doc;
  });
  inFlight.set(containerUrl, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

/**
 * Die Vorgaenge zu einer Menge von Datei-URLs bestimmen.
 *
 * Ergebnis: Container-URL -> Vorgang. Container ohne Treffer stehen mit
 * source 'none' darin, ggf. mit dem Grund (unreadable/status).
 */
export async function resolveProcesses(
  fileUrls: string[],
  records: ProcessRecord[] = getProcesses(),
): Promise<Map<string, ProcessInfo>> {
  const containers = Array.from(new Set(fileUrls.map(containerOf)));
  const result = new Map<string, ProcessInfo>();

  // Weg 1: lokaler Index.
  for (const container of containers) {
    const local = matchLocalIndex(container, records);
    if (local) result.set(container, local);
  }

  // Weg 2: eigene process.ttl.
  const pending = containers.filter((c) => !result.has(c));
  const docs = await Promise.all(pending.map(fetchProcessDoc));
  const docByContainer = new Map(pending.map((c, i) => [c, docs[i]] as const));
  for (const [container, doc] of docByContainer) {
    if (doc.info.label) result.set(container, doc.info);
  }

  // Weg 3: Dokumentverweise der sichtbaren Vorgangscontainer im selben Pod.
  const unresolved = pending.filter((c) => !result.has(c));
  if (unresolved.length > 0) {
    const vgContainers = containers.filter((c) => containerProcessId(c) !== null);
    const vgDocs = await Promise.all(
      vgContainers.map(async (c) => ({ pod: podOf(c), doc: await fetchProcessDoc(c) })),
    );
    for (const container of unresolved) {
      const pod = podOf(container);
      const hit = matchDocumentLinks(
        container,
        vgDocs.filter((v) => v.pod === pod).map((v) => v.doc),
      );
      if (hit) result.set(container, hit);
    }
  }

  // Rest: kein Vorgang gefunden -- mit dem Grund aus Weg 2, falls vorhanden.
  for (const container of containers) {
    if (!result.has(container)) {
      result.set(container, docByContainer.get(container)?.info ?? { ...EMPTY });
    }
  }
  return result;
}

/** Nur fuer Tests: den Zwischenspeicher leeren. */
export function clearProcessLookupCache(): void {
  docCache.clear();
  inFlight.clear();
}
