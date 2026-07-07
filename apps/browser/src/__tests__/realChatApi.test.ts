import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession, ExecutionEvent } from '../domain/types';
import {
  completeClientBind,
  getChatSession,
  getClientDaemons,
  getWorkspaces,
  getRunEvents,
  loginUser,
  logoutUser,
  pollChatSession,
  registerUser,
  answerAskUser,
  approveToolRequest,
  rejectToolRequest,
  sendChatCommand,
  sendChatMessage,
  unbindClientDaemon,
  updateApprovalPolicy
} from '../services/brainxApi';

const session: ChatSession = {
  id: 'chat_main',
  title: 'Main Agent',
  workspaceName: 'Brainx Local',
  agentId: 'a_core',
  agentName: 'brainx',
  branchName: 'main',
  skillName: 'none',
  clientName: 'current device',
  runId: 'run_1',
  runStatus: 'completed',
  todos: [],
  terminals: [],
  subagents: [],
  toolStates: {},
  updatedAt: '2026-07-05T00:00:00.000Z',
  messages: []
};

const events: ExecutionEvent[] = [
  {
    id: 'evt_1',
    type: 'run.created',
    sequence: 1,
    occurredAt: '2026-07-05T00:00:00.000Z',
    message: 'Run created'
  }
];

function okJson(value: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(value)
  } as Response);
}

