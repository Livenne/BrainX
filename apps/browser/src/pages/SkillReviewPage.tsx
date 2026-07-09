import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed, FileText, Globe2, Laptop, ShieldCheck, XCircle } from 'lucide-react';
import { useParams } from 'react-router-dom';
import {
  approveSkillProposal as approveRealSkillProposal,
  getSkillInventory as getRealSkillInventory,
  getSkillProposals as getRealSkillProposals,
  rejectSkillProposal as rejectRealSkillProposal
} from '../services/brainxApi';
import {
  approveSkillProposal as approveMockSkillProposal,
  getSkillInventory as getMockSkillInventory,
  getSkillProposals as getMockSkillProposals,
  rejectSkillProposal as rejectMockSkillProposal
} from '../services/mockApi';
import type { SkillInventory, SkillProposal, SkillSummary } from '../domain/types';
import './pages.css';

const useMockSkillsApi = import.meta.env.MODE === 'test';

async function loadSkills(workspaceId: string): Promise<SkillInventory> {
  return useMockSkillsApi ? getMockSkillInventory(workspaceId) : getRealSkillInventory(workspaceId);
}

async function loadProposals(workspaceId: string): Promise<SkillProposal[]> {
  return useMockSkillsApi ? getMockSkillProposals(workspaceId) : getRealSkillProposals(workspaceId);
}

async function approveProposal(proposalId: string): Promise<SkillProposal> {
  return useMockSkillsApi ? approveMockSkillProposal(proposalId) : approveRealSkillProposal(proposalId);
}

async function rejectProposal(proposalId: string): Promise<SkillProposal> {
  return useMockSkillsApi ? rejectMockSkillProposal(proposalId) : rejectRealSkillProposal(proposalId);
}

