export type RunStatus =
  | 'queued'
  | 'planning'
  | 'waiting_for_client'
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_user'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'client_offline';

export type RiskTier = 'safe' | 'risky' | 'network' | 'read' | 'write' | 'execute' | 'publish' | 'secret';
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
export type BranchStatus = 'active' | 'paused' | 'adopted' | 'archived';
export type SkillDraftStatus = 'draft' | 'review_requested' | 'approved' | 'published' | 'rejected';
export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type ChatToolKind =
  | 'get_env'
  | 'get_environment'
  | 'read_files'
  | 'search_workspace'
  | 'web_search'
  | 'apply_patch'
  | 'write_file'
  | 'run_command'
  | 'ask_user'
  | 'todo_update'
  | 'background_start'
  | 'background_read'
  | 'background_stop'
  | 'subagent_start'
  | 'subagent_read'
  | 'subagent_stop'
  | string;
export type ChatMessageBlock =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'markdown';
      content: string;
    }
  | {
      type: 'tool_call';
      call: AgentToolCall;
    }
  | {
      type: 'tool_result';
      callId: string;
      title: string;
      content: string;
      status: 'running' | 'completed' | 'failed';
    }
  | {
      type: 'context_ref';
      title: string;
      refs: string[];
    }
  | {
      type: 'image';
      src: string;
      alt: string;
      caption?: string;
    };

export type Workspace = {
  id: string;
  name: string;
  path?: string;
  defaultWorkspace?: boolean;
  status?: string;
  createdAt?: string;
};

export type AgentRunSummary = {
  id: string;
  agentId: string;
  agentName: string;
  branchName: string;
  status: RunStatus;
  updatedAt: string;
};

export type AgentProfile = {
  id: string;
  name: string;
  summary: string;
  status: RunStatus;
  activeRunCount: number;
  lastRunId: string;
  capabilities: string[];
  memoryPolicy: string;
};

export type ApprovalRequest = {
  id: string;
  title: string;
  actionSummary: string;
  riskTier: RiskTier;
  status: ApprovalStatus;
  sourceRunId: string;
  branchName: string;
  expiresInMinutes: number;
  decisionReason?: string;
};

export type ExecutionEvent = {
  id: string;
  type: string;
  sequence: number;
  occurredAt: string;
  message: string;
  riskTier?: RiskTier;
  source?: 'server' | 'client' | 'model' | 'tool' | 'browser' | string;
  level?: 'debug' | 'info' | 'warn' | 'error' | string;
  executionId?: string;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } | null;
};

export type AgentRunDetail = AgentRunSummary & {
  events: ExecutionEvent[];
  output: string[];
  artifacts: string[];
};

export type AgentBranch = {
  id: string;
  name: string;
  status: BranchStatus;
  sourceAgent: string;
  pendingApprovals: number;
  adoptionReady: boolean;
  adoptionRiskSummary: string;
};

export type SkillDraft = {
  id: string;
  name: string;
  status: SkillDraftStatus;
  sourceLearningRun: string;
  versionPreview: string;
  riskSummary: string;
};

export type ClientDaemon = {
  id: string;
  workspaceId?: string;
  userId?: string | null;
  name: string;
  deviceName: string;
  os: string;
  status: 'online' | 'offline' | 'stale' | 'active' | 'revoked';
  version: string;
  activeTasks: number;
  lastHeartbeatSeconds: number;
  note: string;
  registeredAt: string;
  boundAt?: string;
  lastHeartbeatAt?: string;
  workspacePath: string;
  capabilities?: string[];
};

export type AuthUser = {
  id: string;
  username: string;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export type BindCodeResponse = {
  code: string;
  expiresAt: string;
};

export type ApprovalPolicy = {
  workspaceId: string;
  mode: 'default' | 'full_accept';
  levels: Array<Record<string, unknown>>;
};

export type AgentToolCall = {
  id: string;
  kind: ChatToolKind;
  title: string;
  target: string;
  arguments?: Record<string, unknown>;
  approvalExecutionId?: string;
  riskTier: RiskTier;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'waiting_for_approval' | 'waiting_for_user';
};

export type AskUserAnswer = {
  id: string;
  selectedOptionId?: string;
  text: string;
  isOther: boolean;
};

export type AgentTodoItem = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'blocked';
};

export type BackgroundTerminal = {
  id: string;
  title: string;
  status: 'idle' | 'running' | 'waiting_for_approval' | 'failed';
  lines: string[];
};

export type AgentSubagent = {
  id: string;
  name: string;
  status: RunStatus;
  responsibility: string;
};

export type OpenAiToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage =
  | {
      role: 'system' | 'user';
      content: string;
    }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    }
  | {
      role: 'tool';
      tool_call_id: string;
      name: string;
      content: string;
    };

export type ToolState = {
  status: 'queued' | 'waiting' | 'running' | 'completed' | 'failed';
  executionId?: string;
  riskTier?: RiskTier | string;
  expiresAt?: string;
  error?: {
    code?: string;
    message: string;
  };
};

export type ChatSession = {
  id: string;
  title: string;
  workspaceName: string;
  agentId: string;
  agentName: string;
  branchName: string;
  skillName: string;
  clientName: string;
  runId: string;
  runStatus: RunStatus;
  todos: AgentTodoItem[];
  terminals: BackgroundTerminal[];
  subagents: AgentSubagent[];
  toolStates: Record<string, ToolState>;
  contextBudget?: {
    messageCount: number;
    estimatedTokens: number;
    maxTokens: number;
    thresholdTokens: number;
    usageRatio: number;
    lastUsage?: Record<string, unknown>;
  };
  availableModels?: Array<{
    name: string;
    model: string;
    protocol: string;
    contextWindow?: number;
  }>;
  activeModelName?: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type DashboardData = {
  workspace: Workspace;
  agents: AgentProfile[];
  activeRuns: AgentRunSummary[];
  pendingApprovals: ApprovalRequest[];
  branches: AgentBranch[];
  skillDrafts: SkillDraft[];
  daemons: ClientDaemon[];
  chatSessions: ChatSession[];
  recentEvents: ExecutionEvent[];
};
