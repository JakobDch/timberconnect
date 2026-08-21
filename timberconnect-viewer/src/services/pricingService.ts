/**
 * Pricing Service for TimberConnect
 *
 * Preismodell der Token-Währung: 1 Datenpunkt (RDF-Triple) = 1 Token.
 *
 * Beim Upload wird die Datenpunktzahl jeder Datei einmalig berechnet
 * (Backend, rdflib) und als pricing.ttl NEBEN den Daten im Pod abgelegt —
 * inklusive Empfänger-WebID (der Uploader, nicht zwingend der Pod-Besitzer):
 *
 *   {pod}data/{traceId}/pricing.ttl:
 *     <fileUrl> a tc:DataOffer ;
 *       tc:datapointCount N ;
 *       tc:paymentRecipient <webId> .
 *
 * Beim Anzeigen fremder Daten wird daraus der Preis berechnet. Für
 * Alt-Dateien ohne pricing.ttl wird die Datei einmal geladen und die
 * Triples live gezählt (n3); Empfänger ist dann der Pod-Besitzer.
 */

import {
  getSolidDataset,
  createSolidDataset,
  getThing,
  setThing,
  buildThing,
  createThing,
  saveSolidDatasetAt,
  getInteger,
  getUrl,
} from '@inrupt/solid-client';
import { RDF } from '@inrupt/vocab-common-rdf';
import { Parser } from 'n3';
import { getAuthFetch } from './authFetch';
import { podBaseFromUrl, stampPublicRead } from './accessControlService';
import {
  queryDatapointKey,
  fileDatapointKey,
  splitOwnedKeys,
  recordPurchasedKeys,
} from './purchaseService';
import { NAMESPACES } from '../config/solidPods';

/** Preis pro Datenpunkt in Token. */
export const TOKENS_PER_DATAPOINT = 1;

const TC = NAMESPACES.tc;
const TC_DATA_OFFER = `${TC}DataOffer`;
const TC_DATAPOINT_COUNT = `${TC}datapointCount`;
const TC_PAYMENT_RECIPIENT = `${TC}paymentRecipient`;

export interface PricingEntry {
  fileUrl: string;
  datapoints: number;
  recipientWebId: string;
}

export interface SourceCost {
  sourceUrl: string;
  datapoints: number;
  tokens: number;
  recipientWebId: string;
}

export interface CostEstimate {
  /** Gesamtpreis in Token (nur fremde Quellen). */
  totalTokens: number;
  /** Kostenpflichtige fremde Quellen. */
  items: SourceCost[];
  /** Summe pro Empfänger (für den Transfer + die Anzeige). */
  byRecipient: { recipientWebId: string; tokens: number; datapoints: number }[];
  /** Datenpunkte aus eigenen Quellen (kostenlos). */
  ownDatapoints: number;
  /** Datenpunkte, die dieser Nutzer bereits früher gekauft hat (kostenlos). */
  alreadyOwnedDatapoints: number;
  /** Alle extrahierten Datenpunkte (neu + bereits gekauft + eigene). */
  totalDatapoints: number;
  /** Die jetzt erstmals gekauften Schlüssel — nach der Zahlung ins Kaufregister. */
  newKeys: string[];
}

/** Leere Schätzung mit allen Pflichtfeldern; einzelne Werte überschreibbar. */
const emptyEstimate = (over: Partial<CostEstimate> = {}): CostEstimate => ({
  totalTokens: 0,
  items: [],
  byRecipient: [],
  ownDatapoints: 0,
  alreadyOwnedDatapoints: 0,
  totalDatapoints: 0,
  newKeys: [],
  ...over,
});

/** pricing.ttl liegt als Geschwister-Ressource im selben Container wie die Datei. */
export function pricingDocForFile(fileUrl: string): string {
  return fileUrl.substring(0, fileUrl.lastIndexOf('/') + 1) + 'pricing.ttl';
}

// ---------------------------------------------------------------------------
// Schreiben (Upload-Flow)
// ---------------------------------------------------------------------------

/**
 * Preis-Metadaten für die hochgeladenen Dateien eines Containers schreiben.
 * Public-read, damit Interessenten den Preis sehen können, bevor sie zahlen.
 */
