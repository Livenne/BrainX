import { useEffect, useState } from 'react';
import type { ExecutionEvent } from '../domain/types';
import { subscribeToWorkspaceEvents } from '../services/mockEvents';

export function useWorkspaceEvents(intervalMs = 1800) {
  const [latestEvent, setLatestEvent] = useState<ExecutionEvent | null>(null);

  useEffect(() => {
    const subscription = subscribeToWorkspaceEvents(setLatestEvent, intervalMs);
    return () => subscription.unsubscribe();
  }, [intervalMs]);

  return latestEvent;
}
