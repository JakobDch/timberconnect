import { Bot, Settings } from 'lucide-react';

interface ChatHeaderProps {
  onSettingsClick: () => void;
  hasApiKey: boolean;
  isConnected?: boolean;
}

export function ChatHeader({ onSettingsClick, hasApiKey, isConnected = true }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-night-800">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-acid-400 flex items-center justify-center shadow-lg shadow-acid-400/20">
          <Bot className="w-5 h-5 text-night-950" />
        </div>
        <div>
          <h3 className="font-semibold text-white text-sm">TimberConnect Assistent</h3>
          <span className="text-xs flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${
              hasApiKey && isConnected ? 'bg-acid-400 animate-pulse' : 'bg-amber-400'
            }`} />
            <span className={hasApiKey ? 'text-acid-300' : 'text-amber-400'}>
              {hasApiKey ? 'Bereit' : 'API-Key erforderlich'}
            </span>
          </span>
        </div>
      </div>
      <button
        onClick={onSettingsClick}
        className="p-2 rounded-lg hover:bg-white/5 transition-colors"
        title="Einstellungen"
      >
        <Settings className="w-5 h-5 text-night-300" />
      </button>
    </div>
  );
}
