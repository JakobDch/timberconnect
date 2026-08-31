import { Coins, Loader2 } from 'lucide-react';
import { useWallet } from '../../wallet/WalletContext';
import { TOKEN_SYMBOL } from '../../services/walletService';

/**
 * Guthaben-Chip im Header: zeigt das aktuelle Token-Guthaben dauerhaft an
 * und öffnet per Klick das Wallet-Sheet (Token kaufen).
 */
export function WalletChip({ onClick }: { onClick?: () => void }) {
  const { balance, isLoading } = useWallet();

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 bg-acid-400/15 border border-acid-400/40 rounded-full hover:bg-acid-400/25 transition-colors flex-shrink-0"
      title="Token-Guthaben — klicken zum Kaufen"
    >
      <Coins className="w-4 h-4 text-acid-300 flex-shrink-0" />
      {isLoading || balance === null ? (
        <Loader2 className="w-3.5 h-3.5 text-acid-300 animate-spin" />
      ) : (
        <span className="text-xs font-bold text-acid-300 tabular-nums whitespace-nowrap">
          {/* Das Symbol erst ab sm: die Zahl allein genuegt neben dem
              Muenzsymbol, und im Header zaehlt jeder Pixel. */}
          {balance.toLocaleString('de-DE')}
          <span className="hidden sm:inline"> {TOKEN_SYMBOL}</span>
        </span>
      )}
    </button>
  );
}
