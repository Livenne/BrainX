import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageSkeleton } from '../components/LoadingStates';
import { MetricCard, Panel } from '../components/workbench';
import type { ChatSession, DashboardData } from '../domain/types';
import type { CSSProperties } from 'react';
import './pages.css';
import { useDashboardData } from './useDashboardData';

const tokenSliceColors = [
  'var(--color-brand-primary)',
  'var(--color-state-success)',
  'var(--color-state-info)',
  'var(--color-state-warning)',
  'var(--color-text-muted)'
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { workspaceId = 'w_core' } = useParams();
  const { dashboard, error } = useDashboardData(workspaceId);

  if (error) {
    return (
      <section className="page-stack" role="alert">
        {error}
      </section>
    );
  }

  if (!dashboard) {
    return <PageSkeleton label={t('common.loadingDashboard')} />;
  }

  const tokenTotal = dashboard.stats?.tokenUsage?.total ?? 0;
  const tokenHint = 'Cumulative token usage';

  return (
    <section className="page-stack">
      <div className="metric-grid">
        <MetricCard
          label={t('common.activeRuns')}
          value={String(dashboard.activeRuns.length).padStart(2, '0')}
          hint={t('dashboard.runsHint')}
        />
        <MetricCard
          label={t('client.boundDevices')}
          value={String(dashboard.daemons.length).padStart(2, '0')}
          hint={t('client.boundDevices')}
        />
        <MetricCard
          label={t('common.skillDrafts')}
          value={String(dashboard.skillDrafts.length).padStart(2, '0')}
          hint={t('dashboard.skillsHint')}
        />
        <MetricCard
          label="Tokens"
          value={formatNumber(tokenTotal)}
          hint={tokenHint}
        />
      </div>
      <div className="dashboard-main-grid">
        <Panel title="Agent work status">
          <AgentWorkStatusGrid dashboard={dashboard} workspaceId={workspaceId} />
        </Panel>
        <Panel title="Token usage by model">
          <TokenUsagePie dashboard={dashboard} />
        </Panel>
      </div>
      <section className="dashboard-device-section" aria-label={t('client.boundDevices')}>
        <Panel title={t('client.boundDevices')}>
          <BoundDeviceList dashboard={dashboard} />
        </Panel>
      </section>
    </section>
  );
}

function AgentWorkStatusGrid({ dashboard, workspaceId }: { dashboard: DashboardData; workspaceId: string }) {
  const items = dashboard.stats?.agentWorkStatus ?? [];
  if (!items.length) {
    return <p className="panel-copy">No recent agent work.</p>;
  }

  return (
    <div className="agent-work-status-grid">
      {items.map((item) => {
        const isRunning = item.runStatus !== 'completed' && item.runStatus !== 'failed' && item.runStatus !== 'cancelled';
        return (
          <article className="agent-work-status-card" data-running={String(isRunning)} key={item.sessionId}>
            <div className="agent-work-main">
              <span className="agent-work-light" data-status={isRunning ? 'running' : 'idle'} aria-label={isRunning ? 'Running' : 'Idle'} />
              <div>
                <h3>{item.title || '新的会话'}</h3>
                <p>{item.clientName || item.clientDaemonId || 'Client'}</p>
              </div>
              {item.contextBudget ? <ContextUsageRing budget={item.contextBudget} /> : null}
            </div>
            {isRunning && item.latestOutput ? (
              <p className="agent-work-ticker" aria-label="Current output">
                <span>{item.latestOutput}</span>
              </p>
            ) : (
              <p className="agent-work-summary">{item.latestOutput || 'No output yet.'}</p>
            )}
            <Link className="agent-work-open agent-work-open-button" to={`/workspaces/${workspaceId}/chat?sessionId=${encodeURIComponent(item.sessionId)}`}>
              Open
            </Link>
          </article>
        );
      })}
    </div>
  );
}

function ContextUsageRing({ budget }: { budget: NonNullable<ChatSession['contextBudget']> }) {
  const ratio = Math.max(0, Math.min(1, budget.usageRatio ?? 0));
  const percent = Math.round(ratio * 100);
  const state = percent >= 92 ? 'danger' : percent >= 75 ? 'warning' : percent >= 45 ? 'ok' : 'idle';
  const title = budget.contextWindowKnown === false
    ? `${budget.estimatedTokens} tokens, model context window unknown`
    : `${budget.estimatedTokens}/${budget.maxTokens} tokens`;
  return (
    <span
      aria-label={`Context usage ${percent}%`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className="agent-work-context-donut"
      data-state={state}
      role="progressbar"
      style={{ '--budget-percent': `${percent}%` } as CSSProperties}
      title={title}
    />
  );
}

function TokenUsagePie({ dashboard }: { dashboard: DashboardData }) {
  const usage = dashboard.stats?.tokenUsage;
  const byModel = usage?.byModel ?? [];
  const total = usage?.total ?? 0;
  const slices = byModel.filter((item) => item.totalTokens > 0);
  let cursor = 0;
  const gradient = slices.length
    ? slices
        .map((item, index) => {
          const start = cursor;
          const sweep = total > 0 ? (item.totalTokens / total) * 360 : 0;
          cursor += sweep;
          return `${tokenSliceColors[index % tokenSliceColors.length]} ${start}deg ${cursor}deg`;
        })
        .join(', ')
    : 'color-mix(in srgb, var(--color-border-strong) 44%, transparent) 0deg 360deg';

  return (
    <div className="token-usage-panel">
      <div
        className="token-pie"
        role="img"
        aria-label="Token usage by model"
        style={{ background: `conic-gradient(${gradient})` }}
      >
        <span>{formatNumber(total)}</span>
      </div>
      <div className="token-legend">
        {slices.length ? (
          slices.map((item, index) => (
            <div className="token-legend-row" key={item.modelName}>
              <span style={{ background: tokenSliceColors[index % tokenSliceColors.length] }} aria-hidden="true" />
              <strong>{item.modelName}</strong>
              <small>{formatNumber(item.totalTokens)}</small>
            </div>
          ))
        ) : (
          <p className="panel-copy">No token usage recorded yet.</p>
        )}
      </div>
    </div>
  );
}

function BoundDeviceList({ dashboard }: { dashboard: DashboardData }) {
  if (!dashboard.daemons.length) {
    return <p className="panel-copy">No bound clients.</p>;
  }

  return (
    <div className="dashboard-device-grid dashboard-device-list">
      {dashboard.daemons.map((client) => (
        <article className="dashboard-device-card" key={client.id}>
          <span className="dashboard-device-light" data-status={client.status === 'online' || client.status === 'active' ? 'online' : 'offline'} aria-hidden="true" />
          <div>
            <h3>{client.deviceName}</h3>
            <p>{client.os || 'Unknown OS'}</p>
          </div>
          <small>{client.status}</small>
        </article>
      ))}
    </div>
  );
}
