import {
  activeRuns as fixtureActiveRuns,
  agents as fixtureAgents,
  approvals as fixtureApprovals,
  branches as fixtureBranches,
  chatSessions as fixtureChatSessions,
  daemons as fixtureDaemons,
  events as fixtureEvents,
  skillDrafts as fixtureSkillDrafts,
  workspace as fixtureWorkspace
} from '../data/mockData';
import type {
  AgentBranch,
  AgentProfile,
  AgentRunDetail,
  AgentRunSummary,
  ApprovalRequest,
  ApprovalStatus,
  ChatSession,
  ClientDaemon,
  DashboardData,
  ExecutionEvent,
  SkillDraft,
  Workspace
} from '../domain/types';

type MockApiState = {
  workspace: Workspace;
  activeRuns: AgentRunDetail[];
  agents: AgentProfile[];
  approvals: ApprovalRequest[];
  branches: AgentBranch[];
  skillDrafts: SkillDraft[];
  daemons: ClientDaemon[];
  chatSessions: ChatSession[];
  events: ExecutionEvent[];
};

const clone = <T>(value: T): T => globalThis.structuredClone(value);

function toRunSummary(run: AgentRunDetail): AgentRunSummary {
  return {
    id: run.id,
    agentId: run.agentId,
    agentName: run.agentName,
    branchName: run.branchName,
    status: run.status,
    updatedAt: run.updatedAt
  };
}

function createInitialState(): MockApiState {
  return clone({
    workspace: fixtureWorkspace,
    activeRuns: fixtureActiveRuns,
    agents: fixtureAgents,
    approvals: fixtureApprovals,
    branches: fixtureBranches,
    skillDrafts: fixtureSkillDrafts,
    daemons: fixtureDaemons,
    chatSessions: fixtureChatSessions,
    events: fixtureEvents
  });
}

let state = createInitialState();

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

export function resetMockApiState(): void {
  state = createInitialState();
}

export async function getDashboard(workspaceId: string): Promise<DashboardData> {
  await delay(120);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  return clone({
    workspace: state.workspace,
    agents: state.agents,
    activeRuns: state.activeRuns.map(toRunSummary),
    pendingApprovals: state.approvals.filter((approval) => approval.status === 'pending'),
    branches: state.branches,
    skillDrafts: state.skillDrafts,
    daemons: state.daemons,
    chatSessions: state.chatSessions,
    recentEvents: state.events
  });
}

export async function getWorkspaces(): Promise<Workspace[]> {
  await delay(60);
  return [clone(state.workspace)];
}

export async function getChatSessions(workspaceId: string): Promise<ChatSession[]> {
  await delay(80);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  return clone(state.chatSessions);
}

export async function sendChatMessage(sessionId: string, content: string): Promise<ChatSession> {
  await delay(90);
  const session = state.chatSessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Chat session ${sessionId} was not found`);
  }

  const createdAt = new Date().toISOString();
  const messageIndex = session.messages.length + 1;
  session.messages.push({
    role: 'user',
    content
  });
  session.messages.push({
    role: 'assistant',
    content: `Queued for ${session.agentName} on ${session.branchName}.`,
    tool_calls: [
      {
        id: `tool_${messageIndex}_explore`,
        type: 'function',
        function: {
          name: 'search_workspace',
          arguments: JSON.stringify({ query: content, mode: 'text', maxResults: 20 })
        }
      }
    ]
  });
  session.toolStates[`tool_${messageIndex}_explore`] = {
    status: 'queued',
    riskTier: 'read'
  };
  session.updatedAt = createdAt;
  return clone(session);
}

export async function addClientDevice(): Promise<ClientDaemon> {
  await delay(80);
  const device: ClientDaemon = {
    id: `cd_mock_${Date.now()}`,
    name: 'brainx-client-new',
    deviceName: 'New Client Device',
    os: 'macOS 15.0',
    status: 'stale',
    version: '0.1.0',
    activeTasks: 0,
    lastHeartbeatSeconds: 42,
    note: 'Review before allowing execution tasks',
    registeredAt: new Date().toISOString(),
    workspacePath: '/Users/local/brainx'
  };
  state.daemons.push(device);
  return clone(device);
}

export async function updateClientDeviceNote(clientId: string, note: string): Promise<ClientDaemon> {
  await delay(80);
  const device = state.daemons.find((candidate) => candidate.id === clientId);
  if (!device) {
    throw new Error(`Client ${clientId} was not found`);
  }
  device.note = note;
  return clone(device);
}

export async function removeClientDevice(clientId: string): Promise<void> {
  await delay(80);
  const nextDaemons = state.daemons.filter((candidate) => candidate.id !== clientId);
  if (nextDaemons.length === state.daemons.length) {
    throw new Error(`Client ${clientId} was not found`);
  }
  state.daemons = nextDaemons;
}

export async function getRunDetail(runId: string): Promise<AgentRunDetail> {
  await delay(120);
  const run = state.activeRuns.find((candidate) => candidate.id === runId);
  if (!run) {
    throw new Error(`Run ${runId} was not found`);
  }
  return clone({
    ...run,
    events: [...run.events].sort((a, b) => a.sequence - b.sequence)
  });
}

export async function decideApproval(
  approvalId: string,
  decision: Extract<ApprovalStatus, 'approved' | 'denied'>,
  decisionReason: string
): Promise<ApprovalRequest> {
  await delay(180);
  const approval = state.approvals.find((candidate) => candidate.id === approvalId);
  if (!approval) {
    throw new Error(`Approval ${approvalId} was not found`);
  }
  approval.status = decision;
  approval.decisionReason = decisionReason;
  return clone(approval);
}
