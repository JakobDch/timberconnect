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
      className="absolute inset-0 bg-night-950/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-night-800 border border-white/10 rounded-2xl shadow-2xl shadow-black/50 w-full max-w-sm overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="font-semibold text-white">Chat-Einstellungen</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5 text-night-300" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Info */}
          <div className="flex items-start gap-3 p-3 bg-acid-400/10 border border-acid-400/30 rounded-xl">
            <Key className="w-5 h-5 text-acid-300 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-night-100">
              Der Chat verwendet die DeepSeek API. Sie benötigen einen eigenen API-Key, um den Chat zu nutzen.
            </p>
          </div>

          {/* API Key Input */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              DeepSeek API-Key *
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-4 py-2.5 pr-20 bg-night-900 border border-white/10 rounded-xl text-sm text-white placeholder:text-night-400 focus:outline-none focus:ring-2 focus:ring-acid-400/20 focus:border-acid-400/60"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-acid-300 hover:text-acid-200"
              >
                {showApiKey ? 'Verbergen' : 'Anzeigen'}
              </button>
            </div>
            <p className="mt-2 text-xs text-night-400">
              Ihren API-Key erhalten Sie unter{' '}
              <a
                href="https://platform.deepseek.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-acid-300 hover:underline"
              >
                platform.deepseek.com
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-white/5 bg-night-900/50">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 bg-night-700 border border-white/10 rounded-xl text-sm font-medium text-white hover:bg-night-600 transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors ${
              !isValid
                ? 'bg-night-600 text-night-400 cursor-not-allowed'
                : 'bg-acid-400 text-night-950 hover:bg-acid-300'
            }`}
          >
            Speichern
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
