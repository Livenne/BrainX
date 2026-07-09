import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowUp,
  Bot,
  CheckCircle2,
  ChevronDown,
  Copy,
  Clock,
  FileText,
  FolderOpen,
  GitCompare,
  HelpCircle,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Plus,
  Search,
  Square,
  Terminal,
  X
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageSkeleton, PendingButton } from '../components/LoadingStates';
import { useTopBarSlot } from '../components/AppShell';
import type {
  AgentTodoItem,
  AskUserAnswer,
  BackgroundTerminal,
  ChatAttachmentInput,
  ClientDaemon,
  ChatMessage,
  ChatSession,
  ChatTimelineNotice,
  OpenAiToolCall,
  RunStatus,
  SkillInventory,
  SkillSummary,
  ToolState
} from '../domain/types';
import {
  answerAskUser,
  approveToolRequest,
  cancelChatSession as cancelRealChatSession,
  createChatSession as createRealChatSession,
  deleteChatSession as deleteRealChatSession,
  forkChatSession as forkRealChatSession,
  getChatSessionById as getRealChatSessionById,
  getChatSessions as getRealChatSessions,
  getClientDaemons as getRealClientDaemons,
  getSkillInventory as getRealSkillInventory,
  rejectToolRequest,
  renameChatSession as renameRealChatSession,
  sendChatCommand as sendRealChatCommand,
  sendSessionChatCommand as sendRealSessionChatCommand,
  sendSessionChatMessage,
  subscribeChatEvents
} from '../services/brainxApi';
import {
  cancelChatSession as cancelMockChatSession,
  createChatSession as createMockChatSession,
  deleteChatSession as deleteMockChatSession,
  forkChatSession as forkMockChatSession,
  getChatSessions as getMockChatSessions,
  getClientDaemons as getMockClientDaemons,
  getSkillInventory as getMockSkillInventory,
  renameChatSession as renameMockChatSession,
  sendChatCommand as sendMockChatCommand,
  sendChatMessage as sendMockChatMessage
} from '../services/mockApi';
import { useAuth } from '../state/auth';
import './pages.css';
import './ChatPreviewPage.css';
import 'katex/dist/katex.min.css';

const useMockChatApi = import.meta.env.MODE === 'test';
const activeRunStatuses = new Set<RunStatus>([
  'queued',
  'planning',
  'waiting_for_client',
  'running',
  'waiting_for_approval',
  'waiting_for_user',
  'summarizing'
]);

type SkillInventoryOptions = {
  clientDaemonId?: string;
  currentWorkspace?: string;
};

const maxAttachmentsPerMessage = 15;
const maxImageAttachmentBytes = 5 * 1024 * 1024;
const maxTextAttachmentBytes = 512 * 1024;
const maxTotalAttachmentBytes = 20 * 1024 * 1024;
const assistantTypewriterChunkSize = 10;
const thinkingTypewriterChunkSize = 12;
const mockDefaultClient: ClientDaemon = {
  id: 'cd_local',
  name: 'brainx-client-local',
  deviceName: 'Livenne Workstation',
  os: 'Ubuntu 24.04 / WSL',
  status: 'online',
  version: '0.1.0',
  activeTasks: 0,
  lastHeartbeatSeconds: 0,
  note: 'Local test client',
  registeredAt: '2026-07-04T09:24:00Z',
  workspacePath: '/home/Livenne/code/brainx',
  capabilities: ['model.invoke', 'agent.loop']
};

type RenderMode = 'info' | 'file' | 'diff' | 'generic';

type ToolRenderSpec = {
  nickname: string;
  icon: LucideIcon;
  renderMode: RenderMode;
  buildSummary: (args: Record<string, unknown>, result?: Record<string, unknown> | null) => string;
};

type ToolTimelineItem = {
  type: 'tool';
  call: OpenAiToolCall;
  funcName: string;
  args: Record<string, unknown>;
  resultMessage?: Extract<ChatMessage, { role: 'tool' }>;
  result: Record<string, unknown> | null;
  state?: ToolState;
  spec: ToolRenderSpec;
};

type TextTimelineItem = {
  type: 'text';
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  thinkingActive?: boolean;
  attachments?: ChatAttachmentInput[];
  status?: 'failed' | 'sent';
  errorMessage?: string;
};

type NoticeTimelineItem = {
  type: 'notice';
  notice: ChatTimelineNotice;
};

type TimelineItem = TextTimelineItem | ToolTimelineItem | NoticeTimelineItem;
type ComposerPopover = 'slash' | 'attachments' | 'model' | null;
type ComposerDialog = 'rename' | 'delete' | 'workspace' | null;
type ComposerActionVisibility = 'plus' | 'slash' | 'both';
type ComposerActionSessionPolicy = 'none' | 'requires-session';
type ComposerAction = {
  id: string;
  command?: string;
  label: string;
  description: string;
  aliases: string[];
  icon: LucideIcon;
  visibility: ComposerActionVisibility;
  sessionPolicy: ComposerActionSessionPolicy;
};
type DiffLineKind = 'add' | 'remove' | 'hunk' | 'meta' | 'context';
type ToastNotice = {
  id: string;
  message: string;
  tone: 'error' | 'info';
};
type DisplayToolStatus = ToolState['status'];

const markdownRemarkPlugins = [remarkGfm, remarkBreaks, remarkMath];
const markdownRehypePlugins = [rehypeKatex];

const fallbackSpec: ToolRenderSpec = {
  nickname: 'Tool',
  icon: Terminal,
  renderMode: 'generic',
  buildSummary: (args) => firstMeaningfulArg(args) ?? 'details'
};

const toolRenderRegistry: Record<string, ToolRenderSpec> = {
  get_env: {
    nickname: 'Environment',
    icon: Terminal,
    renderMode: 'info',
    buildSummary: () => ''
  },
  get_environment: {
    nickname: 'Environment',
    icon: Terminal,
    renderMode: 'info',
    buildSummary: () => ''
  },
  read_files: {
    nickname: 'Read',
    icon: FileText,
    renderMode: 'file',
    buildSummary: (args) => {
      const files = Array.isArray(args.files) ? args.files : [];
      return `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
    }
  },
  read_file: {
    nickname: 'Read',
    icon: FileText,
    renderMode: 'file',
    buildSummary: (args, result) => firstString(args.path) ?? firstString(result?.path) ?? 'file'
  },
  edit_file: {
    nickname: 'Edit',
    icon: GitCompare,
    renderMode: 'diff',
    buildSummary: (args, result) => firstString(args.path) ?? firstString(result?.path) ?? 'file'
  },
  search_workspace: {
    nickname: 'Explore',
    icon: Search,
    renderMode: 'info',
    buildSummary: (args) => firstString(args.query) ?? 'workspace'
  },
  search_content: {
    nickname: 'Search',
    icon: Search,
    renderMode: 'info',
    buildSummary: (args) => firstString(args.pattern) ?? 'content'
  },
  list_directory: {
    nickname: 'List',
    icon: FileText,
    renderMode: 'info',
    buildSummary: (args) => firstString(args.path) ?? '.'
  },
  apply_patch: {
    nickname: 'Edit',
    icon: GitCompare,
    renderMode: 'diff',
    buildSummary: (args, result) => firstChangedFile(result) ?? firstPatchPath(firstString(args.patch) ?? '') ?? 'patch'
  },
  write_file: {
    nickname: 'Write',
    icon: PenLine,
    renderMode: 'diff',
    buildSummary: (args, result) => firstString(args.path) ?? firstString(result?.path) ?? 'file'
  },
  run_command: {
    nickname: 'Run',
    icon: Terminal,
    renderMode: 'info',
    buildSummary: (args) => firstString(args.command) ?? 'command'
  },
  web_search: {
    nickname: 'Web Search',
    icon: Search,
    renderMode: 'info',
    buildSummary: (args) => firstString(args.query) ?? 'query'
  },
  ask_user: {
    nickname: 'Question',
    icon: HelpCircle,
    renderMode: 'generic',
    buildSummary: (args) => firstQuestion(args) ?? 'user input'
  },
  todo_update: {
    nickname: 'Todo',
    icon: CheckCircle2,
    renderMode: 'generic',
    buildSummary: (args) => {
      const items = Array.isArray(args.items) ? args.items : [];
      return `${items.length} ${items.length === 1 ? 'task' : 'tasks'}`;
    }
  },
  todo_create: {
    nickname: 'Todo',
    icon: CheckCircle2,
    renderMode: 'generic',
    buildSummary: (args) => {
      const tasks = Array.isArray(args.tasks) ? args.tasks : [];
      return `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
    }
  },
  todo_list: {
    nickname: 'Todo',
    icon: CheckCircle2,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.filter) ?? 'all'
  },
  terminal_spawn: {
    nickname: 'Terminal Run',
    icon: Terminal,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.command) ?? firstString(args.terminal_id) ?? 'terminal'
  },
  terminal_output: {
    nickname: 'Terminal Read',
    icon: Terminal,
    renderMode: 'info',
    buildSummary: (args) => firstString(args.terminal_id) ?? 'terminal'
  },
  terminal_input: {
    nickname: 'Terminal Input',
    icon: Terminal,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.terminal_id) ?? 'terminal'
  },
  terminal_kill: {
    nickname: 'Terminal Stop',
    icon: Square,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.terminal_id) ?? 'terminal'
  },
  terminal_list: {
    nickname: 'Terminal List',
    icon: Terminal,
    renderMode: 'generic',
    buildSummary: () => 'active terminals'
  },
  background_start: {
    nickname: 'Terminal Run',
    icon: Terminal,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.command) ?? firstString(args.name) ?? 'background task'
  },
  background_read: {
    nickname: 'Terminal Read',
    icon: Terminal,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.taskId) ?? 'background task'
  },
  background_stop: {
    nickname: 'Terminal Stop',
    icon: Square,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.taskId) ?? 'background task'
  },
  subagent_start: {
    nickname: 'Agent Create',
    icon: Bot,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.name) ?? firstString(args.task) ?? 'subagent'
  },
  subagent_read: {
    nickname: 'Agent Look',
    icon: Bot,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.subagentId) ?? 'subagent'
  },
  subagent_stop: {
    nickname: 'Agent Stop',
    icon: Square,
    renderMode: 'generic',
    buildSummary: (args) => firstString(args.subagentId) ?? 'subagent'
  }
};

async function loadChatSessions(workspaceId: string, clientDaemonId?: string): Promise<ChatSession[]> {
  if (useMockChatApi) {
    return getMockChatSessions(workspaceId);
  }
  return getRealChatSessions(workspaceId, clientDaemonId);
}

async function loadSkillInventory(workspaceId: string, options?: SkillInventoryOptions): Promise<SkillInventory> {
  if (useMockChatApi) {
    return getMockSkillInventory(workspaceId, options);
  }
  return getRealSkillInventory(workspaceId, options);
}

async function loadClientDaemons(token?: string | null): Promise<ClientDaemon[]> {
  if (useMockChatApi) {
    return getMockClientDaemons();
  }
  if (!token) {
    return [];
  }
  return getRealClientDaemons(token);
}

async function createChatSessionShell(workspaceId: string, clientDaemonId?: string): Promise<ChatSession> {
  if (useMockChatApi) {
    return createMockChatSession(workspaceId);
  }
  return createRealChatSession(workspaceId, undefined, clientDaemonId);
}

async function submitChatMessage(
  workspaceId: string,
  sessionId: string,
  content: string,
  attachments: ChatAttachmentInput[]
): Promise<ChatSession> {
  if (useMockChatApi) {
    return sendMockChatMessage(sessionId, content, attachments);
  }
  return sendSessionChatMessage(workspaceId, sessionId, content, attachments);
}

async function submitChatCommand(
  workspaceId: string,
  command: string,
  args: Record<string, unknown>,
  sessionId?: string
): Promise<ChatSession> {
  if (useMockChatApi) {
    return sendMockChatCommand(workspaceId, command, args, sessionId);
  }
  if (sessionId) {
    return sendRealSessionChatCommand(workspaceId, sessionId, command, args);
  }
  return sendRealChatCommand(workspaceId, command, args);
}

async function renameChatSessionShell(workspaceId: string, sessionId: string, title: string): Promise<ChatSession> {
  if (useMockChatApi) {
    return renameMockChatSession(workspaceId, sessionId, title);
  }
  return renameRealChatSession(workspaceId, sessionId, title);
}

