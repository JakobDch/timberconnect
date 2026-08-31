/**
 * Die Agentenschleife -- EIN Agent, der alles macht.
 *
 * Bewusst kein Zwei-Agenten-Aufbau wie im Referenzprojekt: dort trennt sich
 * Retrieval von SPARQL-Generierung, weil ueber 40 Datensaetze durchsucht werden
 * muessen. Hier ist der Suchraum ein einziges Bauteil und das Schema passt
 * komplett in den Prompt -- eine Uebergabe zwischen zwei Agenten waere reine
 * Zeremonie.
 *
 * Das Wichtigste an dieser Schleife ist, WAS SIE NICHT TUT: sie gibt nichts
 * aus. Waehrend sie laeuft, sieht der Nutzer nur Statusmeldungen ("Frage
 * Pod-Daten ab...") -- keine Zeile der gefundenen Daten. Die fertige Antwort
 * wird ZURUECKGEGEBEN; ueber ihre Anzeige entscheidet der Aufrufer, nachdem
 * feststeht, was sie kostet.
 *
 * Deshalb gibt es hier auch keinen Rueckkanal fuer den Antworttext: wuerde er
 * waehrend des Schreibens durchgereicht, waere die Bezahlschranke ausgehebelt,
 * bevor sie greift. Dasselbe Muster wie ``pendingDisplay`` in App.tsx.
 */

import { collectExtractedDatapoints } from '../pricingService';
import { queryDatapointKey } from '../purchaseService';
import type { SparqlBinding } from '../sparqlService';
import {
  complete,
  parseToolArguments,
  DeepSeekError,
  type ChatMessage,
  type ToolCall,
} from './deepseekClient';
import { executeTool, TOOL_SCHEMAS, ANSWER_TOOL } from './tools';
import { buildSystemPrompt } from './prompts';
import type { EpcScope } from './epcScopeService';
import type { SchemaPack } from './schemaContextService';

/**
 * KEINE Obergrenze der Werkzeugrunden.
 *
 * Eine feste Grenze klang zunaechst nach Vernunft, war aber die falsche
 * Entscheidungsinstanz: sie schnitt die Arbeit mitten im Vorgang ab, und weil
 * dem Modell in der letzten Runde die Werkzeuge entzogen wurden, schrieb es
 * seinen Aufruf als Rohtext in die Antwort. Wer wartet, soll selbst
 * entscheiden, wann es genug ist -- dafuer gibt es den Abbrechen-Knopf.
 *
 * Bleibt nur ein Notanker gegen echte Endlosschleifen (Modell ruft immer
 * dasselbe Werkzeug auf). Er liegt so hoch, dass ihn keine sinnvolle Arbeit
 * erreicht, und wird dem Nutzer gegenueber offen benannt.
 */
export const RUNAWAY_GUARD = 40;

/**
 * Ab wie vielen leeren Ergebnissen in Folge das Modell aktiv gestoppt wird.
 *
 * Drei, nicht zwei: die erste Abfrage kann am falschen Einstieg scheitern, die
 * zweite an der falschen Property. Beim dritten Leerlauf hintereinander ist es
 * keine Frage des Einstiegs mehr -- die Angabe ist nicht da.
 */
export const EMPTY_STREAK_LIMIT = 3;

export interface ToolCallTrace {
  /** Laufende Nummer, wie sie im Zitat erscheint (Q1, Q2, ...). */
  index: number;
  name: string;
  purpose: string;
  kind: 'probe' | 'data';
  ok: boolean;
  rowCount?: number;
  truncated?: boolean;
  error?: string;
  query?: string;
}

export interface LedgerEntry {
  /** Zitierschluessel Q<index>. */
  index: number;
  keys: Set<string>;
  rowCount: number;
}

/**
 * Ein Datenpunkt, den die Antwort tatsaechlich VERWENDET.
 *
 * Der Unterschied zu ``LedgerEntry.keys`` ist der ganze Punkt: das Ledger
 * haelt alles, was eine Abfrage GELIEFERT hat -- oft hunderte Werte aus einem
 * "SELECT ?p ?o". Hier steht nur, was in der Antwort steht.
 */
export interface UsedDatapoint {
  index: number;
  variable: string;
  value: string;
}

