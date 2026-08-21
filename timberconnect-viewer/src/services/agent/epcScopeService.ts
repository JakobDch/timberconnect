/**
 * EPC-Scope: welche Quellen darf der Assistent ueberhaupt sehen?
 *
 * Anforderung an den Anwendungsfall: es duerfen nur Daten herauskommen, die
 * ueber EPCIS-Events am gescannten EPC haengen. Das wird hier STRUKTURELL
 * geloest statt nachtraeglich geprueft -- ein Freitext-Satz laesst sich nicht
 * zuverlaessig auf seine Herkunft zurueckrechnen, eine Mengenzugehoerigkeit
 * schon.
 *
 * Der Scope ist die eine Wahrheit darueber, was "zu diesem Bauteil gehoert":
 *
 *   scope.sources      -> die einzigen Dokumente, die Comunica je zu sehen bekommt
 *   scope.relatedEpcs  -> die EPCs, auf die sich eine Abfrage beziehen darf
 *
 * Beide Begrenzungen sind noetig und keine ist doppelt gemoppelt:
 * ``sources`` begrenzt die DATEIEN, ``relatedEpcs`` die SUBJEKTE darin. Eine
 * Saegewerks-Datei, die ueber eine bizTransaction an diesem EPC haengt, kann
 * daneben weitere Chargen fuehren -- die Dateiliste allein wuerde die
 * mitliefern.
 *
 * Die Ableitung der Quellen ist bewusst dieselbe wie in fetchProductDataByEpc
 * (sparqlService.ts): dieselben EPCIS-Events, dieselben bizTransaction-Links,
 * derselbe Rollen- und Erreichbarkeitsfilter. Zwei Herleitungen wuerden
 * auseinanderlaufen, und dann zeigte der Produktpass etwas anderes als der
 * Assistent.
 */

import {
  queryEpcisEvents,
  collectEpcs,
  collectBizTransactions,
  type EpcisEvent,
} from '../epcisService';
import {
  sourcesFromBizTransactions,
  filterAvailableSources,
  executeQuery,
} from '../sparqlService';
import { isEpc } from '../sparqlQueries';
import { filterSourcesByRole } from '../accessControlService';
import { getCurrentRole } from '../authFetch';
import { getAllProductsAsync, NAMESPACES } from '../../config/solidPods';

export interface EpcScope {
  /** Der gescannte EPC -- der Bezugspunkt fuer alles Weitere. */
  epc: string;
  /**
   * Alle EPCs, die ueber Events mit dem gescannten verknuepft sind
   * (einschliesslich des gescannten selbst). Eine Abfrage muss sich auf
   * mindestens einen davon beziehen.
   */
  relatedEpcs: Set<string>;
  /** Die einzigen Quellen, die abgefragt werden duerfen (rollengefiltert, erreichbar). */
  sources: string[];
  /** Die (bereits consent-gefilterten) Events -- Grundlage von get_related_epcs. */
  events: EpcisEvent[];
  eventsReturned: number;
  eventsFilteredOut: number;
  /**
   * True, wenn die Eingrenzung auf EPC-verknuepfte Quellen NICHT gelungen ist
   * und ersatzweise der ganze Katalog offensteht.
   *
   * Muss in der Oberflaeche sichtbar werden: in diesem Zustand kann eine
   * Antwort Daten anderer Bauteile enthalten. Lieber ehrlich degradieren als
   * still das Versprechen brechen -- oder den Assistenten totzustellen.
   */
  degraded: boolean;
  /** Menschenlesbare Hinweise fuer die Oberflaeche (Warnbanner). */
  notes: string[];
}

/**
 * Baut den Scope zu einem gescannten EPC.
 *
 * WIRFT NICHT bei fehlenden EPCIS-Events: ohne Events gibt es zwar keine
 * Verknuepfung, aber ein toter Assistent hilft niemandem. Stattdessen wird
 * degradiert (siehe ``degraded``) und der Grund in ``notes`` benannt.
 */
