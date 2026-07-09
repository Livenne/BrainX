import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '../domain/types';
import { i18n } from '../i18n/i18n';
import { ChatPage } from '../pages/ChatPage';
import {
  cancelChatSession,
  createChatSession,
  deleteChatSession,
  forkChatSession,
  getClientDaemons,
  getSkillInventory,
  getChatSessions,
  renameChatSession,
  sendChatCommand,
  sendChatMessage
} from '../services/mockApi';
import { AuthProvider } from '../state/auth';
import { ThemeProvider } from '../state/theme';
import '../i18n/i18n';

vi.mock('../services/mockApi', () => ({
  cancelChatSession: vi.fn(),
  createChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  forkChatSession: vi.fn(),
  getClientDaemons: vi.fn().mockResolvedValue([{ id: 'cd_local', deviceName: 'Livenne Workstation', status: 'online' }]),
  getSkillInventory: vi.fn(),
  getChatSessions: vi.fn(),
  renameChatSession: vi.fn(),
  sendChatCommand: vi.fn(),
  sendChatMessage: vi.fn()
}));

vi.mock('../services/brainxApi', () => ({
  answerAskUser: vi.fn(),
  approveToolRequest: vi.fn(),
  cancelChatSession: vi.fn(),
  createChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  forkChatSession: vi.fn(),
  getClientDaemons: vi.fn(),
  getChatSession: vi.fn(),
  getChatSessionById: vi.fn(),
  getChatSessions: vi.fn(),
  getSkillInventory: vi.fn(),
  pollChatSession: vi.fn(),
  rejectToolRequest: vi.fn(),
  renameChatSession: vi.fn(),
  sendChatCommand: vi.fn(),
  sendSessionChatCommand: vi.fn(),
  sendSessionChatMessage: vi.fn(),
  sendChatMessage: vi.fn(),
  subscribeChatEvents: vi.fn()
}));

const baseSession: ChatSession = {
  id: 'chat_main',
  title: 'Test session',
  workspaceName: 'brainx-core',
  currentWorkspace: '~/.brainx/workspace',
  agentId: 'agent_frontend',
  agentName: 'frontend-main',
  branchName: 'mainline',
  skillName: 'none',
  clientName: 'brainx-client-local',
  runId: 'run_active',
  runStatus: 'completed',
  todos: [],
  terminals: [],
  subagents: [],
  toolStates: {},
  updatedAt: '2026-07-08T00:00:00.000Z',
  messages: [
    {
      role: 'user',
      content: 'Copy this message'
    },
    {
      role: 'assistant',
      thinking: '**Check** the identity $x=\\pi$ before answering.',
      content: 'The result is **ready** with $y=1$.'
    }
  ]
};

function renderChat(session: ChatSession = baseSession, path = '/workspaces/w_core/chat') {
  renderChatSessions([session], path);
}

