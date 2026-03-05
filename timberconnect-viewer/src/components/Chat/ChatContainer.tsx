import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatAgent } from './hooks/useChatAgent';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { ChatSettings } from './ChatSettings';
import type { Product, SupplyChainStep } from '../../types';

interface ChatContainerProps {
  productId: string;
  product: Product;
  supplyChain: SupplyChainStep[];
  dataSources?: string[];
  semanticModelUrl?: string;
}

export function ChatContainer({
  productId,
  product,
  supplyChain,
  dataSources = [],
  semanticModelUrl
}: ChatContainerProps) {
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isLoading,
    error,
    settings,
    streamingContent,
    sendMessage,
    updateSettings
  } = useChatAgent({
    productId,
    product: {
      id: product.id,
      name: product.name,
      woodType: product.woodType,
      quality: product.quality,
      dimensions: product.dimensions,
      certifications: product.certifications,
      origin: product.origin,
      harvestDate: product.harvestDate
    },
    supplyChain: supplyChain.map(step => ({
      stage: step.stage,
      title: step.description || step.stage,
      company: step.company,
      name: step.company,
      date: step.date,
      location: step.location,
      details: step.details?.reduce((acc, d) => ({ ...acc, [d.label]: d.value }), {} as Record<string, unknown>)
    })),
    dataSources,
    semanticModelUrl
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.3 }}
      className="h-full flex flex-col bg-white rounded-2xl border border-gray-200 shadow-soft overflow-hidden relative"
    >
      <ChatHeader
        onSettingsClick={() => setShowSettings(true)}
        provider={settings.provider}
        isConnected={!error}
      />

      <ChatMessages
        messages={messages}
        isLoading={isLoading}
        streamingContent={streamingContent}
        messagesEndRef={messagesEndRef as React.RefObject<HTMLDivElement>}
      />

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-100">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <ChatInput
        onSend={sendMessage}
        disabled={isLoading}
        placeholder="Fragen Sie mich etwas über dieses Holzprodukt..."
      />

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <ChatSettings
            settings={settings}
            onSave={updateSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
