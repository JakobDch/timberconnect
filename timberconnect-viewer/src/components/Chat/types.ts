/**
 * Types for TimberConnect Chat Component
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessageData {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
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

export type LLMProvider = 'ollama' | 'deepseek';

export interface ChatSettings {
  provider: LLMProvider;
  deepseekApiKey?: string;
}

export interface ProductContextForChat {
  product_id: string;
  product_name: string;
  wood_type: string;
  quality?: string;
  dimensions?: {
    length?: number;
    width?: number;
    thickness?: number;
  };
  certifications: string[];
  origin?: {
    location?: string;
    region?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  harvest_date?: string;
  supply_chain: Array<{
    stage?: string;
    title?: string;
    company?: string;
    name?: string;
    date?: string;
    location?: string;
    details?: Record<string, unknown>;
  }>;
  data_sources: string[];
  semantic_model_url?: string;
}

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}
