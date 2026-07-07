import { beforeEach, describe, expect, it } from 'vitest';
import { createDashboardData } from '../data/mockData';
import { decideApproval, getDashboard, getRunDetail, resetMockApiState } from '../services/mockApi';

describe('mock API', () => {
  beforeEach(() => {
    resetMockApiState();
  });

  it('returns dashboard data with active runs and approvals', async () => {
    const dashboard = await getDashboard('w_core');

    expect(dashboard.workspace.id).toBe('w_core');
    expect(dashboard.activeRuns.length).toBeGreaterThan(0);
    expect(dashboard.pendingApprovals.some((approval) => approval.riskTier === 'publish')).toBe(true);
  });

  it('returns dashboard run summaries without detail-only fields', async () => {
    const dashboard = await getDashboard('w_core');

    expect(dashboard.activeRuns[0]).not.toHaveProperty('events');
    expect(dashboard.activeRuns[0]).not.toHaveProperty('output');
    expect(dashboard.activeRuns[0]).not.toHaveProperty('artifacts');
  });

  it('updates approval state through decideApproval', async () => {
    const approval = await decideApproval('ap_publish_skill', 'approved', 'Reviewed scope and evidence');

    expect(approval.status).toBe('approved');
    expect(approval.decisionReason).toBe('Reviewed scope and evidence');
  });

  it('returns run detail with ordered events', async () => {
    const run = await getRunDetail('run_8f3a');

    expect(run.events[0].sequence).toBeLessThan(run.events[run.events.length - 1].sequence);
  });

  it('returns dashboard snapshots that cannot mutate service state', async () => {
    const dashboard = await getDashboard('w_core');

    dashboard.workspace.name = 'mutated-workspace';
    dashboard.activeRuns[0].agentName = 'mutated-agent';
    dashboard.pendingApprovals[0].title = 'mutated-approval';
    dashboard.branches[0].name = 'mutated-branch';
    dashboard.skillDrafts[0].name = 'mutated-skill';
    dashboard.daemons[0].name = 'mutated-daemon';
    dashboard.recentEvents[0].message = 'mutated-event';

    const nextDashboard = await getDashboard('w_core');
    expect(nextDashboard.workspace.name).toBe('workspace-core');
    expect(nextDashboard.activeRuns[0].agentName).toBe('frontend-main');
    expect(nextDashboard.pendingApprovals[0].title).toBe('Publish skill version');
    expect(nextDashboard.branches[0].name).toBe('motion-v2');
    expect(nextDashboard.skillDrafts[0].name).toBe('browser-motion-review');
    expect(nextDashboard.daemons[0].name).toBe('brainx-client-local');
    expect(nextDashboard.recentEvents[0].message).toBe('Planning branch adoption scope');
  });

  it('creates dashboard fixture snapshots that cannot mutate each other', () => {
    const dashboard = createDashboardData();

    dashboard.workspace.name = 'mutated-workspace';
    dashboard.activeRuns[0].agentName = 'mutated-agent';
    dashboard.pendingApprovals[0].title = 'mutated-approval';
    dashboard.branches[0].name = 'mutated-branch';
    dashboard.skillDrafts[0].name = 'mutated-skill';
    dashboard.daemons[0].name = 'mutated-daemon';
    dashboard.recentEvents[0].message = 'mutated-event';

    const nextDashboard = createDashboardData();
    expect(nextDashboard.workspace.name).toBe('workspace-core');
    expect(nextDashboard.activeRuns[0].agentName).toBe('frontend-main');
    expect(nextDashboard.activeRuns[0]).not.toHaveProperty('events');
    expect(nextDashboard.pendingApprovals[0].title).toBe('Publish skill version');
    expect(nextDashboard.branches[0].name).toBe('motion-v2');
    expect(nextDashboard.skillDrafts[0].name).toBe('browser-motion-review');
    expect(nextDashboard.daemons[0].name).toBe('brainx-client-local');
    expect(nextDashboard.recentEvents[0].message).toBe('Planning branch adoption scope');
  });

  it('returns run detail snapshots that cannot mutate service state', async () => {
    const run = await getRunDetail('run_8f3a');

    run.events[0].message = 'mutated-event';
    run.output[0] = 'mutated-output';
    run.artifacts[0] = 'mutated-artifact';

    const nextRun = await getRunDetail('run_8f3a');
    expect(nextRun.events[0].message).toBe('Planning branch adoption scope');
    expect(nextRun.output[0]).toBe('Collected route contracts from S-side mock API');
    expect(nextRun.artifacts[0]).toBe('browser shell patch');
  });

  it('returns approval snapshots that cannot mutate service state', async () => {
    const approval = await decideApproval('ap_execute_build', 'approved', 'Build verified');

    approval.title = 'mutated-title';
    approval.decisionReason = 'mutated-reason';

    const nextApproval = await decideApproval('ap_execute_build', 'approved', 'Build verified');
    expect(nextApproval.title).toBe('Execute build command');
    expect(nextApproval.decisionReason).toBe('Build verified');
  });
});