async function forkChatSessionShell(workspaceId: string, sessionId: string): Promise<ChatSession> {
  if (useMockChatApi) {
    return forkMockChatSession(workspaceId, sessionId);
  }
  return forkRealChatSession(workspaceId, sessionId);
}

async function deleteChatSessionShell(workspaceId: string, sessionId: string): Promise<void> {
  if (useMockChatApi) {
    return deleteMockChatSession(workspaceId, sessionId);
  }
  return deleteRealChatSession(workspaceId, sessionId);
}

async function cancelChatRun(workspaceId: string, sessionId: string): Promise<ChatSession> {
  if (useMockChatApi) {
    return cancelMockChatSession(workspaceId, sessionId);
  }
  return cancelRealChatSession(workspaceId, sessionId);
}

const composerActions: ComposerAction[] = [
  {
    id: 'attach',
    label: '添加照片和文件',
    description: '从电脑上传',
    aliases: ['attach', 'attachment', 'file', 'upload', '附件', '上传', '添加文件', '添加照片'],
    icon: Paperclip,
    visibility: 'plus',
    sessionPolicy: 'none'
  },
  {
    id: 'new',
    command: 'new',
    label: '新建会话',
    description: '打开新的空白对话',
    aliases: ['new', 'new chat', '新建', '新聊天', '开始新对话'],
    icon: Plus,
    visibility: 'both',
    sessionPolicy: 'none'
  },
  {
    id: 'model',
    command: 'model',
    label: '切换模型',
    description: '为当前会话选择模型',
    aliases: ['model', '模型', '切换', '切换模型'],
    icon: Bot,
    visibility: 'slash',
    sessionPolicy: 'requires-session'
  },
  {
    id: 'session',
    command: 'session',
    label: '切换会话',
    description: '从历史会话中切换',
    aliases: ['session', 'sessions', '会话', '切换会话'],
    icon: Clock,
    visibility: 'slash',
    sessionPolicy: 'none'
  },
  {
    id: 'fork',
    command: 'fork',
    label: '克隆会话',
    description: '从当前会话创建分支',
    aliases: ['fork', 'clone', 'branch', '克隆', '分支', '克隆会话'],
    icon: GitCompare,
    visibility: 'slash',
    sessionPolicy: 'requires-session'
  },
  {
    id: 'init',
    command: 'init',
    label: '初始化项目',
    description: '建立当前项目上下文',
    aliases: ['init', 'initialize', '初始化', '初始化项目'],
    icon: CheckCircle2,
    visibility: 'slash',
    sessionPolicy: 'requires-session'
  },
  {
    id: 'workspace',
    command: 'workspace',
    label: '切换工作目录',
    description: '修改当前会话的工作目录',
    aliases: ['workspace', 'workdir', 'cwd', '目录', '工作目录', '切换工作目录'],
    icon: FolderOpen,
    visibility: 'slash',
    sessionPolicy: 'requires-session'
  },
  {
    id: 'skill-reflection',
    command: 'skill-reflection',
    label: '学习总结',
    description: '总结可复用流程并提交 skill 草案',
    aliases: ['learn', 'skill', '学习', '总结', '学习总结', '技能'],
    icon: Search,
    visibility: 'slash',
    sessionPolicy: 'requires-session'
  },
  {
    id: 'compact',
    command: 'compact',
    label: '压缩上下文',
    description: '压缩较早的会话上下文',
    aliases: ['compact', 'compress', '压缩', '上下文压缩'],
    icon: ChevronDown,
    visibility: 'slash',
    sessionPolicy: 'requires-session'
  },
  {
    id: 'clear',
    command: 'clear',
    label: '清空上下文',
    description: '清除当前会话上下文',
    aliases: ['clear', '清空', '清理', '清空上下文'],
    icon: X,
    visibility: 'slash',
    sessionPolicy: 'requires-session'
  },
  {
    id: 'rename',
    command: 'rename',
    label: '重命名会话',
    description: '修改当前会话名称',
    aliases: ['rename', '重命名', '改名', '重命名会话'],
    icon: PenLine,
    visibility: 'slash',
    sessionPolicy: 'requires-session'
  },
  {
    id: 'delete',
    command: 'delete',
    label: '删除会话',
    description: '删除当前会话及分支',
    aliases: ['delete', 'remove', '删除', '删除会话'],
    icon: Square,
    visibility: 'slash',
    sessionPolicy: 'requires-session'
  }
];

const slashActions = composerActions.filter((action) => action.visibility === 'slash' || action.visibility === 'both');
const plusActions = composerActions.filter((action) => action.visibility === 'plus' || action.visibility === 'both');
const initProjectPrompt =
  `Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Before writing, check whether AGENTS.md already exists in the current working directory. If it does, do not overwrite or modify it.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines

- Summarize commit message conventions found in the project’s Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.`;
const skillReflectionPrompt =
  `Review the current conversation, tool results, errors, decisions, and reusable workflow patterns.

Decide whether anything should become a durable brainx skill. Only create or update a skill if it would be useful beyond this one task.

Rules:
- Prefer project skills under the current workspace .agents/skills when the workflow is project-specific.
- Prefer global skills under ~/.agents/skills only for broadly reusable personal workflows.
- Before updating an existing skill, read the existing SKILL.md with read_files.
- Use create_skill for new skills and renovation_skill for complete replacement updates.
- The skill tools submit proposals only; do not write SKILL.md directly.
- If no skill is worth proposing, explain that briefly and do not call skill tools.`;
const emptyChatTopics = [
  { label: '初始化项目', prompt: initProjectPrompt },
  { label: '查看当前目录', prompt: '查看当前目录' },
  { label: '运行测试', prompt: '运行测试' },
  { label: '总结当前项目', prompt: '总结当前项目' }
];

function parseSlashCommand(input: string, session?: ChatSession): { action: ComposerAction; args: Record<string, unknown> } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [rawCommand, ...rest] = trimmed.slice(1).split(/\s+/);
  const action = resolveComposerAction(rawCommand, slashActions);
  if (!action) return null;
  const argumentText = rest.join(' ').trim();
  return {
    action,
    args: argumentText ? { input: argumentText, activeSessionId: session?.id } : { activeSessionId: session?.id }
  };
}

function normalizeActionQuery(value: string) {
  return value.trim().replace(/^\/+/, '').toLowerCase();
}

function actionSearchText(action: ComposerAction) {
  return [action.command, action.label, action.description, ...action.aliases]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function actionMatchesQuery(action: ComposerAction, query: string) {
  const normalized = normalizeActionQuery(query);
  return !normalized || actionSearchText(action).includes(normalized);
}

function resolveComposerAction(query: string, actions: ComposerAction[]) {
  const normalized = normalizeActionQuery(query);
  if (!normalized) return actions[0] ?? null;
  return actions.find((action) => {
    const exactValues = [action.command, action.label, ...action.aliases].filter(Boolean).map((value) => String(value).toLowerCase());
    return exactValues.includes(normalized);
  }) ?? actions.find((action) => actionMatchesQuery(action, normalized)) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJsonObject(content: string | null | undefined): Record<string, unknown> | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseToolArguments(call: OpenAiToolCall): Record<string, unknown> {
  if (call.function) {
    return parseJsonObject(call.function.arguments) ?? {};
  }
  if (isRecord(call.arguments)) {
    return call.arguments;
  }
  if (typeof call.arguments === 'string') {
    return parseJsonObject(call.arguments) ?? {};
  }
  return {};
}

function toolCallName(call: OpenAiToolCall) {
  return call.function?.name ?? call.name ?? '';
}

function firstString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function primaryToolPayload(result?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!result) return result ?? null;
  return isRecord(result.result) ? result.result : result;
}

function toolErrorText(result?: Record<string, unknown> | null) {
  if (!result) return null;
  const direct = firstString(result.error);
  if (direct) return direct;
  if (isRecord(result.error)) {
    return firstString(result.error.message) ?? firstString(result.error.detail);
  }
  const payload = primaryToolPayload(result);
  if (payload && payload !== result) {
    return toolErrorText(payload);
  }
  return null;
}

function normalizeToolStatus(status: unknown): DisplayToolStatus | null {
  const value = typeof status === 'string' ? status : '';
  if (value === 'waiting_for_user' || value === 'waiting_for_approval') return 'waiting';
  if (value === 'queued' || value === 'waiting' || value === 'running' || value === 'completed' || value === 'failed') return value;
  return null;
}

function isToolWaiting(status: DisplayToolStatus) {
  return status === 'waiting' || status === 'waiting_for_user' || status === 'waiting_for_approval' || status === 'queued';
}

function statusFromToolResult(result?: Record<string, unknown> | null): DisplayToolStatus | null {
  if (!result) return null;
  if (toolErrorText(result) || result.ok === false) return 'failed';
  const payload = primaryToolPayload(result);
  const status = normalizeToolStatus(result.status) ?? normalizeToolStatus(payload?.status);
  if (status) return status;
  return null;
}

function firstMeaningfulArg(args: Record<string, unknown>) {
  for (const value of Object.values(args)) {
    const text = firstString(value);
    if (text) return text;
  }
  return null;
}

function firstQuestion(args: Record<string, unknown>) {
  const direct = firstString(args.question);
  if (direct) return direct;
  const questions = Array.isArray(args.questions) ? args.questions : [];
  const first = questions.find(isRecord);
  return firstString(first?.question) ?? null;
}

function askUserPayload(item: ToolTimelineItem) {
  const result = isRecord(item.result?.result) ? item.result.result : item.result ?? {};
  const question = firstQuestion(item.args) ?? firstQuestion(result) ?? firstString(result.question) ?? 'Question';
  const argumentOptions = stringArray(item.args.options);
  const resultOptions = stringArray(result.options);
  const answers = Array.isArray(result.answers) ? result.answers : [];
  const firstAnswer = answers.find(isRecord);
  return {
    question,
    options: argumentOptions.length ? argumentOptions : resultOptions,
    contextNote: firstString(item.args.context_note) ?? firstString(item.args.contextNote) ?? firstString(result.context_note) ?? firstString(result.contextNote),
    answerText: firstString(firstAnswer?.text) ?? firstString(result.text)
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];
}

function firstChangedFile(result?: Record<string, unknown> | null) {
  const changedFiles = Array.isArray(result?.changedFiles) ? result?.changedFiles : [];
  return firstString(changedFiles[0]);
}

function firstPatchPath(patch: string) {
  return patch.match(/\+\+\+ b\/([^\n]+)/)?.[1] ?? patch.match(/\*\*\* Update File: ([^\n]+)/)?.[1] ?? null;
}

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('***') || line.startsWith('diff --git') || line.startsWith('index ')) {
    return 'meta';
  }
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
}

export function takeTypewriterSlice(buffer: string, maxChars: number) {
  const size = Math.max(1, maxChars);
  return {
    visible: buffer.slice(0, size),
    rest: buffer.slice(size)
  };
}

export function sanitizeChatError(message: string) {
  let cleaned = message
    .replace(/^brainx API request failed:\s*/i, '')
    .replace(/^model\.invoke failed:\s*/i, '')
    .replace(/^model provider returned\s*/i, '')
    .trim();
  const statusMatch = cleaned.match(/HTTP\s+(\d{3})\s*:\s*(\{.*\})/i);
  if (statusMatch) {
    try {
      const payload = JSON.parse(statusMatch[2]) as { title?: string; status?: number };
      return `HTTP ${statusMatch[1]}${payload.title ? `: ${payload.title}` : ''}`;
    } catch {
      return `HTTP ${statusMatch[1]}`;
    }
  }
  return cleaned || message;
}

function isModelFailureText(content: string) {
  return /^model\.invoke failed:/i.test(content.trim()) || /^model provider returned HTTP/i.test(content.trim());
}

function messageContentText(content: ChatMessage['content']) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n');
}

function fileKind(file: File): ChatAttachmentInput['kind'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('text/') || /\.(md|txt|json|ts|tsx|js|jsx|css|html|xml|yaml|yml)$/i.test(file.name)) return 'text';
  return 'file';
}

export function isUsableChatClient(client: Pick<ClientDaemon, 'status'>) {
  return client.status === 'active' || client.status === 'online';
}

