import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageSkeleton, PendingButton } from '../components/LoadingStates';
import { ApprovalCard, Panel, RiskTierBadge, StatusBadge } from '../components/workbench';
import type { ApprovalRequest, ApprovalStatus } from '../domain/types';
import { decideApproval } from '../services/mockApi';
import './pages.css';
import { useDashboardData } from './useDashboardData';

export function ApprovalsPage() {
  const { t } = useTranslation();
  const { workspaceId = 'w_core' } = useParams();
  const { dashboard, error } = useDashboardData(workspaceId);
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, ApprovalRequest>>({});
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const currentSelection = selected ? decisions[selected.id] ?? selected : null;
  const approvals = (dashboard?.pendingApprovals ?? []).filter((approval) => !decisions[approval.id]);
  const canDecide = Boolean(currentSelection?.status === 'pending' && reason.trim().length >= 8 && !pending);

  function openApproval(approval: ApprovalRequest) {
    setSelected(approval);
    setReason(approval.decisionReason ?? '');
    setDecisionError(null);
  }

  async function decideSelected(decision: Extract<ApprovalStatus, 'approved' | 'denied'>) {
    if (!currentSelection || !canDecide) {
      return;
    }

    setPending(true);
    setDecisionError(null);

    try {
      const result = await decideApproval(currentSelection.id, decision, reason.trim());
      setDecisions((current) => ({ ...current, [result.id]: result }));
      setSelected(result);
    } catch (caught) {
      setDecisionError(caught instanceof Error ? caught.message : 'Approval decision failed');
    } finally {
      setPending(false);
    }
  }

  if (!dashboard && !error) {
    return <PageSkeleton label={t('common.loadingApprovals')} />;
  }

  return (
    <section className="page-stack spacious-page">
      {error ? <div role="alert">{error}</div> : null}
      <div className="work-grid">
        <Panel title={t('common.pendingQueue')}>
          <div className="list-stack">
            {approvals.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} onOpen={openApproval} />
            ))}
          </div>
        </Panel>
        <aside className="panel approval-side-panel" aria-label="Approval evidence" role="complementary">
          {currentSelection ? (
            <>
              <div className="panel-head">
                <h2>{currentSelection.title}</h2>
                <RiskTierBadge tier={currentSelection.riskTier} />
              </div>
              <div className="evidence-stack">
                <p>{currentSelection.actionSummary}</p>
                <dl className="detail-grid">
                  <div>
                    <dt>{t('common.sourceRun')}</dt>
                    <dd>{currentSelection.sourceRunId}</dd>
                  </div>
                  <div>
                    <dt>{t('common.branch')}</dt>
                    <dd>{currentSelection.branchName}</dd>
                  </div>
                  <div>
                    <dt>{t('common.nextStep')}</dt>
                    <dd>{t('approvals.nextStep')}</dd>
                  </div>
                </dl>
                <label className="field-stack">
                  <span>{t('common.decisionReason')}</span>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={t('approvals.reasonPlaceholder')}
                  />
                </label>
                {decisionError ? <p role="alert">{decisionError}</p> : null}
                {currentSelection.status !== 'pending' ? (
                  <div className="decision-status" aria-live="polite">
                    <StatusBadge status={currentSelection.status} />
                    <span>{currentSelection.decisionReason}</span>
                  </div>
                ) : null}
                <div className="card-actions">
                  <PendingButton disabled={!canDecide} onClick={() => decideSelected('approved')} pending={pending}>
                    {pending ? t('common.approving') : t('common.approve')}
                  </PendingButton>
                  <PendingButton className="danger-button" disabled={!canDecide} onClick={() => decideSelected('denied')} pending={pending}>
                    {t('common.deny')}
                  </PendingButton>
                </div>
              </div>
            </>
          ) : (
            <div className="side-panel-placeholder">
              <h2>{t('approvals.placeholderTitle')}</h2>
              <p>{t('approvals.placeholderText')}</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
