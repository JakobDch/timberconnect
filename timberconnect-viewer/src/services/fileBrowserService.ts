/**
 * File Browser Service for TimberConnect
 *
 * Discovers uploaded files (raw originals + RDF serialisations) across the
 * federation's Solid Pods so users can browse and re-extract them.
 *
 * Access model (mirrors filterSourcesByRole):
 *  - BEFORE anything is listed, checkFileAccess() resolves which pods admit
 *    the current user's role (role-policy.ttl); pods without a policy are
 *    legacy/public and stay visible.
 *  - The WAC ACL on each product container remains the security boundary;
 *    this pre-filter only avoids guaranteed-403 requests. Listing/download
 *    failures degrade soft (pod skipped / German error surfaced).
 *
 * Discovery per accessible pod:
 *  - own pod: list {pod}data/ directly (owner has Control)
 *  - foreign pods: product containers derived from catalog entries whose
 *    downloadURL sits under /data/ (the data/ root itself is owner-only)
 *  - legacy: {pod}public/uploads/ (public-read, pre-RBAC upload flow)
 */

import {
  getSolidDataset,
  getContainedResourceUrlAll,
  getThing,
  getDatetime,
} from '@inrupt/solid-client';
import { DCTERMS } from '@inrupt/vocab-common-rdf';
import { getAuthFetch } from './authFetch';
import { getAllowedRoles, podBaseFromWebId } from './accessControlService';
import { discoverMemberWebIds, getRoleForWebId } from './registryService';
import { fetchCatalogDatasets, getCachedDatasets } from './catalogService';
import { getRoleByIri } from '../config/roles';

export interface PodAccessInfo {
  /** Pod base URL with trailing slash. */
  pod: string;
  ownerWebId: string;
  ownerRoleIri: string | null;
  ownerRoleLabel: string | null;
  /** True if this is the current user's own pod. */
  isOwn: boolean;
  /** True if the pod publishes a role-policy (false = legacy/public pod). */
  hasPolicy: boolean;
  /** True if the current user's role may read this pod's data. */
  accessible: boolean;
}

export interface FileAccessResult {
  pods: PodAccessInfo[];
  accessible: PodAccessInfo[];
  denied: PodAccessInfo[];
}

export interface PodFileEntry {
  url: string;
  /** Decoded file name, used as the download name. */
  name: string;
  /** Product/trace container name (e.g. TC-2026-123), null for legacy uploads. */
  traceId: string | null;
  pod: string;
  ownerRoleIri: string | null;
  ownerRoleLabel: string | null;
  modified: Date | null;
  /** True for .ttl serialisations, false for original raw files. */
  isRdf: boolean;
  /** True for files from the pre-RBAC public/uploads/ folder. */
  legacy: boolean;
}

// ---------------------------------------------------------------------------
// Access check (runs BEFORE the browser UI shows any files)
// ---------------------------------------------------------------------------

/**
 * Resolve every federation pod and decide whether the current user (webId +
 * role) may browse its data. Own pod is always accessible; pods without a
 * published role-policy are treated as legacy/public (same semantics as the
 * SPARQL pre-filter).
 */
export async function checkFileAccess(
  webId: string | null,
  roleIri: string | null,
): Promise<FileAccessResult> {
  const memberWebIds = await discoverMemberWebIds();
  const ownPod = webId ? podBaseFromWebId(webId) : null;

  // Dedupe by pod base, keeping a WebID per pod for the owner-role lookup.
  const podToWebId = new Map<string, string>();
  for (const member of memberWebIds) {
    podToWebId.set(podBaseFromWebId(member), member);
  }
  if (webId && ownPod) podToWebId.set(ownPod, webId);

  const pods = await Promise.all(
    Array.from(podToWebId.entries()).map(async ([pod, ownerWebId]): Promise<PodAccessInfo> => {
      const [ownerRoleIri, policy] = await Promise.all([
        getRoleForWebId(ownerWebId),
        getAllowedRoles(pod),
      ]);
      const isOwn = ownPod === pod;
      const accessible =
        isOwn || policy.length === 0 || (roleIri !== null && policy.includes(roleIri));
      return {
        pod,
        ownerWebId,
        ownerRoleIri,
        ownerRoleLabel: getRoleByIri(ownerRoleIri)?.label ?? null,
        isOwn,
        hasPolicy: policy.length > 0,
        accessible,
      };
    }),
  );

  return {
    pods,
    accessible: pods.filter((p) => p.accessible),
    denied: pods.filter((p) => !p.accessible),
  };
}

// ---------------------------------------------------------------------------
// Container listing
// ---------------------------------------------------------------------------

interface ListedResource {
  url: string;
  modified: Date | null;
}

