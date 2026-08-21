import { motion, AnimatePresence } from 'framer-motion';
import { Layers, X, AlertCircle } from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { ScanSourceBadge } from './ScanSourceBadge';
import { describeProblem } from '../../services/identifiers';
import type { ParsedIdentifier } from '../../services/identifiers';

/**
 * Auswahl nach einem Mehrfach-Scan (typisch: RFID-Sweep ueber eine Palette).
 *
 * Bewusst eine Auswahlliste und kein Stapelabruf: jede Abfrage kostet
 * EPCAT- und Pod-Anfragen und laeuft durch die Token-Bezahlschranke. Der
 * Nutzer waehlt genau das Bauteil, das ihn interessiert.
 */

interface MultiTagSheetProps {
  items: ParsedIdentifier[] | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Artikel = Praefix + Artikelnummer, ohne die Seriennummer. */
function articleKey(p: ParsedIdentifier): string {
  const id = p.urn ?? p.candidates?.[0];
  if (id) {
    const parts = id.split(':').pop()?.split('.') ?? [];
    if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  }
  return p.gtin ?? 'Unbekannt';
}

/** Der Teil, der das einzelne Stueck bezeichnet. */
function pieceLabel(p: ParsedIdentifier): string {
  return p.serial ?? p.lot ?? p.urn?.split('.').pop() ?? p.raw;
}

export function MultiTagSheet({ items, onSelect, onClose }: MultiTagSheetProps) {
  const isOpen = !!items && items.length > 0;
  useBodyScrollLock(isOpen);

  // Nach Artikel gruppieren: ein Sweep ueber eine Palette liefert sonst
  // dutzende gleichartige Zeilen.
  const groups = new Map<string, ParsedIdentifier[]>();
  for (const item of items ?? []) {
    const key = articleKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const source = items?.[0]?.source ?? null;

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night-950/70 backdrop-blur-sm"
            onClick={onClose}
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full sm:max-w-md bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/50 max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Kopf */}
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-bold tracking-[0.14em] text-acid-300 uppercase">
                      {items!.length} Tags erfasst
                    </p>
                    <ScanSourceBadge source={source} />
                  </div>
                  <h2 className="text-lg font-bold text-white mt-1">
                    Bauteil auswählen
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              {/* Gruppierte Liste */}
              <div className="overflow-y-auto -mx-1 px-1 space-y-4">
                {[...groups].map(([key, entries]) => (
                  <section key={key}>
                    <h3 className="text-[11px] font-bold tracking-[0.14em] text-night-300 uppercase mb-2 flex items-center justify-between">
                      <span className="font-mono normal-case tracking-normal text-night-200">
                        {key}
                      </span>
                      <span>{entries.length} Stück</span>
                    </h3>
                    <div className="space-y-2">
                      {entries.map((entry, index) => {
                        const id = entry.urn ?? entry.candidates?.[0] ?? null;
                        const problem = describeProblem(entry);
                        return (
                          <button
                            key={`${key}-${index}-${pieceLabel(entry)}`}
                            onClick={() => id && onSelect(id)}
                            disabled={!id}
                            className="w-full flex items-center gap-3 px-4 py-3 bg-night-900/70 hover:bg-night-700 border border-white/5 rounded-2xl transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <div className="w-9 h-9 rounded-xl bg-night-700 border border-white/5 flex items-center justify-center flex-shrink-0">
                              {id ? (
                                <Layers className="w-4 h-4 text-acid-300" />
                              ) : (
                                <AlertCircle className="w-4 h-4 text-amber-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-mono font-semibold text-white truncate">
                                {pieceLabel(entry)}
                              </p>
                              {problem && (
                                <p className="text-xs text-amber-300/90 mt-0.5 truncate">
                                  {problem}
                                </p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <button onClick={onClose} className="btn btn-night w-full mt-4 flex-shrink-0">
                Abbrechen
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
