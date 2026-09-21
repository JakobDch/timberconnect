/**
 * Die Abspielfolge des Datenraum-Graphen.
 *
 * Der Graph hat nur EINE Straße — die Lieferkette. Auf ihr kann immer nur ein
 * Datenstrom zugleich laufen, sonst ist nicht erkennbar, was wohin fliesst.
 * Diese Stelle nimmt die Meldungen der Dienste entgegen, reiht sie auf und
 * gibt sie NACHEINANDER frei.
 *
 * Zweite Aufgabe: den Scan bremsen. Eine Abfrage aus dem Cache ist in
 * Millisekunden zurueck — der Graph blitzte dann kurz auf oder blieb ganz
 * unsichtbar, und vom Aufwand im Hintergrund sah der Nutzer wieder nichts
 * (Rueckmeldung 21.09.2026). `waitForIdle()` laesst den Scan-Flow warten, bis
 * die Folge durchgelaufen ist.
 *
 * WARUM HIER und nicht im Hook: der Scan-Flow (App.tsx) und der Graph
 * (components/Dataspace) muessen dieselbe Warteschlange sehen. Ein
 * Komponenten-Hook waere fuer den Scan-Flow nicht erreichbar, und zwei
 * getrennte Zustaende liefen auseinander.
 *
 * Die Darstellung ist damit LANGSAMER als die Technik — bewusst. Sie zeigt
 * weiterhin nur, was tatsaechlich abgefragt wurde: es wird nichts
 * hinzuerfunden, nur gestreckt und serialisiert.
 *
 * Abgespielt werden AUSSCHLIESSLICH TREFFER. Fehlschlaege sind hier kein
 * Befund ueber einen Akteur (siehe attachSequencer) — dass ein Scan
 * insgesamt nichts fand, meldet der Scan-Screen.
 */

import { subscribeActivity } from './dataspaceActivity';

export type NodeState = 'idle' | 'querying' | 'hit';

/** Was der Graph gerade zeigen soll — immer hoechstens EINE Gegenstelle. */
export interface SequencerState {
  endpoint: string | null;
  state: NodeState;
  /** Wechselt bei jedem Schritt — loest die Animation neu aus. */
  pulse: number;
  /** Laeuft die Folge gerade? */
  playing: boolean;
}

/** Hinweg: wie lange der Strom zum Ziel braucht. */
export const LEG_DURATION = 900;
/** Rueckweg bzw. Nachleuchten am Ziel. */
export const RETURN_DURATION = 800;
/** Pause zwischen zwei Stroemen, damit sie sich nicht beruehren. */
const STEP_GAP = 220;
/**
 * Nachlauffrist am Ende der Warteschlange.
 *
 * Ein Scan meldet seine Quellen nicht auf einen Schlag. Ohne diese Frist
 * endete die Folge in einer Luecke zwischen zwei Quellen und begann sofort
 * neu — der Graph zuckte.
 */
const TAIL_WAIT = 500;
/**
 * Wie viele Schritte hoechstens abgespielt werden.
 *
 * Ein Scan meldet leicht 15 Quellen. Bei knapp zwei Sekunden je Schritt waere
 * der Nutzer eine halbe Minute beschaeftigt — aus "zeig mir die Komplexitaet"
 * wuerde Warten. Weitere Meldungen werden verworfen, nicht gestaucht: lieber
 * wenige verstaendliche Stroeme als zwanzig hektische.
 */
const MAX_STEPS = 4;

interface Step {
  endpoint: string;
}

type Listener = (state: SequencerState) => void;

const RUHE: SequencerState = { endpoint: null, state: 'idle', pulse: 0, playing: false };

let current: SequencerState = RUHE;
const listeners = new Set<Listener>();

const queue: Step[] = [];
const seen = new Set<string>();
let busy = false;
let waiters: (() => void)[] = [];
let timers: ReturnType<typeof setTimeout>[] = [];
/**
 * Gegenstellen, die in FRUEHEREN Laeufen wirklich geantwortet haben.
 *
 * Sie sind der Rueckfall fuer einen Lauf, in dem alles aus dem Cache kommt
 * und deshalb gar nichts gemeldet wird. Gezeigt werden dann Stationen, die
 * tatsaechlich Daten zu diesem Datenraum beigetragen haben — nicht irgendein
 * erfundener Weg. Der Cache macht die Abfrage schnell; abgefragt worden sind
 * diese Stellen trotzdem.
 */
const bekannteTreffer = new Set<string>();

function publish(next: SequencerState): void {
  current = next;
  for (const listener of listeners) {
    try {
      listener(current);
    } catch {
      /* Ein kaputter Zuhoerer darf die Folge nicht anhalten. */
    }
  }
}

function finish(): void {
  busy = false;
  publish(RUHE);
  for (const resolve of waiters) resolve();
  waiters = [];
  // Der naechste Scan beginnt mit leerer Liste; sonst wuerde eine Quelle, die
  // beim ersten Mal vorkam, nie wieder gezeigt.
  seen.clear();
}

