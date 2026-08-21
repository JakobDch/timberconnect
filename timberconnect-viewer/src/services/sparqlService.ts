/**
 * SPARQL Service for TimberConnect
 *
 * Uses Comunica to execute SPARQL queries directly against Solid Pods.
 */

import { QueryEngine } from '@comunica/query-sparql';
import {
  DEFAULT_SOURCES,
  getSourcesForProduct,
  getSourcesForProductAsync,
  getAllProductsAsync,
  buildPotentialSources,
} from '../config/solidPods';
import { getAuthFetch, getCurrentRole } from './authFetch';
import { filterSourcesByRole, podBaseFromUrl } from './accessControlService';
import {
  queryEpcisEvents,
  collectEpcs,
  collectBizTransactions,
  type EpcisEvent,
} from './epcisService';
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

// Singleton QueryEngine instance
let engine: QueryEngine | null = null;

// Timeout for source availability checks (ms)
const SOURCE_CHECK_TIMEOUT = 5000;

function getEngine(): QueryEngine {
  if (!engine) {
    engine = new QueryEngine();
  }
  return engine;
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
  const results = await Promise.all(
    sources.map(async (source) => ({
      source,
      available: await checkSourceAvailability(source),
    }))
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
    const bindingsStream = await queryEngine.queryBindings(query, {
      sources: sources,
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
 * Query product data (BSP Panel) by traceId
 */
export async function queryProduct(
  traceId: string,
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createProductQuery(traceId);
  console.log('[SPARQL] Querying product data for traceId:', traceId);
  return executeQuery(query, sources);
}

/**
 * Query stem data (forest origin) by traceId
 */
export async function queryStem(
  traceId: string,
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createStemQuery(traceId);
  console.log('[SPARQL] Querying stem data for traceId:', traceId);
  return executeQuery(query, sources);
}

/**
 * Query forest source data by traceId
 */
export async function queryForestSource(
  traceId: string,
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createForestQuery(traceId);
  console.log('[SPARQL] Querying forest source for traceId:', traceId);
  return executeQuery(query, sources);
}

/**
 * Query sawmill source data by traceId
 */
export async function querySawmillSource(
  traceId: string,
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createSawmillQuery(traceId);
  console.log('[SPARQL] Querying sawmill source for traceId:', traceId);
  return executeQuery(query, sources);
}

/**
 * Query BSP-Werk source data by traceId
 */
export async function queryBspWerkSource(
  traceId: string,
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createBspWerkQuery(traceId);
  console.log('[SPARQL] Querying BSP-Werk source for traceId:', traceId);
  return executeQuery(query, sources);
}

/**
 * Query complete supply chain by traceId
 */
export async function querySupplyChain(
  traceId: string,
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createSupplyChainQuery(traceId);
  console.log('[SPARQL] Querying supply chain for traceId:', traceId);
  return executeQuery(query, sources);
}

/**
 * Query business partners by traceId
 */
export async function queryBusinessPartners(
  traceId: string,
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createBusinessPartnersQuery(traceId);
  console.log('[SPARQL] Querying business partners for traceId:', traceId);
  return executeQuery(query, sources);
}

/**
 * Query transport orders (Herkunftsnachweis I-19..I-26).
 * Liefert ein Kreuzprodukt der Adressliterale -- siehe Query-Kommentar.
 */
export async function queryTransportOrders(
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createTransportOrdersQuery();
  console.log('[SPARQL] Querying transport orders');
  return executeQuery(query, sources);
}

/** Query certificates + test reports (Herkunftsnachweis I-5/I-6/I-7). */
export async function queryCertificateData(
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createCertificateDataQuery();
  console.log('[SPARQL] Querying certificates / test reports');
  return executeQuery(query, sources);
}

/** Leistungserklaerung + Rechnungsempfaenger (I-1/I-2, I-27/I-28). */
export async function queryDeclarations(
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createDeclarationQuery();
  console.log('[SPARQL] Querying declarations of performance / invoice');
  return executeQuery(query, sources);
}

/** ERP-Panel + Leistungserklaerung + Klebstoff (Rueckbaubarkeit I-29..I-56). */
export async function queryDeconstruction(
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createDeconstructionQuery();
  console.log('[SPARQL] Querying deconstruction data (panel / DoP / adhesive)');
  return executeQuery(query, sources);
}

/** Verortung im Gebaeude + Gewicht/Norm (Awf "Dokumentation" I-57..I-89). */
export async function queryDocumentation(
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createDocumentationQuery();
  console.log('[SPARQL] Querying documentation data (building part / project / panel)');
  return executeQuery(query, sources);
}

/** Pruefwerte, Konformitaet und Verantwortung (Awf "Nachweis der Haftung" I-1..I-44). */
export async function queryLiability(
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createLiabilityQuery();
  console.log('[SPARQL] Querying liability data (test report / DoP / adhesive / panel)');
  return executeQuery(query, sources);
}

/** Eingangsgroessen + Zusatzinfos der CO2-Bilanz (Awf "CO2-Bilanz"). */
export async function queryLca(
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createLcaQuery();
  console.log('[SPARQL] Querying LCA data (panel / transport orders / DoP / adhesive)');
  return executeQuery(query, sources);
}

/** Produktpass-Angaben nach CPR Art. 76 / ESPR (Awf "DBPP"). */
export async function queryDbpp(
  sources: string[] = DEFAULT_SOURCES
): Promise<SparqlBinding[]> {
  const query = createDbppQuery();
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
  sourceStatus: SourceStatus[];
  errors: string[];
  epcisInfo?: EpcisInfo;
  /** Rohe EPCIS-Events des EPC-Flows -- Quelle der Transportdaten
      (eventTime + bizStep). Nur beim EPC-zentrischen Abruf gesetzt. */
  epcisEvents?: EpcisEvent[];
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
 * EPCIS-centric retrieval: a GS1 EPC -> EPCAT events -> linked EPCs + pod sources
 * -> pod SPARQL. The lifecycle-chain walk (childEPCs across stations) plugs into
 * collectEpcs once AggregationEvents are produced; today this resolves the single
 * scanned object's data.
 */
export async function fetchProductDataByEpc(epc: string): Promise<ProductDataResult> {
  const errors: string[] = [];
  console.log('[SPARQL] EPCIS flow for EPC:', epc);

  // 1. Ask the (role+consent-gated) EPCIS proxy for this EPC's events.
  let events: Awaited<ReturnType<typeof queryEpcisEvents>>['events'] = [];
  let eventsReturned = 0;
  let eventsFilteredOut = 0;
  try {
    const result = await queryEpcisEvents(epc);
    events = result.events;
    eventsReturned = result.returned;
    eventsFilteredOut = result.filteredOut;
    console.log(
      `[SPARQL] EPCAT: ${result.returned} events (${result.filteredOut} filtered by consent)`,
    );
  } catch (err) {
    console.error('[SPARQL] EPCAT query failed:', err);
    errors.push(err instanceof Error ? err.message : 'EPCAT-Abfrage fehlgeschlagen');
  }

  // 2. Collect the EPCs of the (eventual) chain + the pod-document links.
  const epcs = new Set<string>([epc, ...collectEpcs(events)]);
  const bizTxUrls = collectBizTransactions(events);
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

  // 4. For each EPC, query the pod for the bearing subject + its product data.
  const epcBindings = (
    await Promise.all(
      [...epcs].map((e) =>
        executeQuery(createEpcQuery(e), available).catch((err) => {
          console.error('[SPARQL] EPC query failed for', e, err);
          return [] as SparqlBinding[];
        }),
      ),
    )
  ).flat();

  // 5. Run the regular product/stem/sawmill/bsp queries unfiltered over the same
  //    sources so the product pass renders with full detail. The id is the EPC,
  //    which is not a trace-id, so these queries run without an in-file filter.
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
    queryProduct(epc, available).catch(() => []),
    queryStem(epc, available).catch(() => []),
    queryForestSource(epc, available).catch(() => []),
    querySawmillSource(epc, available).catch(() => []),
    queryBspWerkSource(epc, available).catch(() => []),
    querySupplyChain(epc, available).catch(() => []),
    queryBusinessPartners(epc, available).catch(() => []),
    queryTransportOrders(available).catch(() => []),
    queryCertificateData(available).catch(() => []),
    queryDeclarations(available).catch(() => []),
    queryDeconstruction(available).catch(() => []),
    queryDocumentation(available).catch(() => []),
    queryLiability(available).catch(() => []),
    queryLca(available).catch(() => []),
    queryDbpp(available).catch(() => []),
  ]);

  return {
    product: product.length ? product : epcBindings,
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
    sourceStatus: available.map((url) => ({ url, available: true, pod: extractPodHost(url) })),
    errors,
    epcisInfo,
    epcisEvents: events,
  };
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

export async function fetchProductData(
  traceId: string,
  sources?: string[]
): Promise<ProductDataResult> {
  // EPCIS-centric flow: a scanned GS1 EPC (SGTIN/LGTIN) is resolved via EPCAT
  // first, then the linked pod data is queried. Trace-ids / doc-hashes keep the
  // existing direct flow below.
  if (!sources && isEpc(traceId)) {
    return fetchProductDataByEpc(traceId);
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
      queryProduct(traceId, available).catch((e) => {
        console.error('[SPARQL] Product query failed:', e);
        return [];
      }),
      queryStem(traceId, available).catch((e) => {
        console.error('[SPARQL] Stem query failed:', e);
        return [];
      }),
      queryForestSource(traceId, available).catch((e) => {
        console.error('[SPARQL] Forest query failed:', e);
        return [];
      }),
      querySawmillSource(traceId, available).catch((e) => {
        console.error('[SPARQL] Sawmill query failed:', e);
        return [];
      }),
      queryBspWerkSource(traceId, available).catch((e) => {
        console.error('[SPARQL] BSP-Werk query failed:', e);
        return [];
      }),
      querySupplyChain(traceId, available).catch((e) => {
        console.error('[SPARQL] Supply chain query failed:', e);
        return [];
      }),
      queryBusinessPartners(traceId, available).catch((e) => {
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
