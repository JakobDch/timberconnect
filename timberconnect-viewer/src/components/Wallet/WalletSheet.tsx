import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Coins,
  Loader2,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownLeft,
  ShoppingCart,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useWallet } from '../../wallet/WalletContext';
import {
  getTransactions,
  shortenWebId,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  type WalletTransaction,
} from '../../services/walletService';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';

/**
 * Wallet-Bottom-Sheet: Guthaben, Token-Kauf (Demo — keine echte Zahlung)
 * und die letzten Transaktionen.
 */

interface WalletSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const PACKAGES = [
  { tokens: 50, price: '4,99 €' },
  { tokens: 100, price: '8,99 €' },
  { tokens: 250, price: '19,99 €' },
  { tokens: 500, price: '34,99 €' },
];

export function WalletSheet({ isOpen, onClose }: WalletSheetProps) {
  const { webId } = useAuth();
  const { balance, buy } = useWallet();
  const [buyingAmount, setBuyingAmount] = useState<number | null>(null);
  const [purchased, setPurchased] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (isOpen && webId) {
      getTransactions(webId, 5).then(setTransactions).catch(() => {});
    }
    if (!isOpen) {
      setPurchased(null);
      setError(null);
    }
  }, [isOpen, webId]);

  const handleBuy = async (tokens: number) => {
    setBuyingAmount(tokens);
    setPurchased(null);
    setError(null);
    try {
      // Demo: simulierte Zahlungsabwicklung, keine echte Geldzahlung.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await buy(tokens);
      setPurchased(tokens);
      if (webId) getTransactions(webId, 5).then(setTransactions).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kauf fehlgeschlagen');
    } finally {
      setBuyingAmount(null);
    }
  };

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
            className="w-full sm:max-w-xl bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[92%] sm:max-h-[85%] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Griff (mobil) */}
            <div className="sm:hidden flex justify-center pt-3">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>

            {/* Kopf */}
            <div className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3">
              <h2 className="text-xl font-bold text-white">Mein Wallet</h2>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                aria-label="Schließen"
              >
                <X className="w-4 h-4 text-night-300" />
              </button>
            </div>

            <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex-1 min-h-0 overflow-y-auto scroll-touch space-y-5">
              {/* Guthaben */}
              <div className="bg-acid-400/10 border border-acid-400/30 rounded-2xl p-5 text-center">
                <div className="flex items-center justify-center gap-2 text-night-300 text-xs uppercase tracking-[0.16em] font-bold mb-2">
                  <Coins className="w-4 h-4 text-acid-300" />
                  Aktuelles Guthaben
                </div>
                <div className="text-4xl font-bold text-acid-300 tabular-nums">
                  {balance !== null ? balance.toLocaleString('de-DE') : '—'}
                  <span className="text-lg ml-2">{TOKEN_SYMBOL}</span>
                </div>
                <p className="text-xs text-night-400 mt-2">
                  1 {TOKEN_SYMBOL} = 1 Datenpunkt. Das Guthaben wird in Ihrem Solid Pod gespeichert.
                </p>
              </div>

              {/* Kauf-Erfolg / Fehler */}
              {purchased !== null && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 px-4 py-3 bg-acid-400/10 border border-acid-400/30 rounded-xl"
                >
                  <CheckCircle2 className="w-5 h-5 text-acid-300 flex-shrink-0" />
                  <span className="text-sm text-acid-200">
                    {purchased} {TOKEN_SYMBOL} wurden Ihrem Wallet gutgeschrieben.
                  </span>
                </motion.div>
              )}
              {error && (
                <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
                  {error}
                </div>
              )}

              {/* Token kaufen */}
              <div>
                <h3 className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase mb-3">
                  {TOKEN_NAME} kaufen
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {PACKAGES.map((pkg) => (
                    <button
                      key={pkg.tokens}
                      onClick={() => handleBuy(pkg.tokens)}
                      disabled={buyingAmount !== null}
                      className="flex flex-col items-center gap-1 px-4 py-4 bg-night-700/60 border border-white/10 rounded-2xl hover:border-acid-400/50 hover:bg-night-700 transition-all disabled:opacity-50"
                    >
                      {buyingAmount === pkg.tokens ? (
                        <Loader2 className="w-5 h-5 text-acid-300 animate-spin" />
                      ) : (
                        <ShoppingCart className="w-5 h-5 text-acid-300" />
                      )}
                      <span className="text-lg font-bold text-white">
                        {pkg.tokens} {TOKEN_SYMBOL}
                      </span>
                      <span className="text-xs text-night-300">{pkg.price}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-night-400 mt-3">
                  Demo-Modus: Es findet keine echte Geldzahlung statt — die Token werden
                  direkt gutgeschrieben.
                </p>
              </div>

              {/* Letzte Transaktionen */}
              {transactions.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase mb-3">
                    Letzte Transaktionen
                  </h3>
                  <div className="space-y-2">
                    {transactions.map((tx, i) => {
                      const isIncoming = tx.amount >= 0;
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-3 px-4 py-3 bg-night-700/50 border border-white/5 rounded-2xl"
                        >
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                              isIncoming
                                ? 'bg-acid-400/15 text-acid-300'
                                : 'bg-red-500/15 text-red-400'
                            }`}
                          >
                            {isIncoming ? (
                              <ArrowDownLeft className="w-4 h-4" />
                            ) : (
                              <ArrowUpRight className="w-4 h-4" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">
                              {tx.reason ||
                                (tx.type === 'purchase' ? 'Token-Kauf' : 'Datenabruf')}
                            </p>
                            {tx.counterparty && (
                              <p className="text-xs text-night-400 truncate">
                                {shortenWebId(tx.counterparty)}
                              </p>
                            )}
                          </div>
                          <span
                            className={`text-sm font-bold tabular-nums flex-shrink-0 ${
                              isIncoming ? 'text-acid-300' : 'text-red-400'
                            }`}
                          >
                            {isIncoming ? '+' : ''}
                            {tx.amount} {TOKEN_SYMBOL}
                          </span>
                        </div>
                      );
                    })}
                  </div>
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