export interface AgentAnswer {
  /** Die fertige Antwort -- NOCH NICHT angezeigt. */
  content: string;
  traces: ToolCallTrace[];
  /** Datenpunkt-Schluessel je Abfrage -- die OBERGRENZE des Abrechenbaren. */
  ledger: LedgerEntry[];
  /**
   * Was die Antwort laut Agent wirklich verwendet. Grundlage der Abrechnung.
   *
   * ``undefined`` heisst: nicht deklariert (altes Verhalten, fail-closed).
   * Eine LEERE Liste ist etwas anderes -- sie heisst "diese Antwort nennt
   * keine Daten" und kostet dann auch nichts.
   */
  used?: UsedDatapoint[];
  /** Nachrichtenverlauf fuer die Folgefrage. */
  messages: ChatMessage[];
  /** True, wenn die Schleife an MAX_ITERATIONS endete statt an einer Antwort. */
  exhausted: boolean;
}

export interface RunAgentOptions {
  apiKey: string;
  question: string;
  scope: EpcScope;
  pack: SchemaPack;
  role?: string | null;
  /** Verlauf vorheriger Runden (ohne Systemnachricht). */
  history?: ChatMessage[];
  signal?: AbortSignal;
  /**
   * Statusanzeige waehrend der Werkzeugphase -- niemals Daten.
   *
   * Es gibt bewusst KEINEN Rueckkanal fuer den Antworttext. Der Text ist die
   * Antwort, und ueber deren Anzeige entscheidet erst die Kostenpruefung.
   * Wuerde er waehrend des Schreibens durchgereicht, waere die Bezahlschranke
   * ausgehebelt, bevor sie greift.
   */
  onStatus?: (status: string) => void;
}

/**
 * Nicht ausgefuehrte Werkzeugaufrufe aus dem Antworttext entfernen.
 *
 * DeepSeek gibt seine Aufrufe gelegentlich als ROHTEXT aus, statt sie ins
 * ``tool_calls``-Feld zu legen -- erkennbar an den Sondertokens
 * ``<｜｜DSML｜｜tool_calls>``. Ausgefuehrt wird davon nichts; beim Nutzer kaeme
 * eine Wand aus XML-artigem Markup an, mitten in der Antwort.
 *
 * Das ist eine Notbremse, keine Loesung: die Ursache (letzte Runde ohne
 * Werkzeuge, aber ohne Ansage) ist oben behoben. Beides zusammen, weil ein
 * Sprachmodell sich nie vollstaendig steuern laesst und der Rohtext in jedem
 * Fall unbrauchbar ist.
 */
export function stripRawToolCalls(content: string): string {
  if (!content.includes('DSML')) return content;

  // Die Sondertokens verwenden Vollbreiten-Zeichen (｜, U+FF5C), nicht ASCII.
  const cleaned = content
    .replace(/<[｜|]+DSML[｜|]+[\s\S]*?$/g, '')
    .replace(/<[｜|]+[^>]*[｜|]+>/g, '')
    .trim();

  return cleaned;
}

/**
 * Fragt der Nutzer nach der Waldherkunft?
 *
 * Bewusst GROSSZUEGIG: ein Fehlalarm kostet einen billigen Werkzeugaufruf,
 * ein verpasster Treffer kostet die halbe Antwort. Deshalb loest schon ein
 * Randbegriff aus.
 *
 * Und bewusst harmlos: die Erkennung entscheidet NICHT, was der Nutzer zu
 * sehen bekommt -- sie schickt das Modell nur einmal zurueck, um eine zweite
 * Datenquelle anzusehen. Faellt sie falsch aus, ist die Antwort dieselbe, nur
 * einen Werkzeugaufruf spaeter. Das ist der Unterschied zu einem Textfilter
 * auf der Antwort, der bei Fehlgriff Inhalt verschluckt.
 */
const FOREST_QUESTION =
  /wald|forst|revier|einschlag|f[äa]llung|herkunft|herkommt|pflanzfl|pflanzung|baumschule|woher|stammt|ursprung|parzelle|schlag|hieb/i;

export function isForestQuestion(question: string): boolean {
  return FOREST_QUESTION.test(question);
}

