import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceEvents } from '../state/useWorkspaceEvents';

function EventProbe() {
  const latestEvent = useWorkspaceEvents(20);

  return <div>{latestEvent?.type ?? 'waiting for event'}</div>;
}

describe('workspace events hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates with the latest mock workspace event', () => {
    render(<EventProbe />);

    expect(screen.getByText(/waiting for event/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(screen.getByText('agent.run.updated')).toBeInTheDocument();
  });
});
