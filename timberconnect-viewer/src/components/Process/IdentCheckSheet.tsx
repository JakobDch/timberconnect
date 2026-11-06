import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Ban,
  Fingerprint,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import type {
  DocumentVerdict,
  PreflightSummary,
} from '../../services/uploadPreflightService';

/**
 * Ergebnis der Vorab-Pruefung: Sind die Material-IDs schon vergeben?
 *
 * Steht VOR jedem anderen Vorschaltschritt (Flaeche, Herkunft, Pruefansicht):
 * Wer gesperrt ist, soll nicht erst eine Flaeche zeichnen, um es dann zu
 * erfahren. Zwei Ausgaenge erreichen diese Ansicht ueberhaupt -- "frei"
 * laeuft ohne Dialog weiter:
 *
 *   ersetzen  Der eigene, inhaltsgleiche Vorgang liegt schon vor. Die Frage
 *             ist eine echte Entscheidung (die alten Produktdaten gehen
 *             verloren), deshalb nie automatisch.
 *   gesperrt  Die IDs gehoeren jemand anderem oder niemandem. Es gibt nur
 *             "Verstanden"; der Entwurf bleibt stehen, damit die Datei
 *             getauscht werden kann.
 *
 * Die Texte kommen aus summarizePreflight und sind fuer Teilnehmer der Kette
 * geschrieben -- ohne Repository, Events oder URNs.
 */

interface IdentCheckSheetProps {
  isOpen: boolean;
  /** null = die Pruefung laeuft noch. */
  summary: PreflightSummary | null;
  /** Ersetzen wird vorbereitet (Container suchen). */
  busy?: boolean;
  onReplace: () => void;
  /** Schliessen ohne Upload -- bei Sperre wie bei Abbruch. */
  onClose: () => void;
}

const STATUS_LABEL: Record<DocumentVerdict['status'], string> = {
  free: 'frei',
  'own-identical': 'bereits von Ihnen registriert',
  'own-different': 'von Ihnen mit anderen IDs registriert',
  foreign: 'bei einem anderen Teilnehmer',
  unassigned: 'vergeben, ohne Zuordnung',
};

export function IdentCheckSheet({
  isOpen,
  summary,
  busy = false,
  onReplace,
  onClose,
}: IdentCheckSheetProps) {
  useBodyScrollLock(isOpen);

  const isReplace = summary?.outcome === 'replace';

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-night-950/70 backdrop-blur-sm flex items-stretch justify-center"
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full h-full sm:h-auto sm:max-h-[90%] sm:my-auto sm:max-w-xl bg-night-800 sm:border border-white/10 sm:rounded-3xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
            >
              {/* Kopf */}
              <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-white/10">
                <div className="min-w-0 flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                      summary === null
                        ? 'bg-white/5 border-white/10'
                        : isReplace
                          ? 'bg-amber-500/15 border-amber-500/30'
                          : 'bg-red-500/15 border-red-500/30'
                    }`}
                  >
                    {summary === null ? (
                      <Loader2 className="w-5 h-5 text-acid-300 animate-spin" />
                    ) : isReplace ? (
                      <RefreshCw className="w-5 h-5 text-amber-300" />
                    ) : (
                      <Ban className="w-5 h-5 text-red-300" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-xl font-bold text-white">
                      {summary === null ? 'Material-IDs werden geprüft' : summary.title}
                    </h2>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  disabled={busy}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-50"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              {/* Inhalt */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
                {summary === null ? (
                  <div className="flex items-center gap-3 text-night-300 py-8 justify-center">
                    <ShieldCheck className="w-5 h-5 text-acid-300" />
                    <span className="text-sm">Abgleich läuft...</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-night-100 leading-relaxed">{summary.message}</p>

                    {/* Je Dokument: Beschriftung + Befund. Die IDs selbst
                        bleiben eingeklappt -- fuer die Entscheidung reicht
                        das Dokument, die Nummern sind nur Beiwerk. */}
                    <div className="space-y-2">
                      {summary.verdicts.map((v) => (
                        <div
                          key={v.label}
                          className="flex items-start gap-3 px-4 py-3 rounded-2xl border border-white/10 bg-night-700/30"
                        >
                          <Fingerprint className="w-4 h-4 text-night-300 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white truncate">{v.label}</p>
                            <p className="text-xs text-night-300 mt-0.5">
                              {STATUS_LABEL[v.status]}
                              {v.takenEpcs.length > 0 &&
                                ` · ${v.takenEpcs.length === 1 ? '1 Material-ID' : `${v.takenEpcs.length} Material-IDs`}`}
                            </p>
                            {v.takenEpcs.length > 0 && (
                              <details className="mt-1.5">
                                <summary className="text-[11px] text-night-400 cursor-pointer select-none">
                                  IDs anzeigen
                                </summary>
                                <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                                  {v.takenEpcs.map((epc) => (
                                    <code
                                      key={epc}
                                      className="block text-[11px] text-night-300 font-mono break-all"
                                    >
                                      {epc}
                                    </code>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {summary.notes.map((note) => (
                      <div
                        key={note}
                        className="flex items-start gap-3 px-4 py-3 bg-night-700/50 border border-white/10 rounded-xl"
                      >
                        <Info className="w-4 h-4 text-night-300 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-night-300 leading-relaxed">{note}</p>
                      </div>
                    ))}

                    {isReplace && (
                      <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-200/90 leading-relaxed">
                          Beim Ersetzen werden die bisherigen Dateien dieses
                          Vorgangs aus Ihrem Pod entfernt und durch die neuen
                          ersetzt. Das lässt sich nicht rückgängig machen.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Entscheidung */}
              <div className="border-t border-white/10 px-5 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {isReplace ? (
                  <>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2.5 rounded-xl bg-night-700/60 hover:bg-night-700 text-night-200 text-sm font-semibold transition-colors disabled:opacity-50"
                      >
                        Abbrechen
                      </button>
                      <button
                        onClick={onReplace}
                        disabled={busy}
                        className="btn btn-acid flex-1"
                      >
                        {busy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        <span>Vorhandene Daten ersetzen</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={onClose}
                    disabled={summary === null}
                    className="btn btn-night w-full"
                  >
                    Verstanden
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
