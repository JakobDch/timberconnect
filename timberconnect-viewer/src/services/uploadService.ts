/**
 * Upload Service for TimberConnect
 *
 * Handles file uploads, RML conversion, and Solid Pod storage.
 */

// Use absolute URL to support authenticated fetch (Inrupt SDK requires absolute URLs)
const getConverterApiUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/converter`;
  }
  return '/api/converter';
};

export interface MappingConfig {
  id: string;
  name: string;
  inputFormat: 'XML' | 'JSON';
  description: string;
  dataType: 'forst' | 'saegewerk' | 'bspwerk';
}

export interface FileResult {
  raw_url?: string;
  rdf_url?: string;
}

export interface UploadResult {
  success: boolean;
  trace_id: string;
  files: {
    forst?: FileResult;
    saegewerk?: FileResult;
    bspwerk?: FileResult;
  };
  converted_at: string;
  message?: string;
}

export interface UploadFiles {
  traceId: string;
  forstFile?: File;
  forstMapping?: string;
  saegwerkFile?: File;
  saegwerkMapping?: string;
  bspwerkFile?: File;
  bspwerkMapping?: string;
}

// Auto-detection types
export interface DetectedFile {
  filename: string;
  file_type: string;
  data_type: string;
  data_type_name: string;
  trace_id: string | null;
  mapping_id: string;
  confidence: number;
  is_recognized: boolean;
  error: string | null;
}

export interface DetectResponse {
  files: DetectedFile[];
  detected_trace_id: string | null;
  all_recognized: boolean;
}

export interface AutoUploadResult {
  success: boolean;
  trace_id: string;
  files: Record<string, FileResult>;
  detection_warnings: string[];
  converted_at: string;
  message?: string;
}

// Convert-only types (for frontend upload to Solid Pod)
export interface ConvertedFileData {
  filename: string;
  data_type: string;
  raw_content: string; // Base64 encoded
  raw_content_type: string;
  rdf_content: string | null; // Base64 encoded TTL
  rdf_filename: string | null;
  error: string | null;
}

export interface ConvertOnlyResponse {
  success: boolean;
  trace_id: string;
  files: ConvertedFileData[];
  detection_warnings: string[];
  converted_at: string;
  message?: string;
}

// Catalog types
export interface Catalog {
  id: number;
  title: string;
  description: string;
  issued: string;
  modified: string;
}

export interface CatalogRegistrationRequest {
  trace_id: string;
  data_type: string;
  mapping_id: string;
  rdf_url: string;
  raw_url?: string;
  catalog_id: number;
  publisher?: string;  // Solid user name from authentication
}

export interface CatalogRegistrationResponse {
  success: boolean;
  identifier?: string;
  message?: string;
}

/**
 * Get available catalogs (Solid Pods from Federation Registry).
 * Each pod in the federation acts as its own catalog.
 * Datasets are registered directly in the user's Solid Pod.
 */
export async function getCatalogs(): Promise<Catalog[]> {
  try {
    // Return a default catalog for the user's Pod
    // In the federated model, datasets are registered directly in the user's Pod
    return [
      {
        id: 1,
        title: 'Mein Solid Pod',
        description: 'Datasets werden in Ihrem persönlichen Solid Pod registriert',
        issued: new Date().toISOString(),
        modified: new Date().toISOString(),
      }
    ];
  } catch (error) {
    console.error('Error fetching catalogs:', error);
    return [];
  }
}

// Solid Pod configuration
const SOLID_POD_BASE_URL = 'https://tmdt-solid-community-server.de/epcisrepository';

/**
 * Get available RML mappings from the converter service.
 */
export async function getMappings(): Promise<MappingConfig[]> {
  try {
    const response = await fetch(`${getConverterApiUrl()}/mappings`);

    if (!response.ok) {
      throw new Error(`Failed to fetch mappings: ${response.status}`);
    }

    const data = await response.json();
    return data.mappings;
  } catch (error) {
    console.error('Error fetching mappings:', error);
    // Return default mappings if service is unavailable
    return [
      {
        id: 'stanford_hpr',
        name: 'StanForD HPR - Forstdaten',
        inputFormat: 'XML',
        description: 'Harvester-Produktionsdaten im StanForD2010-Format',
        dataType: 'forst'
      },
      {
        id: 'eldat_hba',
        name: 'ELDAT HBA - Saegewerksdaten',
        inputFormat: 'JSON',
        description: 'Holzbereitstellungsanzeige im ELDAT-Format',
        dataType: 'saegewerk'
      },
      {
        id: 'vlex',
        name: 'VLEX - BSP-Plattendaten',
        inputFormat: 'JSON',
        description: 'BSP-Plattenproduktion im VLEX-Materialfluss-Format',
        dataType: 'bspwerk'
      }
    ];
  }
}

/**
 * Upload files and convert them to RDF.
 */
export async function uploadAndConvert(files: UploadFiles): Promise<UploadResult> {
  const formData = new FormData();

  formData.append('trace_id', files.traceId);

  if (files.forstFile && files.forstMapping) {
    formData.append('forst_file', files.forstFile);
    formData.append('forst_mapping', files.forstMapping);
  }

  if (files.saegwerkFile && files.saegwerkMapping) {
    formData.append('saegewerk_file', files.saegwerkFile);
    formData.append('saegewerk_mapping', files.saegwerkMapping);
  }

  if (files.bspwerkFile && files.bspwerkMapping) {
    formData.append('bspwerk_file', files.bspwerkFile);
    formData.append('bspwerk_mapping', files.bspwerkMapping);
  }

  const response = await fetch(`${getConverterApiUrl()}/convert`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Upload failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Generate a new trace ID in the format TC-YYYY-NNN.
 */
export function generateTraceId(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 900) + 100; // 100-999
  return `TC-${year}-${random}`;
}

/**
 * Validate a trace ID format.
 */
export function isValidTraceId(traceId: string): boolean {
  return /^TC-\d{4}-\d{3,}$/.test(traceId);
}

/**
 * Detect file types and extract trace IDs from files.
 */
export async function detectFiles(files: File[]): Promise<DetectResponse> {
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch(`${getConverterApiUrl()}/detect`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Detection failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Upload files with automatic type detection and conversion.
 *
 * @param files - Files to upload
 * @param traceIdOverride - Optional trace ID to use instead of detected one
 * @param authenticatedFetch - Optional authenticated fetch function from Solid session.
 *                            If provided, the token will be forwarded to the backend
 *                            for authenticated Solid Pod uploads.
 */
export async function uploadAndConvertAuto(
  files: File[],
  traceIdOverride?: string,
  authenticatedFetch?: typeof fetch
): Promise<AutoUploadResult> {
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', file);
  }

  if (traceIdOverride) {
    formData.append('trace_id_override', traceIdOverride);
  }

  // Use authenticated fetch if available, otherwise use regular fetch
  const fetchFn = authenticatedFetch || fetch;

  const response = await fetchFn(`${getConverterApiUrl()}/convert-auto`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Upload failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Convert files without uploading (backend returns Base64 encoded data).
 */
async function convertFilesOnly(
  files: File[],
  traceIdOverride?: string
): Promise<ConvertOnlyResponse> {
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', file);
  }

  if (traceIdOverride) {
    formData.append('trace_id_override', traceIdOverride);
  }

  const response = await fetch(`${getConverterApiUrl()}/convert-only`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Conversion failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Upload a file to the Solid Pod using authenticated fetch.
 */
async function uploadToSolidPod(
  authenticatedFetch: typeof fetch,
  content: ArrayBuffer,
  filename: string,
  contentType: string,
  folder: string = 'public/uploads'
): Promise<string> {
  const url = `${SOLID_POD_BASE_URL}/${folder}/${filename}`;

  // Convert ArrayBuffer to Blob for fetch body
  const blob = new Blob([content], { type: contentType });

  const response = await authenticatedFetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: blob,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(`Authentifizierung fehlgeschlagen für ${url}`);
    } else if (response.status === 403) {
      throw new Error(`Keine Berechtigung für ${url}`);
    }
    throw new Error(`Upload fehlgeschlagen: ${response.status}`);
  }

  return url;
}

/**
 * Convert files and upload to Solid Pod using the user's authenticated session.
 *
 * This function:
 * 1. Sends files to backend for RML conversion (no upload)
 * 2. Uploads raw files and RDF to Solid Pod using authenticated fetch
 * 3. Registers uploaded files in the selected catalog
 *
 * @param files - Files to convert and upload
 * @param traceIdOverride - Optional trace ID override
 * @param authenticatedFetch - Authenticated fetch from Solid session
 * @param catalogId - Optional catalog ID for registration (if not provided, catalog registration is skipped)
 * @param userName - Optional Solid user name for catalog publisher field
 */
export async function convertAndUploadWithSession(
  files: File[],
  traceIdOverride: string | undefined,
  authenticatedFetch: typeof fetch,
  catalogId?: number,
  userName?: string | null
): Promise<AutoUploadResult> {
  // Step 1: Convert files (backend only converts, doesn't upload)
  const convertResult = await convertFilesOnly(files, traceIdOverride);

  const results: Record<string, FileResult> = {};
  const errors: string[] = [];

  // Step 2: Upload each file to Solid Pod
  for (const fileData of convertResult.files) {
    const fileResult: FileResult = {};

    try {
      // Decode Base64 content to ArrayBuffer
      const rawBytes = atob(fileData.raw_content);
      const rawContent = new ArrayBuffer(rawBytes.length);
      const rawView = new Uint8Array(rawContent);
      for (let i = 0; i < rawBytes.length; i++) {
        rawView[i] = rawBytes.charCodeAt(i);
      }

      // Upload raw file
      fileResult.raw_url = await uploadToSolidPod(
        authenticatedFetch,
        rawContent,
        fileData.filename,
        fileData.raw_content_type
      );

      // Upload RDF if available
      if (fileData.rdf_content && fileData.rdf_filename) {
        const rdfBytes = atob(fileData.rdf_content);
        const rdfContent = new ArrayBuffer(rdfBytes.length);
        const rdfView = new Uint8Array(rdfContent);
        for (let i = 0; i < rdfBytes.length; i++) {
          rdfView[i] = rdfBytes.charCodeAt(i);
        }
        fileResult.rdf_url = await uploadToSolidPod(
          authenticatedFetch,
          rdfContent,
          fileData.rdf_filename,
          'text/turtle',
          'public' // RDF goes to public folder
        );
      }

      results[fileData.data_type] = fileResult;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unbekannter Fehler';
      errors.push(`${fileData.filename}: ${errorMsg}`);
    }
  }

  const success = Object.keys(results).length > 0 && errors.length === 0;

  // Step 3: Register in catalog for each successfully uploaded file (only if catalogId is provided)
  const catalogRegistrations: Record<string, string> = {};
  if (catalogId) {
    for (const fileData of convertResult.files) {
      const fileResult = results[fileData.data_type];
      if (fileResult?.rdf_url && fileData.data_type !== 'unknown') {
        try {
          // Determine mapping_id from data_type
          const mappingIdMap: Record<string, string> = {
            'forst': 'stanford_hpr',
            'saegewerk': 'eldat_hba',
            'bspwerk': 'vlex'
          };
          const mapping_id = mappingIdMap[fileData.data_type];

          if (mapping_id) {
            const catalogResult = await registerInCatalog({
              trace_id: convertResult.trace_id,
              data_type: fileData.data_type,
              mapping_id: mapping_id,
              rdf_url: fileResult.rdf_url,
              raw_url: fileResult.raw_url,
              catalog_id: catalogId,
              publisher: userName || undefined
            });

            if (catalogResult.success && catalogResult.identifier) {
              catalogRegistrations[fileData.data_type] = catalogResult.identifier;
              console.log(`Registered ${fileData.data_type} in catalog ${catalogId}: ${catalogResult.identifier}`);
            } else {
              console.warn(`Catalog registration failed for ${fileData.data_type}: ${catalogResult.message}`);
            }
          }
        } catch (err) {
          console.warn(`Catalog registration error for ${fileData.data_type}:`, err);
        }
      }
    }
  }

  return {
    success,
    trace_id: convertResult.trace_id,
    files: results,
    detection_warnings: [...convertResult.detection_warnings, ...errors],
    converted_at: convertResult.converted_at,
    message: errors.length > 0 ? errors.join('; ') : undefined,
    catalog_registrations: Object.keys(catalogRegistrations).length > 0 ? catalogRegistrations : undefined
  } as AutoUploadResult & { catalog_registrations?: Record<string, string> };
}

/**
 * Register a dataset in the Semantic Data Catalog.
 * Called after successful upload to Solid Pod.
 */
export async function registerInCatalog(
  request: CatalogRegistrationRequest
): Promise<CatalogRegistrationResponse> {
  try {
    const response = await fetch(`${getConverterApiUrl()}/register-catalog`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      return {
        success: false,
        message: error.detail || `Registration failed: ${response.status}`
      };
    }

    return response.json();
  } catch (error) {
    console.error('Catalog registration error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
