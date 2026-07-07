import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCard, EventTimeline, LogStream, MetricCard, RiskTierBadge, StatusBadge } from '../components/workbench';
import { approvals, events } from '../data/mockData';
import { i18n } from '../i18n/i18n';

describe('workbench components', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('renders semantic risk and status badges', () => {
    render(
      <>
        <StatusBadge status="waiting_for_approval" />
        <RiskTierBadge tier="publish" />
      </>
    );

    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.getByText('Publish')).toBeInTheDocument();
  });

  it('renders timeline, logs, metric, and approval card', () => {
    render(
      <>
        <MetricCard label="Active runs" value="08" hint="3 running" />
        <EventTimeline
          events={[
            ...events,
            {
              id: 'evt_payload',
              type: 'execution.failed',
              sequence: 5,
              occurredAt: '2026-07-04T10:45:00Z',
              message: 'Tool failed with diagnostics',
              source: 'tool',
              level: 'error',
              executionId: 'exec_1',
              payload: { toolName: 'search_workspace' },
              error: { code: 'empty_query', message: 'query must not be empty' }
            }
          ]}
        />
        <LogStream lines={['execution.output sequence=148']} />
        <ApprovalCard approval={approvals[0]} />
      </>
    );

    expect(screen.getByText('Active runs')).toBeInTheDocument();
    expect(screen.getByText(/Planning branch adoption scope/)).toBeInTheDocument();
    expect(screen.getByText(/execution.output sequence=148/)).toBeInTheDocument();
    expect(screen.getByText('Publish skill version')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('tool')).toBeInTheDocument();
    expect(screen.getByText('exec_1')).toBeInTheDocument();
    expect(screen.getByText(/empty_query/)).toBeInTheDocument();
  });

  it('only renders approval review action when a handler is provided', () => {
    const { rerender } = render(<ApprovalCard approval={approvals[0]} />);

    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument();

    rerender(<ApprovalCard approval={approvals[0]} onOpen={vi.fn()} />);

    expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
  });
});
