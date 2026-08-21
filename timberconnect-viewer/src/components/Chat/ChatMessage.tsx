import { motion } from 'framer-motion';
import { Bot, User } from 'lucide-react';
import type { ChatMessageData, CalculationResult } from './types';
import { ChartDisplay } from './ChartDisplay';
import { ChatToolTrace } from './ChatToolTrace';

interface ChatMessageProps {
  message: ChatMessageData;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`flex gap-2 max-w-[90%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        {isAssistant && (
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-acid-400 flex items-center justify-center">
            <Bot className="w-4 h-4 text-night-950" />
          </div>
        )}
        {isUser && (
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-night-600 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
        )}

        {/* Message Content */}
        <div className="flex flex-col gap-2">
          <div
            className={`px-4 py-2.5 text-sm leading-relaxed ${
              isUser
                ? 'bg-acid-400 text-night-950 rounded-2xl rounded-br-md'
                : 'bg-night-700 border border-white/5 text-night-100 rounded-2xl rounded-bl-md'
            }`}
          >
            {/* Render markdown-like content */}
            <MessageContent content={message.content} />
          </div>

          {/* Chart/Visualization */}
          {message.metadata?.hasImage && message.metadata.imageBase64 && (
            <ChartDisplay
              imageBase64={message.metadata.imageBase64}
              chartType={message.metadata.chartType}
            />
          )}

          {/* Calculation Result */}
          {message.metadata?.calculationResult && (
            <CalculationResultDisplay result={message.metadata.calculationResult} />
          )}

          {/* Womit die Antwort belegt ist -- zugeklappt, aber pruefbar. */}
          {isAssistant && message.traces && message.traces.length > 0 && (
            <ChatToolTrace traces={message.traces} />
          )}

          {/* Timestamp */}
          <span className={`text-[10px] text-night-400 ${isUser ? 'text-right' : 'text-left'}`}>
            {formatTime(message.timestamp)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Antworttext darstellen -- als React-Knoten, NICHT als HTML.
 *
 * Frueher lief der Text durch ``dangerouslySetInnerHTML``, nachdem eine
 * Regex Sternchen in <strong>/<em> umgeschrieben hatte. Alles andere aus der
 * Modellantwort landete damit ungefiltert im DOM: eine Antwort, die (etwa aus
 * einem Datenfeld im Pod) ein <script>- oder ein onerror-Attribut mitbringt,
 * waere ausgefuehrt worden. Genau deshalb wird hier jetzt zerlegt und als
 * Text-Knoten ausgegeben -- React maskiert dabei selbsttaetig.
 *
 * Erkannt werden bewusst nur drei Dinge: **fett**, *kursiv* und Zitate der
 * Form [Q3.variable]. Mehr Markdown braucht diese Oberflaeche nicht.
 */
// Zitate mit ODER ohne Klammern -- dieselbe Toleranz wie in agentLoop.ts
// (CITATION): Modelle lassen die Klammern in Tabellenzellen oft weg, und ein
// als Rohtext stehengebliebenes "Q3.holzart" liest sich wie ein Fehler.
const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|\[Q\d+(?:\.[^\]]*)?\]|\bQ\d+\.[A-Za-z_][\w-]*)/g;

function renderInline(text: string, keyPrefix: string) {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!part) return null;

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    // Zitat: der Beleg, welche Abfrage diese Aussage stuetzt. Optisch
    // zurueckgenommen, damit der Lesefluss nicht zerhackt wird -- aber
    // sichtbar, denn daran haengt auch die Abrechnung.
    if (/^\[?Q\d+\./.test(part)) {
      return (
        <sup
          key={key}
          className="ml-0.5 px-1 rounded bg-acid-400/15 text-acid-300 font-mono text-[10px]"
          title="Beleg: Nummer der Abfrage, aus der diese Angabe stammt"
        >
          {part.replace(/^\[|\]$/g, '')}
        </sup>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

/** Zellen einer Markdown-Tabellenzeile: | a | b | -> ['a','b'] */
const cellsOf = (line: string) =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
/** Trennzeile |---|---| — traegt keine Daten. */
const isTableDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

/**
 * Eine Tabelle -- das eigentliche Ergebnisformat des Assistenten.
 *
 * Der Systemprompt verlangt ab drei zusammengehoerenden Werten eine Tabelle,
 * damit Daten GEZEIGT statt beschrieben werden. Ohne diese Darstellung kaeme
 * beim Nutzer die Markdown-Rohform an (| Merkmal | Wert |), was schlechter
 * lesbar waere als Fliesstext -- die Anweisung im Prompt braucht hier ihre
 * Entsprechung.
 *
 * Eigener Scrollbereich, damit breite Tabellen die Blase nicht sprengen.
 */
function MarkdownTable({ rows, keyPrefix }: { rows: string[]; keyPrefix: string }) {
  const [head, ...rest] = rows;
  const body = rest.filter((r) => !isTableDivider(r));

  return (
    <div className="my-2 -mx-1 overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-white/15">
            {cellsOf(head).map((cell, i) => (
              <th key={i} className="px-2 py-1.5 text-left font-semibold text-white align-top">
                {renderInline(cell, `${keyPrefix}-h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-b border-white/5 last:border-0">
              {cellsOf(row).map((cell, c) => (
                <td key={c} className="px-2 py-1.5 align-top text-night-100">
                  {renderInline(cell, `${keyPrefix}-r${r}c${c}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Zusammenhaengende Tabellenzeilen einsammeln und als Tabelle ausgeben.
    if (isTableRow(line)) {
      const rows: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      i--;
      // Eine einzelne Zeile ist keine Tabelle -- dann lieber als Text zeigen,
      // statt eine Kopfzeile ohne Inhalt zu rendern.
      if (rows.filter((r) => !isTableDivider(r)).length >= 2) {
        blocks.push(<MarkdownTable key={`t${i}`} rows={rows} keyPrefix={`t${i}`} />);
        continue;
      }
      for (const row of rows) blocks.push(<p key={`p${i}-${row}`}>{renderInline(row, `p${i}`)}</p>);
      continue;
    }

    if (line.startsWith('- ')) {
      blocks.push(
        <div key={i} className="flex gap-2">
          <span className="text-acid-300">•</span>
          <span>{renderInline(line.slice(2), `l${i}`)}</span>
        </div>,
      );
      continue;
    }

    // Ueberschriften (## Herkunft) -- der Agent gliedert laengere Antworten.
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={i} className="font-semibold text-white mt-2">
          {renderInline(heading[2], `h${i}`)}
        </p>,
      );
      continue;
    }

    if (!line.trim()) {
      blocks.push(<div key={i} className="h-2" />);
      continue;
    }
    blocks.push(<p key={i}>{renderInline(line, `p${i}`)}</p>);
  }

  return <div className="space-y-1">{blocks}</div>;
}

function CalculationResultDisplay({ result }: { result: CalculationResult }) {
  if (!result) return null;

  return (
    <div className="bg-acid-400/10 border border-acid-400/30 rounded-xl p-3 text-sm">
      <div className="font-semibold text-acid-300 mb-2">{result.description}</div>
      {result.value !== null && (
        <div className="text-2xl font-bold text-acid-200">
          {typeof result.value === 'number' ? result.value.toLocaleString('de-DE') : result.value} {result.unit}
        </div>
      )}
      {result.details && result.details.length > 0 && (
        <div className="mt-2 space-y-1 text-xs text-night-300">
          {result.details.map((detail, idx) => (
            <div key={idx} className="flex justify-between">
              <span>{detail.category}:</span>
              <span className="font-medium">
                {detail.value} {detail.unit || ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {result.note && (
        <div className="mt-2 text-xs text-night-400 italic">{result.note}</div>
      )}
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
