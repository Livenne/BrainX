import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EventTimeline, LogStream, Panel, StatusBadge } from '../components/workbench';
import type { AgentRunDetail } from '../domain/types';
import { getRunDetail } from '../services/mockApi';
import './pages.css';

type RunDetailState = {
  run: AgentRunDetail | null;
  error: string | null;
};

export function RunDetailPage() {
  const { t } = useTranslation();
  const { runId = 'run_8f3a' } = useParams();
  const [state, setState] = useState<RunDetailState>({ run: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ run: null, error: null });

    void getRunDetail(runId)
      .then((run) => {
        if (!cancelled) {
          setState({ run, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            run: null,
            error: error instanceof Error ? error.message : 'Run detail could not be loaded'
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (state.error) {
    return (
      <section className="page-stack" role="alert">
        {state.error}
      </section>
    );
  }

  const { run } = state;

  if (!run) {
    return <section className="page-stack" aria-label={t('common.loadingRunDetail')}>{t('common.loadingRunDetail')}...</section>;
  }

  return (
    <section className="page-stack spacious-page">
      <div className="status-strip">
        <span>{t('runDetail.subtitle', { agentName: run.agentName, branchName: run.branchName })}</span>
        <StatusBadge status={run.status} />
      </div>
      <div className="work-grid">
        <Panel title={t('runDetail.timeline')}>
          <EventTimeline events={run.events} />
        </Panel>
        <Panel title={t('runDetail.output')}>
          <LogStream lines={run.output} />
        </Panel>
      </div>
    </section>
  );
}
