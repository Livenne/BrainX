import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentRunSummary, ApprovalRequest, ExecutionEvent, RiskTier, RunStatus } from '../domain/types';

type StatusBadgeStatus = RunStatus | ApprovalRequest['status'] | string;

function humanizeToken(value: string) {
  const label = value
    .split(/[_\-.]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function StatusBadge({ status }: { status: StatusBadgeStatus }) {
  const { t } = useTranslation();
  return <span className="badge">{t(`status.${status}`, { defaultValue: humanizeToken(status) })}</span>;
}

export function RiskTierBadge({ tier }: { tier: RiskTier }) {
  const { t } = useTranslation();
  return <span className={`badge risk-${tier}`}>{t(`risk.${tier}`)}</span>;
}

export function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint">{hint}</div>
    </article>
  );
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function EventTimeline({ events }: { events: ExecutionEvent[] }) {
  return (
    <div className="timeline">
      {events.map((event) => {
        const hasDiagnostics = event.source || event.level || event.executionId || event.payload || event.error;
        return (
          <article className="timeline-event" key={event.id}>
            <div className="timeline-event-row">
              <span className="event-time">
                {new Date(event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="event-message">{event.message}</span>
              {event.riskTier ? <RiskTierBadge tier={event.riskTier} /> : <StatusBadge status={event.type} />}
            </div>
            {hasDiagnostics ? (
              <div className="event-diagnostics" aria-label="Event diagnostics">
                {event.source ? (
                  <span>
                    <strong>source</strong>
                    {event.source}
                  </span>
                ) : null}
                {event.level ? (
                  <span>
                    <strong>level</strong>
                    {event.level}
                  </span>
                ) : null}
                {event.executionId ? (
                  <span>
                    <strong>execution</strong>
                    {event.executionId}
                  </span>
                ) : null}
                {event.payload ? <code>{JSON.stringify(event.payload)}</code> : null}
                {event.error ? <code>{JSON.stringify(event.error)}</code> : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function LogStream({ lines }: { lines: string[] }) {
  const { t } = useTranslation();
  return (
    <pre className="log-stream" aria-label={t('runDetail.output')}>
      {lines.map((line, index) => (
        <code key={`${line}-${index}`}>{line}</code>
      ))}
    </pre>
  );
}

export function ApprovalCard({ approval, onOpen }: { approval: ApprovalRequest; onOpen?: (approval: ApprovalRequest) => void }) {
  const { t } = useTranslation();

  return (
    <article className="approval-card">
      <div>
        <h3>{approval.title}</h3>
        <p>{approval.actionSummary}</p>
        <div className="approval-meta">
          <StatusBadge status={approval.status} />
          <RiskTierBadge tier={approval.riskTier} />
          <span>{t('common.minutesLeft', { count: approval.expiresInMinutes })}</span>
        </div>
      </div>
      {onOpen ? (
        <button className="text-button" type="button" onClick={() => onOpen(approval)}>
          {t('common.review')}
        </button>
      ) : null}
    </article>
  );
}

export function RunSummary({ run }: { run: AgentRunSummary }) {
  return (
    <article className="run-summary">
      <h3>{run.agentName}</h3>
      <p>{run.branchName}</p>
      <StatusBadge status={run.status} />
    </article>
  );
}
