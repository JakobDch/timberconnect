/**
 * Zustand des Assistenten -- inklusive Bezahlschranke.
 *
 * Der entscheidende Ablauf, und der Grund, warum dieser Hook nicht trivial ist:
 *
 *   1. Der Agent arbeitet frei und darf dabei alles sehen.
 *   2. Waehrend der Werkzeugphase wird NICHTS angezeigt -- nur Statuszeilen.
 *   3. Die fertige Antwort landet in ``pendingAnswer``, NICHT im Verlauf.
 *   4. Erst jetzt wird berechnet, was sie kostet (die zitierten Datenpunkte).
 *   5. Kostet sie nichts, erscheint sie sofort. Sonst erst nach Bestaetigung.
 *
 * Dasselbe Muster wie ``pendingDisplay`` in App.tsx: laden, nichts zeigen,
 * bezahlen lassen, dann zeigen. Die gesamte Preis- und Kaufkette
 * (pricingService, purchaseService, walletService, CostConfirmSheet) wird
 * unveraendert wiederverwendet -- ``run_sparql`` liefert genau die
 * Bindungsform, die ``collectExtractedDatapoints`` erwartet.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { useWallet } from '../../../wallet/WalletContext';
import { estimateExtractionCost, commitPurchase, type CostEstimate } from '../../../services/pricingService';
import { getCurrentRole } from '../../../services/authFetch';
import { buildEpcScope, type EpcScope } from '../../../services/agent/epcScopeService';
import { loadSchemaPack, type SchemaPack } from '../../../services/agent/schemaContextService';
import { runAgent, billableKeys, type AgentAnswer } from '../../../services/agent/agentLoop';
import { buildWelcomeMessage } from '../../../services/agent/prompts';
import type { ChatMessage as LlmMessage } from '../../../services/agent/deepseekClient';
import type { ChatMessageData, ChatSettings } from '../types';

const SETTINGS_STORAGE_KEY = 'timberconnect-chat-settings';

function loadSettings(): ChatSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    /* kaputter Eintrag -> wie kein Eintrag */
  }
  return {};
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export interface UseProductChatOptions {
  productId: string;
  productName?: string;
}

