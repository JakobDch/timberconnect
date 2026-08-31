/**
 * Access Control Service for TimberConnect
 *
 * Implements the role-based, WAC-enforced access model:
 *  - the pod owner's own role            -> {pod}profile/role.ttl
 *  - which roles may read this pod        -> {pod}access/role-policy.ttl (public-read)
 *  - which roles may read ONE document    -> {pod}access/doc-policy.ttl (public-read)
 *  - WebID membership per role            -> {pod}access/groups/<role>.ttl (public-read, used as acl:agentGroup)
 *  - stamping container ACLs              -> grant owner full control + allowed-role groups Read
 *
 * ZWEI EBENEN, EINE RICHTUNG (seit 26.08.2026)
 * -------------------------------------------
 * Die Pod-Freigabe (role-policy) ist die Obergrenze und zugleich die
 * Vorbelegung fuer neue Uploads. Die Dokument-Freigabe (doc-policy) darf sie
 * nur EINSCHRAENKEN, nie erweitern — die wirksame Menge ist immer die
 * Schnittmenge:
 *
 *     effektiv(doc) = podAllowlist ∩ (docAuswahl ?? podAllowlist)
 *
 * Warum diese Richtung: Nimmt der Nutzer spaeter eine Rolle aus der
 * Pod-Freigabe, soll sie ueberall verschwinden — auch aus Dokumenten, die sie
 * einzeln aufgezaehlt haben. Eine Dokumentregel, die die Pod-Grenze aufweitet,
 * waere ein stiller Weg an der zentralen Einstellung vorbei.
 *
 * Dokumente OHNE eigene Regel folgen der Pod-Freigabe (kein Eintrag =
 * "wie der Pod"), nicht "niemand". Sonst wuerden alle Altdaten unsichtbar,
 * sobald diese Datei zum ersten Mal geschrieben wird.
 *
 * WAC-Durchsetzung: pro Dokument eine RESSOURCEN-ACL (acl:accessTo auf die
 * Datei selbst). Die Container-ACL traegt die VEREINIGUNG aller darin
 * freigegebenen Rollen — sonst koennte ein Container-Default eine
 * eingeschraenkte Datei wieder oeffnen (acl:default vererbt nur auf
 * Ressourcen OHNE eigene ACL, aber die Vereinigung haelt Listing und
 * Direktzugriff konsistent).
 *
 * Enforcement is done by the Community Solid Server via WAC; the client-side
 * pre-filter (canRoleQueryPod) is a UX optimisation, not the security boundary.
 */

