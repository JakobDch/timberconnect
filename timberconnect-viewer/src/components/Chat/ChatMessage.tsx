import { motion } from 'framer-motion';
import { Bot, User } from 'lucide-react';
import type { ChatMessageData, CalculationResult } from './types';
import { ChartDisplay } from './ChartDisplay';

interface ChatMessageProps {
  message: ChatMessageData;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`flex gap-2 max-w-[90%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        {isAssistant && (
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-forest-500 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
        )}
        {isUser && (
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-timber-brown flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
        )}

        {/* Message Content */}
        <div className="flex flex-col gap-2">
          <div
            className={`px-4 py-2.5 text-sm leading-relaxed ${
              isUser
                ? 'bg-forest-500 text-white rounded-2xl rounded-br-md'
                : 'bg-white border border-gray-200 text-timber-dark rounded-2xl rounded-bl-md shadow-sm'
            }`}
          >
            {/* Render markdown-like content */}
            <MessageContent content={message.content} />
          </div>

          {/* Chart/Visualization */}
          {message.metadata?.hasImage && message.metadata.imageBase64 && (
            <ChartDisplay
              imageBase64={message.metadata.imageBase64}
              chartType={message.metadata.chartType}
            />
          )}

          {/* Calculation Result */}
          {message.metadata?.calculationResult && (
            <CalculationResultDisplay result={message.metadata.calculationResult} />
          )}

          {/* Timestamp */}
          <span className={`text-[10px] text-gray-400 ${isUser ? 'text-right' : 'text-left'}`}>
            {formatTime(message.timestamp)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function MessageContent({ content }: { content: string }) {
  // Simple markdown-like rendering
  const lines = content.split('\n');

  return (
    <div className="space-y-1">
      {lines.map((line, index) => {
        // Bold text
        const boldPattern = /\*\*(.*?)\*\*/g;
        const processedLine = line.replace(boldPattern, '<strong>$1</strong>');

        // Italic text
        const italicPattern = /\*(.*?)\*/g;
        const finalLine = processedLine.replace(italicPattern, '<em>$1</em>');

        // List items
        if (line.startsWith('- ')) {
          return (
            <div key={index} className="flex gap-2">
              <span className="text-forest-500">•</span>
              <span dangerouslySetInnerHTML={{ __html: finalLine.substring(2) }} />
            </div>
          );
        }

        return (
          <p key={index} dangerouslySetInnerHTML={{ __html: finalLine }} />
        );
      })}
    </div>
  );
}

function CalculationResultDisplay({ result }: { result: CalculationResult }) {
  if (!result) return null;

  return (
    <div className="bg-forest-50 border border-forest-200 rounded-xl p-3 text-sm">
      <div className="font-semibold text-forest-700 mb-2">{result.description}</div>
      {result.value !== null && (
        <div className="text-2xl font-bold text-forest-600">
          {typeof result.value === 'number' ? result.value.toLocaleString('de-DE') : result.value} {result.unit}
        </div>
      )}
      {result.details && result.details.length > 0 && (
        <div className="mt-2 space-y-1 text-xs text-gray-600">
          {result.details.map((detail, idx) => (
            <div key={idx} className="flex justify-between">
              <span>{detail.category}:</span>
              <span className="font-medium">
                {detail.value} {detail.unit || ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {result.note && (
        <div className="mt-2 text-xs text-gray-500 italic">{result.note}</div>
      )}
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
