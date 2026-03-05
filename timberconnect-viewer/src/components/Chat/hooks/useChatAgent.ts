import { useState, useCallback, useEffect } from 'react';
import { useSSEStream } from './useSSEStream';
import type {
  ChatMessageData,
  ChatSettings,
  ProductContextForChat,
  CalculationResult
} from '../types';

const CHAT_API_URL = import.meta.env.VITE_CHAT_API_URL || '/timberconnect-agent/api';
const SETTINGS_STORAGE_KEY = 'timberconnect-chat-settings';

interface UseChatAgentProps {
  productId: string;
  product: {
    id: string;
    name: string;
    woodType: string;
    quality?: string;
    dimensions?: {
      length?: number;
      width?: number;
      thickness?: number;
    };
    certifications?: string[];
    origin?: {
      location?: string;
      region?: string;
      coordinates?: {
        lat: number;
        lng: number;
      };
    };
    harvestDate?: string;
  };
  supplyChain: Array<{
    stage?: string;
    title?: string;
    company?: string;
    name?: string;
    date?: string;
    location?: string;
    details?: Record<string, unknown>;
  }>;
  dataSources: string[];
  semanticModelUrl?: string;
}

interface UseChatAgentReturn {
  messages: ChatMessageData[];
  isLoading: boolean;
  error: string | null;
  settings: ChatSettings;
  streamingContent: string;
  sessionId: string | null;
  sendMessage: (message: string) => Promise<void>;
  updateSettings: (settings: ChatSettings) => void;
  clearChat: () => void;
}

function loadSettings(): ChatSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore errors
  }
  return { provider: 'ollama' };
}

function saveSettings(settings: ChatSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore errors
  }
}

export function useChatAgent({
  productId,
  product,
  supplyChain,
  dataSources,
  semanticModelUrl
}: UseChatAgentProps): UseChatAgentReturn {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ChatSettings>(loadSettings);
  const [streamingContent, setStreamingContent] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);

  const { isStreaming, startStream } = useSSEStream();

  // Build product context for API
  const buildProductContext = useCallback((): ProductContextForChat => {
    return {
      product_id: productId,
      product_name: product.name,
      wood_type: product.woodType,
      quality: product.quality,
      dimensions: product.dimensions,
      certifications: product.certifications || [],
      origin: product.origin,
      harvest_date: product.harvestDate,
      supply_chain: supplyChain,
      data_sources: dataSources,
      semantic_model_url: semanticModelUrl
    };
  }, [productId, product, supplyChain, dataSources, semanticModelUrl]);

  // Fetch welcome message on mount
  useEffect(() => {
    const fetchWelcome = async () => {
      try {
        const response = await fetch(`${CHAT_API_URL}/chat/welcome`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: '',
            product_context: buildProductContext(),
            llm_provider: settings.provider,
            deepseek_api_key: settings.deepseekApiKey
          })
        });

        if (response.ok) {
          const data = await response.json();
          setSessionId(data.session_id);
          setMessages([{
            id: 'welcome',
            role: 'assistant',
            content: data.message,
            timestamp: new Date()
          }]);
        }
      } catch (err) {
        console.error('Failed to fetch welcome message:', err);
        // Add default welcome message on error
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `Willkommen! Ich bin Ihr TimberConnect Assistent.\n\nIch sehe, Sie betrachten gerade **${product.name}**.\n\nStellen Sie mir gerne eine Frage über dieses Produkt!`,
          timestamp: new Date()
        }]);
      }
    };

    fetchWelcome();
  }, [productId]); // Only on product change

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim() || isLoading) return;

    setError(null);
    setIsLoading(true);
    setStreamingContent('');

    // Add user message immediately
    const userMessage: ChatMessageData = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);

    // Prepare request body
    const requestBody = {
      message,
      product_context: buildProductContext(),
      session_id: sessionId,
      llm_provider: settings.provider,
      deepseek_api_key: settings.provider === 'deepseek' ? settings.deepseekApiKey : undefined
    };

    let accumulatedContent = '';
    let imageBase64: string | undefined;
    let chartType: string | undefined;
    let calculationResult: CalculationResult | undefined;

    await startStream(
      `${CHAT_API_URL}/chat/message`,
      requestBody,
      {
        onMessage: (eventType, data) => {
          switch (eventType) {
            case 'message_chunk':
              if (data.content) {
                accumulatedContent += data.content as string;
                setStreamingContent(accumulatedContent);
              }
              break;

            case 'visualization':
              imageBase64 = data.image_base64 as string;
              chartType = data.chart_type as string;
              break;

            case 'calculation_result':
              calculationResult = data as unknown as CalculationResult;
              break;

            case 'end_stream':
              if (data.session_id) {
                setSessionId(data.session_id as string);
              }
              break;

            case 'error':
              setError(data.message as string || 'Ein Fehler ist aufgetreten');
              break;

            case 'status':
              // Could show status updates if needed
              break;
          }
        },
        onError: (err) => {
          setError(err.message || 'Verbindungsfehler');
        },
        onComplete: () => {
          // Add assistant message with accumulated content
          if (accumulatedContent) {
            const assistantMessage: ChatMessageData = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: accumulatedContent,
              timestamp: new Date(),
              metadata: {
                hasImage: !!imageBase64,
                imageBase64,
                chartType,
                calculationResult
              }
            };
            setMessages(prev => [...prev, assistantMessage]);
          }
          setStreamingContent('');
          setIsLoading(false);
        }
      }
    );
  }, [isLoading, sessionId, settings, buildProductContext, startStream]);

  const updateSettings = useCallback((newSettings: ChatSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setError(null);
    setStreamingContent('');
  }, []);

  return {
    messages,
    isLoading: isLoading || isStreaming,
    error,
    settings,
    streamingContent,
    sessionId,
    sendMessage,
    updateSettings,
    clearChat
  };
}
