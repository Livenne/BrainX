import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  GitCompare,
  HelpCircle,
  LoaderCircle,
  Paperclip,
  PenLine,
  Search,
  SendHorizontal,
  Square,
  Terminal
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageSkeleton, PendingButton } from '../components/LoadingStates';
import type { ChatMessage, ChatSession, OpenAiToolCall, RunStatus, ToolState } from '../domain/types';
import {
  approveToolRequest,
  getChatSession as getRealChatSession,
  pollChatSession,
  rejectToolRequest,
  sendChatCommand as sendRealChatCommand,
  sendChatMessage as sendRealChatMessage
} from '../services/brainxApi';
import { getChatSessions as getMockChatSessions, sendChatMessage as sendMockChatMessage } from '../services/mockApi';
import { useAuth } from '../state/auth';
import './pages.css';
import './ChatPreviewPage.css';

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
};

type TimelineItem = TextTimelineItem | ToolTimelineItem;

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
    buildSummary: () => '无'
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
  search_workspace: {
    nickname: 'Explore',
    icon: Search,
    renderMode: 'info',
    buildSummary: (args) => firstString(args.query) ?? 'workspace'
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

async function loadChatSessions(workspaceId: string): Promise<ChatSession[]> {
  if (useMockChatApi) {
    return getMockChatSessions(workspaceId);
  }
  return [await getRealChatSession(workspaceId)];
}

async function submitChatMessage(workspaceId: string, sessionId: string, content: string): Promise<ChatSession> {
  if (useMockChatApi) {
    return sendMockChatMessage(sessionId, content);
  }
  return sendRealChatMessage(workspaceId, content);
}

async function submitChatCommand(workspaceId: string, command: string, args: Record<string, unknown>): Promise<ChatSession> {
  if (useMockChatApi) {
    return getMockChatSessions(workspaceId).then((sessions) => sessions[0]);
  }
  return sendRealChatCommand(workspaceId, command, args);
}

const slashCommands = [
  { command: 'clear', label: '/clear', description: 'Clear conversation context' },
  { command: 'compact', label: '/compact', description: 'Compress older context' },
  { command: 'model', label: '/model', description: 'Select active model' }
];

function parseSlashCommand(input: string, session?: ChatSession): { command: string; args: Record<string, unknown> } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [rawCommand, ...rest] = trimmed.slice(1).split(/\s+/);
  const command = rawCommand.toLowerCase();
  if (command === 'model') {
    const modelName = rest.join(' ').trim() || session?.activeModelName || session?.availableModels?.[0]?.name || '';
    return { command, args: { modelName } };
  }
  return { command, args: {} };
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
  return parseJsonObject(call.function.arguments) ?? {};
}

function firstString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function firstMeaningfulArg(args: Record<string, unknown>) {
  for (const value of Object.values(args)) {
    const text = firstString(value);
    if (text) return text;
  }
  return null;
}

function firstQuestion(args: Record<string, unknown>) {
  const questions = Array.isArray(args.questions) ? args.questions : [];
  const first = questions.find(isRecord);
  return firstString(first?.question) ?? null;
}

function firstChangedFile(result?: Record<string, unknown> | null) {
  const changedFiles = Array.isArray(result?.changedFiles) ? result?.changedFiles : [];
  return firstString(changedFiles[0]);
}

function firstPatchPath(patch: string) {
  return patch.match(/\+\+\+ b\/([^\n]+)/)?.[1] ?? patch.match(/\*\*\* Update File: ([^\n]+)/)?.[1] ?? null;
}

function statusIcon(status: ToolState['status']) {
  if (status === 'completed') return CheckCircle2;
  if (status === 'running') return LoaderCircle;
  if (status === 'failed') return AlertCircle;
  return Clock;
}

function toolStatus(item: ToolTimelineItem): ToolState['status'] {
  return item.state?.status ?? (item.resultMessage ? 'completed' : 'running');
}

