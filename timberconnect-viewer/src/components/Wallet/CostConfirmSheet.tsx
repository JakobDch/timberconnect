import { motion, AnimatePresence } from 'framer-motion';
import { Coins, Loader2, AlertTriangle, LogIn, Database, CheckCircle2 } from 'lucide-react';
import type { CostEstimate } from '../../services/pricingService';
import { shortenWebId, TOKEN_SYMBOL } from '../../services/walletService';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';

/**
 * Kosten-Bestätigung vor jedem kostenpflichtigen Datenabruf:
 * zeigt Preis (Datenpunkte), Empfänger und Guthaben — Daten werden erst
 * NACH Bestätigung angezeigt und die Token erst dann transferiert.
 */

interface CostConfirmSheetProps {
  isOpen: boolean;
  estimate: CostEstimate | null;
  balance: number | null;
  isLoggedIn: boolean;
  isPaying: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onBuyTokens: () => void;
  onLogin: () => void;
}

export function CostConfirmSheet({
  isOpen,
  estimate,
  balance,
  isLoggedIn,
  isPaying,
  onConfirm,
  onCancel,
  onBuyTokens,
  onLogin,
}: CostConfirmSheetProps) {
  const total = estimate?.totalTokens ?? 0;
  const insufficient = isLoggedIn && balance !== null && balance < total;
  const canConfirm = isLoggedIn && !insufficient && !isPaying;

  useBodyScrollLock(isOpen);

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && estimate && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night-950/70 backdrop-blur-sm"
          onClick={isPaying ? undefined : onCancel}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="w-full sm:max-w-lg bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[92%] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Griff (mobil) */}
            <div className="sm:hidden flex justify-center pt-3">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>

            <div className="px-5 sm:px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex-1 min-h-0 overflow-y-auto space-y-4">
              <h2 className="text-xl font-bold text-white">
                Kostenpflichtiger Datenabruf
              </h2>
              <p className="text-sm text-night-300">
                Diese Daten stammen von anderen Teilnehmern. Berechnet werden nur die
                tatsächlich abgerufenen Datenpunkte (1 {TOKEN_SYMBOL} pro Datenpunkt),
                nicht der Gesamtwert der Quelldateien. Bereits gekaufte Datenpunkte
                werden nicht erneut berechnet.
              </p>

              {/* Gesamtpreis */}
              <div className="bg-acid-400/10 border border-acid-400/30 rounded-2xl p-5 text-center">
                <div className="flex items-center justify-center gap-2 text-night-300 text-xs uppercase tracking-[0.16em] font-bold mb-2">
                  <Coins className="w-4 h-4 text-acid-300" />
                  Gesamtpreis
                </div>
                <div className="text-3xl font-bold text-acid-300 tabular-nums">
                  {total.toLocaleString('de-DE')} <span className="text-base">{TOKEN_SYMBOL}</span>
                </div>
                <p className="text-xs text-night-400 mt-1">
                  {estimate.items.reduce((s, i) => s + i.datapoints, 0).toLocaleString('de-DE')}{' '}
                  abgerufene Datenpunkte aus {estimate.items.length} Datenquelle(n)
                  {estimate.ownDatapoints > 0 &&
                    ` — ${estimate.ownDatapoints.toLocaleString('de-DE')} weitere kostenlos (eigener Anteil)`}
                </p>
              </div>

              {/* Bereits gekauft: was hier nicht erneut berechnet wird */}
              {estimate.alreadyOwnedDatapoints > 0 && (
                <div className="flex items-start gap-3 px-4 py-3 bg-acid-400/10 border border-acid-400/30 rounded-xl">
                  <CheckCircle2 className="w-5 h-5 text-acid-300 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-acid-200">
                    <span className="font-bold">
                      {estimate.alreadyOwnedDatapoints.toLocaleString('de-DE')} von{' '}
                      {estimate.totalDatapoints.toLocaleString('de-DE')}
                    </span>{' '}
                    Datenpunkten haben Sie bereits gekauft — Sie zahlen nur für{' '}
                    <span className="font-bold">
                      {(
                        estimate.totalDatapoints - estimate.alreadyOwnedDatapoints
                      ).toLocaleString('de-DE')}
                    </span>{' '}
                    neue.
                  </p>
                </div>
              )}

              {/* Aufschlüsselung pro Empfänger */}
              <div className="space-y-2">
                {estimate.byRecipient.map((r) => (
                  <div
                    key={r.recipientWebId}
                    className="flex items-center gap-3 px-4 py-3 bg-night-700/50 border border-white/5 rounded-2xl"
                  >
                    <div className="w-8 h-8 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
                      <Database className="w-4 h-4 text-acid-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {shortenWebId(r.recipientWebId)}
                      </p>
                      <p className="text-xs text-night-400">
                        {r.datapoints.toLocaleString('de-DE')} Datenpunkte
                      </p>
                    </div>
                    <span className="text-sm font-bold text-acid-300 tabular-nums flex-shrink-0">
                      {r.tokens.toLocaleString('de-DE')} {TOKEN_SYMBOL}
                    </span>
                  </div>
                ))}
              </div>

              {/* Guthaben / Hinweise */}
              {isLoggedIn ? (
                <div
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                    insufficient
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-white/5 border-white/10'
                  }`}
                >
                  <span className="text-sm text-night-200">Ihr Guthaben</span>
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      insufficient ? 'text-red-400' : 'text-acid-300'
                    }`}
                  >
                    {balance !== null ? balance.toLocaleString('de-DE') : '—'} {TOKEN_SYMBOL}
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-3 px-4 py-3 bg-sky-500/10 border border-sky-500/30 rounded-xl">
                  <LogIn className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-sky-300">
                    Für kostenpflichtige Daten ist eine Anmeldung mit Ihrem Solid Pod
                    erforderlich.
                  </p>
                </div>
              )}

              {insufficient && (
                <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-300">
                    Ihr Guthaben reicht nicht aus. Kaufen Sie weitere Token, um die Daten
                    anzuzeigen.
                  </p>
                </div>
              )}

              {/* Aktionen */}
              <div className="flex flex-col gap-2 pt-1">
                {!isLoggedIn ? (
                  <button onClick={onLogin} className="btn btn-acid w-full">
                    <LogIn className="w-5 h-5" />
                    <span>Jetzt anmelden</span>
                  </button>
                ) : insufficient ? (
                  <button onClick={onBuyTokens} className="btn btn-acid w-full">
                    <Coins className="w-5 h-5" />
                    <span>Token kaufen</span>
                  </button>
                ) : (
                  <button
                    onClick={onConfirm}
                    disabled={!canConfirm}
                    className="btn btn-acid w-full"
                  >
                    {isPaying ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Token werden übertragen...
                      </span>
                    ) : (
                      <span>
                        {total.toLocaleString('de-DE')} {TOKEN_SYMBOL} zahlen &amp; Daten anzeigen
                      </span>
                    )}
                  </button>
                )}
                <button
                  onClick={onCancel}
                  disabled={isPaying}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-night-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Abbrechen — keine Token abbuchen
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
