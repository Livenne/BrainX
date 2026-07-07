import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AgentBranch } from '../domain/types';
import { PageSkeleton } from '../components/LoadingStates';
import { Panel, RiskTierBadge, StatusBadge } from '../components/workbench';
import './pages.css';
import { useDashboardData } from './useDashboardData';

export function BranchesPage() {
  const { t } = useTranslation();
  const { workspaceId = 'w_core' } = useParams();
  const { dashboard, error } = useDashboardData(workspaceId);
  const [selectedBranch, setSelectedBranch] = useState<AgentBranch | null>(null);
  const [adoptionMessage, setAdoptionMessage] = useState<string | null>(null);

  const currentBranch = selectedBranch ?? dashboard?.branches[0] ?? null;

  if (!dashboard && !error) {
    return <PageSkeleton label={t('common.loadingDashboard')} />;
  }

  return (
    <section className="page-stack spacious-page">
      {error ? <div role="alert">{error}</div> : null}
      <div className="content-grid two-column">
        <Panel title={t('branches.branchList')}>
          <div className="list-stack">
            {(dashboard?.branches ?? []).map((branch) => (
              <article className="entity-row" key={branch.id}>
                <div>
                  <h3>{branch.name}</h3>
                  <p>
                    {branch.sourceAgent} · {branch.pendingApprovals} {t('common.pendingApprovals')}
                  </p>
                  <p>{branch.adoptionRiskSummary}</p>
                </div>
                <div className="list-stack">
                  <StatusBadge status={branch.status} />
                  {branch.adoptionReady ? <RiskTierBadge tier="publish" /> : null}
                  <button
                    className="text-button"
                    type="button"
                    aria-label={t('branches.reviewBranch', { branch: branch.name })}
                    onClick={() => {
                      setSelectedBranch(branch);
                      setAdoptionMessage(null);
                    }}
                  >
                    {t('common.review')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </Panel>
        <aside className="panel" aria-label={t('branches.adoptionReview')} role="complementary">
          <div className="panel-head">
            <h2>{t('branches.adoptionReview')}</h2>
          </div>
          <div className="quiet-panel">
            <h3>{currentBranch ? t('branches.adoptionTarget', { branch: currentBranch.name }) : t('branches.adoptionReady')}</h3>
            <p>{t('branches.noMemoryMerge')}</p>
            {currentBranch ? <p>{currentBranch.adoptionRiskSummary}</p> : null}
            {adoptionMessage ? <p role="status">{adoptionMessage}</p> : null}
            <button
              className="text-button"
              disabled={!currentBranch?.adoptionReady}
              type="button"
              onClick={() => currentBranch && setAdoptionMessage(t('branches.adoptedSelected', { branch: currentBranch.name }))}
            >
              {t('branches.adoptSelected')}
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
