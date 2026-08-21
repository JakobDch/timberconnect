/**
 * DeepSeek-Client (OpenAI-kompatibel) mit Werkzeugaufrufen.
 *
 * Laeuft im Browser, nicht auf dem Server: nur hier gibt es die
 * authentifizierte Solid-Session und Comunica, ohne die der Agent die
 * Pod-Daten gar nicht lesen koennte.
 *
 * Der Aufruf geht ueber die eigene Herkunft (/deepseek/*, siehe Caddyfile) und
 * nicht direkt an api.deepseek.com. Damit greift CORS gar nicht erst -- ein
 * direkter Aufruf haenge davon ab, ob DeepSeek die passenden Header schickt.
 * Der API-Key des Nutzers laeuft im Authorization-Header durch; Caddy speichert
 * ihn nicht.
 */

const DEFAULT_BASE_URL =
  import.meta.env.VITE_DEEPSEEK_BASE_URL ||
  (typeof window !== 'undefined' ? `${window.location.origin}/deepseek` : '/deepseek');

export const DEFAULT_MODEL = import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat';

// ---------------------------------------------------------------------------
// Nachrichtenformat
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
}

export interface CompletionOptions {
  apiKey: string;
  model?: string;
  messages: ChatMessage[];
  tools?: unknown[];
  temperature?: number;
  signal?: AbortSignal;
  /** Wird fuer jedes Textstueck gerufen -- fuer die laufende Anzeige. */
  onDelta?: (chunk: string) => void;
}

export class DeepSeekError extends Error {
  // Ausgeschriebenes Feld statt Parameter-Property: das Projekt baut mit
  // erasableSyntaxOnly, und die Kurzform waere TypeScript-Syntax mit
  // Laufzeitwirkung -- genau das, was die Option ausschliesst.
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'DeepSeekError';
    this.status = status;
  }
}

/** Fehlermeldungen, die dem Nutzer sagen, was ER tun kann. */
function describeStatus(status: number, detail: string): string {
  if (status === 401) {
    return 'Der DeepSeek-API-Key wurde abgelehnt. Bitte im Zahnrad-Menü prüfen.';
  }
  if (status === 402) {
    return 'Das DeepSeek-Guthaben ist aufgebraucht. Bitte im DeepSeek-Konto aufladen.';
  }
  if (status === 429) {
    return 'DeepSeek meldet zu viele Anfragen. Bitte einen Moment warten.';
  }
  if (status >= 500) {
    return `DeepSeek ist momentan nicht erreichbar (${status}).`;
  }
  return detail || `DeepSeek-Anfrage fehlgeschlagen (${status}).`;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * Bruchstuecke von Werkzeugaufrufen zusammensetzen.
 *
 * Beim Streaming kommt ein Werkzeugaufruf NICHT am Stueck: Name und Id stehen
 * im ersten Bruchstueck, die Argumente tropfen zeichenweise ueber viele
 * weitere ein. Zusammengehalten werden sie ueber ``index`` -- nicht ueber die
 * Id, die in den Folgestuecken fehlt.
 */
function mergeToolCallDelta(
  acc: Map<number, ToolCall>,
  delta: {
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  },
): void {
  const index = delta.index ?? 0;
  const existing = acc.get(index) ?? {
    id: '',
    type: 'function' as const,
    function: { name: '', arguments: '' },
  };

  if (delta.id) existing.id = delta.id;
  if (delta.function?.name) existing.function.name = delta.function.name;
  // Argumente werden ANGEHAENGT, nicht ersetzt -- sonst bleibt vom JSON nur
  // das letzte Zeichen uebrig.
  if (delta.function?.arguments) existing.function.arguments += delta.function.arguments;

  acc.set(index, existing);
}

/**
 * Eine Runde beim Modell: Nachrichten hin, Text + etwaige Werkzeugaufrufe
 * zurueck.
 */
export async function complete(options: CompletionOptions): Promise<CompletionResult> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    messages,
    tools,
    temperature = 0.1,
    signal,
    onDelta,
  } = options;

  if (!apiKey) {
    throw new DeepSeekError('Kein DeepSeek-API-Key hinterlegt.');
  }

  let response: Response;
  try {
    response = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: true,
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new DeepSeekError(
      `DeepSeek nicht erreichbar: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
    );
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body) => body?.error?.message ?? '')
      .catch(() => '');
    throw new DeepSeekError(describeStatus(response.status, detail), response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new DeepSeekError('DeepSeek lieferte keinen Datenstrom.');

  const decoder = new TextDecoder();
  const toolCalls = new Map<number, ToolCall>();
  let content = '';
  let finishReason: string | null = null;
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE trennt Ereignisse durch Leerzeilen; das letzte Stueck kann
      // unvollstaendig sein und bleibt im Puffer.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<Parameters<typeof mergeToolCallDelta>[1]>;
              };
              finish_reason?: string | null;
            }>;
          };
          try {
            parsed = JSON.parse(payload);
          } catch {
            // Ein einzelnes unlesbares Stueck darf den Strom nicht abbrechen.
            continue;
          }

          const choice = parsed.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;

          const text = choice.delta?.content;
          if (text) {
            content += text;
            onDelta?.(text);
          }
          for (const delta of choice.delta?.tool_calls ?? []) {
            mergeToolCallDelta(toolCalls, delta);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    content,
    // Nach index sortieren, damit die Reihenfolge der Aufrufe der des Modells
    // entspricht -- die Zitatnummern haengen daran.
    toolCalls: [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
      .filter((call) => call.function.name),
    finishReason,
  };
}

/**
 * Argumente eines Werkzeugaufrufs lesen.
 *
 * Nachsichtig: ein Modell liefert gelegentlich abgeschnittenes oder in
 * Markdown eingefasstes JSON. Ein leeres Objekt ist die bessere Antwort als
 * ein Absturz -- das Werkzeug meldet dann selbst, welches Argument fehlt, und
 * das Modell kann es richtigstellen.
 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        /* faellt unten durch */
      }
    }
    const braced = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    if (braced) {
      try {
        return JSON.parse(braced);
      } catch {
        /* faellt unten durch */
      }
    }
    return {};
  }
}
