/**
 * SPARQL Service for TimberConnect
 *
 * Uses Comunica to execute SPARQL queries directly against Solid Pods.
 */

import { QueryEngine } from '@comunica/query-sparql';
import { Parser, Store, type Quad } from 'n3';
import {
  DEFAULT_SOURCES,
  getSourcesForProduct,
  getSourcesForProductAsync,
  getAllProductsAsync,
  buildPotentialSources,
} from '../config/solidPods';
import { getAuthFetch, getCurrentRole } from './authFetch';
import { filterSourcesByRole, podBaseFromUrl } from './accessControlService';
import { type EpcisEvent } from './epcisService';
import { walkChain, itemRefOf, type ChainScope } from './supplyChainWalk';
import { stageFromTypeNames, type ProductStage } from './productImageService';

import {
  createProductQuery,
  createStemQuery,
  createForestQuery,
  createSawmillQuery,
  createBspWerkQuery,
  createSupplyChainQuery,
  createBusinessPartnersQuery,
  createTransportOrdersQuery,
  createCertificateDataQuery,
  createDeclarationQuery,
  createDeconstructionQuery,
  createDocumentationQuery,
  createLiabilityQuery,
  createLcaQuery,
  createDbppQuery,
  createEpcQuery,
  createEpcListQuery,
  createPlantingAreaQuery,
  createPlantingAreaByEpcQuery,
  isEpc,
} from './sparqlQueries';
import {
  areasContaining,
  parseWktPolygon,
  type GeoPoint,
  type PlantingArea,
} from './geoService';
import { reportPodQuery } from './dataspaceActivity';

// Singleton QueryEngine instance
let engine: QueryEngine | null = null;

// Timeout for source availability checks (ms)
const SOURCE_CHECK_TIMEOUT = 5000;

/**
 * Zeitgrenze fuer das Laden EINER Quelle.
 *
 * Die Quellen werden parallel geholt, aber der Browser laesst je Gegenstelle
 * nur sechs Verbindungen gleichzeitig zu -- lange Zeitgrenzen addieren sich
 * deshalb ueber die Warteschlange. Eine Quelle, die laenger braucht, fehlt
 * lieber in der Ansicht, als sie zum Stehen zu bringen.
 *
 * Die Uhr laeuft ab dem Einreihen, nicht ab dem Absenden: die Wartezeit in
 * der Warteschlange zaehlt mit. 4 s reichten am Laptop, am Handscanner im
 * WLAN aber nicht -- dort fielen gerade die entscheidenden Dateien heraus,
 * und der Scan meldete "Keine Daten" (24.09.2026).
 */
const SOURCE_FETCH_TIMEOUT = 12000;

/** Wie lange eine geladene Quelle wiederverwendet wird. */
const STORE_CACHE_TTL = 5 * 60 * 1000;

function getEngine(): QueryEngine {
  if (!engine) {
    engine = new QueryEngine();
  }
  return engine;
}

// ---------------------------------------------------------------------------
// Quellen-Cache
// ---------------------------------------------------------------------------

/**
 * Geladene und geparste Quellen, damit sie nicht je Abfrage neu geholt werden.
 *
 * WARUM: Comunica bekommt bei jedem ``queryBindings`` eine Liste von URLs und
 * laedt sie samt Parsen JEDES MAL neu. Ein Anwendungsfall stoesst 15 Abfragen
 * an, und die Quellenliste umfasst den ganzen Katalog -- das waren 15 x N
 * Downloads derselben Dateien. Genau daran hing die Ansicht.
 *
 * Hier wird jede Quelle EINMAL geholt, geparst und als Tripel-Menge behalten.
 * Die 15 Abfragen laufen danach gegen den Speicher, ohne Netz.
 *
 * Der Cache ist bewusst kurzlebig (STORE_CACHE_TTL): frisch hochgeladene
 * Dokumente sollen ohne Neuladen der Seite sichtbar werden.
 */
interface CachedSource {
  quads: Quad[];
  loadedAt: number;
}
const sourceCache = new Map<string, CachedSource>();
const inFlightSources = new Map<string, Promise<Quad[]>>();

/**
 * Quellen, deren letzter Ladeversuch an Netz oder Zeitgrenze scheiterte, mit
 * Grund. Anders als ein 404 ist das kein Befund ueber die Daten, sondern ueber
 * die Verbindung -- und muss deshalb sichtbar werden, wenn ein Scan leer
 * ausgeht. Sonst sieht ein langsames Netz aus wie eine falsche Produkt-ID.
 */
const failedSources = new Map<string, string>();

/**
 * Meldung fuer einen leeren Treffer, falls dabei Quellen am Netz scheiterten.
 * null, wenn alle Quellen sauber geladen wurden -- dann ist "keine Daten"
 * tatsaechlich der Befund.
 */
function describeFailedSources(sources: string[]): string | null {
  const failed = sources.filter((url) => failedSources.has(url));
  if (failed.length === 0) return null;
  const reasons = Array.from(new Set(failed.map((url) => failedSources.get(url))));
  return (
    `${failed.length} von ${sources.length} Pod-Dateien konnten nicht geladen werden ` +
    `(${reasons.join(', ')}). Bitte erneut versuchen, ggf. mit besserer Netzverbindung.`
  );
}

/** Cache leeren -- nach einem Upload, damit neue Dokumente sofort erscheinen. */
export function invalidateSourceCache(): void {
  sourceCache.clear();
  inFlightSources.clear();
  console.log('[SPARQL] Quellen-Cache geleert');
}

/**
 * Eine Quelle laden und parsen -- hoechstens einmal gleichzeitig.
 *
 * Faellt eine Quelle aus (404, Zeitgrenze, kaputtes Turtle), liefert sie eine
 * leere Tripelmenge statt zu werfen: eine unerreichbare Datei darf die
 * Ansicht nicht verhindern, sie fehlt dann eben darin.
 */
async function loadSource(url: string): Promise<Quad[]> {
  const cached = sourceCache.get(url);
  if (cached && Date.now() - cached.loadedAt < STORE_CACHE_TTL) return cached.quads;

  const laufend = inFlightSources.get(url);
  if (laufend) return laufend;

  // Der Datenraum-Graph zeigt genau DIESE Anfragen. Gemeldet wird hier und
  // nicht im Aufrufer, weil nur hier feststeht, dass wirklich ans Netz
  // gegangen wird -- ein Treffer im Cache oben ist keine Abfrage und darf
  // den Graphen auch nicht aufleuchten lassen.
  reportPodQuery(url, 'request');

  const promise = (async (): Promise<Quad[]> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT);
      const response = await getAuthFetch()(url, {
        headers: { Accept: 'text/turtle, application/trig;q=0.9, */*;q=0.1' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        reportPodQuery(url, 'miss');
        return [];
      }

      const text = await response.text();
      const quads = new Parser({ baseIRI: url }).parse(text);
      sourceCache.set(url, { quads, loadedAt: Date.now() });
      failedSources.delete(url);
      // "Treffer" heisst: die Datei existiert UND traegt etwas bei. Eine leere
      // Datei als Treffer zu melden, waere dieselbe Beschoenigung, die
      // filterAvailableSources weiter unten schon vermeidet.
      reportPodQuery(url, quads.length > 0 ? 'hit' : 'miss');
      return quads;
    } catch (err) {
      console.warn('[SPARQL] Quelle nicht ladbar:', url, err);
      // NICHT als leer cachen: ein Netzfehler oder eine Zeitueberschreitung
      // sagt nichts ueber die Datei. Frueher blieb sie danach fuenf Minuten
      // lang "leer", und jeder weitere Scan scheiterte ohne neuen Versuch.
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      failedSources.set(
        url,
        aborted ? 'Zeitüberschreitung' : err instanceof Error ? err.message : 'Netzfehler',
      );
      reportPodQuery(url, 'miss');
      return [];
    } finally {
      inFlightSources.delete(url);
    }
  })();

  inFlightSources.set(url, promise);
  return promise;
}

