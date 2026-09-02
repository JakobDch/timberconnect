/**
 * Pod Reset Service — "Urzustand" fuer den eigenen Pod.
 *
 * Loescht NUR das, was die App selbst hochgeladen hat, und zwar ausschliesslich
 * im Pod des angemeldeten Nutzers. Alles, was Teilhabe am Datenraum ermoeglicht,
 * bleibt unangetastet.
 *
 * LOESCHBAR (entsteht nur durch Uploads):
 *   data/<traceId>/...     Vorgangs-Container: RDF, Originaldatei, PDF, Foto,
 *                          process.ttl, pricing.ttl, Schadensmeldungen
 *                          (uploadService, pdfDocumentService, processService,
 *                           productPhotoService, pricingService)
 *   catalog/ds/<uuid>.ttl      Katalog-Datensatz je Upload (catalogWriteService)
 *   catalog/records/<uuid>.ttl zugehoeriger Katalog-Record
 *   catalog/cat.ttl            NUR die Verweise auf geloeschte Eintraege
 *
 * GESCHUETZT (Infrastruktur — niemals anfassen):
 *   profile/       WebID, role.ttl (Rolle + Company Prefix)
 *   access/        role-policy.ttl, groups/ — die WAC-Grundlage
 *   wallet/        Guthaben und Kaufhistorie (bewusste Entscheidung)
 *   public/        Demo-Fundament (TC-2025-001) und Fremdbestand
 *   Settings/, inbox/, connections/, registry/, statistics/, token/
 *   catalog/cat.ttl als Datei (wird bereinigt, nie geloescht)
 *
 * Der Ablauf ist zweistufig: planPodReset() sammelt und zeigt, was getroffen
 * wuerde; erst executePodReset() loescht. Die WAC-Rechte des Servers bleiben
 * die eigentliche Grenze — dieser Service ist die zweite Sicherung davor.
 *
 * Dazwischen passt selectPlanContainers(): Es grenzt den Plan auf einzelne
 * Vorgaenge ein, sodass nicht mehr nur "alles oder nichts" zur Wahl steht.
 * Ausfuehrung und Schutzschild bleiben davon unberuehrt — die Auswahl aendert
 * nur, WAS im Plan steht, nicht, was erlaubt ist.
 */

import {
  getSolidDataset,
  getContainedResourceUrlAll,
  getThing,
  getDatetime,
  getStringNoLocale,
  getUrl,
} from '@inrupt/solid-client';
import { DCTERMS } from '@inrupt/vocab-common-rdf';
import { getAuthFetch } from './authFetch';
import { podBaseFromWebId } from './accessControlService';
import { NAMESPACES } from '../config/solidPods';

// ---------------------------------------------------------------------------
// Schutzschild
// ---------------------------------------------------------------------------

/**
 * Container direkt unter der Pod-Wurzel, die der Reset NIE betreten darf.
 * Bewusst als Positivliste des Verbotenen gefuehrt und zusaetzlich durch
 * assertDeletable() erzwungen: ein Tippfehler im Aufrufpfad soll nicht
 * ausreichen, um Infrastruktur zu loeschen.
 */
const PROTECTED_SEGMENTS = [
  'profile',
  'access',
  'wallet',
  'public',
  'settings',
  'inbox',
  'connections',
  'registry',
  'statistics',
  'token',
] as const;

/** tc:owner — Ersteller eines Vorgangs, siehe processService/damageReportService. */
const TC_OWNER = `${NAMESPACES.tc}owner`;
/** Beschreibende Angaben aus process.ttl — machen den Vorgang lesbar. */
const TC_PROCESS_LABEL = `${NAMESPACES.tc}processLabel`;
const TC_TITLE = `${NAMESPACES.tc}title`;
const TC_REGISTERED_AT = `${NAMESPACES.tc}registeredAt`;
const TC_PROCESS_ID = `${NAMESPACES.tc}processId`;

