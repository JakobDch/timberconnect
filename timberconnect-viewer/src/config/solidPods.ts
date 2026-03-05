/**
 * Solid Pod Configuration for TimberConnect
 *
 * Product data sources are now dynamically loaded from the Semantic Data Catalog.
 * This file provides the interface and utility functions for managing products.
 */

import {
  getCatalogProducts,
  getSourcesForProductFromCatalog,
  invalidateCache as invalidateCatalogCache,
  searchProductById,
} from '../services/catalogService';

// Base URL for the EPCIS repository Solid Pod (used for uploaded products)
export const SOLID_POD_BASE = 'https://tmdt-solid-community-server.de/epcisrepository';

// Public folder containing TTL data files
export const SOLID_POD_PUBLIC = `${SOLID_POD_BASE}/public/`;

// Default sources - will be populated from catalog
export let DEFAULT_SOURCES: string[] = [];

// RDF Namespaces used in TimberConnect data
export const NAMESPACES = {
  tc: 'http://timberconnect.2050.de/ontology#',
  tcr: 'http://timberconnect.2050.de/resource/',
  eldat: 'http://timberconnect.2050.de/ontology/eldat#',
  vlex: 'http://timberconnect.2050.de/ontology/vlex#',
  geo: 'http://www.w3.org/2003/01/geo/wgs84_pos#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#'
} as const;

// Species code mapping (ELDAT codes to German names)
export const SPECIES_MAP: Record<string, string> = {
  'fi': 'Fichte',
  'FI': 'Fichte',
  'ta': 'Tanne',
  'TA': 'Tanne',
  'ki': 'Kiefer',
  'KI': 'Kiefer',
  'la': 'Lärche',
  'LA': 'Lärche',
  'dg': 'Douglasie',
  'DG': 'Douglasie',
  'bu': 'Buche',
  'BU': 'Buche',
  'ei': 'Eiche',
  'EI': 'Eiche'
};

// Scientific names for wood species
export const SPECIES_SCIENTIFIC: Record<string, string> = {
  'Fichte': 'Picea abies',
  'Tanne': 'Abies alba',
  'Kiefer': 'Pinus sylvestris',
  'Lärche': 'Larix decidua',
  'Douglasie': 'Pseudotsuga menziesii',
  'Buche': 'Fagus sylvatica',
  'Eiche': 'Quercus robur'
};

// Product configuration interface
export interface ProductConfig {
  id: string;
  name: string;
  description: string;
  sources: string[];
}

// Catalog products storage - populated by initializeCatalog()
let catalogProducts: ProductConfig[] = [];
let catalogInitialized = false;
let catalogError: string | null = null;

// Runtime storage for dynamically uploaded products
const uploadedProducts: Map<string, ProductConfig> = new Map();

/**
 * Register a newly uploaded product with its data sources.
 * This allows uploaded products to be queried via Comunica.
 */
export function registerUploadedProduct(
  traceId: string,
  sources: { forst?: string; saegewerk?: string; bspwerk?: string }
): void {
  const sourceUrls = Object.values(sources).filter(Boolean) as string[];

  if (sourceUrls.length === 0) {
    console.warn(`[solidPods] No sources provided for product ${traceId}`);
    return;
  }

  const product: ProductConfig = {
    id: traceId,
    name: `BSP-Platte ${traceId}`,
    description: 'Hochgeladenes Produkt',
    sources: sourceUrls
  };

  uploadedProducts.set(traceId, product);
  console.log(`[solidPods] Registered uploaded product: ${traceId}`, sourceUrls);
}

/**
 * Initialize the catalog - fetches products from Semantic Data Catalog.
 * Call this on app startup.
 */
