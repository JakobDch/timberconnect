/**
 * Katalogeintraege im EIGENEN Pod schreiben (DCAT).
 *
 * Warum clientseitig und nicht ueber das Converter-Backend:
 *
 * Der Datenkatalog-Dienst ist ein LESER. `GET /api/datasets?webId=...` holt
 * sich `<pod>/catalog/cat.ttl` und folgt von dort den Datensaetzen — er fuehrt
 * keinen eigenen Bestand. Fuer Schreiboperationen sagt seine API das
 * ausdruecklich: PUT/DELETE antworten mit "Write operations are client side".
 *
 * Der Weg ueber `POST /api/datasets` braucht ein Service-Konto, das sich
 * stellvertretend anmeldet. Das ist unnoetig: Der angemeldete Nutzer hat
 * Schreibrechte in seinem eigenen Pod ohnehin — er kann den Eintrag direkt
 * anlegen. Das ist auch das ehrlichere Modell, weil der Eigentuemer selbst
 * schreibt und nicht ein Dienst in seinem Namen.
 *
 * Erzeugt werden pro Datensatz drei Ressourcen, im Format der bestehenden
 * Kataloge im Dataspace (Vorbild: .../epcisrepository/catalog/):
 *
 *   catalog/ds/<uuid>.ttl        der Datensatz (dcat:Dataset + Distribution)
 *   catalog/records/<uuid>.ttl   Katalog-Record + Aenderungsprotokoll
 *   catalog/cat.ttl              der Katalog, der beide verlinkt
 *
 * Die Funktionen sind defensiv: ein Fehler beim Katalogeintrag darf den
 * Upload nicht scheitern lassen — die Datei liegt dann im Pod, ist nur noch
 * nicht auffindbar. Sie melden das Problem an den Aufrufer, werfen aber nicht.
 */

import { podBaseFromWebId } from './accessControlService';

const DCAT = 'http://www.w3.org/ns/dcat#';
const DCTERMS = 'http://purl.org/dc/terms/';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const VCARD = 'http://www.w3.org/2006/vcard/ns#';
const FOAF = 'http://xmlns.com/foaf/0.1/';
const SDM = 'https://w3id.org/solid-dataspace-manager#';
const THEME_BASE = 'https://w3id.org/solid-dataspace-manager/theme/';

export interface CatalogEntryInput {
  /** WebID des Pod-Eigentuemers (= des angemeldeten Nutzers). */
  ownerWebId: string;
  /** Anzeigename, z.B. "Stammzertifikat - a1b2c3". */
  title: string;
  description: string;
  /** URL der materialisierten TTL im Pod — das eigentliche Datenangebot. */
  downloadUrl: string;
  /** URL des Originaldokuments, sofern vorhanden. */
  rawUrl?: string | null;
  /** Anzeigename des Publizierenden. */
  publisher?: string | null;
  /** dcat:theme-Slug, z.B. "forstwirtschaft". */
  theme?: string | null;
  mediaType?: string;
}

export interface CatalogWriteResult {
  ok: boolean;
  /** UUID des angelegten Datensatzes. */
  identifier?: string;
  /** URL der Datensatz-Ressource. */
  datasetUrl?: string;
  /** Grund des Scheiterns, sonst null. */
  error: string | null;
}

