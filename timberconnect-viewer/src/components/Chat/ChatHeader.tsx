import { Bot, Settings } from 'lucide-react';
import type { LLMProvider } from './types';

interface ChatHeaderProps {
  onSettingsClick: () => void;
  provider: LLMProvider;
  isConnected?: boolean;
}

export function ChatHeader({ onSettingsClick, provider, isConnected = true }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-forest-50 to-white">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-forest-500 flex items-center justify-center shadow-lg shadow-forest-500/20">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-timber-dark text-sm">TimberConnect Assistent</h3>
          <span className="text-xs text-forest-600 flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-forest-500 animate-pulse' : 'bg-gray-400'}`} />
            {isConnected ? 'Online' : 'Offline'}
            <span className="text-gray-400 ml-1">
              ({provider === 'ollama' ? 'Llama 3.3' : 'DeepSeek'})
            </span>
          </span>
        </div>
      </div>
      <button
        onClick={onSettingsClick}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        title="Einstellungen"
      >
        <Settings className="w-5 h-5 text-timber-gray" />
      </button>
    </div>
  );
}