/**
 * Alle Quellen in EINEN Speicher laden.
 *
 * Der Speicher wird anschliessend allen Abfragen als einzige Quelle
 * uebergeben. Comunica sieht dann eine fertige Tripelmenge statt einer Liste
 * von URLs -- kein Netz, kein Parsen, kein Warten je Abfrage.
 */
async function buildStore(sources: string[]): Promise<Store> {
  const start = Date.now();
  const alleQuads = await Promise.all(sources.map(loadSource));
  const store = new Store();
  for (const quads of alleQuads) store.addQuads(quads);
  const frisch = sources.filter((u) => {
    const c = sourceCache.get(u);
    return c && Date.now() - c.loadedAt < 1000;
  }).length;
  console.log(
    `[SPARQL] ${store.size} Tripel aus ${sources.length} Quelle(n) in ${Date.now() - start} ms ` +
      `(${sources.length - frisch} aus dem Cache)`,
  );
  return store;
}

/**
 * Check if a data source URL is reachable
 */
export async function checkSourceAvailability(sourceUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SOURCE_CHECK_TIMEOUT);

    const response = await getAuthFetch()(sourceUrl, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    console.warn(`[SPARQL] Source not reachable: ${sourceUrl}`, error);
    return false;
  }
}

/**
 * Filter sources to only those that are reachable
 */
export async function filterAvailableSources(sources: string[]): Promise<{
  available: string[];
  unavailable: string[];
}> {
  // Die Quelle GLEICH LADEN statt sie erst per HEAD anzuklopfen.
  //
  // Frueher lief hier ein HEAD je Quelle, und unmittelbar danach holte
  // Comunica dieselbe Datei noch einmal -- zwei Runden ueber dieselbe
  // Warteschlange (der Browser laesst je Gegenstelle nur sechs Verbindungen
  // zu). Der Ladevorgang beantwortet die Frage "erreichbar?" ohnehin mit,
  // und sein Ergebnis wird im Cache behalten, sodass die anschliessenden
  // Abfragen gar nicht mehr ans Netz muessen.
  //
  // "Erreichbar" heisst hier: geladen UND mindestens ein Tripel. Eine leere
  // Datei traegt zu keiner Abfrage etwas bei, und sie als Quelle zu fuehren
  // haette nur die Statusanzeige beschoenigt.
  const results = await Promise.all(
    sources.map(async (source) => ({
      source,
      available: (await loadSource(source)).length > 0,
    })),
  );

  return {
    available: results.filter((r) => r.available).map((r) => r.source),
    unavailable: results.filter((r) => !r.available).map((r) => r.source),
  };
}

// Type for SPARQL binding results
export interface SparqlBinding {
  [key: string]: { value: string; type: string } | undefined;
}

/**
 * Execute a SPARQL SELECT query against the given sources
 */
export async function executeQuery(
  query: string,
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const queryEngine = getEngine();

  try {
    // Gegen den vorgeladenen Speicher statt gegen die URL-Liste: sonst holt
    // und parst Comunica bei JEDER Abfrage alle Quellen erneut. Bei 15
    // Abfragen eines Anwendungsfalls war das der Unterschied zwischen
    // Sekunden und Minuten.
    const store = await buildStore(sources);
    const bindingsStream = await queryEngine.queryBindings(query, {
      sources: [store],
      // Authenticated fetch so Comunica can read WAC-protected pod sources.
      // Falls back to the global fetch when no Solid session is active.
      fetch: getAuthFetch(),
    });

    const bindings = await bindingsStream.toArray();

    // Convert Comunica bindings to simple objects
    const results = bindings.map(binding => {
      const row: SparqlBinding = {};
      for (const variable of binding.keys()) {
        const term = binding.get(variable);
        if (term) {
          row[variable.value] = {
            value: term.value,
            type: term.termType
          };
        }
      }
      return row;
    });

    return results;
  } catch (error) {
    console.error('[SPARQL] Query execution failed:', error);
    console.error('[SPARQL] Failed query:', query);
    throw error;
  }
}

/**
 * Stammdaten der Platte.
 *
 * Alle folgenden Abfragen wurden auf das v6-Vokabular umgestellt und nehmen
 * deshalb die Ident-Kette statt einer Trace-Id: die v5-Klassen (vlex:BSPPanel,
 * tc:ForestSource, tc:SawmillSource, tc:BSPWerkSource, eldat:Polter) werden von
 * keinem aktuellen Upload mehr erzeugt, und ``tc:traceId`` existiert in v6
 * nicht. Ohne die Umstellung lieferten sie beim Ident-Pfad ausnahmslos nichts.
 */
export async function queryProduct(
  epcs: string[] = [],
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createProductQuery(epcs);
  console.log('[SPARQL] Querying product data');
  return executeQuery(query, sources);
}

/**
 * Query stem data (forest origin) by traceId.
 *
 * ``epcs`` ist die Ident-Kette des Bauteils. Sie MUSS beim EPC-Pfad mitgegeben
 * werden -- sonst liefert die Abfrage einen beliebigen Stamm aus dem Katalog
 * (siehe createStemQuery). Beim Trace-Id-Pfad bleibt sie leer; dort filtert
 * die Abfrage ueber tc:stemKey.
 */
export async function queryStem(
  traceId: string,
  sources: string[] = DEFAULT_SOURCES,
  epcs: string[] = []
): Promise<SparqlBinding[]> {
  const query = createStemQuery(traceId, epcs);
  console.log('[SPARQL] Querying stem data for traceId:', traceId);
  return executeQuery(query, sources);
}

/** Waldherkunft -- in v6 am tc:Stem, nicht mehr an einem Quellenknoten. */
export async function queryForestSource(
  epcs: string[] = [],
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createForestQuery(epcs);
  console.log('[SPARQL] Querying forest source');
  return executeQuery(query, sources);
}

/** Saegewerk -- Empfaenger des Rundholzauftrags bzw. Saegewerks-DoP. */
export async function querySawmillSource(
  epcs: string[] = [],
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createSawmillQuery(epcs);
  console.log('[SPARQL] Querying sawmill source');
  return executeQuery(query, sources);
}

/** Herstellungsangaben -- in v6 flach am tc:Panel. */
export async function queryBspWerkSource(
  epcs: string[] = [],
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createBspWerkQuery(epcs);
  console.log('[SPARQL] Querying BSP-Werk source');
  return executeQuery(query, sources);
}

/** Stationen der Kette -- je Station aus ihrem eigenen Beleg. */
export async function querySupplyChain(
  epcs: string[] = [],
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createSupplyChainQuery(epcs);
  console.log('[SPARQL] Querying supply chain');
  return executeQuery(query, sources);
}

/** Akteure mit Anschrift -- in v6 aus den Transportauftraegen. */
export async function queryBusinessPartners(
  epcs: string[] = [],
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createBusinessPartnersQuery(epcs);
  console.log('[SPARQL] Querying business partners');
  return executeQuery(query, sources);
}