function renderChatSessions(sessions: ChatSession[], path = '/workspaces/w_core/chat') {
  const firstSession = sessions[0] ?? { ...baseSession, id: 'chat_created', title: null, messages: [] };
  vi.mocked(getChatSessions).mockResolvedValue(sessions);
  vi.mocked(createChatSession).mockResolvedValue(firstSession);
  vi.mocked(cancelChatSession).mockResolvedValue({ ...firstSession, runStatus: 'cancelled' });
  vi.mocked(deleteChatSession).mockResolvedValue(undefined);
  vi.mocked(forkChatSession).mockResolvedValue({ ...firstSession, id: 'chat_forked' });
  vi.mocked(renameChatSession).mockImplementation(async (_workspaceId, sessionId, title) => ({
    ...firstSession,
    id: sessionId,
    title
  }));
  vi.mocked(sendChatCommand).mockImplementation(async (_workspaceId, _command, args) => {
    const commandArgs = args ?? {};
    return {
      ...firstSession,
      activeModelName: typeof commandArgs.modelName === 'string' ? commandArgs.modelName : firstSession.activeModelName,
      currentWorkspace: typeof commandArgs.path === 'string' ? commandArgs.path : firstSession.currentWorkspace
    };
  });
  vi.mocked(sendChatMessage).mockResolvedValue(firstSession);
  vi.mocked(getSkillInventory).mockResolvedValue({
    project: [
      {
        id: 'project-debug',
        scope: 'project',
        name: 'debug-rust',
        description: 'Debug Rust failures',
        path: '/home/Livenne/code/brainx/.agents/skills/debug-rust/SKILL.md'
      }
    ],
    global: [
      {
        id: 'global-plan',
        scope: 'global',
        name: 'write-plan',
        description: 'Write implementation plans',
        path: '/home/Livenne/.agents/skills/write-plan/SKILL.md'
      }
    ]
  });
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/workspaces/:workspaceId/chat" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

async function selectSession(user: ReturnType<typeof userEvent.setup>, title = 'Test session') {
  const selector = await screen.findByRole('combobox', { name: 'Chat sessions' });
  if (selector.tagName === 'SELECT') {
    const option = Array.from(selector.querySelectorAll('option')).find((candidate) => candidate.textContent === title);
    await user.selectOptions(selector, option?.getAttribute('value') ?? 'chat_main');
    return;
  }
  await user.click(selector);
  await user.click(await screen.findByRole('option', { name: title }));
}

describe('chat interaction polish', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  it('renders assistant text and thinking as markdown with math support', async () => {
    const user = userEvent.setup();
    renderChat();
    await selectSession(user);

    expect(await screen.findByText('ready')).toBeInTheDocument();
    expect(screen.getByText('ready').tagName).toBe('STRONG');
    expect(document.querySelector('.thinking-block')).not.toHaveAttribute('open');
    expect(screen.getByText('Check').tagName).toBe('STRONG');
    expect(document.querySelector('.thinking-block .katex')).not.toBeNull();
    expect(document.querySelector('.thinking-block .spinning-status')).toBeNull();
    expect(screen.queryByText(/\$x=\\pi\$/)).not.toBeInTheDocument();
  });

  it('uses a styled session menu with keyboard navigation', async () => {
    const user = userEvent.setup();
    renderChatSessions([
      baseSession,
      { ...baseSession, id: 'chat_design', title: 'Design review', messages: [] }
    ]);

    const selector = await screen.findByRole('combobox', { name: 'Chat sessions' });
    expect(selector).toHaveClass('chat-session-trigger');
    await user.click(selector);

    const listbox = screen.getByRole('listbox', { name: 'Chat sessions' });
    expect(within(listbox).getByRole('option', { name: 'New chat' })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Chat sessions' })).toHaveTextContent('Design review'));
    expect(screen.queryByRole('listbox', { name: 'Chat sessions' })).not.toBeInTheDocument();
  });

  it('shows a no-client empty state and does not create sessions when no client is bound', async () => {
    const user = userEvent.setup();
    vi.mocked(getClientDaemons).mockResolvedValueOnce([]);
    renderChatSessions([]);

    expect(await screen.findByText('Bind a client to start chat')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Client page' })).toHaveAttribute('href', '/workspaces/w_core/client-daemons');

    await user.type(screen.getByRole('textbox', { name: 'Message brainx' }), 'Inspect workspace');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(createChatSession).not.toHaveBeenCalled();
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('renders legacy get_environment as Environment with no placeholder summary', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      toolStates: {
        call_env: { status: 'completed', riskTier: 'safe' }
      },
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_env',
              type: 'function',
              function: {
                name: 'get_environment',
                arguments: '{}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_env',
          name: 'get_environment',
          content:
            '{"os":"Ubuntu 24.04 / WSL","arch":"x86_64","workspaceRoot":"/home/Livenne/code/brainx","defaultShell":"bash","model":{"name":"stepfun-ai/step-3.7-flash"},"dateTime":{"iso":"2026-07-08T15:30:00+08:00","timezone":"Asia/Shanghai","utcOffset":"+08:00"}}'
        }
      ]
    });
    await selectSession(user);

    const envToggle = await screen.findByRole('button', { name: 'Environment' });
    expect(screen.queryByText('无')).not.toBeInTheDocument();
    await user.click(envToggle);

    expect(screen.getByText('Ubuntu 24.04 / WSL')).toBeInTheDocument();
    expect(screen.getByText('stepfun-ai/step-3.7-flash')).toBeInTheDocument();
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
  });

  it('switches model from the keyboard menu and updates the composer footer', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      activeModelName: 'nvidia:stepfun-ai/step-3.7-flash',
      availableModels: [
        { name: 'nvidia:stepfun-ai/step-3.7-flash', providerName: 'nvidia', model: 'stepfun-ai/step-3.7-flash', protocol: 'openai' },
        { name: 'gpt:gpt-5.5', providerName: 'gpt', model: 'gpt-5.5', protocol: 'openai' }
      ]
    });
    await selectSession(user);

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/模型');
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(screen.getByLabelText('Current model')).toHaveTextContent('gpt:gpt-5.5'));
    expect(await screen.findByText('模型已切换到 gpt:gpt-5.5')).toBeInTheDocument();
    expect(sendChatCommand).toHaveBeenCalledWith('w_core', 'model', { modelName: 'gpt:gpt-5.5' }, 'chat_main');
  });

  it('switches model from a pointer selection without submitting the active model again', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      activeModelName: 'nvidia:stepfun-ai/step-3.7-flash',
      availableModels: [
        { name: 'nvidia:stepfun-ai/step-3.7-flash', providerName: 'nvidia', model: 'stepfun-ai/step-3.7-flash', protocol: 'openai' },
        { name: 'gpt:gpt-5.5', providerName: 'gpt', model: 'gpt-5.5', protocol: 'openai' }
      ]
    });
    await selectSession(user);

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/模型');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: /gpt:gpt-5\.5/ }));

    await waitFor(() => expect(sendChatCommand).toHaveBeenCalledWith('w_core', 'model', { modelName: 'gpt:gpt-5.5' }, 'chat_main'));
    expect(sendChatCommand).not.toHaveBeenCalledWith('w_core', 'model', { modelName: 'nvidia:stepfun-ai/step-3.7-flash' }, 'chat_main');
    expect(screen.getByLabelText('Current model')).toHaveTextContent('gpt:gpt-5.5');
  });

  it('opens a workdir dialog with the current workspace path and submits workspace command', async () => {
    const user = userEvent.setup();
    renderChat();
    await selectSession(user);

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/工作目录');
    await user.keyboard('{Enter}');

    const input = await screen.findByLabelText('Working directory');
    expect(input).toHaveValue('~/.brainx/workspace');
    await user.clear(input);
    await user.type(input, '/tmp/brainx-project');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(sendChatCommand).toHaveBeenCalledWith('w_core', 'workspace', { path: '/tmp/brainx-project' }, 'chat_main')
    );
    expect(await screen.findByText('工作目录已切换到 /tmp/brainx-project')).toBeInTheDocument();
  });

  it('scrolls long command and model popovers to the keyboard-selected option', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });
    renderChat({
      ...baseSession,
      activeModelName: 'model-0',
      availableModels: Array.from({ length: 12 }, (_, index) => ({
        name: `model-${index}`,
        model: `provider/model-${index}`,
        protocol: 'openai'
      }))
    });
    await selectSession(user);

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(scrollIntoView).toHaveBeenCalled();

    scrollIntoView.mockClear();
    await user.keyboard('{Escape}');
    await user.clear(composer);
    await user.type(composer, '/模型');
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('shows command feedback for clear and compact without adding chat messages', async () => {
    const user = userEvent.setup();
    vi.mocked(sendChatCommand)
      .mockResolvedValueOnce({
        ...baseSession,
        messages: [],
        toolStates: {}
      })
      .mockResolvedValueOnce({
        ...baseSession,
        messages: [],
        toolStates: {}
      });
    renderChat();
    await selectSession(user);

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/清空上下文');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('上下文已清空')).toBeInTheDocument();
    expect(screen.queryByText('Copy this message')).not.toBeInTheDocument();

    await user.type(composer, '/压缩上下文');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('没有可压缩的上下文')).toBeInTheDocument();
  });

  it('renders command notices in the timeline and clears visible context after clear', async () => {
    const user = userEvent.setup();
    vi.mocked(sendChatCommand).mockResolvedValueOnce({
      ...baseSession,
      messages: [],
      toolStates: {},
      timelineNotices: [
        {
          id: 'notice_clear',
          kind: 'context_cleared',
          message: '已清空上下文',
          afterMessageIndex: 0,
          createdAt: '2026-07-08T00:01:00.000Z'
        }
      ]
    });
    renderChat();
    await selectSession(user);

    expect(await screen.findByText('Copy this message')).toBeInTheDocument();

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/清空上下文');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('已清空上下文')).toBeInTheDocument();
    expect(screen.queryByText('Copy this message')).not.toBeInTheDocument();
    expect(screen.queryByText('提示上下文')).not.toBeInTheDocument();
  });

  it('keeps command notices at their original timeline position after new messages arrive', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      messages: [
        { role: 'user', content: 'Before model switch' },
        { role: 'assistant', content: 'Before response' },
        { role: 'user', content: 'After model switch' },
        { role: 'assistant', content: 'After response' }
      ],
      timelineNotices: [
        {
          id: 'notice_model',
          kind: 'model_changed',
          message: '已切换模型：gpt-5.5',
          detail: 'gpt-5.5',
          afterMessageIndex: 2,
          createdAt: '2026-07-08T00:01:00.000Z'
        }
      ]
    });
    await selectSession(user);

    const stream = await screen.findByRole('log', { name: 'Agent loop timeline' });
    const texts = within(stream)
      .getAllByText(/Before model switch|Before response|已切换模型：gpt-5\.5|After model switch|After response/)
      .map((node) => node.textContent);

    expect(texts).toEqual(['Before model switch', 'Before response', '已切换模型：gpt-5.5', 'After model switch', 'After response']);
  });

  it('does not append legacy command notices without anchors to the bottom of the timeline', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      messages: [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
        { role: 'assistant', content: 'Second response' }
      ],
      timelineNotices: [
        {
          id: 'notice_legacy_model',
          kind: 'model_changed',
          message: '已切换模型：gpt-5.5',
          detail: 'gpt-5.5',
          createdAt: '2026-07-08T00:01:00.000Z'
        }
      ]
    });
    await selectSession(user);

    const stream = await screen.findByRole('log', { name: 'Agent loop timeline' });
    const texts = within(stream)
      .getAllByText(/已切换模型：gpt-5\.5|First message|First response|Second message|Second response/)
      .map((node) => node.textContent);

    expect(texts).toEqual(['已切换模型：gpt-5.5', 'First message', 'First response', 'Second message', 'Second response']);
  });

  it('removes the failed user bubble before retrying that message', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      messages: [
        { role: 'user', content: 'Retry this command', status: 'failed', error: { code: 'send_failed', message: 'HTTP 429: Too Many Requests' } },
        { role: 'assistant', content: 'Earlier successful answer' }
      ]
    });
    vi.mocked(sendChatMessage).mockResolvedValueOnce({
      ...baseSession,
      messages: [
        { role: 'user', content: 'Retry this command' },
        { role: 'assistant', content: 'Retry succeeded' }
      ]
    });
    await selectSession(user);

    await user.click(await screen.findByRole('button', { name: 'Retry message' }));

    expect(await screen.findByText('Retry succeeded')).toBeInTheDocument();
    expect(screen.queryByText('HTTP 429: Too Many Requests')).not.toBeInTheDocument();
    expect(screen.getAllByText('Retry this command')).toHaveLength(1);
  });

  it('does not claim a model switch succeeded when the server returns the old active model', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      activeModelName: 'nvidia:stepfun-ai/step-3.7-flash',
      availableModels: [
        { name: 'nvidia:stepfun-ai/step-3.7-flash', providerName: 'nvidia', model: 'stepfun-ai/step-3.7-flash', protocol: 'openai' },
        { name: 'gpt:gpt-5.5', providerName: 'gpt', model: 'gpt-5.5', protocol: 'openai' }
      ]
    });
    vi.mocked(sendChatCommand).mockResolvedValueOnce({
      ...baseSession,
      activeModelName: 'nvidia:stepfun-ai/step-3.7-flash',
      availableModels: [
        { name: 'nvidia:stepfun-ai/step-3.7-flash', providerName: 'nvidia', model: 'stepfun-ai/step-3.7-flash', protocol: 'openai' },
        { name: 'gpt:gpt-5.5', providerName: 'gpt', model: 'gpt-5.5', protocol: 'openai' }
      ]
    });
    await selectSession(user);

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/模型');
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(await screen.findByText('模型切换未生效：服务器返回 nvidia:stepfun-ai/step-3.7-flash')).toBeInTheDocument();
    expect(screen.queryByText('模型已切换到 nvidia:stepfun-ai/step-3.7-flash')).not.toBeInTheDocument();
  });

  it('opens row actions for a non-selected session without switching sessions', async () => {
    const user = userEvent.setup();
    renderChatSessions([
      baseSession,
      { ...baseSession, id: 'chat_design', title: 'Design review', messages: [] }
    ]);
    await selectSession(user, 'Test session');

    await user.click(screen.getByRole('combobox', { name: 'Chat sessions' }));
    await user.click(await screen.findByRole('button', { name: 'Session actions for Design review' }));
    await user.click(await screen.findByRole('menuitem', { name: '重命名' }));

    const input = await screen.findByLabelText('Session name');
    expect(input).toHaveValue('Design review');
    await user.clear(input);
    await user.type(input, 'Design notes');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(renameChatSession).toHaveBeenCalledWith('w_core', 'chat_design', 'Design notes'));
    expect(screen.getByRole('combobox', { name: 'Chat sessions' })).toHaveTextContent('Test session');
  });

  it('renders project and global skills in the chat right rail', async () => {
    const user = userEvent.setup();
    renderChat();
    await selectSession(user);

    expect(await screen.findByRole('region', { name: 'Skills' })).toBeInTheDocument();
    await waitFor(() => {
      expect(getSkillInventory).toHaveBeenLastCalledWith('w_core', {
        clientDaemonId: 'cd_local',
        currentWorkspace: '~/.brainx/workspace'
      });
    });
    expect(screen.getByText('Project skills')).toBeInTheDocument();
    expect(screen.queryByText('Current workspace')).not.toBeInTheDocument();
    expect(screen.getByText('debug-rust')).toBeInTheDocument();
    expect(screen.getByText('Debug Rust failures')).toBeInTheDocument();
    expect(screen.getByText('write-plan')).toBeInTheDocument();
  });

  it('reloads chat skills when switching to a session with a different workdir', async () => {
    const user = userEvent.setup();
    renderChatSessions([
      baseSession,
      {
        ...baseSession,
        id: 'chat_docs',
        title: 'Docs session',
        currentWorkspace: '/home/Livenne/code/brainx/docs',
        messages: []
      }
    ]);
    await selectSession(user, 'Test session');

    await user.click(await screen.findByRole('combobox', { name: 'Chat sessions' }));
    await user.click(await screen.findByRole('option', { name: 'Docs session' }));

    await waitFor(() => {
      expect(getSkillInventory).toHaveBeenLastCalledWith('w_core', {
        clientDaemonId: 'cd_local',
        currentWorkspace: '/home/Livenne/code/brainx/docs'
      });
    });
  });

  it('renders command tool details as terminal output instead of raw result fields', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      toolStates: {
        call_run: { status: 'failed', riskTier: 'execute' }
      },
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_run',
              type: 'function',
              function: {
                name: 'run_command',
                arguments: JSON.stringify({ command: 'npm test', workdir: 'apps/browser' })
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_run',
          name: 'run_command',
          content: '{"ok":false,"exitCode":1,"stdout":"","stderr":"FAIL src/__tests__/chat.test.tsx\\nExpected true","stderrTruncated":false,"timedOut":false}'
        }
      ]
    });
    await selectSession(user);

    await user.click(await screen.findByRole('button', { name: 'Run npm test' }));
    const details = screen.getByRole('region', { name: 'run_command details' });

    expect(within(details).getByText('FAIL src/__tests__/chat.test.tsx')).toBeInTheDocument();
    expect(within(details).queryByText('ok')).not.toBeInTheDocument();
    expect(within(details).queryByText('exitCode')).not.toBeInTheDocument();
    expect(within(details).queryByText('stderrTruncated')).not.toBeInTheDocument();
  });

  it('renders web search results as answer and source summaries', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_web',
              type: 'function',
              function: {
                name: 'web_search',
                arguments: JSON.stringify({ query: 'Tavily search API docs', maxResults: 2 })
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_web',
          name: 'web_search',
          content: JSON.stringify({
            ok: true,
            result: {
              query: 'Tavily search API docs',
              answer: 'Tavily Search returns ranked web results.',
              results: [
                {
                  title: 'Search API',
                  url: 'https://docs.tavily.com/documentation/api-reference/endpoint/search',
                  content: 'POST /search accepts query, search_depth, topic and max_results.',
                  score: 0.97
                }
              ],
              truncated: false
            }
          })
        }
      ]
    });
    await selectSession(user);

    await user.click(await screen.findByRole('button', { name: 'Web Search Tavily search API docs' }));
    const details = screen.getByRole('region', { name: 'web_search details' });

    expect(within(details).getByText('Tavily Search returns ranked web results.')).toBeInTheDocument();
    expect(within(details).getByText('Search API')).toBeInTheDocument();
    expect(within(details).getByText('https://docs.tavily.com/documentation/api-reference/endpoint/search')).toBeInTheDocument();
    expect(within(details).getByText('POST /search accepts query, search_depth, topic and max_results.')).toBeInTheDocument();
    expect(within(details).queryByText('score')).not.toBeInTheDocument();
  });

  it('derives the left rail todo and terminal state from standard tool result messages', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      todos: [],
      terminals: [],
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_todo',
              type: 'function',
              function: {
                name: 'todo_create',
                arguments: JSON.stringify({
                  tasks: [
                    { id: '1', title: 'Draft client protocol', status: 'in_progress' },
                    { id: '2', title: 'Verify terminal lifecycle', status: 'pending' }
                  ]
                })
              }
            },
            {
              id: 'call_terminal',
              type: 'function',
              function: {
                name: 'terminal_spawn',
                arguments: JSON.stringify({ command: 'npm run dev', terminal_id: 'dev_server' })
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_todo',
          name: 'todo_create',
          content:
            '{"ok":true,"result":{"tasks":[{"id":"1","title":"Draft client protocol","status":"in_progress","description":"Map BSC message flow","dependencies":[]},{"id":"2","title":"Verify terminal lifecycle","status":"pending","description":"","dependencies":[]}]}}'
        },
        {
          role: 'tool',
          tool_call_id: 'call_terminal',
          name: 'terminal_spawn',
          content:
            '{"ok":true,"result":{"terminalId":"dev_server","status":"running","pid":456,"startedAt":"2026-07-08T10:00:00Z"}}'
        }
      ]
    });
    await selectSession(user);

    const rail = await screen.findByRole('complementary', { name: 'Session state' });
    expect(rail).toHaveClass('chat-state-panel');
    expect(within(rail).getByRole('combobox', { name: 'Chat sessions' })).toHaveClass('chat-session-trigger');
    expect(within(rail).getByRole('list', { name: 'Todo' })).toHaveClass('chat-rail-list');
    expect(within(rail).getByRole('list', { name: 'Terminal' })).toHaveClass('chat-rail-list', 'terminal-rail-list');
    expect(within(rail).getByText('Draft client protocol')).toBeInTheDocument();
    expect(within(rail).queryByText('in_progress')).not.toBeInTheDocument();
    expect(within(rail).getByLabelText('Todo status: in_progress')).toHaveClass('todo-status-icon');
    expect(within(rail).getByText('dev_server')).toBeInTheDocument();
    expect(within(rail).getByText('running')).toBeInTheDocument();
    expect(within(rail).getByLabelText('Terminal status: running')).toHaveClass('terminal-status-light');
  });

  it('keeps long todo and terminal lists inside scrollable rail sections', async () => {
    const user = userEvent.setup();
    const tasks = Array.from({ length: 16 }, (_, index) => ({
      id: `task-${index}`,
      title: `Task ${index + 1}`,
      status: index % 3 === 0 ? 'completed' : index % 3 === 1 ? 'in_progress' : 'pending'
    }));
    const terminals = Array.from({ length: 12 }, (_, index) => ({
      terminalId: `term_${index + 1}`,
      status: index % 2 === 0 ? 'running' : 'stopped'
    }));
    renderChat({
      ...baseSession,
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_todo_many',
              type: 'function',
              function: {
                name: 'todo_create',
                arguments: JSON.stringify({ tasks })
              }
            },
            {
              id: 'call_terminal_many',
              type: 'function',
              function: {
                name: 'terminal_list',
                arguments: '{}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_todo_many',
          name: 'todo_create',
          content: JSON.stringify({ ok: true, result: { tasks } })
        },
        {
          role: 'tool',
          tool_call_id: 'call_terminal_many',
          name: 'terminal_list',
          content: JSON.stringify({ ok: true, result: { terminals } })
        }
      ]
    });
    await selectSession(user);

    const rail = await screen.findByRole('complementary', { name: 'Session state' });
    expect(within(rail).getByRole('region', { name: 'Todo section' })).toHaveClass('chat-rail-section');
    expect(within(rail).getByRole('region', { name: 'Terminal section' })).toHaveClass('chat-rail-section');
    expect(within(rail).getByRole('list', { name: 'Todo' })).toHaveClass('chat-rail-scroll');
    expect(within(rail).getByRole('list', { name: 'Terminal' })).toHaveClass('chat-rail-scroll');
  });

  it('removes stopped terminals from the rail instead of keeping stale tasks visible', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      terminals: [
        { id: 'old_stopped', title: 'old_stopped', status: 'stopped', lines: [] },
        { id: 'still_running', title: 'still_running', status: 'running', lines: [] }
      ],
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_terminal_list',
              type: 'function',
              function: { name: 'terminal_list', arguments: '{}' }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_terminal_list',
          name: 'terminal_list',
          content: JSON.stringify({
            ok: true,
            result: {
              terminals: [
                { terminalId: 'new_running', status: 'running' },
                { terminalId: 'new_stopped', status: 'stopped' }
              ]
            }
          })
        }
      ]
    });
    await selectSession(user);

    const rail = await screen.findByRole('complementary', { name: 'Session state' });
    expect(within(rail).getByText('still_running')).toBeInTheDocument();
    expect(within(rail).getByText('new_running')).toBeInTheDocument();
    expect(within(rail).queryByText('old_stopped')).not.toBeInTheDocument();
    expect(within(rail).queryByText('new_stopped')).not.toBeInTheDocument();
  });

  it('copies user bubble text from the hover action', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    renderChat();
    await selectSession(user);

    const bubble = await screen.findByText('Copy this message');
    await user.hover(bubble);
    await user.click(screen.getByRole('button', { name: 'Copy message' }));

    expect(writeText).toHaveBeenCalledWith('Copy this message');
  });

  it('keeps the copy action stable on short user bubbles and retries failed messages', async () => {
    const user = userEvent.setup();
    vi.mocked(sendChatMessage)
      .mockRejectedValueOnce(new Error('model provider returned HTTP 429: {"status":429,"title":"Too Many Requests"}'))
      .mockResolvedValueOnce({
        ...baseSession,
        messages: [
          ...baseSession.messages,
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Recovered.' }
        ]
      });
    renderChat();
    await selectSession(user);

    await user.type(screen.getByRole('textbox', { name: 'Message brainx' }), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    const retry = await screen.findByRole('button', { name: 'Retry message' });
    const copyButtons = screen.getAllByRole('button', { name: 'Copy message' });
    expect(copyButtons.at(-1)).toHaveClass('message-copy-button-fixed');
    expect(screen.getAllByText('HTTP 429: Too Many Requests').length).toBeGreaterThanOrEqual(1);

    await user.click(retry);

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(sendChatMessage).toHaveBeenLastCalledWith('chat_main', 'Hi', []);
    expect(await screen.findByText('Recovered.')).toBeInTheDocument();
  });

  it('opens session and model command submenus from slash actions', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      activeModelName: 'nvidia:stepfun-ai/step-3.7-flash',
      availableModels: [
        { name: 'nvidia:stepfun-ai/step-3.7-flash', providerName: 'nvidia', model: 'stepfun-ai/step-3.7-flash', protocol: 'openai', contextWindow: 128000 },
        { name: 'local:qwen/qwen3-coder', providerName: 'local', model: 'qwen/qwen3-coder', protocol: 'openai', contextWindow: 64000 }
      ]
    });
    await selectSession(user);

    const composer = screen.getByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/切换会话');
    await user.keyboard('{Enter}');

    const sessionList = await screen.findByRole('listbox', { name: 'Chat sessions' });
    expect(sessionList).toBeInTheDocument();
    expect(document.activeElement).toHaveClass('chat-session-option');

    await user.keyboard('{Escape}');
    await user.clear(composer);
    await user.type(composer, '/切换模型');
    await user.keyboard('{Enter}');

    const modelList = await screen.findByRole('listbox', { name: 'Model options' });
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(sendChatCommand).toHaveBeenCalledWith('w_core', 'model', expect.objectContaining({ modelName: 'local:qwen/qwen3-coder' }), 'chat_main'));
    expect(modelList).not.toBeInTheDocument();
  });

  it('runs clear, rename, delete, and init chat actions from composer menus', async () => {
    const user = userEvent.setup();
    renderChat();
    await selectSession(user);

    const composer = screen.getByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/清空上下文');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatCommand).toHaveBeenCalledWith('w_core', 'clear', expect.any(Object), 'chat_main'));

    await user.type(composer, '/重命名会话');
    await user.keyboard('{Enter}');
    const renameInput = await screen.findByRole('textbox', { name: 'Session name' });
    await user.type(renameInput, 'Agent design notes');
    await user.click(screen.getByRole('button', { name: 'Save session name' }));
    await waitFor(() => expect(renameChatSession).toHaveBeenCalledWith('w_core', 'chat_main', 'Agent design notes'));

    await user.type(composer, '/删除会话');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Delete session' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete current session' }));
    await waitFor(() => expect(deleteChatSession).toHaveBeenCalledWith('w_core', 'chat_main'));

    await user.type(composer, '/初始化项目');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(sendChatMessage).toHaveBeenCalledWith(
        'chat_main',
        expect.stringContaining('Generate a file named AGENTS.md'),
        []
      )
    );
    expect(sendChatMessage).toHaveBeenCalledWith(
      'chat_main',
      expect.stringContaining('Title the document "Repository Guidelines"'),
      []
    );
  });

  it('centers the empty chat hero and sends shortcut topics directly', async () => {
    const user = userEvent.setup();
    const createdSession = { ...baseSession, id: 'chat_created', title: null, messages: [] };
    vi.mocked(createChatSession).mockResolvedValue(createdSession);
    vi.mocked(sendChatMessage).mockResolvedValue(createdSession);
    renderChatSessions([]);

    expect(await screen.findByRole('region', { name: 'Empty chat' })).toHaveClass('chat-empty-state-centered');
    expect(screen.getByRole('heading', { name: 'What should brainx work on?' })).toHaveClass('chat-empty-display-title');

    await user.click(screen.getByRole('button', { name: '查看当前目录' }));

    await waitFor(() => expect(createChatSession).toHaveBeenCalled());
    expect(sendChatMessage).toHaveBeenCalledWith(expect.stringMatching(/^chat_/), '查看当前目录', []);
  });

  it('cancels the active session with Escape after closing popovers first', async () => {
    const user = userEvent.setup();
    renderChat({ ...baseSession, runStatus: 'running' });
    await selectSession(user);

    await user.click(await screen.findByRole('button', { name: 'Attach files' }));
    expect(screen.getByRole('menu', { name: 'Attachment actions' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Attachment actions' })).not.toBeInTheDocument();
    expect(cancelChatSession).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(cancelChatSession).toHaveBeenCalledWith('w_core', 'chat_main'));
  });

  it('rejects unsupported and oversized attachments before previewing them', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.upload(await screen.findByLabelText('Native file picker'), [
      new File(['video'], 'demo.mp4', { type: 'video/mp4' }),
      new File(['x'.repeat(512 * 1024 + 1)], 'huge.txt', { type: 'text/plain' })
    ]);

    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByLabelText('Attached files')).not.toBeInTheDocument();
  });

  it('keeps multiple accepted attachments in polished removable cards', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.upload(await screen.findByLabelText('Native file picker'), [
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      new File(['image'], 'screen.png', { type: 'image/png' })
    ]);

    const attachments = screen.getByLabelText('Attached files');
    expect(within(attachments).getByText('notes.txt')).toBeInTheDocument();
    expect(within(attachments).getByText('screen.png')).toBeInTheDocument();
    await user.click(within(attachments).getByRole('button', { name: 'Remove notes.txt' }));
    expect(within(attachments).queryByText('notes.txt')).not.toBeInTheDocument();
  });

  it('creates a session shell before sending the first empty-chat message', async () => {
    const user = userEvent.setup();
    const createdSession = { ...baseSession, id: 'chat_created', title: null, messages: [] };
    vi.mocked(sendChatMessage).mockResolvedValue(createdSession);
    renderChatSessions([]);

    const composer = await screen.findByRole('textbox');
    await user.type(composer, 'Inspect the current directory');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(sendChatMessage).toHaveBeenCalledWith(expect.stringMatching(/^chat_/), 'Inspect the current directory', [])
    );
  });

  it('opens a fresh empty draft for the localized new chat action without creating a server session', async () => {
    const user = userEvent.setup();
    renderChatSessions([]);

    const composer = await screen.findByRole('textbox');
    await user.type(composer, '/new');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(composer).toHaveValue(''));
    expect(screen.queryByRole('listbox', { name: 'Chat commands' })).not.toBeInTheDocument();
    expect(createChatSession).not.toHaveBeenCalled();
  });

  it('uses one action menu format for plus actions without creating a session for draft-only actions', async () => {
    const user = userEvent.setup();
    renderChatSessions([]);

    await user.click(await screen.findByRole('button', { name: 'Attach files' }));
    const menu = screen.getByRole('menu', { name: 'Attachment actions' });

    const uploadAction = within(menu).getByRole('menuitem', { name: /添加照片和文件 从电脑上传/ });
    const newChatAction = within(menu).getByRole('menuitem', { name: /新建会话/ });
    expect(uploadAction).toHaveClass('composer-action-item');
    expect(newChatAction).toHaveClass('composer-action-item');
    expect(within(uploadAction).getByText('添加照片和文件')).toHaveClass('composer-action-name');
    expect(within(uploadAction).getByText('从电脑上传')).toHaveClass('composer-action-description');

    await user.click(newChatAction);

    expect(createChatSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: 'Attachment actions' })).not.toBeInTheDocument();
  });

  it('keeps chat usable when the skills inventory endpoint is unavailable', async () => {
    vi.mocked(getSkillInventory).mockRejectedValueOnce(new Error('brainx API request failed: 404'));
    renderChat();

    expect(await screen.findByRole('textbox', { name: 'Message brainx' })).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: 'Chat sessions' })).toBeInTheDocument();
    expect(screen.queryByText(/404/)).not.toBeInTheDocument();
  });

  it('labels session state and shows the current working directory in the side rails', async () => {
    const user = userEvent.setup();
    renderChat({
      ...baseSession,
      currentWorkspace: '/home/Livenne/.brainx/workspace/test'
    });
    await selectSession(user);

    const rail = await screen.findByRole('complementary', { name: 'Session state' });
    expect(within(rail).getByRole('heading', { name: 'Session' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Current working directory' })).toHaveTextContent('/home/Livenne/.brainx/workspace/test');
  });

  it('creates a real session before switching models from an empty chat page', async () => {
    const user = userEvent.setup();
    const listedSession = {
      ...baseSession,
      activeModelName: 'nvidia:stepfun-ai/step-3.7-flash',
      availableModels: [
        { name: 'nvidia:stepfun-ai/step-3.7-flash', providerName: 'nvidia', model: 'stepfun-ai/step-3.7-flash', protocol: 'openai', contextWindow: 128000 },
        { name: 'gpt:gpt-5.5', providerName: 'gpt', model: 'gpt-5.5', protocol: 'openai', contextWindow: 128000 }
      ]
    };
    const createdSession = {
      ...listedSession,
      id: 'chat_created',
      title: null,
      messages: []
    };
    renderChatSessions([listedSession], '/workspaces/w_core/chat?sessionId=new');
    vi.mocked(createChatSession).mockResolvedValue(createdSession);
    vi.mocked(sendChatCommand).mockResolvedValue({
      ...createdSession,
      activeModelName: 'gpt:gpt-5.5'
    });

    const composer = await screen.findByRole('textbox', { name: 'Message brainx' });
    await user.type(composer, '/切换模型');
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(createChatSession).toHaveBeenCalledWith('w_core'));
    expect(sendChatCommand).toHaveBeenCalledWith('w_core', 'model', { modelName: 'gpt:gpt-5.5' }, 'chat_created');
    expect(screen.getByLabelText('Current model')).toHaveTextContent('gpt:gpt-5.5');
  });
});
