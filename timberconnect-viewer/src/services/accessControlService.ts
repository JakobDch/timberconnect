/**
 * Access Control Service for TimberConnect
 *
 * Implements the role-based, WAC-enforced access model:
 *  - the pod owner's own role            -> {pod}profile/role.ttl
 *  - which roles may read this pod        -> {pod}access/role-policy.ttl (public-read)
 *  - WebID membership per role            -> {pod}access/groups/<role>.ttl (public-read, used as acl:agentGroup)
 *  - stamping container ACLs              -> grant owner full control + allowed-role groups Read
 *
 * Enforcement is done by the Community Solid Server via WAC; the client-side
 * pre-filter (canRoleQueryPod) is a UX optimisation, not the security boundary.
 */

import {
  getSolidDataset,
  getThing,
  setThing,
  buildThing,
  createThing,
  createSolidDataset,
  saveSolidDatasetAt,
  getUrl,
  getUrlAll,
  getStringNoLocale,
  getResourceAcl,
  createAcl,
  createAclFromFallbackAcl,
  hasResourceAcl,
  hasAccessibleAcl,
  hasFallbackAcl,
  getSolidDatasetWithAcl,
  setAgentResourceAccess,
  setAgentDefaultAccess,
  setGroupResourceAccess,
  setGroupDefaultAccess,
  setPublicResourceAccess,
  saveAclFor,
  type Access,
} from '@inrupt/solid-client';
import { RDF, VCARD } from '@inrupt/vocab-common-rdf';
import { getAuthFetch } from './authFetch';
import { NAMESPACES } from '../config/solidPods';
import {
  ROLES,
  TC_HAS_ROLE,
  TC_ALLOWS_ROLE,
  TC_COMPANY_PREFIX,
  VCARD_ROLE,
  getRoleByIri,
  groupDocName,
  type RoleDef,
} from '../config/roles';

// Container-Inhalt (LDP): zum Auflisten der vorhandenen Datencontainer.
const LDP_CONTAINS = 'http://www.w3.org/ns/ldp#contains';
const VCARD_GROUP = 'http://www.w3.org/2006/vcard/ns#Group';
const VCARD_HAS_MEMBER = 'http://www.w3.org/2006/vcard/ns#hasMember';

// ---------------------------------------------------------------------------
// Pod / resource URL helpers
// ---------------------------------------------------------------------------

/**
 * Derive the pod base URL (with trailing slash) from a WebID.
 * e.g. https://host/epcisrepository/profile/card#me -> https://host/epcisrepository/
 */
export function podBaseFromWebId(webId: string): string {
  const match = webId.match(/^(https?:\/\/[^/]+\/[^/]+\/)/);
  if (match) return match[1];
  // Fallback: strip everything after the host
  const url = new URL(webId);
  return `${url.origin}/`;
}

/** Derive the pod base from any resource URL by taking the first path segment. */
export function podBaseFromUrl(resourceUrl: string): string {
  const match = resourceUrl.match(/^(https?:\/\/[^/]+\/[^/]+\/)/);
  if (match) return match[1];
  const url = new URL(resourceUrl);
  return `${url.origin}/`;
}

export const ROLE_DOC = (pod: string) => `${pod}profile/role.ttl`;
export const ROLE_POLICY_DOC = (pod: string) => `${pod}access/role-policy.ttl`;
export const GROUPS_CONTAINER = (pod: string) => `${pod}access/groups/`;
export const GROUP_DOC = (pod: string, roleId: string) =>
  `${GROUPS_CONTAINER(pod)}${groupDocName(roleId)}`;
export const EPCIS_CONSENT_DOC = (pod: string) => `${pod}access/epcis-consent.ttl`;
const POLICY_SUBJECT = (pod: string) => `${ROLE_POLICY_DOC(pod)}#policy`;
const GROUP_SUBJECT = (pod: string, roleId: string) => `${GROUP_DOC(pod, roleId)}#group`;
// Default-consent subject; the EPCIS proxy falls back to this for any EPC
// without an explicit per-EPC consent entry. Must match solid_rdf.ConsentDoc.
const CONSENT_DEFAULT_SUBJECT = `${NAMESPACES.tc}defaultConsent`;

// ---------------------------------------------------------------------------
// Owner role  (profile/role.ttl)
// ---------------------------------------------------------------------------

/** The owner's declared role + registration data from {pod}profile/role.ttl. */
export interface OwnSetup {
  role: RoleDef | null;
  /** GS1 Company Prefix — Write-once, nach der Registrierung unveränderlich. */
  companyPrefix: string | null;
}

/** Read the owner's declared role from their pod. Returns null if not yet set. */
export async function getOwnRole(webId: string): Promise<RoleDef | null> {
  return (await getOwnSetup(webId)).role;
}

