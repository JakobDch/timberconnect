import { useState, type KeyboardEvent } from 'react';
import { Send, MessageCircle } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Nachricht eingeben...'
}: ChatInputProps) {
  const [input, setInput] = useState('');

  const handleSend = () => {
    const trimmed = input.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t border-gray-100 bg-white">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={`w-full px-4 py-2.5 pr-10 bg-gray-50 border border-gray-200 rounded-xl text-sm text-timber-dark placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-forest-500/20 focus:border-forest-500 transition-all ${
              disabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          />
          <MessageCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
        </div>
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className={`p-2.5 bg-forest-500 text-white rounded-xl transition-all ${
            disabled || !input.trim()
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-forest-600 active:scale-95'
          }`}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
