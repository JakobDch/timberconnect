import { motion } from 'framer-motion';
import { Bot, Send, MessageCircle, MoreHorizontal } from 'lucide-react';

interface Message {
  id: number;
  type: 'bot' | 'user';
  text: string;
}

const SAMPLE_MESSAGES: Message[] = [
  {
    id: 1,
    type: 'bot',
    text: 'Willkommen! Ich bin Ihr TimberConnect Assistent. Wie kann ich Ihnen mit diesem Holzprodukt helfen?',
  },
  {
    id: 2,
    type: 'user',
    text: 'Woher stammt dieses Holz?',
  },
  {
    id: 3,
    type: 'bot',
    text: 'Dieses Holz stammt aus nachhaltig bewirtschafteten Waldern in Rheinland-Pfalz...',
  },
];

export function ChatMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.3 }}
      className="h-full flex flex-col bg-white rounded-2xl border border-gray-200 shadow-soft overflow-hidden"
    >
      {/* Chat Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-forest-50 to-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-forest-500 flex items-center justify-center shadow-lg shadow-forest-500/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-timber-dark text-sm">TimberConnect Assistent</h3>
            <span className="text-xs text-forest-600 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-forest-500 animate-pulse" />
              Online
            </span>
          </div>
        </div>
        <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors" disabled>
          <MoreHorizontal className="w-5 h-5 text-timber-gray" />
        </button>
      </div>

      {/* Message Area */}
      <div className="flex-1 p-4 space-y-3 bg-gray-50/50 overflow-y-auto min-h-[200px]">
        {SAMPLE_MESSAGES.map((msg, index) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + index * 0.1 }}
            className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed ${
                msg.type === 'user'
                  ? 'bg-forest-500 text-white rounded-2xl rounded-br-md'
                  : 'bg-white border border-gray-200 text-timber-dark rounded-2xl rounded-bl-md shadow-sm'
              }`}
            >
              {msg.text}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Input Area (Non-functional) */}
      <div className="p-4 border-t border-gray-100 bg-white">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Nachricht eingeben..."
              disabled
              className="w-full px-4 py-2.5 pr-10 bg-gray-100 border border-gray-200 rounded-xl text-sm text-timber-gray placeholder:text-gray-400 cursor-not-allowed"
            />
            <MessageCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
          </div>
          <button
            className="p-2.5 bg-forest-500 text-white rounded-xl opacity-50 cursor-not-allowed"
            disabled
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-timber-gray text-center mt-2.5">
          Chat-Funktion demnachst verfugbar
        </p>
      </div>
    </motion.div>
  );
}
