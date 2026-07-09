import { useState, type ChangeEvent } from 'react';
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
  ListChecks,
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
import type { RiskTier } from '../domain/types';
import './ChatPreviewPage.css';

type ScenarioKind = 'default' | 'all' | 'explore' | 'patch' | 'command' | 'ask_user' | 'failure';
type ToolKind =
  | 'get_environment'
  | 'read_files'
  | 'search_workspace'
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
  | 'subagent_stop';
type ToolStatus = 'queued' | 'running' | 'completed' | 'failed' | 'waiting_for_approval' | 'waiting_for_user';
type ComposerMode = 'Ask' | 'Plan' | 'Agent';

type ToolResult = {
  ok: boolean;
  summary: string;
  durationMs: number;
  data: Record<string, unknown>;
  warnings: string[];
  error: { code: string; message: string } | null;
};

type ToolSample = {
  id: string;
  kind: ToolKind;
  title: string;
  target: string;
  riskTier: RiskTier;
  status: ToolStatus;
  summary: string;
  arguments: Record<string, unknown>;
  result: ToolResult;
};

const toolIcons: Record<ToolKind, LucideIcon> = {
  get_environment: Terminal,
  read_files: FileText,
  search_workspace: Search,
  apply_patch: GitCompare,
  write_file: PenLine,
  run_command: Terminal,
  ask_user: HelpCircle,
  todo_update: ListChecks,
  background_start: Terminal,
  background_read: Terminal,
  background_stop: Square,
  subagent_start: Bot,
  subagent_read: Bot,
  subagent_stop: Square
};

const scenarioButtons: Array<{ kind: ScenarioKind; label: string }> = [
  { kind: 'all', label: 'All tools scenario' },
  { kind: 'explore', label: 'Explore workspace scenario' },
  { kind: 'patch', label: 'Patch approval scenario' },
  { kind: 'command', label: 'Run command scenario' },
  { kind: 'ask_user', label: 'Ask user scenario' },
  { kind: 'failure', label: 'Failure case scenario' }
];

const markdownSample = `# Implementation plan

- Use structured tool renderers
- Keep preview isolated from live Chat
- pnpm is not required for this workspace

\`\`\`bash
npm test -- src/__tests__/chatPreview.test.tsx
\`\`\``;

