/**
 * Purchase Service for TimberConnect
 *
 * Kaufregister der Token-Währung: welche Datenpunkte hat dieser Nutzer schon
 * einmal bezahlt? Ohne dieses Register kostet derselbe Abruf jedes Mal aufs
 * Neue — auch für Daten, die man längst gekauft hat.
 *
 *   {pod}wallet/purchases.ttl -> #q-8f3a1c2d  tc:datapointKey "q:8f3a1c2d"
 *
 * Bewusst minimal: kein Betrag, kein Empfänger, keine Quell-URL. Das steht
 * bereits in transactions.ttl. Das Register beantwortet nur eine einzige Frage:
 * "besitze ich diesen Schlüssel?"
 *
 * Anders als wallet.ttl wird hier KEINE öffentliche ACL gestampt: das Wallet
 * ist nur deshalb public write, damit Fremde gutschreiben können. Das
 * Kaufregister liest und schreibt ausschliesslich der Besitzer — eine
 * öffentliche Liste aller Käufe wäre ein echtes Datenschutzleck. Es erbt die
 * Pod-Default-ACL, genau wie transactions.ttl.
 */

import {
  getSolidDataset,
  createSolidDataset,
  getThingAll,
  setThing,
  buildThing,
  createThing,
  saveSolidDatasetAt,
  getStringNoLocale,
  getUrl,
} from '@inrupt/solid-client';
import { RDF } from '@inrupt/vocab-common-rdf';
import { getAuthFetch } from './authFetch';
import { podBaseFromWebId } from './accessControlService';
import { NAMESPACES } from '../config/solidPods';

const TC = NAMESPACES.tc;
const TC_PURCHASED_DATAPOINT = `${TC}PurchasedDatapoint`;
const TC_DATAPOINT_KEY = `${TC}datapointKey`;
const TC_PURCHASED_AT = `${TC}purchasedAt`;

export const PURCHASES_DOC = (pod: string) => `${pod}wallet/purchases.ttl`;

/** Subjekt aus dem Schlüssel ableiten -> setThing ist idempotent, kein Duplikat. */
const subjectFor = (doc: string, key: string) => `${doc}#${key.replace(':', '-')}`;

// ---------------------------------------------------------------------------
// Schlüsselbildung
// ---------------------------------------------------------------------------

/**
 * FNV-1a (32 Bit): kurzer, stabiler Schlüssel-Hash. Bewusst KEIN
 * kryptographischer Hash — der Schlüssel ist kein Geheimnis, er muss nur kurz,
 * stabil und SYNCHRON berechenbar sein (crypto.subtle ist async und würde die
 * gesamte Aufrufkette async machen).
 *
 * Gehasht wird, weil die Werte häufig lange IRIs sind: roh gespeichert würde
 * purchases.ttl schnell in den Megabyte-Bereich wachsen.
 *
 * Kollisionen: 32 Bit über ~50.000 Schlüssel ergeben ca. 0,03 % — und die Folge
 * einer Kollision ist ein einzelner Datenpunkt gratis. Bei 1 Token irrelevant.
 */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Schlüssel eines Abfrage-Datenpunkts (ein eindeutiges Paar Variable=Wert).
 *
 * Der Schlüssel ist bewusst NICHT nach Quelle/Empfänger oder Produkt getrennt:
 *
 * - Nach Empfänger ist gar nicht korrekt umsetzbar: executeQuery übergibt alle
 *   Quellen gemeinsam an Comunica und flacht die Bindings ab — welcher Pod
 *   welches Binding geliefert hat, ist nicht rekonstruierbar. Ein geratener
 *   Empfänger wäre schlimmer als keiner: erreicht ein Scan einen Pod weniger,
 *   entstünde ein ANDERER Schlüssel und es würde erneut kassiert — genau der
 *   Fehler, den dieses Register behebt.
 * - Nach Produkt/traceId würde die Funktion aushebeln: Waldname, Holzart und
 *   Zertifikat-ID wiederholen sich über alle Produkte derselben Lieferkette.
 *   Der zweite Balken aus demselben Baum würde die Walddaten erneut kosten.
 *
 * Folge: das Register ist GROSSZÜGIG. Wer species=Fichte einmal gekauft hat,
 * besitzt es produktübergreifend. Das ist das gewünschte Verhalten ("das habe
 * ich doch schon gekauft") und irrt immer zugunsten des Nutzers.
 */
export const queryDatapointKey = (variable: string, value: string) =>
  `q:${fnv1a(`${variable}=${value}`)}`;

/**
 * Schlüssel einer komplett extrahierten Datei (Datei-Browser / Dokumente).
 *
 * Granularitäts-Asymmetrie zu queryDatapointKey ist beabsichtigt: eine Datei
 * ist EIN "f:"-Schlüssel im Wert von N Datenpunkten, ein Abfrage-Extrakt sind N
 * "q:"-Schlüssel à 1 Datenpunkt. Die Präfixe verhindern jede Interferenz. Wer
 * eine Datei komplett gekauft hat, besitzt damit NICHT die einzelnen
 * "q:"-Schlüssel ihres Inhalts — das würde erfordern, beim Kauf alle Triples zu
 * Schlüsseln zu materialisieren. Bewusst ausserhalb des Umfangs.
 */
export const fileDatapointKey = (fileUrl: string) => `f:${fnv1a(fileUrl)}`;

// ---------------------------------------------------------------------------
// Register lesen (Session-Cache)
// ---------------------------------------------------------------------------

// Gelesen wird einmal pro Sitzung, nicht pro Scan. Kein Logout-Hook nötig:
// der Logout macht window.location.reload(), das räumt alle Modul-Caches ab.
let cache: { webId: string; keys: Set<string> } | null = null;
let inflight: { webId: string; promise: Promise<Set<string>> } | null = null;

async function fetchPurchasedKeys(webId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const ds = await getSolidDataset(PURCHASES_DOC(podBaseFromWebId(webId)), {
      fetch: getAuthFetch(),
    });
    for (const thing of getThingAll(ds)) {
      if (getUrl(thing, RDF.type) !== TC_PURCHASED_DATAPOINT) continue;
      const key = getStringNoLocale(thing, TC_DATAPOINT_KEY);
      if (key) keys.add(key);
    }
    console.debug(`[purchases] ${keys.size} bereits gekaufte Datenpunkte geladen`);
  } catch {
    // 404 -> noch nie etwas gekauft. Netzfehler -> siehe loadPurchasedKeys.
  }
  return keys;
}

