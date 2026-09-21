/**
 * Catalog Service for TimberConnect
 *
 * Fetches datasets from federated Solid Pods via a central Federation Registry.
 * Workflow: Registry -> Pods -> Catalogs -> Datasets -> downloadURLs -> Comunica
 */

import type { CatalogDataset, CatalogCache } from '../types/catalog';
import type { ProductConfig } from '../config/solidPods';
import { Parser, Store, DataFactory } from 'n3';
import { getAuthFetch } from './authFetch';

const { namedNode } = DataFactory;

// RDF Namespaces
const DCAT = 'http://www.w3.org/ns/dcat#';
const DCT = 'http://purl.org/dc/terms/';
const LDP = 'http://www.w3.org/ns/ldp#';

// Configuration
const FEDERATION_REGISTRY_URL =
  import.meta.env.VITE_FEDERATION_REGISTRY_URL ||
  'https://solid-community-server.tmdt.info/semanticdatacatalog/public/dace/';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache instance
let cache: CatalogCache | null = null;
let catalogProducts: ProductConfig[] = [];
/**
 * Laufender Abruf, den alle gleichzeitigen Aufrufer teilen.
 *
 * Ohne diesen Schutz lief der Abruf zweimal an (App-Start und Scan-Screen
 * bzw. Anmeldung), und der zweite Aufruf traf den Cache, sobald der erste
 * die Datensatzliste hatte -- aber BEVOR er die langsame Gruppierung in
 * Produkte (ein Dateiabruf je Datensatz, ~30 s) abgeschlossen hatte. Er
 * meldete dann "0 Produkte", solidPods hielt den Katalog fuer initialisiert,
 * und ein Scan in dieser Zeit fand keine Quellen: "Keine verknuepften
 * Pod-Daten erreichbar". Eine halbe Minute spaeter ging dieselbe Anfrage
 * durch (Befund 18.09.2026).
 */
let inFlight: Promise<CatalogDataset[]> | null = null;
/** Zaehlt Invalidierungen: ein alter Lauf darf keinen neueren Stand ueberschreiben. */
let generation = 0;

// ============================================================================
// FEDERATION: Pod Discovery
// ============================================================================

/**
 * Discover all registered Pods from the Federation Registry.
 * Returns an array of Pod base URLs.
 */