/**
 * Query transport orders (Herkunftsnachweis I-19..I-26).
 * Liefert ein Kreuzprodukt der Adressliterale -- siehe Query-Kommentar.
 */
export async function queryTransportOrders(
  sources: string[] = DEFAULT_SOURCES,
  epcs: string[] = []
): Promise<SparqlBinding[]> {
  const query = createTransportOrdersQuery(epcs);
  console.log('[SPARQL] Querying transport orders');
  return executeQuery(query, sources);
}

/** Query certificates + test reports (Herkunftsnachweis I-5/I-6/I-7). */
export async function queryCertificateData(
  sources: string[] = DEFAULT_SOURCES,
  epcs: string[] = []
): Promise<SparqlBinding[]> {
  const query = createCertificateDataQuery(epcs);
  console.log('[SPARQL] Querying certificates / test reports');
  return executeQuery(query, sources);
}

/** Leistungserklaerung + Rechnungsempfaenger (I-1/I-2, I-27/I-28). */
export async function queryDeclarations(
  sources: string[] = DEFAULT_SOURCES,
  epcs: string[] = []
): Promise<SparqlBinding[]> {
  const query = createDeclarationQuery(epcs);
  console.log('[SPARQL] Querying declarations of performance / invoice');
  return executeQuery(query, sources);
}

/** ERP-Panel + Leistungserklaerung + Klebstoff (Rueckbaubarkeit I-29..I-56). */
export async function queryDeconstruction(
  sources: string[] = DEFAULT_SOURCES,
  epcs: string[] = []
): Promise<SparqlBinding[]> {
  const query = createDeconstructionQuery(epcs);
  console.log('[SPARQL] Querying deconstruction data (panel / DoP / adhesive)');
  return executeQuery(query, sources);
}

/** Verortung im Gebaeude + Gewicht/Norm (Awf "Dokumentation" I-57..I-89). */
export async function queryDocumentation(
  sources: string[] = DEFAULT_SOURCES,
  epcs: string[] = []
): Promise<SparqlBinding[]> {
  const query = createDocumentationQuery(epcs);
  console.log('[SPARQL] Querying documentation data (building part / project / panel)');
  return executeQuery(query, sources);
}

/** Pruefwerte, Konformitaet und Verantwortung (Awf "Nachweis der Haftung" I-1..I-44). */
export async function queryLiability(
  sources: string[] = DEFAULT_SOURCES,
  epcs: string[] = []
): Promise<SparqlBinding[]> {
  const query = createLiabilityQuery(epcs);
  console.log('[SPARQL] Querying liability data (test report / DoP / adhesive / panel)');
  return executeQuery(query, sources);
}

/** Eingangsgroessen + Zusatzinfos der CO2-Bilanz (Awf "CO2-Bilanz"). */
export async function queryLca(
  sources: string[] = DEFAULT_SOURCES,
  epcs: string[] = []
): Promise<SparqlBinding[]> {
  const query = createLcaQuery(epcs);
  console.log('[SPARQL] Querying LCA data (panel / transport orders / DoP / adhesive)');
  return executeQuery(query, sources);
}

/** Produktpass-Angaben nach CPR Art. 76 / ESPR (Awf "DBPP"). */
export async function queryDbpp(
  sources: string[] = DEFAULT_SOURCES,
  epcs: string[] = []
): Promise<SparqlBinding[]> {
  const query = createDbppQuery(epcs);
  console.log('[SPARQL] Querying DBPP data (panel / DoP / adhesive / IFC / certificate)');
  return executeQuery(query, sources);
}

/** Source status information */
export interface SourceStatus {
  url: string;
  available: boolean;
  pod: string; // extracted pod hostname
}

/** EPCIS retrieval summary (present only for the EPC-centric flow). */
export interface EpcisInfo {
  epc: string;
  eventsReturned: number;
  eventsFilteredOut: number;
  epcsResolved: number;
}

/** Extended result with source status */
export interface ProductDataResult {
  product: SparqlBinding[];
  stem: SparqlBinding[];
  forest: SparqlBinding[];
  sawmill: SparqlBinding[];
  bspWerk: SparqlBinding[];
  supplyChain: SparqlBinding[];
  businessPartners: SparqlBinding[];
  /** Transportauftraege (Herkunftsnachweis I-19..I-26). */
  transportOrders: SparqlBinding[];
  /** Stamm-/Pruefzertifikate (Herkunftsnachweis I-5/I-6/I-7). */
  certificates: SparqlBinding[];
  /** Leistungserklaerungen + Rechnungsempfaenger (I-1/I-2, I-27/I-28). */
  declarations: SparqlBinding[];
  /** ERP-Panel, Herstelleranschrift, Klebstoff (Rueckbaubarkeit I-29..I-56). */
  deconstruction: SparqlBinding[];
  /** Verortung im Gebaeude aus der Ausfuehrungsplanung (Dokumentation I-57..I-89). */
  documentation: SparqlBinding[];
  /** Pruefwerte, Konformitaet, Verantwortung + Schadensmeldungen
      (Awf "Nachweis der Haftung" I-1..I-44). */
  liability: SparqlBinding[];
  /** Eingangsgroessen + Zusatzinfos der CO2-Bilanz (Awf "CO2-Bilanz").
      Bewusst NICHT in countExtractedDatapoints (App.tsx) -- wie die anderen
      Awf-spezifischen Ergebnisse, sonst wuerden dieselben Datenpunkte
      doppelt bepreist. */
  lca: SparqlBinding[];
  /** Produktpass-Angaben nach CPR Art. 76 / ESPR (Awf "DBPP").
      Wie ``lca`` bewusst NICHT in collectExtractedDatapoints (App.tsx,
      loadProductData): der Pass fasst Angaben zusammen, die dort bereits
      gezaehlt werden -- sonst zahlte man denselben Datenpunkt zweimal. */
  dbpp: SparqlBinding[];
  /**
   * Treffer aus ``createEpcQuery`` fuer AUSSCHLIESSLICH den gescannten Ident.
   *
   * ``product`` traegt beim EPC-Abruf die Treffer ALLER Idente der Kette --
   * beim Scan einer BSP-Platte also auch die ihrer 169 Lamellen, weil
   * ``collectEpcs`` die ``inputEPCList`` des TransformationEvents mitliest.
   * Fuer Aussagen ueber das erfasste Bauteil selbst (Produktart!) ist diese
   * verschmolzene Liste unbrauchbar: sie enthaelt die Typen der Vormaterialien
   * gleichberechtigt neben denen der Platte.
   *
   * Dieses Feld haelt die Herkunft fest. Nur beim EPC-zentrischen Abruf
   * gesetzt; beim traceId-Abruf gibt es keinen gescannten Ident.
   */
  scannedEpc?: SparqlBinding[];
  /**
   * Wertschoepfungsstufen, die DOWNSTREAM des erfassten Idents liegen -- also
   * das, was aus ihm entstanden ist.
   *
   * Nur beim Umfang "Gesamte Kette" gefuellt; bei "Vorangegangene Kette"
   * laeuft der Walk nicht in diese Richtung und die Menge bleibt leer. Genau
   * daran haengt, ob sich CO2-Bilanz und Rueckbaubarkeit fuer ein Vorprodukt
   * oeffnen lassen: die Angaben gibt es nur fuer die fertige Platte, aber
   * wenn die Platte mitgeladen wurde, gibt es sie eben ueber sie.
   */
  downstreamStages?: ProductStage[];
  sourceStatus: SourceStatus[];
  errors: string[];
  epcisInfo?: EpcisInfo;
  /** Rohe EPCIS-Events des EPC-Flows -- Quelle der Transportdaten
      (eventTime + bizStep). Nur beim EPC-zentrischen Abruf gesetzt. */
  epcisEvents?: EpcisEvent[];
  /**
   * True, wenn ALLE Sparten abgefragt wurden.
   *
   * Nach dem Scan steht hier ``false``: dann traegt das Ergebnis nur den
   * erfassten Ident und seine Produktart (fetchScanData). Wer die Felder der
   * Anwendungsfaelle braucht, muss vorher nachladen -- sonst haelt er ein
   * leeres Feld faelschlich fuer "keine Daten vorhanden".
   */
  loadedFully?: boolean;
}

