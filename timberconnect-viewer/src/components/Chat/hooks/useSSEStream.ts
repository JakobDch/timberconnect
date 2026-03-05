import { useState, useCallback, useRef } from 'react';

interface SSEStreamOptions {
  onMessage: (eventType: string, data: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

export function useSSEStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async (
    url: string,
    body: object,
    options: SSEStreamOptions
  ) => {
    // Abort any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setIsStreaming(true);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) {
        throw new Error('No reader available');
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete events in the buffer
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep incomplete event in buffer

        for (const event of events) {
          if (!event.trim()) continue;

          const lines = event.split('\n');
          let eventType = 'message';
          let data = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              data = line.slice(5).trim();
            }
          }

          if (data) {
            try {
              const parsedData = JSON.parse(data);
              options.onMessage(eventType, parsedData);
            } catch {
              // If not valid JSON, send as raw string
              options.onMessage(eventType, { raw: data });
            }
          }
        }
      }

      options.onComplete?.();
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        options.onError?.(error);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  return { isStreaming, startStream, stopStream };
}
