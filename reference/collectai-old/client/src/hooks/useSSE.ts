import { useEffect, useRef, useCallback } from 'react';
import { auth } from '../firebase/config';

export type SSEStageEvent = {
  type: 'init' | 'stage' | 'complete' | 'error';
  jobId: string;
  stage?: {
    id: string;
    label: string;
    icon: string;
    status: 'pending' | 'executing' | 'done' | 'error';
    stageIndex: number;
    totalStages: number;
  };
  stages?: Array<{
    id: string;
    label: string;
    icon: string;
    status: 'pending' | 'executing' | 'done' | 'error';
    startedAt: number | null;
    completedAt: number | null;
  }>;
  result?: {
    success: boolean;
    invoicesEvaluated: number;
    decisions: Record<string, number>;
  };
  error?: string;
  timestamp: string;
};

interface UseSSEOptions {
  onStage?: (event: SSEStageEvent) => void;
  onComplete?: (event: SSEStageEvent) => void;
  onError?: (event: SSEStageEvent) => void;
  onInit?: (event: SSEStageEvent) => void;
}

/**
 * Connects to the SSE stream for a given jobId.
 * Automatically cleans up EventSource on unmount or when jobId changes.
 */
export function useSSE(jobId: string | null, options: UseSSEOptions) {
  const esRef = useRef<EventSource | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options; // Keep callback refs fresh without re-subscribing

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;

    disconnect(); // Close any previous connection

    let active = true;

    const connectSSE = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          console.warn('[SSE] No authenticated user found when connecting.');
          return;
        }
        const token = await user.getIdToken();
        if (!active) return;

        const url = `/api/agent/stream/${jobId}?token=${encodeURIComponent(token)}`;
        const es = new EventSource(url);
        esRef.current = es;

        es.onmessage = (e) => {
          try {
            const event: SSEStageEvent = JSON.parse(e.data);

            switch (event.type) {
              case 'init':
                optionsRef.current.onInit?.(event);
                break;
              case 'stage':
                optionsRef.current.onStage?.(event);
                break;
              case 'complete':
                optionsRef.current.onComplete?.(event);
                disconnect();
                break;
              case 'error':
                optionsRef.current.onError?.(event);
                disconnect();
                break;
            }
          } catch (err) {
            console.warn('[SSE] Failed to parse event:', err);
          }
        };

        es.onerror = () => {
          console.warn('[SSE] Connection lost for job', jobId);
          disconnect();
        };
      } catch (err) {
        console.error('[SSE] Error setting up EventSource:', err);
      }
    };

    connectSSE();

    return () => {
      active = false;
      disconnect();
    };
  }, [jobId, disconnect]);

  return { disconnect };
}