export function SkillReviewPage() {
  const { workspaceId = 'w_core' } = useParams();
  const [inventory, setInventory] = useState<SkillInventory>({ project: [], global: [] });
  const [proposals, setProposals] = useState<SkillProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pendingProposals = useMemo(
    () => proposals.filter((proposal) => proposal.status === 'review_requested'),
    [proposals]
  );
  const approvalResults = useMemo(
    () => proposals.filter((proposal) => proposal.status !== 'review_requested'),
    [proposals]
  );

  const refreshSkills = useCallback(async () => {
    const [nextInventory, nextProposals] = await Promise.all([loadSkills(workspaceId), loadProposals(workspaceId)]);
    setInventory(nextInventory);
    setProposals(nextProposals);
    setError(null);
    return { inventory: nextInventory, proposals: nextProposals };
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    Promise.all([loadSkills(workspaceId), loadProposals(workspaceId)])
      .then(([nextInventory, nextProposals]) => {
        if (!active) return;
        setInventory(nextInventory);
        setProposals(nextProposals);
        setError(null);
        setLoaded(true);
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Failed to load skills');
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  async function decide(proposalId: string, decision: 'approve' | 'reject') {
    try {
      const updated = decision === 'approve' ? await approveProposal(proposalId) : await rejectProposal(proposalId);
      setProposals((current) => current.map((proposal) => (proposal.id === updated.id ? updated : proposal)));
      await refreshSkills();
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to review skill proposal');
    }
  }

  return (
    <section className="page-stack spacious-page skills-console-page">
      {error ? <div role="alert">{error}</div> : null}
      {!loaded ? <p className="empty-copy">Loading skills...</p> : null}
      {loaded ? (
        <>
          <section className="skills-panel" aria-label="Global skills">
            <h2>Global skills</h2>
            <GlobalSkillGroups inventory={inventory} />
          </section>
          <section className="skills-panel" aria-label="Skill proposals">
            <PanelHeading title="Pending proposals" detail={`${pendingProposals.length}`} />
            {pendingProposals.length ? (
              <div className="skill-proposal-list">
                {pendingProposals.map((proposal) => (
                  <article className="skill-proposal-row" key={proposal.id}>
                    <span className="skill-row-icon" aria-hidden="true">
                      <ShieldCheck size={17} />
                    </span>
                    <div className="skill-row-copy">
                      <h3>{proposal.name}</h3>
                      <p>{proposal.reason || proposal.path}</p>
                      <ProposalMeta proposal={proposal} />
                    </div>
                    <div className="card-actions">
                      <button className="text-button" type="button" onClick={() => void decide(proposal.id, 'approve')}>
                        Approve
                      </button>
                      <button className="text-button danger-button" type="button" onClick={() => void decide(proposal.id, 'reject')}>
                        Reject
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-copy">No pending skill proposals.</p>
            )}
          </section>
          <section className="skills-panel" aria-label="Approval results">
            <PanelHeading title="Approval results" detail={`${approvalResults.length}`} />
            {approvalResults.length ? (
              <div className="skill-proposal-list">
                {approvalResults.map((proposal) => (
                  <article className="skill-proposal-row" key={proposal.id}>
                    <ReviewStatusIcon status={proposal.status} />
                    <div className="skill-row-copy">
                      <h3>{proposal.name}</h3>
                      <p>{proposal.reason || proposal.path}</p>
                      <ProposalMeta proposal={proposal} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-copy">No reviewed skill proposals.</p>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function GlobalSkillGroups({ inventory }: { inventory: SkillInventory }) {
  const groups = inventory.globalByDaemon?.length
    ? inventory.globalByDaemon
    : inventory.global.length
      ? [{ daemonId: 'global', deviceName: 'Global', status: '', global: inventory.global }]
      : [];
  if (!groups.length) {
    return <p className="empty-copy">No global skills found.</p>;
  }
  return (
    <div className="skill-daemon-group-list">
      {groups.map((group) => (
        <section className="skill-daemon-group" key={group.daemonId} aria-label={group.deviceName}>
          <div className="skill-daemon-heading">
            <span className="skill-daemon-device-icon" aria-hidden="true">
              <Laptop size={16} />
            </span>
            <h3>{group.deviceName || group.daemonId}</h3>
            {group.status ? <StatusLight label={`Skill daemon ${group.status}`} status={group.status} /> : null}
          </div>
          <SkillList skills={group.global} emptyLabel="No global skills found on this device." />
        </section>
      ))}
    </div>
  );
}

function PanelHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="skills-panel-heading">
      <h2>{title}</h2>
      {detail ? <span aria-label={`${title} count`}>{detail}</span> : null}
    </div>
  );
}

function proposalWorkPath(proposal: SkillProposal): string {
  const path = normalizeSkillPath(proposal.path);
  const marker = '/.agents/skills/';
  const markerIndex = path.indexOf(marker);
  if (markerIndex >= 0) {
    return path.slice(0, markerIndex) || path;
  }
  return path;
}

function ProposalMeta({ proposal }: { proposal: SkillProposal }) {
  return (
    <small className="skill-proposal-meta">
      <span>{proposal.scope}</span>
      <span>{proposalWorkPath(proposal)}</span>
      <span>{proposal.path}</span>
    </small>
  );
}

function StatusLight({ label, status }: { label: string; status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized.includes('online') || normalized.includes('ok') || normalized.includes('active') ? 'ok' : normalized.includes('fail') || normalized.includes('offline') ? 'danger' : 'muted';
  return <span className="skill-status-light" data-tone={tone} aria-label={label} />;
}

function ReviewStatusIcon({ status }: { status: SkillProposal['status'] }) {
  const normalized = String(status);
  if (normalized === 'approved' || normalized === 'published') {
    return (
      <span className="skill-review-state" data-tone="ok" aria-label="Skill review approved">
        <CheckCircle2 size={17} />
      </span>
    );
  }
  if (normalized === 'rejected') {
    return (
      <span className="skill-review-state" data-tone="danger" aria-label="Skill review rejected">
        <XCircle size={17} />
      </span>
    );
  }
  if (normalized === 'apply_failed') {
    return (
      <span className="skill-review-state" data-tone="danger" aria-label="Skill publish failed">
        <XCircle size={17} />
      </span>
    );
  }
  return (
    <span className="skill-review-state" data-tone="muted" aria-label="Skill review superseded">
      <CircleDashed size={17} />
    </span>
  );
}

function normalizeSkillPath(path?: string): string {
  return (path ?? '').trim().replaceAll('\\', '/');
}

function SkillList({ skills, emptyLabel }: { skills: SkillSummary[]; emptyLabel: string }) {
  if (!skills.length) {
    return <p className="empty-copy">{emptyLabel}</p>;
  }
  return (
    <ul className="skill-list">
      {skills.map((skill) => (
        <li key={skill.id || skill.path}>
          <span className="skill-row-icon" aria-hidden="true">
            {skill.scope === 'global' ? <Globe2 size={17} /> : <FileText size={17} />}
          </span>
          <div className="skill-row-copy">
            <span>{skill.name}</span>
            <small>{skill.description || skill.path}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}
