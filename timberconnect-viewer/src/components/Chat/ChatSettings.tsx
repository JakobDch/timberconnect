import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Key, Server, Check } from 'lucide-react';
import type { ChatSettings as ChatSettingsType, LLMProvider } from './types';

interface ChatSettingsProps {
  settings: ChatSettingsType;
  onSave: (settings: ChatSettingsType) => void;
  onClose: () => void;
}

export function ChatSettings({ settings, onSave, onClose }: ChatSettingsProps) {
  const [localSettings, setLocalSettings] = useState<ChatSettingsType>(settings);
  const [showApiKey, setShowApiKey] = useState(false);

  const handleProviderChange = (provider: LLMProvider) => {
    setLocalSettings({ ...localSettings, provider });
  };

  const handleApiKeyChange = (apiKey: string) => {
    setLocalSettings({ ...localSettings, deepseekApiKey: apiKey });
  };

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-timber-dark">Chat-Einstellungen</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Provider Selection */}
          <div>
            <label className="block text-sm font-medium text-timber-dark mb-3">
              KI-Anbieter
            </label>
            <div className="grid grid-cols-2 gap-3">
              {/* Ollama Option */}
              <button
                onClick={() => handleProviderChange('ollama')}
                className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                  localSettings.provider === 'ollama'
                    ? 'border-forest-500 bg-forest-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {localSettings.provider === 'ollama' && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-forest-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                <Server className={`w-6 h-6 mb-2 ${
                  localSettings.provider === 'ollama' ? 'text-forest-600' : 'text-gray-400'
                }`} />
                <div className="font-medium text-sm text-timber-dark">Llama 3.3</div>
                <div className="text-xs text-gray-500 mt-0.5">Kostenlos (lokal)</div>
              </button>

              {/* DeepSeek Option */}
              <button
                onClick={() => handleProviderChange('deepseek')}
                className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                  localSettings.provider === 'deepseek'
                    ? 'border-forest-500 bg-forest-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {localSettings.provider === 'deepseek' && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-forest-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                <Key className={`w-6 h-6 mb-2 ${
                  localSettings.provider === 'deepseek' ? 'text-forest-600' : 'text-gray-400'
                }`} />
                <div className="font-medium text-sm text-timber-dark">DeepSeek</div>
                <div className="text-xs text-gray-500 mt-0.5">API-Key erforderlich</div>
              </button>
            </div>
          </div>

          {/* DeepSeek API Key */}
          <AnimatePresence>
            {localSettings.provider === 'deepseek' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <label className="block text-sm font-medium text-timber-dark mb-2">
                  DeepSeek API-Key
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={localSettings.deepseekApiKey || ''}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-4 py-2.5 pr-20 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-forest-500/20 focus:border-forest-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-forest-600 hover:text-forest-700"
                  >
                    {showApiKey ? 'Verbergen' : 'Anzeigen'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Ihren API-Key erhalten Sie unter{' '}
                  <a
                    href="https://platform.deepseek.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-forest-600 hover:underline"
                  >
                    platform.deepseek.com
                  </a>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 border border-gray-300 rounded-xl text-sm font-medium text-timber-dark hover:bg-gray-100 transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={localSettings.provider === 'deepseek' && !localSettings.deepseekApiKey}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium text-white transition-colors ${
              localSettings.provider === 'deepseek' && !localSettings.deepseekApiKey
                ? 'bg-gray-300 cursor-not-allowed'
                : 'bg-forest-500 hover:bg-forest-600'
            }`}
          >
            Speichern
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