export const chatPreviewToolSamples: ToolSample[] = [
  {
    id: 'tool_environment',
    kind: 'get_environment',
    title: 'Read current execution environment',
    target: '/home/Livenne/code/brainx',
    riskTier: 'read',
    status: 'completed',
    summary: 'Returned OS, architecture, shell, workspace root, current model, date, and timezone.',
    arguments: {},
    result: {
      ok: true,
      summary: 'Environment snapshot is ready.',
      durationMs: 18,
      data: {
        os: 'Ubuntu 24.04 / WSL',
        arch: 'x86_64',
        workspaceRoot: '/home/Livenne/code/brainx',
        defaultShell: 'bash',
        dateTime: {
          iso: '2026-07-07T01:30:00+08:00',
          timezone: 'Asia/Shanghai',
          utcOffset: '+08:00'
        },
        model: {
          name: 'meta/llama-3.1-8b-instruct'
        }
      },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_read_files',
    kind: 'read_files',
    title: 'Read renderer contracts',
    target: 'ChatPage.tsx, types.ts, browser-design-system.md',
    riskTier: 'read',
    status: 'completed',
    summary: 'Collected message block types, tool kinds, and design constraints.',
    arguments: {
      files: [
        { path: 'apps/browser/src/pages/ChatPage.tsx', startLine: 1, endLine: 220 },
        { path: 'apps/browser/src/domain/types.ts', startLine: 1, endLine: 120 },
        { path: 'docs/brainx/browser-design-system.md', startLine: 1, endLine: 120 }
      ]
    },
    result: {
      ok: true,
      summary: 'All requested files were readable.',
      durationMs: 41,
      data: {
        files: [
          {
            ok: true,
            path: 'apps/browser/src/pages/ChatPage.tsx',
            content: ['function ToolCallBlock({ block, handlers }) {', '  return <article className="tool-call-card">', '}'].join('\n'),
            startLine: 1,
            endLine: 220,
            totalLines: 420
          },
          {
            ok: true,
            path: 'apps/browser/src/domain/types.ts',
            content: 'export type ToolCallBlock = {\n  type: "tool_call";\n  call: ToolCallRecord;\n};',
            startLine: 1,
            endLine: 120,
            totalLines: 216
          },
          {
            ok: true,
            path: 'docs/brainx/browser-design-system.md',
            content: '## Motion\nUse calm transitions for state changes and avoid decorative noise.',
            startLine: 1,
            endLine: 120,
            totalLines: 312
          }
        ]
      },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_search',
    kind: 'search_workspace',
    title: 'Search current tool rendering',
    target: 'tool_call in apps/browser/src',
    riskTier: 'read',
    status: 'completed',
    summary: 'Found tool call renderers and tests that mention tool_call.',
    arguments: { query: 'tool_call', mode: 'text', maxResults: 20 },
    result: {
      ok: true,
      summary: 'Search returned matching source lines.',
      durationMs: 34,
      data: {
        matches: [
          { path: 'apps/browser/src/domain/types.ts', line: 74, preview: 'type: "tool_call";' },
          { path: 'apps/browser/src/pages/ChatPage.tsx', line: 182, preview: 'if (block.type === "tool_call") return <ToolCallBlock block={block} />;' }
        ]
      },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_patch',
    kind: 'apply_patch',
    title: 'Prepare Chat preview page',
    target: 'apps/browser/src/pages/ChatPreviewPage.tsx',
    riskTier: 'write',
    status: 'waiting_for_approval',
    summary: 'Patch is staged for approval because it creates a new browser route and renderer surface.',
    arguments: {
      patch: [
        '*** Begin Patch',
        '*** Update File: apps/browser/src/pages/ChatPreviewPage.tsx',
        '@@',
        '+ <AgentLoopTimeline />',
        '*** End Patch'
      ].join('\n'),
      dryRun: true
    },
    result: {
      ok: true,
      summary: 'Approval pending before applying the patch.',
      durationMs: 0,
      data: {
        applied: false,
        changedFiles: ['apps/browser/src/pages/ChatPreviewPage.tsx'],
        diff: ['*** Begin Patch', '*** Update File: apps/browser/src/pages/ChatPreviewPage.tsx', '+ <AgentLoopTimeline />', '*** End Patch']
      },
      warnings: ['Write-tier changes require browser approval in default policy.'],
      error: null
    }
  },
  {
    id: 'tool_write',
    kind: 'write_file',
    title: 'Write preview stylesheet',
    target: 'apps/browser/src/pages/ChatPreviewPage.css',
    riskTier: 'write',
    status: 'queued',
    summary: 'Stylesheet write is queued behind the approved patch operation.',
    arguments: {
      path: 'apps/browser/src/pages/ChatPreviewPage.css',
      content: '.chat-preview-page {\n  display: grid;\n  min-height: 0;\n}',
      overwrite: true,
      createParents: true
    },
    result: {
      ok: true,
      summary: 'Ready to write after approval.',
      durationMs: 0,
      data: { path: 'apps/browser/src/pages/ChatPreviewPage.css', bytesWritten: 56, overwritten: true },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_command',
    kind: 'run_command',
    title: 'Run focused preview tests',
    target: 'npm test -- src/__tests__/chatPreview.test.tsx',
    riskTier: 'execute',
    status: 'running',
    summary: 'Focused Vitest run is streaming output from the browser workspace.',
    arguments: {
      command: 'npm test -- src/__tests__/chatPreview.test.tsx',
      workingDirectory: 'apps/browser',
      timeoutSeconds: 120
    },
    result: {
      ok: true,
      summary: 'Test process is still running.',
      durationMs: 1480,
      data: {
        stdout: ['RUN  v3.2.6 /home/Livenne/code/brainx/apps/browser', 'src/__tests__/chatPreview.test.tsx'],
        stderr: []
      },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_ask_user',
    kind: 'ask_user',
    title: 'Confirm preview direction',
    target: 'Chat redesign direction',
    riskTier: 'read',
    status: 'waiting_for_user',
    summary: 'Waiting for the browser user to confirm the preferred design direction.',
    arguments: {
      questions: [
        {
          id: 'direction',
          question: 'Which Chat structure should become the production direction?',
          options: [
            {
              id: 'timeline',
              label: 'Timeline canvas',
              description: 'Keep the main pane calm and reveal details on demand.',
              recommended: true
            },
            {
              id: 'workbench',
              label: 'Three-column workbench',
              description: 'Show surrounding context persistently.'
            }
          ],
          allowOther: true
        }
      ]
    },
    result: {
      ok: true,
      summary: 'No answer was submitted before timeout.',
      durationMs: 300000,
      data: { answerStatus: 'unanswered' },
      warnings: ['Timeout result is written back as unanswered.'],
      error: null
    }
  },
  {
    id: 'tool_todo_update',
    kind: 'todo_update',
    title: 'Update run todo list',
    target: 'current run checklist',
    riskTier: 'read',
    status: 'completed',
    summary: 'Updated the server-side checklist for the current run.',
    arguments: {
      items: [
        { id: 't1', title: 'Inspect schemas', status: 'completed', note: 'done' },
        { id: 't2', title: 'Implement runtime', status: 'in_progress' }
      ],
      reason: 'after schema review'
    },
    result: {
      ok: true,
      summary: 'Todo list updated.',
      durationMs: 7,
      data: {
        items: [
          { id: 't1', title: 'Inspect schemas', status: 'completed', note: 'done' },
          { id: 't2', title: 'Implement runtime', status: 'in_progress' }
        ]
      },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_background_start',
    kind: 'background_start',
    title: 'Start browser dev server',
    target: 'npm run dev',
    riskTier: 'execute',
    status: 'waiting_for_approval',
    summary: 'Requests a long-running local process for manual review.',
    arguments: {
      name: 'browser-dev-server',
      command: 'npm run dev -- --port 5173',
      workingDirectory: 'apps/browser',
      maxRuntimeSeconds: 14400,
      purpose: 'manual review'
    },
    result: {
      ok: true,
      summary: 'Background task started.',
      durationMs: 22,
      data: { taskId: 'bg_1', status: 'running', pid: 42137, startedAt: '1783362000000', cursor: 0 },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_background_read',
    kind: 'background_read',
    title: 'Read browser dev server output',
    target: 'bg_1',
    riskTier: 'read',
    status: 'completed',
    summary: 'Read buffered output from the background task.',
    arguments: { taskId: 'bg_1', cursor: 0, maxBytes: 12000 },
    result: {
      ok: true,
      summary: 'Background output read.',
      durationMs: 12,
      data: {
        taskId: 'bg_1',
        status: 'running',
        chunks: [{ cursor: 1, stream: 'stdout', text: 'Local: http://localhost:5173/', timestamp: '1783362000100' }],
        nextCursor: 1,
        truncated: false
      },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_background_stop',
    kind: 'background_stop',
    title: 'Stop browser dev server',
    target: 'bg_1',
    riskTier: 'execute',
    status: 'completed',
    summary: 'Stopped the background task when review finished.',
    arguments: { taskId: 'bg_1', mode: 'terminate' },
    result: {
      ok: true,
      summary: 'Background task stopped.',
      durationMs: 18,
      data: { taskId: 'bg_1', status: 'stopped', stoppedAt: '1783362060000' },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_subagent_start',
    kind: 'subagent_start',
    title: 'Start focused review subagent',
    target: 'review stale tool names',
    riskTier: 'read',
    status: 'completed',
    summary: 'Created a bounded server-side subagent task.',
    arguments: {
      task: 'Review stale tool names',
      context: 'read_files is the canonical file read tool',
      allowedTools: ['get_environment', 'read_files', 'search_workspace'],
      allowedPaths: ['apps/browser/**', 'docs/brainx/**'],
      writeAccess: false,
      budget: { maxTurns: 8, maxMinutes: 10 },
      successCriteria: ['return exact file references'],
      outputSchema: 'summary_evidence_risks'
    },
    result: {
      ok: true,
      summary: 'Subagent started.',
      durationMs: 10,
      data: { subagentId: 'sub_1', status: 'running' },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_subagent_read',
    kind: 'subagent_read',
    title: 'Read focused review subagent',
    target: 'sub_1',
    riskTier: 'read',
    status: 'completed',
    summary: 'Read current subagent status and summary.',
    arguments: { subagentId: 'sub_1', includeEvents: false },
    result: {
      ok: true,
      summary: 'Subagent status read.',
      durationMs: 8,
      data: { subagentId: 'sub_1', status: 'running', summary: 'Review task is queued in v1 state.' },
      warnings: [],
      error: null
    }
  },
  {
    id: 'tool_subagent_stop',
    kind: 'subagent_stop',
    title: 'Cancel focused review subagent',
    target: 'sub_1',
    riskTier: 'read',
    status: 'completed',
    summary: 'Cancelled the server-side subagent task.',
    arguments: { subagentId: 'sub_1', reason: 'Parent task changed direction.' },
    result: {
      ok: true,
      summary: 'Subagent cancelled.',
      durationMs: 6,
      data: { subagentId: 'sub_1', status: 'cancelled', reason: 'Parent task changed direction.' },
      warnings: [],
      error: null
    }
  }
];

const toolByKind = chatPreviewToolSamples.reduce(
  (acc, tool) => {
    acc[tool.kind] = tool;
    return acc;
  },
  {} as Record<ToolKind, ToolSample>
);

const failedSearchTool: ToolSample = {
  ...toolByKind.search_workspace,
  id: 'tool_search_failure',
  status: 'failed',
  summary: 'Search failed because the requested regex was malformed; plain text mode is available.',
  arguments: { query: 'tool_call(', mode: 'regex', maxResults: 20 },
  result: {
    ok: false,
    summary: 'Regex parse failed before workspace scan.',
    durationMs: 9,
    data: {},
    warnings: ['Use mode="text" when the query is not a valid regular expression.'],
    error: { code: 'invalid_regex', message: 'Unclosed group near character 10.' }
  }
};

const completedCommandTool: ToolSample = {
  ...toolByKind.run_command,
  status: 'completed',
  summary: 'Focused preview tests completed and returned stdout to the conversation.',
  result: {
    ...toolByKind.run_command.result,
    summary: 'Focused preview tests completed successfully.',
    durationMs: 3210,
    data: {
      stdout: [
        'RUN  v3.2.6 /home/Livenne/code/brainx/apps/browser',
        'src/__tests__/chatPreview.test.tsx',
        'Test Files  1 passed'
      ],
      stderr: []
    }
  }
};

function statusIcon(status: ToolStatus) {
  if (status === 'completed') return CheckCircle2;
  if (status === 'running') return LoaderCircle;
  if (status === 'failed') return AlertCircle;
  return Clock;
}

function firstString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function fileCountLabel(value: unknown) {
  return countLabel(value, 'file', 'files');
}

function countLabel(value: unknown, singular: string, plural: string) {
  if (!Array.isArray(value)) return null;
  return `${value.length} ${value.length === 1 ? singular : plural}`;
}

function firstPathFromFiles(value: unknown) {
  if (!Array.isArray(value)) return null;
  const first = value.find((item) => {
    if (typeof item === 'string') return item.length > 0;
    return isRecord(item) && typeof item.path === 'string' && item.path.length > 0;
  });
  if (typeof first === 'string') return first;
  return isRecord(first) && typeof first.path === 'string' ? first.path : null;
}

function firstAskUserQuestion(tool: ToolSample) {
  const questions = Array.isArray(tool.arguments.questions) ? tool.arguments.questions : [];
  const question = questions.find(isRecord);
  return question && typeof question.question === 'string' ? question.question : null;
}

function getToolHeader(tool: ToolSample) {
  if (tool.kind === 'read_files') {
    return {
      action: 'Read files',
      detail: fileCountLabel(tool.arguments.files) ?? tool.target
    };
  }

  if (tool.kind === 'search_workspace') {
    return {
      action: 'Search',
      detail: firstString(tool.arguments.query) ?? tool.target
    };
  }

  if (tool.kind === 'apply_patch') {
    return {
      action: 'Patch',
      detail: firstPathFromFiles(tool.result.data.changedFiles) ?? tool.target
    };
  }

  if (tool.kind === 'write_file') {
    return {
      action: 'Write',
      detail: firstString(tool.arguments.path) ?? tool.target
    };
  }

  if (tool.kind === 'run_command') {
    return {
      action: 'Run',
      detail: firstString(tool.arguments.command) ?? tool.target
    };
  }

  if (tool.kind === 'ask_user') {
    return {
      action: 'Ask user',
      detail: firstAskUserQuestion(tool) ?? tool.target
    };
  }

  if (tool.kind === 'todo_update') {
    return {
      action: 'Todo',
      detail: countLabel(tool.arguments.items, 'item', 'items') ?? tool.target
    };
  }

  if (tool.kind === 'background_start') {
    return {
      action: 'Background',
      detail: firstString(tool.arguments.command) ?? tool.target
    };
  }

  if (tool.kind === 'background_read') {
    return {
      action: 'Read background',
      detail: firstString(tool.arguments.taskId) ?? tool.target
    };
  }

  if (tool.kind === 'background_stop') {
    return {
      action: 'Stop background',
      detail: firstString(tool.arguments.taskId) ?? tool.target
    };
  }

  if (tool.kind === 'subagent_start') {
    return {
      action: 'Subagent',
      detail: firstString(tool.arguments.task) ?? tool.target
    };
  }

  if (tool.kind === 'subagent_read') {
    return {
      action: 'Read subagent',
      detail: firstString(tool.arguments.subagentId) ?? tool.target
    };
  }

  if (tool.kind === 'subagent_stop') {
    return {
      action: 'Stop subagent',
      detail: firstString(tool.arguments.subagentId) ?? tool.target
    };
  }

  return {
    action: 'Environment',
    detail: firstString(tool.result.data.workspaceRoot) ?? tool.target
  };
}

function KeyValueOutput({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="tool-key-values">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ContextSnapshotBubble() {
  return (
    <article className="timeline-message assistant-message">
      <div className="timeline-card context-snapshot-card">
        <div className="timeline-meta">
          <strong>Context snapshot</strong>
          <time dateTime="2026-07-06T21:29:10+08:00">21:29</time>
        </div>
        <div className="context-snapshot-list" aria-label="Context snapshot values">
          <span>workspace-core</span>
          <span>mainline</span>
          <span>brainx-client-local</span>
          <span>primary/example-chat-model</span>
        </div>
      </div>
    </article>
  );
}

function ToolDisclosure({ tool }: { tool: ToolSample }) {
  const [expanded, setExpanded] = useState(false);
  const ToolIcon = toolIcons[tool.kind];
  const StatusIcon = statusIcon(tool.status);
  const header = getToolHeader(tool);
  const HeaderIcon = tool.status === 'completed' ? ToolIcon : StatusIcon;
  const isBusy = tool.status === 'running';
  const ariaLabel = `${header.action} ${header.detail}`;

  return (
    <article className="timeline-message assistant-message">
      <div className="tool-disclosure" data-status={tool.status}>
        <button
          aria-label={ariaLabel}
          aria-expanded={expanded}
          className="tool-disclosure-trigger"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          <span
            className="tool-icon-slot"
            aria-hidden="true"
            data-status={tool.status}
            data-testid="tool-icon-slot"
            data-tool={tool.kind}
          >
            <HeaderIcon className={isBusy ? 'spinning-status' : undefined} size={16} />
          </span>
          <span className="tool-header-copy">
            <span className="tool-header-action">{header.action}</span>
            <span className="tool-header-detail">{header.detail}</span>
          </span>
          <ChevronDown aria-hidden="true" className="tool-disclosure-chevron" size={15} />
        </button>
        {expanded ? (
          <div className="tool-detail-panel" role="region" aria-label={`${tool.kind} details`}>
            <ToolDetailRenderer tool={tool} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ToolDetailRenderer({ tool }: { tool: ToolSample }) {
  if (tool.kind === 'read_files') return <ReadFilesDetail tool={tool} />;
  if (tool.kind === 'search_workspace') return <SearchWorkspaceDetail tool={tool} />;
  if (tool.kind === 'apply_patch') return <PatchDetail tool={tool} />;
  if (tool.kind === 'write_file') return <WriteFileDetail tool={tool} />;
  if (tool.kind === 'run_command') return <CommandDetail tool={tool} />;
  if (tool.kind === 'ask_user') return <AskUserDetail tool={tool} />;
  return <EnvironmentDetail tool={tool} />;
}

function EnvironmentDetail({ tool }: { tool: ToolSample }) {
  const dateTime = isRecord(tool.result.data.dateTime) ? tool.result.data.dateTime : {};
  const model = isRecord(tool.result.data.model) ? tool.result.data.model : {};
  const rows = {
    os: tool.result.data.os,
    arch: tool.result.data.arch,
    workspaceRoot: tool.result.data.workspaceRoot,
    defaultShell: tool.result.data.defaultShell,
    model: model.name,
    dateTime: dateTime.iso,
    timezone: dateTime.timezone,
    utcOffset: dateTime.utcOffset
  };

  return (
    <div className="tool-detail-stack">
      <KeyValueOutput data={rows} />
    </div>
  );
}

function ReadFilesDetail({ tool }: { tool: ToolSample }) {
  const files = Array.isArray(tool.result.data.files) ? tool.result.data.files : [];
  return (
    <div className="tool-detail-stack">
      <div className="read-many-file-stack" aria-label="Read files">
        {files.map((file) => {
          if (!isRecord(file)) return null;
          const lines = firstString(file.content)?.split('\n') ?? [];
          return (
            <section className="file-preview" key={String(file.path)}>
              <div className="file-preview-head">
                <FileText aria-hidden="true" size={15} />
                <span>{String(file.path)}</span>
              </div>
              <pre className="preview-code-lines">
                {lines.map((line) => (
                  <code key={`${String(file.path)}-${line}`}>{line}</code>
                ))}
              </pre>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SearchWorkspaceDetail({ tool }: { tool: ToolSample }) {
  const matches = Array.isArray(tool.result.data.matches) ? tool.result.data.matches : [];
  return (
    <div className="tool-detail-stack">
      {tool.result.error ? (
        <div className="tool-error-strip">
          <AlertCircle aria-hidden="true" size={14} />
          <code>{tool.result.error.code}</code>
          <span>{tool.result.error.message}</span>
        </div>
      ) : matches.length ? (
        <ul className="plain-result-list search-result-list" aria-label="Search results">
          {matches.map((match) => {
            if (!isRecord(match)) return null;
            return (
              <li key={`${String(match.path)}-${String(match.line)}`}>
                <span>{String(match.path)}{match.line ? `:${String(match.line)}` : ''}</span>
                <code>{String(match.preview ?? '')}</code>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tool-result-summary">{tool.result.summary}</p>
      )}
      {tool.result.warnings.length ? (
        <ul className="tool-warning-list">
          {tool.result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PatchDetail({ tool }: { tool: ToolSample }) {
  return (
    <div className="tool-detail-stack">
      <DiffLines lines={tool.result.data.diff} />
    </div>
  );
}

function WriteFileDetail({ tool }: { tool: ToolSample }) {
  const path = String(tool.result.data.path ?? tool.arguments.path ?? tool.target);
  const content = firstString(tool.arguments.content)?.split('\n') ?? [];
  const diff = ['--- /dev/null', `+++ b/${path}`, '@@', ...content.map((line) => `+${line}`)];
  return (
    <div className="tool-detail-stack">
      <DiffLines lines={diff} label="File diff" />
    </div>
  );
}

function CommandDetail({ tool }: { tool: ToolSample }) {
  const stdout = Array.isArray(tool.result.data.stdout) ? tool.result.data.stdout.map(String) : [];
  const stderr = Array.isArray(tool.result.data.stderr) ? tool.result.data.stderr.map(String) : [];
  const output = stdout.length ? stdout : stderr.length ? stderr : [tool.result.error?.message ?? tool.result.summary];
  return (
    <div className="tool-detail-stack">
      <pre className="preview-code-lines command-output-lines">
        {output.map((line) => (
          <code key={line}>{line}</code>
        ))}
      </pre>
    </div>
  );
}

function AskUserDetail({ tool }: { tool: ToolSample }) {
  const questions = Array.isArray(tool.arguments.questions) ? tool.arguments.questions : [];
  const question = questions.find(isRecord);
  const options = extractAskUserOptions(tool);
  return (
    <div className="tool-detail-stack">
      <form className="ask-user-inspector">
        <p className="ask-user-question">{question && typeof question.question === 'string' ? question.question : tool.title}</p>
        <div className="ask-user-options">
          {options.map((option, index) => (
            <label key={option}>
              <input defaultChecked={index === 0} name="preview-direction" type="radio" />
              <span>{option}</span>
              {index === 0 ? <small>Recommended</small> : null}
            </label>
          ))}
          <label>
            <input name="preview-direction" type="radio" />
            Other
          </label>
        </div>
        <div className="ask-user-timeout">
          <Clock aria-hidden="true" size={14} />
          {String(tool.result.data.answerStatus ?? 'unanswered')}
        </div>
      </form>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractAskUserOptions(tool: ToolSample) {
  const questions = Array.isArray(tool.arguments.questions) ? tool.arguments.questions : [];
  return questions.flatMap((question: unknown) => {
    if (!isRecord(question) || !Array.isArray(question.options)) return [];
    return question.options
      .map((option: unknown) => (isRecord(option) && typeof option.label === 'string' ? option.label : null))
      .filter((label: string | null): label is string => Boolean(label));
  });
}

function ScenarioTimeline({ scenario }: { scenario: ScenarioKind }) {
  if (scenario === 'all') {
    return (
      <div className="scenario-timeline" data-scenario={scenario}>
        {chatPreviewToolSamples.map((tool) => (
          <ToolDisclosure key={tool.id} tool={tool} />
        ))}
      </div>
    );
  }

  if (scenario === 'explore') {
    return (
      <div className="scenario-timeline" data-scenario={scenario}>
        <ToolDisclosure tool={toolByKind.get_environment} />
        <ToolDisclosure tool={toolByKind.read_files} />
        <ToolDisclosure tool={toolByKind.search_workspace} />
      </div>
    );
  }

  if (scenario === 'patch') {
    return (
      <div className="scenario-timeline" data-scenario={scenario}>
        <ToolDisclosure tool={toolByKind.apply_patch} />
        <ToolDisclosure tool={toolByKind.write_file} />
      </div>
    );
  }

  if (scenario === 'command') {
    return (
      <div className="scenario-timeline" data-scenario={scenario}>
        <ToolDisclosure tool={completedCommandTool} />
      </div>
    );
  }

  if (scenario === 'ask_user') {
    return (
      <div className="scenario-timeline" data-scenario={scenario}>
        <ToolDisclosure tool={toolByKind.ask_user} />
      </div>
    );
  }

  if (scenario === 'failure') {
    return (
      <div className="scenario-timeline" data-scenario={scenario}>
        <ToolDisclosure tool={failedSearchTool} />
      </div>
    );
  }

  return null;
}

function AgentLoopTimeline({ scenario }: { scenario: ScenarioKind }) {
  return (
    <section className="agent-loop-timeline timeline-scroll-region" role="log" aria-label="Agent loop timeline">
      <article className="timeline-message user-message">
        <div className="timeline-card">
          <div className="timeline-meta">
            <strong>User</strong>
            <time dateTime="2026-07-06T21:28:00+08:00">21:28</time>
          </div>
          <p>Refactor Chat into a calmer preview with on-demand details.</p>
        </div>
      </article>
      <article className="timeline-message assistant-message">
        <div className="timeline-card markdown-card">
          <div className="timeline-meta">
            <strong>brainx</strong>
            <time dateTime="2026-07-06T21:29:00+08:00">21:29</time>
          </div>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownSample}</ReactMarkdown>
        </div>
      </article>
      <ContextSnapshotBubble />
      {scenario === 'all' ? null : <ToolDisclosure tool={toolByKind.read_files} />}
      {scenario === 'command' || scenario === 'all' ? null : <ToolDisclosure tool={toolByKind.run_command} />}
      <ScenarioTimeline key={scenario} scenario={scenario} />
    </section>
  );
}

function DiffLines({ lines, label = 'Patch diff' }: { lines: unknown; label?: string }) {
  const diffLines = Array.isArray(lines) ? lines.map(String) : [];
  return (
    <pre className="preview-code-lines diff-lines" aria-label={label}>
      {diffLines.map((line) => (
        <code data-line-kind={previewDiffLineKind(line)} key={line}>
          {line}
        </code>
      ))}
    </pre>
  );
}

function previewDiffLineKind(line: string) {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('***')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
}

function ReviewControls({
  open,
  scenario,
  onSelect,
  onToggle
}: {
  open: boolean;
  scenario: ScenarioKind;
  onSelect: (scenario: ScenarioKind) => void;
  onToggle: () => void;
}) {
  return (
    <aside className="review-controls-shell" aria-label="Chat preview review controls" data-open={open}>
      <button aria-expanded={open} aria-label="Toggle review controls" className="review-controls-toggle" type="button" onClick={onToggle}>
        Review controls
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open ? (
        <div className="review-controls-panel" role="region" aria-label="Review controls">
          <nav className="scenario-controls" aria-label="Tool scenario playback">
            {scenarioButtons.map((item) => (
              <button
                aria-label={item.label}
                aria-pressed={scenario === item.kind}
                className="scenario-button"
                key={item.kind}
                type="button"
                onClick={() => onSelect(item.kind)}
              >
                {item.label.replace(' scenario', '')}
              </button>
            ))}
          </nav>
        </div>
      ) : null}
    </aside>
  );
}

function ComposerDock() {
  const [mode, setMode] = useState<ComposerMode>('Ask');
  const [files, setFiles] = useState<string[]>([]);
  const modes: ComposerMode[] = ['Ask', 'Plan', 'Agent'];

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []).map((file) => file.name));
  }

  return (
    <form className="preview-composer composer-dock-sticky" aria-label="Preview message composer">
      <textarea aria-label="Message brainx preview" placeholder="Describe the next agent step, constraints, or approval context." />
      <div className="composer-bottom-row">
        <div className="composer-left-actions">
          <label className="attachment-control">
            <Paperclip aria-hidden="true" size={15} />
            <span>Attach</span>
            <input aria-label="Attach files" multiple type="file" onChange={handleFiles} />
          </label>
          <label className="composer-mode-select">
            <span>Mode</span>
            <select aria-label="Composer mode" value={mode} onChange={(event) => setMode(event.target.value as ComposerMode)}>
              {modes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="composer-actions">
          <button className="send-preview-button" type="button">
            <SendHorizontal aria-hidden="true" size={15} />
            Send
          </button>
        </div>
      </div>
      {files.length ? (
        <div className="attachment-list" aria-live="polite">
          {files.map((file) => (
            <span key={file}>{file}</span>
          ))}
        </div>
      ) : null}
    </form>
  );
}

export function ChatPreviewPage() {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [scenario, setScenario] = useState<ScenarioKind>('default');

  return (
    <section className="chat-preview-page" aria-label="Chat preview">
      <main className="low-density-chat" aria-label="Timeline workspace">
        <AgentLoopTimeline scenario={scenario} />
        <ComposerDock />
      </main>
      <ReviewControls open={reviewOpen} scenario={scenario} onSelect={setScenario} onToggle={() => setReviewOpen((value) => !value)} />
    </section>
  );
}
