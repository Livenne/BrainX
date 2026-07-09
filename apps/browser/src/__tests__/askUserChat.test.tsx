import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from '../pages/ChatPage';
import { answerAskUser } from '../services/brainxApi';
import { createChatSession, getChatSessions, sendChatMessage } from '../services/mockApi';
import { AuthProvider } from '../state/auth';
import { ThemeProvider } from '../state/theme';
import type { ChatSession } from '../domain/types';
import '../i18n/i18n';

vi.mock('../services/mockApi', () => ({
  cancelChatSession: vi.fn(),
  createChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  forkChatSession: vi.fn(),
  getSkillInventory: vi.fn().mockResolvedValue({ project: [], global: [] }),
  getChatSessions: vi.fn(),
  renameChatSession: vi.fn(),
  sendChatCommand: vi.fn(),
  sendChatMessage: vi.fn()
}));

vi.mock('../services/brainxApi', () => ({
  answerAskUser: vi.fn(),
  approveToolRequest: vi.fn(),
  getChatSession: vi.fn(),
  getSkillInventory: vi.fn().mockResolvedValue({ project: [], global: [] }),
  pollChatSession: vi.fn(),
  rejectToolRequest: vi.fn(),
  sendChatCommand: vi.fn(),
  sendChatMessage: vi.fn()
}));

const askUserSession: ChatSession = {
  id: 'chat_main',
  title: 'Ask user run',
  workspaceName: 'brainx-core',
  currentWorkspace: '~/.brainx/workspace',
  agentId: 'agent_frontend',
  agentName: 'frontend-main',
  branchName: 'mainline',
  skillName: 'none',
  clientName: 'brainx-client-local',
  runId: 'run_question',
  runStatus: 'waiting_for_user',
  todos: [],
  terminals: [],
  subagents: [],
  toolStates: {
    call_question: {
      status: 'waiting',
      riskTier: 'safe',
      expiresAt: '2026-07-07T01:32:00+08:00'
    }
  },
  updatedAt: '2026-07-07T01:30:00+08:00',
  messages: [
    {
      role: 'user',
      content: '需要时问我。'
    },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_question',
          type: 'function',
          function: {
            name: 'ask_user',
            arguments: JSON.stringify({
              question: '请选择 1、2 或 3',
              options: ['1', '2', '3'],
              question_type: 'clarification',
              context_note: '需要用户选择后继续。'
            })
          }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: 'call_question',
      name: 'ask_user',
      content:
        '{"ok":true,"result":{"status":"waiting_for_user","question":"请选择 1、2 或 3","options":["1","2","3"],"contextNote":"需要用户选择后继续。"}}'
    }
  ]
};

function renderChat() {
  render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/workspaces/w_core/chat']}>
          <Routes>
            <Route path="/workspaces/:workspaceId/chat" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

async function chooseChatSession(user: ReturnType<typeof userEvent.setup>, name: string) {
  const selector = await screen.findByRole('combobox', { name: 'Chat sessions' });
  if (selector.tagName === 'SELECT') {
    await user.selectOptions(selector, 'chat_main');
    return;
  }
  await user.click(selector);
  await user.click(await screen.findByRole('option', { name }));
}

describe('ask_user chat interaction', () => {
  beforeEach(() => {
    vi.mocked(getChatSessions).mockResolvedValue([askUserSession]);
    vi.mocked(createChatSession).mockResolvedValue({ ...askUserSession, runStatus: 'completed', messages: [] });
    vi.mocked(answerAskUser).mockResolvedValue({
      ...askUserSession,
      runStatus: 'waiting_for_client',
      toolStates: {
        call_question: {
          status: 'completed',
          riskTier: 'safe'
        }
      }
    });
    vi.mocked(sendChatMessage).mockResolvedValue(askUserSession);
  });

  it('lets the user answer ask_user option prompts from the chat timeline', async () => {
    const user = userEvent.setup();
    renderChat();

    await chooseChatSession(user, 'Ask user run');
    const firstOption = await screen.findByRole('button', { name: '1' });
    await user.click(firstOption);

    expect(answerAskUser).toHaveBeenCalledWith('test-token', 'w_core', 'run_question', 'call_question', [
      { id: 'choice', selectedOptionId: '1', text: '1', isOther: false }
    ]);
  });

  it('keeps ask_user answerable when only the standard tool result carries the waiting status', async () => {
    const user = userEvent.setup();
    vi.mocked(getChatSessions).mockResolvedValue([{ ...askUserSession, toolStates: {} }]);
    renderChat();

    await chooseChatSession(user, 'Ask user run');
    const firstOption = await screen.findByRole('button', { name: '1' });
    await user.click(firstOption);

    expect(answerAskUser).toHaveBeenCalledWith('test-token', 'w_core', 'run_question', 'call_question', [
      { id: 'choice', selectedOptionId: '1', text: '1', isOther: false }
    ]);
  });

  it('shows send failures as a toast instead of an inline timeline alert', async () => {
    const user = userEvent.setup();
    const completedSession = { ...askUserSession, runStatus: 'completed' as const, messages: [] };
    vi.mocked(getChatSessions).mockResolvedValue([completedSession]);
    vi.mocked(createChatSession).mockResolvedValue(completedSession);
    vi.mocked(sendChatMessage).mockRejectedValue(new Error('Network queue failed'));
    renderChat();

    await user.type(await screen.findByRole('textbox'), 'trigger failure');
    await user.click(screen.getByRole('button', { name: /发送消息|Send message/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Network queue failed');
    expect(screen.getByRole('alert')).toHaveClass('chat-toast');
  });
});
