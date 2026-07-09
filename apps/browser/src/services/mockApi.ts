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
  ChatAttachmentInput,
  ChatSession,
  ClientDaemon,
  DashboardData,
  ExecutionEvent,
  SkillDraft,
  SkillInventory,
  SkillProposal,
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
  skillInventory: SkillInventory;
  skillProposals: SkillProposal[];
};

type SkillInventoryOptions = {
  clientDaemonId?: string;
  currentWorkspace?: string;
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

function messageContentPreview(content: ChatSession['messages'][number]['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .map((part) => (part.type === 'text' ? part.text : 'image'))
    .join(' ')
    .trim();
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
    events: fixtureEvents,
    skillInventory: {
      projectRoot: '/home/Livenne/code/brainx',
      project: [
        {
          id: 'project-debug-rust',
          scope: 'project',
          name: 'debug-rust',
          description: 'Debug Rust failures',
          path: '/home/Livenne/code/brainx/.agents/skills/debug-rust/SKILL.md'
        }
      ],
      global: [
        {
          id: 'global-write-plan',
          scope: 'global',
          name: 'write-plan',
          description: 'Write implementation plans',
          path: '/home/Livenne/.agents/skills/write-plan/SKILL.md'
        }
      ],
      globalByDaemon: [
        {
          daemonId: 'cd_local',
          deviceName: 'Livenne Workstation',
          status: 'online',
          global: [
            {
              id: 'global-write-plan',
              scope: 'global',
              name: 'write-plan',
              description: 'Write implementation plans',
              path: '/home/Livenne/.agents/skills/write-plan/SKILL.md'
            }
          ]
        }
      ]
    },
    skillProposals: [
      {
        id: 'sp_project_review',
        workspaceId: fixtureWorkspace.id,
        runId: 'run_skill_reflect',
        daemonId: 'daemon_local',
        name: 'review-agent-output',
        scope: 'project',
        path: '/home/Livenne/code/brainx/.agents/skills/review-agent-output/SKILL.md',
        markdownContent: '# review-agent-output\n\nUse this skill to review agent output against project constraints.',
        reason: 'The agent identified a repeatable review checklist from recent work.',
        evidence: ['Repeated checks for AGENTS.md, tests, and local UI behavior.'],
        confidence: 0.82,
        status: 'review_requested',
        version: 1,
        createdAt: '2026-07-08T08:00:00.000Z',
        reviewedAt: null
      },
      {
        id: 'sp_global_summary',
        workspaceId: fixtureWorkspace.id,
        runId: 'run_skill_reflect',
        daemonId: 'daemon_local',
        name: 'summarize-session',
        scope: 'global',
        path: '/home/Livenne/.agents/skills/summarize-session/SKILL.md',
        markdownContent: '# summarize-session\n\nUse this skill to produce concise handoff summaries.',
        reason: 'Session handoff summaries are repeatedly useful across repositories.',
        evidence: ['The workflow reused structured summaries across B/S/C development.'],
        confidence: 0.76,
        status: 'review_requested',
        version: 1,
        createdAt: '2026-07-08T08:05:00.000Z',
        reviewedAt: null
      }
    ]
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
  const agentWorkStatus = state.chatSessions
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 6)
    .map((session) => ({
      sessionId: session.id,
      title: session.title || '新的会话',
      clientDaemonId: session.clientDaemonId ?? 'cd_local',
      clientName: session.clientName || state.daemons[0]?.deviceName || '',
      runStatus: session.runStatus,
      updatedAt: session.updatedAt,
      latestOutput: messageContentPreview(
        [...session.messages]
          .reverse()
          .find((message) => message.role === 'user' || message.role === 'assistant')?.content ?? ''
      ),
      contextBudget: session.contextBudget ?? {
        messageCount: session.messages.length,
        estimatedTokens: Math.max(1, session.messages.length * 1200),
        maxTokens: 128000,
        thresholdTokens: 96000,
        usageRatio: Math.min(1, Math.max(0, (session.messages.length * 1200) / 128000))
      }
    }));
  return clone({
    workspace: state.workspace,
    agents: state.agents,
    activeRuns: state.activeRuns.map(toRunSummary),
    pendingApprovals: state.approvals.filter((approval) => approval.status === 'pending'),
    branches: state.branches,
    skillDrafts: state.skillDrafts,
    daemons: state.daemons,
    chatSessions: state.chatSessions,
    recentEvents: state.events,
    stats: {
      tokenUsage: {
        total: 0,
        byModel: []
      },
      runningByClient: state.daemons.map((daemon) => ({
        clientDaemonId: daemon.id,
        clientName: daemon.deviceName,
        runningSessions: state.chatSessions.filter((session) => (session.clientDaemonId ?? state.daemons[0]?.id) === daemon.id && session.runStatus !== 'completed').length
      })),
      agentWorkStatus
    }
  });
}

export async function getWorkspaces(): Promise<Workspace[]> {
  await delay(60);
  return [clone(state.workspace)];
}

export async function getChatSessions(workspaceId: string, clientDaemonId?: string): Promise<ChatSession[]> {
  await delay(80);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  const sessions = clientDaemonId
    ? state.chatSessions.filter((session) => (session.clientDaemonId ?? 'cd_local') === clientDaemonId)
    : state.chatSessions;
  return clone(sessions);
}

export async function getClientDaemons(): Promise<ClientDaemon[]> {
  await delay(40);
  return clone(state.daemons);
}

export async function getSkillInventory(workspaceId: string, options?: SkillInventoryOptions): Promise<SkillInventory> {
  await delay(40);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  if (options?.currentWorkspace) {
    return clone({
      projectRoot: options.currentWorkspace,
      project: state.skillInventory.project.filter((skill) =>
        normalizePath(skill.path).startsWith(`${normalizePath(options.currentWorkspace ?? '')}/.agents/skills/`)
      ),
      global: state.skillInventory.global,
      globalByDaemon: []
    });
  }
  return clone({
    project: [],
    global: [],
    globalByDaemon: state.skillInventory.globalByDaemon ?? []
  });
}

export async function getSkillProposals(workspaceId?: string): Promise<SkillProposal[]> {
  await delay(40);
  const proposals = workspaceId
    ? state.skillProposals.filter((proposal) => proposal.workspaceId === workspaceId)
    : state.skillProposals;
  return clone(proposals);
}

export async function approveSkillProposal(proposalId: string): Promise<SkillProposal> {
  await delay(40);
  const proposal = state.skillProposals.find((candidate) => candidate.id === proposalId);
  if (!proposal) throw new Error(`Skill proposal ${proposalId} was not found`);
  proposal.status = 'approved';
  proposal.reviewedAt = new Date().toISOString();
  supersedeDuplicateSkillProposals(proposal);
  publishApprovedSkill(proposal);
  return clone(proposal);
}

export async function rejectSkillProposal(proposalId: string): Promise<SkillProposal> {
  await delay(40);
  const proposal = state.skillProposals.find((candidate) => candidate.id === proposalId);
  if (!proposal) throw new Error(`Skill proposal ${proposalId} was not found`);
  proposal.status = 'rejected';
  proposal.reviewedAt = new Date().toISOString();
  return clone(proposal);
}

function publishApprovedSkill(proposal: SkillProposal): void {
  const target = proposal.scope === 'global' ? state.skillInventory.global : state.skillInventory.project;
  if (target.some((skill) => normalizePath(skill.path) === normalizePath(proposal.path))) {
    return;
  }
  target.push({
    id: proposal.id,
    scope: proposal.scope,
    name: proposal.name,
    description: proposal.reason || proposal.path,
    path: proposal.path
  });
}

function supersedeDuplicateSkillProposals(proposal: SkillProposal): void {
  const path = normalizePath(proposal.path);
  if (!path) return;
  state.skillProposals.forEach((candidate) => {
    if (candidate.id === proposal.id) return;
    if (candidate.workspaceId !== proposal.workspaceId) return;
    if (candidate.status !== 'review_requested') return;
    if (normalizePath(candidate.path) === path) {
      candidate.status = 'superseded';
      candidate.reviewedAt = new Date().toISOString();
    }
  });
}

function normalizePath(path: string): string {
  return path.trim().replaceAll('\\', '/');
}

export async function createChatSession(workspaceId: string, title?: string): Promise<ChatSession> {
  await delay(60);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }

  const base = state.chatSessions[0];
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: `chat_${Date.now().toString(16)}`,
    title: title ?? null,
    workspaceId,
    workspaceName: base?.workspaceName ?? state.workspace.name,
    currentWorkspace: base?.currentWorkspace ?? state.workspace.path,
    clientDaemonId: base?.clientDaemonId ?? state.daemons[0]?.id,
    agentId: base?.agentId ?? 'agent_frontend',
    agentName: base?.agentName ?? 'frontend-main',
    branchName: base?.branchName ?? 'mainline',
    skillName: base?.skillName ?? 'none',
    clientName: base?.clientName ?? 'brainx-client-local',
    runId: '',
    runStatus: 'completed',
    todos: [],
    terminals: [],
    subagents: [],
    toolStates: {},
    queuedInputs: [],
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  state.chatSessions = [session, ...state.chatSessions];
  return clone(session);
}