async function discoverRegisteredPods(): Promise<string[]> {
  console.log('[CatalogService] Discovering pods from Federation Registry:', FEDERATION_REGISTRY_URL);

  const response = await getAuthFetch()(FEDERATION_REGISTRY_URL, {
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
    const response = await getAuthFetch()(catalogUrl, {
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
    const response = await getAuthFetch()(datasetUrl, {
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
      // Catalog = discovery: every entry is listed regardless of accessRights.
      // Access enforcement happens at query time (role pre-filter + WAC), not
      // by hiding restricted datasets from the catalog. Kept always-true so
      // access-controlled datasets remain discoverable.
      is_public: true,
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
  // Laeuft schon ein Abruf, haengt sich der Aufrufer dran -- VOR der
  // Cache-Pruefung, denn der Cache ist erst vollstaendig, wenn auch die
  // Produkte gruppiert sind (siehe Kommentar an ``inFlight``).
  if (inFlight) {
    console.log('[CatalogService] Joining in-flight fetch');
    return inFlight;
  }

  // Check cache
  if (cache && Date.now() - cache.lastFetched < CACHE_TTL) {
    console.log('[CatalogService] Using cached datasets');
    return cache.datasets;
  }

  const myGeneration = generation;
  const run: Promise<CatalogDataset[]> = (async () => {
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

    // Group into products (async because TC-ID extraction may need to load data files)
    const products = await groupDatasetsToProducts(validDatasets);

    // Erst jetzt ist der Stand vollstaendig -- und nur, wenn er inzwischen
    // nicht invalidiert wurde (Reset, Refresh).
    if (myGeneration === generation) {
      cache = { datasets: validDatasets, lastFetched: Date.now() };
      catalogProducts = products;
      console.log('[CatalogService] Grouped into', catalogProducts.length, 'products');
    } else {
      console.log('[CatalogService] Discarding stale fetch (cache was invalidated)');
    }

    return validDatasets;
  })().finally(() => {
    // Nur den eigenen Lauf austragen -- nach invalidateCache laeuft evtl. ein neuer.
    if (inFlight === run) inFlight = null;
  });
  inFlight = run;

  return run;
}

// ============================================================================
// PRODUCT GROUPING (unchanged)
// ============================================================================

/**
 * Group individual datasets into product configurations.
 * Async because TC-ID extraction may need to load data files.
 */
export async function groupDatasetsToProducts(
  datasets: CatalogDataset[],
): Promise<ProductConfig[]> {
  // Je Station eine LISTE, kein Einzelwert.
  //
  // Frueher stand hier ``forst?: string`` usw. -- ein Platz je Station. Zu
  // einem Bauteil gehoeren aber mehrere Dokumente derselben Station: im
  // BSP-Werk der ERP-Auszug, die Leistungserklaerung und das
  // Klebstoffdatenblatt. Alle drei ordnet ``detectDataType`` "bspwerk" zu,
  // und jedes ueberschrieb das vorige -- nur das zuletzt eingelesene
  // ueberlebte, die anderen fielen aus der Quellenliste, ohne dass es
  // irgendwo auffiel.
  //
  // Genau daran scheiterte die Produktart: Der ERP-Auszug traegt als
  // einziges Dokument ``a tc:Panel``; blieb er weg, fand der Scan nur noch
  // die Leistungserklaerung und konnte die Platte nicht mehr benennen.
  const productMap = new Map<
    string,
    {
      forst: string[];
      saegewerk: string[];
      bspwerk: string[];
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
      productMap.set(traceId, { forst: [], saegewerk: [], bspwerk: [], genericSources: [] });
    }

    const product = productMap.get(traceId)!;
    const dataType = detectDataType(dataset);
    if (!dataset.access_url_dataset) continue;

    // Nach Station einsortieren -- die Station bestimmt nur die REIHENFOLGE
    // der Quellen (Wald vor Saegewerk vor Werk), nicht mehr, ob ein Dokument
    // ueberhaupt mitkommt.
    if (dataType === 'forst') {
      product.forst.push(dataset.access_url_dataset);
    } else if (dataType === 'saegewerk') {
      product.saegewerk.push(dataset.access_url_dataset);
    } else if (dataType === 'bspwerk') {
      product.bspwerk.push(dataset.access_url_dataset);
      // Titel/Beschreibung vom ersten Werksdatensatz, nicht vom letzten:
      // sonst benennt ein spaeter eingelesenes Beiblatt das ganze Produkt um.
      if (!product.title) {
        product.title = dataset.title;
        product.description = dataset.description || undefined;
      }
    } else {
      product.genericSources.push(dataset.access_url_dataset);
      if (!product.title) {
        product.title = dataset.title;
        product.description = dataset.description || undefined;
      }
    }
  }

  return Array.from(productMap.entries())
    // Nur Bauteile mit einem echten Ident. Der Katalog ist ein GETEILTES
    // Register: dieselbe Foederation traegt auch Datensaetze anderer
    // Projekte (Reparaturquoten, Haushaltsabfaelle, Carsharing ...). Deren
    // Dateien enthalten weder TC-Id noch EPC, also fiel ``extractTraceId``
    // auf ``deriveGroupingId`` zurueck und machte die Katalog-UUID zur
    // "Produkt-ID" -- und genau diese Fremddaten standen mit ihren langen
    // Titeln unter "Verfuegbare Produkte" (Rueckmeldung Praxispartner,
    // "Feedback App_Allgemein", 17.09.2026). Ein solcher Eintrag ist
    // ohnehin nie scanbar: kein Etikett traegt eine Katalog-UUID.
    .filter(([traceId]) => isTimberProductId(traceId))
    .map(([traceId, data]) => {
      const typedSources = [...data.forst, ...data.saegewerk, ...data.bspwerk];
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
 * Ist das eine ID, die ein Holzbauteil tragen kann?
 *
 * Zwei Id-Welten (siehe extractIdFromData): der Alt-Trace ``TC-YYYY-NNN`` der
 * Demo-Daten und die GS1-EPCs (``urn:epc:id:sgtin`` / ``lgtin``) der
 * hochgeladenen Vorgaenge. Alles andere ist eine abgeleitete Katalog-UUID.
 */
export function isTimberProductId(id: string): boolean {
  return /^TC-\d{4}-\d{3}$/i.test(id) || /^urn:epc:(id|class):[sl]gtin:/i.test(id);
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

// Cache: data URL -> extracted product id (so each file is fetched at most once).
const dataIdCache = new Map<string, string | null>();

/**
 * Extract the product grouping id from the actual data file. Bridges the two
 * id worlds: returns a legacy TC-xxxx-xxx trace id when present, otherwise the
 * GS1 EpcisDocument doc_hash (the last path segment of the tc:EpcisDocument URI).
 * Returns null if neither is found.
 */
async function extractIdFromData(downloadUrl: string): Promise<string | null> {
  if (dataIdCache.has(downloadUrl)) return dataIdCache.get(downloadUrl)!;

  let result: string | null = null;
  try {
    const response = await getAuthFetch()(downloadUrl, {
      headers: { Accept: 'text/turtle' },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const ttl = await response.text();

      // 1) Legacy trace id wins (demo data carries tc:traceId "TC-YYYY-NNN").
      const tc = ttl.match(/TC-\d{4}-\d{3}/i);
      if (tc) {
        result = tc[0].toUpperCase();
      } else {
        // 2) GS1 world: group by the MATERIAL ID (EPC) of the described item.
        //
        //    Frueher wurde hier auf den doc_hash des EpcisDocument
        //    zurueckgefallen. Der identifiziert aber das hochgeladene
        //    DOKUMENT, nicht das Bauteil: jeder Upload erzeugt ein eigenes
        //    EpcisDocument, also gruppierte er nichts, sondern machte jede
        //    Datei zu einem eigenen "Produkt". Genau das stand dann unter
        //    "Verfuegbare Produkte" -- eine Liste von Dokument-UUIDs mit
        //    Dokumentbeschreibungen statt Bauteilen (Rueckmeldung Anni,
        //    26.08.2026).
        //
        //    Die Instanz-EPCs (SGTIN/LGTIN) sind der Bezug, ueber den auch
        //    Schadensmeldungen und Haftungsnachweise am Bauteil haengen.
        //
        //    Eine Datei kann MEHRERE EPCs tragen: die Herstellung nennt
        //    neben dem entstandenen Bauteil auch die verbauten Lamellen
        //    (IdentityInput). Gruppiert werden muss nach dem BESCHRIEBENEN
        //    Stueck, nicht nach einem beliebigen der genannten -- sonst
        //    haengt das Ergebnis an der Zeilenreihenfolge der Datei.
        //    Deshalb zuerst der explizite Bauteilbezug tc:epc; erst wenn
        //    er fehlt, der erste EPC ueberhaupt.
        //
        //    BEIDE Id-Welten, nicht nur ``urn:epc:id:``. Ein Pflanzvorgang
        //    beschreibt Vermehrungsgut und traegt deshalb einen LOS-Ident
        //    (``urn:epc:class:lgtin:...Pflanzung01``). Der frueher hier
        //    stehende Regex suchte nur ``urn:epc:id:``, also lieferte
        //    ``extractIdFromData`` fuer jedes Stammzertifikat ``null`` --
        //    und ``groupDatasetsToProducts`` verwarf es per
        //    ``filter(d => d.traceId !== null)`` samt seiner Quelle. Die
        //    Pflanzung war damit zwar im Pod und in EPCIS vorhanden, ueber
        //    den Katalog aber nicht mehr aufloesbar: Der Scan fiel auf
        //    ``buildPotentialSources`` zurueck, das sechs URLs unter dem
        //    zentralen Pod raet -- waehrend die Datei im Pod des Erzeugers
        //    liegt. Ergebnis: "nicht gefunden" fuer eine ID, die es gibt.
        //
        //    Die Seriennummer darf nicht auf Ziffern eingeschraenkt werden:
        //    Losnummern sind alphanumerisch ("Pflanzung01"). ``isTimberProductId``
        //    laesst ``class:lgtin`` ohnehin laengst zu -- der Extraktor war
        //    die einzige Stelle, die enger war als der Rest der Kette.
        const EPC_IN_TTL = 'urn:epc:(?:id|class):[sl]gtin:[0-9]+\\.[0-9*]+\\.[A-Za-z0-9_-]+';
        const tagged = ttl.match(
          new RegExp(`tc:epc\\s+<(${EPC_IN_TTL})>`, 'i'),
        );
        const anyEpc = ttl.match(new RegExp(EPC_IN_TTL, 'i'));
        // GROSS-/KLEINSCHREIBUNG BLEIBT. Hier stand ``.toLowerCase()``, und
        // solange Seriennummern reine Ziffern waren, fiel das nicht auf.
        // Eine Losnummer ist alphanumerisch: aus "Pflanzung01" wurde
        // "pflanzung01". Der Katalog findet damit zwar noch (er vergleicht
        // beidseitig klein, s.u.), die Abfrage aber nicht mehr -- SPARQL
        // vergleicht IRIs ZEICHENGENAU (``FILTER(?e IN (<...>))``), und
        // ``fetchProductDataByEpc`` reicht genau diese Id als IRI weiter.
        // Das Ergebnis waere der stille Fall: Quellen gefunden, Abfrage
        // laeuft, null Treffer -- also wieder "keine Daten", nur eine Stufe
        // spaeter.
        const epc = tagged?.[1] ?? anyEpc?.[0];
        if (epc) result = epc;
      }
    }
  } catch (error) {
    console.warn('[CatalogService] Error extracting id from data:', downloadUrl, error);
  }

  dataIdCache.set(downloadUrl, result);
  return result;
}

/**
 * Derive a stable grouping id from metadata/URL as a last resort (no download).
 * Strips a trailing data-type suffix so the station files of one product group.
 */
function deriveGroupingId(dataset: CatalogDataset): string | null {
  const id = dataset.identifier;
  if (id) {
    const stripped = id.replace(/_(forst|saegewerk|bspwerk|unknown)$/i, '');
    if (stripped) return stripped.toUpperCase();
  }
  const url = dataset.access_url_dataset;
  if (url) {
    const file = url.split('/').pop()?.replace(/\.ttl$/i, '') || '';
    const stripped = file.replace(/_(forst|saegewerk|bspwerk|unknown).*$/i, '');
    if (stripped) return stripped.toUpperCase();
  }
  return null;
}

/**
 * Extract the product grouping id for a dataset. Order:
 *  1. TC-id from catalog metadata (fast path),
 *  2. real id from the data file (TC-id or GS1 doc_hash) — the reliable path,
 *  3. derived from identifier/URL (last resort).
 */
async function extractTraceId(dataset: CatalogDataset): Promise<string | null> {
  const metadataId = extractTraceIdFromMetadata(dataset);
  if (metadataId) return metadataId;

  if (dataset.access_url_dataset) {
    const dataId = await extractIdFromData(dataset.access_url_dataset);
    if (dataId) return dataId;
  }

  return deriveGroupingId(dataset);
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

/**
 * ALLE Datenquellen aus allen registrierten Pods — ohne Umweg ueber Produkte.
 *
 * Der Unterschied zu ``getAllProductsAsync().flatMap(p => p.sources)`` ist
 * nicht kosmetisch: ``groupDatasetsToProducts`` verwirft jeden Datensatz, aus
 * dem ``extractIdFromData`` keine ID lesen konnte
 * (``filter(d => d.traceId !== null)``). Fuer Bauteile ist das richtig — eine
 * Liste "Verfuegbare Produkte" soll keine ID-losen Dokumente zeigen.
 *
 * Fuer Pflanzflaechen ist es falsch. Eine Flaeche ist kein Produkt: Das
 * Stammzertifikat liegt im Pod der Baumschule bzw. des Forstbetriebs, taucht
 * in keiner Bauteil-Gruppierung auf, und sein Bezug ist Vermehrungsgut
 * (``urn:epc:class:lgtin``) — der Regex in ``extractIdFromData`` sucht aber
 * nur ``urn:epc:id:``. Ein Zertifikat faellt damit gleich doppelt heraus, und
 * mit ihm seine Quelle. Wer Flaechen ueber den Produktkatalog sucht, findet
 * genau die nicht, die noch zu keinem geernteten Bauteil gehoeren.
 *
 * Deshalb hier die Rohliste. Die Zugriffsentscheidung faellt nicht hier,
 * sondern danach ueber ``filterSourcesByRole`` — welcher Pod welcher Rolle
 * offensteht, weiss die Zugriffskontrolle, nicht der Katalog.
 */
export async function getAllCatalogSources(): Promise<string[]> {
  // Liegt der Katalog schon im Cache, wird er NICHT neu geholt. Das ist nicht
  // nur eine Sparmassnahme: Diese Funktion wird auch aus dem Agenten heraus
  // aufgerufen, waehrend er eine Frage beantwortet. Dort einen Netzabruf
  // auszuloesen, wo der Aufrufer laengst dieselben Daten hat, waere eine
  // versteckte Verzoegerung mitten in der Antwort.
  const cached = getCachedDatasets();
  const datasets = cached.length > 0 ? cached : await fetchCatalogDatasets();

  const urls = datasets
    .map((d) => d.access_url_dataset)
    .filter((url): url is string => Boolean(url));
  return Array.from(new Set(urls));
}

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
  // Ein laufender Abruf gehoert zum alten Stand: sein Ergebnis wird
  // verworfen (generation), und der naechste Aufruf startet neu.
  generation += 1;
  inFlight = null;
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
