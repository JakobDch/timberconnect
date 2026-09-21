/**
 * EPCIS Service Client (viewer side)
 *
 * Talks to the timberconnect-epcis authorizing proxy — never to EPCAT directly.
 * The proxy verifies our Solid identity, resolves our role, and returns only the
 * events the data owners have consented to share with that role.
 *
 * Requests go through the authenticated session fetch so the Solid-OIDC token is
 * attached for the proxy to verify.
 */

import { getAuthFetch } from './authFetch';
import { reportServiceQuery } from './dataspaceActivity';

// Same-origin path is proxied to the EPCIS service in dev (see vite.config.ts).
// Override with VITE_EPCIS_SERVICE_URL to point at an absolute service URL.
const EPCIS_BASE =
  import.meta.env.VITE_EPCIS_SERVICE_URL ||
  (typeof window !== 'undefined' ? `${window.location.origin}/api/epcis` : '/api/epcis');

/** Name des Knotens im Datenraum-Graphen — kein Host, sondern die Rolle. */
const EPCIS_ENDPOINT = 'EPCIS';

/** Mengenbehaftete Idente (LGTIN) stehen als epcClass in eigenen Listen. */
interface QuantityEntry {
  epcClass: string;
  quantity?: number;
  uom?: string;
}

export interface EpcisEvent {
  type?: string;
  eventTime?: string;
  bizStep?: string;
  epcList?: string[];
  quantityList?: QuantityEntry[];
  bizTransactionList?: Array<{ type?: string; bizTransaction?: string }>;
  // Die Listen des TransformationEvents. Sie liefen frueher nur ueber die
  // Index-Signatur unten -- jede Auswertung war damit eine Kette von
  // as-Casts ohne Compiler-Schutz, obwohl genau an diesen Feldern die
  // Materialrichtung haengt.
  inputEPCList?: string[];
  outputEPCList?: string[];
  inputQuantityList?: QuantityEntry[];
  outputQuantityList?: QuantityEntry[];
  // AggregationEvent. Wird heute von keinem Treiber erzeugt (siehe
  // classifyEpcs) und ist deshalb ungeprueft.
  childEPCs?: string[];
  parentID?: string;
  [key: string]: unknown;
}

/** Lage eines Idents relativ zum Bezugs-Ident. */
export type EpcDirection = 'upstream' | 'downstream' | 'sibling';

export interface ClassifiedEpcs {
  /** Vormaterial: woraus der Bezugs-Ident entstanden ist. */
  upstream: string[];
  /** Erzeugnis: was aus dem Bezugs-Ident entstanden ist. */
  downstream: string[];
  /** Gleiche Stufe bzw. Richtung nicht bestimmbar. */
  sibling: string[];
}

export interface EventQueryResult {
  events: EpcisEvent[];
  totalBeforeFilter: number;
  returned: number;
  filteredOut: number;
  callerWebId: string | null;
  callerRole: string | null;
  authEnforced: boolean;
}

/**
 * Query EPCIS events for an EPC (or all entitled events) through the proxy.
 * Returns only events the logged-in user's role is consented to receive.
 */