/** List a container's children, splitting files from sub-containers. */
async function listContainer(
  containerUrl: string,
): Promise<{ files: ListedResource[]; containers: string[] }> {
  const ds = await getSolidDataset(containerUrl, { fetch: getAuthFetch() });
  const children = getContainedResourceUrlAll(ds);

  const files: ListedResource[] = [];
  const containers: string[] = [];
  for (const child of children) {
    if (child.endsWith('/')) {
      containers.push(child);
    } else {
      // CSS inlines dc:modified for contained resources; fall back to null.
      const thing = getThing(ds, child);
      files.push({
        url: child,
        modified: thing ? getDatetime(thing, DCTERMS.modified) : null,
      });
    }
  }
  return { files, containers };
}

/** HEAD fallback for files whose container listing carried no dc:modified. */
async function fetchLastModified(url: string): Promise<Date | null> {
  try {
    const response = await getAuthFetch()(url, { method: 'HEAD' });
    const header = response.headers.get('last-modified');
    return header ? new Date(header) : null;
  } catch {
    return null;
  }
}

function fileNameFromUrl(url: string): string {
  const segment = url.split('/').pop() || url;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function toEntry(
  resource: ListedResource,
  pod: PodAccessInfo,
  traceId: string | null,
  legacy: boolean,
): PodFileEntry {
  return {
    url: resource.url,
    name: fileNameFromUrl(resource.url),
    traceId,
    pod: pod.pod,
    ownerRoleIri: pod.ownerRoleIri,
    ownerRoleLabel: pod.ownerRoleLabel,
    modified: resource.modified,
    isRdf: resource.url.toLowerCase().endsWith('.ttl'),
    legacy,
  };
}

/**
 * Derive product-container URLs per pod from the catalog: registered datasets
 * point at .../data/<traceId>/<file>.ttl, so the parent container is listable
 * even though the data/ root itself is owner-only.
 */
async function catalogContainersByPod(): Promise<Map<string, Set<string>>> {
  let datasets;
  try {
    datasets = await fetchCatalogDatasets();
  } catch {
    datasets = getCachedDatasets();
  }

  const byPod = new Map<string, Set<string>>();
  for (const dataset of datasets) {
    const url = dataset.access_url_dataset;
    if (!url || !url.includes('/data/')) continue;
    const containerUrl = url.slice(0, url.lastIndexOf('/') + 1);
    const podMatch = url.match(/^(https?:\/\/[^/]+\/[^/]+\/)/);
    if (!podMatch) continue;
    const set = byPod.get(podMatch[1]) ?? new Set<string>();
    set.add(containerUrl);
    byPod.set(podMatch[1], set);
  }
  return byPod;
}

/** Trace id = name of the product container (last path segment). */
function traceIdFromContainer(containerUrl: string): string | null {
  const match = containerUrl.match(/\/data\/([^/]+)\/$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Collect all files visible to the user from the accessible pods.
 * Individual pod/container failures are skipped (WAC has the final word).
 */
export async function listAccessibleFiles(
  accessiblePods: PodAccessInfo[],
): Promise<PodFileEntry[]> {
  const catalogContainers = await catalogContainersByPod();
  const entries: PodFileEntry[] = [];

  await Promise.all(
    accessiblePods.map(async (pod) => {
      // 1. Product containers under data/
      const containers = new Set<string>(catalogContainers.get(pod.pod) ?? []);
      try {
        const dataRoot = await listContainer(`${pod.pod}data/`);
        for (const sub of dataRoot.containers) containers.add(sub);
      } catch {
        // data/ root not listable (foreign pod) -> rely on catalog-derived containers
      }

      await Promise.all(
        Array.from(containers).map(async (containerUrl) => {
          try {
            const { files } = await listContainer(containerUrl);
            const traceId = traceIdFromContainer(containerUrl);
            for (const file of files) entries.push(toEntry(file, pod, traceId, false));
          } catch (e) {
            console.warn('[fileBrowser] Container not listable:', containerUrl, e);
          }
        }),
      );

      // 2. Legacy pre-RBAC uploads under public/uploads/
      try {
        const legacyRoot = await listContainer(`${pod.pod}public/uploads/`);
        for (const file of legacyRoot.files) entries.push(toEntry(file, pod, null, true));
      } catch {
        // No legacy folder on this pod
      }
    }),
  );

  // Fill missing dates via HEAD so the time-range filter works everywhere.
  await Promise.all(
    entries
      .filter((entry) => entry.modified === null)
      .map(async (entry) => {
        entry.modified = await fetchLastModified(entry.url);
      }),
  );

  // Newest first; undated entries last.
  entries.sort((a, b) => (b.modified?.getTime() ?? 0) - (a.modified?.getTime() ?? 0));
  return entries;
}

// ---------------------------------------------------------------------------
// Extraction (download in original form)
// ---------------------------------------------------------------------------

/**
 * Fetch a file with the authenticated session and trigger a browser download
 * under its original name. WAC enforces access: 401/403 surface as a German
 * permission error.
 */
export async function downloadOriginalFile(entry: PodFileEntry): Promise<void> {
  const response = await getAuthFetch()(entry.url);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Keine Berechtigung zum Extrahieren dieser Datei.');
    }
    throw new Error(`Download fehlgeschlagen (HTTP ${response.status}).`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = entry.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
