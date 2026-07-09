import type {
  AgentBranch,
  AgentProfile,
  AgentRunDetail,
  AgentRunSummary,
  ApprovalRequest,
  ChatSession,
  ClientDaemon,
  DashboardData,
  ExecutionEvent,
  SkillDraft,
  Workspace
} from '../domain/types';

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

export const workspace: Workspace = {
  id: 'w_core',
  name: 'workspace-core',
  path: '~/.brainx/workspace',
  defaultWorkspace: true
};

export const events: ExecutionEvent[] = [
  {
    id: 'evt_001',
    type: 'agent.run.updated',
    sequence: 1,
    occurredAt: '2026-07-04T10:41:20Z',
    message: 'Planning branch adoption scope'
  },
  {
    id: 'evt_002',
    type: 'execution.requested',
    sequence: 2,
    occurredAt: '2026-07-04T10:42:03Z',
    message: 'Requested frontend verification through client daemon',
    riskTier: 'execute'
  },
  {
    id: 'evt_003',
    type: 'approval.requested',
    sequence: 3,
    occurredAt: '2026-07-04T10:43:16Z',
    message: 'Write patch to browser app shell requires approval',
    riskTier: 'write'
  },
  {
    id: 'evt_004',
    type: 'skill.draft.created',
    sequence: 4,
    occurredAt: '2026-07-04T10:44:02Z',
    message: 'Learning run created a reusable workflow skill draft',
    riskTier: 'publish'
  }
];

export const activeRuns: AgentRunDetail[] = [
  {
    id: 'run_8f3a',
    agentId: 'agent_frontend',
    agentName: 'frontend-main',
    branchName: 'mainline',
    status: 'waiting_for_approval',
    updatedAt: '2026-07-04T10:44:02Z',
    events,
    output: [
      'Collected route contracts from S-side mock API',
      'Prepared diff summary for approval review',
      'execution.output sequence=148 stream=run_8f3a',
      'Waiting for write approval before applying browser shell patch'
    ],
    artifacts: ['browser shell patch', 'design token map', 'approval evidence summary']
  }
];

export const agents: AgentProfile[] = [
  {
    id: 'agent_frontend',
    name: 'frontend-main',
    summary: 'Owns B-side UI, interaction, and design-system delivery.',
    status: 'waiting_for_approval',
    activeRunCount: 1,
    lastRunId: 'run_8f3a',
    capabilities: ['React workbench', 'approval UX', 'design tokens'],
    memoryPolicy: 'Keeps UI decisions in workspace context; no branch memory merge.'
  },
  {
    id: 'agent_skill',
    name: 'skill-review',
    summary: 'Owns skill draft review and publish risk summaries.',
    status: 'planning',
    activeRunCount: 0,
    lastRunId: 'run_8f3a',
    capabilities: ['skill diff', 'evidence review', 'publish risk'],
    memoryPolicy: 'Learns from approved runs after review only.'
  }
];

export const approvals: ApprovalRequest[] = [
  {
    id: 'ap_publish_skill',
    title: 'Publish skill version',
    actionSummary: 'Create immutable SkillVersion from LearningRun #42',
    riskTier: 'publish',
    status: 'pending',
    sourceRunId: 'run_8f3a',
    branchName: 'mainline',
    expiresInMinutes: 2
  },
  {
    id: 'ap_execute_build',
    title: 'Execute build command',
    actionSummary: 'Run npm build through the Rust client daemon',
    riskTier: 'execute',
    status: 'pending',
    sourceRunId: 'run_8f3a',
    branchName: 'mainline',
    expiresInMinutes: 8
  },
  {
    id: 'ap_adopt_branch',
    title: 'Adopt branch artifact',
    actionSummary: 'Selectively adopt browser motion prototype output',
    riskTier: 'publish',
    status: 'pending',
    sourceRunId: 'run_8f3a',
    branchName: 'motion-v2',
    expiresInMinutes: 11
  }
];

