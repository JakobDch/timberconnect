/**
 * Datenraum-Aktivitaet — was gerade wirklich abgefragt wird.
 *
 * Der Nutzer unterschaetzt, was ein Scan ausloest: ein Ident wird gegen den
 * EPCIS-Dienst gehalten, aus dessen Events ergeben sich Quellen auf FREMDEN
 * Pods, und erst deren Turtle-Dateien beantworten die Frage. Sichtbar war
 * davon bisher ein drehender Kreis — die Anwendung sah simpler aus als sie
 * ist, und ein langsamer Scan wirkte wie ein Fehler statt wie Arbeit.
 *
 * Diese Stelle ist bewusst nur ein MELDER, kein zweiter Abfrageweg: die
 * Dienste rufen `reportPodQuery` an genau den Stellen, an denen sie ohnehin
 * ans Netz gehen. Was der Graph zeigt, ist deshalb kein nachgestelltes
 * Schauspiel, sondern der tatsaechliche Verkehr. Wird hier nichts gemeldet,
 * bleibt der Graph still — das ist richtig so und besser als eine Animation,
 * die Betrieb vortaeuscht.
 *
 * Bewusst ohne React: die Meldestellen liegen tief in den Diensten, die von
 * Komponenten nichts wissen. Die Anbindung uebernimmt useDataspaceActivity.
 */

/** Was mit einer Gegenstelle passiert ist. */
export type ActivityKind =
  /** Anfrage ist raus, Antwort steht aus. */
  | 'request'
  /** Antwort kam und enthielt Daten. */
  | 'hit'
  /** Antwort kam, aber ohne Daten (404, leer, kein Zugriff). */
  | 'miss';

/** Art der Gegenstelle — bestimmt allein die Darstellung im Graphen. */
export type EndpointKind = 'pod' | 'service';

export interface ActivityEvent {
  /** Stabile Kennung der Gegenstelle (Host + erstes Pfadsegment). */
  endpoint: string;
  kind: ActivityKind;
  endpointKind: EndpointKind;
  at: number;
}

type Listener = (event: ActivityEvent) => void;

const listeners = new Set<Listener>();

export function subscribeActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: ActivityEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* Ein kaputter Zuhoerer darf keine Abfrage scheitern lassen. */
    }
  }
}

/**
 * Die Gegenstelle einer URL bestimmen.
 *
 * Ein Solid-Pod ist `https://host/podname/...` — Host ALLEIN genuegt nicht,
 * weil alle Demo-Pods auf demselben Server liegen und sonst zu einem einzigen
 * Knoten verschmelzen wuerden. Umgekehrt darf nicht jeder Pfad ein eigener
 * Knoten werden, sonst zerfaellt ein Pod in seine Dateien.
 */
export function endpointOf(url: string): string {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
    const segment = parsed.pathname.split('/').filter(Boolean)[0];
    return segment ? `${parsed.hostname}/${segment}` : parsed.hostname;
  } catch {
    return 'unbekannt';
  }
}

/** Eine Abfrage an einen Pod melden. */
export function reportPodQuery(url: string, kind: ActivityKind): void {
  emit({ endpoint: endpointOf(url), kind, endpointKind: 'pod', at: Date.now() });
}

/** Eine Abfrage an einen Dienst (EPCIS, Register) melden. */
export function reportServiceQuery(name: string, kind: ActivityKind): void {
  emit({ endpoint: name, kind, endpointKind: 'service', at: Date.now() });
}