describe('brainx real chat API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the current workspace chat session', async () => {
    const fetch = vi.fn(() => okJson(session));
    vi.stubGlobal('fetch', fetch);

    const result = await getChatSession('w_core');

    expect(result).toEqual(session);
    expect(fetch).toHaveBeenCalledWith('/api/v1/workspaces/w_core/chat/session', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    });
  });

  it('sends a user message to the workspace chat endpoint', async () => {
    const fetch = vi.fn(() => okJson({ ...session, runStatus: 'waiting_for_client' }));
    vi.stubGlobal('fetch', fetch);

    const result = await sendChatMessage('w_core', 'Inspect workspace');

    expect(result.runStatus).toBe('waiting_for_client');
    expect(fetch).toHaveBeenCalledWith('/api/v1/workspaces/w_core/chat/messages', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content: 'Inspect workspace' })
    });
  });

  it('surfaces server error messages instead of hiding them behind status codes', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error: {
              code: 'state.conflict',
              message: 'A chat run is already active for this session.'
            }
          })
      } as Response)
    );
    vi.stubGlobal('fetch', fetch);

    await expect(sendChatMessage('w_core', 'Again')).rejects.toThrow('A chat run is already active for this session.');
  });

  it('sends slash commands to the command endpoint without message content', async () => {
    const fetch = vi.fn(() => okJson({ ...session, activeModelName: 'nvidia-step' }));
    vi.stubGlobal('fetch', fetch);

    const result = await sendChatCommand('w_core', 'model', { modelName: 'nvidia-step' });

    expect(result.activeModelName).toBe('nvidia-step');
    expect(fetch).toHaveBeenCalledWith('/api/v1/workspaces/w_core/chat/commands', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ command: 'model', arguments: { modelName: 'nvidia-step' } })
    });
  });

  it('polls chat session through the same real endpoint', async () => {
    const fetch = vi.fn(() => okJson(session));
    vi.stubGlobal('fetch', fetch);

    await expect(pollChatSession('w_core')).resolves.toEqual(session);

    expect(fetch).toHaveBeenCalledWith('/api/v1/workspaces/w_core/chat/session', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    });
  });

  it('fetches run events for the selected agent run', async () => {
    const fetch = vi.fn(() => okJson(events));
    vi.stubGlobal('fetch', fetch);

    await expect(getRunEvents('a_core', 'run_1')).resolves.toEqual(events);

    expect(fetch).toHaveBeenCalledWith('/api/v1/agents/a_core/runs/run_1/events', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    });
  });

  it('registers and logs in through auth endpoints', async () => {
    const auth = { token: 'token_a', user: { id: 'u_1', username: 'user_a' } };
    const fetch = vi.fn(() => okJson(auth));
    vi.stubGlobal('fetch', fetch);

    await expect(registerUser('user_a', 'pw-a-12345')).resolves.toEqual(auth);
    await expect(loginUser('user_a', 'pw-a-12345')).resolves.toEqual(auth);

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/auth/register', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user_a', password: 'pw-a-12345' })
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/auth/login', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user_a', password: 'pw-a-12345' })
    });
  });

  it('logs out through bearer auth endpoint', async () => {
    const fetch = vi.fn(() => okJson({ accepted: true }));
    vi.stubGlobal('fetch', fetch);

    await expect(logoutUser('token_a')).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token_a' }
    });
  });

  it('loads, binds, and unbinds client daemons with bearer auth', async () => {
    const serverDaemon = {
      id: 'cd_1',
      workspaceId: 'w_core',
      userId: 'u_1',
      deviceName: 'devbox',
      status: 'active',
      capabilities: ['model.invoke'],
      boundAt: '2026-07-06T00:00:00.000Z',
      lastHeartbeatAt: '2026-07-06T00:00:02.000Z'
    };
    const fetch = vi.fn((url: string) => {
      if (url.endsWith('/client-daemons')) return okJson([serverDaemon]);
      if (url.endsWith('/complete-bind')) return okJson(serverDaemon);
      return okJson({ accepted: true });
    });
    vi.stubGlobal('fetch', fetch);

    const daemons = await getClientDaemons('token_a');
    const bound = await completeClientBind('token_a', 'BX-ABCD-2345');
    await unbindClientDaemon('token_a', 'cd_1');

    expect(daemons[0].deviceName).toBe('devbox');
    expect(bound.id).toBe('cd_1');
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/client-daemons', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token_a' }
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/client-daemons/complete-bind', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({ code: 'BX-ABCD-2345' })
    });
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/v1/client-daemons/cd_1/unbind', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({ confirm: true })
    });
  });

  it('loads authenticated workspaces', async () => {
    const workspaces = [{ id: 'w_core', name: 'Brainx Local', status: 'active' }];
    const fetch = vi.fn(() => okJson(workspaces));
    vi.stubGlobal('fetch', fetch);

    await expect(getWorkspaces('token_a')).resolves.toEqual(workspaces);

    expect(fetch).toHaveBeenCalledWith('/api/v1/workspaces', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token_a' }
    });
  });

  it('updates workspace approval policy', async () => {
    const policy = { workspaceId: 'w_core', mode: 'full_accept', levels: [] };
    const fetch = vi.fn(() => okJson(policy));
    vi.stubGlobal('fetch', fetch);

    await expect(updateApprovalPolicy('token_a', 'w_core', 'full_accept')).resolves.toEqual(policy);

    expect(fetch).toHaveBeenCalledWith('/api/v1/workspaces/w_core/approval-policy', {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({ mode: 'full_accept' })
    });
  });

  it('approves, rejects, and answers chat tool interactions', async () => {
    const fetch = vi.fn(() => okJson(session));
    vi.stubGlobal('fetch', fetch);

    await approveToolRequest('token_a', 'w_core', 'exec_write');
    await rejectToolRequest('token_a', 'w_core', 'exec_run', 'Not needed');
    await answerAskUser('token_a', 'w_core', 'run_1', 'call_question', [
      { id: 'plan', selectedOptionId: 'a', text: 'A', isOther: false }
    ]);

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/w_core/tool-approvals/exec_write/approve', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({})
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/workspaces/w_core/tool-approvals/exec_run/reject', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({ reason: 'Not needed' })
    });
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/v1/workspaces/w_core/ask-user/run_1/call_question/answers', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({
        answers: [{ id: 'plan', selectedOptionId: 'a', text: 'A', isOther: false }]
      })
    });
  });

  it('retries ask_user answers without auth when a stale optional token is rejected', async () => {
    const unauthorized = Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { code: 'auth.unauthorized' } })
    } as Response);
    const fetch = vi.fn().mockReturnValueOnce(unauthorized).mockReturnValueOnce(okJson(session));
    vi.stubGlobal('fetch', fetch);

    await expect(
      answerAskUser('stale_token', 'w_core', 'run_1', 'call_question', [
        { id: 'plan', selectedOptionId: 'a', text: 'A', isOther: false }
      ])
    ).resolves.toEqual(session);

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/w_core/ask-user/run_1/call_question/answers', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer stale_token' },
      body: JSON.stringify({
        answers: [{ id: 'plan', selectedOptionId: 'a', text: 'A', isOther: false }]
      })
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/workspaces/w_core/ask-user/run_1/call_question/answers', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: [{ id: 'plan', selectedOptionId: 'a', text: 'A', isOther: false }]
      })
    });
  });

  it('retries optional chat approval decisions without auth when a stale token is rejected', async () => {
    const unauthorized = Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { code: 'auth.unauthorized' } })
    } as Response);
    const fetch = vi
      .fn()
      .mockReturnValueOnce(unauthorized)
      .mockReturnValueOnce(okJson(session))
      .mockReturnValueOnce(unauthorized)
      .mockReturnValueOnce(okJson(session));
    vi.stubGlobal('fetch', fetch);

    await expect(approveToolRequest('stale_token', 'w_core', 'exec_write')).resolves.toEqual(session);
    await expect(rejectToolRequest('stale_token', 'w_core', 'exec_run', 'Not needed')).resolves.toEqual(session);

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/w_core/tool-approvals/exec_write/approve', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer stale_token' },
      body: JSON.stringify({})
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/workspaces/w_core/tool-approvals/exec_write/approve', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/v1/workspaces/w_core/tool-approvals/exec_run/reject', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer stale_token' },
      body: JSON.stringify({ reason: 'Not needed' })
    });
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/v1/workspaces/w_core/tool-approvals/exec_run/reject', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Not needed' })
    });
  });
});
