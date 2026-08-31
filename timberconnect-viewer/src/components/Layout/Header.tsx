import { Shield, LogIn, Loader2, Menu, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { LoginModal, openRegistration } from '../Auth/LoginModal';
import { UserMenu } from '../Auth/UserMenu';
import { BrandWordmark } from '../Brand/TreeRingLogo';
import { WalletChip } from '../Wallet';

interface HeaderProps {
  onLogoClick?: () => void;
  /** Zeigt statt des Anmelden-Buttons den "Scan ready"-Chip (Scan-Screen). */
  showScanReady?: boolean;
  /** Öffnet das Wallet-Sheet (Token-Guthaben / Token kaufen). */
  onWalletClick?: () => void;
  /** Öffnet das Seitenfenstermenü (Drawer). */
  onMenuClick?: () => void;
  /** Kontext-Chip rechts im Header, z. B. "CO₂ Bilanz" auf der Bilanz-Ansicht. */
  contextChip?: string;
}

export function Header({
  onLogoClick,
  showScanReady = false,
  onWalletClick,
  onMenuClick,
  contextChip,
}: HeaderProps) {
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const { isLoggedIn, isLoading } = useAuth();

  return (
    <>
      <header className="bg-night-900/90 backdrop-blur-md border-b border-white/5 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* gap-2 haelt die beiden Cluster auch dann auseinander, wenn beide
              geschrumpft sind -- ohne ihn beruehren sie sich auf 360px. */}
          <div className="flex items-center justify-between gap-2 h-16 lg:h-18">
            {/* Burger-Menü + Logo. min-w-0 ist Pflicht: Flex-Kinder haben
                min-width:auto und koennen sonst nicht unter ihre Inhaltsbreite
                schrumpfen -- die Wortmarke schob die Kopfzeile ueber den Rand. */}
            <div className="flex items-center gap-2.5 min-w-0">
              {onMenuClick && (
                <button
                  type="button"
                  onClick={onMenuClick}
                  className="w-10 h-10 -ml-2 rounded-xl hover:bg-white/5 flex items-center justify-center transition-colors"
                  aria-label="Menü öffnen"
                >
                  <Menu className="w-5 h-5 text-night-200" />
                </button>
              )}
              <button
                type="button"
                className="cursor-pointer bg-transparent border-none p-0 min-w-0"
                onClick={onLogoClick}
                aria-label="Zur Startseite"
              >
                <BrandWordmark />
              </button>
            </div>

            {/* Rechte Seite: Scan-Status / Auth. flex-shrink-0 haelt die
                Bedienelemente zusammen -- schrumpfen soll die Wortmarke. */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {/* Beide Chips erst ab sm: auf dem Telefon sind sie reine
                  Wiederholung -- der Kontext steht in der Ueberschrift der
                  jeweiligen Ansicht, und "Scan ready" sagt der Scan-Screen
                  selbst. Zusammen mit Wallet und Benutzermenue sprengten sie
                  sonst die Zeile ("Haftungsnachweis" allein ist ~128px). */}
              {showScanReady && (
                <span className="hidden sm:inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-acid-400/40 text-acid-300 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-acid-400 animate-pulse-soft" />
                  Scan ready
                </span>
              )}

              {contextChip && (
                <span className="hidden sm:inline-flex items-center px-3.5 py-1.5 rounded-full border border-acid-400/40 text-acid-300 text-xs font-semibold max-w-[30vw] truncate">
                  {contextChip}
                </span>
              )}

              {isLoading ? (
                <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full">
                  <Loader2 className="w-4 h-4 text-night-300 animate-spin" />
                  <span className="text-sm text-night-300">Laden...</span>
                </div>
              ) : isLoggedIn ? (
                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Connected Badge */}
                  <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-acid-400/10 border border-acid-400/30 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-acid-400" />
                    <Shield className="w-3.5 h-3.5 text-acid-300" />
                    <span className="text-xs font-medium text-acid-300">
                      Verbunden
                    </span>
                  </div>
                  {/* Token-Guthaben (immer sichtbar) */}
                  <WalletChip onClick={onWalletClick} />
                  {/* User Menu */}
                  <UserMenu />
                </div>
              ) : (
                /* Die Chips weichen dem Anmelden-Knopf nur dort, wo sie auch
                   sichtbar sind (ab sm). Auf dem Telefon sind sie ausgeblendet,
                   also darf der Knopf dort immer erscheinen -- sonst gaebe es
                   auf dem Scan-Screen gar keine Anmeldemoeglichkeit mehr. */
                <div
                  className={`${
                    showScanReady || contextChip ? 'flex sm:hidden' : 'flex'
                  } items-center gap-2 flex-shrink-0`}
                >
                  {/* Registrieren fuehrt direkt auf die Konto-Anlage des
                      Solid-Servers. Ohne diesen Knopf ist der Weg dorthin
                      "Anmelden" -> "Anderes Konto verwenden" -> "Sign up" --
                      drei Schritte durch eine Fremdseite, die nach Anmeldung
                      aussieht. Zurueckhaltender gestaltet als "Anmelden": neue
                      Konten sind der seltenere Fall. */}
                  <button
                    onClick={openRegistration}
                    className="flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full border border-white/15 text-night-200 hover:bg-white/5 hover:text-white text-sm font-semibold transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Registrieren</span>
                  </button>
                  <button
                    onClick={() => setLoginModalOpen(true)}
                    className="flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full border border-acid-400/50 text-acid-300 hover:bg-acid-400/10 text-sm font-semibold transition-colors"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Anmelden</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Login Modal */}
      <LoginModal
        isOpen={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
      />
    </>
  );
}