/** Read role + company prefix in one request. */
export async function getOwnSetup(webId: string): Promise<OwnSetup> {
  const pod = podBaseFromWebId(webId);
  try {
    const ds = await getSolidDataset(ROLE_DOC(pod), { fetch: getAuthFetch() });
    const thing = getThing(ds, webId);
    if (!thing) return { role: null, companyPrefix: null };
    return {
      role: getRoleByIri(getUrl(thing, TC_HAS_ROLE)),
      companyPrefix: getStringNoLocale(thing, TC_COMPANY_PREFIX),
    };
  } catch {
    // 404 -> not set yet
    return { role: null, companyPrefix: null };
  }
}

/**
 * Write the owner's role to {pod}profile/role.ttl (tc:hasRole + vcard:role).
 *
 * Der Company Prefix ist Write-once: Steht bereits einer im Pod, gewinnt
 * IMMER der vorhandene — ein Überschreiben ist auch über diese API nicht
 * möglich. Rückgabe ist der effektiv gespeicherte Prefix.
 */
export async function setOwnRole(
  webId: string,
  role: RoleDef,
  companyPrefix?: string,
): Promise<string | null> {
  const pod = podBaseFromWebId(webId);
  let ds;
  let existingPrefix: string | null = null;
  try {
    ds = await getSolidDataset(ROLE_DOC(pod), { fetch: getAuthFetch() });
    const existing = getThing(ds, webId);
    if (existing) {
      existingPrefix = getStringNoLocale(existing, TC_COMPANY_PREFIX);
    }
  } catch {
    ds = createSolidDataset();
  }
  const effectivePrefix = existingPrefix ?? companyPrefix?.trim() ?? null;
  let builder = buildThing(createThing({ url: webId }))
    .addUrl(RDF.type, VCARD.Individual)
    .addUrl(TC_HAS_ROLE, role.iri)
    .addStringNoLocale(VCARD_ROLE, role.vcard);
  if (effectivePrefix) {
    builder = builder.addStringNoLocale(TC_COMPANY_PREFIX, effectivePrefix);
  }
  ds = setThing(ds, builder.build());
  await saveSolidDatasetAt(ROLE_DOC(pod), ds, { fetch: getAuthFetch() });
  // role.ttl is descriptive metadata -> make it public-readable
  await stampPublicRead(ROLE_DOC(pod));
  return effectivePrefix;
}

// ---------------------------------------------------------------------------
// Role policy  (access/role-policy.ttl) — which roles may read this pod
// ---------------------------------------------------------------------------

/** Read the allowed-role IRIs from a pod's role-policy.ttl. Public-readable. */
export async function getAllowedRoles(pod: string): Promise<string[]> {
  try {
    const ds = await getSolidDataset(ROLE_POLICY_DOC(pod), { fetch: getAuthFetch() });
    const thing = getThing(ds, POLICY_SUBJECT(pod));
    if (!thing) return [];
    return getUrlAll(thing, TC_ALLOWS_ROLE);
  } catch {
    return [];
  }
}

/** True if `roleIri` is allowed to read `pod`. Used as the query pre-filter. */
export async function canRoleQueryPod(pod: string, roleIri: string | null): Promise<boolean> {
  if (!roleIri) return false;
  const allowed = await getAllowedRoles(pod);
  return allowed.includes(roleIri);
}

/**
 * Pre-filter a list of source URLs to only those whose owning pod admits the
 * given role. This is a UX optimisation (avoids guaranteed-403 queries); the
 * server-side WAC remains the real enforcement.
 *
 * Pods that publish NO role-policy at all are treated as legacy/public and kept,
 * so existing public data keeps working until fully migrated.
 */
export async function filterSourcesByRole(
  sources: string[],
  roleIri: string | null,
): Promise<{ allowed: string[]; denied: string[] }> {
  const byPod = new Map<string, string[]>();
  for (const src of sources) {
    const pod = podBaseFromUrl(src);
    byPod.set(pod, [...(byPod.get(pod) ?? []), src]);
  }

  const allowed: string[] = [];
  const denied: string[] = [];

  await Promise.all(
    Array.from(byPod.entries()).map(async ([pod, podSources]) => {
      const policy = await getAllowedRoles(pod);
      // No policy published -> legacy/public pod, keep its sources.
      const permit = policy.length === 0 || (roleIri !== null && policy.includes(roleIri));
      if (permit) allowed.push(...podSources);
      else denied.push(...podSources);
    }),
  );

  return { allowed, denied };
}

/**
 * Overwrite the allowed-role allowlist for the owner's pod, then re-materialise
 * the group docs and re-stamp the data-container ACL so WAC reflects the change.
 */
