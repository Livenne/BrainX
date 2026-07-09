import type {
  ApprovalPolicy,
  AskUserAnswer,
  AuthResponse,
  BindCodeResponse,
  ChatSession,
  ChatAttachmentInput,
  ClientDaemon,
  ExecutionEvent,
  SkillInventory,
  SkillProposal,
  Workspace
} from '../domain/types';

const API_BASE = '/api/v1';

export async function getChatSession(workspaceId: string): Promise<ChatSession> {
  return requestJson<ChatSession>(`/workspaces/${encodeURIComponent(workspaceId)}/chat/session`, jsonInit());
}

export async function getChatSessionById(workspaceId: string, sessionId: string): Promise<ChatSession> {
  return requestJson<ChatSession>(
    `/workspaces/${encodeURIComponent(workspaceId)}/chat/sessions/${encodeURIComponent(sessionId)}`,
    jsonInit()
  );
}

export async function getChatSessions(workspaceId: string): Promise<ChatSession[]> {
  return requestJson<ChatSession[]>(`/workspaces/${encodeURIComponent(workspaceId)}/chat/sessions`, jsonInit());
}

export async function getSkillInventory(workspaceId: string): Promise<SkillInventory> {
  return requestJson<SkillInventory>(`/workspaces/${encodeURIComponent(workspaceId)}/skills`, jsonInit());
}

export async function getSkillProposals(): Promise<SkillProposal[]> {
  return requestJson<SkillProposal[]>('/skill-proposals', jsonInit());
}

export async function approveSkillProposal(proposalId: string): Promise<SkillProposal> {
  return requestJson<SkillProposal>(`/skill-proposals/${encodeURIComponent(proposalId)}/approve`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
}

export async function rejectSkillProposal(proposalId: string): Promise<SkillProposal> {
  return requestJson<SkillProposal>(`/skill-proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({})
  });
}

export async function createChatSession(workspaceId: string, title?: string): Promise<ChatSession> {
  return requestJson<ChatSession>(`/workspaces/${encodeURIComponent(workspaceId)}/chat/sessions`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(title ? { title } : {})
  });
}

export async function getWorkspaces(token: string): Promise<Workspace[]> {
  return requestJson<Workspace[]>('/workspaces', jsonInit(token));
}

export async function sendChatMessage(
  workspaceId: string,
  content: string,
  attachments: ChatAttachmentInput[] = []
): Promise<ChatSession> {
  return requestJson<ChatSession>(`/workspaces/${encodeURIComponent(workspaceId)}/chat/messages`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ content, attachments })
  });
}

export async function sendSessionChatMessage(
  workspaceId: string,
  sessionId: string,
  content: string,
  attachments: ChatAttachmentInput[] = []
): Promise<ChatSession> {
  return requestJson<ChatSession>(
    `/workspaces/${encodeURIComponent(workspaceId)}/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ content, attachments })
    }
  );
}

export async function renameChatSession(workspaceId: string, sessionId: string, title: string): Promise<ChatSession> {
  return requestJson<ChatSession>(
    `/workspaces/${encodeURIComponent(workspaceId)}/chat/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ title })
    }
  );
}

export async function forkChatSession(workspaceId: string, sessionId: string): Promise<ChatSession> {
  return requestJson<ChatSession>(
    `/workspaces/${encodeURIComponent(workspaceId)}/chat/sessions/${encodeURIComponent(sessionId)}/fork`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({})
    }
  );
}

export async function cancelChatSession(workspaceId: string, sessionId: string): Promise<ChatSession> {
  return requestJson<ChatSession>(
    `/workspaces/${encodeURIComponent(workspaceId)}/chat/sessions/${encodeURIComponent(sessionId)}/cancel`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({})
    }
  );
}

export async function deleteChatSession(workspaceId: string, sessionId: string): Promise<void> {
  await requestJson<{ accepted: boolean }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/chat/sessions/${encodeURIComponent(sessionId)}?confirm=true`,
    {
      method: 'DELETE',
      headers: jsonHeaders()
    }
  );
}

export async function sendChatCommand(
  workspaceId: string,
  command: string,
  args: Record<string, unknown> = {}
): Promise<ChatSession> {
  return requestJson<ChatSession>(`/workspaces/${encodeURIComponent(workspaceId)}/chat/commands`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ command, arguments: args })
  });
}

export async function sendSessionChatCommand(
  workspaceId: string,
  sessionId: string,
  command: string,
  args: Record<string, unknown> = {}
): Promise<ChatSession> {
  return requestJson<ChatSession>(
    `/workspaces/${encodeURIComponent(workspaceId)}/chat/sessions/${encodeURIComponent(sessionId)}/commands`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ command, arguments: args })
    }
  );
}

export async function pollChatSession(workspaceId: string): Promise<ChatSession> {
  return getChatSession(workspaceId);
}

export async function getRunEvents(agentId: string, runId: string): Promise<ExecutionEvent[]> {
  return requestJson<ExecutionEvent[]>(
    `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
    jsonInit()
  );
}

export function subscribeChatEvents(
  workspaceId: string,
  runId: string,
  afterSequence: number,
  onEvent: (event: ExecutionEvent) => void,
  onError?: (error: Event) => void
): () => void {
  const params = new URLSearchParams({ runId, after: String(afterSequence) });
  const source = new EventSource(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/chat/events?${params.toString()}`);
  source.addEventListener('model.stream.delta', (event) => {
    const message = event as MessageEvent<string>;
    onEvent(JSON.parse(message.data) as ExecutionEvent);
  });
  source.onerror = (event) => {
    onError?.(event);
  };
  return () => source.close();
}

