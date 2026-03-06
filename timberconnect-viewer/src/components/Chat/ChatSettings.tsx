import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Key } from 'lucide-react';
import type { ChatSettings as ChatSettingsType } from './types';

interface ChatSettingsProps {
  settings: ChatSettingsType;
  onSave: (settings: ChatSettingsType) => void;
  onClose: () => void;
}

export function ChatSettings({ settings, onSave, onClose }: ChatSettingsProps) {
  const [apiKey, setApiKey] = useState(settings.apiKey || '');
  const [showApiKey, setShowApiKey] = useState(false);

  const handleSave = () => {
    onSave({ apiKey: apiKey.trim() || undefined });
    onClose();
  };

  const isValid = apiKey.trim().length > 0;

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
        <div className="p-5 space-y-4">
          {/* Info */}
          <div className="flex items-start gap-3 p-3 bg-forest-50 rounded-xl">
            <Key className="w-5 h-5 text-forest-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-timber-dark">
              Der Chat verwendet die DeepSeek API. Sie benötigen einen eigenen API-Key, um den Chat zu nutzen.
            </p>
          </div>

          {/* API Key Input */}
          <div>
            <label className="block text-sm font-medium text-timber-dark mb-2">
              DeepSeek API-Key *
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
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
          </div>
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
            disabled={!isValid}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium text-white transition-colors ${
              !isValid
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