export async function queryEpcisEvents(
  epc?: string,
  params: Record<string, string> = {},
): Promise<EventQueryResult> {
  // Der EPCIS-Dienst ist im Datenraum-Graphen ein eigener Knoten: er steht am
  // Anfang jedes Scans und entscheidet, welche Pods ueberhaupt gefragt werden.
  reportServiceQuery(EPCIS_ENDPOINT, 'request');
  let response: Response;
  try {
    response = await getAuthFetch()(`${EPCIS_BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epc, params }),
    });
  } catch (err) {
    reportServiceQuery(EPCIS_ENDPOINT, 'miss');
    throw err;
  }

  if (!response.ok) {
    reportServiceQuery(EPCIS_ENDPOINT, 'miss');
    if (response.status === 401) {
      throw new Error('Nicht authentifiziert — bitte mit Solid Pod anmelden.');
    }
    if (response.status === 403) {
      throw new Error('Keine Rolle hinterlegt oder keine Berechtigung für EPCIS-Events.');
    }
    const detail = await response
      .json()
      .then((b) => b.detail)
      .catch(() => null);
    throw new Error(detail || `EPCIS-Abfrage fehlgeschlagen: ${response.status}`);
  }

  const body = await response.json();
  reportServiceQuery(EPCIS_ENDPOINT, (body.events ?? []).length > 0 ? 'hit' : 'miss');
  return {
    events: body.events ?? [],
    totalBeforeFilter: body.total_before_filter ?? 0,
    returned: body.returned ?? 0,
    filteredOut: body.filtered_out ?? 0,
    callerWebId: body.caller_web_id ?? null,
    callerRole: body.caller_role ?? null,
    authEnforced: body.auth_enforced ?? false,
  };
}

/**
 * Collect all EPCs referenced by a set of events. De-duplicated.
 *
 * Deckt ALLE Listen ab, in denen ein EPCIS-Event Idente fuehren kann --
 * insbesondere ``inputEPCList``/``outputEPCList`` der TransformationEvents.
 * Genau die fehlten hier lange, und das war folgenreich: die BSP-Produktion
 * ist als TransformationEvent modelliert (Lamellen rein, Platte raus). Ohne
 * die Input-Liste blieb die gesamte Vorkette unsichtbar -- der Assistent sah
 * am Panel zwar die ``derivedFrom``-Verweise auf die Lamellen, durfte sie aber
 * nicht abfragen, weil sie nicht als "verknuepft" galten.
 *
 * Entspricht damit ``epcs_of_event`` im EPCIS-Dienst
 * (services/epcat_query.py), das dieselben sechs Listen vereinigt. Zwei
 * Implementierungen derselben Regel -- laufen sie auseinander, sieht der
 * Viewer weniger als der Server erlaubt.
 */
export function collectEpcs(events: EpcisEvent[]): string[] {
  const epcs = new Set<string>();
  const listsOf = (ev: EpcisEvent) => [
    ev.epcList,
    ev.childEPCs,
    ev.inputEPCList,
    ev.outputEPCList,
  ];

  for (const ev of events) {
    for (const list of listsOf(ev)) {
      for (const e of (list as string[] | undefined) ?? []) epcs.add(e);
    }
    // Mengenbehaftete Idente (LGTIN) stehen als epcClass in eigenen Listen.
    for (const key of ['quantityList', 'inputQuantityList', 'outputQuantityList'] as const) {
      const list = ev[key] as Array<{ epcClass?: string }> | undefined;
      for (const q of list ?? []) if (q.epcClass) epcs.add(q.epcClass);
    }
  }
  return [...epcs];
}

/** Idente einer EPC-Liste + der zugehoerigen Mengenliste. */
function sideOf(list?: string[], quantities?: QuantityEntry[]): string[] {
  const out = [...(list ?? [])];
  for (const q of quantities ?? []) if (q.epcClass) out.push(q.epcClass);
  return out;
}

/**
 * Die Idente eines Ereignisses nach ihrer Lage ZUM BEZUGS-IDENT einteilen.
 *
 * WARUM RELATIV: Die Listenzugehoerigkeit allein sagt die Richtung nicht. Der
 * EPCIS-Server matcht positionsunabhaengig (``MATCH_anyEPC``) -- fragt man nach
 * einer Lamelle, kommen BEIDE Ereignisse zurueck, in denen sie vorkommt: das
 * Saegewerks-Ereignis, das sie erzeugt hat (sie steht im Output), und das
 * BSP-Ereignis, das sie verbraucht (sie steht im Input). Erst der Vergleich
 * mit dem Bezugs-Ident macht daraus eine Richtung:
 *
 *   Bezug im Output -> die Inputs sind sein Vormaterial   (upstream)
 *   Bezug im Input  -> die Outputs sind sein Erzeugnis    (downstream)
 *
 * Richtung ist damit eine Eigenschaft der KANTE, nicht des Idents. Sie laesst
 * sich aus einer flachen Ident-Menge (collectEpcs) nicht rekonstruieren.
 *
 * ObjectEvent traegt keine Richtung: seine Idente sind Geschwister auf
 * derselben Stufe (Erfassung, kein Materialfluss). Sie gelten als ``sibling``
 * und duerfen die Kette nicht weiter aufspannen -- sonst liefe der Walk von
 * einer Lamelle ueber ihre 168 Geschwister in fremde Chargen.
 *
 * AggregationEvent (parentID/childEPCs) wird von keinem Treiber erzeugt --
 * die BSP-Produktion ist bewusst als Transformation modelliert, weil aus den
 * Lamellen eine Platte WIRD und sie nicht darin enthalten sind. Die Regel ist
 * hier der Vollstaendigkeit halber umgesetzt (Behaelter = downstream, Inhalt =
 * upstream), aber mangels Daten ungeprueft.
 */
export function classifyEpcs(event: EpcisEvent, refEpc: string): ClassifiedEpcs {
  const empty: ClassifiedEpcs = { upstream: [], downstream: [], sibling: [] };

  const inputs = sideOf(event.inputEPCList, event.inputQuantityList);
  const outputs = sideOf(event.outputEPCList, event.outputQuantityList);

  if (inputs.length || outputs.length) {
    const inInput = inputs.includes(refEpc);
    const inOutput = outputs.includes(refEpc);
    // Beides waere ein Zyklus, keines heisst: das Ereignis kam ueber einen
    // ANDEREN Ident herein (moeglich, weil ein Walk mehrere Idente abfragt).
    // In beiden Faellen ist keine Aussage moeglich -- lieber nichts behaupten.
    if (inInput === inOutput) return { ...empty, sibling: [...inputs, ...outputs] };
    return inOutput
      ? { ...empty, upstream: inputs }
      : { ...empty, downstream: outputs };
  }

  const children = event.childEPCs ?? [];
  const parent = event.parentID;
  if (children.length || parent) {
    if (parent && parent === refEpc) return { ...empty, upstream: children };
    if (children.includes(refEpc)) {
      return { ...empty, downstream: parent ? [parent] : [] };
    }
    return { ...empty, sibling: [...children, ...(parent ? [parent] : [])] };
  }

  return { ...empty, sibling: sideOf(event.epcList, event.quantityList) };
}

/**
 * Collect the bizTransaction URLs from events. These map EPCIS namespaces back
 * to the Solid pod documents (the bridge), so they drive which pod sources to query.
 */
export function collectBizTransactions(events: EpcisEvent[]): string[] {
  const urls = new Set<string>();
  for (const ev of events) {
    for (const bt of ev.bizTransactionList ?? []) {
      if (bt.bizTransaction) urls.add(bt.bizTransaction);
    }
  }
  return [...urls];
}
