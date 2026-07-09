import { useEffect, useMemo, useState } from 'react';
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

async function loadProposals(): Promise<SkillProposal[]> {
  return useMockSkillsApi ? getMockSkillProposals() : getRealSkillProposals();
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
  const pendingProposals = useMemo(
    () => proposals.filter((proposal) => proposal.status === 'review_requested'),
    [proposals]
  );

  useEffect(() => {
    let active = true;
    Promise.all([loadSkills(workspaceId), loadProposals()])
      .then(([nextInventory, nextProposals]) => {
        if (!active) return;
        setInventory(nextInventory);
        setProposals(nextProposals);
        setError(null);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Failed to load skills');
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  async function decide(proposalId: string, decision: 'approve' | 'reject') {
    try {
      const updated = decision === 'approve' ? await approveProposal(proposalId) : await rejectProposal(proposalId);
      setProposals((current) => current.map((proposal) => (proposal.id === updated.id ? updated : proposal)));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to review skill proposal');
    }
  }

  return (
    <section className="page-stack spacious-page skills-console-page">
      {error ? <div role="alert">{error}</div> : null}
      <div className="skills-console-grid">
        <section className="skills-panel" aria-label="Project skills">
          <h2>Current workspace</h2>
          <SkillList skills={inventory.project} emptyLabel="No project skills found." />
        </section>
        <section className="skills-panel" aria-label="Global skills">
          <h2>Global</h2>
          <SkillList skills={inventory.global} emptyLabel="No global skills found." />
        </section>
      </div>
      <section className="skills-panel" aria-label="Skill proposals">
        <h2>Pending proposals</h2>
        {pendingProposals.length ? (
          <div className="skill-proposal-list">
            {pendingProposals.map((proposal) => (
              <article className="skill-proposal-row" key={proposal.id}>
                <div>
                  <h3>{proposal.name}</h3>
                  <p>{proposal.reason || proposal.path}</p>
                  <small>{proposal.scope} · {proposal.path}</small>
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
    </section>
  );
}

function SkillList({ skills, emptyLabel }: { skills: SkillSummary[]; emptyLabel: string }) {
  if (!skills.length) {
    return <p className="empty-copy">{emptyLabel}</p>;
  }
  return (
    <ul className="skill-list">
      {skills.map((skill) => (
        <li key={skill.id || skill.path}>
          <span>{skill.name}</span>
          <small>{skill.description || skill.path}</small>
        </li>
      ))}
    </ul>
  );
}
