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
import type { SparqlBinding } from '../sparqlService';
import {
  complete,
  parseToolArguments,
  DeepSeekError,
  type ChatMessage,
  type ToolCall,
} from './deepseekClient';
import { executeTool, TOOL_SCHEMAS } from './tools';
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

export interface AgentAnswer {
  /** Die fertige Antwort -- NOCH NICHT angezeigt. */
  content: string;
  traces: ToolCallTrace[];
  /** Datenpunkt-Schluessel je Abfrage, Grundlage der Abrechnung. */
  ledger: LedgerEntry[];
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

  for (let iteration = 0; iteration < RUNAWAY_GUARD; iteration++) {
    const result = await complete({
      apiKey,
      messages,
      tools: TOOL_SCHEMAS,
      signal,
    });

    // Keine Werkzeugaufrufe -> das ist die Antwort.
    if (result.toolCalls.length === 0) {
      const content = stripRawToolCalls(result.content);
      messages.push({ role: 'assistant', content });
      return {
        content,
        traces,
        ledger,
        messages: messages.slice(1),
        exhausted: false,
      };
    }

    // Diese Runde war eine Werkzeugrunde: ihr Text (falls vorhanden) war
    // Begleitgerede vor dem Aufruf, keine Antwort -- er wird verworfen und
    // taucht nirgends auf.
    // Der Assistentenzug MIT den Aufrufen muss in den Verlauf, sonst passen die
    // folgenden tool-Nachrichten zu keinem Aufruf und die API lehnt sie ab.
    messages.push({
      role: 'assistant',
      content: result.content || null,
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

      // Dem Modell die Zitatnummer mitgeben -- ohne sie kann es nicht
      // zitieren, und ohne Zitate wird pauschal alles berechnet.
      const payload = index
        ? { ...toolResult, zitat_nummer: `Q${index}` }
        : toolResult;

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(payload),
      });
    }
  }

  // Notanker gegriffen: das Modell hat RUNAWAY_GUARD Runden lang Werkzeuge
  // aufgerufen, ohne zu einer Antwort zu kommen -- das ist keine Arbeit mehr,
  // sondern eine Schleife. Eine letzte Runde ohne Werkzeuge, damit der Nutzer
  // wenigstens das Zwischenergebnis bekommt statt einer Fehlermeldung.
  //
  // Der Entzug wird hier ANGESAGT: nimmt man einem Modell die Werkzeuge
  // wortlos weg, waehrend es noch abfragen will, schreibt DeepSeek den Aufruf
  // als Rohtext in die Antwort (siehe stripRawToolCalls).
  const closing = await complete({
    apiKey,
    messages: [
      ...messages,
      {
        role: 'user',
        content:
          'Es wurden sehr viele Abfragen ohne abschließende Antwort ausgeführt. Fasse ' +
          'jetzt zusammen, was du aus den bisherigen Ergebnissen sicher sagen kannst. ' +
          'Rufe KEIN Werkzeug mehr auf. Nenne offen, was offen bleiben musste.',
      },
    ],
    signal,
  });

  const closingContent = stripRawToolCalls(closing.content);
  messages.push({ role: 'assistant', content: closingContent });
  return {
    content: closingContent,
    traces,
    ledger,
    messages: messages.slice(1),
    exhausted: true,
  };
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
 * FAIL-CLOSED: zitiert die Antwort GAR NICHTS, werden alle Schluessel
 * berechnet. Ein Modell, das die Zitate vergisst, darf keine Daten
 * verschenken -- und so entsteht auch kein Anreiz, sparsam zu zitieren.
 *
 * Zitierte Nummern ohne Ledger-Eintrag (das Modell hat sich verzaehlt oder auf
 * eine Sondierung verwiesen) werden still uebergangen: dafuer gibt es keine
 * Datenpunkte, also auch nichts zu bezahlen.
 */
export function billableKeys(answer: AgentAnswer): Set<string> {
  const cited = citedIndices(answer.content);
  const relevant =
    cited.size === 0 ? answer.ledger : answer.ledger.filter((entry) => cited.has(entry.index));

  const keys = new Set<string>();
  for (const entry of relevant) {
    for (const key of entry.keys) keys.add(key);
  }
  return keys;
}

export { DeepSeekError };
