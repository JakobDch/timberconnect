import { useState } from 'react';
import { ChevronDown, Database, Link2, Search, AlertTriangle } from 'lucide-react';
import type { ToolCallTrace } from './types';

/**
 * Womit eine Antwort belegt ist -- aufklappbar unter der Nachricht.
 *
 * Der Assistent darf nur Daten des gescannten Bauteils ausgeben. Diese Trace
 * ist die Stelle, an der sich das nachpruefen laesst, statt es glauben zu
 * muessen: welche Abfrage lief, wozu, mit wie vielen Treffern -- und die
 * Abfrage selbst im Klartext.
 *
 * Zugeklappt, weil es die Antwort ist, die zaehlt. Aber vorhanden, weil eine
 * unpruefbare Antwort in diesem Kontext wenig wert waere.
 */

interface ChatToolTraceProps {
  traces: ToolCallTrace[];
}

export function ChatToolTrace({ traces }: ChatToolTraceProps) {
  const [open, setOpen] = useState(false);
  if (traces.length === 0) return null;

  const failed = traces.filter((t) => !t.ok).length;
  const queries = traces.filter((t) => t.name === 'run_sparql' && t.kind === 'data').length;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs text-night-300 hover:text-white transition-colors"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        <span>
          {queries} Abfrage{queries === 1 ? '' : 'n'}
          {failed > 0 ? `, ${failed} korrigiert` : ''}
        </span>
      </button>

      {open && (
        <ol className="mt-2 space-y-2 border-l border-white/10 pl-3">
          {traces.map((trace, i) => (
            <li key={i} className="text-xs">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0 text-night-300">
                  {trace.name === 'get_related_epcs' ? (
                    <Link2 className="w-3.5 h-3.5" />
                  ) : trace.kind === 'probe' ? (
                    <Search className="w-3.5 h-3.5" />
                  ) : (
                    <Database className="w-3.5 h-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Nur echte Datenabfragen tragen eine Zitatnummer -- an
                        ihr haengt die Abrechnung. */}
                    {trace.index > 0 && (
                      <code className="px-1 py-0.5 rounded bg-acid-400/15 text-acid-300 font-mono">
                        Q{trace.index}
                      </code>
                    )}
                    {trace.kind === 'probe' && (
                      <span className="text-night-400">Sondierung</span>
                    )}
                    <span className="text-night-100">{trace.purpose}</span>
                  </div>

                  <div className="mt-0.5 text-night-400">
                    {trace.ok ? (
                      <>
                        {trace.rowCount ?? 0} Treffer
                        {trace.truncated && ' (gekürzt)'}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-300/90">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        {trace.error ?? 'fehlgeschlagen'}
                      </span>
                    )}
                  </div>

                  {trace.query && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-night-400 hover:text-night-300">
                        SPARQL
                      </summary>
                      {/* Eigener Scrollbereich: lange Abfragezeilen duerfen
                          die Seite nicht seitlich schieben. */}
                      <pre className="mt-1 p-2 rounded-lg bg-night-950 border border-white/5 overflow-x-auto text-[11px] leading-relaxed text-night-200">
                        {trace.query}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