/** Statusmeldung je Werkzeug -- sagt, was passiert, ohne etwas zu verraten. */
function statusFor(call: ToolCall, args: Record<string, unknown>): string {
  if (call.function.name === 'run_sparql') {
    const purpose = typeof args.purpose === 'string' ? args.purpose : '';
    if (purpose) return purpose;
    return args.kind === 'probe' ? 'Sondiere die Datenlage…' : 'Frage Pod-Daten ab…';
  }
  if (call.function.name === 'get_related_epcs') return 'Verfolge die Lieferkette…';
  return 'Arbeite…';
}

/**
 * Eine Frage beantworten.
 *
 * Gibt die Antwort ZURUECK, statt sie anzuzeigen. Ueber die Anzeige entscheidet
 * der Aufrufer -- nach der Kostenpruefung.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentAnswer> {
  const {
    apiKey,
    question,
    scope,
    pack,
    role,
    history = [],
    signal,
    onStatus,
  } = options;

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt({ scope, pack, role }) },
    ...history,
    { role: 'user', content: question },
  ];

  const traces: ToolCallTrace[] = [];
  const ledger: LedgerEntry[] = [];
  let queryCounter = 0;
  // Leere Ergebnisse IN FOLGE. Ein Treffer setzt zurueck -- die Kette zaehlt,
  // nicht die Summe: wer zwischendurch etwas findet, sucht nicht im Kreis.
  let emptyStreak = 0;
  // Wurde die zweite Datenquelle (Stammzertifikat, anderer Pod) schon
  // angesehen? Solange nicht, darf kein Hinweis "nicht vorhanden" behaupten.
  let forestToolUsed = false;
  // Das Herkunfts-Gate greift hoechstens EINMAL. Sonst koennte ein Modell,
  // das den Aufruf verweigert, die Schleife bis zum Notanker fuellen.
  let forestGateUsed = false;

  for (let iteration = 0; iteration < RUNAWAY_GUARD; iteration++) {
    const result = await complete({
      apiKey,
      messages,
      tools: TOOL_SCHEMAS,
      signal,
    });

    // Hat das Modell geantwortet? Die Antwort kommt als WERKZEUGAUFRUF, nicht
    // als Fliesstext -- siehe ANSWER_TOOL. Damit ist sie ein eigenes Feld im
    // Protokoll und nicht mehr von Begleitgerede zu unterscheiden zu suchen.
    const answerCall = result.toolCalls.find((c) => c.function.name === ANSWER_TOOL);
    if (answerCall) {
      const args = parseToolArguments(answerCall.function.arguments);
      const answer = typeof args.antwort === 'string' ? args.antwort.trim() : '';
      const used = parseUsedDatapoints(args.verwendete_daten);

      // HERKUNFTS-GATE: nicht antworten, bevor die zweite Datenquelle
      // angesehen wurde.
      //
      // Das Stammzertifikat mit der Pflanzflaeche liegt in einem anderen Pod
      // und ist ueber run_sparql grundsaetzlich NICHT erreichbar -- nur ueber
      // match_forest_origin. Ein Modell, das nur SPARQL versucht hat, kann
      // ueber die Waldherkunft schlicht keine Aussage treffen; es weiss die
      // Haelfte nicht.
      //
      // Der Prompt sagt das bereits. Diese Schranke steht daneben, weil ein
      // Prompt eine Bitte ist: in der Praxis hat das Modell Weg 1 abgearbeitet,
      // nichts gefunden und geantwortet -- Weg 2 blieb ungegangen. Einmal
      // zurueckgeschickt, nicht wiederholt: die Marke wird oben gesetzt,
      // sobald das Werkzeug lief.
      if (
        !forestToolUsed &&
        !forestGateUsed &&
        isForestQuestion(question) &&
        iteration < RUNAWAY_GUARD - 1
      ) {
        // Das Werkzeug wird SELBST ausgefuehrt, nicht angefordert.
        //
        // Erst stand hier eine Bitte ("rufe match_forest_origin auf"). Die
        // hat das Modell ignoriert: es hatte schon achtmal SPARQL versucht
        // und machte damit weiter. Eine Regel, die auf Kooperation angewiesen
        // ist, greift genau dann nicht, wenn man sie braucht.
        //
        // Also derselbe Weg wie bei der Kanaltrennung: nicht bitten, sondern
        // tun. Das Ergebnis wird dem Verlauf beigelegt; das Modell bekommt
        // die Daten, ohne sie angefordert zu haben, und kann seine Antwort
        // darauf stuetzen.
        onStatus?.('Prüfe die Pflanzflächen…');
        const { result: forestResult } = await executeTool(
          { name: 'match_forest_origin', args: {} },
          { scope, pack },
        );
        forestToolUsed = true;

        traces.push({
          index: 0,
          name: 'match_forest_origin',
          purpose: 'Abgleich der Einschlagsposition mit den Pflanzflächen.',
          kind: 'data',
          ok: forestResult.ok === true,
          error: typeof forestResult.error === 'string' ? forestResult.error : undefined,
        });

        messages.push({
          role: 'assistant',
          content: result.content || null,
          ...(result.reasoningContent ? { reasoning_content: result.reasoningContent } : {}),
          tool_calls: result.toolCalls,
        });
        for (const call of result.toolCalls) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: 'Antwort noch nicht möglich — es fehlte eine Datenquelle.',
              hinweis:
                'Die Frage betrifft die Waldherkunft. Das Stammzertifikat mit der ' +
                'Pflanzfläche liegt in einem anderen Pod und ist über run_sparql ' +
                'grundsätzlich nicht erreichbar. Der Abgleich wurde deshalb für dich ' +
                'ausgeführt; sein Ergebnis steht unten. Beziehe es in deine Antwort ' +
                'ein — weitere SPARQL-Abfragen bringen dich hier nicht weiter.',
              match_forest_origin: forestResult,
            }),
          });
        }
        forestGateUsed = true;
        continue;
      }

      // Leeres oder unlesbares Argument: lieber ein ehrlicher Satz als ein
      // leerer Block. Der Fliesstext daneben ist KEIN Ersatz -- er ist genau
      // das, was nie angezeigt werden soll.
      const content =
        answer ||
        'Zu dieser Frage konnte ich in den Daten dieses Bauteils keine belastbare ' +
          'Antwort finden. Bitte fragen Sie enger gefasst noch einmal.';

      messages.push({
        role: 'assistant',
        content,
        ...(result.reasoningContent ? { reasoning_content: result.reasoningContent } : {}),
      });
      return {
        content,
        traces,
        ledger,
        used,
        messages: messages.slice(1),
        exhausted: false,
      };
    }

    // Keine Werkzeugaufrufe UND keine Antwort: das Modell hat nur geredet.
    // Frueher war dieser Text die Antwort -- genau dadurch landete das
    // Nachdenken im Chat. Jetzt wird er verworfen und das Modell erinnert.
    if (result.toolCalls.length === 0) {
      messages.push({
        role: 'assistant',
        content: result.content || null,
        ...(result.reasoningContent ? { reasoning_content: result.reasoningContent } : {}),
      });
      messages.push({
        role: 'user',
        content:
          `Dieser Text wurde nicht angezeigt. Antworten erreichen den Nutzer ` +
          `ausschließlich über das Werkzeug "${ANSWER_TOOL}". Rufe entweder ein ` +
          `Werkzeug auf, um weiterzuarbeiten, oder "${ANSWER_TOOL}" mit deiner ` +
          `fertigen Antwort.`,
      });
      continue;
    }

    // Diese Runde war eine Werkzeugrunde: ihr Text (falls vorhanden) war
    // Begleitgerede vor dem Aufruf, keine Antwort -- er wird verworfen und
    // taucht nirgends auf.
    // Der Assistentenzug MIT den Aufrufen muss in den Verlauf, sonst passen die
    // folgenden tool-Nachrichten zu keinem Aufruf und die API lehnt sie ab.
    messages.push({
      role: 'assistant',
      content: result.content || null,
      ...(result.reasoningContent ? { reasoning_content: result.reasoningContent } : {}),
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');

      const args = parseToolArguments(call.function.arguments);
      onStatus?.(statusFor(call, args));

      const { result: toolResult, rows, billable } = await executeTool(
        { name: call.function.name, args },
        { scope, pack },
      );

      // Nur echte Datenabfragen bekommen eine Zitatnummer und einen
      // Ledger-Eintrag. Sondierungen zaehlen nicht -- der Nutzer soll nicht
      // dafuer zahlen, dass der Agent sich orientiert.
      let index: number | undefined;
      if (call.function.name === 'run_sparql' && billable) {
        index = ++queryCounter;
        const keys = collectExtractedDatapoints([(rows ?? []) as SparqlBinding[]]);
        ledger.push({ index, keys, rowCount: rows?.length ?? 0 });
      }

      traces.push({
        index: index ?? 0,
        name: call.function.name,
        purpose: typeof args.purpose === 'string' ? args.purpose : statusFor(call, args),
        kind: args.kind === 'probe' ? 'probe' : 'data',
        ok: toolResult.ok === true,
        rowCount: typeof toolResult.row_count === 'number' ? toolResult.row_count : undefined,
        truncated: toolResult.truncated === true,
        error: typeof toolResult.error === 'string' ? toolResult.error : undefined,
        query: typeof args.query === 'string' ? args.query : undefined,
      });

      // Leerlauf mitzaehlen. Der Prompt verlangt bereits, nach zwei leeren
      // Ergebnissen zur selben Sache aufzuhoeren -- aber genau das haelt ein
      // festgefahrenes Modell nicht ein: es formuliert dieselbe Luecke zum
      // zehnten Mal um. Eine Regel, die nur im Prompt steht, greift dann nicht
      // mehr; sie muss ihm im Ergebnis selbst entgegenkommen.
      const empty =
        toolResult.ok === true &&
        typeof toolResult.row_count === 'number' &&
        toolResult.row_count === 0;
      emptyStreak = empty ? emptyStreak + 1 : 0;

      if (call.function.name === 'match_forest_origin') forestToolUsed = true;

      // Dem Modell die Zitatnummer mitgeben -- ohne sie kann es nicht
      // zitieren, und ohne Zitate wird pauschal alles berechnet.
      const payload: Record<string, unknown> = index
        ? { ...toolResult, zitat_nummer: `Q${index}` }
        : { ...toolResult };

      // Der Hinweis reist MIT dem leeren Ergebnis, nicht als eigene Nachricht:
      // so steht er genau dort, wo das Modell gerade hinsieht, statt im
      // Verlauf nach oben zu rutschen.
      //
      // ABER: "nicht vorhanden" waere gelogen, solange match_forest_origin
      // nicht lief. Das Stammzertifikat liegt in einem anderen Pod und ist
      // ueber SPARQL grundsaetzlich unerreichbar -- beliebig viele leere
      // run_sparql-Ergebnisse sagen darueber nichts aus. Frueher schickte der
      // Hinweis das Modell genau hier in die Antwort, bevor es die zweite
      // Datenquelle ueberhaupt angesehen hatte.
      if (emptyStreak >= EMPTY_STREAK_LIMIT) {
        payload.hinweis = forestToolUsed
          ? `${emptyStreak} Abfragen in Folge ohne Ergebnis. Diese Angabe ist in den ` +
            `Daten dieses Bauteils NICHT vorhanden. Frage sie nicht erneut in anderer ` +
            `Formulierung ab. Beantworte die Frage jetzt mit dem, was du sicher weißt, ` +
            `und benenne diese Lücke als Tatsache über die Daten.`
          : `${emptyStreak} Abfragen in Folge ohne Ergebnis — mit run_sparql kommst du ` +
            `hier nicht weiter. Rufe JETZT match_forest_origin auf (ohne Argumente). ` +
            `Es erschließt das Stammzertifikat in einem anderen Pod, das per SPARQL ` +
            `nicht erreichbar ist. Erst danach darfst du sagen, ob Angaben fehlen.`;
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(payload),
      });
    }
  }

  // Notanker gegriffen: das Modell hat RUNAWAY_GUARD Runden lang Werkzeuge
  // aufgerufen, ohne zu einer Antwort zu kommen -- das ist keine Arbeit mehr,
  // sondern eine Schleife.
  //
  // Die Abfragewerkzeuge werden ENTZOGEN, das Antwortwerkzeug bleibt. Frueher
  // wurden ALLE Werkzeuge entzogen, und die Antwort musste als Fliesstext
  // kommen -- das war genau der Pfad, auf dem das Denkprotokoll im Chat
  // landete. Jetzt bleibt der strukturierte Weg offen; es ist der einzige.
  const closing = await complete({
    apiKey,
    messages: [
      ...messages,
      {
        role: 'user',
        content:
          'Es wurden sehr viele Abfragen ohne abschließende Antwort ausgeführt. Fasse ' +
          `jetzt zusammen, was du sicher sagen kannst, und gib es über "${ANSWER_TOOL}" ` +
          'aus. Weitere Abfragen sind nicht mehr möglich. Nenne offen, was offen ' +
          'bleiben musste.',
      },
    ],
    tools: TOOL_SCHEMAS.filter((t) => t.function.name === ANSWER_TOOL),
    signal,
  });

  // Auch hier zaehlt nur der strukturierte Kanal. Fliesstext aus dieser Runde
  // wird verworfen wie ueberall sonst -- sonst waere der Notanker das Loch,
  // durch das das Denkprotokoll doch noch zum Nutzer gelangt.
  const closingCall = closing.toolCalls.find((c) => c.function.name === ANSWER_TOOL);
  const closingArgs = closingCall
    ? parseToolArguments(closingCall.function.arguments)
    : {};
  const closingAnswer =
    typeof closingArgs.antwort === 'string' ? closingArgs.antwort.trim() : '';

  const closingContent =
    closingAnswer ||
    'Zu dieser Frage konnte ich in den Daten dieses Bauteils keine belastbare ' +
      'Antwort finden. Bitte fragen Sie enger gefasst noch einmal.';
  messages.push({ role: 'assistant', content: closingContent });
  return {
    content: closingContent,
    traces,
    ledger,
    used: parseUsedDatapoints(closingArgs.verwendete_daten),
    messages: messages.slice(1),
    exhausted: true,
  };
}

/**
 * Die Deklaration des Agenten lesen -- nachsichtig, aber ohne Raten.
 *
 * ``undefined`` bedeutet "nicht deklariert" und fuehrt spaeter zu
 * fail-closed. Eine leere Liste ist eine ECHTE Aussage ("nichts verwendet")
 * und fuehrt zu Kosten null. Der Unterschied muss erhalten bleiben, sonst
 * zahlt eine ehrliche Fehlanzeige denselben Preis wie eine volle Antwort.
 */
