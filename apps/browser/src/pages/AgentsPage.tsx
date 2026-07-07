import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageSkeleton } from '../components/LoadingStates';
import { MetricCard, Panel, StatusBadge } from '../components/workbench';
import './pages.css';
import { useDashboardData } from './useDashboardData';

export function AgentsPage() {
  const { t } = useTranslation();
  const { workspaceId = 'w_core' } = useParams();
  const { dashboard, error } = useDashboardData(workspaceId);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);

  if (!dashboard && !error) {
    return <PageSkeleton label={t('common.loadingDashboard')} />;
  }

  return (
    <section className="page-stack spacious-page">
      <div className="page-toolbar">
        <button className="text-button" type="button" onClick={() => setOperationMessage(t('agents.agentDraftCreated'))}>
          {t('agents.createAgent')}
        </button>
      </div>
      {error ? <div role="alert">{error}</div> : null}
      {operationMessage ? (
        <div className="operation-feedback" role="status">
          {operationMessage}
        </div>
      ) : null}
      <div className="metric-grid">
        <MetricCard label={t('agents.agentList')} value={String(dashboard?.agents.length ?? 0).padStart(2, '0')} hint={t('agents.capabilities')} />
        <MetricCard label={t('common.activeRuns')} value={String(dashboard?.activeRuns.length ?? 0).padStart(2, '0')} hint={t('agents.recentRun')} />
        <MetricCard
          label={t('common.pendingApprovals')}
          value={String(dashboard?.pendingApprovals.length ?? 0).padStart(2, '0')}
          hint={t('agents.launchQueue')}
        />
        <MetricCard label={t('agents.memoryPolicy')} value="S" hint="workspace context" />
      </div>
      <div className="content-grid two-column">
        <Panel title={t('agents.agentList')}>
          <div className="agent-grid">
            {(dashboard?.agents ?? []).map((agent) => (
              <article className="agent-card" key={agent.id}>
                <header>
                  <div>
                    <h3>{agent.name}</h3>
                    <p>{agent.summary}</p>
                  </div>
                  <StatusBadge status={agent.status} />
                </header>
                <dl className="detail-grid">
                  <div>
                    <dt>{t('agents.recentRun')}</dt>
                    <dd>{agent.lastRunId}</dd>
                  </div>
                  <div>
                    <dt>{t('common.activeRuns')}</dt>
                    <dd>{agent.activeRunCount}</dd>
                  </div>
                  <div>
                    <dt>{t('agents.memoryPolicy')}</dt>
                    <dd>{agent.memoryPolicy}</dd>
                  </div>
                </dl>
                <div className="chip-row">
                  {agent.capabilities.map((capability) => (
                    <span className="chip" key={capability}>
                      {capability}
                    </span>
                  ))}
                </div>
                <div className="card-actions">
                  <button className="text-button" type="button" onClick={() => setOperationMessage(t('agents.runQueued', { agent: agent.name }))}>
                    {t('agents.startRun')}
                  </button>
                  <button className="text-button" type="button" onClick={() => setOperationMessage(t('agents.branchForked', { agent: agent.name }))}>
                    {t('agents.forkBranch')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </Panel>
        <Panel title={t('agents.launchQueue')}>
          <div className="quiet-panel">
            <h3>{t('agents.startRun')}</h3>
            <p>{t('agents.frontendSummary')}</p>
            <p>{t('agents.reviewSummary')}</p>
          </div>
        </Panel>
      </div>
    </section>
  );
}
