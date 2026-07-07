import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Panel, RiskTierBadge, StatusBadge } from '../components/workbench';
import './pages.css';
import { useDashboardData } from './useDashboardData';

export function SkillReviewPage() {
  const { t } = useTranslation();
  const { draftId = 'sd_motion', workspaceId = 'w_core' } = useParams();
  const { dashboard, error } = useDashboardData(workspaceId);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);

  const draft = dashboard?.skillDrafts.find((candidate) => candidate.id === draftId);
  const draftError = dashboard && !draft ? t('skills.notFound', { id: draftId }) : null;

  return (
    <section className="page-stack spacious-page">
      <div className="page-toolbar">
        <div className="card-actions">
          <button className="text-button" type="button" onClick={() => setDecisionMessage(t('skills.publishedAs'))}>
            {t('skills.publishSkill')}
          </button>
          <button className="text-button danger-button" type="button" onClick={() => setDecisionMessage(t('skills.rejectedDraft'))}>
            {t('skills.rejectDraft')}
          </button>
        </div>
      </div>
      {error ? <div role="alert">{error}</div> : null}
      {draftError ? <div role="alert">{draftError}</div> : null}
      {decisionMessage ? (
        <div className="operation-feedback" role="status">
          {decisionMessage}
        </div>
      ) : null}
      {draft ? (
        <div className="content-grid two-column">
          <Panel title={t('common.evidence')}>
            <article className="entity-row">
              <div>
                <h3>{draft.name}</h3>
                <p>
                  {draft.versionPreview} · {draft.riskSummary}
                </p>
                <p>
                  {t('skills.sourceLearningRun')}: {draft.sourceLearningRun}
                </p>
              </div>
              <div className="list-stack">
                <StatusBadge status={draft.status} />
                <RiskTierBadge tier="publish" />
              </div>
            </article>
          </Panel>
          <Panel title={t('common.versionDiff')}>
            <pre className="diff-panel" aria-label={t('common.versionDiff')}>
              <code>{t('skills.diffAdded')}</code>
              <code>{t('skills.diffKept')}</code>
              <code>{t('skills.diffRemoved')}</code>
            </pre>
          </Panel>
        </div>
      ) : null}
    </section>
  );
}
