/**
 * Upload Service for TimberConnect
 *
 * Handles file uploads, RML conversion, and Solid Pod storage.
 */

import {
  stampContainerAcl,
  getAllowedRoles,
  podBaseFromUrl,
  podBaseFromWebId,
  writeEpcisConsent,
} from './accessControlService';
import { writePricingDoc, type PricingEntry } from './pricingService';
import { registerDatasetInOwnPod } from './catalogWriteService';

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
  /** Im Dokument eingebettete Produkt-EPCs (ERP-Excel: Blatt "Identifikation"). */
  epcs?: string[];
  /** Vormaterial-EPCs (tc:derivedFrom), z.B. Lamellen aus dem Aufsägevorgang. */
  input_epcs?: string[];
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
  /** Datenpunkte (RDF-Triples) pro Datentyp — Preisgrundlage der Token-Währung. */
  datapoint_counts?: Record<string, number>;
  /** Gesamtzahl der Datenpunkte = Wert des Uploads in Token. */
  total_datapoints?: number;
}

// Convert-only types (for frontend upload to Solid Pod)
export interface ConvertedFileData {
  filename: string;
  data_type: string;
  raw_content: string; // Base64 encoded
  raw_content_type: string;
  rdf_content: string | null; // Base64 encoded TTL
  rdf_filename: string | null;
  /** Anzahl RDF-Triples (= Datenpunkte), vom Backend beim Konvertieren gezählt. */
  triple_count?: number | null;
  /** Maschinenlesbares JSON-Zwischendokument (ERP-Excel), Base64. */
  json_content?: string | null;
  json_filename?: string | null;
  /** Eingebettete GS1-Idente der ERP-Excel (Blatt "Identifikation"). */
  epcs?: string[] | null;
  input_epcs?: string[] | null;
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
  /**
   * WebID des Pod-Eigentuemers. Pflichtfeld der Katalog-API
   * (DatasetWriteRequest.ownerWebId): ohne sie wird die Registrierung mit
   * HTTP 422 abgewiesen und der Datensatz ist fuer keine Abfrage sichtbar.
   */
  owner_webid?: string;
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
const SOLID_POD_BASE_URL = 'https://solid-community-server.tmdt.info/epcisrepository';

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
  traceIdOverride?: string,
  docBaseUrl?: string,
  companyPrefix?: string,
  ifcEpc?: string
): Promise<ConvertOnlyResponse> {
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', file);
  }

  if (traceIdOverride) {
    formData.append('trace_id_override', traceIdOverride);
  }

  if (ifcEpc) {
    // Ident des in der IFC geplanten Bauteils. Die Ausfuehrungsplanung kennt
    // die GS1-Serie des gefertigten Bauteils nicht, deshalb wird der Bezug
    // erst hier hergestellt — ohne ihn lehnt der Converter die IFC ab.
    formData.append('ifc_epc', ifcEpc);
  }

  if (docBaseUrl) {
    formData.append('doc_base_url', docBaseUrl);
  }

  if (companyPrefix) {
    // GCP des angemeldeten Uploaders — der Converter lehnt Requests ohne
    // gültigen Prefix ab (Upload ohne Login/Registrierung nicht erlaubt).
    formData.append('company_prefix', companyPrefix);
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
 * Einen Bezeichner in ein taugliches Pfadsegment ueberfuehren.
 *
 * Die trace_id ist NICHT immer eine TC-Nummer: fuer hpr/eldat gibt der
 * Konverter den ersten EPC der Datei zurueck (main.py, `trace_id=first_epc`),
 * also ``urn:epc:id:sgtin:404711145.0100.12A3D4567``. Ungefiltert als
 * Ordnername benutzt, entsteht daraus ein Pfad mit Doppelpunkten in jedem
 * Segment -- der Container wird nie angelegt, der PUT landet in einem
 * ungestempelten Verzeichnis und der Server antwortet mit 401. Die Meldung
 * lautet dann "Authentifizierung fehlgeschlagen", obwohl die Session gilt:
 * derselbe Durchgang legt das PDF daneben problemlos ab.
 *
 * Doppelpunkt und Schraegstrich sind die beiden Zeichen, die den Pfad
 * zerlegen; alles Uebrige bleibt, damit der Ordnername lesbar und die
 * Zuordnung zum Ident erkennbar bleibt.
 */
export function toPathSegment(id: string): string {
  return id.replace(/[:/\\?#[\]@]/g, '_');
}

/**
 * Upload a file to the Solid Pod using authenticated fetch.
 */
async function uploadToSolidPod(
  authenticatedFetch: typeof fetch,
  content: ArrayBuffer,
  filename: string,
  contentType: string,
  folder: string,
  podBase: string = `${SOLID_POD_BASE_URL}/`
): Promise<string> {
  const url = `${podBase}${folder}/${filename}`;

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
 * @param userName - Optional Solid user name for catalog publisher field
 * @param ownerWebId - WebID of the uploading owner; required to stamp the WAC ACL on the data container
 * @param ifcEpc - GS1-EPC des geplanten Bauteils; Pflicht, sobald eine IFC-Datei dabei ist
 */
export async function convertAndUploadWithSession(
  files: File[],
  traceIdOverride: string | undefined,
  authenticatedFetch: typeof fetch,
  userName?: string | null,
  ownerWebId?: string | null,
  companyPrefix?: string | null,
  ifcEpc?: string | null,
  /**
   * Container des Vorgangs, zu dem die Dateien gehoeren (record.containerUrl).
   * Ist er gesetzt, wird dorthin abgelegt statt in einen eigenen Ordner je
   * trace_id -- dieser Container traegt bereits die ACL des Vorgangs.
   */
  processContainerUrl?: string | null
): Promise<AutoUploadResult> {
  // Data lands in the pod of the logged-in uploader (derived from their WebID),
  // not the shared epcisrepository pod — only the owner may write there and
  // stamping the container ACL requires Control, which only holds on one's own
  // pod. Fallback to the central pod covers the legacy no-WebID case.
  const podBase = ownerWebId ? podBaseFromWebId(ownerWebId) : `${SOLID_POD_BASE_URL}/`;

  // Step 1: Convert files (backend only converts, doesn't upload). The
  // doc_base_url becomes the EPCIS bizTransaction base, so captured events
  // point back to the pod the data actually lives in. Der Company Prefix des
  // Uploaders wandert in die erzeugten GS1-Idente; ohne ihn lehnt der
  // Converter den Request ab.
  const convertResult = await convertFilesOnly(
    files,
    traceIdOverride,
    `${podBase}data`,
    companyPrefix ?? undefined,
    ifcEpc ?? undefined
  );

  const results: Record<string, FileResult> = {};
  const errors: string[] = [];
  // Preis-Metadaten: Datenpunktzahl je hochgeladener RDF-Datei (1 Datenpunkt
  // = 1 Token), wird nach dem Upload als pricing.ttl im Container abgelegt.
  const pricingEntries: PricingEntry[] = [];
  const datapointCounts: Record<string, number> = {};

  // Data goes into a per-product container under data/, which is WAC-protected
  // (instead of the world-readable public/ folder). Raw files and RDF share the
  // container so a single container-level ACL governs them.
  // Gehoert der Upload zu einem Vorgang, landen die Dateien in DESSEN
  // Container. Der ist von createProcess bereits angelegt und per
  // stampContainerAcl mit einer ACL versehen -- ein eigener Ordner je Datei
  // waere ungestempelt, und genau daran scheiterte der HPR-Upload mit 401,
  // waehrend das PDF desselben Vorgangs durchging.
  //
  // Ohne Vorgang bleibt es beim bisherigen Weg (eigener Ordner je trace_id),
  // nur mit gesaeubertem Segment -- siehe toPathSegment.
  //
  // Der Vorgangscontainer wird nur uebernommen, wenn er wirklich unter
  // ``podBase`` liegt: ein blindes replace() liesse sonst eine absolute URL
  // stehen, die anschliessend hinter podBase geklebt wuerde.
  const traceId = convertResult.trace_id;
  const dataFolder =
    processContainerUrl && processContainerUrl.startsWith(podBase)
      ? processContainerUrl.slice(podBase.length).replace(/\/$/, '')
      : `data/${toPathSegment(traceId)}`;

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

      // Upload raw file into the product's data container
      fileResult.raw_url = await uploadToSolidPod(
        authenticatedFetch,
        rawContent,
        fileData.filename,
        fileData.raw_content_type,
        dataFolder,
        podBase
      );

      // Upload RDF if available (same container, governed by one ACL)
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
          dataFolder,
          podBase
        );

        if (typeof fileData.triple_count === 'number' && fileData.triple_count > 0) {
          datapointCounts[fileData.data_type] = fileData.triple_count;
          if (ownerWebId) {
            pricingEntries.push({
              fileUrl: fileResult.rdf_url,
              datapoints: fileData.triple_count,
              recipientWebId: ownerWebId,
            });
          }
        }
      }

      // JSON-Zwischendokument (ERP-Excel) neben Original und TTL ablegen —
      // gleiche Ablage wie beim PDF-Pfad (Original + Extrakt + TTL).
      if (fileData.json_content && fileData.json_filename) {
        const jsonBytes = atob(fileData.json_content);
        const jsonContent = new ArrayBuffer(jsonBytes.length);
        const jsonView = new Uint8Array(jsonContent);
        for (let i = 0; i < jsonBytes.length; i++) {
          jsonView[i] = jsonBytes.charCodeAt(i);
        }
        await uploadToSolidPod(
          authenticatedFetch,
          jsonContent,
          fileData.json_filename,
          'application/json',
          dataFolder,
          podBase
        );
      }

      // Eingebettete Idente (ERP-Excel) durchreichen, damit der Vorgang sie
      // per attachProcessIdents an sich heften kann.
      if (fileData.epcs?.length) fileResult.epcs = fileData.epcs;
      if (fileData.input_epcs?.length) fileResult.input_epcs = fileData.input_epcs;

      results[fileData.data_type] = fileResult;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unbekannter Fehler';
      errors.push(`${fileData.filename}: ${errorMsg}`);
    }
  }

  const success = Object.keys(results).length > 0 && errors.length === 0;

  // Step 2b: Stamp the data container's WAC ACL — owner full control, plus Read
  // for every role the owner currently allows (from their role-policy.ttl).
  if (success && ownerWebId) {
    try {
      const containerUrl = `${podBase}${dataFolder}/`;
      const pod = podBaseFromUrl(containerUrl);
      const allowedRoles = await getAllowedRoles(pod);
      await stampContainerAcl(containerUrl, ownerWebId, allowedRoles);
      console.log(`[upload] Stamped ACL on ${containerUrl} for roles:`, allowedRoles);

      // Mirror the same allowlist as EPCIS consent so events captured for this
      // product are released only to the roles the owner permits.
      await writeEpcisConsent(ownerWebId, allowedRoles);
      console.log('[upload] Wrote EPCIS consent for roles:', allowedRoles);
    } catch (err) {
      console.warn('[upload] Failed to stamp container ACL:', err);
      errors.push(
        `ACL konnte nicht gesetzt werden: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`
      );
    }

    // Preis-Metadaten (Datenpunkte + Zahlungsempfänger) neben die Daten legen,
    // damit Abrufende den Preis sehen können, ohne neu zählen zu müssen.
    if (pricingEntries.length > 0) {
      try {
        const containerUrl = `${podBase}${dataFolder}/`;
        await writePricingDoc(containerUrl, pricingEntries);
        console.log('[upload] Wrote pricing.ttl:', pricingEntries);
      } catch (err) {
        console.warn('[upload] Failed to write pricing.ttl:', err);
      }
    }
  }

  // Step 3: Katalogeintrag im EIGENEN Pod je hochgeladener Datei.
  //
  // Frueher lief das ueber das Converter-Backend (POST /api/datasets des
  // Katalog-Dienstes). Dieser Weg braucht ein Service-Konto, das sich
  // stellvertretend anmeldet -- und scheiterte ohne es mit HTTP 503. Noetig
  // ist er nicht: der angemeldete Nutzer darf in seinem eigenen Pod schreiben,
  // und genau dort erwartet der Katalog-Dienst die Eintraege (er LIEST
  // <pod>/catalog/cat.ttl; seine Schreib-Endpunkte antworten "write
  // operations are client side").
  const catalogRegistrations: Record<string, string> = {};
  const DATA_TYPE_LABELS: Record<string, { title: string; theme: string }> = {
    forst: { title: 'Forstdaten (StanForD HPR)', theme: 'forstwirtschaft' },
    saegewerk: { title: 'Sägewerksdaten (ELDAT)', theme: 'holzverarbeitung' },
    bspwerk: { title: 'BSP-Plattendaten (VLEX)', theme: 'holzbau' },
    herstellung: { title: 'Herstellungsdaten BSP (ERP)', theme: 'holzbau' },
  };

  if (ownerWebId) {
    for (const fileData of convertResult.files) {
      const fileResult = results[fileData.data_type];
      if (!fileResult?.rdf_url || fileData.data_type === 'unknown') continue;

      const info = DATA_TYPE_LABELS[fileData.data_type] ?? {
        title: fileData.data_type,
        theme: 'timber',
      };
      const entry = await registerDatasetInOwnPod(authenticatedFetch, {
        ownerWebId,
        title: `${info.title} - ${convertResult.trace_id}`,
        description: `${info.title} (Trace-ID: ${convertResult.trace_id})`,
        downloadUrl: fileResult.rdf_url,
        rawUrl: fileResult.raw_url,
        publisher: userName || undefined,
        theme: info.theme,
      });
      if (entry.ok && entry.identifier) {
        catalogRegistrations[fileData.data_type] = entry.identifier;
        console.log(`[catalog] ${fileData.data_type} registriert: ${entry.identifier}`);
      } else {
        console.warn(`[catalog] ${fileData.data_type} nicht registriert: ${entry.error}`);
      }
    }
  } else {
    console.warn('[catalog] Keine WebID — Katalogeintrag übersprungen.');
  }

  const totalDatapoints = Object.values(datapointCounts).reduce((sum, n) => sum + n, 0);

  return {
    success,
    trace_id: convertResult.trace_id,
    files: results,
    detection_warnings: [...convertResult.detection_warnings, ...errors],
    converted_at: convertResult.converted_at,
    message: errors.length > 0 ? errors.join('; ') : undefined,
    datapoint_counts: Object.keys(datapointCounts).length > 0 ? datapointCounts : undefined,
    total_datapoints: totalDatapoints > 0 ? totalDatapoints : undefined,
    catalog_registrations: Object.keys(catalogRegistrations).length > 0 ? catalogRegistrations : undefined
  } as AutoUploadResult & { catalog_registrations?: Record<string, string> };
}

/**
 * Register a dataset in the Semantic Data Catalog.
 * Called after successful upload to Solid Pod.
 */
/**
 * VERALTET — nicht mehr im Einsatz.
 *
 * Ging ueber POST /api/datasets des Katalog-Dienstes und brauchte dort ein
 * Service-Konto, das sich stellvertretend anmeldet; ohne dieses antwortete
 * der Dienst mit HTTP 503, und der Katalogeintrag entstand nie (der Upload
 * meldete trotzdem Erfolg).
 *
 * Ersetzt durch catalogWriteService.registerDatasetInOwnPod: der angemeldete
 * Nutzer schreibt den Eintrag direkt in seinen eigenen Pod — dort, wo der
 * Katalog-Dienst ihn ohnehin liest. Bleibt vorerst erhalten, weil der
 * Backend-Endpunkt noch existiert.
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