export async function registerUser(username: string, password: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/auth/register', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ username, password })
  });
}

export async function loginUser(username: string, password: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/auth/login', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ username, password })
  });
}

export async function logoutUser(token: string): Promise<void> {
  await requestJson<{ accepted: boolean }>('/auth/logout', {
    method: 'POST',
    headers: jsonHeaders(token)
  });
}

export async function getClientDaemons(token: string): Promise<ClientDaemon[]> {
  const daemons = await requestJson<ServerClientDaemon[]>('/client-daemons', jsonInit(token));
  return daemons.map(toClientDaemon);
}

export async function completeClientBind(token: string, code: string): Promise<ClientDaemon> {
  const daemon = await requestJson<ServerClientDaemon>('/client-daemons/complete-bind', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ code })
  });
  return toClientDaemon(daemon);
}

export async function unbindClientDaemon(token: string, daemonId: string): Promise<void> {
  await requestJson<{ accepted: boolean }>(`/client-daemons/${encodeURIComponent(daemonId)}/unbind`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ confirm: true })
  });
}

export async function updateApprovalPolicy(
  token: string,
  workspaceId: string,
  mode: ApprovalPolicy['mode']
): Promise<ApprovalPolicy> {
  return requestJson<ApprovalPolicy>(`/workspaces/${encodeURIComponent(workspaceId)}/approval-policy`, {
    method: 'PATCH',
    headers: jsonHeaders(token),
    body: JSON.stringify({ mode })
  });
}

export async function approveToolRequest(token: string, workspaceId: string, executionId: string): Promise<ChatSession> {
  return requestOptionalAuthJson<ChatSession>(
    token,
    `/workspaces/${encodeURIComponent(workspaceId)}/tool-approvals/${encodeURIComponent(executionId)}/approve`,
    (authToken) => ({
      method: 'POST',
      headers: jsonHeaders(authToken),
      body: JSON.stringify({})
    })
  );
}

export async function rejectToolRequest(
  token: string,
  workspaceId: string,
  executionId: string,
  reason: string
): Promise<ChatSession> {
  return requestOptionalAuthJson<ChatSession>(
    token,
    `/workspaces/${encodeURIComponent(workspaceId)}/tool-approvals/${encodeURIComponent(executionId)}/reject`,
    (authToken) => ({
      method: 'POST',
      headers: jsonHeaders(authToken),
      body: JSON.stringify({ reason })
    })
  );
}

export async function answerAskUser(
  token: string,
  workspaceId: string,
  runId: string,
  toolCallId: string,
  answers: AskUserAnswer[]
): Promise<ChatSession> {
  const path = `/workspaces/${encodeURIComponent(workspaceId)}/ask-user/${encodeURIComponent(runId)}/${encodeURIComponent(toolCallId)}/answers`;
  return requestOptionalAuthJson<ChatSession>(token, path, (authToken) => ({
    method: 'POST',
    headers: jsonHeaders(authToken),
    body: JSON.stringify({ answers })
  }));
}

class BrainxApiRequestError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message?.trim() || `brainx API request failed: ${status}`);
  }
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new BrainxApiRequestError(response.status, await errorMessage(response));
  }
  return response.json() as Promise<T>;
}

async function errorMessage(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
      return payload.error.message;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function requestOptionalAuthJson<T>(
  token: string,
  path: string,
  init: (authToken?: string) => RequestInit
): Promise<T> {
  try {
    return await requestJson<T>(path, init(token));
  } catch (error) {
    if (token && error instanceof BrainxApiRequestError && error.status === 401) {
      return requestJson<T>(path, init());
    }
    throw error;
  }
}

function jsonInit(token?: string): RequestInit {
  return { headers: jsonHeaders(token) };
}

function jsonHeaders(token?: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

type ServerClientDaemon = {
  id: string;
  workspaceId: string;
  userId?: string | null;
  deviceName: string;
  status: ClientDaemon['status'];
  capabilities: string[];
  boundAt?: string;
  lastHeartbeatAt?: string;
};

function toClientDaemon(daemon: ServerClientDaemon): ClientDaemon {
  const lastHeartbeatSeconds = daemon.lastHeartbeatAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(daemon.lastHeartbeatAt)) / 1000))
    : 0;
  return {
    id: daemon.id,
    workspaceId: daemon.workspaceId,
    userId: daemon.userId ?? null,
    name: 'brainx client',
    deviceName: daemon.deviceName,
    os: 'Local device',
    status: daemon.status,
    version: '0.1.0',
    activeTasks: 0,
    lastHeartbeatSeconds,
    note: daemon.capabilities.join(', '),
    registeredAt: daemon.boundAt ?? daemon.lastHeartbeatAt ?? new Date().toISOString(),
    boundAt: daemon.boundAt,
    lastHeartbeatAt: daemon.lastHeartbeatAt,
    workspacePath: daemon.workspaceId,
    capabilities: daemon.capabilities
  };
}
