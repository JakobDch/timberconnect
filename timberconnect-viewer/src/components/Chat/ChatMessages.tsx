import type { RefObject } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import type { ChatMessageData } from './types';

interface ChatMessagesProps {
  messages: ChatMessageData[];
  isLoading: boolean;
  streamingContent?: string;
  messagesEndRef: RefObject<HTMLDivElement>;
}

export function ChatMessages({
  messages,
  isLoading,
  streamingContent,
  messagesEndRef
}: ChatMessagesProps) {
  return (
    <div className="flex-1 p-4 space-y-3 bg-gray-50/50 overflow-y-auto min-h-[200px]">
      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          message={msg}
        />
      ))}

      {/* Streaming content */}
      {streamingContent && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-start"
        >
          <div className="flex gap-2 max-w-[90%]">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-forest-500 flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            </div>
            <div className="bg-white border border-gray-200 text-timber-dark rounded-2xl rounded-bl-md shadow-sm px-4 py-2.5 text-sm leading-relaxed">
              {streamingContent}
              <span className="inline-block w-1 h-4 bg-forest-500 animate-pulse ml-1" />
            </div>
          </div>
        </motion.div>
      )}

      {/* Loading indicator */}
      {isLoading && !streamingContent && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-start"
        >
          <div className="flex gap-2">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-forest-500 flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md shadow-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-forest-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-forest-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-forest-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Scroll anchor */}
      <div ref={messagesEndRef} />
    </div>
  );
}
