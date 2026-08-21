/**
 * Types for TimberConnect Chat Component
 */

import type { ToolCallTrace } from '../../services/agent/agentLoop';

export type { ToolCallTrace };

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessageData {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  /**
   * Womit diese Antwort belegt ist: welche Abfragen liefen, wozu, mit wie
   * vielen Treffern. Aufklappbar unter der Nachricht.
   *
   * Nachvollziehbarkeit zaehlt hier mehr als Politur: der Assistent darf nur
   * Daten dieses Bauteils ausgeben, und die Trace ist die Stelle, an der man
   * das nachpruefen kann, statt es glauben zu muessen.
   */
  traces?: ToolCallTrace[];
  metadata?: {
    intent?: string;
    hasImage?: boolean;
    imageBase64?: string;
    chartType?: string;
    calculationResult?: CalculationResult;
  };
}

export interface CalculationResult {
  value: number | null;
  unit: string;
  description: string;
  details?: Array<{
    category: string;
    value: string | number;
    unit?: string;
  }>;
  note?: string;
}

export interface ChatSettings {
  apiKey?: string;
}
