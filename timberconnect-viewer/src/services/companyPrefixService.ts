/**
 * Die im Datenraum gefuehrten GS1-Firmenpraefixe — aus den Pods, nicht aus
 * einer Liste im Code.
 *
 * ## Warum es diesen Dienst gibt
 *
 * Ein Barcode enthaelt die GTIN als durchgehende Ziffernfolge. Wo der
 * Firmenpraefix aufhoert und die Artikelnummer anfaengt, steht NICHT darin:
 * der Praefix ist eine Lizenznummer von 4 bis 12 Stellen, keine Eigenschaft
 * der Zahl. `04047111451006` laesst sich als `40471114510` + `06` lesen oder
 * als `404711145` + `0100` — beides ist syntaktisch einwandfrei.
 *
 * Bisher nahm die App die erste Lesart der Kandidatenliste (laengster Praefix
 * zuerst) und suchte damit nach einem Ident, den es nirgends gibt. Der Scan
 * war korrekt, die Abfrage lief ins Leere, und die Oberflaeche meldete
 * "Produktart nicht bestimmbar" — obwohl die Daten vorhanden waren.
 *
 * ## Warum aus den Pods und nicht aus einer Tabelle
 *
 * GS1 veroeffentlicht dafuer die "GCP Length Table". Sie ist laut GS1 selbst
 * lueckenhaft und seit Januar 2026 passwortgeschuetzt — als mitgelieferte
 * Datei also kein Weg. Vor allem aber waere sie in diesem System ein
 * Fremdkoerper: eine zentrale Liste, die jemand pflegen muss, in einem
 * Datenraum, der bewusst ohne zentrale Register auskommt.
 *
 * Der Praefix steht laengst dezentral bereit. Jeder Teilnehmer hinterlegt ihn
 * bei der Registrierung in `profile/role.ttl` seines eigenen Pods
 * (`tc:companyPrefix`, write-once, oeffentlich lesbar), und die Federation
 * Registry kennt alle Pods. Die Liste entsteht damit aus dem, was die
 * Teilnehmer selbst ueber sich veroeffentlicht haben — ein neuer Teilnehmer
 * bringt seinen Praefix mit, niemand pflegt etwas nach.
 *
 * Das ist zugleich die richtige Vertrauensgrenze: Die Registry ist in diesem
 * System die Autoritaet fuer "wer gehoert dazu". Ein Praefix, den kein
 * registrierter Pod fuehrt, gehoert auch nicht in den Datenraum.
 *
 * ## Was hier bewusst NICHT passiert
 *
 * Kein Raten und kein Rueckschluss aus den Sachdaten. Faellt die Aufloesung
 * aus (Registry nicht erreichbar, Praefix unbekannt), liefert dieser Dienst
 * eine leere Liste, und der Aufrufer faellt sichtbar gekennzeichnet auf das
 * Durchprobieren zurueck. Eine stille Falschzuordnung waere hier besonders
 * tueckisch, weil die GTIN-Pruefziffer sie NICHT aufdeckt: sie kommt im
 * fertigen EPC-URN gar nicht mehr vor.
 */

import { getSolidDataset, getThing, getStringNoLocale } from '@inrupt/solid-client';
import { getAuthFetch } from './authFetch';
import { ROLE_DOC, podBaseFromWebId } from './accessControlService';
import { TC_COMPANY_PREFIX, isValidCompanyPrefix } from '../config/roles';
import { discoverMemberWebIds } from './registryService';

/**
 * Wie lange die eingesammelten Praefixe gelten.
 *
 * Ein Firmenpraefix ist eine Lizenznummer und aendert sich praktisch nie;
 * neu hinzu kommen nur neue Teilnehmer. Fuenf Minuten decken denselben
 * Zeitraum ab wie der Member-Cache der Registry — laenger zu cachen brächte
 * nichts, weil die darunterliegende Mitgliederliste ohnehin neu geladen wird.
 */
const PREFIX_TTL = 5 * 60 * 1000;

let cache: { prefixes: string[]; at: number } | null = null;
/** Laufende Abfrage, damit paralleles Scannen die Registry nicht mehrfach liest. */
let inFlight: Promise<string[]> | null = null;

/** Den GS1-Praefix eines einzelnen Teilnehmers aus seinem Pod lesen. */
async function prefixForWebId(webId: string): Promise<string | null> {
  try {
    const pod = podBaseFromWebId(webId);
    const ds = await getSolidDataset(ROLE_DOC(pod), { fetch: getAuthFetch() });
    const thing = getThing(ds, webId);
    if (!thing) return null;
    const value = getStringNoLocale(thing, TC_COMPANY_PREFIX);
    if (!value) return null;
    const trimmed = value.trim();
    return isValidCompanyPrefix(trimmed) ? trimmed : null;
  } catch {
    // Ein einzelner unerreichbarer Pod darf die uebrigen nicht blockieren.
    return null;
  }
}

/**
 * Alle im Datenraum gefuehrten Firmenpraefixe einsammeln.
 *
 * Absteigend nach Laenge sortiert: Laesst ein GTIN mehrere bekannte Praefixe
 * zu, gewinnt der laengere. Das entspricht der GS1-Ausschlussregel — die
 * Vergabe eines Praefixes schliesst alle laengeren Zeichenketten mit
 * demselben Anfang aus, ein laengerer Treffer ist also der spezifischere.
 */
export async function getKnownCompanyPrefixes(): Promise<string[]> {
  if (cache && Date.now() - cache.at < PREFIX_TTL) return cache.prefixes;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const webIds = await discoverMemberWebIds();
      const found = await Promise.all(webIds.map(prefixForWebId));
      const prefixes = Array.from(
        new Set(found.filter((p): p is string => p !== null)),
      ).sort((a, b) => b.length - a.length || a.localeCompare(b));

      cache = { prefixes, at: Date.now() };
      console.log(
        `[gs1] ${prefixes.length} Firmenpräfix(e) aus ${webIds.length} Pod(s) der Föderation:`,
        prefixes,
      );
      return prefixes;
    } catch (e) {
      console.warn('[gs1] Firmenpräfixe konnten nicht ermittelt werden:', e);
      // Bewusst NICHT cachen: ein Netzfehler soll beim naechsten Scan neu
      // versucht werden, nicht fuenf Minuten lang nachwirken.
      return [];
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Cache verwerfen — nach einer Registrierung, damit der frisch hinterlegte
 * Praefix sofort fuer die Scan-Aufloesung zaehlt.
 */
export function invalidateCompanyPrefixes(): void {
  cache = null;
}

/**
 * Den passenden bekannten Praefix zu einem GTIN finden.
 *
 * Die 14-stellige GTIN traegt vorne die Indikatorziffer und hinten die
 * Pruefziffer; dazwischen liegen die 12 Stellen aus Praefix + Artikelnummer.
 * Gesucht wird also im Rumpf, nicht im Gesamtstring.
 *
 * `prefixes` wird uebergeben statt hier geladen, damit die Funktion rein
 * bleibt und sich ohne Netz testen laesst.
 */
export function matchPrefix(gtin14: string, prefixes: string[]): string | null {
  if (!/^\d{14}$/.test(gtin14)) return null;
  const body = gtin14.slice(1, 13);
  // Laengster Treffer gewinnt; die Liste ist bereits entsprechend sortiert.
  return prefixes.find((p) => p.length < body.length && body.startsWith(p)) ?? null;
}
