/**
 * Catalog Service for TimberConnect
 *
 * Fetches datasets from federated Solid Pods via a central Federation Registry.
 * Workflow: Registry -> Pods -> Catalogs -> Datasets -> downloadURLs -> Comunica
 */

import type { CatalogDataset, CatalogCache } from '../types/catalog';
import type { ProductConfig } from '../config/solidPods';
import { Parser, Store, DataFactory } from 'n3';

const { namedNode } = DataFactory;

// RDF Namespaces
const DCAT = 'http://www.w3.org/ns/dcat#';
const DCT = 'http://purl.org/dc/terms/';
const LDP = 'http://www.w3.org/ns/ldp#';

// Configuration
const FEDERATION_REGISTRY_URL =
  import.meta.env.VITE_FEDERATION_REGISTRY_URL ||
  'https://tmdt-solid-community-server.de/semanticdatacatalog/public/dace/';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache instance
let cache: CatalogCache | null = null;
let catalogProducts: ProductConfig[] = [];

// ============================================================================
// FEDERATION: Pod Discovery
// ============================================================================

/**
 * Discover all registered Pods from the Federation Registry.
 * Returns an array of Pod base URLs.
 */
async function discoverRegisteredPods(): Promise<string[]> {
  console.log('[CatalogService] Discovering pods from Federation Registry:', FEDERATION_REGISTRY_URL);

  const response = await fetch(FEDERATION_REGISTRY_URL, {
    headers: { Accept: 'text/turtle' },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Federation Registry fetch failed: ${response.status}`);
  }

  const turtle = await response.text();
  // FIX: Add baseIRI to correctly resolve <> references
  const parser = new Parser({ baseIRI: FEDERATION_REGISTRY_URL });
  const store = new Store();
  store.addQuads(parser.parse(turtle));

  // FIX: Try multiple subject formats for ldp:contains
  // The subject could be the full URL, without trailing slash, or relative
  const possibleSubjects = [
    FEDERATION_REGISTRY_URL,
    FEDERATION_REGISTRY_URL.replace(/\/$/, ''),
    './',
    '',
  ];

  let members: string[] = [];
  for (const subjectUri of possibleSubjects) {
    const subject = subjectUri ? namedNode(subjectUri) : null;
    const objects = subject
      ? store.getObjects(subject, namedNode(LDP + 'contains'), null)
      : store.getObjects(null, namedNode(LDP + 'contains'), null);

    if (objects.length > 0) {
      members = objects.map((obj) => obj.value);
      console.log('[CatalogService] Found ldp:contains with subject:', subjectUri || 'any', '- count:', objects.length);
      break;
    }
  }

  // Fallback: get all ldp:contains triples
  if (members.length === 0) {
    const allContains = store.getQuads(null, namedNode(LDP + 'contains'), null, null);
    members = allContains.map((quad) => quad.object.value);
    console.log('[CatalogService] Using all ldp:contains triples, count:', allContains.length);
  }

  // Parse member URIs to extract Pod URLs
  // Members are double URL-encoded: member-https%253A%2F%2F...
  const podUrls: string[] = [];

  for (const member of members) {
    try {
      // Extract the encoded part after "member-"
      const filename = member.split('/').pop() || '';
      if (!filename.startsWith('member-')) continue;

      const encodedWebId = filename.substring('member-'.length);
      // Double URL decode
      const decodedOnce = decodeURIComponent(encodedWebId);
      const webId = decodeURIComponent(decodedOnce);

      // Extract Pod base URL from WebID
      // e.g., https://tmdt.../dace/profile/card#me -> https://tmdt.../dace/
      const match = webId.match(/^(https?:\/\/[^/]+\/[^/]+\/)/);
      if (match) {
        podUrls.push(match[1]);
      }
    } catch (e) {
      console.warn('[CatalogService] Failed to parse member:', member, e);
    }
  }

  console.log('[CatalogService] Discovered', podUrls.length, 'pods:', podUrls);
  return podUrls;
}

// ============================================================================
// FEDERATION: Catalog Fetching
// ============================================================================

/**
 * Fetch all dataset URLs from a Pod's catalog container.
 */
async function fetchPodCatalogUrls(podUrl: string): Promise<string[]> {
  const catalogUrl = `${podUrl}catalog/ds/`;
  console.log('[CatalogService] Fetching catalog:', catalogUrl);

  try {
    const response = await fetch(catalogUrl, {
      headers: { Accept: 'text/turtle' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn('[CatalogService] Catalog not found:', catalogUrl);
      return [];
    }

    const turtle = await response.text();
    // Parse with baseIRI to resolve relative URLs
    const parser = new Parser({ baseIRI: catalogUrl });
    const store = new Store();
    store.addQuads(parser.parse(turtle));

    // Try multiple subject formats for ldp:contains
    // The subject could be the full URL or just the container path
    const possibleSubjects = [
      catalogUrl,
      catalogUrl.replace(/\/$/, ''), // Without trailing slash
      './',
      '',
    ];

    let containedUrls: string[] = [];
    for (const subjectUri of possibleSubjects) {
      const subject = subjectUri ? namedNode(subjectUri) : null;
      const objects = subject
        ? store.getObjects(subject, namedNode(LDP + 'contains'), null)
        : store.getObjects(null, namedNode(LDP + 'contains'), null);

      if (objects.length > 0) {
        containedUrls = objects.map((obj) => obj.value);
        console.log('[CatalogService] Found ldp:contains with subject:', subjectUri || 'any', '- count:', objects.length);
        break;
      }
    }

    // If still no results, try getting all ldp:contains triples
    if (containedUrls.length === 0) {
      const allContains = store.getQuads(null, namedNode(LDP + 'contains'), null, null);
      containedUrls = allContains.map((quad) => quad.object.value);
      console.log('[CatalogService] Using all ldp:contains triples, count:', allContains.length);
    }

    // Resolve relative URLs and filter for .ttl files
    const datasetUrls = containedUrls
      .map((url) => {
        // If URL is relative, resolve against catalogUrl
        if (!url.startsWith('http')) {
          return new URL(url, catalogUrl).href;
        }
        return url;
      })
      .filter((url) => url.endsWith('.ttl'));

    console.log('[CatalogService] Found', datasetUrls.length, 'datasets in', catalogUrl);
    if (datasetUrls.length > 0) {
      console.log('[CatalogService] Sample URLs:', datasetUrls.slice(0, 3));
    }
    return datasetUrls;
  } catch (error) {
    console.warn('[CatalogService] Error fetching catalog:', catalogUrl, error);
    return [];
  }
}

/**
 * Fetch and parse a single DCAT dataset, extracting the downloadURL.
 */
async function fetchAndParseDataset(datasetUrl: string): Promise<CatalogDataset | null> {
  try {
    const response = await fetch(datasetUrl, {
      headers: { Accept: 'text/turtle' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn('[CatalogService] Failed to fetch dataset:', datasetUrl);
      return null;
    }

    const turtleText = await response.text();
    const parser = new Parser();
    const store = new Store();
    store.addQuads(parser.parse(turtleText));

    // Find the dcat:Dataset subject
    const datasetSubjects = store.getSubjects(
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      namedNode(DCAT + 'Dataset'),
      null
    );

    if (datasetSubjects.length === 0) {
      console.warn('[CatalogService] No dcat:Dataset found in:', datasetUrl);
      return null;
    }

    const subject = datasetSubjects[0];

    // Helper to get first value of a predicate
    const getFirst = (pred: string): string | null => {
      const objects = store.getObjects(subject, namedNode(pred), null);
      return objects[0]?.value || null;
    };

    // Extract downloadURL via dcat:distribution -> dcat:downloadURL
    // Prefer TTL files over CSV for Comunica compatibility
    let downloadUrl: string | null = null;
    let csvFallbackUrl: string | null = null;

    const distributions = store.getObjects(subject, namedNode(DCAT + 'distribution'), null);
    for (const dist of distributions) {
      const urls = store.getObjects(dist, namedNode(DCAT + 'downloadURL'), null);
      for (const urlObj of urls) {
        let url = urlObj.value;
        // Resolve relative URLs
        if (!url.startsWith('http')) {
          url = new URL(url, datasetUrl).href;
        }

        // Prefer TTL files
        if (url.endsWith('.ttl')) {
          downloadUrl = url;
          break;
        } else if (url.endsWith('.csv') && !csvFallbackUrl) {
          csvFallbackUrl = url;
        } else if (!csvFallbackUrl) {
          // Any other format as last resort
          csvFallbackUrl = url;
        }
      }
      if (downloadUrl) break;
    }

    // Use CSV fallback if no TTL found
    if (!downloadUrl && csvFallbackUrl) {
      console.log('[CatalogService] No TTL distribution found, using fallback:', csvFallbackUrl);
      downloadUrl = csvFallbackUrl;
    }

    // Fallback to direct accessURL if no distribution found
    if (!downloadUrl) {
      downloadUrl = getFirst(DCAT + 'accessURL');
    }

    if (!downloadUrl) {
      console.warn('[CatalogService] No downloadURL found in:', datasetUrl);
      return null;
    }

    // Extract identifier from URL if not in RDF
    const extractIdFromUrl = (url: string): string => {
      const match = url.match(/([^/]+)\.ttl$/);
      return match ? match[1] : url.split('/').pop() || url;
    };

    return {
      identifier: getFirst(DCT + 'identifier') || extractIdFromUrl(datasetUrl),
      title: getFirst(DCT + 'title') || extractIdFromUrl(datasetUrl),
      description: getFirst(DCT + 'description'),
      issued: getFirst(DCT + 'issued'),
      modified: getFirst(DCT + 'modified'),
      is_public: getFirst(DCT + 'accessRights') === 'public' || true,
      access_url_dataset: downloadUrl,
      access_url_semantic_model: getFirst(DCT + 'conformsTo'),
      file_format: getFirst(DCT + 'format'),
      theme: getFirst(DCAT + 'theme'),
      publisher: getFirst(DCT + 'publisher') || 'Unknown',
      contact_point: getFirst(DCAT + 'contactPoint') || '',
      webid: null,
    };
  } catch (error) {
    console.warn('[CatalogService] Error parsing dataset:', datasetUrl, error);
    return null;
  }
}

// ============================================================================
// MAIN: Fetch All Federated Datasets
// ============================================================================

/**
 * Fetch all datasets from all federated Pods.
 */
async function fetchFederatedDatasets(): Promise<CatalogDataset[]> {
  console.log('[CatalogService] Starting federated dataset fetch...');

  // 1. Discover all registered Pods
  const podUrls = await discoverRegisteredPods();

  if (podUrls.length === 0) {
    throw new Error('No pods found in Federation Registry');
  }

  // 2. Fetch catalog URLs from each Pod (in parallel)
  const catalogPromises = podUrls.map((podUrl) => fetchPodCatalogUrls(podUrl));
  const catalogResults = await Promise.allSettled(catalogPromises);

  const allDatasetUrls: string[] = [];
  for (const result of catalogResults) {
    if (result.status === 'fulfilled') {
      allDatasetUrls.push(...result.value);
    }
  }

  console.log('[CatalogService] Total dataset URLs from all pods:', allDatasetUrls.length);

  // 3. Fetch and parse each dataset (in parallel, with concurrency limit)
  const datasets: CatalogDataset[] = [];
  const batchSize = 10;

  for (let i = 0; i < allDatasetUrls.length; i += batchSize) {
    const batch = allDatasetUrls.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map((url) => fetchAndParseDataset(url)));

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        datasets.push(result.value);
      }
    }
  }

  console.log('[CatalogService] Successfully parsed', datasets.length, 'datasets');
  return datasets;
}

/**
 * Fetch all datasets from Federation Registry (Live Solid Pods)
 */
export async function fetchCatalogDatasets(): Promise<CatalogDataset[]> {
  // Check cache
  if (cache && Date.now() - cache.lastFetched < CACHE_TTL) {
    console.log('[CatalogService] Using cached datasets');
    return cache.datasets;
  }

  let datasets: CatalogDataset[] = [];

  // Fetch from Federation
  try {
    datasets = await fetchFederatedDatasets();
  } catch (error) {
    console.error('[CatalogService] Federation fetch failed:', error);
    throw error;
  }

  console.log('[CatalogService] Total datasets fetched:', datasets.length);

  // Filter only public datasets with access URLs
  const validDatasets = datasets.filter((d) => d.is_public && d.access_url_dataset);
  console.log('[CatalogService] Valid datasets with access URLs:', validDatasets.length);

  // Update cache
  cache = {
    datasets: validDatasets,
    lastFetched: Date.now(),
  };

  // Group into products (async because TC-ID extraction may need to load data files)
  catalogProducts = await groupDatasetsToProducts(validDatasets);
  console.log('[CatalogService] Grouped into', catalogProducts.length, 'products');

  return validDatasets;
}

// ============================================================================
// PRODUCT GROUPING (unchanged)
// ============================================================================

/**
 * Group individual datasets into product configurations.
 * Async because TC-ID extraction may need to load data files.
 */
async function groupDatasetsToProducts(datasets: CatalogDataset[]): Promise<ProductConfig[]> {
  const productMap = new Map<
    string,
    {
      forst?: string;
      saegewerk?: string;
      bspwerk?: string;
      genericSources: string[];
      title?: string;
      description?: string;
      theme?: string;
    }
  >();

  // Extract TC-IDs for all datasets (in parallel batches for performance)
  console.log('[CatalogService] Extracting TC-IDs from', datasets.length, 'datasets...');
  const batchSize = 5;
  const datasetWithIds: { dataset: CatalogDataset; traceId: string | null }[] = [];

  for (let i = 0; i < datasets.length; i += batchSize) {
    const batch = datasets.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (dataset) => ({
        dataset,
        traceId: await extractTraceId(dataset),
      }))
    );
    datasetWithIds.push(...batchResults);
  }

  const validDatasets = datasetWithIds.filter((d) => d.traceId !== null);
  console.log('[CatalogService] Found', validDatasets.length, 'datasets with valid TC-IDs');

  for (const { dataset, traceId } of validDatasets) {
    if (!traceId) continue;

    if (!productMap.has(traceId)) {
      productMap.set(traceId, { genericSources: [] });
    }

    const product = productMap.get(traceId)!;
    const dataType = detectDataType(dataset);

    // Categorize by data type
    if (dataType === 'forst' && dataset.access_url_dataset) {
      product.forst = dataset.access_url_dataset;
    } else if (dataType === 'saegewerk' && dataset.access_url_dataset) {
      product.saegewerk = dataset.access_url_dataset;
    } else if (dataType === 'bspwerk' && dataset.access_url_dataset) {
      product.bspwerk = dataset.access_url_dataset;
      product.title = dataset.title;
      product.description = dataset.description || undefined;
    } else if (dataset.access_url_dataset) {
      product.genericSources.push(dataset.access_url_dataset);
      if (!product.title) {
        product.title = dataset.title;
        product.description = dataset.description || undefined;
      }
    }
  }

  return Array.from(productMap.entries())
    .map(([traceId, data]) => {
      const typedSources = [data.forst, data.saegewerk, data.bspwerk].filter(Boolean) as string[];
      const allSources = [...typedSources, ...data.genericSources];
      const uniqueSources = [...new Set(allSources)];

      return {
        id: traceId,
        name: data.title || `Produkt ${traceId}`,
        description: data.description || (data.theme ? `Theme: ${data.theme}` : 'Aus Katalog geladen'),
        sources: uniqueSources,
      };
    })
    .filter((p) => p.sources.length > 0);
}

/**
 * Extract TimberConnect Trace ID (TC-YYYY-NNN format) from catalog metadata.
 * Returns null if no valid TC ID is found in metadata.
 */
function extractTraceIdFromMetadata(dataset: CatalogDataset): string | null {
  const tcPattern = /TC-\d{4}-\d{3}/i;

  const idMatch = dataset.identifier?.match(tcPattern);
  if (idMatch) return idMatch[0].toUpperCase();

  const titleMatch = dataset.title?.match(tcPattern);
  if (titleMatch) return titleMatch[0].toUpperCase();

  const descMatch = dataset.description?.match(tcPattern);
  if (descMatch) return descMatch[0].toUpperCase();

  const urlTcMatch = dataset.access_url_dataset?.match(tcPattern);
  if (urlTcMatch) return urlTcMatch[0].toUpperCase();

  return null;
}

/**
 * Extract TimberConnect Trace ID by loading and parsing the actual data file.
 * Searches for TC-YYYY-NNN pattern in URIs and literals.
 */
async function extractTraceIdFromData(downloadUrl: string): Promise<string | null> {
  try {
    const response = await fetch(downloadUrl, {
      headers: { Accept: 'text/turtle' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn('[CatalogService] Failed to fetch data for TC-ID extraction:', downloadUrl);
      return null;
    }

    const turtleText = await response.text();

    // Search for TC-YYYY-NNN pattern in the data
    const tcPattern = /TC-\d{4}-\d{3}/gi;
    const matches = turtleText.match(tcPattern);

    if (matches && matches.length > 0) {
      // Return the first match, normalized to uppercase
      return matches[0].toUpperCase();
    }

    return null;
  } catch (error) {
    console.warn('[CatalogService] Error extracting TC-ID from data:', downloadUrl, error);
    return null;
  }
}

/**
 * Extract TimberConnect Trace ID - first from metadata, then from data if needed.
 */
async function extractTraceId(dataset: CatalogDataset): Promise<string | null> {
  // First: Try to get TC-ID from catalog metadata (fast)
  const metadataId = extractTraceIdFromMetadata(dataset);
  if (metadataId) return metadataId;

  // Second: Load the actual data file and search for TC-ID (slower but accurate)
  if (dataset.access_url_dataset) {
    const dataId = await extractTraceIdFromData(dataset.access_url_dataset);
    if (dataId) return dataId;
  }

  return null;
}

function detectDataType(dataset: CatalogDataset): 'forst' | 'saegewerk' | 'bspwerk' | 'unknown' {
  const title = dataset.title?.toLowerCase() || '';
  const url = dataset.access_url_dataset?.toLowerCase() || '';
  const identifier = dataset.identifier?.toLowerCase() || '';

  if (title.includes('forst') || url.includes('forst') || url.includes('stanford') || identifier.includes('forst')) {
    return 'forst';
  }

  if (
    title.includes('saegewerk') ||
    title.includes('sägewerk') ||
    url.includes('saegewerk') ||
    url.includes('eldat') ||
    identifier.includes('saegewerk')
  ) {
    return 'saegewerk';
  }

  if (title.includes('bsp') || url.includes('bspwerk') || url.includes('vlex') || identifier.includes('bsp')) {
    return 'bspwerk';
  }

  return 'unknown';
}

// ============================================================================
// PUBLIC API
// ============================================================================

export async function getCatalogProducts(): Promise<ProductConfig[]> {
  try {
    await fetchCatalogDatasets();
    return catalogProducts;
  } catch (error) {
    console.error('[CatalogService] Failed to get catalog products:', error);
    return [];
  }
}

export function getSourcesForProductFromCatalog(productId: string): string[] {
  const product = catalogProducts.find((p) => p.id.toLowerCase() === productId.toLowerCase());
  return product?.sources || [];
}

export async function searchProductById(productId: string): Promise<ProductConfig | null> {
  console.log('[CatalogService] Searching for product:', productId);

  try {
    const cachedProduct = catalogProducts.find((p) => p.id.toLowerCase() === productId.toLowerCase());
    if (cachedProduct) {
      console.log('[CatalogService] Found in cache:', cachedProduct.id);
      return cachedProduct;
    }

    await fetchCatalogDatasets();

    const product = catalogProducts.find((p) => p.id.toLowerCase() === productId.toLowerCase());
    if (product) {
      console.log('[CatalogService] Found after refresh:', product.id);
      return product;
    }

    if (cache?.datasets) {
      const matchingDatasets = cache.datasets.filter((d) => {
        const idLower = productId.toLowerCase();
        return (
          d.identifier?.toLowerCase() === idLower ||
          d.title?.toLowerCase().includes(idLower) ||
          d.access_url_dataset?.toLowerCase().includes(idLower)
        );
      });

      if (matchingDatasets.length > 0) {
        const sources = matchingDatasets.map((d) => d.access_url_dataset).filter(Boolean) as string[];
        if (sources.length > 0) {
          return {
            id: productId,
            name: matchingDatasets[0].title || `Produkt ${productId}`,
            description: matchingDatasets[0].description || 'Aus Katalog geladen',
            sources,
          };
        }
      }
    }

    console.log('[CatalogService] Product not found:', productId);
    return null;
  } catch (error) {
    console.error('[CatalogService] Error searching for product:', error);
    return null;
  }
}

export function getCachedDatasets(): CatalogDataset[] {
  return cache?.datasets || [];
}

export function invalidateCache(): void {
  cache = null;
  catalogProducts = [];
  console.log('[CatalogService] Cache invalidated');
}

export async function isCatalogAvailable(): Promise<boolean> {
  try {
    const response = await fetch(FEDERATION_REGISTRY_URL, {
      method: 'GET',
      headers: { Accept: 'text/turtle' },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function getCatalogApiUrl(): string {
  return FEDERATION_REGISTRY_URL;
}