export async function initializeCatalog(): Promise<void> {
  if (catalogInitialized) {
    console.log('[solidPods] Catalog already initialized');
    return;
  }

  console.log('[solidPods] Initializing catalog...');
  catalogError = null;

  try {
    catalogProducts = await getCatalogProducts();
    catalogInitialized = true;

    // Set default sources from first product if available
    if (catalogProducts.length > 0) {
      DEFAULT_SOURCES = catalogProducts[0].sources;
    }

    console.log('[solidPods] Catalog initialized with', catalogProducts.length, 'products');
  } catch (error) {
    catalogError = error instanceof Error ? error.message : 'Failed to load catalog';
    console.error('[solidPods] Failed to initialize catalog:', error);
    throw error;
  }
}

/**
 * Check if the catalog has been initialized.
 */
export function isCatalogInitialized(): boolean {
  return catalogInitialized;
}

/**
 * Get catalog initialization error if any.
 */
export function getCatalogError(): string | null {
  return catalogError;
}

/**
 * Refresh the catalog data.
 */
export async function refreshCatalog(): Promise<void> {
  catalogInitialized = false;
  invalidateCatalogCache();
  await initializeCatalog();
}

/**
 * Get all available products (catalog + dynamically uploaded).
 */
export function getAllProducts(): ProductConfig[] {
  return [...catalogProducts, ...Array.from(uploadedProducts.values())];
}

/**
 * Get all products asynchronously - initializes catalog if needed.
 */
export async function getAllProductsAsync(): Promise<ProductConfig[]> {
  if (!catalogInitialized) {
    await initializeCatalog();
  }
  return getAllProducts();
}

/**
 * Check if a product exists (catalog or uploaded).
 */
export function hasProduct(productId: string): boolean {
  return (
    catalogProducts.some(p => p.id.toLowerCase() === productId.toLowerCase()) ||
    uploadedProducts.has(productId)
  );
}

/**
 * Get sources for a specific product ID (synchronous).
 * For async search with catalog lookup, use getSourcesForProductAsync().
 */
export function getSourcesForProduct(productId: string): string[] {
  // Check catalog products first
  const catalogSources = getSourcesForProductFromCatalog(productId);
  if (catalogSources.length > 0) {
    return catalogSources;
  }

  // Check dynamically uploaded products
  const uploadedProduct = uploadedProducts.get(productId);
  if (uploadedProduct) {
    return uploadedProduct.sources;
  }

  // For unknown products, try to construct URLs based on naming convention
  const potentialSources = [
    `${SOLID_POD_PUBLIC}${productId}_Forst_StanForD_HPR.ttl`,
    `${SOLID_POD_PUBLIC}${productId}_Saegewerk_ELDAT_HBA.ttl`,
    `${SOLID_POD_PUBLIC}${productId}_BSPWerk_VLEX_Materialfluss.ttl`,
  ];

  console.log(`[solidPods] Using potential sources for unknown product ${productId}:`, potentialSources);
  return potentialSources;
}

/**
 * Get sources for a specific product ID with async catalog search.
 * This will search the catalog if the product is not in cache.
 */
export async function getSourcesForProductAsync(productId: string): Promise<string[]> {
  // Check catalog products first
  const catalogSources = getSourcesForProductFromCatalog(productId);
  if (catalogSources.length > 0) {
    return catalogSources;
  }

  // Check dynamically uploaded products
  const uploadedProduct = uploadedProducts.get(productId);
  if (uploadedProduct) {
    return uploadedProduct.sources;
  }

  // Search in catalog (this will refresh cache and search)
  console.log(`[solidPods] Searching catalog for product: ${productId}`);
  const catalogProduct = await searchProductById(productId);
  if (catalogProduct) {
    // Register the found product for future sync access
    uploadedProducts.set(productId, catalogProduct);
    return catalogProduct.sources;
  }

  // Fallback: construct URLs based on naming convention
  const potentialSources = [
    `${SOLID_POD_PUBLIC}${productId}_Forst_StanForD_HPR.ttl`,
    `${SOLID_POD_PUBLIC}${productId}_Saegewerk_ELDAT_HBA.ttl`,
    `${SOLID_POD_PUBLIC}${productId}_BSPWerk_VLEX_Materialfluss.ttl`,
  ];

  console.log(`[solidPods] Using fallback sources for product ${productId}:`, potentialSources);
  return potentialSources;
}