export async function sendChatMessage(
  sessionId: string,
  content: string,
  attachments: ChatAttachmentInput[] = []
): Promise<ChatSession> {
  await delay(90);
  const session = state.chatSessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Chat session ${sessionId} was not found`);
  }

  const createdAt = new Date().toISOString();
  const messageIndex = session.messages.length + 1;
  session.messages.push({
    role: 'user',
    content,
    attachments
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

export async function sendChatCommand(
  workspaceId: string,
  command: string,
  args: Record<string, unknown> = {},
  sessionId?: string
): Promise<ChatSession> {
  await delay(50);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  const session = sessionId
    ? state.chatSessions.find((candidate) => candidate.id === sessionId)
    : state.chatSessions[0];
  if (!session) {
    throw new Error('No chat session is available');
  }
  const appendNotice = (kind: string, message: string, detail = '') => {
    session.timelineNotices = [
      ...(session.timelineNotices ?? []),
      {
        id: `notice_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        kind,
        message,
        detail,
        afterMessageIndex: session.messages.length,
        createdAt: new Date().toISOString()
      }
    ];
  };

  if (command === 'clear') {
    session.messages = [];
    session.toolStates = {};
    session.timelineNotices = [
      {
        id: `notice_${Date.now()}_clear`,
        kind: 'context_cleared',
        message: '已清空上下文',
        afterMessageIndex: 0,
        createdAt: new Date().toISOString()
      }
    ];
    session.updatedAt = new Date().toISOString();
    return clone(session);
  }

  if (command === 'model') {
    const modelName = typeof args.modelName === 'string' ? args.modelName : '';
    const exists = session.availableModels?.some((model) => model.name === modelName || model.key === modelName) ?? modelName === 'primary:example-chat-model';
    if (!modelName || !exists) {
      throw new Error(`Unknown model: ${modelName}`);
    }
    session.activeModelName = modelName;
    appendNotice('model_changed', `已切换模型：${modelName}`, modelName);
    session.updatedAt = new Date().toISOString();
    return clone(session);
  }

  if (command === 'workspace') {
    const path = typeof args.path === 'string' ? args.path : '';
    if (!path.trim()) {
      throw new Error('/workspace requires a path');
    }
    session.currentWorkspace = path;
    appendNotice('workspace_changed', `已切换工作目录：${path}`, path);
    session.updatedAt = new Date().toISOString();
    return clone(session);
  }

  if (command === 'compact') {
    appendNotice('context_compaction_requested', '正在压缩上下文');
    session.messages = [
      {
        role: 'system',
        content: 'Conversation compacted for future continuation.'
      },
      ...session.messages.slice(-6)
    ];
    session.updatedAt = new Date().toISOString();
    return clone(session);
  }

  return clone(session);
}

