import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  FileText,
  Package,
  BookMarked,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { isDemoRole } from '../../config/roles';
import {
  planPodReset,
  executePodReset,
  selectPlanContainers,
  describeContainer,
  type ResetPlan,
  type ResetOutcome,
} from '../../services/podResetService';
import { forgetProcessesByContainer } from '../../services/processService';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';

/**
 * "Hochgeladene Dateien zuruecksetzen" — einzelne Vorgaenge oder der ganze Pod.
 *
 * Bewusst dreistufig: erst zeigen was getroffen wird (Vorschau), dann eine
 * ausdrueckliche Bestaetigung, erst danach loeschen. Der Nutzer soll nie auf
 * einen Knopf druecken, ohne die Liste gesehen zu haben — Loeschen im Pod ist
 * endgueltig, es gibt keinen Papierkorb.
 *
 * Die Vorgaenge sind einzeln abwaehlbar. Vorher gab es nur "alles oder nichts":
 * Wer einen Fallvorgang neu einspielen wollte, musste auch den Pflanzvorgang
 * loeschen und wieder hochladen, obwohl an dem nichts falsch war.
 *
 * Voreinstellung ist bewusst NICHTS ausgewaehlt. Bei einer Loeschaktion ist die
 * gefaehrliche Richtung das versehentliche Zuviel — wer alles will, hat den
 * Knopf "Alle auswaehlen" einen Klick entfernt.
 *
 * Ausnahme Demo-Rolle: Das Vorfuehrkonto raeumt nach jeder Vorfuehrung den
 * ganzen Pod; dort ist "alles" der Normalfall und wird vorausgewaehlt. Die
 * Bestaetigungsstufe bleibt.
 */

interface PodResetSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Wird nach erfolgreichem Reset gerufen, damit Ansichten neu laden. */
  onResetComplete?: () => void;
}

type Stage = 'loading' | 'preview' | 'confirm' | 'running' | 'done' | 'error';