export async function writePricingDoc(containerUrl: string, entries: PricingEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const docUrl = `${containerUrl.endsWith('/') ? containerUrl : containerUrl + '/'}pricing.ttl`;

  let ds;
  try {
    ds = await getSolidDataset(docUrl, { fetch: getAuthFetch() });
  } catch {
    ds = createSolidDataset();
  }
  for (const entry of entries) {
    const thing = buildThing(createThing({ url: entry.fileUrl }))
      .addUrl(RDF.type, TC_DATA_OFFER)
      .addInteger(TC_DATAPOINT_COUNT, entry.datapoints)
      .addUrl(TC_PAYMENT_RECIPIENT, entry.recipientWebId)
      .build();
    ds = setThing(ds, thing);
  }
  await saveSolidDatasetAt(docUrl, ds, { fetch: getAuthFetch() });
  await stampPublicRead(docUrl);
}

// ---------------------------------------------------------------------------
// Lesen (Anzeige-Flow)
// ---------------------------------------------------------------------------

// Preise ändern sich nach dem Upload nicht mehr -> im Speicher cachen.
const priceCache = new Map<string, { datapoints: number; recipientWebId: string } | null>();

/** Fallback-Empfänger: der Besitzer des Pods, aus dem die Datei stammt. */
function fallbackRecipient(sourceUrl: string): string {
  return `${podBaseFromUrl(sourceUrl)}profile/card#me`;
}

/** Triples einer Turtle-Datei live zählen (Fallback für Alt-Daten ohne pricing.ttl). */
async function countTriplesLive(sourceUrl: string): Promise<number | null> {
  try {
    const response = await getAuthFetch()(sourceUrl, {
      headers: { Accept: 'text/turtle' },
    });
    if (!response.ok) return null;
    const text = await response.text();
    const quads = new Parser({ format: 'text/turtle' }).parse(text);
    return quads.length;
  } catch (e) {
    console.warn('[pricing] Live-Zählung fehlgeschlagen für', sourceUrl, e);
    return null;
  }
}

/**
 * Preis-Info für eine einzelne Quelle: erst pricing.ttl, dann Live-Zählung.
 * null, wenn die Quelle nicht bewertbar ist (dann wird sie kostenlos behandelt).
 */
export async function getSourcePrice(
  sourceUrl: string,
): Promise<{ datapoints: number; recipientWebId: string } | null> {
  if (priceCache.has(sourceUrl)) return priceCache.get(sourceUrl) ?? null;

  let result: { datapoints: number; recipientWebId: string } | null = null;

  // 1. pricing.ttl neben der Datei
  try {
    const ds = await getSolidDataset(pricingDocForFile(sourceUrl), { fetch: getAuthFetch() });
    const thing = getThing(ds, sourceUrl);
    if (thing) {
      const datapoints = getInteger(thing, TC_DATAPOINT_COUNT);
      if (datapoints !== null && datapoints >= 0) {
        result = {
          datapoints,
          recipientWebId: getUrl(thing, TC_PAYMENT_RECIPIENT) ?? fallbackRecipient(sourceUrl),
        };
      }
    }
  } catch {
    // kein pricing.ttl -> Fallback
  }

  // 2. Fallback: Datei laden und zählen
  if (!result) {
    const datapoints = await countTriplesLive(sourceUrl);
    if (datapoints !== null && datapoints > 0) {
      result = { datapoints, recipientWebId: fallbackRecipient(sourceUrl) };
    }
  }

  priceCache.set(sourceUrl, result);
  return result;
}

/**
 * Kosten für die Extraktion einer EINZELNEN Datei (Datei-Browser). Für
 * Rohdateien (XML/JSON) bestimmt die zugehörige RDF-Datei (gleicher Name,
 * Endung .ttl) die Datenpunktzahl — so wie beim Upload berechnet.
 *
 * Eine einmal bezahlte Datei ist dauerhaft freigeschaltet: der Schlüssel ist
 * die ROHE fileUrl, nicht die ttlUrl. Gekauft wird "diese Datei" — foo.pdf und
 * foo.ttl sind zwei Downloads und zwei Berechtigungen, auch wenn sie sich die
 * Preisquelle teilen.
 */
