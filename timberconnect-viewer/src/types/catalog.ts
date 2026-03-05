/**
 * Type definitions for Semantic Data Catalog integration
 */

export interface CatalogDataset {
  identifier: string;
  title: string;
  description: string | null;
  issued: string | null;
  modified: string | null;
  is_public: boolean;
  access_url_dataset: string | null;
  access_url_semantic_model: string | null;
  file_format: string | null;
  theme: string | null;
  publisher: string;
  contact_point: string;
  webid: string | null;
  // Optional fields that may be present in API response
  semantic_model_file_name?: string | null;
  // Note: semantic_model_file contains full RDF content, omitted for performance
}

export interface CatalogCache {
  datasets: CatalogDataset[];
  lastFetched: number;
}

export interface CatalogState {
  isLoading: boolean;
  isAvailable: boolean;
  lastUpdated: Date | null;
  error: string | null;
}