/**
 * Harte Zusicherung, dass eine URL geloescht werden darf.
 *
 * Erlaubt ist ausschliesslich:
 *   <pod>data/<irgendwas>            (Vorgangs-Container und ihr Inhalt)
 *   <pod>catalog/ds/<uuid>.ttl
 *   <pod>catalog/records/<uuid>.ttl
 *
 * Jede andere URL — insbesondere ausserhalb des eigenen Pods, die Pod-Wurzel
 * selbst, data/ selbst, catalog/cat.ttl oder ein geschuetzter Container —
 * wirft. Wird vor JEDEM DELETE aufgerufen.
 */
export function assertDeletable(url: string, podBase: string): void {
  if (!podBase.endsWith('/')) {
    throw new Error(`Pod-Basis ohne abschliessenden Slash: ${podBase}`);
  }
  if (!url.startsWith(podBase)) {
    throw new Error(`Ausserhalb des eigenen Pods, Loeschen abgelehnt: ${url}`);
  }

  const rest = url.slice(podBase.length);
  if (rest === '' || rest === '/') {
    throw new Error('Die Pod-Wurzel wird nie geloescht.');
  }

  const segments = rest.split('/').filter(Boolean);
  const first = segments[0]?.toLowerCase();

  if (first && (PROTECTED_SEGMENTS as readonly string[]).includes(first)) {
    throw new Error(`Geschuetzter Bereich, Loeschen abgelehnt: ${url}`);
  }

  if (first === 'data') {
    // data/ selbst bleibt stehen — nur sein Inhalt darf weg.
    if (segments.length < 2) {
      throw new Error('Der data-Container selbst wird nie geloescht.');
    }
    return;
  }

  if (first === 'catalog') {
    const second = segments[1]?.toLowerCase();
    if ((second === 'ds' || second === 'records') && segments.length === 3) {
      return; // catalog/ds/<uuid>.ttl bzw. catalog/records/<uuid>.ttl
    }
    throw new Error(`Im Katalog nur ds/ und records/ loeschbar, nicht: ${url}`);
  }

  throw new Error(`Nicht als Upload erkannt, Loeschen abgelehnt: ${url}`);
}

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface ResetFile {
  url: string;
  name: string;
  modified: Date | null;
}

/** Ein Vorgangs-Container unter data/ samt Inhalt. */
export interface ResetContainer {
  url: string;
  traceId: string;
  files: ResetFile[];
  modified: Date | null;
  /**
   * WebID des Erstellers laut tc:owner, sofern ermittelbar.
   * null = keine Angabe gefunden (Alt-Bestand ohne owner-Tripel).
   */
  ownerWebId: string | null;
  /** false, wenn tc:owner auf eine fremde WebID zeigt -> wird uebersprungen. */
  isOwn: boolean;
  /**
   * Lesbare Angaben aus process.ttl. Alle optional: PDF-Uploads ohne
   * registrierten Vorgang haben keine process.ttl, und der Container heisst
   * dann nach dem Dokument-Hash. Genau dafuer gibt es `describeContainer`.
   */
  processLabel: string | null;
  title: string | null;
  registeredAt: Date | null;
  processId: string | null;
}

/**
 * Was in der Liste als Ueberschrift steht.
 *
 * Ein Container-Name wie "0de0b1aafc5e9c26" ist der Hash des Dokuments und
 * sagt niemandem etwas. Die Reihenfolge hier ist die der Aussagekraft:
 *
 *   1. der Vorgangstyp aus process.ttl ("Faellvorgang") — was es IST
 *   2. der Titel, falls er etwas anderes sagt als der Typ
 *   3. sonst: die Dokumentart aus dem Dateinamen ("Stammzertifikat"), denn
 *      ein PDF-Upload ohne Vorgangsregistrierung hat nichts Besseres
 *   4. zuletzt der Hash — nie als einzige Angabe, immer nur als Beiwerk
 */
const DOC_TYPE_LABELS: Record<string, string> = {
  pdf_stammzertifikat: 'Stammzertifikat',
  pdf_pruefzertifikat: 'Prüfzertifikat',
  pdf_leistungserklaerung: 'Leistungserklärung',
  pdf_leistungserklaerung_bsp: 'Leistungserklärung BSP',
  pdf_transportauftrag: 'Transportauftrag',
  pdf_transportauftrag_rundholz: 'Transportauftrag Rundholz',
  forst: 'Harvesterprotokoll',
  saegewerk: 'Sägewerk-Protokoll',
  bspwerk: 'BSP-Werk-Daten',
  herstellung: 'ERP-Auszug',
};