/**
 * Extract pod hostname from URL
 */
function extractPodHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Fetch all product data for a given traceId
 * Returns combined data from all sources (product, stem, supply chain)
 * Automatically selects the correct TTL sources based on product ID
 * Now includes source availability status for UI feedback
 */
/**
 * Derive candidate pod TTL sources from EPCIS bizTransaction URLs. A
 * bizTransaction points at the source document on the owner's pod
 * (e.g. <pod>/data/<hash> or legacy .../public/uploads/<hash>); the
 * materialised RDF lives next to it as <hash>_<type>.ttl in data/<hash>/.
 * The pod base is taken from the bizTransaction URL itself, so uploads on
 * any member pod resolve — plus the central-pod layouts as legacy fallback.
 */
export function sourcesFromBizTransactions(bizTxUrls: string[]): string[] {
  const sources = new Set<string>();
  // Die Dateinamen im Container folgen <id>_<datatype>.ttl. Die drei
  // Maschinendatentypen decken die Altbestaende ab; die PDF-Vorgaenge tragen
  // ihren Template-Namen. Ohne sie faellt genau das Dokument aus der Abfrage,
  // das den Vorgang beschreibt -- die Leistungserklaerung benennt Saegewerk
  // und Holzwerkstoffproduzent, ohne sie bleiben beide Akteure leer.
  const dataTypes = [
    'forst',
    'saegewerk',
    'bspwerk',
    'herstellung',
    'pdf_leistungserklaerung',
    'pdf_leistungserklaerung_bsp',
    'pdf_transportauftrag',
    'pdf_transportauftrag_rundholz',
    'pdf_stammzertifikat',
    'pdf_pruefzertifikat',
  ];
  for (const url of bizTxUrls) {
    const hash = url.split('/').filter(Boolean).pop();
    if (!hash) continue;
    // Pod the event points at (first path segment of the bizTransaction URL).
    try {
      const podBase = podBaseFromUrl(url);
      for (const dt of dataTypes) {
        sources.add(`${podBase}data/${hash}/${hash}_${dt}.ttl`);
      }
    } catch {
      // Unparseable URL — fall through to the central-pod candidates.
    }
    // Legacy layouts on the central pod (public/ and data/).
    for (const candidate of buildPotentialSources(hash)) sources.add(candidate);
  }
  return [...sources];
}

/**
 * Der SCAN -- bewusst schlank.
 *
 * Nach dem Erfassen zeigt die Ansicht genau zwei Dinge: den Ident und die
 * Produktart. Alles Weitere haengt hinter der Bezahlschranke des jeweiligen
 * Anwendungsfalls. Genau so viel wird hier geholt:
 *
 *   1 EPCIS-Abfrage (der erfasste Ident, ohne Kettenverfolgung)
 *   1 SPARQL-Abfrage (die Subjekte, die diesen Ident tragen -> Produktart)
 *
 * WARUM DAS EINE EIGENE FUNKTION IST: ``fetchProductDataByEpc`` faehrt 15
 * Abfragen ueber den gesamten Katalog. Fuer den Scan wurde davon nur
 * ``scannedEpc`` gebraucht -- der Rest diente allein dazu, die
 * Verfuegbarkeits-Kacheln auf "liegt was vor?" zu pruefen, und wurde danach
 * verworfen. Mit der mehrstufigen Kettenverfolgung wurde daraus eine
 * Wartezeit, die die Anwendung stehen liess.
 *
 * Die Kacheln bekommen ihre Auskunft jetzt aus ``availability`` -- einer
 * Ja/Nein-Angabe je Kategorie, die aus DIESER einen Abfrage faellt.
 */
