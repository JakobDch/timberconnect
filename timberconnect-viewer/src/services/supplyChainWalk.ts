/**
 * Gerichtete Kettentraversierung ueber EPCIS-Ereignisse.
 *
 * Eine einzelne EPCIS-Abfrage reicht nicht: die BSP-Produktion ist ein
 * TransformationEvent (169 Lamellen rein, eine Platte raus), und die Lamellen
 * stammen ihrerseits aus einem TransformationEvent im Saegewerk (Staemme rein,
 * Lamellen raus). An den STAEMMEN haengen die Forstdaten -- Forstamt, Revier,
 * Einschlagdatum. Wer nur eine Stufe aufloest, endet bei den Lamellen.
 *
 * WARUM GERICHTET: Der Server matcht positionsunabhaengig (``MATCH_anyEPC``).
 * Fragt man nach einer Lamelle, kommen beide Ereignisse zurueck, in denen sie
 * vorkommt -- das, welches sie erzeugt hat, und das, welches sie verbraucht.
 * Ungerichtet laeuft der Walk deshalb von einer Lamelle ueber die Platte in
 * deren 168 andere Lamellen, also in fremde Chargen. Und inhaltlich waere es
 * falsch: die Platte gab es zum Zeitpunkt der Lamelle noch nicht.
 *
 * Die Richtung wird deshalb je Kante bestimmt (classifyEpcs) und ENTLANG DES
 * PFADES VERERBT: was upstream gefunden wurde, wird nur upstream weiterverfolgt.
 *
 * Dieser Dienst ist die gemeinsame Grundlage von Produktpass
 * (fetchProductDataByEpc) und Assistent (buildEpcScope). Vorher hatte nur der
 * Assistent eine mehrstufige Traversierung, der Produktpass loeste genau eine
 * Ebene auf -- er sah die Lamellen, aber nie den Wald.
 */

import {
  queryEpcisEvents,
  collectBizTransactions,
  classifyEpcs,
  type EpcisEvent,
} from './epcisService';

/**
 * Wie weit die Kette verfolgt wird.
 *
 *   self     nur der erfasste Ident -- keine Traversierung
 *   upstream der Ident und alles, WORAUS er entstanden ist (Herkunft)
 *   full     zusaetzlich, was AUS ihm entstanden ist (Verwendung)
 */
export type ChainScope = 'self' | 'upstream' | 'full';

/** Wie viele Verarbeitungsstufen verfolgt werden. */
export const MAX_CHAIN_DEPTH = 4;
/** Hoechstzahl EPCIS-Abfragen je Stufe -- Schutz gegen 169 Lamellen auf einmal. */
export const MAX_QUERIES_PER_LEVEL = 8;

export interface ChainWalkResult {
  events: EpcisEvent[];
  /** Nur die erste Stufe -- sie beschreibt das erfasste Bauteil. */
  eventsReturned: number;
  eventsFilteredOut: number;
  /** Alle erreichten Idente, einschliesslich des Startidents. */
  epcs: Set<string>;
  /** Idente, die WORAUS-Richtung erreichbar sind (ohne den Startident). */
  upstreamEpcs: Set<string>;
  /** Idente, die WAS-DARAUS-Richtung erreichbar sind. */
  downstreamEpcs: Set<string>;
  bizTxUrls: string[];
}

/**
 * Der GS1-Itemreference-Teil eines EPC (urn:epc:id:sgtin:GCP.ITEMREF.SERIAL).
 *
 * Er kennzeichnet die Produktart und damit die Verarbeitungsstufe: 0401 =
 * BSP-Platte, 0212 = Lamelle, 0100 = Stamm. Genau die richtige Koernung, um
 * pro Stufe einen Vertreter weiterzuverfolgen.
 */
export function itemRefOf(epc: string): string {
  return epc.split(':')[4]?.split('.')[1] ?? epc;
}

/** Ein noch abzuarbeitender Ident samt der Richtung, in der er gefunden wurde. */
interface FrontierEntry {
  epc: string;
  direction: 'upstream' | 'downstream';
}

/**
 * Die Lieferkette ab ``startEpc`` verfolgen.
 *
 * Zwei Begrenzungen halten den Aufwand im Rahmen:
 *   - je Stufe nur EIN Vertreter pro Produktart UND Richtung (itemRef). Alle
 *     169 Lamellen stammen aus demselben Vorgang; die 169. Abfrage liefert
 *     dieselben Pods wie die erste. Die Richtung gehoert in den Schluessel,
 *     sonst verdraengt ein Upstream-Fund den gleichartigen Downstream-Fund.
 *   - MAX_CHAIN_DEPTH Stufen. Die reale Kette (Platte -> Lamelle -> Stamm ->
 *     Saatgut) braucht vier.
 */