export async function buildEpcScope(epc: string): Promise<EpcScope> {
  const notes: string[] = [];

  // 1. Events beim (rollen- und consent-pruefenden) EPCIS-Proxy holen.
  //
  //    Nur fuer echte GS1-Idente. Eine Trace-Id (TC-2024-001) kennt EPCIS
  //    nicht -- die Abfrage liefe ins Leere und der Scope bliebe leer,
  //    obwohl die Daten ueber den Katalog sauber auffindbar sind.
  let events: EpcisEvent[] = [];
  let eventsReturned = 0;
  let eventsFilteredOut = 0;
  let relatedEpcs = new Set<string>([epc]);
  let bizTxUrls: string[] = [];
  const isGs1 = isEpc(epc);

  if (isGs1) {
    try {
      const walk = await walkSupplyChain(epc);
      events = walk.events;
      eventsReturned = walk.eventsReturned;
      eventsFilteredOut = walk.eventsFilteredOut;
      relatedEpcs = walk.epcs;
      bizTxUrls = walk.bizTxUrls;
    } catch (err) {
      notes.push(
        err instanceof Error
          ? `EPCIS-Abfrage fehlgeschlagen: ${err.message}`
          : 'EPCIS-Abfrage fehlgeschlagen.',
      );
    }
  }

  // 3. Quellen aus den bizTransaction-Links. Diese sind der einzige BELEGTE
  //    Zusammenhang zwischen EPC und Dokument -- alles andere ist Vermutung.
  const guessed = sourcesFromBizTransactions(bizTxUrls);
  const sourceSet = new Set<string>(guessed);

  // 4. Katalogquellen: was gehoert belegbar zu diesem Bauteil, was ist nur
  //    Kandidat?
  //
  //    Unterschied zu fetchProductDataByEpc, und zwar mit Absicht: dort wird
  //    der ganze Katalog dazugenommen. Fuer den Produktpass ist das vertretbar
  //    -- seine Abfragen filtern in der Datei auf die Trace-Id. Ein frei
  //    formulierender Agent hat diese Schranke nicht: er koennte schlicht
  //    "SELECT ?s ?p ?o" schreiben und bekaeme die Platte eines fremden
  //    Unternehmens.
  //
  //    Ueber die Id laesst sich der Bezug NICHT herstellen. ``product.id`` ist
  //    eine Trace-Id oder ein Doc-Hash, ``relatedEpcs`` enthaelt GS1-Idente --
  //    zwei Welten, die sich nicht vergleichen lassen. Und die
  //    bizTransaction-Links helfen hier auch nicht: der EPCIS-Treiber setzt
  //    als Transaktions-Id die VORGANGSNUMMER aus dem Formular
  //    (z.B. "VA-2026-0806-114_EN_16351"), waehrend der Container nach dem
  //    PDF-Hash benannt ist. Die daraus geratenen Dateinamen gehen ins Leere --
  //    nachgeprueft: die bizTransaction-URL selbst antwortet mit 404.
  //
  //    Deshalb der umgekehrte Weg: alle Katalogquellen als KANDIDATEN nehmen
  //    und nachsehen, welche den Ident wirklich fuehren. Das ist kein Raten
  //    mehr, sondern ein Nachweis aus den Daten -- und genau die Eingrenzung,
  //    die der Anwendungsfall verlangt.
  const txHashes = new Set(
    bizTxUrls.map((u) => u.split('/').filter(Boolean).pop()).filter(Boolean) as string[],
  );
  const guessedSet = new Set(guessed);
  const candidates = new Set<string>();
  try {
    const products = await getAllProductsAsync();
    for (const product of products) {
      const certain =
        // Trace-Id-Weg: das Katalogprodukt IST das gescannte Bauteil.
        product.id === epc ||
        // Produkt-Id ist ausnahmsweise doch ein Ident.
        relatedEpcs.has(product.id) ||
        txHashes.has(product.id) ||
        product.sources.some(
          (url) => guessedSet.has(url) || [...txHashes].some((hash) => url.includes(hash)),
        );

      for (const url of product.sources) {
        if (certain) sourceSet.add(url);
        else candidates.add(url);
      }
    }
  } catch (err) {
    notes.push(
      `Katalogquellen nicht ermittelbar: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
    );
  }

  // 5. Rollen- und Erreichbarkeitsfilter -- dieselbe Kette wie im Produktpass.
  //    WAC greift darunter ohnehin: getAuthFetch liefert fuer eine Quelle ohne
  //    Leserecht 403, unabhaengig von dieser Liste. Die Allowlist ist eine
  //    Eingrenzung, NICHT die Sicherheitsgrenze.
  const { allowed } = await filterSourcesByRole([...sourceSet], getCurrentRole());
  let { available } = await filterAvailableSources(allowed);

  // 6. Kandidaten IMMER pruefen und dazunehmen.
  //
  //    Frueher lief das nur, wenn sonst gar nichts erreichbar war ("Notfall").
  //    Das war falsch, sobald die Lieferkette ueber mehrere Stufen aufgeloest
  //    wird: die bizTransactions der Vorkette liefern erreichbare Quellen aus
  //    dem Saegewerks-Pod, damit war ``available`` nicht leer -- und die
  //    Katalogquellen mit den Daten der PLATTE blieben als ungepruefte
  //    Kandidaten liegen. Folge: die Waldherkunft war auffindbar, das
  //    gescannte Bauteil selbst aber nicht ("keine Eigenschaften hinterlegt").
  //
  //    Die Pruefung ist ohnehin die genauere Aussage: sie belegt, dass eine
  //    Quelle den Ident FUEHRT, waehrend die bizTransaction-Ableitung nur
  //    Dateinamen raet. Also nicht ersatzweise, sondern zusaetzlich.
  if (candidates.size > 0) {
    // Rollenfilter VOR der Pruefung: eine Quelle, die die Rolle ohnehin nicht
    // lesen darf, muss gar nicht erst abgefragt werden. Ein Erreichbarkeits-
    // filter danach waere doppelt -- sourcesBearingIdent prueft ihn selbst,
    // und ein Treffer beweist die Lesbarkeit ohnehin.
    const { allowed: allowedCandidates } = await filterSourcesByRole(
      [...candidates],
      getCurrentRole(),
    );
    const matched = await sourcesBearingIdent(allowedCandidates, relatedEpcs);
    if (matched.length > 0) {
      available = [...new Set([...available, ...matched])];
    }
  }

  // 7. Leerer Scope -> degradierter Rueckfall auf den Katalog.
  if (available.length === 0) {
    const fallback = await catalogFallback();
    if (fallback.length > 0) {
      notes.push(
        'Die Herkunftsprüfung konnte nicht auf dieses Bauteil eingegrenzt werden — ' +
          'Antworten können Daten anderer Bauteile enthalten.',
      );
      return {
        epc,
        relatedEpcs,
        sources: fallback,
        events,
        eventsReturned,
        eventsFilteredOut,
        degraded: true,
        notes,
      };
    }
    notes.push('Keine verknüpften Pod-Daten erreichbar.');
  }

  return {
    epc,
    relatedEpcs,
    sources: available,
    events,
    eventsReturned,
    eventsFilteredOut,
    degraded: false,
    notes,
  };
}

/** Wie viele Verarbeitungsstufen rueckwaerts verfolgt werden. */
const MAX_CHAIN_DEPTH = 4;
/** Hoechstzahl EPCIS-Abfragen je Stufe -- Schutz gegen 169 Lamellen auf einmal. */
const MAX_QUERIES_PER_LEVEL = 8;

/**
 * Der GS1-Itemreference-Teil eines EPC (urn:epc:id:sgtin:GCP.ITEMREF.SERIAL).
 *
 * Er kennzeichnet die Produktart und damit die Verarbeitungsstufe: 0401 =
 * BSP-Platte, 0212 = Lamelle, 0100 = Stamm. Genau die richtige Koernung, um
 * pro Stufe einen Vertreter weiterzuverfolgen.
 */
function itemRefOf(epc: string): string {
  return epc.split(':')[4]?.split('.')[1] ?? epc;
}

/**
 * Die Lieferkette rueckwaerts verfolgen -- ueber MEHRERE Stufen.
 *
 * Eine einzelne EPCIS-Abfrage reicht nicht: die BSP-Produktion ist ein
 * TransformationEvent (169 Lamellen rein, eine Platte raus), und die Lamellen
 * stammen ihrerseits aus einem TransformationEvent im Saegewerk (Staemme rein,
 * Lamellen raus). An den STAEMMEN haengen die Forstdaten -- Forstamt, Revier,
 * Einschlagdatum.
 *
 * Wer nur eine Stufe aufloest, endet bei den Lamellen. Genau das war der Fall:
 * der Assistent fand die Vorprodukte, aber nie den Wald, und musste ehrlich
 * "keine Herkunftsdaten" antworten, obwohl sie zwei Stufen weiter im
 * Saegewerks-Pod liegen.
 *
 * Zwei Begrenzungen halten den Aufwand im Rahmen:
 *   - je Stufe nur EIN Vertreter pro Produktart (itemRef). Alle 169 Lamellen
 *     stammen aus demselben Vorgang; die 169. Abfrage liefert dieselben Pods
 *     wie die erste.
 *   - MAX_CHAIN_DEPTH Stufen. Die reale Kette (Platte -> Lamelle -> Stamm)
 *     braucht drei; vier laesst Luft, ohne ins Uferlose zu laufen.
 */
async function walkSupplyChain(startEpc: string): Promise<{
  events: EpcisEvent[];
  eventsReturned: number;
  eventsFilteredOut: number;
  epcs: Set<string>;
  bizTxUrls: string[];
}> {
  const epcs = new Set<string>([startEpc]);
  const bizTx = new Set<string>();
  const allEvents: EpcisEvent[] = [];
  const queried = new Set<string>();
  let eventsReturned = 0;
  let eventsFilteredOut = 0;
  let frontier = [startEpc];

  for (let depth = 0; depth < MAX_CHAIN_DEPTH && frontier.length > 0; depth++) {
    const batch = frontier.filter((e) => !queried.has(e)).slice(0, MAX_QUERIES_PER_LEVEL);
    if (batch.length === 0) break;

    const results = await Promise.all(
      batch.map(async (candidate) => {
        queried.add(candidate);
        try {
          return await queryEpcisEvents(candidate);
        } catch (err) {
          // Eine einzelne Stufe darf die Kette nicht abreissen lassen: die
          // bereits gefundenen Stufen bleiben gueltig.
          console.debug('[agent] EPCIS-Abfrage fehlgeschlagen für', candidate, err);
          return null;
        }
      }),
    );

    const discovered: string[] = [];
    for (const result of results) {
      if (!result) continue;
      // Nur die erste Stufe zaehlt fuer die Anzeige "N Ereignisse gefunden" --
      // sie beschreibt das gescannte Bauteil, nicht die halbe Lieferkette.
      if (depth === 0) {
        eventsReturned = result.returned;
        eventsFilteredOut = result.filteredOut;
      }
      allEvents.push(...result.events);
      for (const url of collectBizTransactions(result.events)) bizTx.add(url);
      for (const found of collectEpcs(result.events)) {
        if (!epcs.has(found)) discovered.push(found);
        epcs.add(found);
      }
    }

    // Je Produktart nur einen Vertreter weiterverfolgen.
    const byItemRef = new Map<string, string>();
    for (const found of discovered) {
      const ref = itemRefOf(found);
      if (!byItemRef.has(ref)) byItemRef.set(ref, found);
    }
    frontier = [...byItemRef.values()];
  }

  console.debug(
    `[agent] Lieferkette: ${epcs.size} EPCs über ${queried.size} Abfragen, ` +
      `${bizTx.size} Dokumentlink(s)`,
  );

  return {
    events: allEvents,
    eventsReturned,
    eventsFilteredOut,
    epcs,
    bizTxUrls: [...bizTx],
  };
}

/**
 * Welche der Kandidatenquellen fuehren einen der Idente wirklich?
 *
 * Eine Abfrage je Quelle -- der einzige belastbare Bezug, wenn die
 * bizTransaction-Links nicht auf Dateinamen fuehren (Vorgangsnummer statt
 * Doc-Hash). Gefragt wird nach allen drei Ident-Properties plus tc:traceId,
 * weil die Endpunkte die Unter-Property-Hierarchie nicht aufloesen.
 *
 * Laeuft parallel. Fehler je Quelle sind kein Grund zum Abbruch -- eine nicht
 * lesbare Datei ist schlicht kein Treffer -- werden aber PROTOKOLLIERT: ein
 * stilles catch hat hier schon einmal einen echten Fehler verdeckt (ASK statt
 * SELECT, siehe unten) und die Pruefung wirkungslos gemacht, ohne dass man es
 * der Oberflaeche ansah.
 */
async function sourcesBearingIdent(
  candidates: string[],
  idents: Set<string>,
): Promise<string[]> {
  if (candidates.length === 0 || idents.size === 0) return [];

  // Erst die erreichbaren: eine Abfrage gegen eine tote URL kostet nur
  // Wartezeit. filterAvailableSources macht dafuer billige HEAD-Anfragen.
  const { available: reachable } = await filterAvailableSources(candidates);
  if (reachable.length === 0) return [];

  // SELECT, NICHT ASK: executeQuery ruft Comunicas queryBindings auf, und das
  // wirft bei einem ASK "Query result type 'bindings' was expected, while
  // 'boolean' was found". Ein LIMIT 1 leistet hier dasselbe wie ein ASK --
  // eine Zeile genuegt als Nachweis.
  const values = [...idents].map((id) => `<${id}> "${id}"`).join(' ');
  const query = `
PREFIX tc: <${NAMESPACES.tc}>
SELECT ?s WHERE {
  VALUES ?ident { ${values} }
  { ?s tc:epc ?ident } UNION { ?s tc:sgtin ?ident } UNION
  { ?s tc:lgtin ?ident } UNION { ?s tc:traceId ?ident }
}
LIMIT 1`.trim();

  const hits = await Promise.all(
    reachable.map(async (url) => {
      try {
        const rows = await executeQuery(query, [url]);
        return rows.length > 0 ? url : null;
      } catch (err) {
        console.debug('[agent] Identprüfung fehlgeschlagen für', url, err);
        return null;
      }
    }),
  );
  const matched = hits.filter((url): url is string => url !== null);
  console.debug(
    `[agent] Identprüfung: ${matched.length} von ${reachable.length} erreichbaren Quellen führen den Ident`,
  );
  return matched;
}

/**
 * Rueckfall: alle erreichbaren Katalogquellen. Nur im degradierten Fall --
 * in diesem Zustand traegt die EPC-Pruefung an der Abfrage
 * (agentSparqlService) die Hauptlast der Eingrenzung.
 */
async function catalogFallback(): Promise<string[]> {
  try {
    const products = await getAllProductsAsync();
    const urls = new Set(products.flatMap((p) => p.sources));
    const { allowed } = await filterSourcesByRole([...urls], getCurrentRole());
    const { available } = await filterAvailableSources(allowed);
    return available;
  } catch {
    return [];
  }
}