/** Den naechsten Schritt abspielen — oder die Folge beenden. */
function playNext(): void {
  const step = queue.shift();

  if (!step) {
    const t = setTimeout(() => {
      if (queue.length > 0) playNext();
      else finish();
    }, TAIL_WAIT);
    timers.push(t);
    return;
  }

  busy = true;
  const pulse = Date.now();

  // Hinweg: die Anfrage laeuft zum Ziel.
  publish({ endpoint: step.endpoint, state: 'querying', pulse, playing: true });

  // Am Ziel angekommen: Treffer (Rueckweg) oder Fehlschlag (nichts kommt).
  //
  // DERSELBE pulse wie auf dem Hinweg. Er dient dem Graphen als React-key,
  // und ein Wechsel wuerde das Element verwerfen und neu aufbauen: die
  // laufende Bewegung startete dann bei t=0 statt umzukehren -- der Rueckweg
  // war deshalb nie zu sehen (Rueckmeldung 21.09.2026). Ein Schritt ist EINE
  // Einheit aus Hin- und Rueckweg; der Puls wechselt erst beim naechsten.
  const t1 = setTimeout(() => {
    publish({
      endpoint: step.endpoint,
      state: 'hit',
      pulse,
      playing: true,
    });
  }, LEG_DURATION);

  const t2 = setTimeout(() => playNext(), LEG_DURATION + RETURN_DURATION + STEP_GAP);
  timers.push(t1, t2);
}

/**
 * Den Sequenzer an die Aktivitaetsmeldungen haengen.
 *
 * Wird beim Start EINMAL aufgerufen (siehe main.tsx bzw. der erste Hook, der
 * ihn braucht). Mehrfachaufrufe sind wirkungslos.
 */
let attached = false;
export function attachSequencer(): void {
  if (attached) return;
  attached = true;

  subscribeActivity((event) => {
    // NUR TREFFER werden abgespielt.
    //
    // Ein 'request' allein hat noch keinen Ausgang. Ein 'miss' ist hier kein
    // Befund ueber einen Akteur, sondern der Regelfall der Quellensuche:
    // steht eine ID nicht im Katalog, raet buildPotentialSources sechs
    // moegliche Dateinamen, von denen hoechstens einer existiert -- die
    // uebrigen 404 sind eingeplant (siehe den Kommentar an
    // filterAvailableSources: "most are expected to 404 ... otherwise it's
    // just noise"). Schlimmer noch: alle geratenen URLs zeigen auf denselben
    // Pod (SOLID_POD_BASE), sodass die Fehlschlaege einer beliebigen Station
    // zugeordnet wuerden -- im Graphen stand dann "Keine Daten an dieser
    // Stelle" ueber einem Akteur, bei dem nichts schiefgelaufen war
    // (Rueckmeldung 21.09.2026).
    //
    // Dass ein Scan INSGESAMT nichts gefunden hat, meldet weiterhin der
    // Scan-Screen -- die Stelle, die alle Quellen zusammen sieht.
    if (event.kind !== 'hit') return;
    if (seen.has(event.endpoint)) return;
    if (seen.size >= MAX_STEPS) return;

    seen.add(event.endpoint);
    bekannteTreffer.add(event.endpoint);
    queue.push({ endpoint: event.endpoint });

    if (!busy) {
      busy = true;
      playNext();
    }
  });
}

export function subscribeSequencer(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export function getSequencerState(): SequencerState {
  return current;
}

/**
 * Wartet, bis die Folge durchgelaufen ist.
 *
 * Laeuft gerade nichts, kehrt sie sofort zurueck — ein Scan ohne jede
 * Meldung (alles aus dem Cache) soll nicht kuenstlich haengen.
 */
export function waitForIdle(): Promise<void> {
  if (!busy && queue.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

/**
 * Einen Lauf ankuendigen — VOR der eigentlichen Abfrage aufzurufen.
 *
 * Ohne das bliebe der Graph bei einem zweiten Scan innerhalb der
 * Cache-Frist (STORE_CACHE_TTL, 5 min) stumm: `loadSource` meldet nur, was
 * wirklich ans Netz geht, ein Cache-Treffer ist keine Abfrage. Genau der Fall
 * aus der Rueckmeldung ("manchmal wird die Animation gar nicht angezeigt").
 *
 * `beginRun` setzt die Folge auf "laeuft", sodass `waitForIdle` wartet und
 * der Graph umschaltet. Kommt binnen TAIL_WAIT keine einzige Meldung, endet
 * sie von selbst — es wird nichts vorgetaeuscht, was nicht passiert ist, nur
 * das Fenster offen gehalten, in dem Meldungen ankommen koennen.
 */
export function beginRun(): void {
  if (busy) return;
  busy = true;
  seen.clear();
  publish({ ...RUHE, playing: true });

  // Kurz Zeit lassen, ob echte Meldungen eintreffen. Tun sie es nicht (alles
  // aus dem Cache), werden Stationen gezeigt, die in frueheren Laeufen
  // tatsaechlich geantwortet haben.
  const t = setTimeout(() => {
    if (queue.length === 0 && seen.size === 0) {
      for (const endpoint of Array.from(bekannteTreffer).slice(0, MAX_STEPS)) {
        seen.add(endpoint);
        queue.push({ endpoint });
      }
    }
    playNext();
  }, 260);
  timers.push(t);
}

/** Alles abbrechen und vergessen — fuer Tests und den Seitenwechsel. */
export function resetSequencer(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  queue.length = 0;
  seen.clear();
  // Auch die gemerkten Treffer: nach einem Abbruch soll nichts aus einem
  // frueheren Lauf nachwirken.
  bekannteTreffer.clear();
  busy = false;
  for (const resolve of waiters) resolve();
  waiters = [];
  publish(RUHE);
}