export async function setAllowedRoles(
  webId: string,
  roleIris: string[],
  resolveMembers: (roleIri: string) => Promise<string[]>,
): Promise<void> {
  const pod = podBaseFromWebId(webId);

  // 1. Write role-policy.ttl
  let ds;
  try {
    ds = await getSolidDataset(ROLE_POLICY_DOC(pod), { fetch: getAuthFetch() });
  } catch {
    ds = createSolidDataset();
  }
  const built = buildThing(createThing({ url: POLICY_SUBJECT(pod) }));
  for (const iri of roleIris) built.addUrl(TC_ALLOWS_ROLE, iri);
  ds = setThing(ds, built.build());
  await saveSolidDatasetAt(ROLE_POLICY_DOC(pod), ds, { fetch: getAuthFetch() });
  await stampPublicRead(ROLE_POLICY_DOC(pod));

  // 2. Materialise per-role group docs (WebID members) for the allowed roles
  for (const iri of roleIris) {
    const role = ROLES.find((r) => r.iri === iri);
    if (!role) continue;
    const members = await resolveMembers(iri);
    await writeGroupDoc(pod, role, members);
  }

  // 3. Keep EPCIS consent in sync with the same allowlist, so changing who may
  //    read pod data also changes who may receive this owner's EPCIS events.
  await writeEpcisConsent(webId, roleIris);

  // 4. Bereits hochgeladene Datencontainer nachstempeln.
  //
  // Ohne diesen Schritt wirkt die Freigabe nur fuer KUENFTIGE Uploads: die
  // ACL eines Containers wird beim Hochladen gesetzt (stampContainerAcl in
  // uploadService/pdfDocumentService) und danach nie wieder angefasst. Wer
  // seine Rollen erst nach dem ersten Upload festlegt -- der Normalfall --
  // haette Daten im Pod, die fuer alle anderen unsichtbar bleiben, obwohl die
  // Freigabe erteilt ist. Genau dieser Fall ist in der Demo aufgetreten.
  await restampExistingDataContainers(pod, webId, roleIris);
}

/**
 * Die ACL aller vorhandenen Container unter <pod>data/ neu setzen.
 *
 * Best effort: ein einzelner Container, dessen ACL sich nicht schreiben
 * laesst, darf die uebrigen nicht verhindern -- und schon gar nicht die
 * Rollenvergabe scheitern lassen, die zu diesem Zeitpunkt bereits
 * geschrieben ist.
 */
async function restampExistingDataContainers(
  pod: string,
  ownerWebId: string,
  roleIris: string[],
): Promise<void> {
  const dataRoot = `${pod}data/`;
  let containers: string[] = [];
  try {
    const ds = await getSolidDataset(dataRoot, { fetch: getAuthFetch() });
    const root = getThing(ds, dataRoot);
    containers = root ? getUrlAll(root, LDP_CONTAINS) : [];
  } catch {
    return; // noch keine Daten im Pod
  }

  let ok = 0;
  for (const container of containers) {
    if (!container.endsWith('/')) continue; // nur Container, keine Einzeldateien
    try {
      await stampContainerAcl(container, ownerWebId, roleIris);
      ok += 1;
    } catch (err) {
      console.warn('[access] ACL konnte nicht aktualisiert werden:', container, err);
    }
  }
  if (containers.length > 0) {
    console.log(`[access] ${ok}/${containers.length} Datencontainer neu freigegeben.`);
  }
}

// ---------------------------------------------------------------------------
// Group documents  (access/groups/<role>.ttl) — acl:agentGroup targets
// ---------------------------------------------------------------------------

/** Write a vcard:Group doc listing the member WebIDs for a role; public-read. */
export async function writeGroupDoc(pod: string, role: RoleDef, memberWebIds: string[]): Promise<void> {
  const docUrl = GROUP_DOC(pod, role.id);
  const group = buildThing(createThing({ url: GROUP_SUBJECT(pod, role.id) }))
    .addUrl(RDF.type, VCARD_GROUP);
  for (const webId of memberWebIds) {
    group.addUrl(VCARD_HAS_MEMBER, webId);
  }
  // Das bestehende Dokument laden und nur bei 404 neu anlegen: ein frisch
  // erzeugtes Dataset wuerde mit If-None-Match:* gespeichert und vom Server
  // mit 412 abgelehnt, sobald die Datei existiert. setThing ersetzt die
  // Gruppe samt Mitgliederliste vollstaendig.
  let ds;
  try {
    ds = await getSolidDataset(docUrl, { fetch: getAuthFetch() });
  } catch {
    ds = createSolidDataset();
  }
  ds = setThing(ds, group.build());
  await saveSolidDatasetAt(docUrl, ds, { fetch: getAuthFetch() });
  await stampPublicRead(docUrl);
}