export async function walkChain(
  startEpc: string,
  scope: ChainScope = 'full',
  maxDepth: number = MAX_CHAIN_DEPTH,
): Promise<ChainWalkResult> {
  const epcs = new Set<string>([startEpc]);
  const upstreamEpcs = new Set<string>();
  const downstreamEpcs = new Set<string>();
  const bizTx = new Set<string>();
  const allEvents: EpcisEvent[] = [];
  const queried = new Set<string>();
  let eventsReturned = 0;
  let eventsFilteredOut = 0;

  // Der Startident wird in BEIDE Richtungen betrachtet; erst die gefundenen
  // Nachbarn tragen eine feste Richtung, die sie dann weitervererben.
  let frontier: FrontierEntry[] = [{ epc: startEpc, direction: 'upstream' }];
  if (scope === 'full') frontier.push({ epc: startEpc, direction: 'downstream' });

  // "self" fragt die erste Stufe trotzdem ab: die Ereignisse des erfassten
  // Idents tragen die Dokumentlinks (bizTransaction), ueber die die Pod-Quellen
  // gefunden werden. Ohne sie bliebe die Ansicht leer statt nur eng.
  const depthLimit = scope === 'self' ? 1 : maxDepth;

  for (let depth = 0; depth < depthLimit && frontier.length > 0; depth++) {
    const batch = frontier
      .filter((entry) => !queried.has(`${entry.epc}|${entry.direction}`))
      .slice(0, MAX_QUERIES_PER_LEVEL);
    if (batch.length === 0) break;

    const results = await Promise.all(
      batch.map(async (entry) => {
        queried.add(`${entry.epc}|${entry.direction}`);
        try {
          return { entry, result: await queryEpcisEvents(entry.epc) };
        } catch (err) {
          // Eine einzelne Stufe darf die Kette nicht abreissen lassen: die
          // bereits gefundenen Stufen bleiben gueltig.
          console.debug('[chain] EPCIS-Abfrage fehlgeschlagen für', entry.epc, err);
          return null;
        }
      }),
    );

    const discovered: FrontierEntry[] = [];
    for (const item of results) {
      if (!item) continue;
      const { entry, result } = item;
      // Nur die erste Stufe zaehlt fuer die Anzeige "N Ereignisse gefunden" --
      // sie beschreibt das gescannte Bauteil, nicht die halbe Lieferkette.
      if (depth === 0) {
        eventsReturned = result.returned;
        eventsFilteredOut = result.filteredOut;
      }
      allEvents.push(...result.events);
      for (const url of collectBizTransactions(result.events)) bizTx.add(url);

      // "self" sammelt keine Nachbarn ein -- nur die Ereignisse und ihre
      // Dokumentlinks. Die Ident-Menge bleibt der erfasste Ident allein.
      if (scope === 'self') continue;

      for (const event of result.events) {
        const classified = classifyEpcs(event, entry.epc);
        // Die Richtung des Pfades vererben: ein upstream erreichter Ident
        // wird nur weiter upstream verfolgt. Ohne diese Vererbung liefe der
        // Walk ueber Geschwisterknoten in fremde Chargen.
        const next =
          entry.direction === 'upstream' ? classified.upstream : classified.downstream;
        for (const found of next) {
          if (found === startEpc) continue;
          const target = entry.direction === 'upstream' ? upstreamEpcs : downstreamEpcs;
          target.add(found);
          if (!epcs.has(found)) discovered.push({ epc: found, direction: entry.direction });
          epcs.add(found);
        }
      }
    }

    // Je Produktart UND Richtung nur einen Vertreter weiterverfolgen.
    const byItemRef = new Map<string, FrontierEntry>();
    for (const found of discovered) {
      const key = `${itemRefOf(found.epc)}|${found.direction}`;
      if (!byItemRef.has(key)) byItemRef.set(key, found);
    }
    frontier = [...byItemRef.values()];
  }

  console.debug(
    `[chain] Scope "${scope}": ${epcs.size} EPCs über ${queried.size} Abfragen ` +
      `(${upstreamEpcs.size} upstream, ${downstreamEpcs.size} downstream), ` +
      `${bizTx.size} Dokumentlink(s)`,
  );

  return {
    events: allEvents,
    eventsReturned,
    eventsFilteredOut,
    epcs,
    upstreamEpcs,
    downstreamEpcs,
    bizTxUrls: [...bizTx],
  };
}