/** Dokumentart aus den Dateinamen des Containers ableiten. */
export function documentKindFromFiles(files: ResetFile[]): string | null {
  // Laengste Kennung zuerst: "pdf_leistungserklaerung_bsp" enthaelt
  // "pdf_leistungserklaerung" als Praefix und wuerde sonst davon verdeckt.
  const keys = Object.keys(DOC_TYPE_LABELS).sort((a, b) => b.length - a.length);
  for (const file of files) {
    const name = file.name.toLowerCase();
    for (const key of keys) {
      if (name.includes(key)) return DOC_TYPE_LABELS[key];
    }
  }
  return null;
}

export interface ContainerDescription {
  /** Fett dargestellte Hauptzeile. */
  title: string;
  /** Zusatz darunter — Zeitpunkt, Kennung. Kann leer sein. */
  subtitle: string | null;
}

/**
 * Einen Container in eine lesbare Beschreibung uebersetzen.
 *
 * Ausgelagert und exportiert, damit die Regel testbar ist: Sie entscheidet,
 * ob der Nutzer in der Loeschliste erkennt, was er vor sich hat.
 */
export function describeContainer(container: ResetContainer): ContainerDescription {
  const when = container.registeredAt ?? container.modified;
  const stamp = when
    ? when.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  // 1./2. Registrierter Vorgang: Typ ist die Ueberschrift, der Titel ergaenzt
  // ihn nur, wenn er wirklich etwas Neues sagt.
  if (container.processLabel) {
    const extra =
      container.title && container.title !== container.processLabel
        ? container.title
        : null;
    return {
      title: container.processLabel,
      subtitle: [stamp, extra, container.processId].filter(Boolean).join(' · ') || null,
    };
  }

  // 3. Kein Vorgang, aber erkennbare Dokumentart.
  const kind = documentKindFromFiles(container.files);
  if (kind) {
    return {
      title: kind,
      subtitle: [stamp, 'ohne Vorgangsregistrierung'].filter(Boolean).join(' · '),
    };
  }

  // 4. Nichts bekannt — dann wenigstens der Zeitpunkt vor dem Hash.
  return {
    title: stamp ? `Upload vom ${stamp}` : 'Unbenannter Upload',
    subtitle: container.traceId,
  };
}

export interface ResetCatalogEntry {
  uuid: string;
  datasetUrl: string;
  recordUrl: string;
  /** Container, auf den die Distribution zeigt — zur Zuordnung zum Vorgang. */
  targetContainer: string | null;
}

export interface ResetPlan {
  podBase: string;
  /** Eigene Vorgaenge, die geloescht werden. */
  containers: ResetContainer[];
  /** Fremde Vorgaenge im eigenen Pod, die bewusst stehen bleiben. */
  foreign: ResetContainer[];
  /** Katalog-Eintraege, die auf zu loeschende Container zeigen. */
  catalogEntries: ResetCatalogEntry[];
  /** Katalog-Eintraege ohne Bezug zu den Uploads — bleiben stehen. */
  keptCatalogEntries: ResetCatalogEntry[];
  fileCount: number;
  /** Fehler beim Sammeln (Container nicht lesbar o.ae.) — rein informativ. */
  warnings: string[];
}

export interface ResetOutcome {
  deletedFiles: number;
  deletedContainers: number;
  deletedCatalogEntries: number;
  catalogCleaned: boolean;
  errors: string[];
}

/**
 * Einen Plan auf ausgewaehlte Vorgaenge eingrenzen.
 *
 * Der Grund fuer diese Funktion: Bis hierher gab es nur "alles oder nichts".
 * Wer einen einzelnen Vorgang neu hochladen wollte -- etwa den Faellvorgang,
 * um die Herkunftskante zu ergaenzen -- musste den ganzen Pod leeren und
 * anschliessend auch den Pflanzvorgang neu einspielen, obwohl an dem nichts
 * falsch war.
 *
 * Wesentlich ist die Mitnahme der Katalog-Eintraege: Sie haengen ueber
 * `targetContainer` an je einem Vorgang. Bleiben sie beim Loeschen zurueck,
 * zeigt der Katalog auf Container, die es nicht mehr gibt -- die Produktsuche
 * findet dann Eintraege, deren Daten 404 liefern. Umgekehrt darf ein Eintrag
 * eines BEHALTENEN Vorgangs auf keinen Fall mitgeloescht werden; er wandert
 * darum ausdruecklich nach `keptCatalogEntries`.
 *
 * Unbekannte URLs werden ignoriert statt zu werfen: Die Auswahl kommt aus einer
 * Oberflaeche, die den Plan bereits kennt; ein zwischenzeitlich verschwundener
 * Container soll den Rest nicht blockieren.
 */