// ---------------------------------------------------------------------------
// ACL stamping
// ---------------------------------------------------------------------------

/** Get (or create) a writable ACL for a resource, handling the fallback case. */
async function getEditableAcl(resourceUrl: string) {
  const withAcl = await getSolidDatasetWithAcl(resourceUrl, { fetch: getAuthFetch() });
  if (!hasAccessibleAcl(withAcl)) {
    throw new Error(`No accessible ACL for ${resourceUrl} (need Control access)`);
  }
  if (hasResourceAcl(withAcl)) {
    return { withAcl, acl: getResourceAcl(withAcl)! };
  }
  if (hasFallbackAcl(withAcl)) {
    return { withAcl, acl: createAclFromFallbackAcl(withAcl) };
  }
  return { withAcl, acl: createAcl(withAcl) };
}

const FULL: Access = { read: true, append: true, write: true, control: true };
const READ: Access = { read: true, append: false, write: false, control: false };

/**
 * Stamp a data container's ACL: owner gets full control, each allowed-role group
 * gets Read on the container AND as default (so children inherit). Applied with
 * both acl:accessTo and acl:default semantics.
 */
export async function stampContainerAcl(
  containerUrl: string,
  ownerWebId: string,
  allowedRoleIris: string[],
): Promise<void> {
  const pod = podBaseFromUrl(containerUrl);
  const { withAcl, acl: initialAcl } = await getEditableAcl(containerUrl);
  let acl = initialAcl;

  // Owner: full control on the container and as default for children
  acl = setAgentResourceAccess(acl, ownerWebId, FULL);
  acl = setAgentDefaultAccess(acl, ownerWebId, FULL);

  // Allowed role groups: Read on container + default
  for (const iri of allowedRoleIris) {
    const role = ROLES.find((r) => r.iri === iri);
    if (!role) continue;
    const groupUrl = GROUP_SUBJECT(pod, role.id);
    acl = setGroupResourceAccess(acl, groupUrl, READ);
    acl = setGroupDefaultAccess(acl, groupUrl, READ);
  }

  await saveAclFor(withAcl, acl, { fetch: getAuthFetch() });
}

// ---------------------------------------------------------------------------
// EPCIS consent  (access/epcis-consent.ttl) — which roles may receive events
// ---------------------------------------------------------------------------

/**
 * Write the owner's default EPCIS consent (the roles allowed to receive events
 * for this owner's products). At "role -> all my data" granularity this is a
 * single #default entry that the proxy applies to every EPC. Public-read so the
 * EPCIS proxy can consult it without a token.
 *
 * Defaults to the owner's current role-policy allowlist when no roles are given.
 */
export async function writeEpcisConsent(
  webId: string,
  allowedRoleIris?: string[],
): Promise<void> {
  const pod = podBaseFromWebId(webId);
  const roleIris = allowedRoleIris ?? (await getAllowedRoles(pod));

  let ds;
  try {
    ds = await getSolidDataset(EPCIS_CONSENT_DOC(pod), { fetch: getAuthFetch() });
  } catch {
    ds = createSolidDataset();
  }
  const consent = buildThing(createThing({ url: CONSENT_DEFAULT_SUBJECT }));
  for (const iri of roleIris) consent.addUrl(TC_ALLOWS_ROLE, iri);
  ds = setThing(ds, consent.build());
  await saveSolidDatasetAt(EPCIS_CONSENT_DOC(pod), ds, { fetch: getAuthFetch() });
  await stampPublicRead(EPCIS_CONSENT_DOC(pod));
}

/** Make a single resource public-readable (used for policy/group/role metadata docs). */
export async function stampPublicRead(resourceUrl: string): Promise<void> {
  await stampPublicAccess(resourceUrl, READ);
}

/**
 * Stamp an arbitrary public access mode on a single resource. Used e.g. by the
 * wallet (public read+write so other users can credit token payments — demo
 * simplification of a real payment authorization).
 */
export async function stampPublicAccess(resourceUrl: string, access: Access): Promise<void> {
  try {
    const { withAcl, acl } = await getEditableAcl(resourceUrl);
    const updated = setPublicResourceAccess(acl, access);
    await saveAclFor(withAcl, updated, { fetch: getAuthFetch() });
  } catch (e) {
    // Non-fatal: if we can't stamp the ACL (e.g. inherited default already
    // grants it), log and continue — the pre-filter degrades to authenticated reads.
    console.warn('[accessControl] Could not stamp public access on', resourceUrl, e);
  }
}
