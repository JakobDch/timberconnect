import { motion } from 'framer-motion';
import { ArrowLeft, Hash } from 'lucide-react';
import type { Product, SupplyChainStep } from '../../types';
import { ChatContainer } from './ChatContainer';

/**
 * Anwendungsfall "Sprich mit deinem Bauteil".
 *
 * Frueher hing der Chat als festes Panel im Anwendungsfall-Raster -- also
 * ausgerechnet auf dem Bildschirm, auf dem man den Anwendungsfall erst noch
 * auswaehlt. Jetzt ist er ein regulaerer Fall mit eigener Ansicht: man waehlt
 * ihn wie jeden anderen, und er bekommt den ganzen Bildschirm.
 *
 * Anders als die Dokument-Ansichten scrollt hier NICHT die Seite: der Chat
 * braucht volle Hoehe, damit die Eingabe unten stehen bleibt und nur die
 * Nachrichtenliste scrollt. Deshalb h-full/min-h-0 statt des
 * ``max-w-2xl``-Lesecontainers der uebrigen Anwendungsfaelle.
 */

interface ChatViewProps {
  productId: string;
  product: Product | null;
  supplyChain?: SupplyChainStep[];
  onBack: () => void;
  /** Fuehrt zum Scan -- Ausweg aus dem Leerzustand. */
  onScanClick?: () => void;
  /** Wallet-Sheet oeffnen (aus der Kostenbestaetigung heraus). */
  onBuyTokens?: () => void;
  /** Login-Dialog oeffnen. */
  onLogin?: () => void;
}

export function ChatView({
  productId,
  product,
  supplyChain = [],
  onBack,
  onScanClick,
  onBuyTokens,
  onLogin,
}: ChatViewProps) {
  // --- Leerzustand --------------------------------------------------------
  // Der Assistent antwortet ausschliesslich aus den Daten des gescannten
  // Bauteils. Ohne Bauteil gaebe es keine Quellen -- er koennte nur raten,
  // und genau das soll er nicht.
  if (!product) {
    return (
      <div className="flex-1 bg-night-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors mb-5"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Zurück</span>
          </button>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-2">
            Sprich mit deinem <span className="text-acid-400">Bauteil</span>
          </h1>
          <div className="bg-night-700/50 border border-white/5 rounded-2xl p-6 mt-6">
            <p className="text-sm text-night-300">
              Der Assistent beantwortet Fragen ausschließlich aus den Daten des
              erfassten Bauteils. Scannen Sie eine Platte oder geben Sie die
              Produkt-ID ein.
            </p>
            <button
              onClick={onScanClick ?? onBack}
              className="mt-4 px-4 py-2 rounded-xl bg-acid-400 text-night-950 text-sm font-semibold hover:bg-acid-300 transition-colors"
            >
              Bauteil erfassen
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-night-900">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex-1 flex flex-col min-h-0">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors mb-5 flex-shrink-0 self-start"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Zurück</span>
        </button>

        {/* Titel + erfasstes Bauteil. Der Bezug muss sichtbar bleiben: der
            Assistent antwortet NUR zu diesem Bauteil, und der Nutzer soll
            jederzeit sehen, um welches es geht. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex-shrink-0"
        >
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Sprich mit deinem <span className="text-acid-400">Bauteil</span>
          </h1>
          <p className="text-sm text-night-300 mt-2 leading-relaxed">
            Fragen Sie nach Herkunft, Daten und Nachweisen — beantwortet
            ausschließlich aus den Daten dieses Bauteils.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-night-800 border border-white/5 rounded-xl max-w-full">
            <Hash className="w-3.5 h-3.5 text-acid-300 flex-shrink-0" />
            <span className="text-xs text-night-300 flex-shrink-0">
              {product.name}
            </span>
            <code className="text-xs font-mono text-night-100 truncate">
              {productId}
            </code>
          </div>
        </motion.div>

        {/* min-h-0 ist hier tragend: ohne das waechst der Flex-Container mit
            seinem Inhalt und die Nachrichtenliste scrollt nicht mehr in sich,
            sondern schiebt die Eingabe aus dem Bild. */}
        <div className="flex-1 min-h-0">
          <ChatContainer
            productId={productId}
            product={product}
            supplyChain={supplyChain}
            onBuyTokens={onBuyTokens}
            onLogin={onLogin}
          />
        </div>
      </div>
    </div>
  );
}
