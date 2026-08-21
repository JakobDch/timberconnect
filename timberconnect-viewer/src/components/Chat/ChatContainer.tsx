import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Loader2, AlertTriangle, Square } from 'lucide-react';
import { useProductChat } from './hooks/useProductChat';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { ChatSettings } from './ChatSettings';
import { CostConfirmSheet } from '../Wallet/CostConfirmSheet';
import type { Product } from '../../types';

/**
 * Der Assistent zu einem Bauteil.
 *
 * Die Agentenschleife laeuft im Browser (siehe services/agent/agentLoop.ts) --
 * nur hier gibt es die authentifizierte Solid-Session und Comunica. Der
 * DeepSeek-Key des Nutzers geht ueber die eigene Herkunft an DeepSeek, nicht
 * mehr ueber unseren Server.
 *
 * Waehrend der Agent arbeitet, ist NICHTS von den Daten zu sehen -- nur was er
 * gerade tut. Die fertige Antwort wird erst sichtbar, wenn feststeht, was sie
 * kostet, und der Nutzer zugestimmt hat.
 */

interface ChatContainerProps {
  productId: string;
  product: Product;
  /** Nicht mehr verwendet -- der Agent liest die Lieferkette selbst aus den Pods. */
  supplyChain?: unknown;
  /** Oeffnet das Wallet-Sheet (liegt in App.tsx, wird durchgereicht). */
  onBuyTokens?: () => void;
  /** Oeffnet den Login-Dialog. */
  onLogin?: () => void;
}

export function ChatContainer({
  productId,
  product,
  onBuyTokens,
  onLogin,
}: ChatContainerProps) {
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    settings,
    updateSettings,
    hasApiKey,
    isPreparing,
    isThinking,
    status,
    toolRounds,
    stop,
    error,
    scope,
    sendMessage,
    pendingAnswer,
    costEstimate,
    isPaying,
    confirmCost,
    cancelCost,
    balance,
    isLoggedIn,
  } = useProductChat({ productId, productName: product.name });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full flex flex-col bg-night-800 rounded-2xl border border-white/5 overflow-hidden relative"
    >
      <ChatHeader
        onSettingsClick={() => setShowSettings(true)}
        hasApiKey={hasApiKey}
        isConnected={!error}
      />

      {/* Degradierte Herkunftspruefung: der Nutzer muss wissen, dass Angaben
          zu anderen Bauteilen gehoeren koennten. Lieber ehrlich degradieren
          als das Versprechen still brechen. */}
      {scope?.degraded && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-100/90">
            Die Herkunftsprüfung konnte nicht auf dieses Bauteil eingegrenzt werden —
            Antworten können Daten anderer Bauteile enthalten.
          </p>
        </div>
      )}

      <ChatMessages
        messages={messages}
        isLoading={isThinking}
        streamingContent=""
        messagesEndRef={messagesEndRef as React.RefObject<HTMLDivElement>}
      />

      {/* Was der Agent gerade tut -- niemals, was er gefunden hat.
          Daneben der Abbrechen-Knopf: es gibt bewusst KEINE feste Rundengrenze,
          der Nutzer entscheidet selbst, wann es ihm reicht. */}
      {status && (
        <div className="px-4 py-2 border-t border-white/5 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 text-acid-300 animate-spin flex-shrink-0" />
          <span className="text-xs text-night-300 flex-1 min-w-0 truncate">{status}</span>
          {toolRounds > 0 && (
            <span className="text-xs text-night-400 flex-shrink-0 tabular-nums">
              {toolRounds} Schritt{toolRounds === 1 ? '' : 'e'}
            </span>
          )}
          <button
            onClick={stop}
            className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-night-200 bg-night-700 border border-white/10 hover:bg-night-600 transition-colors"
          >
            <Square className="w-3 h-3" />
            Abbrechen
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      <ChatInput
        onSend={sendMessage}
        disabled={isThinking || isPreparing || !hasApiKey || pendingAnswer !== null}
        placeholder={
          !hasApiKey
            ? 'Bitte erst API-Key eingeben…'
            : isPreparing
              ? 'Lade Daten des Bauteils…'
              : pendingAnswer
                ? 'Bitte zuerst den Datenabruf bestätigen…'
                : 'Fragen Sie etwas über dieses Bauteil…'
        }
      />

      {/* Vorbereitung: Scope + Datenmodell werden geladen. */}
      {isPreparing && hasApiKey && (
        <div className="absolute inset-0 bg-night-800/95 flex flex-col items-center justify-center p-6 z-30">
          <Loader2 className="w-8 h-8 text-acid-300 animate-spin mb-3" />
          <p className="text-sm text-night-300">Lade Daten und Datenmodell…</p>
        </div>
      )}

      {!hasApiKey && (
        <div className="absolute inset-0 bg-night-800/95 flex flex-col items-center justify-center p-6 z-40">
          <div className="w-16 h-16 rounded-2xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center mb-4">
            <Key className="w-8 h-8 text-acid-300" />
          </div>
          <h3 className="font-semibold text-white text-lg mb-2">API-Key erforderlich</h3>
          <p className="text-sm text-night-300 text-center mb-6 max-w-xs">
            Um den Assistenten zu nutzen, geben Sie bitte Ihren DeepSeek API-Key ein.
          </p>
          <button onClick={() => setShowSettings(true)} className="btn btn-acid">
            API-Key eingeben
          </button>
          <a
            href="https://platform.deepseek.com"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 text-xs text-acid-300 hover:underline"
          >
            Noch keinen Key? Hier registrieren
          </a>
        </div>
      )}

      <AnimatePresence>
        {showSettings && (
          <ChatSettings
            settings={settings}
            onSave={updateSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>

      {/* Kosten-Bestaetigung: dieselbe Schranke wie beim Produktabruf. Die
          Antwort liegt fertig im Puffer und wird erst nach der Zahlung
          sichtbar. */}
      <CostConfirmSheet
        isOpen={pendingAnswer !== null && costEstimate !== null}
        estimate={costEstimate}
        balance={balance}
        isLoggedIn={isLoggedIn}
        isPaying={isPaying}
        onConfirm={confirmCost}
        onCancel={cancelCost}
        onBuyTokens={onBuyTokens ?? (() => {})}
        onLogin={onLogin ?? (() => {})}
      />
    </motion.div>
  );
}