/**
 * Alle bereits gekauften Schlüssel des Nutzers.
 *
 * WIRFT NIEMALS. Ein Lesefehler ergibt ein leeres Set, damit ein kaputtes
 * Register zu "alles berechnen" degradiert und nicht zu "alles verschenken":
 * App.tsx faengt Fehler der Kostenberechnung ab und zeigt die Daten dann gratis.
 */
export async function loadPurchasedKeys(webId: string): Promise<Set<string>> {
  if (cache?.webId === webId) return cache.keys;
  // Entschärft den Wettlauf beim ersten Render, wenn mehrere Kostenschätzungen
  // gleichzeitig starten.
  if (inflight?.webId === webId) return inflight.promise;

  const promise = fetchPurchasedKeys(webId).then((keys) => {
    cache = { webId, keys };
    inflight = null;
    return keys;
  });
  inflight = { webId, promise };
  return promise;
}

/**
 * Angefragte Schlüssel aufteilen: was ist bereits gekauft, was ist neu?
 * Total — wirft nie, damit die Kostenberechnung nicht wegen des Registers
 * scheitert. Ohne Anmeldung gilt alles als neu (kein Pod, kein Register).
 */
export async function splitOwnedKeys(
  webId: string | null,
  keys: Set<string>,
): Promise<{ owned: string[]; fresh: string[] }> {
  if (!webId) return { owned: [], fresh: [...keys] };

  const purchased = await loadPurchasedKeys(webId);
  const owned: string[] = [];
  const fresh: string[] = [];
  for (const key of keys) {
    (purchased.has(key) ? owned : fresh).push(key);
  }
  return { owned, fresh };
}

// ---------------------------------------------------------------------------
// Register schreiben
// ---------------------------------------------------------------------------

/**
 * Gekaufte Schlüssel dauerhaft eintragen. Liest vor dem Schreiben neu ein statt
 * dem Session-Cache zu vertrauen — der einzige Ort, wo ein Lost Update bei zwei
 * offenen Tabs zählt. Der zusätzliche GET ist gegenüber den Wallet-Roundtrips
 * in payForData vernachlässigbar.
 */
export async function recordPurchasedKeys(webId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const doc = PURCHASES_DOC(podBaseFromWebId(webId));

  let ds;
  try {
    ds = await getSolidDataset(doc, { fetch: getAuthFetch() });
  } catch {
    ds = createSolidDataset();
  }

  const now = new Date();
  for (const key of keys) {
    const thing = buildThing(createThing({ url: subjectFor(doc, key) }))
      .addUrl(RDF.type, TC_PURCHASED_DATAPOINT)
      .addStringNoLocale(TC_DATAPOINT_KEY, key)
      .addDatetime(TC_PURCHASED_AT, now)
      .build();
    ds = setThing(ds, thing);
  }
  await saveSolidDatasetAt(doc, ds, { fetch: getAuthFetch() });

  // Cache direkt mitziehen — wir sind der einzige Schreiber, kein Refetch nötig.
  if (cache?.webId === webId) {
    for (const key of keys) cache.keys.add(key);
  }
}

/** Nur für Tests / defensives Zurücksetzen (Logout lädt die Seite ohnehin neu). */
export function resetPurchaseCache(): void {
  cache = null;
  inflight = null;
}
