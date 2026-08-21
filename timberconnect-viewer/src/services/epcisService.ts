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

// Same-origin path is proxied to the EPCIS service in dev (see vite.config.ts).
// Override with VITE_EPCIS_SERVICE_URL to point at an absolute service URL.
const EPCIS_BASE =
  import.meta.env.VITE_EPCIS_SERVICE_URL ||
  (typeof window !== 'undefined' ? `${window.location.origin}/api/epcis` : '/api/epcis');

export interface EpcisEvent {
  type?: string;
  eventTime?: string;
  bizStep?: string;
  epcList?: string[];
  quantityList?: Array<{ epcClass: string; quantity?: number; uom?: string }>;
  bizTransactionList?: Array<{ type?: string; bizTransaction?: string }>;
  [key: string]: unknown;
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
  const response = await getAuthFetch()(`${EPCIS_BASE}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ epc, params }),
  });

  if (!response.ok) {
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