export function useProductChat({ productId, productName }: UseProductChatOptions) {
  const { webId, isLoggedIn } = useAuth();
  const { balance, pay } = useWallet();

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [settings, setSettings] = useState<ChatSettings>(loadSettings);
  const [scope, setScope] = useState<EpcScope | null>(null);
  const [pack, setPack] = useState<SchemaPack | null>(null);
  const [isPreparing, setIsPreparing] = useState(true);
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Wie viele Werkzeugrunden bisher -- der Nutzer soll sehen, dass etwas
  // vorangeht, und selbst entscheiden koennen, wann es ihm reicht. Es gibt
  // bewusst KEINE feste Rundengrenze mehr.
  const [toolRounds, setToolRounds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Die fertige, aber noch NICHT sichtbare Antwort.
  const [pendingAnswer, setPendingAnswer] = useState<AgentAnswer | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  // Gespraechsverlauf fuer das Modell -- getrennt von der Anzeige, weil er
  // Werkzeugaufrufe und -ergebnisse enthaelt, die niemand sehen will.
  const historyRef = useRef<LlmMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const hasApiKey = Boolean(settings.apiKey);

  // --- Vorbereitung: Scope + Datenmodell -----------------------------------
  useEffect(() => {
    let cancelled = false;
    setIsPreparing(true);
    setError(null);
    historyRef.current = [];

    (async () => {
      try {
        const nextScope = await buildEpcScope(productId);
        if (cancelled) return;
        setScope(nextScope);

        const nextPack = await loadSchemaPack(nextScope);
        if (cancelled) return;
        setPack(nextPack);

        setMessages([
          {
            id: newId(),
            role: 'assistant',
            content: buildWelcomeMessage(nextScope, productName),
            timestamp: new Date(),
          },
        ]);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? `Vorbereitung fehlgeschlagen: ${err.message}`
            : 'Vorbereitung fehlgeschlagen.',
        );
      } finally {
        if (!cancelled) setIsPreparing(false);
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [productId, productName]);

  // --- Antwort sichtbar machen ---------------------------------------------
  const reveal = useCallback((answer: AgentAnswer) => {
    historyRef.current = answer.messages;
    setMessages((prev) => [
      ...prev,
      {
        id: newId(),
        role: 'assistant',
        content: answer.content,
        timestamp: new Date(),
        traces: answer.traces,
      },
    ]);
    setPendingAnswer(null);
    setCostEstimate(null);
  }, []);

  // --- Frage stellen --------------------------------------------------------
  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim() || !scope || !pack || !settings.apiKey) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'user', content: question, timestamp: new Date() },
      ]);
      setIsThinking(true);
      setError(null);
      setStatus('Überlege…');
      setToolRounds(0);

      try {
        const answer = await runAgent({
          apiKey: settings.apiKey,
          question,
          scope,
          pack,
          role: getCurrentRole(),
          history: historyRef.current,
          signal: controller.signal,
          onStatus: (next) => {
            setStatus(next);
            setToolRounds((n) => n + 1);
          },
          // Bewusst KEIN onDelta: der Text darf waehrend des Schreibens nicht
          // sichtbar werden. Er ist die Antwort -- und die kostet unter
          // Umstaenden Token, ueber die der Nutzer erst noch entscheidet.
          // Angezeigt wird ausschliesslich der Status.
        });

        setStatus('Prüfe Kosten…');

        // Bezahlt wird, was zitiert wurde -- ohne Zitate alles (fail-closed).
        const keys = billableKeys(answer);
        let estimate: CostEstimate | null = null;
        if (keys.size > 0) {
          try {
            estimate = await estimateExtractionCost(keys, scope.sources, webId);
          } catch (err) {
            // Wie in App.tsx: eine kaputte Kostenberechnung darf die Antwort
            // nicht verschlucken. Sie wird dann kostenlos gezeigt.
            console.warn('[chat] Kostenberechnung fehlgeschlagen:', err);
          }
        }

        if (estimate && estimate.totalTokens > 0) {
          setPendingAnswer(answer);
          setCostEstimate(estimate);
        } else {
          reveal(answer);
          // Gratis gezeigt ist trotzdem erworben -- sonst gelten dieselben
          // Datenpunkte beim naechsten Mal wieder als neu und werden berechnet.
          if (estimate) await commitPurchase(webId, estimate);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Die Anfrage ist fehlgeschlagen.');
      } finally {
        setIsThinking(false);
        setStatus(null);
        abortRef.current = null;
      }
    },
    [scope, pack, settings.apiKey, webId, reveal],
  );

  // --- Kosten bestaetigt ----------------------------------------------------
  const confirmCost = useCallback(async () => {
    if (!pendingAnswer || !costEstimate) return;
    setIsPaying(true);
    try {
      await pay(
        costEstimate.byRecipient.map((r) => ({
          recipientWebId: r.recipientWebId,
          amount: r.tokens,
          reason: `Assistent-Antwort ${scope?.epc ?? ''}`.trim(),
        })),
      );
      // Erst NACH erfolgreicher Zahlung ins Kaufregister -- ein Fehlschlag
      // (Guthaben reicht nicht) darf keine unbezahlte Berechtigung eintragen.
      await commitPurchase(webId, costEstimate);
      reveal(pendingAnswer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Token-Transfer fehlgeschlagen.');
    } finally {
      setIsPaying(false);
    }
  }, [pendingAnswer, costEstimate, pay, webId, scope, reveal]);

  // --- Kosten abgelehnt -----------------------------------------------------
  const cancelCost = useCallback(() => {
    // Die Frage bleibt im Verlauf stehen -- sie war ja gestellt. Nur die
    // Antwort wird verworfen, und der Modellverlauf bleibt unberuehrt, damit
    // die naechste Frage nicht auf einer nie gezeigten Antwort aufbaut.
    setPendingAnswer(null);
    setCostEstimate(null);
    setMessages((prev) => [
      ...prev,
      {
        id: newId(),
        role: 'assistant',
        content:
          'Antwort verworfen — es wurden keine Token abgebucht. ' +
          'Stellen Sie die Frage erneut, wenn Sie die Daten doch abrufen möchten.',
        timestamp: new Date(),
      },
    ]);
  }, []);

  // --- Abbrechen ------------------------------------------------------------
  // Der Nutzer ist die einzige Instanz, die entscheidet, dass es genug ist.
  // Deshalb keine Rundengrenze, sondern dieser Knopf.
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsThinking(false);
    setStatus(null);
    setMessages((prev) => [
      ...prev,
      {
        id: newId(),
        role: 'assistant',
        content:
          'Abgebrochen — es wurde keine Antwort erzeugt und nichts abgebucht. ' +
          'Fragen Sie gern enger gefasst noch einmal.',
        timestamp: new Date(),
      },
    ]);
  }, []);

  const updateSettings = useCallback((next: ChatSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* privater Modus o.ae. -- der Key gilt dann nur fuer diese Sitzung */
    }
  }, []);

  return {
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
    // Kauf-Gate
    pendingAnswer,
    costEstimate,
    isPaying,
    confirmCost,
    cancelCost,
    balance,
    isLoggedIn,
  };
}