export async function estimateFileCost(
  fileUrl: string,
  ownWebId: string | null,
): Promise<CostEstimate> {
  const ttlUrl = fileUrl.endsWith('.ttl') ? fileUrl : fileUrl.replace(/\.[^./]+$/, '.ttl');
  const price = await getSourcePrice(ttlUrl);

  if (!price || price.datapoints === 0) {
    return emptyEstimate();
  }
  if (ownWebId && price.recipientWebId === ownWebId) {
    return emptyEstimate({
      ownDatapoints: price.datapoints,
      totalDatapoints: price.datapoints,
    });
  }

  // Kaufregister: schon einmal bezahlt -> kostenlos, kein Sheet.
  const key = fileDatapointKey(fileUrl);
  const { fresh } = await splitOwnedKeys(ownWebId, new Set([key]));
  if (fresh.length === 0) {
    return emptyEstimate({
      alreadyOwnedDatapoints: price.datapoints,
      totalDatapoints: price.datapoints,
    });
  }

  const tokens = price.datapoints * TOKENS_PER_DATAPOINT;
  return {
    totalTokens: tokens,
    items: [
      {
        sourceUrl: fileUrl,
        datapoints: price.datapoints,
        tokens,
        recipientWebId: price.recipientWebId,
      },
    ],
    byRecipient: [
      { recipientWebId: price.recipientWebId, tokens, datapoints: price.datapoints },
    ],
    ownDatapoints: 0,
    alreadyOwnedDatapoints: 0,
    totalDatapoints: price.datapoints,
    newKeys: [key],
  };
}

/**
 * Sammelt die Schlüssel der TATSÄCHLICH extrahierten Datenpunkte aus
 * SPARQL-Ergebnissen: jeder eindeutige gebundene Wert (Variable=Wert) zählt
 * einmal. Join-Duplikate über mehrere Zeilen/Abfragen werden dedupliziert,
 * damit niemand denselben Datenpunkt mehrfach bezahlt.
 *
 * Die Schlüssel sind über Sitzungen hinweg stabil und dienen sowohl der
 * Preisberechnung als auch dem Kaufregister (purchaseService).
 */
export function collectExtractedDatapoints(
  resultSets: Array<Array<Record<string, { value: string; type: string } | undefined>>>,
): Set<string> {
  const seen = new Set<string>();
  for (const rows of resultSets) {
    for (const row of rows) {
      for (const [variable, term] of Object.entries(row)) {
        if (term?.value !== undefined) seen.add(queryDatapointKey(variable, term.value));
      }
    }
  }
  return seen;
}

/** Anzahl der extrahierten Datenpunkte (Kurzform von collectExtractedDatapoints). */
export function countExtractedDatapoints(
  resultSets: Array<Array<Record<string, { value: string; type: string } | undefined>>>,
): number {
  return collectExtractedDatapoints(resultSets).size;
}

/**
 * Kosten für einen ABFRAGE-Abruf: bezahlt wird nur, was wirklich extrahiert
 * wurde UND noch nicht früher gekauft war — NICHT der Gesamtwert der
 * Quelldateien. Der volle Dateipreis gilt nur bei Komplett-Extraktion
 * (estimateFileCost).
 *
 * Verteilung auf die Empfänger: proportional zur Datenpunkt-Größe ihrer
 * beteiligten Quelldateien (bei einer Quelle: alles an deren Eigentümer).
 * Der Anteil eigener Quellen ist kostenlos.
 *
 * ACHTUNG beim Weiterentwickeln: newKeys enthält ALLE neuen Schlüssel, nicht
 * nur die "billable"-Teilmenge. Die billable/ownDatapoints-Aufteilung ist eine
 * Preis-Fiktion ("70 % dieses Extrakts ist fremd") — sie sagt NICHT, welche
 * Schlüssel fremd waren. Nur billable-viele einzutragen wäre willkürlich
 * (welche?) und würde den Rest beim nächsten Abruf erneut kassieren.
 */