function parseUsedDatapoints(raw: unknown): UsedDatapoint[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const used: UsedDatapoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;

    // Die Nummer kommt gelegentlich als "Q3" oder "3" statt als Zahl.
    const rawIndex = entry.abfrage;
    const index =
      typeof rawIndex === 'number'
        ? rawIndex
        : Number(String(rawIndex ?? '').replace(/^Q/i, ''));
    if (!Number.isInteger(index) || index <= 0) continue;

    const variable = typeof entry.variable === 'string' ? entry.variable.trim() : '';
    // Zahlen und Wahrheitswerte sind gueltige Werte, nur eben nicht als String.
    const value =
      typeof entry.wert === 'string'
        ? entry.wert.trim()
        : typeof entry.wert === 'number' || typeof entry.wert === 'boolean'
          ? String(entry.wert)
          : '';
    if (!variable || !value) continue;

    used.push({ index, variable, value });
  }
  return used;
}

// ---------------------------------------------------------------------------
// Zitate -> abzurechnende Schluessel
// ---------------------------------------------------------------------------

/**
 * Findet Zitate im Antworttext -- mit ODER ohne eckige Klammern.
 *
 * Der Prompt verlangt ``[Q3.holzart]``, aber Modelle lassen die Klammern
 * gerade in Tabellenzellen regelmaessig weg ("Q3.holzart, Q25.holzart").
 * Streng zu parsen haette hier die schlechteste Folge: keine erkannten Zitate
 * bedeutet fail-closed, also wird ALLES berechnet -- der Nutzer zahlt dafuer,
 * dass das Modell zwei Klammern vergessen hat.
 *
 * Verlangt wird deshalb nur, was ein Zitat eindeutig macht: Q, Ziffern, und
 * ein Punkt mit Variablenname. Ein blosses "Q3" im Fliesstext zaehlt NICHT --
 * das koennte auch eine Quartalsangabe sein.
 */
