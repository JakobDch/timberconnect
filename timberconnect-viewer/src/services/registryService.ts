/**
 * Role Registry Service for TimberConnect
 *
 * The "registry" is a *derived* view over the federation, not a central store:
 * the Federation Registry already lists every member pod's owner WebID, so we
 * resolve WebID -> role by reading each member's own profile/role.ttl. This keeps
 * the model fully decentralised (each user declares their own role on their pod)
 * while still letting us materialise per-role acl:agentGroup membership.
 *
 * Reuses the federation member discovery already implemented for the catalog.
 */

import { getSolidDataset, getThing, getUrl, getUrlAll } from '@inrupt/solid-client';
import { getAuthFetch } from './authFetch';
import {
  ROLE_DOC,
  podBaseFromWebId,
  getAllowedRoles,
  writeGroupDoc,
} from './accessControlService';
import { TC_HAS_ROLE, ROLES } from '../config/roles';

const LDP_CONTAINS = 'http://www.w3.org/ns/ldp#contains';

const FEDERATION_REGISTRY_URL =
  import.meta.env.VITE_FEDERATION_REGISTRY_URL ||
  'https://solid-community-server.tmdt.info/semanticdatacatalog/public/dace/';

// The registry historically holds entries under an older domain; normalise so
// role.ttl reads hit the live server.
const DOMAIN_ALIASES: Record<string, string> = {
  'tmdt-solid-community-server.de': 'solid-community-server.tmdt.info',
};

function normaliseWebId(webId: string): string {
  try {
    const url = new URL(webId);
    const alias = DOMAIN_ALIASES[url.hostname];
    if (alias) {
      url.hostname = alias;
      return url.toString();
    }
  } catch {
    /* fall through */
  }
  return webId;
}

let memberCache: { webIds: string[]; at: number } | null = null;
const MEMBER_TTL = 5 * 60 * 1000;

/**
 * Discover all member WebIDs registered in the Federation Registry.
 * Members are encoded as `member-<double-url-encoded-webid>`.
 */
export async function discoverMemberWebIds(): Promise<string[]> {
  if (memberCache && Date.now() - memberCache.at < MEMBER_TTL) {
    return memberCache.webIds;
  }

  const webIds: string[] = [];
  try {
    const ds = await getSolidDataset(FEDERATION_REGISTRY_URL, { fetch: getAuthFetch() });
    const container = getThing(ds, FEDERATION_REGISTRY_URL);
    const members = container ? getUrlAll(container, LDP_CONTAINS) : [];

    for (const member of members) {
      const filename = member.split('/').pop() || '';
      if (!filename.startsWith('member-')) continue;
      const encoded = filename.substring('member-'.length);
      try {
        const webId = decodeURIComponent(decodeURIComponent(encoded));
        webIds.push(normaliseWebId(webId));
      } catch {
        /* skip malformed member */
      }
    }
  } catch (e) {
    console.warn('[registry] Failed to discover members:', e);
  }

  memberCache = { webIds, at: Date.now() };
  return webIds;
}

/**
 * Ensure the logged-in user is listed in the Federation Registry.
 *
 * Without this entry the user is invisible for group materialisation: data
 * owners resolve role members FROM the registry, so an unregistered user never
 * lands in any acl:agentGroup and gets WAC-403 on all protected data. Called
 * automatically on every login (idempotent, fire-and-forget).
 */
export async function ensureRegisteredInFederation(webId: string): Promise<void> {
  try {
    const members = await discoverMemberWebIds();
    if (members.includes(webId)) return; // bereits registriert

    // Same slug convention the registry already uses: member-<double-encoded-webid>
    const slug = `member-${encodeURIComponent(encodeURIComponent(webId))}`;
    const url = `${FEDERATION_REGISTRY_URL}${slug}`;
    const body =
      `@prefix foaf: <http://xmlns.com/foaf/0.1/>.\n` +
      `@prefix dcterms: <http://purl.org/dc/terms/>.\n\n` +
      `<#it> a foaf:Group ;\n` +
      `  foaf:member <${webId}> ;\n` +
      `  dcterms:modified "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .\n`;

    const response = await getAuthFetch()(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body,
    });
    if (!response.ok) {
      console.warn(
        `[registry] Föderations-Registrierung fehlgeschlagen (${response.status}) für`,
        webId,
      );
      return;
    }
    memberCache = null; // Cache invalidieren, damit der neue Member sofort sichtbar ist
    console.log('[registry] WebID im Föderations-Register eingetragen:', webId);
  } catch (e) {
    console.warn('[registry] Föderations-Registrierung fehlgeschlagen:', e);
  }
}

/**
 * Re-materialise the OWN pod's role group docs from the current registry state.
 *
 * Group docs are snapshots: users who registered after the owner last saved
 * their access policy are missing. Only the owner can write their group docs,
 * so this runs on every owner login — the dataspace heals itself as owners
 * come online. No-op for pods without a role policy.
 */
export async function refreshOwnGroupDocs(webId: string): Promise<void> {
  try {
    const pod = podBaseFromWebId(webId);
    const allowed = await getAllowedRoles(pod);
    if (allowed.length === 0) return; // keine Policy -> nichts zu aktualisieren

    for (const iri of allowed) {
      const role = ROLES.find((r) => r.iri === iri);
      if (!role) continue;
      const members = await resolveRoleMembers(iri);
      await writeGroupDoc(pod, role, Array.from(new Set([webId, ...members])));
    }
    console.log('[registry] Eigene Rollen-Gruppen aus dem Register aktualisiert');
  } catch (e) {
    console.warn('[registry] Gruppen-Refresh fehlgeschlagen:', e);
  }
}

/** Read a single WebID's declared role IRI from its profile/role.ttl. */
export async function getRoleForWebId(webId: string): Promise<string | null> {
  const normalised = normaliseWebId(webId);
  const pod = podBaseFromWebId(normalised);
  try {
    const ds = await getSolidDataset(ROLE_DOC(pod), { fetch: getAuthFetch() });
    const thing = getThing(ds, normalised);
    if (!thing) return null;
    return getUrl(thing, TC_HAS_ROLE);
  } catch {
    return null;
  }
}

/**
 * Resolve all member WebIDs that have declared the given role IRI.
 * Used to materialise a role's vcard:Group membership.
 */
export async function resolveRoleMembers(roleIri: string): Promise<string[]> {
  const members = await discoverMemberWebIds();
  const results = await Promise.all(
    members.map(async (webId) => ({ webId, role: await getRoleForWebId(webId) })),
  );
  return results.filter((r) => r.role === roleIri).map((r) => r.webId);
}