export function PodResetSheet({ isOpen, onClose, onResetComplete }: PodResetSheetProps) {
  const { webId, role } = useAuth();
  const demoAccount = isDemoRole(role?.id);
  const [stage, setStage] = useState<Stage>('loading');
  const [plan, setPlan] = useState<ResetPlan | null>(null);
  const [outcome, setOutcome] = useState<ResetOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** URLs der zum Loeschen gewaehlten Vorgangs-Container. */
  const [selected, setSelected] = useState<string[]>([]);

  useBodyScrollLock(isOpen);

  const loadPlan = useCallback(async () => {
    if (!webId) return;
    setStage('loading');
    setError(null);
    try {
      const result = await planPodReset(webId);
      setPlan(result);
      // Nichts vorausgewaehlt (Demo-Konto: alles): siehe Kopfkommentar.
      setSelected(demoAccount ? result.containers.map((c) => c.url) : []);
      setStage('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vorschau fehlgeschlagen');
      setStage('error');
    }
  }, [webId, demoAccount]);

  useEffect(() => {
    if (isOpen && webId) {
      loadPlan();
    }
    if (!isOpen) {
      // Zuruecksetzen, damit das Sheet beim naechsten Oeffnen frisch zaehlt.
      setPlan(null);
      setOutcome(null);
      setError(null);
      setProgress(null);
      setSelected([]);
      setStage('loading');
    }
  }, [isOpen, webId, loadPlan]);

  const toggleContainer = (url: string) =>
    setSelected((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );

  /**
   * Der tatsaechlich auszufuehrende Plan — auf die Auswahl eingegrenzt.
   *
   * Alle Anzeigen unterhalb rechnen mit DIESEM Plan, nicht mit dem vollen:
   * Die Zahl im Loeschknopf und die in der Bestaetigung muessen dasselbe
   * meinen wie das, was gleich passiert.
   */
  const effectivePlan = plan ? selectPlanContainers(plan, selected) : null;

  const handleExecute = async () => {
    if (!effectivePlan) return;
    setStage('running');
    setProgress({ done: 0, total: 0 });
    try {
      const result = await executePodReset(effectivePlan, (done, total) =>
        setProgress({ done, total }),
      );
      // Den lokalen Vorgangsindex nachziehen: Er liegt im localStorage und
      // wuesste sonst nichts vom Loeschen — die Vorgangssuche zeigte weiter
      // Eintraege, deren Dateien es nicht mehr gibt.
      forgetProcessesByContainer(effectivePlan.containers.map((c) => c.url));
      setOutcome(result);
      setStage('done');
      onResetComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zuruecksetzen fehlgeschlagen');
      setStage('error');
    }
  };

  const nothingToDelete =
    plan !== null && plan.containers.length === 0 && plan.catalogEntries.length === 0;
  const allSelected =
    plan !== null && plan.containers.length > 0 && selected.length === plan.containers.length;

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night-950/70 backdrop-blur-sm"
            onClick={stage === 'running' ? undefined : onClose}
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full sm:max-w-xl bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[92%] sm:max-h-[85%] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Griff (mobil) */}
              <div className="sm:hidden flex justify-center pt-3">
                <div className="w-10 h-1 rounded-full bg-white/15" />
              </div>

              {/* Kopf */}
              <div className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3 flex-shrink-0">
                <h2 className="text-xl font-bold text-white">Vorgänge löschen</h2>
                <button
                  onClick={onClose}
                  disabled={stage === 'running'}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors disabled:opacity-40"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex-1 min-h-0 overflow-y-auto scroll-touch space-y-5">
                {!webId && (
                  <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
                    Bitte zuerst anmelden — zurückgesetzt wird immer nur der eigene Pod.
                  </div>
                )}

                {stage === 'loading' && (
                  <div className="flex items-center gap-3 py-8 justify-center text-night-300">
                    <Loader2 className="w-5 h-5 animate-spin text-acid-300" />
                    <span className="text-sm">Pod wird durchsucht …</span>
                  </div>
                )}

                {stage === 'error' && (
                  <div className="space-y-4">
                    <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
                      {error}
                    </div>
                    <button
                      onClick={loadPlan}
                      className="w-full py-3 rounded-2xl bg-night-700 border border-white/10 text-white text-sm font-semibold hover:bg-night-700/70 transition-colors"
                    >
                      Erneut versuchen
                    </button>
                  </div>
                )}

                {/* ---------------- Vorschau ---------------- */}
                {(stage === 'preview' || stage === 'confirm') && plan && (
                  <>
                    {/* Was geschützt bleibt — zuerst, damit die Sorge gleich beantwortet ist */}
                    <div className="bg-acid-400/10 border border-acid-400/30 rounded-2xl p-4">
                      <div className="flex items-center gap-2 text-acid-200 text-xs uppercase tracking-[0.16em] font-bold mb-2">
                        <ShieldCheck className="w-4 h-4" />
                        Bleibt unangetastet
                      </div>
                      <p className="text-xs text-night-200 leading-relaxed">
                        Profil und Rolle, Zugriffsregeln, Wallet-Guthaben, der Katalog
                        selbst sowie alle öffentlichen und fremden Daten. Zurückgesetzt
                        werden ausschließlich die von dieser App hochgeladenen Vorgänge in
                        Ihrem eigenen Pod.
                      </p>
                    </div>

                    {nothingToDelete ? (
                      <div className="flex items-center gap-3 px-4 py-4 bg-night-700/50 border border-white/10 rounded-2xl">
                        <CheckCircle2 className="w-5 h-5 text-acid-300 flex-shrink-0" />
                        <span className="text-sm text-night-200">
                          Es sind keine hochgeladenen Dateien vorhanden — der Pod ist
                          bereits im Urzustand.
                        </span>
                      </div>
                    ) : (
                      <>
                        {/* Zusammenfassung */}
                        {/* Auf schmalen Telefonen blieben je Kachel nur ~103px
                            -- bei vierstelligen Zahlen sprengt das die Spalte,
                            weil Grid-Spuren nicht unter ihren Inhalt gehen. */}
                        {/* Zahlen der AUSWAHL, nicht des ganzen Pods — sie
                            muessen dasselbe meinen wie der Loeschknopf. */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <SummaryTile
                            icon={<Package className="w-4 h-4" />}
                            value={effectivePlan?.containers.length ?? 0}
                            label="Vorgänge"
                          />
                          <SummaryTile
                            icon={<FileText className="w-4 h-4" />}
                            value={effectivePlan?.fileCount ?? 0}
                            label="Dateien"
                          />
                          <SummaryTile
                            icon={<BookMarked className="w-4 h-4" />}
                            value={effectivePlan?.catalogEntries.length ?? 0}
                            label="Katalog"
                          />
                        </div>

                        {/* Liste der Vorgänge — einzeln auswählbar */}
                        <div>
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <h3 className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase">
                              Zu löschende Vorgänge wählen
                            </h3>
                            <button
                              onClick={() =>
                                setSelected(
                                  allSelected ? [] : plan.containers.map((c) => c.url),
                                )
                              }
                              disabled={stage === 'confirm'}
                              className="text-[11px] font-semibold text-acid-300 hover:text-acid-200 transition-colors disabled:opacity-40 flex-shrink-0"
                            >
                              {allSelected ? 'Auswahl aufheben' : 'Alle auswählen'}
                            </button>
                          </div>
                          <div className="space-y-2">
                            {plan.containers.map((container) => {
                              const isOn = selected.includes(container.url);
                              const desc = describeContainer(container);
                              return (
                                <button
                                  key={container.url}
                                  onClick={() => toggleContainer(container.url)}
                                  disabled={stage === 'confirm'}
                                  className={`w-full text-left px-4 py-3 rounded-2xl border transition-colors disabled:opacity-60 ${
                                    isOn
                                      ? 'bg-red-500/10 border-red-500/40'
                                      : 'bg-night-700/50 border-white/5'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <div
                                      className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${
                                        isOn ? 'bg-red-500/80' : 'border border-white/20'
                                      }`}
                                    >
                                      {isOn && <Trash2 className="w-3 h-3 text-white" />}
                                    </div>
                                    <span className="flex-1 min-w-0">
                                      <span className="block text-sm font-semibold text-white truncate">
                                        {desc.title}
                                      </span>
                                      {desc.subtitle && (
                                        <span className="block text-[11px] text-night-400 truncate mt-0.5">
                                          {desc.subtitle}
                                        </span>
                                      )}
                                    </span>
                                    <span className="text-xs text-night-400 flex-shrink-0 tabular-nums">
                                      {container.files.length}{' '}
                                      {container.files.length === 1 ? 'Datei' : 'Dateien'}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          {selected.length === 0 && (
                            <p className="mt-3 text-[11px] text-night-400 leading-relaxed">
                              Wählen Sie die Vorgänge, die gelöscht werden sollen. Alle
                              übrigen bleiben unverändert im Pod.
                            </p>
                          )}
                        </div>
                      </>
                    )}

                    {/* Fremde Vorgänge, die stehen bleiben */}
                    {plan.foreign.length > 0 && (
                      <div className="px-4 py-3 bg-night-700/40 border border-white/10 rounded-2xl">
                        <div className="text-xs font-bold text-night-200 mb-1.5">
                          {plan.foreign.length}{' '}
                          {plan.foreign.length === 1 ? 'Vorgang stammt' : 'Vorgänge stammen'}{' '}
                          von anderen Akteuren
                        </div>
                        <p className="text-[11px] text-night-400 leading-relaxed">
                          {plan.foreign.map((c) => describeContainer(c).title).join(', ')} —
                          bleiben erhalten, da sie nicht von Ihnen hochgeladen wurden.
                        </p>
                      </div>
                    )}

                    {plan.warnings.length > 0 && (
                      <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
                        <div className="flex items-center gap-2 text-amber-300 text-xs font-bold mb-1.5">
                          <AlertTriangle className="w-4 h-4" />
                          Hinweise
                        </div>
                        <ul className="text-[11px] text-amber-200/90 leading-relaxed space-y-1">
                          {plan.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Aktion */}
                    {!nothingToDelete && stage === 'preview' && (
                      <button
                        onClick={() => setStage('confirm')}
                        disabled={selected.length === 0}
                        className="w-full py-3.5 rounded-2xl bg-red-500/15 border border-red-500/40 text-red-300 text-sm font-bold hover:bg-red-500/25 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:hover:bg-red-500/15"
                      >
                        <Trash2 className="w-4 h-4" />
                        {selected.length === 0
                          ? 'Nichts ausgewählt'
                          : `${effectivePlan?.fileCount ?? 0} ${
                              (effectivePlan?.fileCount ?? 0) === 1 ? 'Datei' : 'Dateien'
                            } löschen`}
                      </button>
                    )}

                    {/* Zweite Stufe: ausdrückliche Bestätigung */}
                    {stage === 'confirm' && effectivePlan && (
                      <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center gap-2 text-red-300 text-sm font-bold">
                          <AlertTriangle className="w-4 h-4" />
                          Wirklich löschen?
                        </div>
                        <p className="text-xs text-red-200/90 leading-relaxed">
                          {effectivePlan.fileCount} Dateien in{' '}
                          {effectivePlan.containers.length}{' '}
                          {effectivePlan.containers.length === 1 ? 'Vorgang' : 'Vorgängen'}{' '}
                          und {effectivePlan.catalogEntries.length} Katalog-Einträge werden
                          endgültig entfernt. Ein Solid Pod hat keinen Papierkorb — das
                          lässt sich nicht rückgängig machen.
                        </p>
                        {/* Was NICHT angefasst wird, ausdruecklich benennen —
                            das ist der Zweck der Einzelauswahl. */}
                        {effectivePlan.containers.length < plan.containers.length && (
                          <p className="text-xs text-night-300 leading-relaxed">
                            Unberührt bleiben:{' '}
                            {plan.containers
                              .filter((c) => !selected.includes(c.url))
                              .map((c) => describeContainer(c).title)
                              .join(', ')}
                            .
                          </p>
                        )}
                        <div className="flex gap-3">
                          <button
                            onClick={() => setStage('preview')}
                            className="flex-1 py-3 rounded-xl bg-night-700 border border-white/10 text-white text-sm font-semibold hover:bg-night-700/70 transition-colors"
                          >
                            Abbrechen
                          </button>
                          <button
                            onClick={handleExecute}
                            className="flex-1 py-3 rounded-xl bg-red-500/80 text-white text-sm font-bold hover:bg-red-500 transition-colors"
                          >
                            Endgültig löschen
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ---------------- Läuft ---------------- */}
                {stage === 'running' && (
                  <div className="py-8 space-y-4">
                    <div className="flex items-center gap-3 justify-center text-night-200">
                      <Loader2 className="w-5 h-5 animate-spin text-acid-300" />
                      <span className="text-sm">Wird zurückgesetzt …</span>
                    </div>
                    {progress && progress.total > 0 && (
                      <>
                        <div className="h-1.5 bg-night-700 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-acid-400"
                            animate={{
                              width: `${Math.round((progress.done / progress.total) * 100)}%`,
                            }}
                            transition={{ duration: 0.2 }}
                          />
                        </div>
                        <div className="text-center text-xs text-night-400 tabular-nums">
                          {progress.done} / {progress.total}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ---------------- Ergebnis ---------------- */}
                {stage === 'done' && outcome && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 px-4 py-4 bg-acid-400/10 border border-acid-400/30 rounded-2xl">
                      <CheckCircle2 className="w-5 h-5 text-acid-300 flex-shrink-0" />
                      <span className="text-sm text-acid-200">
                        {outcome.deletedFiles} Dateien, {outcome.deletedContainers}{' '}
                        {outcome.deletedContainers === 1 ? 'Vorgang' : 'Vorgänge'} und{' '}
                        {outcome.deletedCatalogEntries} Katalog-Einträge entfernt.
                      </span>
                    </div>

                    {outcome.errors.length > 0 && (
                      <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
                        <div className="flex items-center gap-2 text-amber-300 text-xs font-bold mb-1.5">
                          <AlertTriangle className="w-4 h-4" />
                          {outcome.errors.length} Vorgänge konnten nicht gelöscht werden
                        </div>
                        <ul className="text-[11px] text-amber-200/90 leading-relaxed space-y-1 max-h-40 overflow-y-auto">
                          {outcome.errors.map((e, i) => (
                            <li key={i} className="break-all">
                              {e}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <button
                      onClick={onClose}
                      className="w-full py-3 rounded-2xl bg-night-700 border border-white/10 text-white text-sm font-semibold hover:bg-night-700/70 transition-colors"
                    >
                      Schließen
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}

function SummaryTile({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="bg-night-700/50 border border-white/5 rounded-2xl px-3 py-3 text-center min-w-0">
      <div className="flex items-center justify-center text-night-300 mb-1">{icon}</div>
      <div className="text-xl font-bold text-white tabular-nums truncate">{value}</div>
      <div className="text-[10px] text-night-400 uppercase tracking-wider truncate">{label}</div>
    </div>
  );
}