export async function renameChatSession(workspaceId: string, sessionId: string, title: string): Promise<ChatSession> {
  await delay(50);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  const session = state.chatSessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Chat session ${sessionId} was not found`);
  }
  session.title = title;
  session.updatedAt = new Date().toISOString();
  return clone(session);
}

export async function forkChatSession(workspaceId: string, sessionId: string): Promise<ChatSession> {
  await delay(50);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  const session = state.chatSessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Chat session ${sessionId} was not found`);
  }
  const forked: ChatSession = {
    ...clone(session),
    id: `chat_fork_${Date.now().toString(16)}`,
    title: `${session.title || '新的会话'} [fork: ${Date.now().toString(36).slice(-5)}]`,
    runId: '',
    runStatus: 'completed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.chatSessions = [forked, ...state.chatSessions];
  return clone(forked);
}

export async function deleteChatSession(workspaceId: string, sessionId: string): Promise<void> {
  await delay(50);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  const before = state.chatSessions.length;
  state.chatSessions = state.chatSessions.filter((candidate) => candidate.id !== sessionId);
  if (state.chatSessions.length === before) {
    throw new Error(`Chat session ${sessionId} was not found`);
  }
}

export async function cancelChatSession(workspaceId: string, sessionId: string): Promise<ChatSession> {
  await delay(40);
  if (state.workspace.id !== workspaceId) {
    throw new Error(`Workspace ${workspaceId} was not found`);
  }
  const session = state.chatSessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Chat session ${sessionId} was not found`);
  }
  session.runStatus = 'cancelled';
  session.queuedInputs = [];
  session.updatedAt = new Date().toISOString();
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