// Zwei Formen, weil die Klammern die Eindeutigkeit tragen:
//   [Q2] / [Q2.holzart]  -- geklammert ist immer ein Zitat, auch ohne Variable
//   Q2.holzart           -- ohne Klammern nur MIT Variablenteil; ein blosses
//                           "Q3" waere sonst nicht von einem Quartal zu
//                           unterscheiden.
const CITATION = /\[Q(\d+)(?:\.[^\]]*)?\]|\bQ(\d+)\.[A-Za-z_][\w-]*/g;

/**
 * Welche Abfragen hat die Antwort zitiert?
 */
export function citedIndices(content: string): Set<number> {
  const indices = new Set<number>();
  for (const match of content.matchAll(CITATION)) {
    // Gruppe 1 = geklammerte Form, Gruppe 2 = Form ohne Klammern.
    indices.add(Number(match[1] ?? match[2]));
  }
  return indices;
}

/**
 * Die abzurechnenden Datenpunkt-Schluessel einer Antwort.
 *
 * BEZAHLT WIRD, WAS DIE ANTWORT NUTZT -- nicht, was der Agent unterwegs
 * gesehen hat. Das ist der Unterschied zwischen "ein Wert" und "alle 400
 * Werte, die ein SELECT ?p ?o zufaellig mitbrachte".
 *
 * Der Agent deklariert die verwendeten Werte selbst (``verwendete_daten``).
 * Geglaubt wird ihm das aber nicht blind: jeder deklarierte Schluessel muss
 * im Ledger der genannten Abfrage stehen. Damit kann er
 *
 *   - nichts erfinden, was die Abfrage nie geliefert hat, und
 *   - nichts Fremdes berechnen lassen, das aus einer anderen Abfrage stammt.
 *
 * FAIL-CLOSED an zwei Stellen, beide mit demselben Grund -- ein Modell darf
 * durch Schlamperei keine Daten verschenken:
 *
 *   - Fehlt die Deklaration ganz (altes Modell, kaputtes JSON), wird nach
 *     Zitaten abgerechnet wie zuvor.
 *   - Nennt die Antwort Belege, deklariert aber NICHTS, gilt dasselbe: die
 *     Zitate sagen, dass Daten verwendet wurden.
 *
 * Eine leere Deklaration OHNE Zitate ist dagegen glaubwuerdig -- das ist die
 * ehrliche Fehlanzeige ("dazu liegen keine Angaben vor"), und die ist gratis.
 */
