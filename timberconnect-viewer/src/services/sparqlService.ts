/**
 * SPARQL Service for TimberConnect
 *
 * Uses Comunica to execute SPARQL queries directly against Solid Pods.
 */

import { QueryEngine } from '@comunica/query-sparql';
import { DEFAULT_SOURCES, getSourcesForProduct, getSourcesForProductAsync } from '../config/solidPods';
import {
  createProductQuery,
  createStemQuery,
  createForestQuery,
  createSawmillQuery,
  createBspWerkQuery,
  createSupplyChainQuery,
  createBusinessPartnersQuery
} from './sparqlQueries';

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

    const response = await fetch(sourceUrl, {
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

/** Source status information */
export interface SourceStatus {
  url: string;
  available: boolean;
  pod: string; // extracted pod hostname
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
  sourceStatus: SourceStatus[];
  errors: string[];
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
export async function fetchProductData(
  traceId: string,
  sources?: string[]
): Promise<ProductDataResult> {
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

  // Check source availability
  const { available, unavailable } = await filterAvailableSources(effectiveSources);

  if (unavailable.length > 0) {
    console.warn('[SPARQL] Unavailable sources:', unavailable);
    unavailable.forEach((url) => {
      errors.push(`Quelle nicht erreichbar: ${extractPodHost(url)}`);
    });
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
      sourceStatus: effectiveSources.map((url) => ({
        url,
        available: false,
        pod: extractPodHost(url),
      })),
      errors: [...errors, 'Keine Datenquellen erreichbar'],
    };
  }

  // Execute all queries in parallel using only available sources
  const [product, stem, forest, sawmill, bspWerk, supplyChain, businessPartners] =
    await Promise.all([
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