export function selectPlanContainers(plan: ResetPlan, containerUrls: string[]): ResetPlan {
  const wanted = new Set(containerUrls);
  const containers = plan.containers.filter((c) => wanted.has(c.url));
  const keptContainers = plan.containers.filter((c) => !wanted.has(c.url));

  // Katalog-Eintraege neu aufteilen: Alles, was auf einen NICHT gewaehlten
  // Vorgang zeigt, gehoert zu den behaltenen -- auch wenn es im Ausgangsplan
  // unter `catalogEntries` stand.
  const targets = new Set(containers.map((c) => c.url));
  const all = [...plan.catalogEntries, ...plan.keptCatalogEntries];
  const catalogEntries = all.filter(
    (e) => e.targetContainer && targets.has(e.targetContainer),
  );
  const keptCatalogEntries = all.filter(
    (e) => !e.targetContainer || !targets.has(e.targetContainer),
  );

  return {
    ...plan,
    containers,
    // Die abgewaehlten Vorgaenge sind fuer diesen Lauf so unantastbar wie
    // fremde. Sie hier zu fuehren haelt die Zusicherung aufrecht, dass
    // ausschliesslich `containers` geloescht wird.
    foreign: [...plan.foreign, ...keptContainers],
    catalogEntries,
    keptCatalogEntries,
    fileCount: containers.reduce((sum, c) => sum + c.files.length, 0),
  };
}

// ---------------------------------------------------------------------------
// Sammeln
// ---------------------------------------------------------------------------