function attachmentValidationError(file: File): string | null {
  const kind = fileKind(file);
  if (file.type.startsWith('video/') || file.type.startsWith('audio/') || kind === 'file') {
    return `${file.name}: video, audio, and binary attachments are not supported yet.`;
  }
  if (kind === 'image' && file.size > maxImageAttachmentBytes) {
    return `${file.name}: image attachments must be 5 MB or smaller.`;
  }
  if (kind === 'text' && file.size > maxTextAttachmentBytes) {
    return `${file.name}: text attachments must be 512 KB or smaller.`;
  }
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function fileToAttachmentInput(file: File): Promise<ChatAttachmentInput> {
  const kind = fileKind(file);
  const attachment: ChatAttachmentInput = {
    id: `att_${file.name}_${file.size}_${file.lastModified}`,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind
  };
  if (kind === 'image') {
    attachment.dataUrl = await readFileAsDataUrl(file);
  } else if (kind === 'text') {
    attachment.content = await file.text();
  }
  return attachment;
}

async function filesToAttachmentInputs(files: File[]) {
  return Promise.all(files.slice(0, 15).map(fileToAttachmentInput));
}

function statusIcon(status: ToolState['status']) {
  if (status === 'completed') return CheckCircle2;
  if (status === 'running') return LoaderCircle;
  if (status === 'failed') return AlertCircle;
  return Clock;
}

function todoStatusIcon(status: AgentTodoItem['status']) {
  if (status === 'completed') return CheckCircle2;
  if (status === 'in_progress' || status === 'running') return LoaderCircle;
  if (status === 'blocked') return AlertCircle;
  if (status === 'cancelled') return Square;
  return Clock;
}

function toolStatus(item: ToolTimelineItem): ToolState['status'] {
  const resultStatus = statusFromToolResult(item.result);
  if (resultStatus === 'waiting' || resultStatus === 'failed') {
    return resultStatus;
  }
  const stateStatus = normalizeToolStatus(item.state?.status);
  return stateStatus ?? resultStatus ?? (item.resultMessage ? 'completed' : 'running');
}

function resultMessagesByCallId(messages: ChatMessage[]) {
  const results = new Map<string, Extract<ChatMessage, { role: 'tool' }>>();
  for (const message of messages) {
    if (message.role === 'tool') {
      const callId = message.tool_call_id ?? message.toolCallId;
      if (callId) {
        results.set(callId, message);
      }
    }
  }
  return results;
}

function toolCallsById(messages: ChatMessage[]) {
  const calls = new Map<string, OpenAiToolCall>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const call of message.tool_calls ?? message.toolCalls ?? []) {
      if (call.id) calls.set(call.id, call);
    }
  }
  return calls;
}

function toolPayloadFromMessage(message: Extract<ChatMessage, { role: 'tool' }>) {
  return primaryToolPayload(parseJsonObject(message.content)) ?? {};
}

function normalizeTodoStatus(status: unknown): AgentTodoItem['status'] {
  const value = firstString(status) ?? 'pending';
  if (['pending', 'running', 'in_progress', 'completed', 'blocked', 'cancelled'].includes(value)) {
    return value as AgentTodoItem['status'];
  }
  return 'pending';
}

function todoItemFromRecord(record: Record<string, unknown>): AgentTodoItem | null {
  const id = firstString(record.id);
  const label = firstString(record.label) ?? firstString(record.title);
  if (!id || !label) return null;
  return {
    id,
    label,
    status: normalizeTodoStatus(record.status)
  };
}

function deriveTodoState(session: ChatSession): AgentTodoItem[] {
  const todos = new Map(session.todos.map((todo) => [todo.id, todo]));

  for (const message of session.messages) {
    if (message.role !== 'tool' || !message.name.startsWith('todo_')) continue;
    const payload = toolPayloadFromMessage(message);
    if (toolErrorText(payload)) continue;

    if ((message.name === 'todo_create' || message.name === 'todo_list') && Array.isArray(payload.tasks)) {
      const nextTodos = payload.tasks.map((task) => (isRecord(task) ? todoItemFromRecord(task) : null)).filter(Boolean) as AgentTodoItem[];
      todos.clear();
      nextTodos.forEach((todo) => todos.set(todo.id, todo));
      continue;
    }

    if (message.name === 'todo_update' && isRecord(payload.task)) {
      const todo = todoItemFromRecord(payload.task);
      if (todo) todos.set(todo.id, todo);
    }
  }

  return Array.from(todos.values());
}

function normalizeTerminalStatus(status: unknown): BackgroundTerminal['status'] {
  const value = firstString(status) ?? 'idle';
  if (['idle', 'running', 'waiting_for_approval', 'failed', 'stopped', 'completed'].includes(value)) {
    return value as BackgroundTerminal['status'];
  }
  if (value === 'exited') return 'completed';
  return 'idle';
}

function terminalFromRecord(record: Record<string, unknown>, args: Record<string, unknown> = {}): BackgroundTerminal | null {
  const id = firstString(record.terminalId) ?? firstString(record.terminal_id) ?? firstString(args.terminal_id);
  if (!id) return null;
  const output = firstString(record.output);
  return {
    id,
    title: id,
    status: normalizeTerminalStatus(record.status),
    lines: output ? output.split('\n') : []
  };
}

function mergeTerminal(existing: BackgroundTerminal | undefined, next: BackgroundTerminal) {
  return {
    ...next,
    lines: next.lines.length ? next.lines : existing?.lines ?? []
  };
}

function deriveTerminalState(session: ChatSession): BackgroundTerminal[] {
  const terminals = new Map(
    session.terminals
      .filter((terminal) => terminal.status !== 'stopped')
      .map((terminal) => [terminal.id, terminal])
  );
  const calls = toolCallsById(session.messages);

  for (const message of session.messages) {
    if (message.role !== 'tool' || !message.name.startsWith('terminal_')) continue;
    const payload = toolPayloadFromMessage(message);
    if (toolErrorText(payload)) continue;
    const callId = message.tool_call_id ?? message.toolCallId ?? '';
    const args = callId ? parseToolArguments(calls.get(callId) ?? { id: callId }) : {};

    if (message.name === 'terminal_list' && Array.isArray(payload.terminals)) {
      for (const terminalRecord of payload.terminals) {
        if (!isRecord(terminalRecord)) continue;
        const terminal = terminalFromRecord(terminalRecord);
        if (terminal?.status === 'stopped') {
          terminals.delete(terminal.id);
          continue;
        }
        if (terminal) terminals.set(terminal.id, mergeTerminal(terminals.get(terminal.id), terminal));
      }
      continue;
    }

    const terminal = terminalFromRecord(payload, args);
    if (terminal?.status === 'stopped') {
      terminals.delete(terminal.id);
      continue;
    }
    if (terminal) {
      terminals.set(terminal.id, mergeTerminal(terminals.get(terminal.id), terminal));
    }
  }

  return Array.from(terminals.values());
}

function buildTimeline(messages: ChatMessage[], toolStates: Record<string, ToolState>, notices: ChatTimelineNotice[] = []): TimelineItem[] {
  const results = resultMessagesByCallId(messages);
  const timeline: TimelineItem[] = [];
  const noticesByMessageIndex = new Map<number, ChatTimelineNotice[]>();
  for (const notice of notices) {
    const rawIndex = Number(notice.afterMessageIndex ?? notice.messageIndex ?? 0);
    const index = Number.isFinite(rawIndex) ? Math.max(0, rawIndex) : messages.length;
    noticesByMessageIndex.set(index, [...(noticesByMessageIndex.get(index) ?? []), notice]);
  }
  const appendNoticesAfter = (index: number) => {
    for (const notice of noticesByMessageIndex.get(index) ?? []) {
      timeline.push({ type: 'notice', notice });
    }
  };

  let messageIndex = 0;
  appendNoticesAfter(0);
  for (const message of messages) {
    messageIndex += 1;
    if (message.role === 'system' || message.role === 'tool') {
      appendNoticesAfter(messageIndex);
      continue;
    }
    if (message.role === 'user') {
      timeline.push({
        type: 'text',
        role: 'user',
        content: messageContentText(message.content),
        attachments: message.attachments,
        status: message.status,
        errorMessage: message.error?.message ? sanitizeChatError(message.error.message) : undefined
      });
      appendNoticesAfter(messageIndex);
      continue;
    }
    if (message.role === 'assistant') {
      const content = message.content ?? '';
      if (content.trim() && isModelFailureText(content)) {
        const previousUser = [...timeline].reverse().find((item): item is TextTimelineItem => item.type === 'text' && item.role === 'user');
        if (previousUser) {
          previousUser.status = 'failed';
          previousUser.errorMessage = sanitizeChatError(content);
        }
        appendNoticesAfter(messageIndex);
        continue;
      }
      if (content.trim() || message.thinking?.trim()) {
        timeline.push({ type: 'text', role: 'assistant', content, thinking: message.thinking, thinkingActive: false });
      }
      for (const call of message.tool_calls ?? message.toolCalls ?? []) {
        const funcName = toolCallName(call);
        const resultMessage = results.get(call.id);
        timeline.push({
          type: 'tool',
          call,
          funcName,
          args: parseToolArguments(call),
          resultMessage,
          result: parseJsonObject(resultMessage?.content),
          state: toolStates[call.id],
          spec: toolRenderRegistry[funcName] ?? { ...fallbackSpec, nickname: funcName || fallbackSpec.nickname }
        });
      }
      appendNoticesAfter(messageIndex);
    }
  }

  const overflowIndexes = Array.from(noticesByMessageIndex.keys())
    .filter((index) => index > messageIndex)
    .sort((left, right) => left - right);
  for (const index of overflowIndexes) {
    appendNoticesAfter(index);
  }

  return timeline;
}

function TimelineNotice({ notice }: { notice: ChatTimelineNotice }) {
  return (
    <article className="timeline-notice-row" data-kind={notice.kind}>
      <span className="timeline-notice-message">{notice.message}</span>
    </article>
  );
}

