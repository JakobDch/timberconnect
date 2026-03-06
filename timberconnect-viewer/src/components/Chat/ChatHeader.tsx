import { Bot, Settings } from 'lucide-react';

interface ChatHeaderProps {
  onSettingsClick: () => void;
  hasApiKey: boolean;
  isConnected?: boolean;
}

export function ChatHeader({ onSettingsClick, hasApiKey, isConnected = true }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-forest-50 to-white">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-forest-500 flex items-center justify-center shadow-lg shadow-forest-500/20">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-timber-dark text-sm">TimberConnect Assistent</h3>
          <span className="text-xs flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${
              hasApiKey && isConnected ? 'bg-forest-500 animate-pulse' : 'bg-amber-500'
            }`} />
            <span className={hasApiKey ? 'text-forest-600' : 'text-amber-600'}>
              {hasApiKey ? 'Bereit' : 'API-Key erforderlich'}
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