/** Turtle-Literal escapen. */
function lit(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/** Themen-Slug aus einem freien Text (Ontologie kennt nur kleine Slugs). */
function themeSlug(theme: string | null | undefined): string {
  if (!theme) return 'timber';
  return theme
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'timber';
}

async function readTurtle(
  fetchFn: typeof fetch,
  url: string,
): Promise<string | null> {
  try {
    const response = await fetchFn(url, { headers: { Accept: 'text/turtle' } });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function putTurtle(
  fetchFn: typeof fetch,
  url: string,
  body: string,
): Promise<void> {
  const response = await fetchFn(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body,
  });
  if (!response.ok) {
    throw new Error(`PUT ${url} → HTTP ${response.status}`);
  }
}

/**
 * Den Katalog-Container oeffentlich lesbar machen.
 *
 * Notwendig, weil der Katalog-Dienst `cat.ttl` OHNE Anmeldung liest: er
 * beantwortet `GET /api/datasets?webId=...` fuer beliebige Abfragende. Bleibt
 * der Container privat, scheitert er mit HTTP 401 — der Pod waere im Dataspace
 * registriert, sein Angebot aber unsichtbar.
 *
 * Oeffentlich ist hier nur der KATALOG, also die Beschreibung dessen, was es
 * gibt. Die Daten selbst liegen unter data/ und behalten ihre eigenen Rechte;
 * wer sie abrufen will, muss weiterhin berechtigt sein.
 */
async function ensureCatalogReadable(
  fetchFn: typeof fetch,
  catalogUrl: string,
): Promise<void> {
  const aclUrl = `${catalogUrl}.acl`;
  const existing = await readTurtle(fetchFn, aclUrl);
  if (existing && existing.includes('foaf:Agent')) return; // schon offen

  const acl = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.

# Der Eigentuemer behaelt volle Kontrolle.
<#owner> a acl:Authorization ;
    acl:agent <${catalogUrl.replace(/catalog\/$/, 'profile/card#me')}> ;
    acl:accessTo <${catalogUrl}> ;
    acl:default <${catalogUrl}> ;
    acl:mode acl:Read, acl:Write, acl:Control .

# Der Katalog ist das Schaufenster: er muss ohne Anmeldung lesbar sein,
# sonst findet der Datenkatalog-Dienst das Angebot dieses Pods nicht.
<#public> a acl:Authorization ;
    acl:agentClass foaf:Agent ;
    acl:accessTo <${catalogUrl}> ;
    acl:default <${catalogUrl}> ;
    acl:mode acl:Read .
`;
  await putTurtle(fetchFn, aclUrl, acl);
}

/** Container anlegen, falls er fehlt (CSS legt sie beim PUT meist mit an). */
async function ensureContainer(fetchFn: typeof fetch, url: string): Promise<void> {
  try {
    const response = await fetchFn(url, { method: 'HEAD' });
    if (response.ok) return;
  } catch {
    /* weiter: anlegen versuchen */
  }
  try {
    await fetchFn(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle', Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' },
    });
  } catch {
    /* Wenn das scheitert, faellt es beim eigentlichen PUT auf. */
  }
}

/**
 * Die Datensatz-Ressource (dcat:Dataset + Distribution).
 *
 * Relative Fragmente wie in den bestehenden Katalogen: #it ist der Datensatz,
 * #dist die Distribution, #contact der Ansprechpartner.
 */
function datasetTurtle(
  input: CatalogEntryInput,
  uuid: string,
  datasetUrl: string,
  now: string,
): string {
  const publisher = input.publisher || 'TimberConnect';
  const mediaType = input.mediaType || 'text/turtle';
  return `@prefix dcat: <${DCAT}>.
@prefix dcterms: <${DCTERMS}>.
@prefix vcard: <${VCARD}>.
@prefix xsd: <${XSD}>.

<${datasetUrl}#contact> vcard:fn "${lit(publisher)}" .

<${datasetUrl}#dist> a dcat:Distribution ;
    dcat:downloadURL <${input.downloadUrl}> ;
    dcat:mediaType "${lit(mediaType)}" .

<${datasetUrl}#it> a dcat:Dataset ;
    dcterms:identifier "${uuid}" ;
    dcterms:title "${lit(input.title)}" ;
    dcterms:description "${lit(input.description)}" ;
    dcterms:issued "${now}"^^xsd:dateTime ;
    dcterms:modified "${now}"^^xsd:dateTime ;
    dcterms:publisher "${lit(publisher)}" ;
    dcterms:creator <${input.ownerWebId}> ;
    dcat:theme <${THEME_BASE}${themeSlug(input.theme)}> ;
    dcterms:accessRights "public" ;
    dcat:contactPoint <${datasetUrl}#contact> ;
    dcat:distribution <${datasetUrl}#dist> .
${input.rawUrl ? `\n# Das Originaldokument als Quellenangabe, NICHT als zweite Distribution:\n# die Katalog-Shape laesst genau eine dcat:distribution zu (sh:maxCount 1).\n<${datasetUrl}#it> dcterms:source <${input.rawUrl}> .\n` : ''}`;
}

/** Katalog-Record mit Aenderungsprotokoll. */
function recordTurtle(recordUrl: string, datasetUrl: string, now: string, stamp: number): string {
  return `@prefix dcat: <${DCAT}>.
@prefix dcterms: <${DCTERMS}>.
@prefix foaf: <${FOAF}>.
@prefix sdm: <${SDM}>.
@prefix xsd: <${XSD}>.

<${recordUrl}#change-${stamp}> a sdm:ChangeEvent ;
    dcterms:modified "${now}"^^xsd:dateTime ;
    dcterms:description "Dataset registered by TimberConnect." .

<${recordUrl}#desc> a dcat:CatalogRecord ;
    dcterms:title "Dataset description record" ;
    dcterms:description "Catalog record for dataset metadata." ;
    foaf:primaryTopic <${datasetUrl}> ;
    dcterms:modified "${now}"^^xsd:dateTime ;
    sdm:changeLog <${recordUrl}#change-${stamp}> .
`;
}

/**
 * cat.ttl fortschreiben: den neuen Datensatz an den bestehenden Katalog
 * anhaengen (oder ihn anlegen, wenn es noch keinen gibt).
 *
 * Bewusst textuell und nicht ueber einen RDF-Parser: cat.ttl ist eine flache
 * Aufzaehlung, und ein vollstaendiges Parsen/Serialisieren wuerde die
 * Formatierung der bestehenden Datei zerschreiben — die andere Werkzeuge im
 * Dataspace ebenfalls anfassen.
 */
function mergeCatalog(
  existing: string | null,
  catalogUrl: string,
  ownerWebId: string,
  publisher: string,
  uuid: string,
  now: string,
): string {
  const dsRef = `<ds/${uuid}.ttl#it>`;
  const recRef = `<${catalogUrl}records/${uuid}.ttl#desc>`;

  if (existing && existing.includes('dcat:Catalog')) {
    if (existing.includes(`ds/${uuid}.ttl#it`)) return existing; // schon drin
    let out = existing;
    // An die bestehende dcat:dataset-Liste anhaengen (endet auf " .").
    out = out.replace(
      /(dcat:dataset\s+(?:[^.]|\n)*?)\s*\.\s*(\n|$)/,
      (_m, list: string, tail: string) => `${list} ,\n    ${dsRef} .${tail}`,
    );
    if (out.includes('dcat:record')) {
      out = out.replace(
        /(dcat:record\s+(?:[^.]|\n)*?)\s*\.\s*(\n|$)/,
        (_m, list: string, tail: string) => `${list} ,\n    ${recRef} .${tail}`,
      );
    } else {
      out += `\n<#it> dcat:record\n    ${recRef} .\n`;
    }
    // Änderungszeitpunkt aktualisieren.
    out = out.replace(
      /dcterms:modified\s+"[^"]*"\^\^xsd:dateTime/,
      `dcterms:modified "${now}"^^xsd:dateTime`,
    );
    return out;
  }

  return `@prefix dcat: <${DCAT}>.
@prefix dcterms: <${DCTERMS}>.
@prefix xsd: <${XSD}>.

<#it> a dcat:Catalog ;
  dcterms:title "${lit(publisher)}'s Catalog" ;
  dcterms:modified "${now}"^^xsd:dateTime ;
  dcat:contactPoint <${ownerWebId}> ;
  dcat:dataset
    ${dsRef} .

<#it> dcat:record
    ${recRef} .
`;
}

/**
 * Einen Datensatz im Katalog des eigenen Pods registrieren.
 *
 * @returns Ergebnis mit UUID; bei Misserfolg `ok: false` samt Grund. Wirft nie.
 */
export async function registerDatasetInOwnPod(
  fetchFn: typeof fetch,
  input: CatalogEntryInput,
): Promise<CatalogWriteResult> {
  try {
    const podBase = podBaseFromWebId(input.ownerWebId);
    if (!podBase) {
      return { ok: false, error: 'Pod-Basis konnte nicht aus der WebID abgeleitet werden.' };
    }
    const catalogUrl = `${podBase}catalog/`;
    const uuid = crypto.randomUUID();
    const datasetUrl = `${catalogUrl}ds/${uuid}.ttl`;
    const recordUrl = `${catalogUrl}records/${uuid}.ttl`;
    const now = new Date().toISOString();
    const stamp = Date.now();

    await ensureContainer(fetchFn, catalogUrl);
    await ensureContainer(fetchFn, `${catalogUrl}ds/`);
    await ensureContainer(fetchFn, `${catalogUrl}records/`);

    await putTurtle(fetchFn, datasetUrl, datasetTurtle(input, uuid, datasetUrl, now));
    await putTurtle(fetchFn, recordUrl, recordTurtle(recordUrl, datasetUrl, now, stamp));

    const catFile = `${catalogUrl}cat.ttl`;
    const existing = await readTurtle(fetchFn, catFile);
    await putTurtle(
      fetchFn,
      catFile,
      mergeCatalog(
        existing,
        catalogUrl,
        input.ownerWebId,
        input.publisher || 'TimberConnect',
        uuid,
        now,
      ),
    );

    // Zuletzt: der Katalog muss ohne Anmeldung lesbar sein. Ein Fehler hier
    // macht die Eintraege nicht ungueltig, nur (noch) nicht auffindbar.
    try {
      await ensureCatalogReadable(fetchFn, catalogUrl);
    } catch (err) {
      console.warn('[catalog] ACL konnte nicht gesetzt werden:', err);
    }

    return { ok: true, identifier: uuid, datasetUrl, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[catalog] Registrierung im eigenen Pod fehlgeschlagen:', message);
    return { ok: false, error: message };
  }
}