function fileNameFromUrl(url: string): string {
  const segment = url.split('/').pop() || url;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function traceIdFromContainer(containerUrl: string): string {
  const match = containerUrl.match(/\/data\/([^/]+)\/$/);
  if (!match) return containerUrl;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Kinder eines Containers auflisten, Dateien und Unterordner getrennt. */
async function listContainer(
  containerUrl: string,
): Promise<{ files: ResetFile[]; containers: string[]; modified: Date | null }> {
  const ds = await getSolidDataset(containerUrl, { fetch: getAuthFetch() });
  const children = getContainedResourceUrlAll(ds);

  const files: ResetFile[] = [];
  const containers: string[] = [];
  for (const child of children) {
    if (child.endsWith('/')) {
      containers.push(child);
    } else {
      const thing = getThing(ds, child);
      files.push({
        url: child,
        name: fileNameFromUrl(child),
        modified: thing ? getDatetime(thing, DCTERMS.modified) : null,
      });
    }
  }
  const self = getThing(ds, containerUrl);
  return { files, containers, modified: self ? getDatetime(self, DCTERMS.modified) : null };
}

interface ContainerMeta {
  ownerWebId: string | null;
  processLabel: string | null;
  title: string | null;
  registeredAt: Date | null;
  processId: string | null;
}

const EMPTY_META: ContainerMeta = {
  ownerWebId: null,
  processLabel: null,
  title: null,
  registeredAt: null,
  processId: null,
};

/**
 * Ersteller UND Beschreibung eines Vorgangs bestimmen.
 *
 * process.ttl und die Schadensmeldungen tragen tc:owner; process.ttl zusaetzlich
 * die lesbaren Angaben (Typ, Titel, Registrierzeitpunkt). Beides in EINEM
 * Durchgang, weil es dieselbe Datei ist — ein zweiter Lauf waere ein zweiter
 * Netzaufruf je Container ohne Gegenwert.
 *
 * Findet sich kein owner-Tripel, gilt der Vorgang als eigener (Alt-Bestand aus
 * der Zeit vor dem owner-Feld liegt im eigenen Pod und stammt damit vom
 * Pod-Eigentuemer).
 */
async function resolveContainerMeta(
  containerUrl: string,
  files: ResetFile[],
): Promise<ContainerMeta> {
  const candidates = files.filter(
    (f) => f.name === 'process.ttl' || f.name.toLowerCase().endsWith('.ttl'),
  );
  // process.ttl zuerst: dort stehen Ersteller und Beschreibung des Vorgangs.
  candidates.sort((a, b) => (a.name === 'process.ttl' ? -1 : b.name === 'process.ttl' ? 1 : 0));

  const meta: ContainerMeta = { ...EMPTY_META };

  for (const file of candidates.slice(0, 3)) {
    try {
      const ds = await getSolidDataset(file.url, { fetch: getAuthFetch() });
      // Das Subjekt der process.ttl ist die Container-URL selbst
      // (siehe buildProcessTtl); die uebrigen Kandidaten decken
      // Schadensmeldungen und Alt-Bestand ab.
      for (const subject of [
        containerUrl,
        `${containerUrl}process.ttl#process`,
        file.url,
        `${file.url}#it`,
      ]) {
        const thing = getThing(ds, subject);
        if (!thing) continue;

        meta.ownerWebId ??= getUrl(thing, TC_OWNER);
        meta.processLabel ??= getStringNoLocale(thing, TC_PROCESS_LABEL);
        meta.title ??= getStringNoLocale(thing, TC_TITLE);
        meta.registeredAt ??= getDatetime(thing, TC_REGISTERED_AT);
        meta.processId ??= getStringNoLocale(thing, TC_PROCESS_ID);
      }
      // Sobald die Beschreibung steht, sind die weiteren Dateien entbehrlich.
      if (meta.processLabel && meta.ownerWebId) break;
    } catch {
      // Datei nicht lesbar/kein RDF -> naechste probieren
    }
  }
  return meta;
}

/** Alle Vorgangs-Container unter data/ des eigenen Pods sammeln. */
async function collectDataContainers(
  podBase: string,
  webId: string,
  warnings: string[],
): Promise<{ own: ResetContainer[]; foreign: ResetContainer[] }> {
  let roots: string[];
  try {
    const dataRoot = await listContainer(`${podBase}data/`);
    roots = dataRoot.containers;
  } catch (e) {
    warnings.push(
      `data/ konnte nicht gelesen werden (${e instanceof Error ? e.message : String(e)}).`,
    );
    return { own: [], foreign: [] };
  }

  const own: ResetContainer[] = [];
  const foreign: ResetContainer[] = [];

  await Promise.all(
    roots.map(async (containerUrl) => {
      try {
        const { files, modified } = await listContainer(containerUrl);
        const meta = await resolveContainerMeta(containerUrl, files);
        // Kein owner-Tripel = Alt-Bestand im eigenen Pod -> als eigen behandeln.
        const isOwn = meta.ownerWebId === null || meta.ownerWebId === webId;
        const entry: ResetContainer = {
          url: containerUrl,
          traceId: traceIdFromContainer(containerUrl),
          files,
          modified,
          ownerWebId: meta.ownerWebId,
          isOwn,
          processLabel: meta.processLabel,
          title: meta.title,
          registeredAt: meta.registeredAt,
          processId: meta.processId,
        };
        (isOwn ? own : foreign).push(entry);
      } catch (e) {
        warnings.push(
          `${traceIdFromContainer(containerUrl)} nicht lesbar (${
            e instanceof Error ? e.message : String(e)
          }).`,
        );
      }
    }),
  );

  // Neueste zuerst. Nach dem Hash zu sortieren war eine Ordnung ohne Bedeutung
  // -- gesucht wird "was habe ich zuletzt hochgeladen", und das steht damit
  // oben. Container ohne jeden Zeitstempel wandern ans Ende.
  const byTime = (a: ResetContainer, b: ResetContainer) => {
    const ta = (a.registeredAt ?? a.modified)?.getTime() ?? 0;
    const tb = (b.registeredAt ?? b.modified)?.getTime() ?? 0;
    if (ta !== tb) return tb - ta;
    return a.traceId.localeCompare(b.traceId);
  };
  return { own: own.sort(byTime), foreign: foreign.sort(byTime) };
}

/**
 * Katalog-Eintraege des eigenen Pods einlesen und denen zuordnen, die auf
 * einen der zu loeschenden Container zeigen.
 *
 * Die Verknuepfung laeuft ueber die Distribution-URL (dcat:downloadURL bzw.
 * dcat:accessURL) im jeweiligen ds/<uuid>.ttl — eine andere Verbindung
 * zwischen Katalogeintrag und Vorgang gibt es nicht.
 */
async function collectCatalogEntries(
  podBase: string,
  deletableContainers: Set<string>,
  warnings: string[],
): Promise<{ matched: ResetCatalogEntry[]; kept: ResetCatalogEntry[] }> {
  const catalogUrl = `${podBase}catalog/`;
  let dsFiles: ResetFile[];
  try {
    const listing = await listContainer(`${catalogUrl}ds/`);
    dsFiles = listing.files.filter((f) => f.name.toLowerCase().endsWith('.ttl'));
  } catch {
    // Kein Katalog vorhanden -> nichts zu tun.
    return { matched: [], kept: [] };
  }

  const matched: ResetCatalogEntry[] = [];
  const kept: ResetCatalogEntry[] = [];

  await Promise.all(
    dsFiles.map(async (file) => {
      const uuid = file.name.replace(/\.ttl$/i, '');
      const entry: ResetCatalogEntry = {
        uuid,
        datasetUrl: file.url,
        recordUrl: `${catalogUrl}records/${uuid}.ttl`,
        targetContainer: null,
      };
      try {
        // Textuell gelesen: die Distribution-URL genuegt, ein voller Parse
        // waere fuer die reine Zuordnung unnoetig.
        const response = await getAuthFetch()(file.url, {
          headers: { Accept: 'text/turtle' },
        });
        if (response.ok) {
          const text = await response.text();
          const match = text.match(/<(https?:\/\/[^>]*\/data\/[^>]*)>/);
          if (match) {
            entry.targetContainer = match[1].slice(0, match[1].lastIndexOf('/') + 1);
          }
        }
      } catch {
        warnings.push(`Katalog-Eintrag ${uuid} nicht lesbar.`);
      }

      if (entry.targetContainer && deletableContainers.has(entry.targetContainer)) {
        matched.push(entry);
      } else {
        kept.push(entry);
      }
    }),
  );

  return { matched, kept };
}

/**
 * Zusammentragen, was ein Reset loeschen wuerde. Aendert nichts.
 */
export async function planPodReset(webId: string): Promise<ResetPlan> {
  const podBase = podBaseFromWebId(webId);
  const warnings: string[] = [];

  const { own, foreign } = await collectDataContainers(podBase, webId, warnings);
  const deletable = new Set(own.map((c) => c.url));
  const { matched, kept } = await collectCatalogEntries(podBase, deletable, warnings);

  return {
    podBase,
    containers: own,
    foreign,
    catalogEntries: matched,
    keptCatalogEntries: kept,
    fileCount: own.reduce((sum, c) => sum + c.files.length, 0),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Loeschen
// ---------------------------------------------------------------------------

/** Ein einzelnes DELETE, abgesichert durch assertDeletable(). */
async function deleteResource(url: string, podBase: string): Promise<void> {
  assertDeletable(url, podBase);
  const response = await getAuthFetch()(url, { method: 'DELETE' });
  // 404 = schon weg, zaehlt als Erfolg.
  if (!response.ok && response.status !== 404) {
    if (response.status === 401) throw new Error(`Nicht angemeldet: ${url}`);
    if (response.status === 403) throw new Error(`Keine Berechtigung: ${url}`);
    throw new Error(`Loeschen fehlgeschlagen (${response.status}): ${url}`);
  }
}

/**
 * Verweise auf geloeschte Eintraege aus cat.ttl entfernen.
 *
 * Textuell wie mergeCatalog() in catalogWriteService: cat.ttl wird auch von
 * anderen Werkzeugen im Dataspace angefasst, ein Parse/Serialize-Umlauf wuerde
 * dessen Formatierung zerschreiben. Die Datei selbst bleibt immer bestehen —
 * ohne sie waere der Pod im Datenraum nicht mehr auffindbar.
 */
export function removeCatalogRefs(existing: string, uuids: string[]): string {
  let out = existing;
  for (const uuid of uuids) {
    // Eintrag aus einer Komma-Liste loesen: entweder mit fuehrendem Komma
    // (nicht das erste Element) oder mit nachfolgendem (erstes Element).
    const dsRef = String.raw`<(?:[^>]*)?ds/${uuid}\.ttl#it>`;
    const recRef = String.raw`<(?:[^>]*)?records/${uuid}\.ttl#desc>`;
    for (const ref of [dsRef, recRef]) {
      out = out.replace(new RegExp(String.raw`\s*,\s*${ref}`, 'g'), '');
      out = out.replace(new RegExp(`\\s*${ref}\\s*,`, 'g'), '\n    ');
    }
  }

  // Praedikate ohne verbleibendes Objekt entfernen (letzter Eintrag war weg).
  out = out.replace(/\n?\s*<#it>\s+dcat:record\s*\.\s*/g, '\n');
  out = out.replace(/\n?\s*dcat:record\s*\.\s*/g, '\n');
  out = out.replace(/;\s*\n\s*dcat:dataset\s*\.\s*/g, ' .\n');
  out = out.replace(/\n?\s*<#it>\s+dcat:dataset\s*\.\s*/g, '\n');

  out = out.replace(
    /dcterms:modified\s+"[^"]*"\^\^xsd:dateTime/,
    `dcterms:modified "${new Date().toISOString()}"^^xsd:dateTime`,
  );
  return out;
}

async function cleanCatalogFile(podBase: string, uuids: string[]): Promise<boolean> {
  if (uuids.length === 0) return false;
  const catFile = `${podBase}catalog/cat.ttl`;
  try {
    const response = await getAuthFetch()(catFile, { headers: { Accept: 'text/turtle' } });
    if (!response.ok) return false;
    const existing = await response.text();
    const cleaned = removeCatalogRefs(existing, uuids);
    if (cleaned === existing) return false;

    const put = await getAuthFetch()(catFile, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: cleaned,
    });
    return put.ok;
  } catch {
    return false;
  }
}

/**
 * Den Plan ausfuehren: erst Dateien, dann die leeren Container, dann die
 * Katalog-Eintraege, zuletzt cat.ttl bereinigen.
 *
 * Reihenfolge ist wichtig: CSS loescht nur leere Container. Einzelfehler
 * stoppen den Lauf nicht, sie landen in `errors` — ein gesperrter Rest soll
 * nicht verhindern, dass der Rest aufgeraeumt wird.
 */
export async function executePodReset(
  plan: ResetPlan,
  onProgress?: (done: number, total: number) => void,
): Promise<ResetOutcome> {
  const { podBase } = plan;
  const errors: string[] = [];
  let deletedFiles = 0;
  let deletedContainers = 0;
  let deletedCatalogEntries = 0;

  const total =
    plan.fileCount + plan.containers.length + plan.catalogEntries.length * 2;
  let done = 0;
  const tick = () => {
    done += 1;
    onProgress?.(done, total);
  };

  // 1. Dateien in den Vorgangs-Containern
  for (const container of plan.containers) {
    for (const file of container.files) {
      try {
        await deleteResource(file.url, podBase);
        deletedFiles += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      tick();
    }
  }

  // 2. Die nun leeren Vorgangs-Container
  for (const container of plan.containers) {
    try {
      await deleteResource(container.url, podBase);
      deletedContainers += 1;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    tick();
  }

  // 3. Katalog-Eintraege (Datensatz + Record)
  for (const entry of plan.catalogEntries) {
    for (const url of [entry.datasetUrl, entry.recordUrl]) {
      try {
        await deleteResource(url, podBase);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      tick();
    }
    deletedCatalogEntries += 1;
  }

  // 4. cat.ttl bereinigen — die Datei bleibt bestehen.
  const catalogCleaned = await cleanCatalogFile(
    podBase,
    plan.catalogEntries.map((e) => e.uuid),
  );

  return {
    deletedFiles,
    deletedContainers,
    deletedCatalogEntries,
    catalogCleaned,
    errors,
  };
}