function resultMessagesByCallId(messages: ChatMessage[]) {
  const results = new Map<string, Extract<ChatMessage, { role: 'tool' }>>();
  for (const message of messages) {
    if (message.role === 'tool') {
      results.set(message.tool_call_id, message);
    }
  }
  return results;
}

function buildTimeline(messages: ChatMessage[], toolStates: Record<string, ToolState>): TimelineItem[] {
  const results = resultMessagesByCallId(messages);
  const timeline: TimelineItem[] = [];

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'tool') {
      continue;
    }
    if (message.role === 'user') {
      timeline.push({ type: 'text', role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      if (message.content?.trim()) {
        timeline.push({ type: 'text', role: 'assistant', content: message.content });
      }
      for (const call of message.tool_calls ?? []) {
        const funcName = call.function.name;
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
    }
  }

  return timeline;
}

function ToolCallItem({
  item,
  pendingInteraction,
  onApprove,
  onReject
}: {
  item: ToolTimelineItem;
  pendingInteraction: string | null;
  onApprove: (item: ToolTimelineItem) => void;
  onReject: (item: ToolTimelineItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = toolStatus(item);
  const StatusIcon = statusIcon(status);
  const HeaderIcon = status === 'completed' ? item.spec.icon : StatusIcon;
  const summary = item.spec.buildSummary(item.args, item.result);
  const executionId = item.state?.executionId;
  const isPending = executionId ? pendingInteraction?.endsWith(executionId) : false;

  return (
    <article className="timeline-message assistant-message">
      <div className="tool-disclosure" data-status={status}>
        <button
          aria-expanded={expanded}
          aria-label={`${item.spec.nickname} ${summary}`}
          className="tool-disclosure-trigger"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="tool-icon-slot" aria-hidden="true" data-status={status} data-tool={item.funcName}>
            <HeaderIcon className={status === 'running' ? 'spinning-status' : undefined} size={16} />
          </span>
          <span className="tool-header-copy">
            <span className="tool-header-action">{item.spec.nickname}</span>
            <span className="tool-header-detail">{summary}</span>
          </span>
          <ChevronDown aria-hidden="true" className="tool-disclosure-chevron" size={15} />
        </button>
        {expanded ? (
          <div className="tool-detail-panel" role="region" aria-label={`${item.funcName} details`}>
            <ToolDetails item={item} />
            {status === 'waiting' && executionId ? (
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

function ToolDetails({ item }: { item: ToolTimelineItem }) {
  if (item.spec.renderMode === 'file') {
    return <FileDetails result={item.result} args={item.args} />;
  }
  if (item.spec.renderMode === 'diff') {
    return <DiffDetails result={item.result} args={item.args} />;
  }
  if (item.spec.renderMode === 'info') {
    return <InfoDetails result={item.result} args={item.args} />;
  }
  return <JsonDetails value={item.result ?? item.args} />;
}

function FileDetails({ result, args }: { result: Record<string, unknown> | null; args: Record<string, unknown> }) {
  const files = Array.isArray(result?.files) ? result.files : Array.isArray(args.files) ? args.files : [];
  return (
    <div className="tool-detail-stack">
      {files.map((file, index) => {
        const record = isRecord(file) ? file : {};
        const path = firstString(record.path) ?? `file-${index + 1}`;
        const content = firstString(record.content) ?? firstString(record.summary) ?? firstString(record.error) ?? '';
        return (
          <section className="file-render-block" key={`${path}-${index}`}>
            <div className="file-render-title">{path}</div>
            <pre className="preview-code-lines command-output-lines">
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
  const diff = firstString(result?.diff) ?? firstString(args.patch) ?? JSON.stringify(result ?? args, null, 2);
  return (
    <pre className="preview-code-lines command-output-lines">
      {diff.split('\n').map((line, index) => (
        <code key={index}>{line}</code>
      ))}
    </pre>
  );
}

function InfoDetails({ result, args }: { result: Record<string, unknown> | null; args: Record<string, unknown> }) {
  const source = result ?? args;
  const stdout = firstString(source.stdout);
  const stderr = firstString(source.stderr);
  if (stdout || stderr) {
    return (
      <pre className="preview-code-lines command-output-lines">
        {[stdout, stderr].filter(Boolean).join('\n').split('\n').map((line, index) => (
          <code key={index}>{line}</code>
        ))}
      </pre>
    );
  }

  if (Array.isArray(source.matches)) {
    return <ResultList items={source.matches} />;
  }

  if (Array.isArray(source.results)) {
    return <ResultList items={source.results} />;
  }

  return <KeyValueDetails value={source} />;
}

function ResultList({ items }: { items: unknown[] }) {
  return (
    <div className="tool-detail-stack">
      {items.map((item, index) => {
        const record = isRecord(item) ? item : {};
        const title = firstString(record.title) ?? firstString(record.path) ?? `result-${index + 1}`;
        const detail = firstString(record.snippet) ?? firstString(record.preview) ?? firstString(record.url) ?? '';
        return (
          <div className="tool-result-summary" key={`${title}-${index}`}>
            <strong>{title}</strong>
            {detail ? <span>{detail}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function KeyValueDetails({ value }: { value: Record<string, unknown> }) {
  const rows = Object.entries(flattenInfo(value));
  return (
    <dl className="environment-detail-grid">
      {rows.map(([key, detail]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{String(detail)}</dd>
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

function TextMessage({ item }: { item: TextTimelineItem }) {
  return (
    <article className={`timeline-message ${item.role}-message`}>
      <div className="timeline-card markdown-card">
        {item.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown> : <p>{item.content}</p>}
      </div>
    </article>
  );
}

export function ChatPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const { workspaceId = 'w_core' } = useParams();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('chat_main');
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sending, setSending] = useState(false);
  const [pendingInteraction, setPendingInteraction] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const streamRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingSessions(true);
    loadChatSessions(workspaceId)
      .then((result) => {
        if (!active) return;
        setSessions(result);
        setSelectedSessionId(result[0]?.id ?? 'chat_main');
      })
      .catch((caught) => {
        if (active) setChatError(caught instanceof Error ? caught.message : 'Failed to load chat');
      })
      .finally(() => {
        if (active) setLoadingSessions(false);
      });

    return () => {
      active = false;
    };
  }, [workspaceId]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0],
    [selectedSessionId, sessions]
  );

  useEffect(() => {
    if (useMockChatApi || !selectedSession || !activeRunStatuses.has(selectedSession.runStatus)) {
      return undefined;
    }

    let active = true;
    const timer = globalThis.setInterval(() => {
      pollChatSession(workspaceId)
        .then((updated) => {
          if (!active) return;
          replaceSession(updated);
        })
        .catch((caught) => {
          if (active) setChatError(caught instanceof Error ? caught.message : 'Failed to poll chat');
        });
    }, 1200);

    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [selectedSession?.id, selectedSession?.runStatus, workspaceId]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    if (typeof stream.scrollTo === 'function') {
      stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' });
      return;
    }
    stream.scrollTop = stream.scrollHeight;
  }, [selectedSession?.id, selectedSession?.messages.length]);

  function replaceSession(updated: ChatSession) {
    setSessions((current) =>
      current.some((session) => session.id === updated.id)
        ? current.map((session) => (session.id === updated.id ? updated : session))
        : [updated, ...current]
    );
  }

  async function handleSend() {
    if (!selectedSession || !message.trim() || sending) return;

    const content = message.trim();
    const slashCommand = parseSlashCommand(content, selectedSession);
    if (slashCommand) {
      setMessage('');
      setSending(true);
      setChatError(null);
      try {
        replaceSession(await submitChatCommand(workspaceId, slashCommand.command, slashCommand.args));
      } catch (caught) {
        setChatError(caught instanceof Error ? caught.message : 'Failed to run command');
        setMessage(content);
      } finally {
        setSending(false);
      }
      return;
    }

    const optimisticSession: ChatSession = {
      ...selectedSession,
      updatedAt: new Date().toISOString(),
      messages: [...selectedSession.messages, { role: 'user', content }]
    };

    replaceSession(optimisticSession);
    setMessage('');
    setSending(true);
    setChatError(null);

    try {
      replaceSession(await submitChatMessage(workspaceId, selectedSession.id, content));
    } catch (caught) {
      setChatError(caught instanceof Error ? caught.message : 'Failed to send message');
      replaceSession(selectedSession);
      setMessage(content);
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
      setChatError(caught instanceof Error ? caught.message : 'Failed to approve tool request');
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
      setChatError(caught instanceof Error ? caught.message : 'Failed to reject tool request');
    } finally {
      setPendingInteraction(null);
    }
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    setAttachments(Array.from(event.target.files ?? []));
  }

  if (loadingSessions && !chatError) {
    return <PageSkeleton label={t('chat.loading')} />;
  }

  const timeline = selectedSession ? buildTimeline(selectedSession.messages, selectedSession.toolStates ?? {}) : [];
  const commandQuery = message.trim().startsWith('/') ? message.trim().slice(1).toLowerCase() : '';
  const commandSuggestions = commandQuery
    ? slashCommands.filter((item) => item.command.startsWith(commandQuery.split(/\s+/)[0] ?? ''))
    : [];
  const budget = selectedSession?.contextBudget;
  const activeModel = selectedSession?.activeModelName ?? selectedSession?.availableModels?.[0]?.name ?? 'nvidia-step';

  return (
    <section className="chat-preview-page chat-page-live">
      {chatError ? <div role="alert">{chatError}</div> : null}
      <main className="low-density-chat" aria-label="Timeline workspace">
        <section className="agent-loop-timeline timeline-scroll-region" role="log" aria-label="Agent loop timeline" ref={streamRef}>
          {timeline.length ? (
            timeline.map((item, index) =>
              item.type === 'text' ? (
                <TextMessage item={item} key={`${item.role}-${index}`} />
              ) : (
                <ToolCallItem
                  item={item}
                  key={item.call.id}
                  pendingInteraction={pendingInteraction}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              )
            )
          ) : (
            <article className="timeline-message assistant-message">
              <div className="timeline-card">
                <p>{selectedSession ? 'Start a new brainx run from the composer.' : 'No chat session is available.'}</p>
              </div>
            </article>
          )}
        </section>
        <form
          aria-label="Message composer"
          className="preview-composer composer-dock-sticky"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend();
          }}
        >
          <textarea
            aria-label={t('chat.messageBrainx')}
            value={message}
            placeholder={t('chat.messagePlaceholder')}
            onChange={(event) => setMessage(event.target.value)}
          />
          {message.trim().startsWith('/') ? (
            <div className="slash-command-popover" role="listbox" aria-label="Chat commands">
              {(commandSuggestions.length ? commandSuggestions : slashCommands).map((item) => (
                <button
                  key={item.command}
                  type="button"
                  onClick={() => setMessage(item.command === 'model' ? `/model ${activeModel}` : item.label)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
          ) : null}
          {attachments.length ? (
            <div className="attachment-preview-row" aria-label="Attached files">
              {attachments.map((file) => (
                <span key={`${file.name}-${file.size}`}>{file.name}</span>
              ))}
            </div>
          ) : null}
          <div className="composer-bottom-row">
            <div className="composer-left-actions">
              <label className="attachment-control" title="Attach files">
                <Paperclip aria-hidden="true" size={16} />
                <input aria-label="Attach files" multiple type="file" onChange={handleAttachmentChange} />
              </label>
              <span className="composer-context-pill">model {activeModel}</span>
              {budget ? (
                <span className="composer-context-pill">
                  context {budget.estimatedTokens}/{budget.maxTokens}
                </span>
              ) : null}
            </div>
            <div className="composer-actions">
              <PendingButton className="send-preview-button" disabled={!message.trim() || sending} pending={sending} type="submit">
                <SendHorizontal aria-hidden="true" size={15} />
                {t('chat.sendMessage')}
              </PendingButton>
            </div>
          </div>
        </form>
      </main>
    </section>
  );
}