export const branches: AgentBranch[] = [
  {
    id: 'br_motion',
    name: 'motion-v2',
    status: 'active',
    sourceAgent: 'frontend-main',
    pendingApprovals: 1,
    adoptionReady: true,
    adoptionRiskSummary: 'Selective adoption only; no memory merge or task history merge.'
  },
  {
    id: 'br_skill_review',
    name: 'skill-review-flow',
    status: 'paused',
    sourceAgent: 'frontend-main',
    pendingApprovals: 0,
    adoptionReady: false,
    adoptionRiskSummary: 'Exploration paused; review evidence before any adoption decision.'
  }
];

export const skillDrafts: SkillDraft[] = [
  {
    id: 'sd_motion',
    name: 'browser-motion-review',
    status: 'review_requested',
    sourceLearningRun: 'lr_42',
    versionPreview: 'v0.4 -> v0.5',
    riskSummary: 'Scope unchanged; adds loading and route transition guidance'
  }
];

export const daemons: ClientDaemon[] = [
  {
    id: 'cd_local',
    name: 'brainx-client-local',
    deviceName: 'Livenne Workstation',
    os: 'Ubuntu 24.04 / WSL',
    status: 'online',
    version: '0.1.0',
    activeTasks: 1,
    lastHeartbeatSeconds: 8,
    note: 'Primary local development client',
    registeredAt: '2026-07-04T09:24:00Z',
    workspacePath: '/home/Livenne/code/brainx'
  }
];

export const chatSessions: ChatSession[] = [
  {
    id: 'chat_main',
    title: 'Browser workbench run',
    workspaceName: workspace.name,
    currentWorkspace: '~/.brainx/workspace',
    agentId: 'agent_frontend',
    agentName: 'frontend-main',
    branchName: 'mainline',
    skillName: skillDrafts[0].name,
    clientName: daemons[0].name,
    runId: 'run_8f3a',
    runStatus: 'waiting_for_approval',
    todos: [
      { id: 'todo_context', label: 'Map AppShell and Chat route contracts', status: 'completed' },
      { id: 'todo_tokens', label: 'Replace ad hoc color tokens with brand-derived tokens', status: 'running' },
      { id: 'todo_approval', label: 'Prepare write approval evidence before patching', status: 'blocked' }
    ],
    terminals: [
      {
        id: 'term_browser',
        title: 'browser verification',
        status: 'waiting_for_approval',
        lines: ['npm test -- src/__tests__/v03Chat.test.tsx', 'waiting_for_approval: write_file apps/browser/src/pages/ChatPage.tsx']
      }
    ],
    subagents: [
      {
        id: 'sub_review',
        name: 'review-worker',
        status: 'planning',
        responsibility: 'Review tool evidence and risk tiers before adoption'
      }
    ],
    toolStates: {
      tool_read_appshell: {
        status: 'completed',
        riskTier: 'read'
      }
    },
    queuedInputs: [
      {
        id: 'queued_1',
        content: '插话：继续测试附件',
        attachments: [],
        createdAt: '2026-07-04T10:45:20Z'
      }
    ],
    updatedAt: '2026-07-04T10:45:16Z',
    messages: [
      {
        role: 'user',
        content: '先做前端，将前端完成后再实现后端。'
      },
      {
        role: 'assistant',
        thinking: 'Need to inspect current UI structure before changing the composer.',
        content: 'Plan\n\n- Inspect current AppShell and Chat files\n- Render tool calls and context references\n- Keep write execution gated by approval',
        tool_calls: [
          {
            id: 'tool_read_appshell',
            type: 'function',
            function: {
              name: 'read_files',
              arguments: JSON.stringify({
                files: [{ path: 'apps/browser/src/components/AppShell.tsx' }]
              })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'tool_read_appshell',
        name: 'read_files',
        content:
          '{"files":[{"ok":true,"path":"apps/browser/src/components/AppShell.tsx","content":"Located title bar, navigation, theme switch, and route outlet boundaries.","startLine":1,"endLine":1,"totalLines":1}]}'
      }
    ]
  }
];

export function createDashboardData(): DashboardData {
  return clone({
    workspace,
    agents,
    activeRuns: activeRuns.map(toRunSummary),
    pendingApprovals: approvals.filter((approval) => approval.status === 'pending'),
    branches,
    skillDrafts,
    daemons,
    chatSessions,
    recentEvents: events
  });
}