export async function fetchScanData(epc: string): Promise<ProductDataResult> {
  const errors: string[] = [];
  console.log('[SPARQL] Scan (schlank) für EPC:', epc);

  let events: EpcisEvent[] = [];
  let eventsReturned = 0;
  let eventsFilteredOut = 0;
  let bizTxUrls: string[] = [];
  try {
    // 'self': keine Kettenverfolgung. Die Ereignisse des erfassten Idents
    // reichen -- sie tragen die Dokumentlinks, ueber die die Quellen gefunden
    // werden.
    const walk = await walkChain(epc, 'self');
    events = walk.events;
    eventsReturned = walk.eventsReturned;
    eventsFilteredOut = walk.eventsFilteredOut;
    bizTxUrls = walk.bizTxUrls;
  } catch (err) {
    console.error('[SPARQL] EPCAT query failed:', err);
    errors.push(err instanceof Error ? err.message : 'EPCAT-Abfrage fehlgeschlagen');
  }

  const epcisInfo: EpcisInfo = {
    epc,
    eventsReturned,
    eventsFilteredOut,
    epcsResolved: 1,
  };

  const sourceSet = new Set<string>(sourcesFromBizTransactions(bizTxUrls));
  try {
    const products = await getAllProductsAsync();
    for (const url of products.flatMap((p) => p.sources)) sourceSet.add(url);
  } catch (err) {
    console.warn('[SPARQL] Katalog-Quellen nicht ermittelbar:', err);
  }
  const sources = Array.from(sourceSet);

  const { allowed } = await filterSourcesByRole([...sources], getCurrentRole());
  const { available } = await filterAvailableSources(allowed);

  if (available.length === 0) {
    errors.push('Keine verknüpften Pod-Daten erreichbar');
    return { ...emptyResult(sources, errors), epcisInfo };
  }

  // Den Fehler MELDEN statt nur zu loggen: sonst endet eine gescheiterte
  // Abfrage als "Keine Daten gefunden -- ID pruefen", und am Handscanner,
  // wo keine Konsole mitlaeuft, ist die eigentliche Ursache unsichtbar.
  const scannedEpcBindings = await executeQuery(createEpcQuery(epc), available).catch(
    (err) => {
      console.error('[SPARQL] EPC query failed for', epc, err);
      errors.push(
        `Abfrage der Pod-Daten fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [] as SparqlBinding[];
    },
  );
  if (scannedEpcBindings.length === 0) {
    const netz = describeFailedSources(allowed);
    if (netz) errors.push(netz);
  }

  console.log(
    `[SPARQL] Scan fertig: ${scannedEpcBindings.length} Treffer am erfassten Ident, ` +
      `${available.length} Quelle(n)`,
  );

  return {
    ...emptyResult(sources, errors),
    product: scannedEpcBindings,
    scannedEpc: scannedEpcBindings,
    sourceStatus: available.map((url) => ({ url, available: true, pod: extractPodHost(url) })),
    epcisInfo,
    epcisEvents: events,
  };
}

/**
 * EPCIS-centric retrieval: a GS1 EPC -> EPCAT events -> linked EPCs + pod sources
 * -> pod SPARQL.
 *
 * ``scope`` bestimmt, WIE WEIT die Kette verfolgt wird (siehe walkChain):
 *
 *   self     nur das erfasste Bauteil
 *   upstream zusaetzlich seine Vorstufen -- die Herkunft
 *   full     zusaetzlich, was daraus entstanden ist -- die Verwendung
 *
 * Die Traversierung ist mehrstufig und gerichtet. Vorher wurde EPCIS genau
 * einmal gefragt: beim Scan einer Platte kamen so ihre Lamellen herein, aber
 * nie die Staemme dahinter -- und damit nie die Forstdaten. Ungerichtet war es
 * zugleich zu weit: wer eine Lamelle scannte, bekam die Platte mitgeliefert,
 * die es zum Zeitpunkt der Lamelle noch gar nicht gab.
 */
export async function fetchProductDataByEpc(
  epc: string,
  scope: ChainScope = 'full',
): Promise<ProductDataResult> {
  const errors: string[] = [];
  console.log(`[SPARQL] EPCIS flow for EPC: ${epc} (Umfang: ${scope})`);

  // 1. Kette ueber den (rollen- und consent-pruefenden) EPCIS-Proxy verfolgen.
  let events: EpcisEvent[] = [];
  let eventsReturned = 0;
  let eventsFilteredOut = 0;
  let epcs = new Set<string>([epc]);
  // Idente, die AUS dem erfassten Bauteil entstanden sind. Nur bei scope
  // 'full' gefuellt -- 'upstream' laeuft gar nicht erst in diese Richtung.
  let downstreamEpcs = new Set<string>();
  let bizTxUrls: string[] = [];
  try {
    const walk = await walkChain(epc, scope);
    events = walk.events;
    eventsReturned = walk.eventsReturned;
    eventsFilteredOut = walk.eventsFilteredOut;
    epcs = walk.epcs;
    downstreamEpcs = walk.downstreamEpcs;
    bizTxUrls = walk.bizTxUrls;
    console.log(
      `[SPARQL] EPCAT: ${walk.eventsReturned} events ` +
        `(${walk.eventsFilteredOut} filtered by consent), ${epcs.size} EPC(s) in der Kette`,
    );
  } catch (err) {
    console.error('[SPARQL] EPCAT query failed:', err);
    errors.push(err instanceof Error ? err.message : 'EPCAT-Abfrage fehlgeschlagen');
  }

  const epcisInfo: EpcisInfo = {
    epc,
    eventsReturned,
    eventsFilteredOut,
    epcsResolved: epcs.size,
  };

  // 3. Quellen sammeln: aus den bizTransaction-Links UND aus dem Katalog.
  //
  // Beide, nicht entweder/oder. Die bizTransaction-Links sind naemlich nur
  // eine begruendete Vermutung: aus ihrem letzten Pfadsegment werden
  // Dateinamen nach dem Muster <id>_<datatype>.ttl geraten. Das trifft die
  // Maschinendaten, aber nicht die PDF-Vorgaenge -- deren Treiber setzt als
  // Transaktions-Id die Dokumentnummer aus dem Formular
  // (z.B. "DoP-SAE-2026-0728"), waehrend der Container nach dem PDF-Hash
  // benannt ist. Die geratene URL geht dann ins Leere.
  //
  // Frueher lief der Katalog nur, wenn die Links GAR NICHTS ergaben. Sobald
  // ein einziges Event existierte, unterdrueckten die (falschen) geratenen
  // URLs die verlaessliche Quelle -- der Herkunftsnachweis blieb leer,
  // obwohl die Daten im Pod lagen und im Katalog standen.
  const guessed = sourcesFromBizTransactions(bizTxUrls);
  const sourceSet = new Set<string>(guessed);
  try {
    const products = await getAllProductsAsync();
    const fromCatalog = products.flatMap((p) => p.sources);
    for (const url of fromCatalog) sourceSet.add(url);
    console.log(
      `[SPARQL] Quellen: ${guessed.length} aus bizTransaction, ${fromCatalog.length} aus Katalog`,
    );
  } catch (err) {
    console.warn('[SPARQL] Katalog-Quellen nicht ermittelbar:', err);
  }
  const sources = Array.from(sourceSet);

  // Role pre-filter + availability, reusing the existing pipeline.
  const { allowed } = await filterSourcesByRole([...sources], getCurrentRole());
  const { available } = await filterAvailableSources(allowed);

  if (available.length === 0) {
    errors.push('Keine verknüpften Pod-Daten erreichbar');
    return { ...emptyResult(sources, errors), epcisInfo };
  }

  // 4. Die Treffer des GESCANNTEN Idents holen -- und NUR die.
  //
  // Frueher lief hier eine Abfrage JE KETTEN-IDENT ueber alle Quellen. Bei
  // einer Platte mit 169 Lamellen waren das 170 parallele Comunica-Laeufe,
  // von denen am Ende genau einer verwendet wurde: die uebrigen Treffer
  // dienten nur als Rueckfall fuer ``product`` und blaehten dabei die
  // Datenpunktzahl (und damit den Preis) auf, ohne eine Aussage
  // hinzuzufuegen. Seit ``queryProduct`` auf tc:Panel laeuft, gibt es diesen
  // Rueckfall nicht mehr -- und damit auch keinen Grund, die ganze Kette
  // einzeln abzufragen.
  //
  // Warum ueberhaupt getrennt vom Rest: ``epcs`` ist die ganze Kette. Wer die
  // Treffer aller Idente zu einer Liste verschmilzt, kann der Platte nicht
  // mehr ansehen, welche Zeile ihr gehoert und welche ihrem Vormaterial --
  // die Produktart wurde so zur "Lamelle", weil die Leistungserklaerung der
  // Lamellen ``tc:SawingProcess`` beisteuert.
  // Den Fehler MELDEN statt nur zu loggen: sonst endet eine gescheiterte
  // Abfrage als "Keine Daten gefunden -- ID pruefen", und am Handscanner,
  // wo keine Konsole mitlaeuft, ist die eigentliche Ursache unsichtbar.
  const scannedEpcBindings = await executeQuery(createEpcQuery(epc), available).catch(
    (err) => {
      console.error('[SPARQL] EPC query failed for', epc, err);
      errors.push(
        `Abfrage der Pod-Daten fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [] as SparqlBinding[];
    },
  );
  if (scannedEpcBindings.length === 0) {
    const netz = describeFailedSources(allowed);
    if (netz) errors.push(netz);
  }

  // Nachvollziehbar machen, woran die Produktart haengt: welche Typen der
  // GESCANNTE Ident hergibt und -- falls keine -- ob die Quelle ueberhaupt
  // in der Liste stand. Ohne diese Zeile ist von aussen nicht zu
  // unterscheiden, ob der Typ fehlt oder die Datei nicht geladen wurde.
  const scannedTypes = scannedEpcBindings
    .map((row) => row.type?.value)
    .filter((t): t is string => !!t);
  console.log(
    `[SPARQL] Gescannter Ident ${epc}: ${scannedEpcBindings.length} Treffer, Typen:`,
    scannedTypes.length ? scannedTypes : '(keine)',
  );
  if (!scannedTypes.length) {
    console.warn(
      '[SPARQL] Keine Typangabe am gescannten Ident — die Produktart bleibt leer. ' +
        'Geladene Quellen:',
      available,
    );
  }
  // Welche Subjekte tragen den Ident, und welche Quelle liefert sie? Mehrere
  // Dokumente duerfen denselben tc:epc fuehren (die Leistungserklaerung
  // verweist per materialEpc auf dieselbe Platte wie der ERP-Auszug). Erst
  // diese Aufstellung zeigt, ob eine erwartete Quelle FEHLT oder nur ihr
  // Subjekt keinen Typ traegt.
  console.log(
    '[SPARQL] Subjekte am gescannten Ident:',
    scannedEpcBindings.map((row) => ({
      subject: row.subject?.value,
      type: row.type?.value,
    })),
  );
  console.log(
    '[SPARQL] Quellen mit "herstellung" in der Liste:',
    available.filter((u) => u.includes('herstellung')),
  );

  // 5. Die Abfragen laufen ueber dieselben Quellen -- die dokumentbezogenen
  //    aber MIT Ident-Schranke.
  //
  //    Frueher liefen sie ungefiltert. Da die Quellenliste den ganzen Katalog
  //    umfasst (Schritt 3), lieferte z.B. queryCertificateData ALLE
  //    Stammzertifikate aller Bauteile. Mit genau einem hochgeladenen
  //    Zertifikat fiel das nicht auf; beim zweiten haette der
  //    Herkunftsnachweis fremde Baumarten und Reifejahre als die eigenen
  //    ausgewiesen -- ebenso Rueckbaubarkeit, Dokumentation, Haftung,
  //    CO2-Bilanz und DBPP.
  //
  //    ``chainEpcs`` ist die Kette dieses Bauteils (gescannter Ident +
  //    Vorprodukte aus den EPCIS-Ereignissen, Schritt 2). Genau daran haengen
  //    die PDF-Vorgaenge ueber tc:epc (im Mapping: materialEpc).
  //
  //    VOLLSTAENDIG, ohne Kappung. Frueher wanderten hoechstens 48 Idente in
  //    die Schranke -- eine Begrenzung auf die Antwortzeit, die die Ansicht
  //    aber INHALTLICH falsch machte: die Menge kommt in Einfuegereihenfolge
  //    aus dem Ketten-Walk, und bei einer Platte aus 169 Lamellen sind die
  //    ersten 48 fast ausschliesslich Lamellen. Die Staemme stehen dahinter
  //    und fielen weg -- mit ihnen der Faellort, den der Herkunftsnachweis
  //    auf der Karte zeigt. Die Kappung meldete sich zwar im Log, aber in der
  //    Ansicht war nicht zu sehen, dass ausgerechnet der Wald fehlt.
  //
  //    Eine langsamere Ansicht ist der Preis dafuer, dass die Kette vollstaendig
  //    ausgewertet wird. Wer die Grenze wieder einfuehrt, muss ueber die
  //    Produktarten (itemRef) hinweg auswaehlen statt vorne abzuschneiden --
  //    sonst kehrt genau dieser Fehler zurueck.
  //
  //    Der gescannte Ident steht weiterhin vorn: Reihenfolge ist zwar fuer die
  //    Vollstaendigkeit egal, aber die Wertelisten bleiben so lesbar.
  const chainEpcs = [epc, ...[...epcs].filter((e) => e !== epc)];
  const [
    product,
    stem,
    forest,
    sawmill,
    bspWerk,
    supplyChain,
    businessPartners,
    transportOrders,
    certificates,
    declarations,
    deconstruction,
    documentation,
    liability,
    lca,
    dbpp,
    downstreamStages,
  ] = await Promise.all([
    queryProduct(chainEpcs, available).catch(() => []),
    queryStem(epc, available, chainEpcs).catch(() => []),
    queryForestSource(chainEpcs, available).catch(() => []),
    querySawmillSource(chainEpcs, available).catch(() => []),
    queryBspWerkSource(chainEpcs, available).catch(() => []),
    querySupplyChain(chainEpcs, available).catch(() => []),
    queryBusinessPartners(chainEpcs, available).catch(() => []),
    queryTransportOrders(available, chainEpcs).catch(() => []),
    queryCertificateData(available, chainEpcs).catch(() => []),
    queryDeclarations(available, chainEpcs).catch(() => []),
    queryDeconstruction(available, chainEpcs).catch(() => []),
    queryDocumentation(available, chainEpcs).catch(() => []),
    queryLiability(available, chainEpcs).catch(() => []),
    queryLca(available, chainEpcs).catch(() => []),
    queryDbpp(available, chainEpcs).catch(() => []),
    // Welche Stufen liegen NACH dem erfassten Bauteil? Entscheidet, ob sich
    // die nur-fuer-BSP-Faelle ueber die Platte der Kette oeffnen lassen.
    resolveDownstreamStages(downstreamEpcs, available).catch(() => [] as ProductStage[]),
  ]);

  return {
    // Rueckfall auf die Ident-Treffer des GESCANNTEN Bauteils, nicht der
    // ganzen Kette. createEpcQuery liefert nur Struktur (subject/type/
    // epcisDoc) -- ueber alle 169 Lamellen gesammelt blaeht das die
    // Datenpunktzahl und damit den Preis auf, ohne eine Aussage
    // hinzuzufuegen. Seit queryProduct auf tc:Panel laeuft, greift dieser
    // Zweig ohnehin nur noch, wenn gar keine Plattendaten vorliegen.
    product: product.length ? product : scannedEpcBindings,
    stem,
    forest,
    sawmill,
    bspWerk,
    supplyChain,
    businessPartners,
    transportOrders,
    certificates,
    declarations,
    deconstruction,
    documentation,
    liability,
    lca,
    dbpp,
    scannedEpc: scannedEpcBindings,
    downstreamStages,
    sourceStatus: available.map((url) => ({ url, available: true, pod: extractPodHost(url) })),
    errors,
    epcisInfo,
    epcisEvents: events,
    loadedFully: true,
  };
}

/**
 * Welche Wertschoepfungsstufen liegen DOWNSTREAM des erfassten Idents?
 *
 * Gebraucht fuer die Anwendungsfaelle, die es nur fuer die fertige BSP-Platte
 * gibt (CO2-Bilanz, Rueckbaubarkeit). Wer Schnittholz scannt und "Gesamte
 * Kette" waehlt, hat die Platte mitgeladen -- dann gibt es die Angaben, nur
 * eben ueber die Platte und nicht ueber das Schnittholz. Bei "Vorangegangene
 * Kette" bleibt die Menge leer, weil der Walk gar nicht erst nach unten
 * laeuft; die Faelle bleiben dort gesperrt.
 *
 * Bewusst NICHT aus der Itemreference des EPC (0401 = Platte) abgeleitet:
 * das ist eine Konvention der heutigen Demo-Idente, keine Auskunft. Gefragt
 * wird stattdessen der RDF-Typ am jeweiligen Ident -- dieselbe Grundlage,
 * auf der auch die Produktart des gescannten Bauteils bestimmt wird
 * (stageFromTypeNames).
 *
 * Je Produktart nur EIN Vertreter: aus einer Platte koennen viele gleichartige
 * Idente kommen, und die 169. Abfrage liefert denselben Typ wie die erste.
 */
async function resolveDownstreamStages(
  downstreamEpcs: Set<string>,
  sources: string[],
): Promise<ProductStage[]> {
  if (downstreamEpcs.size === 0 || sources.length === 0) return [];

  // Je Produktart (itemRef) ein Vertreter. Die Itemreference entscheidet hier
  // NICHT ueber die Stufe -- sie dient nur als Gruppierung, um nicht dieselbe
  // Produktart mehrfach abzufragen.
  const byItemRef = new Map<string, string>();
  for (const candidate of downstreamEpcs) {
    const key = itemRefOf(candidate);
    if (!byItemRef.has(key)) byItemRef.set(key, candidate);
  }

  const found = await Promise.all(
    [...byItemRef.values()].map(async (candidate) => {
      const rows = await executeQuery(createEpcQuery(candidate), sources).catch((err) => {
        // Eine einzelne Stufe darf die Auskunft nicht abreissen lassen: die
        // uebrigen Vertreter bleiben gueltig.
        console.debug('[SPARQL] Downstream-Typ nicht ermittelbar für', candidate, err);
        return [] as SparqlBinding[];
      });
      const types = rows.map((row) => row.type?.value).filter((t): t is string => !!t);
      return stageFromTypeNames(types);
    }),
  );

  const stages = [...new Set(found.filter((s): s is ProductStage => s !== null))];
  console.debug(
    `[SPARQL] Downstream: ${byItemRef.size} Produktart(en) geprüft, Stufen:`,
    stages.length ? stages : '(keine bestimmbar)',
  );
  return stages;
}

function emptyResult(sources: string[], errors: string[]): ProductDataResult {
  return {
    product: [],
    stem: [],
    forest: [],
    sawmill: [],
    bspWerk: [],
    supplyChain: [],
    businessPartners: [],
    transportOrders: [],
    certificates: [],
    declarations: [],
    deconstruction: [],
    documentation: [],
    liability: [],
    lca: [],
    dbpp: [],
    sourceStatus: sources.map((url) => ({ url, available: false, pod: extractPodHost(url) })),
    errors,
  };
}

/**
 * Nach dem Erfassen: nur Ident und Produktart.
 *
 * Der Scan ist kostenlos und zeigt nichts, wofuer man zahlen muesste. Er darf
 * deshalb auch nicht die Daten aller Anwendungsfaelle holen -- das kostet
 * Wartezeit fuer etwas, das der Nutzer vielleicht nie oeffnet. Die
 * Vollabfrage laeuft erst, wenn ein Anwendungsfall geoeffnet wird
 * (fetchProductData mit dem gewaehlten Umfang).
 *
 * Trace-Ids gehen weiterhin den direkten Weg: dort ist die Quellenliste durch
 * den Katalogeintrag ohnehin auf ein Bauteil begrenzt.
 */
export async function fetchScanPreview(id: string): Promise<ProductDataResult> {
  if (isEpc(id)) return fetchScanData(id);
  return fetchProductData(id);
}

export async function fetchProductData(
  traceId: string,
  sources?: string[],
  scope: ChainScope = 'full'
): Promise<ProductDataResult> {
  // EPCIS-centric flow: a scanned GS1 EPC (SGTIN/LGTIN) is resolved via EPCAT
  // first, then the linked pod data is queried. Trace-ids / doc-hashes keep the
  // existing direct flow below.
  //
  // ``scope`` wirkt nur hier: der Trace-Id-Pfad kennt keine EPC-Kette, die man
  // eingrenzen koennte.
  if (!sources && isEpc(traceId)) {
    return fetchProductDataByEpc(traceId, scope);
  }

  const errors: string[] = [];

  // Auto-select sources based on product ID if not explicitly provided
  // Use async version to search catalog if needed
  let effectiveSources: string[];
  if (sources) {
    effectiveSources = sources;
  } else {
    // Try sync first (fast path)
    effectiveSources = getSourcesForProduct(traceId);

    // If no sources found, try async catalog search
    if (effectiveSources.length === 0 || effectiveSources[0].includes(traceId)) {
      console.log('[SPARQL] No cached sources, searching catalog...');
      try {
        effectiveSources = await getSourcesForProductAsync(traceId);
      } catch (error) {
        console.error('[SPARQL] Catalog search failed:', error);
        errors.push('Katalog-Suche fehlgeschlagen');
      }
    }
  }

  console.log('[SPARQL] Fetching all product data for traceId:', traceId);
  console.log('[SPARQL] Using sources:', effectiveSources);

  // Role pre-filter: drop sources whose owning pod does not admit our role.
  // Pods without a published role-policy are kept (legacy/public).
  const { allowed: permittedSources, denied } = await filterSourcesByRole(
    effectiveSources,
    getCurrentRole(),
  );
  if (denied.length > 0) {
    console.log('[SPARQL] Sources excluded by role policy:', denied);
    denied.forEach((url) => {
      errors.push(`Keine Berechtigung für: ${extractPodHost(url)}`);
    });
  }
  effectiveSources = permittedSources;

  // Check source availability.
  const { available, unavailable } = await filterAvailableSources(effectiveSources);

  // effectiveSources is a superset of speculative candidate URLs (different
  // layouts/filenames); most are expected to 404. Only surface an unreachable-
  // source warning when NOTHING could be loaded — otherwise it's just noise.
  if (unavailable.length > 0) {
    console.warn('[SPARQL] Unavailable candidate sources (expected for speculative URLs):', unavailable);
    if (available.length === 0) {
      unavailable.forEach((url) => {
        errors.push(`Quelle nicht erreichbar: ${extractPodHost(url)}`);
      });
    }
  }

  if (available.length === 0) {
    console.error('[SPARQL] No available sources for product:', traceId);
    return {
      product: [],
      stem: [],
      forest: [],
      sawmill: [],
      bspWerk: [],
      supplyChain: [],
      businessPartners: [],
      transportOrders: [],
      certificates: [],
      declarations: [],
      deconstruction: [],
      documentation: [],
      liability: [],
      lca: [],
      dbpp: [],
      sourceStatus: effectiveSources.map((url) => ({
        url,
        available: false,
        pod: extractPodHost(url),
      })),
      errors: [...errors, 'Keine Datenquellen erreichbar'],
    };
  }

  // Execute all queries in parallel using only available sources
  const [
    product,
    stem,
    forest,
    sawmill,
    bspWerk,
    supplyChain,
    businessPartners,
    transportOrders,
    certificates,
    declarations,
    deconstruction,
    documentation,
    liability,
    lca,
    dbpp,
  ] = await Promise.all([
      // ALLE Abfragen dieses Pfades laufen ohne Ident-Schranke, und das ist
      // hier richtig: der Trace-Id-Pfad kennt keine EPC-Kette. Die Quellen
      // stammen aus dem Katalogeintrag GENAU DIESER Trace-Id, sind also
      // bereits auf ein Bauteil begrenzt -- anders als im EPC-Pfad, der den
      // ganzen Katalog laedt. Eine leere Ident-Liste laesst die Schranke
      // bewusst entfallen.
      //
      // queryStem behaelt die traceId: seine Abfrage filtert ueber
      // tc:stemKey, solange kein Ident vorliegt.
      queryProduct([], available).catch((e) => {
        console.error('[SPARQL] Product query failed:', e);
        return [];
      }),
      queryStem(traceId, available).catch((e) => {
        console.error('[SPARQL] Stem query failed:', e);
        return [];
      }),
      queryForestSource([], available).catch((e) => {
        console.error('[SPARQL] Forest query failed:', e);
        return [];
      }),
      querySawmillSource([], available).catch((e) => {
        console.error('[SPARQL] Sawmill query failed:', e);
        return [];
      }),
      queryBspWerkSource([], available).catch((e) => {
        console.error('[SPARQL] BSP-Werk query failed:', e);
        return [];
      }),
      querySupplyChain([], available).catch((e) => {
        console.error('[SPARQL] Supply chain query failed:', e);
        return [];
      }),
      queryBusinessPartners([], available).catch((e) => {
        console.error('[SPARQL] Business partners query failed:', e);
        return [];
      }),
      queryTransportOrders(available).catch((e) => {
        console.error('[SPARQL] Transport orders query failed:', e);
        return [];
      }),
      queryCertificateData(available).catch((e) => {
        console.error('[SPARQL] Certificate query failed:', e);
        return [];
      }),
      queryDeclarations(available).catch((e) => {
        console.error('[SPARQL] Declaration query failed:', e);
        return [];
      }),
      queryDeconstruction(available).catch((e) => {
        console.error('[SPARQL] Deconstruction query failed:', e);
        return [];
      }),
      queryDocumentation(available).catch((e) => {
        console.error('[SPARQL] Documentation query failed:', e);
        return [];
      }),
      queryLiability(available).catch((e) => {
        console.error('[SPARQL] Liability query failed:', e);
        return [];
      }),
      queryLca(available).catch((e) => {
        console.error('[SPARQL] LCA query failed:', e);
        return [];
      }),
      queryDbpp(available).catch((e) => {
        console.error('[SPARQL] DBPP query failed:', e);
        return [];
      }),
    ]);

  // Build source status
  const sourceStatus: SourceStatus[] = effectiveSources.map((url) => ({
    url,
    available: available.includes(url),
    pod: extractPodHost(url),
  }));

  return {
    product,
    stem,
    forest,
    sawmill,
    bspWerk,
    supplyChain,
    businessPartners,
    transportOrders,
    certificates,
    declarations,
    deconstruction,
    documentation,
    liability,
    lca,
    dbpp,
    sourceStatus,
    errors,
    loadedFully: true,
  };
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use fetchProductData which includes source status
 */
export async function fetchProductDataLegacy(
  traceId: string,
  sources?: string[]
): Promise<{
  product: SparqlBinding[];
  stem: SparqlBinding[];
  forest: SparqlBinding[];
  sawmill: SparqlBinding[];
  bspWerk: SparqlBinding[];
  supplyChain: SparqlBinding[];
  businessPartners: SparqlBinding[];
}> {
  const result = await fetchProductData(traceId, sources);
  return {
    product: result.product,
    stem: result.stem,
    forest: result.forest,
    sawmill: result.sawmill,
    bspWerk: result.bspWerk,
    supplyChain: result.supplyChain,
    businessPartners: result.businessPartners,
  };
}

// ---------------------------------------------------------------------------
// Pflanzflaechen
// ---------------------------------------------------------------------------

/** Eine Pflanzflaeche mit den Begleitdaten aus dem Stammzertifikat. */
export interface PlantingAreaResult extends PlantingArea {
  /** EPC des Vermehrungsguts, auf das sich das Zertifikat bezieht. */
  epc: string | null;
  /** Stammzertifikat-Nr. */
  certificateNumber: string | null;
  species: string | null;
  maturityYear: string | null;
}

function bindingsToAreas(rows: SparqlBinding[]): PlantingAreaResult[] {
  const byIri = new Map<string, PlantingAreaResult>();
  for (const row of rows) {
    const iri = row.certificate?.value;
    const ring = parseWktPolygon(row.wkt?.value);
    // Ein unlesbares WKT-Literal soll die Anzeige nicht kippen -- solche
    // Zeilen werden uebersprungen, nicht als leere Flaeche gefuehrt.
    if (!iri || !ring || byIri.has(iri)) continue;

    const lat = Number(row.lat?.value);
    const long = Number(row.long?.value);
    byIri.set(iri, {
      certificateIri: iri,
      ring,
      centroid:
        Number.isFinite(lat) && Number.isFinite(long)
          ? { lat, lon: long }
          : null,
      epc: row.epc?.value ?? null,
      certificateNumber: row.zertifikatNr?.value ?? null,
      species: row.baumart?.value ?? null,
      maturityYear: row.reifejahr?.value ?? null,
    });
  }
  return Array.from(byIri.values());
}

/**
 * Alle Pflanzflaechen aus den erreichbaren Pods laden.
 */
export async function queryPlantingAreas(
  sources: string[] = DEFAULT_SOURCES,
): Promise<PlantingAreaResult[]> {
  const rows = await executeQuery(createPlantingAreaQuery(), sources);
  return bindingsToAreas(rows);
}

/**
 * Die Pflanzflaeche zu einem Vermehrungsgut-EPC ("Wo wurde das gepflanzt?").
 */
export async function queryPlantingAreaByEpc(
  epc: string,
  sources: string[] = DEFAULT_SOURCES,
): Promise<PlantingAreaResult[]> {
  const rows = await executeQuery(createPlantingAreaByEpcQuery(epc), sources);
  return bindingsToAreas(rows);
}

/**
 * Rueckwaertssuche: aus welchem Pflanzvorgang stammt ein Produkt?
 *
 * Nimmt die GPS-Position des Produkts (aus den Maschinendaten: Stamm- bzw.
 * Polterkoordinate) und liefert die Pflanzflaechen, die diesen Punkt
 * einschliessen. Genau dafuer wird die Flaeche beim Pflanzvorgang erhoben.
 */
export async function findPlantingAreasForPosition(
  position: GeoPoint,
  sources: string[] = DEFAULT_SOURCES,
): Promise<PlantingAreaResult[]> {
  const areas = await queryPlantingAreas(sources);
  return areasContaining(position, areas) as PlantingAreaResult[];
}

// ---------------------------------------------------------------------------
// EPC-Auswahl (Materialbezug)
// ---------------------------------------------------------------------------

/** Ein im Pod vorhandener EPC, zur Auswahl als Materialbezug. */
export interface EpcOption {
  /** urn:epc:id:sgtin:... oder urn:epc:class:lgtin:... */
  epc: string;
  /** Dokument, in dem der EPC auftaucht (Herkunftshinweis fuer den Nutzer). */
  sourceDoc: string | null;
}

// Nur syntaktisch gueltige GS1-EPCs anbieten -- der Extraktor lehnt alles
// andere ohnehin ab (pdf_template_service._EPC_URN_RE).
const EPC_URN_RE =
  /^urn:epc:(id:sgtin|class:lgtin):[0-9]+\.[0-9]+\.[A-Za-z0-9_-]+$/;

/**
 * Die im Pod vorhandenen EPCs auflisten.
 *
 * Grundlage der Auswahl beim Materialbezug: der Nutzer soll das bezogene Holz
 * waehlen, nicht abtippen -- ein vertippter EPC erzeugt eine Verknuepfung, die
 * im Graph echt aussieht, aber ins Leere zeigt.
 */
export async function queryAvailableEpcs(
  sources: string[] = DEFAULT_SOURCES,
): Promise<EpcOption[]> {
  if (sources.length === 0) return [];
  const rows = await executeQuery(createEpcListQuery(), sources);
  const byEpc = new Map<string, EpcOption>();
  for (const row of rows) {
    const epc = row.epc?.value?.trim();
    if (!epc || !EPC_URN_RE.test(epc) || byEpc.has(epc)) continue;
    byEpc.set(epc, { epc, sourceDoc: row.epcisDoc?.value ?? null });
  }
  return Array.from(byEpc.values());
}
