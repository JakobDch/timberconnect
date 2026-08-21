/**
 * Wallet Context
 *
 * Hält das Token-Guthaben des eingeloggten Nutzers im React-State. Beim
 * ersten Login wird das Wallet im Solid Pod angelegt (Startguthaben) —
 * danach zeigt der Header-Chip das Guthaben dauerhaft an.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  ensureWallet,
  getBalance,
  buyTokens,
  payForData,
  type PaymentItem,
  type PaymentResult,
} from '../services/walletService';

interface WalletContextType {
  /** Aktuelles Guthaben in Token; null solange unbekannt / nicht eingeloggt. */
  balance: number | null;
  isLoading: boolean;
  /** Guthaben neu aus dem Pod lesen. */
  refresh: () => Promise<void>;
  /** Token kaufen (Demo, keine echte Zahlung). */
  buy: (amount: number) => Promise<void>;
  /** Datenabruf bezahlen: abbuchen + Empfängern gutschreiben. */
  pay: (payments: PaymentItem[]) => Promise<PaymentResult>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, webId } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Wallet beim Login initialisieren (legt es beim allerersten Mal an).
  useEffect(() => {
    if (!isLoggedIn || !webId) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    ensureWallet(webId)
      .then((b) => {
        if (!cancelled) setBalance(b);
      })
      .catch((err) => {
        console.error('[wallet] Initialisierung fehlgeschlagen:', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, webId]);

  const refresh = useCallback(async () => {
    if (!webId) return;
    const b = await getBalance(webId);
    if (b !== null) setBalance(b);
  }, [webId]);

  const buy = useCallback(
    async (amount: number) => {
      if (!webId) throw new Error('Nicht angemeldet');
      const newBalance = await buyTokens(webId, amount);
      setBalance(newBalance);
    },
    [webId],
  );

  const pay = useCallback(
    async (payments: PaymentItem[]) => {
      if (!webId) throw new Error('Nicht angemeldet');
      const result = await payForData(webId, payments);
      setBalance(result.newBalance);
      return result;
    },
    [webId],
  );

  return (
    <WalletContext.Provider value={{ balance, isLoading, refresh, buy, pay }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
