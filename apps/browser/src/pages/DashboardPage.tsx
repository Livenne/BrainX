import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageSkeleton } from '../components/LoadingStates';
import { ApprovalCard, EventTimeline, LogStream, MetricCard, Panel, RunSummary } from '../components/workbench';
import { useWorkspaceEvents } from '../state/useWorkspaceEvents';
import './pages.css';
import { useDashboardData } from './useDashboardData';

export function DashboardPage() {
  const { t } = useTranslation();
  const { workspaceId = 'w_core' } = useParams();
  const { dashboard, error } = useDashboardData(workspaceId);
  const latestEvent = useWorkspaceEvents();

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

  return (
    <section className="page-stack">
      <p className="latest-event" aria-live="polite">
        {latestEvent ? `${t('common.latestEvent')}: ${latestEvent.type}` : t('common.listeningEvents')}
      </p>
      <div className="metric-grid">
        <MetricCard
          label={t('common.activeRuns')}
          value={String(dashboard.activeRuns.length).padStart(2, '0')}
          hint={t('dashboard.runsHint')}
        />
        <MetricCard
          label={t('common.pendingApprovals')}
          value={String(dashboard.pendingApprovals.length).padStart(2, '0')}
          hint={t('dashboard.approvalsHint')}
        />
        <MetricCard
          label={t('common.skillDrafts')}
          value={String(dashboard.skillDrafts.length).padStart(2, '0')}
          hint={t('dashboard.skillsHint')}
        />
        <MetricCard
          label={t('common.daemonHealth')}
          value="OK"
          hint={t('dashboard.daemonHint', { seconds: dashboard.daemons[0].lastHeartbeatSeconds })}
        />
      </div>
      <div className="work-grid">
        <Panel title={t('dashboard.runTimeline')}>
          <div className="list-stack">
            {dashboard.activeRuns.map((run) => (
              <RunSummary key={run.id} run={run} />
            ))}
          </div>
          <EventTimeline events={dashboard.recentEvents} />
          <LogStream lines={['Collected route contracts from S-side mock API', 'Waiting for approval evidence']} />
        </Panel>
        <Panel title={t('dashboard.approvalQueue')}>
          <div className="list-stack">
            {dashboard.pendingApprovals.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        </Panel>
      </div>
      <Panel title={t('dashboard.operationFocus')}>
        <p className="panel-copy">{t('dashboard.focusText')}</p>
      </Panel>
    </section>
  );
}