export function billableKeys(answer: AgentAnswer): Set<string> {
  const cited = citedIndices(answer.content);

  if (answer.used) {
    // Der belegbare Vorrat je Abfrage.
    const byIndex = new Map(answer.ledger.map((entry) => [entry.index, entry.keys]));

    const keys = new Set<string>();
    for (const { index, variable, value } of answer.used) {
      const available = byIndex.get(index);
      if (!available) continue; // erfundene oder nicht abrechenbare Abfrage

      const key = queryDatapointKey(variable, value);
      // Nur was die Abfrage wirklich geliefert hat.
      if (available.has(key)) keys.add(key);
    }

    // Wann gilt die Deklaration?
    //
    //   - Etwas Belegbares dabei -> sie gilt, genau in diesem Umfang.
    //   - Nichts genannt UND nichts zitiert -> ehrliche Fehlanzeige, gratis.
    //   - Es WURDE etwas deklariert, nur nichts davon belegbar -> das Modell
    //     hat sich vertan oder Werte erfunden. Auch das kostet nichts: der
    //     Nutzer hat diese Daten nicht bekommen, und fuer eine Halluzination
    //     darf er nicht MEHR zahlen als fuer eine korrekte Antwort.
    //
    // Fail-closed bleibt nur der eine Fall: LEERE Deklaration trotz Zitaten.
    // Da behauptet die Antwort selbst, Daten zu nennen -- dann darf
    // Vergesslichkeit kein Gratis-Weg sein.
    if (keys.size > 0 || cited.size === 0 || answer.used.length > 0) return keys;
  }

  const relevant =
    cited.size === 0 ? answer.ledger : answer.ledger.filter((entry) => cited.has(entry.index));

  const keys = new Set<string>();
  for (const entry of relevant) {
    for (const key of entry.keys) keys.add(key);
  }
  return keys;
}

export { DeepSeekError };