export async function estimateExtractionCost(
  extractedKeys: Set<string>,
  sourceUrls: string[],
  ownWebId: string | null,
): Promise<CostEstimate> {
  const totalDatapoints = extractedKeys.size;
  if (totalDatapoints === 0) return emptyEstimate();

  // Kaufregister zuerst: was schon bezahlt ist, wird nicht erneut berechnet.
  // Steht bewusst VOR den Preisabfragen, damit der "alles-schon-gekauft"-Fall
  // ganz ohne Netz-I/O kurzschliesst.
  const { owned, fresh } = await splitOwnedKeys(ownWebId, extractedKeys);
  const base = {
    alreadyOwnedDatapoints: owned.length,
    totalDatapoints,
    newKeys: fresh,
  };
  if (fresh.length === 0) return emptyEstimate({ ...base, newKeys: [] });

  const prices = await Promise.all(
    sourceUrls.map(async (sourceUrl) => ({ sourceUrl, price: await getSourcePrice(sourceUrl) })),
  );
  const priced = prices.filter(
    (x): x is { sourceUrl: string; price: { datapoints: number; recipientWebId: string } } =>
      x.price !== null && x.price.datapoints > 0,
  );
  if (priced.length === 0) return emptyEstimate({ ...base, ownDatapoints: fresh.length });

  const foreign = priced.filter((x) => !(ownWebId && x.price.recipientWebId === ownWebId));
  const totalWeight = priced.reduce((sum, x) => sum + x.price.datapoints, 0);
  const foreignWeight = foreign.reduce((sum, x) => sum + x.price.datapoints, 0);
  if (foreign.length === 0 || foreignWeight === 0) {
    return emptyEstimate({ ...base, ownDatapoints: fresh.length });
  }

  // Kostenpflichtiger Anteil des Extrakts = Gewichtsanteil der fremden Quellen.
  // Bemessungsgrundlage sind nur die NEUEN Datenpunkte.
  const billable = Math.min(
    fresh.length,
    Math.max(1, Math.round((fresh.length * foreignWeight) / totalWeight)),
  );

  // Auf die fremden Quellen proportional verteilen (letzte Quelle = Rest,
  // damit die Summe exakt aufgeht).
  const items: SourceCost[] = [];
  let assigned = 0;
  foreign.forEach((x, i) => {
    const datapoints =
      i === foreign.length - 1
        ? billable - assigned
        : Math.round((billable * x.price.datapoints) / foreignWeight);
    assigned += datapoints;
    if (datapoints > 0) {
      items.push({
        sourceUrl: x.sourceUrl,
        datapoints,
        tokens: datapoints * TOKENS_PER_DATAPOINT,
        recipientWebId: x.price.recipientWebId,
      });
    }
  });

  const byRecipientMap = new Map<string, { tokens: number; datapoints: number }>();
  for (const item of items) {
    const agg = byRecipientMap.get(item.recipientWebId) ?? { tokens: 0, datapoints: 0 };
    agg.tokens += item.tokens;
    agg.datapoints += item.datapoints;
    byRecipientMap.set(item.recipientWebId, agg);
  }

  return {
    totalTokens: items.reduce((sum, i) => sum + i.tokens, 0),
    items,
    byRecipient: Array.from(byRecipientMap.entries()).map(([recipientWebId, agg]) => ({
      recipientWebId,
      ...agg,
    })),
    ownDatapoints: fresh.length - billable,
    ...base,
  };
}

/**
 * Nach einem erfolgreichen, bezahlten Abruf die gekauften Schlüssel ins
 * Kaufregister eintragen.
 *
 * Best effort mit Warnung: die Daten sind bereits bezahlt und werden angezeigt —
 * ein fehlgeschlagener Registereintrag darf das niemals blockieren. Folge eines
 * Fehlschlags ist lediglich, dass der Nutzer beim nächsten Mal erneut zahlt.
 */
export async function commitPurchase(
  webId: string | null,
  estimate: CostEstimate,
): Promise<void> {
  if (!webId || estimate.newKeys.length === 0) return;
  try {
    await recordPurchasedKeys(webId, estimate.newKeys);
  } catch (e) {
    console.warn('[purchases] Kaufregister konnte nicht geschrieben werden:', e);
  }
}