import {
  getSolidDataset,
  getThing,
  getThingAll,
  setThing,
  buildThing,
  createThing,
  createSolidDataset,
  saveSolidDatasetAt,
  asUrl,
  getUrl,
  getUrlAll,
  getBoolean,
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
  normalizeRoleIris,
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
/**
 * Dokumentbezogene Freigaben, EIN Dokument je Pod.
 *
 * Bewusst eine einzige Datei statt einer je Dokument: die Liste wird beim
 * Oeffnen von "Zugriff verwalten" komplett gebraucht und ist beim Pruefen
 * eines Downloads mit einem Request beantwortet. Subjekt ist die URL der
 * Datei, auf die sich die Regel bezieht.
 */
export const DOC_POLICY_DOC = (pod: string) => `${pod}access/doc-policy.ttl`;
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
    // Auf die heutige Schreibweise bringen: in laenger bestehenden Pods
    // stehen noch Rollen-IRIs frueherer Listenstaende (tc:Forst statt
    // tc:Forstbetrieb). Unuebersetzt faenden die Oberflaeche und das
    // Zugriffsmodell sie nicht mehr wieder.
    return normalizeRoleIris(getUrlAll(thing, TC_ALLOWS_ROLE));
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
      if (!permit) {
        denied.push(...podSources);
        return;
      }

      // Der Pod laesst die Rolle zu — jetzt noch die dokumentweisen Regeln.
      // Faellt deren Abruf aus, bleibt es beim Pod-Ergebnis: der Vorfilter
      // wird grosszuegiger, die Server-ACL bleibt die Grenze.
      let docPolicies: DocumentPolicy[] = [];
      try {
        docPolicies = await getDocumentPolicies(pod);
      } catch {
        docPolicies = [];
      }
      const byUrl = new Map(docPolicies.map((p) => [p.fileUrl, p]));

      for (const src of podSources) {
        const doc = byUrl.get(src);
        // Ohne eigene Regel gilt die Pod-Freigabe, die hier bereits greift.
        if (!doc) {
          allowed.push(src);
          continue;
        }
        const effective = effectiveRolesForDocument(policy, doc.roleIris);
        if (roleIri !== null && effective.includes(roleIri)) allowed.push(src);
        else denied.push(src);
      }
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
// Dokument-Policy  (access/doc-policy.ttl) — welche Rollen EIN Dokument sehen
// ---------------------------------------------------------------------------

/** Die Freigabe eines einzelnen Dokuments. */
export interface DocumentPolicy {
  /** URL der Datei im Pod, auf die sich die Regel bezieht. */
  fileUrl: string;
  /**
   * Die vom Nutzer fuer dieses Dokument gewaehlten Rollen — die ROHE Auswahl,
   * noch nicht mit der Pod-Freigabe verschnitten. `null` = keine eigene Regel,
   * das Dokument folgt der Pod-Freigabe.
   */
  roleIris: string[] | null;
  /** Anzeigename, damit die Verwaltung nicht nur URLs zeigt. */
  label: string | null;
  /** Container des Vorgangs, zu dem das Dokument gehoert. */
  containerUrl: string;
  /**
   * Material-Idente, die dieses Dokument beschreibt.
   *
   * Beim Upload bekannt (AcroForm-Ident bzw. trace_id der Erkennung) und hier
   * mitgeschrieben, damit die EPCIS-Freigabe spaeter ohne erneutes Lesen der
   * Datei abgeleitet werden kann.
   */
  epcs: string[];
}

/** Praedikat fuer den Anzeigenamen einer Dokumentregel. */
const TC_DOC_LABEL = `${NAMESPACES.tc}documentLabel`;
/** Marker: "fuer dieses Dokument wurde bewusst KEINE Rolle freigegeben". */
const TC_RESTRICTED = `${NAMESPACES.tc}restricted`;
/** Verknuepfung Dokument -> Material-ID (gleiches Praedikat wie in den Daten). */
const TC_EPC = `${NAMESPACES.tc}epc`;

/**
 * Alle Dokumentregeln eines Pods lesen. Public-readable, damit die Anzeige
 * fremder Pods (Dateibrowser) ohne Sonderrechte pruefen kann, was sie zeigen
 * darf.
 */
export async function getDocumentPolicies(pod: string): Promise<DocumentPolicy[]> {
  let ds;
  try {
    ds = await getSolidDataset(DOC_POLICY_DOC(pod), { fetch: getAuthFetch() });
  } catch {
    return []; // noch keine dokumentbezogene Regel in diesem Pod
  }

  const policies: DocumentPolicy[] = [];
  for (const thing of getThingAll(ds)) {
    const fileUrl = asUrl(thing);
    // Nur Subjekte, die tatsaechlich eine Regel tragen — das Dataset kann
    // auch andere Tripel enthalten (z.B. spaetere Erweiterungen).
    const rawRoleIris = getUrlAll(thing, TC_ALLOWS_ROLE);
    const restricted = getBoolean(thing, TC_RESTRICTED) === true;
    // Auf die Vorhandenheit einer Regel wird VOR der Normalisierung geprueft:
    // eine Policy mit ausschliesslich veralteten IRIs ist eine gesetzte Regel,
    // keine fehlende -- sie darf nicht als "nie festgelegt" durchgehen.
    if (rawRoleIris.length === 0 && !restricted) continue;
    policies.push({
      fileUrl,
      // "restricted, aber keine Rolle" ist eine echte Auswahl (niemand),
      // nicht die Abwesenheit einer Regel.
      roleIris: normalizeRoleIris(rawRoleIris),
      label: getStringNoLocale(thing, TC_DOC_LABEL),
      containerUrl: containerOf(fileUrl),
      epcs: getUrlAll(thing, TC_EPC),
    });
  }
  return policies;
}

/**
 * Ein Dokument im Pod, so wie die Verwaltung es zeigt: die Datei, ihr Vorgang
 * und die geltende Freigabe.
 */
export interface ManagedDocument {
  fileUrl: string;
  /** Dateiname, dekodiert. */
  name: string;
  /** Anzeigename aus der Regel, sonst der Dateiname. */
  label: string;
  containerUrl: string;
  /** Name des Vorgangscontainers, z.B. "VG-2026-0826-4f2a". */
  containerName: string;
  /** Rohe Auswahl der Dokumentregel; null = folgt der Pod-Freigabe. */
  roleIris: string[] | null;
  /** Wirksame Rollen nach Verschnitt mit der Pod-Freigabe. */
  effectiveRoleIris: string[];
  /** true = eine eigene Regel existiert. */
  hasOwnPolicy: boolean;
  epcs: string[];
}

/**
 * Verwaltungsdateien, die keine Sachdaten tragen und deshalb nicht einzeln
 * freigegeben werden. Sie beschreiben den Vorgang bzw. seine Bepreisung und
 * folgen dem Container.
 */
const NON_DOCUMENT_FILES = new Set(['process.ttl', 'pricing.ttl']);

/**
 * Alle freigebbaren Dokumente des eigenen Pods auflisten, mit ihrer geltenden
 * Freigabe.
 *
 * Quelle ist das Container-Listing unter data/ — nicht die Policy-Datei: Es
 * sollen auch Dokumente auftauchen, fuer die noch nie eine Regel vergeben
 * wurde (Altdaten, uebersprungene Abfrage). Genau die will der Nutzer
 * nachtraeglich regeln.
 */
export async function listManagedDocuments(webId: string): Promise<ManagedDocument[]> {
  const pod = podBaseFromWebId(webId);
  const [podAllowlist, policies] = await Promise.all([
    getAllowedRoles(pod),
    getDocumentPolicies(pod),
  ]);
  const policyByUrl = new Map(policies.map((p) => [p.fileUrl, p]));

  // Vorgangscontainer unter data/ auflisten.
  const dataRoot = `${pod}data/`;
  let containers: string[] = [];
  try {
    const ds = await getSolidDataset(dataRoot, { fetch: getAuthFetch() });
    const root = getThing(ds, dataRoot);
    containers = (root ? getUrlAll(root, LDP_CONTAINS) : []).filter((c) => c.endsWith('/'));
  } catch {
    containers = [];
  }

  const documents: ManagedDocument[] = [];
  await Promise.all(
    containers.map(async (containerUrl) => {
      let files: string[] = [];
      try {
        const ds = await getSolidDataset(containerUrl, { fetch: getAuthFetch() });
        const thing = getThing(ds, containerUrl);
        files = (thing ? getUrlAll(thing, LDP_CONTAINS) : []).filter((f) => !f.endsWith('/'));
      } catch (err) {
        console.warn('[access] Container nicht lesbar:', containerUrl, err);
        return;
      }

      for (const fileUrl of files) {
        const name = decodeSegment(fileUrl);
        if (NON_DOCUMENT_FILES.has(name)) continue;
        const policy = policyByUrl.get(fileUrl);
        documents.push({
          fileUrl,
          name,
          label: policy?.label ?? name,
          containerUrl,
          containerName: decodeSegment(containerUrl.replace(/\/$/, '')),
          roleIris: policy ? policy.roleIris : null,
          effectiveRoleIris: effectiveRolesForDocument(podAllowlist, policy?.roleIris ?? null),
          hasOwnPolicy: policy !== undefined,
          epcs: policy?.epcs ?? [],
        });
      }
    }),
  );

  // Neueste Vorgaenge zuerst; innerhalb eines Vorgangs nach Name.
  documents.sort(
    (a, b) =>
      b.containerName.localeCompare(a.containerName) || a.name.localeCompare(b.name),
  );
  return documents;
}

/** Letztes Pfadsegment einer URL, dekodiert. */
function decodeSegment(url: string): string {
  const segment = url.split('/').pop() || url;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Container einer Datei-URL: alles bis zum letzten Schraegstrich. */
function containerOf(fileUrl: string): string {
  const cut = fileUrl.lastIndexOf('/');
  return cut >= 0 ? fileUrl.slice(0, cut + 1) : fileUrl;
}

/**
 * Die WIRKSAMEN Rollen eines Dokuments: Schnittmenge aus Pod-Freigabe und
 * Dokumentauswahl.
 *
 * Ohne eigene Regel gilt die Pod-Freigabe unveraendert — Altdaten und Uploads,
 * bei denen der Nutzer die Frage uebersprungen hat, bleiben so sichtbar wie
 * bisher.
 */
export function effectiveRolesForDocument(
  podAllowlist: string[],
  docRoleIris: string[] | null | undefined,
): string[] {
  if (docRoleIris == null) return podAllowlist;
  const allowed = new Set(podAllowlist);
  return docRoleIris.filter((iri) => allowed.has(iri));
}

/**
 * Regeln fuer mehrere Dokumente schreiben und sofort in WAC durchsetzen.
 *
 * Reihenfolge ist wichtig: erst die Policy-Datei (die Wahrheit fuer die
 * Anzeige), dann die Ressourcen-ACLs, dann die Container-ACL als Vereinigung.
 * Bricht ein Schritt ab, ist die gespeicherte Regel strenger oder gleich
 * streng wie die durchgesetzte — nie umgekehrt.
 */
export async function setDocumentPolicies(
  webId: string,
  entries: {
    fileUrl: string;
    roleIris: string[];
    label?: string | null;
    /** Material-Idente des Dokuments; nur beim Upload bekannt. */
    epcs?: string[];
  }[],
): Promise<void> {
  if (entries.length === 0) return;
  const pod = podBaseFromWebId(webId);
  const podAllowlist = await getAllowedRoles(pod);

  // 1. doc-policy.ttl fortschreiben (bestehende Regeln anderer Dokumente
  //    bleiben stehen — setThing ersetzt nur das jeweilige Subjekt).
  let ds;
  try {
    ds = await getSolidDataset(DOC_POLICY_DOC(pod), { fetch: getAuthFetch() });
  } catch {
    ds = createSolidDataset();
  }
  for (const entry of entries) {
    // Was der Aufrufer nicht mitgibt, wird aus dem Bestand uebernommen: die
    // spaetere Bearbeitung in "Zugriff verwalten" kennt weder Idente noch
    // Bezeichnung und wuerde sie sonst beim Speichern loeschen.
    const previous = getThing(ds, entry.fileUrl);
    const epcs = entry.epcs ?? (previous ? getUrlAll(previous, TC_EPC) : []);
    const label =
      entry.label ?? (previous ? getStringNoLocale(previous, TC_DOC_LABEL) : null);

    const builder = buildThing(createThing({ url: entry.fileUrl }))
      // Immer gesetzt: unterscheidet "bewusst niemand" von "keine Regel".
      .addBoolean(TC_RESTRICTED, true);
    for (const iri of effectiveRolesForDocument(podAllowlist, entry.roleIris)) {
      builder.addUrl(TC_ALLOWS_ROLE, iri);
    }
    for (const epc of epcs) builder.addUrl(TC_EPC, epc);
    if (label) builder.addStringNoLocale(TC_DOC_LABEL, label);
    ds = setThing(ds, builder.build());
  }
  await saveSolidDatasetAt(DOC_POLICY_DOC(pod), ds, { fetch: getAuthFetch() });
  await stampPublicRead(DOC_POLICY_DOC(pod));

  // 2. Gruppendokumente der betroffenen Rollen muessen existieren, sonst
  //    zeigt die ACL auf eine leere Gruppe. setAllowedRoles materialisiert
  //    sie fuer die Pod-Liste; hier sind es nur Rollen DARAUS (Schnittmenge),
  //    also sind sie bereits vorhanden.

  // 3. Ressourcen-ACL je Dokument.
  for (const entry of entries) {
    const roles = effectiveRolesForDocument(podAllowlist, entry.roleIris);
    try {
      await stampResourceAcl(entry.fileUrl, webId, roles);
    } catch (err) {
      console.warn('[access] Dokument-ACL fehlgeschlagen:', entry.fileUrl, err);
    }
  }

  // 4. Container-ACL je betroffenem Container als Vereinigung nachziehen.
  const containers = new Set(entries.map((e) => containerOf(e.fileUrl)));
  for (const containerUrl of containers) {
    try {
      await restampContainerFromDocuments(containerUrl, webId, podAllowlist);
    } catch (err) {
      console.warn('[access] Container-ACL fehlgeschlagen:', containerUrl, err);
    }
  }

  // 5. EPCIS-Consent nachziehen: was im Pod nicht lesbar ist, soll auch nicht
  //    ueber die Ereignisabfrage herausfallen.
  try {
    await syncEpcisConsentFromDocuments(webId);
  } catch (err) {
    console.warn('[access] EPCIS-Consent konnte nicht nachgezogen werden:', err);
  }
}

/**
 * Die Container-ACL aus den Regeln seiner Dokumente neu bilden.
 *
 * Die Vereinigung ist Absicht: der Container muss fuer jede Rolle auflistbar
 * sein, die IRGENDEIN Dokument darin sehen darf — sonst kommt sie nicht bis
 * zur Datei. Die Trennung leistet die Ressourcen-ACL je Datei.
 *
 * Wichtig ist die Kehrseite: als acl:default darf NICHT die Vereinigung
 * gelten, sonst erbt eine kuenftige Datei ohne eigene Regel die weiteste
 * Freigabe. Default bleibt deshalb die Pod-Freigabe.
 */
async function restampContainerFromDocuments(
  containerUrl: string,
  ownerWebId: string,
  podAllowlist: string[],
): Promise<void> {
  const pod = podBaseFromUrl(containerUrl);
  const policies = await getDocumentPolicies(pod);
  const inContainer = policies.filter((p) => p.containerUrl === containerUrl);

  // Dateien ohne eigene Regel folgen der Pod-Freigabe -> diese ist Teil der
  // Vereinigung, sobald es im Container mindestens eine solche Datei gibt.
  // Das laesst sich hier nicht sicher feststellen (Listing kann fehlschlagen),
  // deshalb der konservative Weg: nur die tatsaechlich vergebenen Rollen.
  const union = new Set<string>();
  for (const policy of inContainer) {
    for (const iri of effectiveRolesForDocument(podAllowlist, policy.roleIris)) {
      union.add(iri);
    }
  }

  await stampContainerAcl(containerUrl, ownerWebId, Array.from(union), podAllowlist);
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
/** Ausdrueckliches "kein Zugriff" — entfernt ein zuvor erteiltes Recht. */
const NONE: Access = { read: false, append: false, write: false, control: false };

/**
 * Stamp a data container's ACL: owner gets full control, each allowed-role group
 * gets Read on the container AND as default (so children inherit). Applied with
 * both acl:accessTo and acl:default semantics.
 *
 * `defaultRoleIris` trennt zwei Fragen, die frueher dieselbe Antwort hatten:
 *   - wer darf DIESEN Container sehen und auflisten (accessTo) — bei
 *     dokumentweiser Freigabe die Vereinigung aller Dokumentregeln;
 *   - was erbt eine kuenftige Datei OHNE eigene Regel (default) — die
 *     Pod-Freigabe.
 * Ohne den Parameter bleibt es beim bisherigen Verhalten (beides gleich).
 */
export async function stampContainerAcl(
  containerUrl: string,
  ownerWebId: string,
  allowedRoleIris: string[],
  defaultRoleIris?: string[],
): Promise<void> {
  const pod = podBaseFromUrl(containerUrl);
  const { withAcl, acl: initialAcl } = await getEditableAcl(containerUrl);
  let acl = initialAcl;

  // Owner: full control on the container and as default for children
  acl = setAgentResourceAccess(acl, ownerWebId, FULL);
  acl = setAgentDefaultAccess(acl, ownerWebId, FULL);

  const defaults = defaultRoleIris ?? allowedRoleIris;

  // Jede Rolle, die hier ueberhaupt vorkommt, muss explizit gesetzt werden —
  // auch mit "kein Zugriff". Sonst bliebe ein frueher erteiltes Recht in der
  // ACL stehen, wenn eine Rolle spaeter entzogen wird.
  const touched = new Set([...allowedRoleIris, ...defaults]);
  for (const iri of touched) {
    const role = ROLES.find((r) => r.iri === iri);
    if (!role) continue;
    const groupUrl = GROUP_SUBJECT(pod, role.id);
    acl = setGroupResourceAccess(acl, groupUrl, allowedRoleIris.includes(iri) ? READ : NONE);
    acl = setGroupDefaultAccess(acl, groupUrl, defaults.includes(iri) ? READ : NONE);
  }

  await saveAclFor(withAcl, acl, { fetch: getAuthFetch() });
}

/**
 * Die ACL EINER Datei setzen: Owner voll, die freigegebenen Rollen lesend.
 *
 * Das ist die eigentliche Durchsetzung der dokumentweisen Freigabe. Eine
 * Ressource mit eigener ACL ignoriert den acl:default ihres Containers
 * vollstaendig — deshalb muss hier auch der Owner stehen, sonst sperrt sich
 * der Nutzer aus seinen eigenen Daten aus.
 *
 * Rollen, die NICHT freigegeben sind, werden ausdruecklich auf "kein Zugriff"
 * gesetzt statt nur weggelassen: nur so verschwindet ein zuvor erteiltes Recht
 * beim Nachschaerfen wirklich aus der ACL.
 */
export async function stampResourceAcl(
  resourceUrl: string,
  ownerWebId: string,
  allowedRoleIris: string[],
): Promise<void> {
  const pod = podBaseFromUrl(resourceUrl);
  const { withAcl, acl: initialAcl } = await getEditableAcl(resourceUrl);
  let acl = initialAcl;

  acl = setAgentResourceAccess(acl, ownerWebId, FULL);

  const allowed = new Set(allowedRoleIris);
  for (const role of ROLES) {
    const groupUrl = GROUP_SUBJECT(pod, role.id);
    acl = setGroupResourceAccess(acl, groupUrl, allowed.has(role.iri) ? READ : NONE);
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

/**
 * Die EPCIS-Freigabe aus den Dokumentregeln ableiten.
 *
 * Der Proxy (timberconnect-epcis, services/solid_rdf.py) liest je EPC: gibt es
 * einen ausdruecklichen Eintrag fuer diesen EPC, gilt der; sonst der
 * #default-Eintrag. Genau diese Struktur wird hier geschrieben:
 *   #default   -> Pod-Freigabe (Dokumente ohne eigene Regel)
 *   <epc>      -> Rollen des Dokuments, das diesen Ident traegt
 *
 * Beschreiben MEHRERE Dokumente denselben Ident, gilt die Schnittmenge ihrer
 * Rollen. Ein Ereignis nennt nur den Ident, nicht das Dokument — waere hier
 * die Vereinigung gesetzt, koennte das strengere Dokument ueber den Umweg des
 * Ereignisses doch noch gelesen werden.
 */
export async function syncEpcisConsentFromDocuments(webId: string): Promise<void> {
  const pod = podBaseFromWebId(webId);
  const podAllowlist = await getAllowedRoles(pod);
  const policies = await getDocumentPolicies(pod);

  // EPC -> Schnittmenge der Rollen aller Dokumente mit diesem Ident.
  const perEpc = new Map<string, Set<string>>();
  for (const policy of policies) {
    const roles = new Set(effectiveRolesForDocument(podAllowlist, policy.roleIris));
    for (const epc of policy.epcs) {
      const existing = perEpc.get(epc);
      if (!existing) {
        perEpc.set(epc, new Set(roles));
      } else {
        for (const iri of Array.from(existing)) {
          if (!roles.has(iri)) existing.delete(iri);
        }
      }
    }
  }

  let ds;
  try {
    ds = await getSolidDataset(EPCIS_CONSENT_DOC(pod), { fetch: getAuthFetch() });
  } catch {
    ds = createSolidDataset();
  }

  const fallback = buildThing(createThing({ url: CONSENT_DEFAULT_SUBJECT }));
  for (const iri of podAllowlist) fallback.addUrl(TC_ALLOWS_ROLE, iri);
  ds = setThing(ds, fallback.build());

  for (const [epc, roles] of perEpc) {
    // EPCs sind urn:-URIs; als Subjekt einer Thing-URL ist das zulaessig.
    const thing = buildThing(createThing({ url: epc }));
    for (const iri of roles) thing.addUrl(TC_ALLOWS_ROLE, iri);
    ds = setThing(ds, thing.build());
  }

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