function ToolCallItem({
  item,
  pendingInteraction,
  onApprove,
  onReject,
  onAnswerAskUser
}: {
  item: ToolTimelineItem;
  pendingInteraction: string | null;
  onApprove: (item: ToolTimelineItem) => void;
  onReject: (item: ToolTimelineItem) => void;
  onAnswerAskUser: (item: ToolTimelineItem, answers: AskUserAnswer[]) => void;
}) {
  const status = toolStatus(item);
  const [expanded, setExpanded] = useState(item.funcName === 'ask_user' && isToolWaiting(status));
  const StatusIcon = statusIcon(status);
  const HeaderIcon = status === 'completed' ? item.spec.icon : StatusIcon;
  const summary = item.spec.buildSummary(item.args, primaryToolPayload(item.result));
  const triggerLabel = [item.spec.nickname, summary].filter(Boolean).join(' ');
  const executionId = item.state?.executionId;
  const isPending = executionId ? pendingInteraction?.endsWith(executionId) : false;
  const isAskUserPending = pendingInteraction === `ask:${item.call.id}`;

  return (
    <article className="timeline-message assistant-message">
      <div className="tool-disclosure" data-status={status}>
        <button
          aria-expanded={expanded}
          aria-label={triggerLabel}
          className="tool-disclosure-trigger"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="tool-icon-slot" aria-hidden="true" data-status={status} data-tool={item.funcName}>
            <HeaderIcon className={status === 'running' ? 'spinning-status' : undefined} size={16} />
          </span>
          <span className="tool-header-copy">
            <span className="tool-header-action">{item.spec.nickname}</span>
            {summary ? <span className="tool-header-detail">{summary}</span> : null}
          </span>
          <ChevronDown aria-hidden="true" className="tool-disclosure-chevron" size={15} />
        </button>
        {expanded ? (
          <div className="tool-detail-panel" role="region" aria-label={`${item.funcName} details`}>
            <ToolDetails
              item={item}
              pending={isAskUserPending}
              status={status}
              onAnswer={(answers) => onAnswerAskUser(item, answers)}
            />
            {item.funcName !== 'ask_user' && isToolWaiting(status) && executionId ? (
              <div className="tool-action-row">
                <button className="primary-action" disabled={isPending} type="button" onClick={() => onApprove(item)}>
                  {isPending ? 'Approving...' : 'Approve'}
                </button>
                <button className="secondary-action" disabled={isPending} type="button" onClick={() => onReject(item)}>
                  Reject
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ToolDetails({
  item,
  pending,
  status,
  onAnswer
}: {
  item: ToolTimelineItem;
  pending: boolean;
  status: ToolState['status'];
  onAnswer: (answers: AskUserAnswer[]) => void;
}) {
  if (item.funcName === 'ask_user') {
    return <AskUserDetails item={item} pending={pending} status={status} onAnswer={onAnswer} />;
  }
  if (item.spec.renderMode === 'file') {
    return <FileDetails result={item.result} args={item.args} />;
  }
  if (item.spec.renderMode === 'diff') {
    return <DiffDetails result={item.result} args={item.args} />;
  }
  if (item.spec.renderMode === 'info') {
    return <InfoDetails item={item} />;
  }
  return <JsonDetails value={item.result ?? item.args} />;
}

function AskUserDetails({
  item,
  pending,
  status,
  onAnswer
}: {
  item: ToolTimelineItem;
  pending: boolean;
  status: ToolState['status'];
  onAnswer: (answers: AskUserAnswer[]) => void;
}) {
  const [customAnswer, setCustomAnswer] = useState('');
  const payload = askUserPayload(item);
  const canAnswer = isToolWaiting(status);
  const options = payload.options;

  function submitAnswer(answer: AskUserAnswer) {
    if (!canAnswer || pending) return;
    onAnswer([answer]);
  }

  return (
    <div className="ask-user-panel">
      <p className="ask-user-question">{payload.question}</p>
      {payload.contextNote ? <p className="ask-user-note">{payload.contextNote}</p> : null}
      {options.length ? (
        <div className="ask-user-options" role="group" aria-label="Question options">
          {options.map((option) => (
            <button
              className="ask-user-option"
              disabled={!canAnswer || pending}
              key={option}
              type="button"
              onClick={() =>
                submitAnswer({
                  id: 'choice',
                  selectedOptionId: option,
                  text: option,
                  isOther: false
                })
              }
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      {canAnswer ? (
        <form
          className="ask-user-custom"
          onSubmit={(event) => {
            event.preventDefault();
            const text = customAnswer.trim();
            if (!text) return;
            submitAnswer({ id: 'other', text, isOther: true });
            setCustomAnswer('');
          }}
        >
          <input
            aria-label="Other answer"
            disabled={pending}
            placeholder="Other"
            value={customAnswer}
            onChange={(event) => setCustomAnswer(event.target.value)}
          />
          <button className="secondary-action" disabled={pending || !customAnswer.trim()} type="submit">
            {pending ? 'Sending...' : 'Send'}
          </button>
        </form>
      ) : null}
      {!canAnswer && payload.answerText ? <p className="ask-user-note">Answer: {payload.answerText}</p> : null}
    </div>
  );
}

function FileDetails({ result, args }: { result: Record<string, unknown> | null; args: Record<string, unknown> }) {
  const payload = primaryToolPayload(result);
  const directError = toolErrorText(result) ?? toolErrorText(payload);
  if (directError) {
    return <TextOutputBlock text={directError} tone="error" />;
  }
  if (firstString(payload?.content) || firstString(args.content)) {
    const path = firstString(payload?.path) ?? firstString(args.path) ?? 'file';
    const content = firstString(payload?.content) ?? firstString(args.content) ?? '';
    return (
      <section className="file-render-block">
        <div className="file-render-title">{path}</div>
        <pre className="preview-code-lines command-output-lines">
          {content.split('\n').map((line, lineIndex) => (
            <code key={`${path}-${lineIndex}`}>{line}</code>
          ))}
        </pre>
      </section>
    );
  }
  const files = Array.isArray(payload?.files) ? payload.files : Array.isArray(args.files) ? args.files : [];
  return (
    <div className="tool-detail-stack">
      {files.map((file, index) => {
        const record = isRecord(file) ? file : {};
        const path = firstString(record.path) ?? `file-${index + 1}`;
        const content = firstString(record.content) ?? firstString(record.summary) ?? toolErrorText(record) ?? '';
        const tone = record.ok === false || toolErrorText(record) ? 'error' : 'default';
        return (
          <section className="file-render-block" key={`${path}-${index}`}>
            <div className="file-render-title">{path}</div>
            <pre className="preview-code-lines command-output-lines tool-text-output" data-tone={tone}>
              {content.split('\n').map((line, lineIndex) => (
                <code key={`${path}-${lineIndex}`}>{line}</code>
              ))}
            </pre>
          </section>
        );
      })}
    </div>
  );
}

function DiffDetails({ result, args }: { result: Record<string, unknown> | null; args: Record<string, unknown> }) {
  const payload = primaryToolPayload(result);
  const error = toolErrorText(result) ?? toolErrorText(payload);
  if (error) {
    return <TextOutputBlock text={error} tone="error" />;
  }
  const diff = diffText(payload, args);
  return (
    <pre className="preview-code-lines command-output-lines diff-lines" aria-label="File diff">
      {diff.split('\n').map((line, index) => (
        <code data-line-kind={diffLineKind(line)} key={`${index}-${line}`}>
          {line}
        </code>
      ))}
    </pre>
  );
}

function diffText(result: Record<string, unknown> | null, args: Record<string, unknown>) {
  const direct = firstString(result?.diff) ?? firstString(args.patch);
  if (direct) return direct;

  const path = firstString(result?.path) ?? firstString(args.path) ?? 'file';
  const content = firstString(args.content) ?? firstString(result?.content);
  if (content) {
    return ['--- /dev/null', `+++ b/${path}`, '@@', ...content.split('\n').map((line) => `+${line}`)].join('\n');
  }

  return JSON.stringify(result ?? args, null, 2);
}

function InfoDetails({ item }: { item: ToolTimelineItem }) {
  const source = primaryToolPayload(item.result) ?? item.result ?? item.args;
  const error = toolErrorText(item.result) ?? toolErrorText(source);
  if (item.funcName === 'get_env' || item.funcName === 'get_environment') {
    return <EnvironmentDetails value={source} />;
  }
  if (item.funcName === 'run_command') {
    return <CommandOutputDetails value={source} error={error} />;
  }
  if (item.funcName === 'web_search') {
    return <WebSearchDetails value={source} error={error} />;
  }
  if (error) {
    return <TextOutputBlock text={error} tone="error" />;
  }
  const stdout = firstString(source.stdout);
  const stderr = firstString(source.stderr);
  const output = firstString(source.output);
  if (output) {
    return <TextOutputBlock text={output} />;
  }
  if (stdout || stderr) {
    return <TextOutputBlock text={[stdout, stderr].filter(Boolean).join('\n')} />;
  }

  if (Array.isArray(source.matches)) {
    return <ResultList items={source.matches} />;
  }

  if (Array.isArray(source.results)) {
    return <ResultList items={source.results} />;
  }

  if (Array.isArray(source.entries)) {
    return <ResultList items={source.entries} />;
  }

  return <KeyValueDetails value={source} />;
}

function EnvironmentDetails({ value }: { value: Record<string, unknown> }) {
  const dateTime = isRecord(value.dateTime) ? value.dateTime : {};
  const model = isRecord(value.model) ? value.model : {};
  const rows = [
    ['os', firstString(value.os)],
    ['arch', firstString(value.arch)],
    ['workspaceRoot', firstString(value.workspaceRoot)],
    ['defaultShell', firstString(value.defaultShell)],
    ['model', firstString(value.model) ?? firstString(model.name)],
    ['dateTime', firstString(value.dateTime) ?? firstString(dateTime.iso)],
    ['timezone', firstString(value.timezone) ?? firstString(dateTime.timezone)],
    ['utcOffset', firstString(value.utcOffset) ?? firstString(dateTime.utcOffset)]
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (!rows.length) {
    return <JsonDetails value={value} />;
  }
  return <InfoRows rows={rows} />;
}

function CommandOutputDetails({ value, error }: { value: Record<string, unknown>; error?: string | null }) {
  const stdout = firstString(value.stdout);
  const stderr = firstString(value.stderr);
  if (stdout) return <TextOutputBlock text={stdout} />;
  if (stderr) return <TextOutputBlock text={stderr} tone="error" />;
  if (error) return <TextOutputBlock text={error} tone="error" />;
  return <InfoRows rows={[['exitCode', String(value.exitCode ?? value.status ?? 'completed')]]} />;
}

function WebSearchDetails({ value, error }: { value: Record<string, unknown>; error?: string | null }) {
  if (error) return <TextOutputBlock text={error} tone="error" />;
  const answer = firstString(value.answer);
  const results = Array.isArray(value.results) ? value.results : [];
  if (!answer && !results.length) {
    return <KeyValueDetails value={value} />;
  }
  return (
    <div className="tool-detail-stack web-search-detail">
      {answer ? <TextOutputBlock text={answer} /> : null}
      {results.length ? <ResultList items={results} /> : null}
    </div>
  );
}

function TextOutputBlock({ text, tone = 'default' }: { text: string; tone?: 'default' | 'error' }) {
  return (
    <pre className="preview-code-lines command-output-lines tool-text-output" data-tone={tone}>
      {text.split('\n').map((line, index) => (
        <code key={`${index}-${line}`}>{line}</code>
      ))}
    </pre>
  );
}

function ResultList({ items }: { items: unknown[] }) {
  return (
    <div className="tool-detail-stack">
      {items.map((item, index) => {
        const record = isRecord(item) ? item : {};
        const title = firstString(record.title) ?? firstString(record.path) ?? `result-${index + 1}`;
        const detail =
          firstString(record.content) ??
          firstString(record.snippet) ??
          firstString(record.preview) ??
          firstString(record.url) ??
          '';
        const url = firstString(record.url);
        return (
          <div className="tool-result-summary" key={`${title}-${index}`}>
            <strong>{title}</strong>
            {url ? <small>{url}</small> : null}
            {detail ? <span>{detail}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function KeyValueDetails({ value }: { value: Record<string, unknown> }) {
  const rows = Object.entries(flattenInfo(value));
  return <InfoRows rows={rows.map(([key, detail]) => [key, String(detail)])} />;
}

function InfoRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="environment-detail-grid">
      {rows.map(([key, detail]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function flattenInfo(value: Record<string, unknown>) {
  const flattened: Record<string, unknown> = {};
  for (const [key, detail] of Object.entries(value)) {
    if (isRecord(detail)) {
      for (const [childKey, childValue] of Object.entries(detail)) {
        flattened[childKey === 'name' ? key : childKey] = childValue;
      }
    } else {
      flattened[key] = detail;
    }
  }
  return flattened;
}

function JsonDetails({ value }: { value: unknown }) {
  return (
    <pre className="preview-code-lines command-output-lines">
      {JSON.stringify(value, null, 2)
        .split('\n')
        .map((line, index) => (
          <code key={index}>{line}</code>
        ))}
    </pre>
  );
}

function TextMessage({ item, onRetry }: { item: TextTimelineItem; onRetry?: (item: TextTimelineItem) => void }) {
  const [copied, setCopied] = useState(false);
  const thinkingActive = Boolean(item.thinkingActive);

  async function copyMessage() {
    await navigator.clipboard?.writeText(item.content);
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className={`timeline-message ${item.role}-message`} data-status={item.status}>
      <div className="timeline-card markdown-card">
        {item.role === 'assistant' && item.thinking ? (
          <details className="thinking-block">
            <summary>
              <ChevronDown aria-hidden="true" className="thinking-chevron" size={13} />
              {thinkingActive ? <LoaderCircle aria-hidden="true" className="spinning-status" size={13} /> : null}
              Thinking
            </summary>
            <div className="thinking-markdown">
              <ReactMarkdown rehypePlugins={markdownRehypePlugins} remarkPlugins={markdownRemarkPlugins}>
                {item.thinking}
              </ReactMarkdown>
            </div>
          </details>
        ) : null}
        {item.role === 'assistant' ? (
          <ReactMarkdown rehypePlugins={markdownRehypePlugins} remarkPlugins={markdownRemarkPlugins}>
            {item.content}
          </ReactMarkdown>
        ) : (
          <>
            <p>{item.content}</p>
            {item.status === 'failed' && item.errorMessage ? <p className="message-error-text">{item.errorMessage}</p> : null}
            {item.status === 'failed' ? (
              <button className="message-retry-button" type="button" aria-label="Retry message" onClick={() => onRetry?.(item)}>
                Retry
              </button>
            ) : null}
            <button className="message-copy-button message-copy-button-fixed" type="button" aria-label="Copy message" onClick={copyMessage}>
              <Copy aria-hidden="true" size={13} />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </>
        )}
        {item.attachments?.length ? (
          <div className="message-attachment-row" aria-label="Message attachments">
            {item.attachments.map((attachment) => (
              <span className="message-attachment-chip" key={attachment.id}>
                <Paperclip aria-hidden="true" size={13} />
                {attachment.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function QueuedInputs({ inputs }: { inputs: NonNullable<ChatSession['queuedInputs']> }) {
  return (
    <article className="timeline-message user-message queued-message-group">
      <div className="queued-message-list">
        <span className="queued-label">Queued</span>
        {inputs.map((input) => (
          <div className="queued-message-item" key={input.id}>
            <span>{input.content}</span>
            {input.attachments?.length ? <small>{input.attachments.length} attachment{input.attachments.length === 1 ? '' : 's'}</small> : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function ChatRightRail({ inventory, currentWorkspace }: { inventory: SkillInventory; currentWorkspace?: string }) {
  const projectSkills = inventory.project ?? [];
  const globalSkills = inventory.global ?? [];
  if (!currentWorkspace && !projectSkills.length && !globalSkills.length) return null;
  return (
    <aside className="chat-skills-panel" role="region" aria-label="Skills">
      {currentWorkspace ? (
        <section className="workspace-rail-card" role="region" aria-label="Current working directory">
          <h2>Workdir</h2>
          <p>{currentWorkspace}</p>
        </section>
      ) : null}
      {projectSkills.length || globalSkills.length ? <h2>Skills</h2> : null}
      <SkillRailGroup title="Project skills" skills={projectSkills} />
      <SkillRailGroup title="Global" skills={globalSkills} />
    </aside>
  );
}

function SkillRailGroup({ title, skills }: { title: string; skills: SkillSummary[] }) {
  if (!skills.length) return null;
  return (
    <section className="skill-rail-group" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {skills.map((skill) => (
          <li key={skill.id || skill.path}>
            <span>{skill.name}</span>
            {skill.description ? <small>{skill.description}</small> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContextBudgetDonut({ budget }: { budget: NonNullable<ChatSession['contextBudget']> }) {
  const ratio = Math.max(0, Math.min(1, budget.usageRatio ?? 0));
  const percent = Math.round(ratio * 100);
  const state = percent >= 92 ? 'danger' : percent >= 75 ? 'warning' : percent >= 45 ? 'ok' : 'idle';
  const title = budget.contextWindowKnown === false
    ? `${budget.estimatedTokens} tokens, model context window unknown`
    : `${budget.estimatedTokens}/${budget.maxTokens} tokens`;

  return (
    <div
      aria-label="Context budget"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className="context-budget-donut"
      data-state={state}
      role="progressbar"
      style={{ '--budget-percent': `${percent}%` } as CSSProperties}
      title={title}
    >
      <span>{percent}%</span>
    </div>
  );
}

function ComposerActionMenu({
  actions,
  ariaLabel,
  role,
  selectedIndex,
  onSelect
}: {
  actions: ComposerAction[];
  ariaLabel: string;
  role: 'listbox' | 'menu';
  selectedIndex: number;
  onSelect: (action: ComposerAction) => void;
}) {
  const itemRole = role === 'listbox' ? 'option' : 'menuitem';
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (role !== 'listbox') return;
    const selected = itemRefs.current[selectedIndex];
    if (typeof selected?.scrollIntoView === 'function') {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [actions.length, role, selectedIndex]);

  return (
    <div
      aria-label={ariaLabel}
      className={`composer-action-popover ${role === 'listbox' ? 'slash-command-popover' : 'attachment-action-popover'}`}
      role={role}
    >
      {actions.map((action, index) => {
        const Icon = action.icon;
        return (
          <button
            aria-selected={role === 'listbox' ? index === selectedIndex : undefined}
            className="composer-action-item"
            key={action.id}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            role={itemRole}
            type="button"
            onClick={() => onSelect(action)}
          >
            <span className="composer-action-icon" aria-hidden="true">
              <Icon size={17} />
            </span>
            <span className="composer-action-name">{action.label}</span>
            <span className="composer-action-description">{action.description}</span>
          </button>
        );
      })}
    </div>
  );
}

function ModelActionMenu({
  models,
  selectedIndex,
  onHover,
  onSelect
}: {
  models: NonNullable<ChatSession['availableModels']>;
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (modelName: string) => void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const selected = itemRefs.current[selectedIndex];
    if (typeof selected?.scrollIntoView === 'function') {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [models.length, selectedIndex]);

  return (
    <div className="composer-action-popover model-action-popover" role="listbox" aria-label="Model options">
      {models.map((model, index) => (
        <button
          aria-selected={models[selectedIndex]?.name === model.name}
          className="composer-action-item"
          key={model.name}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          role="option"
          type="button"
          onClick={() => onSelect(model.name)}
          onMouseEnter={() => onHover(index)}
        >
          <span className="composer-action-icon" aria-hidden="true">
            <Bot size={17} />
          </span>
          <span className="composer-action-name">{model.name}</span>
          <span className="composer-action-description">{model.model}</span>
        </button>
      ))}
    </div>
  );
}

function SessionMenu({
  sessions,
  selectedSessionId,
  open,
  onOpenChange,
  onSelect,
  onRename,
  onDelete
}: {
  sessions: ChatSession[];
  selectedSessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (sessionId: string) => void;
  onRename: (session: ChatSession) => void;
  onDelete: (session: ChatSession) => void;
}) {
  const options = useMemo(
    () => [
      { id: '', label: 'New chat', session: null as ChatSession | null },
      ...sessions.map((session) => ({
        id: session.id,
        label: session.title || '新的会话',
        session
      }))
    ],
    [sessions]
  );
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === selectedSessionId));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [actionsForSessionId, setActionsForSessionId] = useState<string | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeOption = options[activeIndex] ?? options[selectedIndex] ?? options[0];
  const selectedOption = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) {
      setActiveIndex(selectedIndex);
      return;
    }
    optionRefs.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  function choose(index: number) {
    const option = options[index] ?? options[0];
    onSelect(option.id);
    onOpenChange(false);
    setActionsForSessionId(null);
  }

  function move(delta: number) {
    onOpenChange(true);
    setActiveIndex((index) => {
      const next = (index + delta + options.length) % options.length;
      optionRefs.current[next]?.focus();
      return next;
    });
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onOpenChange(false);
    }
  }

  return (
    <div className="chat-session-menu">
      <button
        aria-activedescendant={open && activeOption ? `chat-session-option-${activeOption.id || 'new'}` : undefined}
        aria-controls="chat-session-listbox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Chat sessions"
        className="chat-session-trigger"
        role="combobox"
        type="button"
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
            onOpenChange(false);
          }
        }}
        onClick={() => {
          onOpenChange(!open);
          setActiveIndex(selectedIndex);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open) {
              choose(activeIndex);
            } else {
              onOpenChange(true);
            }
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onOpenChange(false);
          }
        }}
      >
        <span>{selectedOption?.label ?? 'New chat'}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open ? (
        <div className="chat-session-popover" id="chat-session-listbox" role="listbox" aria-label="Chat sessions">
          {options.map((option, index) => (
            <div className="chat-session-option-row" key={option.id || 'new'}>
              <button
                aria-selected={option.id === selectedSessionId}
                className="chat-session-option"
                data-active={index === activeIndex}
                id={`chat-session-option-${option.id || 'new'}`}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="option"
                type="button"
                onClick={() => choose(index)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="session-option-content">
                  <span
                    className="session-status-light"
                    data-status={option.session && activeRunStatuses.has(option.session.runStatus) ? 'running' : 'idle'}
                    aria-hidden="true"
                  />
                  <span>{option.label}</span>
                </span>
              </button>
              {option.session ? (
                <div className="chat-session-actions">
                  <button
                    aria-expanded={actionsForSessionId === option.session.id}
                    aria-label={`Session actions for ${option.label}`}
                    className="chat-session-more-button"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionsForSessionId((current) => (current === option.session?.id ? null : option.session?.id ?? null));
                    }}
                  >
                    <MoreHorizontal aria-hidden="true" size={15} />
                  </button>
                  {actionsForSessionId === option.session.id ? (
                    <div className="chat-session-actions-menu" role="menu" aria-label={`Actions for ${option.label}`}>
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setActionsForSessionId(null);
                          onOpenChange(false);
                          onRename(option.session as ChatSession);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setActionsForSessionId(null);
                          onOpenChange(false);
                          onDelete(option.session as ChatSession);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChatPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const { workspaceId = 'w_core' } = useParams();
  const [searchParams] = useSearchParams();
  const requestedSessionId = searchParams.get('sessionId')?.trim() ?? '';
  const [clients, setClients] = useState<ClientDaemon[]>(() => (useMockChatApi ? [mockDefaultClient] : []));
  const [clientsHydrated, setClientsHydrated] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState(() => (useMockChatApi ? mockDefaultClient.id : ''));
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pendingInteraction, setPendingInteraction] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [activeComposerPopover, setActiveComposerPopover] = useState<ComposerPopover>(null);
  const [activeComposerDialog, setActiveComposerDialog] = useState<ComposerDialog>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [topClientMenuOpen, setTopClientMenuOpen] = useState(false);
  const [dialogTargetSessionId, setDialogTargetSessionId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [workdirPath, setWorkdirPath] = useState('');
  const [skillInventory, setSkillInventory] = useState<SkillInventory>({ project: [], global: [] });
  const [assistantDraft, setAssistantDraft] = useState('');
  const [assistantThinkingDraft, setAssistantThinkingDraft] = useState('');
  const [thinkingDraftActive, setThinkingDraftActive] = useState(false);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const streamRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastStreamSequenceRef = useRef(0);
  const typewriterBufferRef = useRef('');
  const typewriterFrameRef = useRef<number | null>(null);
  const thinkingTypewriterBufferRef = useRef('');
  const thinkingTypewriterFrameRef = useRef<number | null>(null);
  const modelMenuSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    loadClientDaemons(auth.token)
      .then((result) => {
        if (!active) return;
        setClients(result);
        setSelectedClientId((current) => {
          const currentClient = result.find((client) => client.id === current);
          if (currentClient && isUsableChatClient(currentClient)) {
            return current;
          }
          return result.find(isUsableChatClient)?.id || '';
        });
      })
      .catch((caught) => {
        if (active) {
          const message = errorMessage(caught, 'Failed to load clients');
          setChatError(message);
          showToast(message);
        }
      })
      .finally(() => {
        if (active) setClientsHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [auth.token]);

  useEffect(() => {
    let active = true;
    if (!clientsHydrated) {
      setLoadingSessions(true);
      return () => {
        active = false;
      };
    }

    setLoadingSessions(true);
    if (clientsHydrated && !clients.some(isUsableChatClient)) {
      setSessions([]);
      setSelectedSessionId('');
      setSessionMenuOpen(true);
      setLoadingSessions(false);
      return () => {
        active = false;
      };
    }
    loadChatSessions(workspaceId, selectedClientId || undefined)
      .then((result) => {
        if (!active) return;
        setSessions(result);
        const lastSessionKey = `brainx.chat.lastSession.${workspaceId}.${selectedClientId || 'default'}`;
        const newest = [...result].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        const requested = requestedSessionId && requestedSessionId !== 'new'
          ? result.find((session) => session.id === requestedSessionId)
          : null;
        const rememberedId = globalThis.localStorage?.getItem(lastSessionKey) ?? '';
        const remembered = rememberedId ? result.find((session) => session.id === rememberedId) : null;
        const nextSessionId = requestedSessionId === 'new'
          ? ''
          : requested?.id ?? remembered?.id ?? newest?.id ?? '';
        setSelectedSessionId(nextSessionId);
        setSessionMenuOpen(!nextSessionId);
      })
      .catch((caught) => {
        if (active) {
          const message = errorMessage(caught, 'Failed to load chat');
          setChatError(message);
          showToast(message);
        }
      })
      .finally(() => {
        if (active) setLoadingSessions(false);
      });

    return () => {
      active = false;
    };
  }, [clients, clientsHydrated, requestedSessionId, selectedClientId, workspaceId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    globalThis.localStorage?.setItem(`brainx.chat.lastSession.${workspaceId}.${selectedClientId || 'default'}`, selectedSessionId);
  }, [selectedClientId, selectedSessionId, workspaceId]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId),
    [selectedSessionId, sessions]
  );

  useEffect(() => {
    let active = true;
    if (!selectedSession?.currentWorkspace) {
      setSkillInventory({ project: [], global: [] });
      return () => {
        active = false;
      };
    }
    loadSkillInventory(workspaceId, {
      clientDaemonId: selectedSession.clientDaemonId || selectedClientId || undefined,
      currentWorkspace: selectedSession.currentWorkspace
    })
      .then((inventory) => {
        if (active) setSkillInventory(inventory);
      })
      .catch(() => {
        if (active) setSkillInventory({ project: [], global: [] });
      });
    return () => {
      active = false;
    };
  }, [selectedClientId, selectedSession?.clientDaemonId, selectedSession?.currentWorkspace, workspaceId]);
  const chatClients = useMemo(
    () => clients.filter(isUsableChatClient),
    [clients]
  );
  const noUsableClient = clientsHydrated && chatClients.length === 0;
  const isAgentActive = Boolean(selectedSession && activeRunStatuses.has(selectedSession.runStatus));
  const topBarClientSelector = useMemo(
    () => {
      const selectedClient = chatClients.find((client) => client.id === selectedClientId) ?? chatClients[0];
      return (
        <div className="top-client-selector" aria-label="Bound client selector">
          {selectedClient ? (
            <>
              <button
                aria-expanded={topClientMenuOpen}
                aria-haspopup="listbox"
                aria-label="Bound client device"
                className="top-client-trigger"
                type="button"
                onClick={() => setTopClientMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setTopClientMenuOpen(true);
                  }
                }}
              >
                <span>{selectedClient.deviceName || selectedClient.id}</span>
                <ChevronDown aria-hidden="true" size={14} />
              </button>
              {topClientMenuOpen ? (
                <div className="top-client-menu" role="listbox" aria-label="Bound client devices">
                  {chatClients.map((client) => (
                    <button
                      aria-selected={client.id === selectedClient.id}
                      className="top-client-option"
                      key={client.id}
                      role="option"
                      type="button"
                      onClick={() => {
                        setSelectedClientId(client.id);
                        setSelectedSessionId('');
                        setSessionMenuOpen(false);
                        setTopClientMenuOpen(false);
                        resetAssistantStream();
                      }}
                    >
                      <span>{client.deviceName || client.id}</span>
                      {client.os ? <small>{client.os}</small> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <span className="top-client-empty">No bound client</span>
          )}
        </div>
      );
    },
    [chatClients, selectedClientId, topClientMenuOpen]
  );
  useTopBarSlot(topBarClientSelector, [topBarClientSelector]);

  useEffect(
    () => () => {
      typewriterBufferRef.current = '';
      thinkingTypewriterBufferRef.current = '';
      if (typewriterFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(typewriterFrameRef.current);
        typewriterFrameRef.current = null;
      }
      if (thinkingTypewriterFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(thinkingTypewriterFrameRef.current);
        thinkingTypewriterFrameRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (useMockChatApi || !selectedSession || !activeRunStatuses.has(selectedSession.runStatus)) {
      return undefined;
    }

    let active = true;
    const timer = globalThis.setInterval(() => {
      getRealChatSessionById(workspaceId, selectedSession.id)
        .then((updated) => {
          if (!active) return;
          replaceSession(updated);
        })
        .catch((caught) => {
          if (active) {
            const message = errorMessage(caught, 'Failed to poll chat');
            setChatError(message);
            showToast(message);
          }
        });
    }, 1200);

    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [selectedSession?.id, selectedSession?.runStatus, workspaceId]);

  useEffect(() => {
    if (useMockChatApi || !selectedSession || !isAgentActive || !selectedSession.runId) {
      resetAssistantStream();
      lastStreamSequenceRef.current = 0;
      return undefined;
    }

    resetAssistantStream();
    lastStreamSequenceRef.current = 0;
    return subscribeChatEvents(
      workspaceId,
      selectedSession.runId,
      lastStreamSequenceRef.current,
      (event) => {
        if (event.sequence <= lastStreamSequenceRef.current) return;
        lastStreamSequenceRef.current = event.sequence;
        const delta = typeof event.payload?.contentDelta === 'string' ? event.payload.contentDelta : '';
        const streamType = typeof event.payload?.streamType === 'string' ? event.payload.streamType : 'assistant_delta';
        if (delta && streamType === 'assistant_thinking_delta') {
          setThinkingDraftActive(true);
          thinkingTypewriterBufferRef.current = `${thinkingTypewriterBufferRef.current}${delta}`;
          scheduleThinkingTypewriterDrain();
          return;
        }
        if (delta) {
          flushThinkingTypewriterBuffer();
          typewriterBufferRef.current = `${typewriterBufferRef.current}${delta}`;
          scheduleTypewriterDrain();
        }
      },
      () => undefined
    );
  }, [isAgentActive, selectedSession?.runId, workspaceId]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    if (typeof stream.scrollTo === 'function') {
      stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' });
      return;
    }
    stream.scrollTop = stream.scrollHeight;
  }, [assistantDraft, assistantThinkingDraft, isAgentActive, selectedSession?.id, selectedSession?.messages.length, selectedSession?.queuedInputs?.length]);

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream || !selectedSession?.id) return undefined;
    const frame = globalThis.requestAnimationFrame(() => {
      if (typeof stream.scrollTo === 'function') {
        stream.scrollTo({ top: stream.scrollHeight, behavior: 'auto' });
        return;
      }
      stream.scrollTop = stream.scrollHeight;
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [selectedSession?.id]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = 'auto';
    composer.style.height = `${composer.scrollHeight}px`;
  }, [message]);

  useEffect(() => {
    composerRef.current?.focus();
  }, [selectedSessionId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (activeComposerDialog) {
        event.preventDefault();
        setActiveComposerDialog(null);
        composerRef.current?.focus();
        return;
      }
      if (activeComposerPopover) {
        event.preventDefault();
        setActiveComposerPopover(null);
        composerRef.current?.focus();
        return;
      }
      if (sessionMenuOpen) {
        event.preventDefault();
        setSessionMenuOpen(false);
        composerRef.current?.focus();
        return;
      }
      if (selectedSession && activeRunStatuses.has(selectedSession.runStatus)) {
        event.preventDefault();
        void cancelActiveRun();
      }
    }

    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [activeComposerDialog, activeComposerPopover, cancelling, selectedSession?.id, selectedSession?.runStatus, sessionMenuOpen, workspaceId]);

  function replaceSession(updated: ChatSession) {
    setSessions((current) =>
      current.some((session) => session.id === updated.id)
        ? current.map((session) => (session.id === updated.id ? updated : session))
        : [updated, ...current]
    );
  }

  function resetAssistantStream() {
    typewriterBufferRef.current = '';
    thinkingTypewriterBufferRef.current = '';
    if (typewriterFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(typewriterFrameRef.current);
      typewriterFrameRef.current = null;
    }
    if (thinkingTypewriterFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(thinkingTypewriterFrameRef.current);
      thinkingTypewriterFrameRef.current = null;
    }
    setAssistantDraft('');
    setAssistantThinkingDraft('');
    setThinkingDraftActive(false);
  }

  function flushThinkingTypewriterBuffer() {
    if (thinkingTypewriterFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(thinkingTypewriterFrameRef.current);
      thinkingTypewriterFrameRef.current = null;
    }
    const pending = thinkingTypewriterBufferRef.current;
    if (pending) {
      thinkingTypewriterBufferRef.current = '';
      setAssistantThinkingDraft((current) => `${current}${pending}`);
    }
    setThinkingDraftActive(false);
  }

  function scheduleTypewriterDrain() {
    if (typewriterFrameRef.current !== null) return;

    const drain = () => {
      const next = takeTypewriterSlice(typewriterBufferRef.current, assistantTypewriterChunkSize);
      typewriterBufferRef.current = next.rest;
      if (next.visible) {
        setAssistantDraft((current) => `${current}${next.visible}`);
      }
      typewriterFrameRef.current = typewriterBufferRef.current ? globalThis.requestAnimationFrame(drain) : null;
    };

    typewriterFrameRef.current = globalThis.requestAnimationFrame(drain);
  }

  function scheduleThinkingTypewriterDrain() {
    if (thinkingTypewriterFrameRef.current !== null) return;

    const drain = () => {
      const next = takeTypewriterSlice(thinkingTypewriterBufferRef.current, thinkingTypewriterChunkSize);
      thinkingTypewriterBufferRef.current = next.rest;
      if (next.visible) {
        setAssistantThinkingDraft((current) => `${current}${next.visible}`);
      }
      thinkingTypewriterFrameRef.current = thinkingTypewriterBufferRef.current ? globalThis.requestAnimationFrame(drain) : null;
    };

    thinkingTypewriterFrameRef.current = globalThis.requestAnimationFrame(drain);
  }

  function showToast(message: string, tone: ToastNotice['tone'] = 'error') {
    const id = `toast_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id, message: sanitizeChatError(message), tone }].slice(-4));
    globalThis.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  }

  function errorMessage(caught: unknown, fallback: string) {
    return sanitizeChatError(caught instanceof Error ? caught.message : fallback);
  }

  function showCommandSuccess(command: string, previous: ChatSession, updated: ChatSession, args: Record<string, unknown>) {
    if (command === 'clear') {
      showToast('上下文已清空', 'info');
      return;
    }
    if (command === 'compact') {
      const noContext = previous.messages.length === 0 && updated.messages.length === 0 && !activeRunStatuses.has(updated.runStatus);
      showToast(noContext ? '没有可压缩的上下文' : '正在压缩上下文', 'info');
      return;
    }
    if (command === 'model') {
      const requested = String(args.modelName ?? '');
      if (requested && updated.activeModelName && updated.activeModelName !== requested) {
        showToast(`模型切换未生效：服务器返回 ${updated.activeModelName}`);
        return;
      }
      const modelName = requested || updated.activeModelName || '';
      showToast(modelName ? `模型已切换到 ${modelName}` : '模型已切换', 'info');
      return;
    }
    if (command === 'workspace') {
      const requested = String(args.path ?? '');
      if (requested && updated.currentWorkspace && updated.currentWorkspace !== requested) {
        showToast(`工作目录切换未生效：服务器返回 ${updated.currentWorkspace}`);
        return;
      }
      const path = updated.currentWorkspace ?? requested;
      showToast(path ? `工作目录已切换到 ${path}` : '工作目录已切换', 'info');
    }
  }

  function markLastUserMessageFailed(session: ChatSession, failedContent: string, failedMessage: string): ChatSession {
    const messages = [...session.messages];
    for (let index = messages.length - 1; index >= 0; index--) {
      const candidate = messages[index];
      if (candidate.role !== 'user') continue;
      if (messageContentText(candidate.content) !== failedContent) continue;
      messages[index] = {
        ...candidate,
        status: 'failed',
        error: {
          code: 'send_failed',
          message: failedMessage
        }
      };
      break;
    }
    return {
      ...session,
      runStatus: 'failed',
      messages
    };
  }

  function removeFailedUserMessage(session: ChatSession, failedItem: TextTimelineItem): ChatSession {
    const messages = [...session.messages];
    for (let index = messages.length - 1; index >= 0; index--) {
      const candidate = messages[index];
      if (candidate.role !== 'user') continue;
      if (messageContentText(candidate.content) !== failedItem.content) continue;
      const nextMessage = messages[index + 1];
      const nextIsFailure = nextMessage?.role === 'assistant' && isModelFailureText(nextMessage.content ?? '');
      if (candidate.status === 'failed' || nextIsFailure || failedItem.status === 'failed') {
        messages.splice(index, nextIsFailure ? 2 : 1);
        return {
          ...session,
          messages,
          runStatus: 'completed'
        };
      }
    }
    return session;
  }

  function resetToEmptyDraft() {
    setSelectedSessionId('');
    setMessage('');
    setAttachments([]);
    setActiveComposerPopover(null);
    setActiveComposerDialog(null);
    setDialogTargetSessionId(null);
    setSessionMenuOpen(true);
    setSelectedCommandIndex(0);
    setWorkdirPath('');
    resetAssistantStream();
  }

  async function ensureSessionForAction(action: ComposerAction): Promise<ChatSession | null> {
    if (action.sessionPolicy === 'none') return selectedSession ?? null;
    if (selectedSession) return selectedSession;
    if (noUsableClient || !selectedClientId) {
      showToast('No bound client is selected. Bind a client before starting chat.', 'info');
      return null;
    }

    const created = await createChatSessionShell(workspaceId, selectedClientId || undefined);
    replaceSession(created);
    setSelectedSessionId(created.id);
    return created;
  }

  async function runChatCommand(
    command: string,
    args: Record<string, unknown>,
    restoreContent: string,
    targetSession = selectedSession
  ) {
    if (sending) return;
    setMessage('');
    setActiveComposerPopover(null);
    setSelectedCommandIndex(0);
    if (command === 'new') {
      resetToEmptyDraft();
      return;
    }
    if (!targetSession) {
      showToast(`/${command} is available after a session exists.`, 'info');
      return;
    }
    setSending(true);
    setChatError(null);
    try {
      if (command === 'fork') {
        const forked = await forkChatSessionShell(workspaceId, targetSession.id);
        replaceSession(forked);
        setSelectedSessionId(forked.id);
      } else if (command === 'rename') {
        const title = String(args.input ?? '').trim();
        if (!title) {
          showToast('/rename requires a title.');
          setMessage(restoreContent);
          return;
        }
        replaceSession(await renameChatSessionShell(workspaceId, targetSession.id, title));
      } else if (command === 'delete') {
        await deleteChatSessionShell(workspaceId, targetSession.id);
        const nextSessions = await loadChatSessions(workspaceId, selectedClientId || undefined);
        setSessions(nextSessions);
        setSelectedSessionId('');
      } else {
        const commandArgs = { ...args, activeSessionId: targetSession.id };
        const updated = await submitChatCommand(workspaceId, command, commandArgs, targetSession.id);
        replaceSession(updated);
        if (command === 'clear') {
          resetAssistantStream();
        }
        showCommandSuccess(command, targetSession, updated, commandArgs);
      }
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to run command'));
      setMessage(restoreContent);
    } finally {
      setSending(false);
    }
  }

  async function cancelActiveRun() {
    if (!selectedSession || cancelling) return;
    setCancelling(true);
    setChatError(null);
    try {
      replaceSession(await cancelChatRun(workspaceId, selectedSession.id));
      resetAssistantStream();
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to cancel run'));
    } finally {
      setCancelling(false);
    }
  }

  async function executeComposerAction(action: ComposerAction, restoreContent = message.trim()) {
    if (sending) return;
    setActiveComposerPopover(null);
    setSelectedCommandIndex(0);

    if (action.id === 'attach') {
      openNativeFilePicker();
      return;
    }

    if (action.command === 'new') {
      resetToEmptyDraft();
      return;
    }

    if (action.command === 'session') {
      setMessage('');
      setActiveComposerPopover(null);
      setSessionMenuOpen(true);
      return;
    }

    if (action.command === 'model') {
      setMessage('');
      modelMenuSessionIdRef.current = selectedSession?.id ?? '';
      setSelectedModelIndex(Math.max(0, modelOptions.findIndex((model) => model.name === currentModelName)));
      setActiveComposerPopover('model');
      return;
    }

    if (action.command === 'rename') {
      setMessage('');
      setDialogTargetSessionId(selectedSession?.id ?? null);
      setRenameTitle('');
      setActiveComposerDialog('rename');
      return;
    }

    if (action.command === 'workspace') {
      setMessage('');
      setWorkdirPath(selectedSession?.currentWorkspace ?? '~/.brainx/workspace');
      setActiveComposerDialog('workspace');
      return;
    }

    if (action.command === 'delete') {
      setMessage('');
      if (!selectedSession) {
        showToast('/delete is available after a session exists.', 'info');
        return;
      }
      setDialogTargetSessionId(selectedSession.id);
      setActiveComposerDialog('delete');
      return;
    }

    if (action.command === 'init') {
      setMessage('');
      await sendPreparedMessage(initProjectPrompt, []);
      return;
    }

    if (action.command === 'skill-reflection') {
      setMessage('');
      await sendPreparedMessage(skillReflectionPrompt, []);
      return;
    }

    if (!action.command) return;

    const typed = message.trim();
    const rest = typed.startsWith('/') ? typed.slice(1).split(/\s+/).slice(1).join(' ').trim() : '';
    const baseArgs = rest ? { input: rest, activeSessionId: selectedSession?.id } : { activeSessionId: selectedSession?.id };

    try {
      const targetSession = await ensureSessionForAction(action);
      await runChatCommand(action.command, baseArgs, restoreContent, targetSession ?? undefined);
    } catch (caught) {
      showToast(errorMessage(caught, `Failed to run ${action.label}`));
      setMessage(restoreContent);
    }
  }

  function executeSlashCommand(item: ComposerAction) {
    const typed = message.trim();
    const rest = typed.startsWith('/') ? typed.slice(1).split(/\s+/).slice(1).join(' ').trim() : '';
    void executeComposerAction(item, rest ? `/${item.command ?? item.id} ${rest}` : item.label);
  }

  async function sendPreparedMessage(content: string, attachmentInputs: ChatAttachmentInput[], sessionOverride?: ChatSession) {
    if ((!content.trim() && attachmentInputs.length === 0) || sending) return;

    setSending(true);
    setChatError(null);
    let sessionForSend = sessionOverride ?? selectedSession;
    let optimisticSession: ChatSession | null = null;

    try {
      if (noUsableClient || !selectedClientId) {
        showToast('No bound client is selected. Bind a client before starting chat.', 'info');
        return;
      }
      if (!sessionForSend) {
        sessionForSend = await createChatSessionShell(workspaceId, selectedClientId || undefined);
        replaceSession(sessionForSend);
        setSelectedSessionId(sessionForSend.id);
      }

      optimisticSession = {
        ...sessionForSend,
        updatedAt: new Date().toISOString(),
        messages: [
          ...sessionForSend.messages,
          {
            role: 'user',
            content,
            attachments: attachmentInputs
          }
        ]
      };

      replaceSession(optimisticSession);
      setMessage('');
      replaceSession(await submitChatMessage(workspaceId, sessionForSend.id, content, attachmentInputs));
      setAttachments([]);
      composerRef.current?.focus();
    } catch (caught) {
      const failedMessage = errorMessage(caught, 'Failed to send message');
      showToast(failedMessage);
      if (optimisticSession) {
        replaceSession(markLastUserMessageFailed(optimisticSession, content, failedMessage));
      } else if (sessionForSend) {
        replaceSession(markLastUserMessageFailed(sessionForSend, content, failedMessage));
        setMessage(content);
      } else {
        setMessage(content);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    if ((!message.trim() && attachments.length === 0) || sending) return;

    const content = message.trim() || 'Attached files';
    const slashCommand = parseSlashCommand(content, selectedSession);
    if (slashCommand) {
      await executeComposerAction(slashCommand.action, content);
      return;
    }
    if (content.startsWith('/')) {
      showToast(`Unknown command: ${content.split(/\s+/)[0]}`, 'info');
      return;
    }

    try {
      const attachmentInputs = await filesToAttachmentInputs(attachments);
      await sendPreparedMessage(content, attachmentInputs);
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to read attachments'));
    }
  }

  async function handleRetryMessage(item: TextTimelineItem) {
    const cleaned = selectedSession ? removeFailedUserMessage(selectedSession, item) : null;
    if (cleaned) {
      replaceSession(cleaned);
    }
    await sendPreparedMessage(item.content, item.attachments ?? [], cleaned ?? undefined);
  }

  async function selectModel(modelName: string) {
    if (sending) return;
    setSending(true);
    setChatError(null);
    try {
      const menuSessionId = modelMenuSessionIdRef.current;
      const menuSession = menuSessionId ? sessions.find((session) => session.id === menuSessionId) : null;
      const targetSession = menuSessionId === ''
        ? await createChatSessionShell(workspaceId, selectedClientId || undefined)
        : menuSession ?? selectedSession ?? (await createChatSessionShell(workspaceId, selectedClientId || undefined));
      if (!selectedSession || targetSession.id !== selectedSession.id) {
        replaceSession(targetSession);
        setSelectedSessionId(targetSession.id);
      }
      const updated = await submitChatCommand(workspaceId, 'model', { modelName }, targetSession.id);
      replaceSession(updated);
      if (updated.id) setSelectedSessionId(updated.id);
      setActiveComposerPopover(null);
      modelMenuSessionIdRef.current = null;
      showCommandSuccess('model', targetSession, updated, { modelName });
      composerRef.current?.focus();
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to switch model'));
    } finally {
      setSending(false);
    }
  }

  async function submitRenameDialog() {
    const title = renameTitle.trim();
    if (!title || sending) return;
    setSending(true);
    setChatError(null);
    try {
      const targetSession = dialogTargetSessionId
        ? sessions.find((session) => session.id === dialogTargetSessionId)
        : selectedSession ?? (await createChatSessionShell(workspaceId, selectedClientId || undefined));
      if (!targetSession) {
        showToast('Session was not found.');
        return;
      }
      replaceSession(targetSession);
      const renamed = await renameChatSessionShell(workspaceId, targetSession.id, title);
      replaceSession(renamed);
      if (!dialogTargetSessionId || selectedSession?.id === targetSession.id) {
        setSelectedSessionId(renamed.id);
      }
      setActiveComposerDialog(null);
      setDialogTargetSessionId(null);
      setRenameTitle('');
      composerRef.current?.focus();
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to rename session'));
    } finally {
      setSending(false);
    }
  }

  async function submitWorkspaceDialog() {
    const path = workdirPath.trim();
    if (!path || sending) return;
    setSending(true);
    setChatError(null);
    try {
      const targetSession = selectedSession ?? (await createChatSessionShell(workspaceId, selectedClientId || undefined));
      replaceSession(targetSession);
      const updated = await submitChatCommand(workspaceId, 'workspace', { path }, targetSession.id);
      replaceSession(updated);
      setSelectedSessionId(updated.id);
      setActiveComposerDialog(null);
      setWorkdirPath('');
      showCommandSuccess('workspace', targetSession, updated, { path });
      composerRef.current?.focus();
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to switch working directory'));
    } finally {
      setSending(false);
    }
  }

  async function confirmDeleteSession() {
    const targetSession = dialogTargetSessionId
      ? sessions.find((session) => session.id === dialogTargetSessionId)
      : selectedSession;
    if (!targetSession || sending) return;
    setSending(true);
    setChatError(null);
    try {
      await deleteChatSessionShell(workspaceId, targetSession.id);
      const nextSessions = await loadChatSessions(workspaceId, selectedClientId || undefined);
      setSessions(nextSessions);
      if (targetSession.id === selectedSession?.id) {
        setSelectedSessionId('');
        resetAssistantStream();
      }
      setActiveComposerDialog(null);
      setDialogTargetSessionId(null);
      composerRef.current?.focus();
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to delete session'));
    } finally {
      setSending(false);
    }
  }

  async function handleApprove(item: ToolTimelineItem) {
    const executionId = item.state?.executionId;
    if (useMockChatApi || !executionId) return;
    setPendingInteraction(`approve:${executionId}`);
    setChatError(null);
    try {
      replaceSession(await approveToolRequest(auth.token ?? '', workspaceId, executionId));
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to approve tool request'));
    } finally {
      setPendingInteraction(null);
    }
  }

  async function handleReject(item: ToolTimelineItem) {
    const executionId = item.state?.executionId;
    if (useMockChatApi || !executionId) return;
    setPendingInteraction(`reject:${executionId}`);
    setChatError(null);
    try {
      replaceSession(await rejectToolRequest(auth.token ?? '', workspaceId, executionId, 'Rejected in browser'));
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to reject tool request'));
    } finally {
      setPendingInteraction(null);
    }
  }

  async function handleAskUserAnswer(item: ToolTimelineItem, answers: AskUserAnswer[]) {
    if (!selectedSession) return;
    setPendingInteraction(`ask:${item.call.id}`);
    setChatError(null);
    try {
      replaceSession(await answerAskUser(auth.token ?? '', workspaceId, selectedSession.runId, item.call.id, answers));
    } catch (caught) {
      showToast(errorMessage(caught, 'Failed to answer question'));
    } finally {
      setPendingInteraction(null);
    }
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? []);
    setAttachments((current) => {
      const accepted: File[] = [];
      let totalBytes = current.reduce((sum, file) => sum + file.size, 0);
      for (const file of nextFiles) {
        if (current.length + accepted.length >= maxAttachmentsPerMessage) {
          showToast(`A message can include at most ${maxAttachmentsPerMessage} attachments.`);
          continue;
        }
        const validationError = attachmentValidationError(file);
        if (validationError) {
          showToast(validationError);
          continue;
        }
        if (totalBytes + file.size > maxTotalAttachmentBytes) {
          showToast(`${file.name}: total attachment payload must stay under 20 MB.`);
          continue;
        }
        totalBytes += file.size;
        accepted.push(file);
      }
      return [...current, ...accepted];
    });
    setActiveComposerPopover(null);
    event.target.value = '';
  }

  function removeAttachment(file: File) {
    setAttachments((current) => current.filter((candidate) => candidate !== file));
  }

  function handleMessageChange(value: string) {
    setMessage(value);
    setSelectedCommandIndex(0);
    setActiveComposerPopover(value.trim().startsWith('/') ? 'slash' : null);
  }

  function openNativeFilePicker() {
    setActiveComposerPopover(null);
    fileInputRef.current?.click();
  }

  if (loadingSessions && !chatError) {
    return <PageSkeleton label={t('chat.loading')} />;
  }

  const timeline = selectedSession ? buildTimeline(selectedSession.messages, selectedSession.toolStates ?? {}, selectedSession.timelineNotices ?? []) : [];
  const trimmedMessage = message.trim();
  const commandQuery = trimmedMessage.startsWith('/') ? trimmedMessage.slice(1).toLowerCase() : '';
  const commandToken = commandQuery.split(/\s+/)[0] ?? '';
  const commandSuggestions = commandToken
    ? slashActions.filter((item) => actionMatchesQuery(item, commandToken))
    : slashActions;
  const visibleCommandSuggestions = activeComposerPopover === 'slash' && trimmedMessage.startsWith('/')
    ? commandSuggestions
    : [];
  const budget = selectedSession
    ? selectedSession.contextBudget ?? {
        messageCount: selectedSession.messages.length,
        estimatedTokens: 0,
        maxTokens: 128000,
        thresholdTokens: 96000,
        usageRatio: 0,
        contextWindowKnown: false
      }
    : null;
  const timelineWithDraft: TimelineItem[] = assistantDraft || assistantThinkingDraft
    ? [...timeline, { type: 'text', role: 'assistant', content: assistantDraft, thinking: assistantThinkingDraft, thinkingActive: thinkingDraftActive && Boolean(assistantThinkingDraft) }]
    : timeline;
  const isEmptyDraft = !selectedSession;
  const derivedTodos = selectedSession ? deriveTodoState(selectedSession) : [];
  const derivedTerminals = selectedSession ? deriveTerminalState(selectedSession) : [];
  const modelOptions = selectedSession?.availableModels ?? sessions.find((session) => session.availableModels?.length)?.availableModels ?? [];
  const currentModelName = selectedSession?.activeModelName ?? modelOptions[0]?.name ?? 'nvidia:stepfun-ai/step-3.7-flash';
  const hasSidePanel = true;

  return (
    <section className={`chat-preview-page chat-page-live${isEmptyDraft ? ' chat-empty-page' : ''}${hasSidePanel ? ' has-chat-side-panel' : ''}`}>
      {toasts.length ? (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((toast) => (
            <div className="chat-toast" data-tone={toast.tone} key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'}>
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}
      <aside className="chat-state-panel" aria-label="Session state">
        <section className="chat-rail-section chat-session-section" aria-label="Session section">
          <h2>Session</h2>
          <SessionMenu
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            open={sessionMenuOpen}
            onOpenChange={setSessionMenuOpen}
            onSelect={(sessionId) => {
              setSelectedSessionId(sessionId);
              resetAssistantStream();
            }}
            onRename={(session) => {
              setDialogTargetSessionId(session.id);
              setRenameTitle(session.title || '新的会话');
              setActiveComposerDialog('rename');
              setSessionMenuOpen(false);
            }}
            onDelete={(session) => {
              setDialogTargetSessionId(session.id);
              setActiveComposerDialog('delete');
              setSessionMenuOpen(false);
            }}
          />
        </section>
        {derivedTodos.length ? (
          <section className="chat-rail-section" aria-label="Todo section">
            <h2>Todo</h2>
            <ul className="chat-rail-list chat-rail-scroll" aria-label="Todo">
              {derivedTodos.map((todo) => (
                <li className="chat-rail-item todo-rail-item" key={todo.id} data-status={todo.status}>
                  <span className="todo-status-icon" aria-label={`Todo status: ${todo.status}`} data-status={todo.status}>
                    {(() => {
                      const Icon = todoStatusIcon(todo.status);
                      return <Icon aria-hidden="true" className={todo.status === 'in_progress' || todo.status === 'running' ? 'spinning-status' : undefined} size={14} />;
                    })()}
                  </span>
                  <span className="chat-rail-item-copy">
                    <span>{todo.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {derivedTerminals.length ? (
          <section className="chat-rail-section" aria-label="Terminal section">
            <h2>Terminal</h2>
            <ul className="chat-rail-list chat-rail-scroll terminal-rail-list" aria-label="Terminal">
              {derivedTerminals.map((terminal) => (
                <li className="chat-rail-item terminal-rail-item" key={terminal.id} data-status={terminal.status}>
                  <span className="terminal-status-light" aria-label={`Terminal status: ${terminal.status}`} data-status={terminal.status} />
                  <span className="chat-rail-item-copy">
                    <span>{terminal.title}</span>
                    <small>{terminal.status}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
      <main className={`low-density-chat${isEmptyDraft ? ' empty-chat-shell' : ''}`} aria-label="Timeline workspace">
        {noUsableClient ? (
          <section className="chat-empty-state chat-empty-state-centered chat-no-client-state" aria-label="No bound client">
            <div className="chat-empty-copy">
              <h1 className="chat-empty-display-title">Bind a client to start chat</h1>
              <p>Connect a local brainx client before creating sessions or sending agent work.</p>
            </div>
            <Link className="primary-action no-client-link" to={`/workspaces/${workspaceId}/client-daemons`}>
              Open Client page
            </Link>
          </section>
        ) : isEmptyDraft ? (
          <section className="chat-empty-state chat-empty-state-centered" aria-label="Empty chat">
            <div className="chat-empty-copy">
              <h1 className="chat-empty-display-title">What should brainx work on?</h1>
              <p>Start from a goal, a question, or a concrete task in the current workspace.</p>
            </div>
            <div className="empty-topic-row" aria-label="Quick topics">
              {emptyChatTopics.map((topic) => (
                <button key={topic.label} type="button" onClick={() => void sendPreparedMessage(topic.prompt, [])}>
                  {topic.label}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="agent-loop-timeline timeline-scroll-region" role="log" aria-label="Agent loop timeline" ref={streamRef}>
            {timelineWithDraft.length ? (
              timelineWithDraft.map((item, index) =>
                item.type === 'notice' ? (
                  <TimelineNotice notice={item.notice} key={`notice-${item.notice.id}`} />
                ) : item.type === 'text' ? (
                  <TextMessage item={item} key={`${item.role}-${index}`} onRetry={handleRetryMessage} />
                ) : (
                  <ToolCallItem
                    item={item}
                    key={item.call.id}
                    pendingInteraction={pendingInteraction}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onAnswerAskUser={handleAskUserAnswer}
                  />
                )
              )
            ) : null}
            {selectedSession?.queuedInputs?.length ? <QueuedInputs inputs={selectedSession.queuedInputs} /> : null}
            {isAgentActive && !assistantDraft && !assistantThinkingDraft ? (
              <article className="timeline-message assistant-message">
                <div className="agent-stream-placeholder" role="status">
                  <LoaderCircle aria-hidden="true" className="spinning-status" size={16} />
                  Working
                </div>
              </article>
            ) : null}
          </section>
        )}
        <form
          aria-label="Message composer"
          className="preview-composer composer-dock-sticky"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend();
          }}
        >
          <textarea
            ref={composerRef}
            aria-label={t('chat.messageBrainx')}
            rows={1}
            value={message}
            placeholder={t('chat.messagePlaceholder')}
            onChange={(event) => {
              handleMessageChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (activeComposerPopover === 'model' && modelOptions.length) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedModelIndex((index) => (index + 1) % modelOptions.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedModelIndex((index) => (index - 1 + modelOptions.length) % modelOptions.length);
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  const selectedModel = modelOptions[selectedModelIndex] ?? modelOptions[0];
                  if (selectedModel) {
                    void selectModel(selectedModel.name);
                  }
                  return;
                }
              }
              if (visibleCommandSuggestions.length) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedCommandIndex((index) => (index + 1) % visibleCommandSuggestions.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedCommandIndex((index) => (index - 1 + visibleCommandSuggestions.length) % visibleCommandSuggestions.length);
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  executeSlashCommand(visibleCommandSuggestions[selectedCommandIndex] ?? visibleCommandSuggestions[0]);
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />
          {visibleCommandSuggestions.length ? (
            <ComposerActionMenu
              actions={visibleCommandSuggestions}
              ariaLabel="Chat commands"
              role="listbox"
              selectedIndex={selectedCommandIndex}
              onSelect={executeSlashCommand}
            />
          ) : null}
          {activeComposerPopover === 'attachments' ? (
            <ComposerActionMenu
              actions={plusActions}
              ariaLabel="Attachment actions"
              role="menu"
              selectedIndex={0}
              onSelect={(action) => {
                void executeComposerAction(action);
              }}
            />
          ) : null}
          {activeComposerPopover === 'model' ? (
            <ModelActionMenu
              models={modelOptions}
              selectedIndex={selectedModelIndex}
              onHover={setSelectedModelIndex}
              onSelect={(modelName) => void selectModel(modelName)}
            />
          ) : null}
          {activeComposerDialog === 'rename' ? (
            <div className="composer-floating-dialog" role="dialog" aria-label="Rename session">
              <label>
                <span>Session name</span>
                <input
                  aria-label="Session name"
                  autoFocus
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitRenameDialog();
                    }
                  }}
                />
              </label>
              <div className="composer-dialog-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    setActiveComposerDialog(null);
                    setDialogTargetSessionId(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action"
                  aria-label="Save session name"
                  disabled={!renameTitle.trim() || sending}
                  onClick={() => void submitRenameDialog()}
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}
          {activeComposerDialog === 'workspace' ? (
            <div className="composer-floating-dialog" role="dialog" aria-label="Switch working directory">
              <label>
                <span>Working directory</span>
                <input
                  aria-label="Working directory"
                  autoFocus
                  value={workdirPath}
                  onChange={(event) => setWorkdirPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitWorkspaceDialog();
                    }
                  }}
                />
              </label>
              <div className="composer-dialog-actions">
                <button type="button" className="secondary-action" onClick={() => setActiveComposerDialog(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action"
                  aria-label="Save working directory"
                  disabled={!workdirPath.trim() || sending}
                  onClick={() => void submitWorkspaceDialog()}
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}
          {activeComposerDialog === 'delete' ? (
            <div className="composer-floating-dialog" role="dialog" aria-label="Delete session">
              <p>Delete this session and its forked children?</p>
              <div className="composer-dialog-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    setActiveComposerDialog(null);
                    setDialogTargetSessionId(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action danger-action"
                  aria-label="Delete current session"
                  disabled={sending}
                  onClick={() => void confirmDeleteSession()}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : null}
          {attachments.length ? (
            <div className="attachment-preview-row" aria-label="Attached files">
              {attachments.map((file) => (
                <span className="attachment-preview-card" key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <Paperclip aria-hidden="true" size={14} />
                  <span className="attachment-preview-copy">
                    <strong>{file.name}</strong>
                    <small>{file.type || 'file'} · {Math.ceil(file.size / 1024) || 1} KB</small>
                  </span>
                  <button aria-label={`Remove ${file.name}`} type="button" onClick={() => removeAttachment(file)}>
                    <X aria-hidden="true" size={13} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="composer-bottom-row">
            <div className="composer-left-actions">
              <button
                aria-expanded={activeComposerPopover === 'attachments'}
                aria-label="Attach files"
                className="attachment-control composer-icon-button"
                title="Attach files"
                type="button"
                onClick={() => setActiveComposerPopover((value) => (value === 'attachments' ? null : 'attachments'))}
              >
                <Plus aria-hidden="true" size={17} />
              </button>
              <input
                ref={fileInputRef}
                aria-label="Native file picker"
                className="composer-file-input"
                multiple
                type="file"
                onChange={handleAttachmentChange}
              />
              <span className="composer-model-label" aria-label="Current model">
                {currentModelName}
              </span>
            </div>
            <div className="composer-actions">
              {budget ? <ContextBudgetDonut budget={budget} /> : null}
              <PendingButton
                aria-label={t('chat.sendMessage')}
                className="send-preview-button composer-send-button"
                disabled={noUsableClient || (!message.trim() && attachments.length === 0) || sending}
                aria-disabled={noUsableClient}
                pending={sending}
                type="submit"
              >
                {sending ? <LoaderCircle aria-hidden="true" className="spinning-status" size={17} /> : <ArrowUp aria-hidden="true" size={18} />}
              </PendingButton>
            </div>
          </div>
        </form>
      </main>
      <ChatRightRail inventory={skillInventory} currentWorkspace={selectedSession?.currentWorkspace} />
    </section>
  );
}
