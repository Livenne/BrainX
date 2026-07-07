import { events } from '../data/mockData';
import type { ExecutionEvent } from '../domain/types';

const clone = <T>(value: T): T => globalThis.structuredClone(value);

export type MockEventSubscription = {
  unsubscribe: () => void;
};

export function subscribeToWorkspaceEvents(
  onEvent: (event: ExecutionEvent) => void,
  intervalMs = 1800
): MockEventSubscription {
  let index = 0;
  const timer = globalThis.setInterval(() => {
    onEvent(clone(events[index % events.length]));
    index += 1;
  }, intervalMs);

  return {
    unsubscribe: () => globalThis.clearInterval(timer)
  };
}
