package com.brainx.server.core;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class BrainxState {
  private static final String DEV_WORKSPACE_ID = "w_core";
  private static final String DEV_AGENT_ID = "a_core";
  private static final String DEV_BRANCH_ID = "br_core";
  private static final String DEV_CHAT_SESSION_ID = "chat_main";
  private static final String DEFAULT_CURRENT_WORKSPACE = "~/.brainx/workspace";
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Set<String> SAFE_TOOLS = Set.of("get_env", "read_files", "search_workspace", "web_search", "background_read", "ask_user", "todo_update", "subagent_start", "subagent_read", "subagent_stop");
  private static final Set<String> RISKY_TOOLS = Set.of("apply_patch", "write_file", "run_command", "background_start", "background_stop");
  private static final Set<String> BROWSER_TOOLS = Set.of("ask_user");
  private static final Set<String> SERVER_TOOLS = Set.of("todo_update", "subagent_start", "subagent_read", "subagent_stop");
  private static final Set<String> LOCAL_TOOLS = Set.of("get_env", "read_files", "search_workspace", "web_search", "apply_patch", "write_file", "run_command", "background_start", "background_read", "background_stop", "skill.apply");
  private static final Set<String> SUPPORTED_TOOLS = union(union(LOCAL_TOOLS, BROWSER_TOOLS), SERVER_TOOLS);
  private static final Set<String> ZERO_ARGUMENT_TOOLS = Set.of("get_env");
  private static final Set<String> CHAT_COMMANDS = Set.of("compact", "clear", "new", "model", "session", "fork", "init", "rename", "delete", "workspace");
  private static final String DEFAULT_MODEL_NAME = "nvidia-step";
  private static final int DEFAULT_CONTEXT_WINDOW = 128_000;
  private static final int MAX_TOOL_RESULT_MESSAGE_CHARS = 64_000;
  private static final int MAX_ATTACHMENTS_PER_MESSAGE = 15;
  private static final int MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
  private static final int MAX_TEXT_ATTACHMENT_BYTES = 512 * 1024;
  private static final int MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
  private static final String AGENT_LOOP_SYSTEM_PROMPT = """
      You are brainx, a local coding agent for project work.

      Operating model:
      - You work through a browser/server/client architecture. The server provides the conversation context. The local client executes model requests and local tools.
      - Use only the tools explicitly available in the current request. Do not invent tools, aliases, APIs, or hidden capabilities.
      - If a capability is not available, say so plainly and continue with the best available approach.
      - Respond in the user's language unless the user asks otherwise.

      Core behavior:
      - For ordinary conversation, conceptual questions, or stable knowledge already present in context, answer directly without tool calls.
      - For workspace facts, file contents, command results, current environment, or verification, use tools instead of guessing.
      - Explore before changing files. Read the relevant file content before write_file or edit_file.
      - Keep changes minimal and scoped to the user's request.
      - Use todo tools for non-trivial multi-step work. Keep the task list short and current.
      - Use run_command only for short, non-interactive commands. Use terminal tools for long-running, watch, server, or interactive processes.
      - When tool calls fail, read the error, adjust if possible, and continue. Do not hide tool failures.
      - Do not claim that a command, file change, test, or tool action happened unless the corresponding tool result is present.
      - When work is complete, summarize what changed and include concrete verification evidence when available.

      Safety and boundaries:
      - Do not reveal secrets, API keys, tokens, or private credentials.
      - Do not run destructive commands or overwrite files unless the user requested that class of change or the task clearly requires it.
      - Reads may inspect necessary paths, but writes and command execution must stay within the current workspace as enforced by the runtime.
      - Ask the user only when blocked by missing intent, preference, approval, or external information that cannot be discovered from available tools.
      """;

  private final long askUserTimeoutSeconds;
  private final Map<String, WorkspaceRecord> workspaces = new LinkedHashMap<>();
  private final Map<String, AgentRecord> agents = new LinkedHashMap<>();
  private final Map<String, BranchRecord> branches = new LinkedHashMap<>();
  private final Map<String, RunRecord> runs = new LinkedHashMap<>();
  private final Map<String, ClientDaemonRecord> daemons = new LinkedHashMap<>();
  private final Map<String, List<String>> workspaceIdsByDaemon = new LinkedHashMap<>();
  private final Map<String, UserRecord> users = new LinkedHashMap<>();
  private final Map<String, String> userIdsByUsername = new LinkedHashMap<>();
  private final Map<String, AuthSessionRecord> authSessions = new LinkedHashMap<>();
  private final Map<String, ClientBindCodeRecord> bindCodes = new LinkedHashMap<>();
  private final Map<String, ApprovalPolicyRecord> approvalPolicies = new LinkedHashMap<>();
  private final Map<String, String> activeModelNamesByWorkspace = new LinkedHashMap<>();
  private final Map<String, List<Map<String, Object>>> availableModelsByWorkspace = new LinkedHashMap<>();
  private final Map<String, Map<String, Object>> lastTokenUsageByWorkspace = new LinkedHashMap<>();
  private final Map<String, ExecutionRequestRecord> executionRequests = new LinkedHashMap<>();
  private final Map<String, SkillProposalRecord> skillProposals = new LinkedHashMap<>();
  private final Map<String, Map<String, Object>> skillInventoryByDaemon = new LinkedHashMap<>();
  private final Map<String, String> skillProposalExecutionIds = new LinkedHashMap<>();
  private final Map<String, Map<String, Object>> subagentTasks = new LinkedHashMap<>();
  private final Map<String, ChatSessionRecord> chatSessions = new LinkedHashMap<>();
  private final Map<String, String> chatSessionIdsByRun = new LinkedHashMap<>();
  private final Map<String, List<RunStepRecord>> runSteps = new LinkedHashMap<>();
  private final Map<String, List<ExecutionEventRecord>> executionEvents = new LinkedHashMap<>();
  private final Set<String> streamEventKeys = new HashSet<>();

  private record NormalizedToolCall(String callId, String toolName, Map<String, Object> arguments) {}

  private static Set<String> union(Set<String> first, Set<String> second) {
    var result = new HashSet<String>();
    result.addAll(first);
    result.addAll(second);
    return Set.copyOf(result);
  }

  public BrainxState(@Value("${brainx.ask-user-timeout-seconds:120}") long askUserTimeoutSeconds) {
    this.askUserTimeoutSeconds = Math.max(0, askUserTimeoutSeconds);
    seedLocalWorkspace();
  }

  public synchronized AuthResponse registerUser(String username, String password) {
    var normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    if (userIdsByUsername.containsKey(normalizedUsername)) {
      throw new StateConflictException("Username is already registered.");
    }
    var salt = randomToken(18);
    var user = new UserRecord(id("u"), normalizedUsername, passwordHash(password, salt), salt, Instant.now());
    users.put(user.id(), user);
    userIdsByUsername.put(user.username(), user.id());
    return createSession(user);
  }

  public synchronized AuthResponse login(String username, String password) {
    var user = requireUserByUsername(username);
    if (!passwordMatches(user, password)) {
      throw new UnauthorizedException("Invalid username or password.");
    }
    return createSession(user);
  }

  public synchronized UserView currentUser(String token) {
    return requireUserByToken(token).view();
  }

  public synchronized void logout(String token) {
    authSessions.remove(requireToken(token));
  }

  public synchronized BindCodeResponse createBindCode(
      String token,
      String workspaceId,
      String deviceName,
      String password,
      List<String> capabilities
  ) {
    var user = requireUserByToken(token);
    if (!passwordMatches(user, password)) {
      throw new UnauthorizedException("Password verification failed.");
    }
    requireWorkspace(workspaceId);
    var code = uniqueBindCode();
    var expiresAt = Instant.now().plus(5, ChronoUnit.MINUTES);
    bindCodes.put(code, new ClientBindCodeRecord(
        code,
        user.id(),
        null,
        workspaceId,
        deviceName,
        List.copyOf(capabilities == null ? List.of() : capabilities),
        expiresAt,
        null
    ));
    return new BindCodeResponse(code, expiresAt);
  }

  public synchronized BindCodeResponse createBindCodeForDaemon(String daemonId) {
    var daemon = requireDaemon(daemonId);
    if (!"active".equals(daemon.status())) {
      throw new ForbiddenException("Client daemon is not active.");
    }
    if (daemon.userId() != null && !daemon.userId().isBlank()) {
      throw new StateConflictException("Client daemon is already bound.");
    }
    var code = uniqueBindCode();
    var expiresAt = Instant.now().plus(5, ChronoUnit.MINUTES);
    bindCodes.put(code, new ClientBindCodeRecord(
        code,
        null,
        daemon.id(),
        daemon.workspaceId(),
        daemon.deviceName(),
        daemon.capabilities(),
        expiresAt,
        null
    ));
    return new BindCodeResponse(code, expiresAt);
  }

  public synchronized ClientDaemonRecord completeBind(String token, String code) {
    var user = requireUserByToken(token);
    var normalizedCode = code == null ? "" : code.trim().toUpperCase();
    var bindCode = bindCodes.get(normalizedCode);
    if (bindCode == null) {
      throw new NotFoundException("Bind code not found.");
    }
    if (bindCode.userId() != null && !bindCode.userId().equals(user.id())) {
      throw new ForbiddenException("Bind code belongs to a different user.");
    }
    var now = Instant.now();
    if (bindCode.usedAt() != null) {
      throw new StateConflictException("Bind code has already been used.");
    }
    if (bindCode.expiresAt().isBefore(now)) {
      throw new StateConflictException("Bind code has expired.");
    }
    var daemon = bindCode.daemonId() == null || bindCode.daemonId().isBlank()
        ? new ClientDaemonRecord(
            id("cd"),
            bindCode.workspaceId(),
            user.id(),
            bindCode.deviceName(),
            "active",
            bindCode.capabilities(),
            now,
            now
        )
        : requireDaemon(bindCode.daemonId()).boundTo(user.id(), now);
    daemons.put(daemon.id(), daemon);
    bindCodes.put(bindCode.code(), bindCode.used(now));
    return daemon;
  }

  public synchronized List<ClientDaemonRecord> clientDaemons(String token) {
    var user = requireUserByToken(token);
    return daemons.values().stream()
        .filter(daemon -> user.id().equals(daemon.userId()))
        .toList();
  }

  public synchronized void unbindDaemon(String token, String daemonId, boolean confirm) {
    if (!confirm) {
      throw new BadRequestException("Unbind requires explicit confirmation.");
    }
    var user = requireUserByToken(token);
    var daemon = requireDaemon(daemonId);
    if (daemon.userId() != null && !daemon.userId().equals(user.id())) {
      throw new ForbiddenException("Client daemon belongs to a different user.");
    }
    daemons.put(daemon.id(), daemon.withStatus("revoked", Instant.now()));
  }

  public synchronized void unbindDaemon(String daemonId, boolean confirm) {
    if (!confirm) {
      throw new BadRequestException("Unbind requires explicit confirmation.");
    }
    var daemon = requireDaemon(daemonId);
    daemons.put(daemon.id(), daemon.withStatus("revoked", Instant.now()));
  }

  public synchronized ApprovalPolicyRecord approvalPolicy(String token, String workspaceId, String mode) {
    requireUserByToken(token);
    requireWorkspace(workspaceId);
    var normalizedMode = normalizeApprovalMode(mode);
    var policy = new ApprovalPolicyRecord(
        workspaceId,
        normalizedMode,
        List.of(
            Map.of("category", "safe", "approval", "none", "description", "Safe tools execute without browser approval."),
            Map.of("category", "risky", "approval", approvalTextForRisky(normalizedMode), "description", "Risky tools require browser approval in default mode and run directly in full_accept mode.")
        )
    );
    approvalPolicies.put(workspaceId, policy);
    return policy;
  }

  public synchronized List<WorkspaceRecord> workspaces(String token) {
    var user = requireUserByToken(token);
    var userWorkspaceIds = workspaceIdsForUser(user.id());
    return workspaces.values().stream()
        .filter(workspace -> "active".equals(workspace.status()))
        .filter(workspace -> DEV_WORKSPACE_ID.equals(workspace.id()) || userWorkspaceIds.contains(workspace.id()))
        .toList();
  }

  public synchronized WorkspaceRecord createWorkspace(String name) {
    var workspace = new WorkspaceRecord(id("w"), name, "", false, "active", Instant.now());
    workspaces.put(workspace.id(), workspace);
    seedWorkspaceRuntime(workspace.id(), workspace.name());
    return workspace;
  }

  public synchronized void syncClientWorkspaces(String token, String daemonId, List<ClientWorkspaceRecord> syncedWorkspaces) {
    var user = requireUserByToken(token);
    var daemon = requireDaemon(daemonId);
    if (daemon.userId() != null && !daemon.userId().equals(user.id())) {
      throw new ForbiddenException("Client daemon belongs to a different user.");
    }
    if (!"active".equals(daemon.status())) {
      throw new ForbiddenException("Client daemon is not active.");
    }
    if (syncedWorkspaces == null || syncedWorkspaces.isEmpty()) {
      throw new BadRequestException("At least one workspace is required.");
    }

    var now = Instant.now();
    var nextWorkspaceIds = new ArrayList<String>();
    for (var synced : syncedWorkspaces) {
      var workspaceId = requiredText(synced.id(), "workspace id");
      if (nextWorkspaceIds.contains(workspaceId)) {
        throw new StateConflictException("Duplicate workspace id: " + workspaceId);
      }
      nextWorkspaceIds.add(workspaceId);
      var existing = workspaces.get(workspaceId);
      var createdAt = existing == null ? now : existing.createdAt();
      workspaces.put(workspaceId, new WorkspaceRecord(
          workspaceId,
          requiredText(synced.name(), "workspace name"),
          requiredText(synced.path(), "workspace path"),
          synced.defaultWorkspace(),
          "active",
          createdAt
      ));
      if (existing == null) {
        seedWorkspaceRuntime(workspaceId, synced.name());
      }
    }

    var previousWorkspaceIds = workspaceIdsByDaemon.getOrDefault(daemonId, List.of());
    workspaceIdsByDaemon.put(daemonId, List.copyOf(nextWorkspaceIds));
    for (var previousWorkspaceId : previousWorkspaceIds) {
      if (!nextWorkspaceIds.contains(previousWorkspaceId) && !DEV_WORKSPACE_ID.equals(previousWorkspaceId)) {
        removeWorkspaceIfNoActiveDaemonUses(previousWorkspaceId);
      }
    }
  }

  public synchronized AgentRecord createAgent(String workspaceId, String name) {
    requireWorkspace(workspaceId);
    var branch = new BranchRecord(id("br"), workspaceId, null, "main", "Default branch", "active", Instant.now());
    var agent = new AgentRecord(id("a"), workspaceId, name, "active", branch.id(), Instant.now());
    var resolvedBranch = new BranchRecord(branch.id(), workspaceId, agent.id(), branch.name(), branch.description(), branch.status(), branch.createdAt());
    agents.put(agent.id(), agent);
    branches.put(resolvedBranch.id(), resolvedBranch);
    return agent;
  }

  public synchronized RunRecord createRun(String agentId, String goal) {
    var agent = requireAgent(agentId);
    var run = new RunRecord(id("run"), agent.workspaceId(), agent.id(), agent.defaultBranchId(), goal, "waiting_for_client", "", Instant.now());
    runs.put(run.id(), run);
    recordEvent(run.id(), "agent.run.created", "Run created for agent task.", null);
    var execution = ExecutionRequestRecord.mockProvider(
        id("exec"),
        agent.workspaceId(),
        agent.id(),
        agent.defaultBranchId(),
        run.id(),
        goal
    );
    executionRequests.put(execution.executionId(), execution);
    recordStep(run.id(), "execution_request", "waiting_for_client", execution.executionId());
    recordEvent(
        run.id(),
        "execution.requested",
        "Requested mock provider execution.",
        execution.riskTier(),
        execution.executionId(),
        Map.of("toolName", execution.toolName())
    );
    return run;
  }

  public synchronized ChatSessionRecord getChatSession(String workspaceId) {
    requireWorkspace(workspaceId);
    expireTimedOutAskUser(Instant.now());
    return primaryChatSession(workspaceId)
        .map(this::sessionForResponse)
        .orElseThrow(() -> new NotFoundException("Chat session not found."));
  }

  public synchronized List<ChatSessionRecord> chatSessions(String workspaceId) {
    requireWorkspace(workspaceId);
    expireTimedOutAskUser(Instant.now());
    return chatSessions.values().stream()
        .filter(session -> session.workspaceId().equals(workspaceId))
        .map(this::sessionForResponse)
        .toList();
  }

  public synchronized ChatSessionRecord getChatSession(String workspaceId, String sessionId) {
    requireWorkspace(workspaceId);
    expireTimedOutAskUser(Instant.now());
    var session = requireChatSession(sessionId);
    if (!workspaceId.equals(session.workspaceId())) {
      throw new NotFoundException("Chat session not found.");
    }
    return sessionForResponse(session);
  }

  public synchronized ChatSessionRecord createChatSession(String workspaceId, String title) {
    var workspace = requireWorkspace(workspaceId);
    var runtime = primaryChatSession(workspaceId).orElseThrow(() -> new NotFoundException("Chat session not found."));
    var now = Instant.now();
    var sessionId = id("chat");
    var session = new ChatSessionRecord(
        sessionId,
        normalizedSessionTitle(title),
        null,
        sessionId,
        null,
        workspace.id(),
        workspace.name(),
        runtime.currentWorkspace(),
        runtime.agentId(),
        runtime.agentName(),
        runtime.branchId(),
        runtime.branchName(),
        runtime.skillName(),
        runtime.clientName(),
        "",
        "completed",
        List.of(),
        List.of(),
        List.of(),
        Map.of(),
        Map.of(),
        defaultAvailableModels(),
        activeModelName(workspaceId),
        List.of(),
        List.of(),
        now,
        now,
        List.of()
    );
    chatSessions.put(session.id(), session);
    return sessionForResponse(session);
  }

  public synchronized ChatSessionRecord renameChatSession(String workspaceId, String sessionId, String title) {
    var session = getRawChatSession(workspaceId, sessionId);
    var updated = session.withTitle(normalizedSessionTitle(title), Instant.now());
    chatSessions.put(updated.id(), updated);
    recordEventForSession(updated, "chat.session.renamed", "Chat session renamed.", Map.of("title", stringValue(updated.title())));
    return sessionForResponse(updated);
  }

  public synchronized ChatSessionRecord sendChatMessage(String workspaceId, String content, List<Map<String, Object>> attachments) {
    var session = primaryChatSession(workspaceId).orElseThrow(() -> new NotFoundException("Chat session not found."));
    return sendChatMessage(workspaceId, session.id(), content, attachments);
  }

  public synchronized ChatSessionRecord sendChatMessage(String workspaceId, String sessionId, String content, List<Map<String, Object>> attachments) {
    var session = getRawChatSession(workspaceId, sessionId);
    if (isActiveRunStatus(session.runStatus())) {
      return queueChatInput(session, content, attachments);
    }

    return startChatRun(session, List.of(queuedInputPayload(content, attachments, Instant.now())), content);
  }

  public synchronized ChatSessionRecord forkChatSession(String workspaceId, String sessionId) {
    var session = getRawChatSession(workspaceId, sessionId);
    if (isActiveRunStatus(session.runStatus())) {
      throw new StateConflictException("Cannot fork a session while its run is active.");
    }
    var now = Instant.now();
    var forkId = id("chat");
    var suffix = forkId.substring("chat_".length(), "chat_".length() + 5);
    var baseTitle = stringValue(session.title()).isBlank() ? "新的会话" : session.title();
    var forked = new ChatSessionRecord(
        forkId,
        baseTitle + " [fork: " + suffix + "]",
        session.id(),
        stringValue(session.rootSessionId()).isBlank() ? session.id() : session.rootSessionId(),
        session.id(),
        session.workspaceId(),
        session.workspaceName(),
        session.currentWorkspace(),
        session.agentId(),
        session.agentName(),
        session.branchId(),
        session.branchName(),
        session.skillName(),
        session.clientName(),
        "",
        "completed",
        session.todos(),
        session.terminals(),
        session.subagents(),
        Map.of(),
        Map.of(),
        defaultAvailableModels(),
        activeModelName(workspaceId),
        List.of(),
        session.timelineNotices(),
        now,
        now,
        session.messages()
    );
    chatSessions.put(forked.id(), forked);
    return sessionForResponse(forked);
  }

  public synchronized void deleteChatSession(String workspaceId, String sessionId, boolean confirm) {
    if (!confirm) {
      throw new BadRequestException("Delete session requires explicit confirmation.");
    }
    var root = getRawChatSession(workspaceId, sessionId);
    var idsToDelete = descendantSessionIds(root.id());
    for (var idToDelete : idsToDelete) {
      var session = chatSessions.get(idToDelete);
      if (session != null) {
        cancelSessionInternal(session, "Session deleted.", false);
      }
    }
    for (var idToDelete : idsToDelete) {
      chatSessions.remove(idToDelete);
    }
    chatSessionIdsByRun.entrySet().removeIf(entry -> idsToDelete.contains(entry.getValue()));
  }

  public synchronized ChatSessionRecord cancelChatSession(String workspaceId, String sessionId) {
    var session = getRawChatSession(workspaceId, sessionId);
    return sessionForResponse(cancelSessionInternal(session, "Run cancelled by user.", true));
  }

  private ChatSessionRecord queueChatInput(ChatSessionRecord session, String content, List<Map<String, Object>> attachments) {
    var now = Instant.now();
    var queuedInputs = new ArrayList<>(session.queuedInputs());
    var queuedInput = queuedInputPayload(content, attachments, now);
    queuedInputs.add(Map.copyOf(queuedInput));
    var updated = session.withQueuedInputs(queuedInputs, now);
    chatSessions.put(updated.id(), updated);
    recordEventForSession(
        session,
        "chat.message.queued",
        "Queued user message for next safe turn.",
        Map.of("queuedInputId", queuedInput.get("id"), "queueSize", queuedInputs.size())
    );
    return sessionForResponse(updated);
  }

  private Map<String, Object> queuedInputPayload(String content, List<Map<String, Object>> attachments, Instant now) {
    var queuedInput = new LinkedHashMap<String, Object>();
    queuedInput.put("id", id("qmsg"));
    queuedInput.put("content", content);
    queuedInput.put("attachments", normalizeAttachments(attachments));
    queuedInput.put("createdAt", now.toString());
    return Map.copyOf(queuedInput);
  }

  private ChatSessionRecord startChatRun(ChatSessionRecord session, List<Map<String, Object>> inputs, String goal) {
    var now = Instant.now();
    var run = new RunRecord(id("run"), session.workspaceId(), session.agentId(), session.branchId(), goal, "waiting_for_client", "", now);
    runs.put(run.id(), run);
    chatSessionIdsByRun.put(run.id(), session.id());
    recordEvent(run.id(), "agent.run.created", "Chat run created.", null);

    var messages = new ArrayList<>(session.messages());
    for (var input : inputs) {
      messages.add(userMessage(stringValue(input.get("content")), asMapList(input.get("attachments"))));
    }

    var updated = session.withQueuedInputs(List.of(), now).withRun(run.id(), run.status(), now).withMessages(messages, run.status(), now);
    chatSessions.put(updated.id(), updated);

    var execution = ExecutionRequestRecord.modelInvoke(
        id("exec"),
        session.workspaceId(),
        session.agentId(),
        session.branchId(),
        run.id(),
        "agent_loop",
        0,
        agentLoopMessages(updated),
        List.of(),
        activeModelName(session.workspaceId()),
        updated.currentWorkspace()
    );
    executionRequests.put(execution.executionId(), execution);
    recordStep(run.id(), "execution_request", "waiting_for_client", execution.executionId());
    recordEvent(
        run.id(),
        "execution.requested",
        "Requested client-side agent loop.",
        execution.riskTier(),
        execution.executionId(),
        Map.of("toolName", execution.toolName(), "phase", "agent_loop")
    );
    return sessionForResponse(updated);
  }

  private Map<String, Object> userMessage(String content, List<Map<String, Object>> attachments) {
    var normalizedAttachments = normalizeAttachments(attachments);
    if (normalizedAttachments.isEmpty()) {
      return Map.of("role", "user", "content", content);
    }

    var parts = new ArrayList<Map<String, Object>>();
    if (!stringValue(content).isBlank()) {
      parts.add(Map.of("type", "text", "text", content));
    }
    for (var attachment : normalizedAttachments) {
      var dataUrl = stringValue(attachment.get("dataUrl"));
      var mimeType = stringValue(attachment.get("mimeType"));
      var kind = stringValue(attachment.get("kind"));
      if ((kind.equals("image") || mimeType.startsWith("image/") || dataUrl.startsWith("data:image/")) && !dataUrl.isBlank()) {
        parts.add(Map.of(
            "type", "image_url",
            "image_url", Map.of("url", dataUrl)
        ));
      } else {
        parts.add(Map.of(
            "type", "text",
            "text", attachmentTextContent(attachment)
        ));
      }
    }

    return Map.of(
        "role", "user",
        "content", List.copyOf(parts),
        "attachments", normalizedAttachments
    );
  }

  private String attachmentTextContent(Map<String, Object> attachment) {
    var name = stringValue(attachment.get("name"));
    var mimeType = stringValue(attachment.get("mimeType"));
    var size = intValue(attachment.get("size"));
    var content = stringValue(attachment.get("content"));
    return "Attached file: %s (%s, %d bytes)\n\n%s".formatted(
        name.isBlank() ? "unnamed" : name,
        mimeType.isBlank() ? "application/octet-stream" : mimeType,
        Math.max(0, size),
        content
    );
  }

  private List<Map<String, Object>> normalizeAttachments(List<Map<String, Object>> attachments) {
    if (attachments == null || attachments.isEmpty()) {
      return List.of();
    }
    if (attachments.size() > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException("A message can include at most " + MAX_ATTACHMENTS_PER_MESSAGE + " attachments.");
    }
    var totalBytes = 0;
    var normalizedAttachments = new ArrayList<Map<String, Object>>();
    for (var attachment : attachments) {
      var normalized = new LinkedHashMap<String, Object>();
      var mimeType = stringValue(attachment.get("mimeType")).toLowerCase();
      var kind = stringValue(attachment.get("kind")).toLowerCase();
      var size = Math.max(0, intValue(attachment.get("size")));
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new BadRequestException("Attachment payload is too large.");
      }
      validateAttachmentPayload(kind, mimeType, size);
      normalized.put("id", stringValue(attachment.get("id")).isBlank() ? id("att") : stringValue(attachment.get("id")));
      normalized.put("name", stringValue(attachment.get("name")));
      normalized.put("mimeType", stringValue(attachment.get("mimeType")));
      normalized.put("size", size);
      normalized.put("kind", kind.isBlank() ? inferredAttachmentKind(mimeType) : kind);
      if (attachment.containsKey("content")) {
        normalized.put("content", stringValue(attachment.get("content")));
      }
      if (attachment.containsKey("dataUrl")) {
        normalized.put("dataUrl", stringValue(attachment.get("dataUrl")));
      }
      normalizedAttachments.add(Map.copyOf(normalized));
    }
    return List.copyOf(normalizedAttachments);
  }

  private void validateAttachmentPayload(String kind, String mimeType, int size) {
    if (mimeType.startsWith("video/") || mimeType.startsWith("audio/") || "video".equals(kind) || "binary".equals(kind)) {
      throw new BadRequestException("Video, audio, and binary attachments are not supported yet.");
    }
    if (mimeType.startsWith("image/") || "image".equals(kind)) {
      if (size > MAX_IMAGE_ATTACHMENT_BYTES) {
        throw new BadRequestException("Image attachment exceeds 5 MB.");
      }
      return;
    }
    if (isTextAttachment(kind, mimeType)) {
      if (size > MAX_TEXT_ATTACHMENT_BYTES) {
        throw new BadRequestException("Text attachment exceeds 512 KB.");
      }
      return;
    }
    if (!mimeType.isBlank() && !mimeType.startsWith("text/") && !"application/json".equals(mimeType)) {
      throw new BadRequestException("Unsupported attachment type: " + mimeType);
    }
  }

  private boolean isTextAttachment(String kind, String mimeType) {
    return "text".equals(kind)
        || "file".equals(kind)
        || mimeType.isBlank()
        || mimeType.startsWith("text/")
        || "application/json".equals(mimeType)
        || "application/javascript".equals(mimeType)
        || "application/typescript".equals(mimeType);
  }

  private String inferredAttachmentKind(String mimeType) {
    if (mimeType.startsWith("image/")) {
      return "image";
    }
    return "text";
  }

  private void drainNextQueuedInput(ChatSessionRecord session) {
    if (session.queuedInputs().isEmpty() || isActiveRunStatus(session.runStatus())) {
      return;
    }
    var queuedInputs = new ArrayList<>(session.queuedInputs());
    var batch = List.copyOf(queuedInputs);
    var base = session.withQueuedInputs(List.of(), Instant.now());
    chatSessions.put(base.id(), base);
    recordEventForSession(
        base,
        "chat.message.dequeued",
        "Started queued user message batch.",
        Map.of("queuedInputIds", batch.stream().map(item -> stringValue(item.get("id"))).toList(), "remainingQueueSize", 0)
    );
    startChatRun(base, batch, stringValue(batch.get(0).get("content")));
  }

  public synchronized ChatSessionRecord handleChatCommand(String workspaceId, String command, Map<String, Object> arguments) {
    var session = primaryChatSession(workspaceId).orElseThrow(() -> new NotFoundException("Chat session not found."));
    return handleChatCommand(workspaceId, session.id(), command, arguments);
  }

  public synchronized ChatSessionRecord handleChatCommand(String workspaceId, String sessionId, String command, Map<String, Object> arguments) {
    var session = getRawChatSession(workspaceId, sessionId);
    var normalized = normalizeSlashCommand(command);
    var args = arguments == null ? Map.<String, Object>of() : Map.copyOf(arguments);
    if (!CHAT_COMMANDS.contains(normalized)) {
      throw new BadRequestException("Unsupported chat command: /" + normalized);
    }
    recordEventForSession(
        session,
        "chat.command.received",
        "Chat command received.",
        Map.of("command", normalized, "arguments", args)
    );
    return switch (normalized) {
      case "clear" -> clearChatContext(session);
      case "compact" -> requestContextCompact(session);
      case "model" -> setActiveModel(session, args);
      case "workspace" -> setCurrentWorkspace(session, args);
      default -> sessionForResponse(session);
    };
  }

  private String normalizeSlashCommand(String command) {
    var normalized = command == null ? "" : command.trim().toLowerCase();
    if (normalized.startsWith("/")) {
      normalized = normalized.substring(1);
    }
    if (normalized.isBlank()) {
      throw new BadRequestException("Chat command is required.");
    }
    return switch (normalized) {
      case "workdir", "cwd", "目录", "工作目录", "切换工作目录" -> "workspace";
      case "模型", "切换模型" -> "model";
      case "清空", "清理", "清空上下文" -> "clear";
      case "压缩", "上下文压缩" -> "compact";
      default -> normalized;
    };
  }

  private Map<String, Object> timelineNotice(String kind, String message, String detail, Instant now) {
    var notice = new LinkedHashMap<String, Object>();
    notice.put("id", id("notice"));
    notice.put("kind", kind);
    notice.put("message", message);
    if (detail != null && !detail.isBlank()) {
      notice.put("detail", detail);
    }
    notice.put("createdAt", now.toString());
    return Map.copyOf(notice);
  }

  private List<Map<String, Object>> timelineNoticesWith(ChatSessionRecord session, String kind, String message, String detail, Instant now) {
    var notices = new ArrayList<>(session.timelineNotices());
    notices.add(timelineNotice(kind, message, detail, now));
    return List.copyOf(notices);
  }

  private ChatSessionRecord clearChatContext(ChatSessionRecord session) {
    if (isActiveRunStatus(session.runStatus())) {
      throw new StateConflictException("Cannot clear context while a run is active.");
    }
    var now = Instant.now();
    var clearNotice = timelineNotice("context_cleared", "已清空上下文", "", now);
    var cleared = session.withQueuedInputs(List.of(), now).withMessagesAndTimelineNotices(List.of(), List.of(clearNotice), "completed", now);
    chatSessions.put(cleared.id(), cleared);
    recordEventForSession(session, "context.cleared", "Chat context cleared.", Map.of());
    return sessionForResponse(cleared);
  }

  private ChatSessionRecord setActiveModel(ChatSessionRecord session, Map<String, Object> arguments) {
    var modelName = stringValue(arguments.get("modelName")).trim();
    if (modelName.isBlank()) {
      throw new BadRequestException("/model requires arguments.modelName.");
    }
    var exists = availableModels(session.workspaceId()).stream()
        .anyMatch(model -> modelName.equals(stringValue(model.get("name"))));
    if (!exists) {
      throw new BadRequestException("Unknown model: " + modelName);
    }
    var now = Instant.now();
    activeModelNamesByWorkspace.put(session.workspaceId(), modelName);
    var updated = session.withTimelineNotices(
        timelineNoticesWith(session, "model_changed", "已切换模型：" + modelName, modelName, now),
        now
    );
    chatSessions.put(updated.id(), updated);
    recordEventForSession(updated, "model.preference.updated", "Active model changed.", Map.of("modelName", modelName));
    return sessionForResponse(updated);
  }

  private ChatSessionRecord setCurrentWorkspace(ChatSessionRecord session, Map<String, Object> arguments) {
    if (isActiveRunStatus(session.runStatus())) {
      throw new StateConflictException("Cannot change workspace while a run is active.");
    }
    var path = stringValue(arguments.get("path")).trim();
    if (path.isBlank()) {
      throw new BadRequestException("/workspace requires arguments.path.");
    }
    var now = Instant.now();
    var withWorkspace = session.withCurrentWorkspace(path, now);
    var updated = withWorkspace.withTimelineNotices(
        timelineNoticesWith(withWorkspace, "workspace_changed", "已切换工作目录：" + path, path, now),
        now
    );
    chatSessions.put(updated.id(), updated);
    recordEventForSession(updated, "workspace.changed", "Current workspace changed.", Map.of("currentWorkspace", path));
    return sessionForResponse(updated);
  }

  private ChatSessionRecord requestContextCompact(ChatSessionRecord session) {
    if (isActiveRunStatus(session.runStatus())) {
      throw new StateConflictException("Cannot compact context while a run is active.");
    }
    if (session.messages().isEmpty()) {
      var now = Instant.now();
      var updated = session.withTimelineNotices(
          timelineNoticesWith(session, "context_compact_skipped", "没有可压缩的上下文", "", now),
          now
      );
      chatSessions.put(updated.id(), updated);
      return sessionForResponse(updated);
    }
    var now = Instant.now();
    var run = new RunRecord(id("run"), session.workspaceId(), session.agentId(), session.branchId(), "/compact", "waiting_for_client", "Context compact requested.", now);
    runs.put(run.id(), run);
    chatSessionIdsByRun.put(run.id(), session.id());
    var withRun = session.withRun(run.id(), run.status(), now);
    var updated = withRun.withTimelineNotices(
        timelineNoticesWith(withRun, "context_compaction_requested", "正在压缩上下文", "", now),
        now
    );
    chatSessions.put(updated.id(), updated);
    var execution = ExecutionRequestRecord.modelInvoke(
        id("exec"),
        session.workspaceId(),
        session.agentId(),
        session.branchId(),
        run.id(),
        "compact",
        0,
        compactModelMessages(session),
        List.of(),
        activeModelName(session.workspaceId()),
        session.currentWorkspace()
    );
    executionRequests.put(execution.executionId(), execution);
    recordStep(run.id(), "execution_request", "waiting_for_client", execution.executionId());
    recordEvent(
        run.id(),
        "context.compaction.requested",
        "Requested context compaction.",
        null,
        execution.executionId(),
        Map.of("messageCount", session.messages().size())
    );
    return sessionForResponse(updated);
  }

  private List<Map<String, Object>> compactModelMessages(ChatSessionRecord session) {
    return List.of(
        Map.of(
            "role", "system",
            "content", """
                Summarize this brainx agent conversation for future continuation.
                Preserve user intent, decisions, unresolved tasks, important tool results, file paths, commands, errors, and constraints.
                Exclude filler and duplicate content. Return concise Markdown.
                """
        ),
        Map.of("role", "user", "content", jsonString(session.messages()))
    );
  }

  public synchronized RunRecord getRun(String agentId, String runId) {
    var run = requireRun(runId);
    if (!run.agentId().equals(agentId)) {
      throw new NotFoundException("Run does not belong to agent.");
    }
    return run;
  }

  public synchronized List<ExecutionEventRecord> runEvents(String agentId, String runId) {
    var run = getRun(agentId, runId);
    expireTimedOutAskUser(Instant.now());
    return List.copyOf(executionEvents.getOrDefault(run.id(), List.of()));
  }

  public synchronized ClientDaemonRecord registerDaemon(String workspaceId, String deviceName, List<String> capabilities) {
    requireWorkspace(workspaceId);
    var now = Instant.now();
    var daemon = new ClientDaemonRecord(id("cd"), workspaceId, null, deviceName, "active", List.copyOf(capabilities), now, now);
    daemons.put(daemon.id(), daemon);
    return daemon;
  }

  public synchronized List<ExecutionRequestRecord> pendingExecutionRequests(String daemonId) {
    var daemon = requireDaemon(daemonId);
    if (!"active".equals(daemon.status())) {
      throw new ForbiddenException("Client daemon is not active.");
    }
    expireTimedOutAskUser(Instant.now());
    daemons.put(daemon.id(), daemon.heartbeat(Instant.now()));
    return executionRequests.values().stream()
        .filter(request -> daemonCanAccessWorkspace(daemon, request.workspaceId()))
        .filter(request -> "pending".equals(request.status()))
        .filter(request -> !runIsCancelled(request.runId()))
        .toList();
  }

  public synchronized List<ExecutionRequestRecord> pendingExecutionRequests(String token, String daemonId) {
    var user = requireUserByToken(token);
    var daemon = requireDaemon(daemonId);
    if (daemon.userId() != null && !daemon.userId().equals(user.id())) {
      throw new ForbiddenException("Client daemon belongs to a different user.");
    }
    return pendingExecutionRequests(daemonId);
  }

  public synchronized void completeExecution(String daemonId, ExecutionResultRecord result) {
    var daemon = requireDaemon(daemonId);
    if (!"active".equals(daemon.status())) {
      throw new ForbiddenException("Client daemon is not active.");
    }
    var request = executionRequests.get(result.executionId());
    if (request == null) {
      throw new NotFoundException("Execution request not found.");
    }
    if (!daemonCanAccessWorkspace(daemon, request.workspaceId())) {
      throw new StateConflictException("Execution request does not belong to daemon workspace.");
    }
    if (!"pending".equals(request.status())) {
      return;
    }
    if (runIsCancelled(request.runId())) {
      executionRequests.put(request.executionId(), request.withStatus("cancelled"));
      return;
    }
    executionRequests.put(request.executionId(), request.completed());
    recordEvent(
        request.runId(),
        "execution.completed",
        request.toolName() + " completed.",
        request.riskTier(),
        request.executionId(),
        executionResultEventPayload(request, result)
    );
    var run = requireRun(request.runId());

    if ("mock_provider".equals(request.toolName())) {
      if (!"completed".equals(result.status())) {
        recordFailedExecutionEvent(request, result);
        failRun(request, run, toolFailureSummary(result));
        return;
      }
      runs.put(run.id(), run.withStatus("completed", result.summary()));
      recordEvent(run.id(), "agent.run.completed", result.summary(), null);
      return;
    }

    if ("model.invoke".equals(request.toolName())) {
      if (!"completed".equals(result.status())) {
        recordFailedExecutionEvent(request, result);
        failRun(request, run, toolFailureSummary(result));
        return;
      }
      completeModelInvocation(request, run, result);
      return;
    }

    if ("skill.apply".equals(request.toolName())) {
      completeSkillApplyInvocation(request, result);
      return;
    }

    if (LOCAL_TOOLS.contains(request.toolName())) {
      recordEvent(
          request.runId(),
          "completed".equals(result.status()) ? "tool.execution.completed" : "tool.execution.failed",
          request.toolName() + " result recorded.",
          request.riskTier(),
          request.executionId(),
          executionResultEventPayload(request, result),
          "completed".equals(result.status()) ? null : Map.of("code", "tool_failed", "message", toolFailureSummary(result))
      );
      completeToolInvocation(request, run, result);
      return;
    }

    if (!"completed".equals(result.status())) {
      recordFailedExecutionEvent(request, result);
      failRun(request, run, toolFailureSummary(result));
      return;
    }
    failRun(request, run, "Unsupported tool result: " + request.toolName());
  }

  public synchronized void completeExecution(String token, String daemonId, ExecutionResultRecord result) {
    var user = requireUserByToken(token);
    var daemon = requireDaemon(daemonId);
    if (daemon.userId() != null && !daemon.userId().equals(user.id())) {
      throw new ForbiddenException("Client daemon belongs to a different user.");
    }
    completeExecution(daemonId, result);
  }

  public synchronized ExecutionEventRecord submitExecutionStreamEvent(
      String daemonId,
      String executionId,
      String runId,
      int streamSequence,
      String streamType,
      String contentDelta,
      Map<String, Object> payload
  ) {
    var daemon = requireDaemon(daemonId);
    if (!"active".equals(daemon.status())) {
      throw new ForbiddenException("Client daemon is not active.");
    }
    var request = executionRequests.get(executionId);
    if (request == null) {
      throw new NotFoundException("Execution request not found.");
    }
    if (!request.runId().equals(runId)) {
      throw new StateConflictException("Stream event run does not match execution request.");
    }
    if (!daemonCanAccessWorkspace(daemon, request.workspaceId())) {
      throw new StateConflictException("Execution request does not belong to daemon workspace.");
    }
    if (runIsCancelled(runId)) {
      return existingOrIgnoredStreamEvent(runId, executionId, streamSequence);
    }
    var key = executionId + ":" + streamSequence;
    if (!streamEventKeys.add(key)) {
      return existingStreamEvent(runId, executionId, streamSequence);
    }
    var eventPayload = new LinkedHashMap<String, Object>();
    eventPayload.put("streamType", stringValue(streamType).isBlank() ? "assistant_delta" : streamType);
    eventPayload.put("streamSequence", streamSequence);
    eventPayload.put("contentDelta", stringValue(contentDelta));
    if (payload != null && !payload.isEmpty()) {
      eventPayload.putAll(payload);
    }
    return recordEvent(
        runId,
        "model.stream.delta",
        stringValue(contentDelta).isBlank() ? "Model stream delta." : stringValue(contentDelta),
        request.riskTier(),
        executionId,
        eventPayload
    );
  }

  public synchronized List<ExecutionEventRecord> chatStreamEvents(String workspaceId, String runId, int afterSequence) {
    var session = getChatSession(workspaceId);
    var targetRunId = stringValue(runId).isBlank() ? session.runId() : runId;
    if (targetRunId.isBlank()) {
      return List.of();
    }
    var run = requireRun(targetRunId);
    if (!workspaceId.equals(run.workspaceId())) {
      throw new NotFoundException("Run does not belong to workspace.");
    }
    return executionEvents.getOrDefault(targetRunId, List.of()).stream()
        .filter(event -> "model.stream.delta".equals(event.type()))
        .filter(event -> event.sequence() > afterSequence)
        .toList();
  }

  private ExecutionEventRecord existingStreamEvent(String runId, String executionId, int streamSequence) {
    return executionEvents.getOrDefault(runId, List.of()).stream()
        .filter(event -> executionId.equals(event.executionId()))
        .filter(event -> streamSequence == (int) event.payload().getOrDefault("streamSequence", -1))
        .findFirst()
        .orElseThrow(() -> new StateConflictException("Duplicate stream event could not be replayed."));
  }

  private ExecutionEventRecord existingOrIgnoredStreamEvent(String runId, String executionId, int streamSequence) {
    return executionEvents.getOrDefault(runId, List.of()).stream()
        .filter(event -> executionId.equals(event.executionId()))
        .filter(event -> streamSequence == (int) event.payload().getOrDefault("streamSequence", -1))
        .findFirst()
        .orElseGet(() -> new ExecutionEventRecord(
            id("evt"),
            runId,
            "model.stream.ignored",
            streamSequence,
            Instant.now(),
            "Ignored stream event for cancelled run.",
            null,
            "server",
            "info",
            executionId,
            Map.of("streamSequence", streamSequence),
            null
        ));
  }

  private boolean runIsCancelled(String runId) {
    var run = runs.get(runId);
    return run != null && "cancelled".equals(run.status());
  }

  private void recordFailedExecutionEvent(ExecutionRequestRecord request, ExecutionResultRecord result) {
    recordEvent(
        request.runId(),
        "execution.failed",
        toolFailureSummary(result),
        request.riskTier(),
        request.executionId(),
        executionResultEventPayload(request, result),
        Map.of("code", "execution_failed", "message", toolFailureSummary(result))
    );
  }

  private Map<String, Object> executionResultEventPayload(ExecutionRequestRecord request, ExecutionResultRecord result) {
    var payload = new LinkedHashMap<String, Object>();
    payload.put("toolName", request.toolName());
    payload.put("status", stringValue(result.status()));
    payload.put("summary", stringValue(result.summary()));
    var error = stringValue(toolResultData(result).get("error"));
    if (!error.isBlank()) {
      payload.put("error", error);
    }
    return Map.copyOf(payload);
  }

  private String toolFailureSummary(ExecutionResultRecord result) {
    var summary = stringValue(result.summary());
    var error = stringValue(toolResultData(result).get("error"));
    if (summary.isBlank()) {
      return error.isBlank() ? "Tool execution failed." : error;
    }
    if (error.isBlank() || summary.contains(error)) {
      return summary;
    }
    return summary + ": " + error;
  }

  public synchronized ChatSessionRecord approveToolRequest(String token, String workspaceId, String executionId) {
    requireUserIfTokenProvided(token);
    requireWorkspace(workspaceId);
    var request = requireExecutionRequest(executionId);
    if (!request.workspaceId().equals(workspaceId)) {
      throw new NotFoundException("Tool approval request not found.");
    }
    if (!"waiting_for_approval".equals(request.status())) {
      throw new StateConflictException("Tool request is not waiting for approval.");
    }
    executionRequests.put(request.executionId(), request.withStatus("pending"));
    var run = requireRun(request.runId());
    var callId = stringValue(request.input().get("toolCallId"));
    updateToolCallStatus(run.id(), callId, "running");
    runs.put(run.id(), run.withStatus("running", "Tool approved: " + request.toolName()));
    recordEvent(
        run.id(),
        "tool.approval.approved",
        "Approved tool: " + request.toolName(),
        request.riskTier(),
        request.executionId(),
        Map.of("toolName", request.toolName(), "toolCallId", callId)
    );
    return sessionForResponse(requireChatSessionForRun(run.id()));
  }

  public synchronized ChatSessionRecord rejectToolRequest(String token, String workspaceId, String executionId, String reason) {
    requireUserIfTokenProvided(token);
    requireWorkspace(workspaceId);
    var request = requireExecutionRequest(executionId);
    if (!request.workspaceId().equals(workspaceId)) {
      throw new NotFoundException("Tool approval request not found.");
    }
    if (!"waiting_for_approval".equals(request.status())) {
      throw new StateConflictException("Tool request is not waiting for approval.");
    }
    executionRequests.put(request.executionId(), request.completed());
    var run = requireRun(request.runId());
    var callId = stringValue(request.input().get("toolCallId"));
    updateToolCallStatus(run.id(), callId, "failed");
    recordEvent(
        run.id(),
        "tool.approval.rejected",
        "Rejected tool: " + request.toolName(),
        request.riskTier(),
        request.executionId(),
        Map.of("toolName", request.toolName(), "toolCallId", callId)
    );
    var result = new ExecutionResultRecord(
        request.executionId(),
        "completed",
        "Tool rejected by user.",
        Map.of("denied", true, "reason", reason == null ? "" : reason)
    );
    completeToolInvocation(request, run, result);
    return sessionForResponse(requireChatSessionForRun(run.id()));
  }

  public synchronized ChatSessionRecord answerAskUser(
      String token,
      String workspaceId,
      String runId,
      String toolCallId,
      List<Map<String, Object>> answers
  ) {
    requireUserIfTokenProvided(token);
    requireWorkspace(workspaceId);
    expireTimedOutAskUser(Instant.now());
    var run = requireRun(runId);
    if (!run.workspaceId().equals(workspaceId)) {
      throw new NotFoundException("Run not found for workspace.");
    }
    var toolCallStatus = toolCallStatus(run.id(), toolCallId, "ask_user");
    if (toolCallStatus.isBlank()) {
      throw new NotFoundException("ask_user request not found.");
    }
    if (!"waiting_for_user".equals(toolCallStatus)) {
      throw new StateConflictException("ask_user request is no longer waiting for an answer.");
    }
    updateToolCallStatus(run.id(), toolCallId, "completed");
    recordEvent(
        run.id(),
        "tool.user_input.answered",
        "User answered ask_user.",
        riskTierForTool("ask_user"),
        null,
        Map.of("toolName", "ask_user", "toolCallId", toolCallId)
    );
    replaceToolResultMessage(
        run.id(),
        toolCallId,
        "ask_user",
        new ExecutionResultRecord(
            id("ask"),
            "completed",
            "User answered.",
            Map.of(
                "answers", List.copyOf(answers == null ? List.of() : answers),
                "status", "answered"
            )
        ),
        "waiting_for_client"
    );
    requestAgentLoopContinuation(run, "User answered.", "Requested client-side agent loop after user answer.");
    return sessionForResponse(requireChatSessionForRun(run.id()));
  }

  public synchronized BranchRecord createBranch(String agentId, String name, String description) {
    var agent = requireAgent(agentId);
    var branch = new BranchRecord(id("br"), agent.workspaceId(), agent.id(), name, description == null ? "" : description, "active", Instant.now());
    branches.put(branch.id(), branch);
    return branch;
  }

  public synchronized BranchCapsule branchCapsule(String branchId) {
    var branch = requireBranch(branchId);
    return new BranchCapsule(
        branch.id(),
        branch.name(),
        branch.description().isBlank() ? "Explore branch progress" : branch.description(),
        branch.status(),
        "This capsule is candidate context for selective adoption; it is not an automatic merge.",
        List.of("Branch context is isolated from the target branch until adopted."),
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        List.of(),
        Map.of("context", "review", "artifacts", "partial", "skills", "review")
    );
  }

  public synchronized SkillProposalRecord createSkillProposal(
      String workspaceId,
      String name,
      String scope,
      String markdownContent,
      List<String> evidence,
      double confidence
  ) {
    return createSkillProposal(workspaceId, "", "", name, scope, "", markdownContent, "", evidence, confidence);
  }

  private synchronized SkillProposalRecord createSkillProposal(
      String workspaceId,
      String runId,
      String daemonId,
      String name,
      String scope,
      String path,
      String markdownContent,
      String reason,
      List<String> evidence,
      double confidence
  ) {
    requireWorkspace(workspaceId);
    var proposal = new SkillProposalRecord(
        id("sp"),
        workspaceId,
        stringValue(runId),
        stringValue(daemonId),
        name,
        normalizeSkillScope(scope),
        stringValue(path),
        markdownContent,
        stringValue(reason),
        List.copyOf(evidence),
        confidence,
        "review_requested",
        1,
        Instant.now(),
        null
    );
    skillProposals.put(proposal.id(), proposal);
    return proposal;
  }

  public synchronized List<SkillProposalRecord> skillProposals() {
    return List.copyOf(skillProposals.values());
  }

  public synchronized Map<String, Object> skillInventory(String workspaceId) {
    requireWorkspace(workspaceId);
    var mergedProject = new ArrayList<Object>();
    var mergedGlobal = new ArrayList<Object>();
    for (var entry : skillInventoryByDaemon.entrySet()) {
      var daemon = daemons.get(entry.getKey());
      if (daemon == null || !daemonCanAccessWorkspace(daemon, workspaceId)) {
        continue;
      }
      var inventory = entry.getValue();
      mergedProject.addAll(listValue(inventory.get("project")));
      mergedGlobal.addAll(listValue(inventory.get("global")));
    }
    return Map.of("project", mergedProject, "global", mergedGlobal);
  }

  public synchronized void syncClientSkills(String daemonId, Map<String, Object> inventory) {
    var daemon = requireDaemon(daemonId);
    if (!"active".equals(daemon.status())) {
      throw new ForbiddenException("Client daemon is not active.");
    }
    skillInventoryByDaemon.put(daemonId, Map.copyOf(inventory == null ? Map.of() : inventory));
  }

  public synchronized SkillProposalRecord approveSkillProposal(String proposalId) {
    var proposal = requireSkillProposal(proposalId);
    if (!"review_requested".equals(proposal.status())) {
      return proposal;
    }
    if (proposal.path().isBlank() || proposal.markdownContent().isBlank()) {
      throw new BadRequestException("Skill proposal requires path and markdown content before approval.");
    }
    if (proposal.daemonId().isBlank()) {
      firstDaemonForWorkspace(proposal.workspaceId());
    }
    var runId = proposal.runId().isBlank() ? ensureSkillReviewRun(proposal.workspaceId()) : proposal.runId();
    var input = new LinkedHashMap<String, Object>();
    input.put("path", proposal.path());
    input.put("content", proposal.markdownContent());
    input.put("createParents", true);
    var request = ExecutionRequestRecord.toolInvoke(
        id("exec"),
        proposal.workspaceId(),
        DEV_AGENT_ID,
        DEV_BRANCH_ID,
        runId,
        "skill.apply",
        input,
        "write",
        "pending"
    );
    executionRequests.put(request.executionId(), request);
    skillProposalExecutionIds.put(request.executionId(), proposal.id());
    var approved = proposal.withStatus("approved", Instant.now());
    skillProposals.put(approved.id(), approved);
    return approved;
  }

  public synchronized SkillProposalRecord rejectSkillProposal(String proposalId) {
    var proposal = requireSkillProposal(proposalId);
    var rejected = proposal.withStatus("rejected", Instant.now());
    skillProposals.put(rejected.id(), rejected);
    return rejected;
  }

  private SkillProposalRecord requireSkillProposal(String proposalId) {
    var proposal = skillProposals.get(proposalId);
    if (proposal == null) {
      throw new NotFoundException("Skill proposal not found.");
    }
    return proposal;
  }

  private WorkspaceRecord requireWorkspace(String workspaceId) {
    var workspace = workspaces.get(workspaceId);
    if (workspace == null) {
      throw new NotFoundException("Workspace not found.");
    }
    return workspace;
  }

  private AgentRecord requireAgent(String agentId) {
    var agent = agents.get(agentId);
    if (agent == null) {
      throw new NotFoundException("Agent not found.");
    }
    return agent;
  }

  private RunRecord requireRun(String runId) {
    var run = runs.get(runId);
    if (run == null) {
      throw new NotFoundException("Run not found.");
    }
    return run;
  }

  private ExecutionRequestRecord requireExecutionRequest(String executionId) {
    var request = executionRequests.get(executionId);
    if (request == null) {
      throw new NotFoundException("Execution request not found.");
    }
    return request;
  }

  private BranchRecord requireBranch(String branchId) {
    var branch = branches.get(branchId);
    if (branch == null) {
      throw new NotFoundException("Branch not found.");
    }
    return branch;
  }

  private ClientDaemonRecord requireDaemon(String daemonId) {
    var daemon = daemons.get(daemonId);
    if (daemon == null) {
      throw new NotFoundException("Client daemon not found.");
    }
    return daemon;
  }

  private boolean daemonCanAccessWorkspace(ClientDaemonRecord daemon, String workspaceId) {
    return daemon.workspaceId().equals(workspaceId)
        || workspaceIdsByDaemon.getOrDefault(daemon.id(), List.of()).contains(workspaceId);
  }

  private Set<String> workspaceIdsForUser(String userId) {
    var result = new HashSet<String>();
    for (var daemon : daemons.values()) {
      if (!"active".equals(daemon.status()) || !userId.equals(daemon.userId())) {
        continue;
      }
      result.add(daemon.workspaceId());
      result.addAll(workspaceIdsByDaemon.getOrDefault(daemon.id(), List.of()));
    }
    return result;
  }

  private void removeWorkspaceIfNoActiveDaemonUses(String workspaceId) {
    var stillUsed = daemons.values().stream()
        .filter(daemon -> "active".equals(daemon.status()))
        .anyMatch(daemon -> daemon.workspaceId().equals(workspaceId)
            || workspaceIdsByDaemon.getOrDefault(daemon.id(), List.of()).contains(workspaceId));
    if (!stillUsed) {
      workspaces.remove(workspaceId);
    }
  }

  private UserRecord requireUserByUsername(String username) {
    var userId = userIdsByUsername.get(normalizeUsername(username));
    if (userId == null) {
      throw new UnauthorizedException("Invalid username or password.");
    }
    return users.get(userId);
  }

  private UserRecord requireUserByToken(String token) {
    var session = authSessions.get(requireToken(token));
    if (session == null) {
      throw new UnauthorizedException("Authentication is required.");
    }
    var user = users.get(session.userId());
    if (user == null) {
      throw new UnauthorizedException("Authentication is required.");
    }
    return user;
  }

  private void requireUserIfTokenProvided(String token) {
    if (token != null && !token.isBlank()) {
      requireUserByToken(token);
    }
  }

  private String requireToken(String token) {
    if (token == null || token.isBlank()) {
      throw new UnauthorizedException("Authentication is required.");
    }
    return token.trim();
  }

  private AuthResponse createSession(UserRecord user) {
    var token = "bx_" + randomToken(36);
    authSessions.put(token, new AuthSessionRecord(token, user.id(), Instant.now()));
    return new AuthResponse(token, user.view());
  }

  private String normalizeUsername(String username) {
    var normalized = username == null ? "" : username.trim().toLowerCase();
    if (normalized.length() < 3) {
      throw new BadRequestException("Username must contain at least 3 characters.");
    }
    return normalized;
  }

  private void validatePassword(String password) {
    if (password == null || password.length() < 8) {
      throw new BadRequestException("Password must contain at least 8 characters.");
    }
  }

  private boolean passwordMatches(UserRecord user, String password) {
    return passwordHash(password, user.passwordSalt()).equals(user.passwordHash());
  }

  private String passwordHash(String password, String salt) {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      var bytes = digest.digest((salt + ":" + password).getBytes(StandardCharsets.UTF_8));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is not available.", exception);
    }
  }

  private String uniqueBindCode() {
    String code;
    do {
      code = "BX-" + randomCodeChunk() + "-" + randomCodeChunk();
    } while (bindCodes.containsKey(code));
    return code;
  }

  private String randomCodeChunk() {
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var builder = new StringBuilder();
    for (var index = 0; index < 4; index++) {
      builder.append(alphabet.charAt(RANDOM.nextInt(alphabet.length())));
    }
    return builder.toString();
  }

  private String randomToken(int byteCount) {
    var bytes = new byte[byteCount];
    RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private String normalizeApprovalMode(String mode) {
    return switch (mode == null ? "" : mode.trim().toLowerCase()) {
      case "default", "full_accept" -> mode.trim().toLowerCase();
      default -> throw new BadRequestException("Unsupported approval mode.");
    };
  }

  private String approvalTextForRisky(String mode) {
    return switch (mode) {
      case "full_accept" -> "none";
      default -> "browser_approval";
    };
  }

  private void completeModelInvocation(ExecutionRequestRecord request, RunRecord run, ExecutionResultRecord result) {
    recordTokenUsage(run.workspaceId(), result);
    var phase = stringValue(request.input().get("phase"));
    if (phase.isBlank() || "agent_loop".equals(phase)) {
      completeAgentLoopModel(request, run, result);
      return;
    }
    if ("tool_selection".equals(phase)) {
      completeToolSelectionModel(request, run, result);
      return;
    }
    if ("compact".equals(phase)) {
      completeCompactModel(request, run, result);
      return;
    }
    if ("session_title".equals(phase)) {
      completeSessionTitleModel(request, run, result);
      return;
    }
    if ("final_response".equals(phase)) {
      appendChatMessage(run.id(), assistantTextMessage(visibleModelContent(result)), "completed");
      runs.put(run.id(), run.withStatus("completed", result.summary()));
      recordEvent(run.id(), "agent.run.completed", result.summary(), null);
      return;
    }
    failRun(request, run, "Unsupported model.invoke phase: " + phase);
  }

  private void completeAgentLoopModel(ExecutionRequestRecord request, RunRecord run, ExecutionResultRecord result) {
    var returnedMessages = asMapList(result.data().get("messages")).stream()
        .filter(message -> !"system".equals(stringValue(message.get("role"))))
        .toList();
    collectSkillProposalsFromMessages(request, run, returnedMessages);
    var nextStatus = Boolean.TRUE.equals(result.data().get("paused")) ? "waiting_for_user" : "completed";
    ChatSessionRecord updatedSession;
    if (!returnedMessages.isEmpty()) {
      var session = requireChatSessionForRun(run.id());
      updatedSession = session.withMessages(returnedMessages, nextStatus, Instant.now());
      chatSessions.put(session.id(), updatedSession);
    } else {
      appendChatMessage(run.id(), assistantTextMessage(visibleModelContent(result)), nextStatus);
      updatedSession = requireChatSessionForRun(run.id());
    }
    runs.put(run.id(), run.withStatus(nextStatus, result.summary()));
    recordEvent(
        run.id(),
        "completed".equals(nextStatus) ? "agent.run.completed" : "agent.run.paused",
        result.summary(),
        null,
        request.executionId(),
        Map.of("phase", "agent_loop")
    );
    if ("completed".equals(nextStatus)) {
      if (updatedSession.queuedInputs().isEmpty()) {
        requestSessionTitleIfNeeded(updatedSession, run);
      } else {
        drainNextQueuedInput(updatedSession);
      }
    }
  }

  private void collectSkillProposalsFromMessages(
      ExecutionRequestRecord request,
      RunRecord run,
      List<Map<String, Object>> returnedMessages
  ) {
    for (var message : returnedMessages) {
      if (!"tool".equals(stringValue(message.get("role")))) {
        continue;
      }
      var toolName = toolMessageName(message);
      if (!"create_skill".equals(toolName) && !"renovation_skill".equals(toolName)) {
        continue;
      }
      var payload = toolResultPayload(message);
      var proposalType = stringValue(payload.get("proposalType"));
      if (!"create_skill".equals(proposalType) && !"renovation_skill".equals(proposalType)) {
        continue;
      }
      var content = stringValue(payload.get("content"));
      var path = stringValue(payload.get("path"));
      if (content.isBlank() || path.isBlank()) {
        continue;
      }
      var daemonId = daemonIdForExecution(request);
      createSkillProposal(
          request.workspaceId(),
          run.id(),
          daemonId,
          stringValue(payload.get("name")).isBlank() ? skillNameFromPath(path) : stringValue(payload.get("name")),
          stringValue(payload.get("scope")),
          path,
          content,
          stringValue(payload.get("reason")),
          stringList(payload.get("evidence")),
          0.8
      );
    }
  }

  private String daemonIdForExecution(ExecutionRequestRecord request) {
    return daemons.values().stream()
        .filter(daemon -> daemonCanAccessWorkspace(daemon, request.workspaceId()))
        .map(ClientDaemonRecord::id)
        .findFirst()
        .orElse("");
  }

  private String skillNameFromPath(String path) {
    var normalized = path.replace('\\', '/');
    var index = normalized.lastIndexOf('/');
    if (index <= 0) {
      return "skill";
    }
    var parent = normalized.substring(0, index);
    var parentIndex = parent.lastIndexOf('/');
    return parentIndex >= 0 ? parent.substring(parentIndex + 1) : parent;
  }

  private void completeSessionTitleModel(ExecutionRequestRecord request, RunRecord run, ExecutionResultRecord result) {
    var session = requireChatSessionForRun(run.id());
    var title = sanitizeGeneratedTitle(visibleModelContent(result));
    if (!title.isBlank() && stringValue(session.title()).isBlank()) {
      var updated = session.withTitle(title, Instant.now());
      chatSessions.put(updated.id(), updated);
      recordEvent(
          run.id(),
          "chat.session.title.generated",
          "Generated chat session title.",
          null,
          request.executionId(),
          Map.of("title", title)
      );
    }
  }

  private void requestSessionTitleIfNeeded(ChatSessionRecord session, RunRecord run) {
    if (!stringValue(session.title()).isBlank() || !hasFirstCompletedExchange(session) || hasTitleRequestForSession(session.id())) {
      return;
    }
    var execution = ExecutionRequestRecord.modelInvoke(
        id("exec"),
        session.workspaceId(),
        session.agentId(),
        session.branchId(),
        run.id(),
        "session_title",
        0,
        sessionTitleMessages(session),
        List.of(),
        activeModelName(session.workspaceId()),
        session.currentWorkspace()
    );
    executionRequests.put(execution.executionId(), execution);
    recordEvent(
        run.id(),
        "chat.session.title.requested",
        "Requested generated chat title.",
        null,
        execution.executionId(),
        Map.of("phase", "session_title")
    );
  }

  private boolean hasFirstCompletedExchange(ChatSessionRecord session) {
    var sawUser = false;
    for (var message : session.messages()) {
      if ("user".equals(stringValue(message.get("role")))) {
        sawUser = true;
      }
      if (sawUser && "assistant".equals(stringValue(message.get("role"))) && !stringValue(message.get("content")).isBlank()) {
        return true;
      }
    }
    return false;
  }

  private boolean hasTitleRequestForSession(String sessionId) {
    return executionRequests.values().stream()
        .filter(request -> sessionId.equals(chatSessionIdsByRun.get(request.runId())))
        .anyMatch(request -> "session_title".equals(stringValue(request.input().get("phase"))));
  }

  private List<Map<String, Object>> sessionTitleMessages(ChatSessionRecord session) {
    return List.of(
        Map.of(
            "role", "system",
            "content", "Generate a concise professional chat title. Return only the title, no quotes, no punctuation suffix, 3 to 8 words."
        ),
        Map.of("role", "user", "content", jsonString(recentMessages(session.messages(), 6)))
    );
  }

  private String sanitizeGeneratedTitle(String title) {
    var normalized = title == null ? "" : title.trim();
    if ((normalized.startsWith("\"") && normalized.endsWith("\"")) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
      normalized = normalized.substring(1, normalized.length() - 1).trim();
    }
    normalized = normalized.replaceAll("[\\r\\n]+", " ").trim();
    if (normalized.length() > 80) {
      normalized = normalized.substring(0, 80).trim();
    }
    return normalized;
  }

  private void recordTokenUsage(String workspaceId, ExecutionResultRecord result) {
    var usage = asMap(result.data().get("usage"));
    if (usage.isEmpty()) {
      return;
    }
    var normalized = new LinkedHashMap<String, Object>();
    normalized.put("promptTokens", firstInt(usage, "promptTokens", "prompt_tokens"));
    normalized.put("completionTokens", firstInt(usage, "completionTokens", "completion_tokens"));
    normalized.put("totalTokens", firstInt(usage, "totalTokens", "total_tokens"));
    lastTokenUsageByWorkspace.put(workspaceId, Map.copyOf(normalized));
  }

  private int firstInt(Map<String, Object> source, String firstKey, String secondKey) {
    var first = intValue(source.get(firstKey));
    return first > 0 ? first : intValue(source.get(secondKey));
  }

  private void completeCompactModel(ExecutionRequestRecord request, RunRecord run, ExecutionResultRecord result) {
    var summary = visibleModelContent(result).trim();
    if (summary.isBlank()) {
      summary = "Earlier conversation was compacted, but the model returned an empty summary.";
    }
    var session = requireChatSessionForRun(run.id());
    var compacted = new ArrayList<Map<String, Object>>();
    compacted.add(Map.of(
        "role", "system",
        "content", "Conversation compacted on " + Instant.now() + ". Preserve these facts for future turns:\n\n" + summary
    ));
    var recent = recentMessages(session.messages(), 6);
    compacted.addAll(recent);
    var now = Instant.now();
    var compactedSession = session.withMessagesAndTimelineNotices(
        compacted,
        timelineNoticesWith(session, "context_compacted", "上下文已压缩", "", now),
        "completed",
        now
    );
    chatSessions.put(session.id(), compactedSession);
    runs.put(run.id(), run.withStatus("completed", "Context compacted."));
    recordEvent(
        run.id(),
        "context.compacted",
        "Context compacted.",
        null,
        request.executionId(),
        Map.of("retainedMessages", recent.size())
    );
    recordEvent(run.id(), "agent.run.completed", "Context compacted.", null);
  }

  private List<Map<String, Object>> recentMessages(List<Map<String, Object>> messages, int limit) {
    if (messages.size() <= limit) {
      return List.copyOf(messages);
    }
    return List.copyOf(messages.subList(messages.size() - limit, messages.size()));
  }

  private void completeToolSelectionModel(ExecutionRequestRecord request, RunRecord run, ExecutionResultRecord result) {
    var toolCalls = modelToolCalls(result);
    if (toolCalls.isEmpty()) {
      appendChatMessage(run.id(), assistantTextMessage(visibleModelContent(result)), "completed");
      runs.put(run.id(), run.withStatus("completed", result.summary()));
      recordEvent(run.id(), "agent.run.completed", result.summary(), null);
      return;
    }

    var session = requireChatSessionForRun(run.id());
    var normalizedToolCalls = new ArrayList<NormalizedToolCall>();
    for (var toolCall : toolCalls) {
      var normalized = normalizeToolCall(toolCall);
      if (!SUPPORTED_TOOLS.contains(normalized.toolName())) {
        completeUnsupportedToolCall(request, run, normalized.toolName());
        return;
      }
      if (hasCompletedToolCall(session, normalized.toolName(), normalized.arguments())) {
        recordEvent(
            run.id(),
            "model.duplicate_tool_call",
            "Suppressed duplicate tool request: " + normalized.toolName(),
            riskTierForTool(normalized.toolName()),
            request.executionId(),
            Map.of("toolName", normalized.toolName(), "arguments", normalized.arguments())
        );
        continue;
      }
      normalizedToolCalls.add(normalized);
    }

    if (normalizedToolCalls.isEmpty()) {
      requestModelContinuation(run, result.summary(), List.of(), "Requested model summary after duplicate tool suppression.");
      return;
    }

    appendChatMessage(run.id(), assistantToolCallsMessage(normalizedToolCalls, modelMessageContent(result)), "running");

    var createdRequests = 0;
    var externalRequests = 0;
    var waitingForApproval = false;
    var waitingForUser = false;

    for (var toolCall : normalizedToolCalls) {
      var toolName = toolCall.toolName();
      var callId = toolCall.callId();
      var arguments = toolCall.arguments();
      if (BROWSER_TOOLS.contains(toolName)) {
        recordEvent(
            run.id(),
            "tool.user_input.requested",
            "Requested user input.",
            riskTierForTool(toolName),
            request.executionId(),
            Map.of("toolName", toolName, "toolCallId", callId, "arguments", arguments)
        );
        waitingForUser = true;
        createdRequests++;
        externalRequests++;
        session = requireChatSessionForRun(run.id());
        continue;
      }

      if (SERVER_TOOLS.contains(toolName)) {
        completeServerToolInvocation(request, run, callId, toolName, arguments);
        createdRequests++;
        session = requireChatSessionForRun(run.id());
        continue;
      }

      var toolInput = new LinkedHashMap<>(arguments);
      toolInput.put("toolCallId", callId);
      toolInput.put("toolName", toolName);
      toolInput.put("batchId", request.executionId());
      var riskTier = riskTierForTool(toolName);
      var requiresApproval = requiresBrowserApproval(request.workspaceId(), toolName);
      var toolRequest = ExecutionRequestRecord.toolInvoke(
          id("exec"),
          request.workspaceId(),
          request.agentId(),
          request.branchId(),
          request.runId(),
          toolName,
          toolInput,
          riskTier,
          requiresApproval ? "waiting_for_approval" : "pending"
      );
      executionRequests.put(toolRequest.executionId(), toolRequest);
      recordStep(run.id(), "execution_request", toolRequest.status(), toolRequest.executionId());
      recordEvent(
          run.id(),
          requiresApproval ? "tool.approval.requested" : "execution.requested",
          requiresApproval ? "Tool awaits browser approval: " + toolName : "Requested tool: " + toolName,
          toolRequest.riskTier(),
          toolRequest.executionId(),
          Map.of("toolName", toolName, "arguments", stripInternalToolFields(toolInput))
      );
      waitingForApproval = waitingForApproval || requiresApproval;
      createdRequests++;
      externalRequests++;
    }

    if (externalRequests == 0) {
      requestModelContinuation(run, result.summary(), toolsForConversation(requireChatSessionForRun(run.id())), "Requested model continuation after server-side tool work.");
      return;
    }

    var nextStatus = waitingForUser ? "waiting_for_user" : waitingForApproval ? "waiting_for_approval" : "running";
    runs.put(run.id(), run.withStatus(nextStatus, result.summary()));
    updateChatSessionRunStatus(run.id(), nextStatus);
    recordEvent(run.id(), "agent.run.updated", "Run is waiting on tool work.", null);
  }

  private boolean hasCompletedToolCall(ChatSessionRecord session, String toolName, Map<String, Object> arguments) {
    var completedCallIds = new HashSet<String>();
    for (var message : session.messages()) {
      if ("tool".equals(stringValue(message.get("role")))) {
        var callId = toolMessageCallId(message);
        if (!callId.isBlank()) {
          completedCallIds.add(callId);
        }
      }
    }

    for (var message : session.messages()) {
      for (var call : toolCallsFromMessage(message)) {
        var callId = stringValue(call.get("id"));
        if (!completedCallIds.contains(callId)) {
          continue;
        }
        if (!toolName.equals(toolNameFromCall(call))) {
          continue;
        }
        if (toolArgumentsFromCall(call).equals(arguments)) {
          return true;
        }
      }
    }
    return false;
  }

  private void completeUnsupportedToolCall(ExecutionRequestRecord request, RunRecord run, String toolName) {
    var message = "当前版本尚不支持工具 `" + toolName + "`，动作未执行。";
    appendChatMessage(run.id(), assistantTextMessage(message), "completed");
    runs.put(run.id(), run.withStatus("completed", message));
    recordEvent(
        run.id(),
        "model.unsupported_tool",
        "Model requested unsupported tool: " + toolName,
        "risky",
        request.executionId(),
        Map.of("toolName", toolName),
        Map.of("code", "unsupported_tool", "message", "Tool is not available in the current brainx runtime.")
    );
    recordEvent(run.id(), "agent.run.completed", message, null);
  }

  private void completeServerToolInvocation(
      ExecutionRequestRecord request,
      RunRecord run,
      String callId,
      String toolName,
      Map<String, Object> arguments
  ) {
    var result = executeServerTool(run, toolName, arguments);
    appendChatMessage(run.id(), toolResultMessage(callId, toolName, result), "waiting_for_client");
    recordEvent(
        run.id(),
        "tool.server.completed",
        "Completed server-side tool: " + toolName,
        riskTierForTool(toolName),
        request.executionId(),
        Map.of("toolName", toolName, "toolCallId", callId)
    );
  }

  private ExecutionResultRecord executeServerTool(RunRecord run, String toolName, Map<String, Object> arguments) {
    return switch (toolName) {
      case "todo_update" -> new ExecutionResultRecord(id("server"), "completed", "Todo list updated.", updateTodos(run, arguments));
      case "subagent_start" -> new ExecutionResultRecord(id("server"), "completed", "Subagent started.", startSubagent(run, arguments));
      case "subagent_read" -> new ExecutionResultRecord(id("server"), "completed", "Subagent status read.", readSubagent(run, arguments));
      case "subagent_stop" -> new ExecutionResultRecord(id("server"), "completed", "Subagent cancelled.", stopSubagent(run, arguments));
      default -> new ExecutionResultRecord(id("server"), "failed", "Unsupported server-side tool.", Map.of("error", "Unsupported server-side tool: " + toolName));
    };
  }

  private Map<String, Object> updateTodos(RunRecord run, Map<String, Object> arguments) {
    var rawItems = asMapList(arguments.get("items"));
    if (rawItems.size() > 20) {
      throw new BadRequestException("todo_update supports at most 20 items.");
    }
    var inProgressCount = 0;
    var items = new ArrayList<Map<String, Object>>();
    for (var raw : rawItems) {
      var id = stringValue(raw.get("id"));
      var title = stringValue(raw.get("title"));
      var status = normalizeTodoStatus(stringValue(raw.get("status")));
      if (id.isBlank() || title.isBlank()) {
        throw new BadRequestException("todo_update items require id and title.");
      }
      if ("in_progress".equals(status)) {
        inProgressCount++;
      }
      var item = new LinkedHashMap<String, Object>();
      item.put("id", id);
      item.put("title", title);
      item.put("status", status);
      var note = stringValue(raw.get("note"));
      if (!note.isBlank()) {
        item.put("note", note);
      }
      items.add(Map.copyOf(item));
    }
    if (inProgressCount > 1) {
      throw new BadRequestException("todo_update supports at most one in_progress item.");
    }
    var session = requireChatSessionForRun(run.id());
    chatSessions.put(session.id(), session.withState(items, session.terminals(), session.subagents(), session.runStatus(), Instant.now()));
    return Map.of(
        "items", List.copyOf(items),
        "reason", stringValue(arguments.get("reason"))
    );
  }

  private String normalizeTodoStatus(String status) {
    return switch (status) {
      case "pending", "in_progress", "completed", "blocked", "cancelled" -> status;
      default -> throw new BadRequestException("Unsupported todo status.");
    };
  }

  private Map<String, Object> startSubagent(RunRecord run, Map<String, Object> arguments) {
    var subagentId = id("sub");
    var now = Instant.now().toString();
    var task = requireNonBlank(arguments, "task");
    var context = requireNonBlank(arguments, "context");
    var subagent = new LinkedHashMap<String, Object>();
    subagent.put("subagentId", subagentId);
    subagent.put("runId", run.id());
    subagent.put("branchId", run.branchId());
    subagent.put("task", task);
    subagent.put("context", context);
    subagent.put("allowedTools", listValue(arguments.get("allowedTools")));
    subagent.put("allowedPaths", listValue(arguments.get("allowedPaths")));
    subagent.put("writeAccess", booleanValue(arguments.get("writeAccess")));
    subagent.put("budget", asMap(arguments.get("budget")));
    subagent.put("successCriteria", listValue(arguments.get("successCriteria")));
    subagent.put("outputSchema", stringValue(arguments.get("outputSchema")));
    subagent.put("status", "running");
    subagent.put("startedAt", now);
    subagent.put("summary", "Subagent is running.");
    subagent.put("changedFiles", List.of());
    subagent.put("evidence", List.of());
    subagent.put("risks", List.of());
    subagent.put("nextActions", List.of());
    subagentTasks.put(subagentId, Map.copyOf(subagent));
    refreshSessionSubagents(run.id());
    return Map.of(
        "subagentId", subagentId,
        "status", "running",
        "startedAt", now
    );
  }

  private Map<String, Object> readSubagent(RunRecord run, Map<String, Object> arguments) {
    var subagent = requireSubagentForRun(run.id(), requireNonBlank(arguments, "subagentId"));
    return Map.of(
        "subagentId", stringValue(subagent.get("subagentId")),
        "status", stringValue(subagent.get("status")),
        "summary", stringValue(subagent.get("summary")),
        "changedFiles", listValue(subagent.get("changedFiles")),
        "evidence", listValue(subagent.get("evidence")),
        "risks", listValue(subagent.get("risks")),
        "nextActions", listValue(subagent.get("nextActions"))
    );
  }

  private Map<String, Object> stopSubagent(RunRecord run, Map<String, Object> arguments) {
    var subagentId = requireNonBlank(arguments, "subagentId");
    var current = new LinkedHashMap<>(requireSubagentForRun(run.id(), subagentId));
    current.put("status", "cancelled");
    current.put("summary", "Subagent was cancelled.");
    current.put("reason", requireNonBlank(arguments, "reason"));
    current.put("stoppedAt", Instant.now().toString());
    subagentTasks.put(subagentId, Map.copyOf(current));
    refreshSessionSubagents(run.id());
    return Map.of(
        "subagentId", subagentId,
        "status", "cancelled"
    );
  }

  private Map<String, Object> requireSubagentForRun(String runId, String subagentId) {
    var subagent = subagentTasks.get(subagentId);
    if (subagent == null || !runId.equals(stringValue(subagent.get("runId")))) {
      throw new NotFoundException("Subagent not found.");
    }
    return subagent;
  }

  private void refreshSessionSubagents(String runId) {
    var session = requireChatSessionForRun(runId);
    var subagents = new ArrayList<Map<String, Object>>();
    for (var subagent : subagentTasks.values()) {
      if (!runId.equals(stringValue(subagent.get("runId")))) {
        continue;
      }
      subagents.add(Map.of(
          "id", stringValue(subagent.get("subagentId")),
          "task", stringValue(subagent.get("task")),
          "status", stringValue(subagent.get("status")),
          "summary", stringValue(subagent.get("summary"))
      ));
    }
    chatSessions.put(session.id(), session.withState(session.todos(), session.terminals(), subagents, session.runStatus(), Instant.now()));
  }

  private String requireNonBlank(Map<String, Object> arguments, String key) {
    var value = stringValue(arguments.get(key));
    if (value.isBlank()) {
      throw new BadRequestException(key + " is required.");
    }
    return value;
  }

  private boolean booleanValue(Object value) {
    if (value instanceof Boolean bool) {
      return bool;
    }
    throw new BadRequestException("Expected boolean value.");
  }

  private List<Object> listValue(Object value) {
    if (value instanceof List<?> list) {
      return List.copyOf(list);
    }
    return List.of();
  }

  private List<String> stringList(Object value) {
    if (value instanceof List<?> list) {
      return list.stream().map(this::stringValue).filter(item -> !item.isBlank()).toList();
    }
    return List.of();
  }

  private String normalizeSkillScope(String scope) {
    var normalized = stringValue(scope).trim().toLowerCase();
    return "global".equals(normalized) ? "global" : "project";
  }

  private String firstDaemonForWorkspace(String workspaceId) {
    return daemons.values().stream()
        .filter(daemon -> "active".equals(daemon.status()))
        .filter(daemon -> daemonCanAccessWorkspace(daemon, workspaceId))
        .map(ClientDaemonRecord::id)
        .findFirst()
        .orElseThrow(() -> new StateConflictException("No active client daemon is available for this workspace."));
  }

  private String ensureSkillReviewRun(String workspaceId) {
    var workspace = requireWorkspace(workspaceId);
    var run = new RunRecord(id("run"), workspaceId, DEV_AGENT_ID, DEV_BRANCH_ID, "skill.apply", "waiting_for_client", "Skill proposal approval.", Instant.now());
    runs.put(run.id(), run);
    recordEvent(run.id(), "agent.run.created", "Skill approval run created.", null, null, Map.of("workspaceName", workspace.name()));
    return run.id();
  }

  private void completeToolInvocation(ExecutionRequestRecord request, RunRecord run, ExecutionResultRecord result) {
    var callId = stringValue(request.input().get("toolCallId"));
    appendChatMessage(run.id(), toolResultMessage(callId, request.toolName(), result), "waiting_for_client");

    var batchId = stringValue(request.input().get("batchId"));
    if (!batchId.isBlank() && hasUnfinishedToolRequests(run.id(), batchId)) {
      runs.put(run.id(), run.withStatus("running", result.summary()));
      recordEvent(
          run.id(),
          "agent.run.updated",
          "Tool result recorded; waiting for sibling tool results.",
          request.riskTier(),
          request.executionId(),
          Map.of("batchId", batchId, "toolName", request.toolName())
      );
      return;
    }

    requestModelContinuation(run, result.summary(), toolsForConversation(requireChatSessionForRun(run.id())), "Requested model continuation.");
  }

  private void completeSkillApplyInvocation(ExecutionRequestRecord request, ExecutionResultRecord result) {
    var run = requireRun(request.runId());
    runs.put(run.id(), run.withStatus("completed".equals(result.status()) ? "completed" : "failed", result.summary()));
    var proposalId = skillProposalExecutionIds.get(request.executionId());
    if (proposalId != null && skillProposals.containsKey(proposalId)) {
      var proposal = skillProposals.get(proposalId);
      var status = "completed".equals(result.status()) ? "published" : "apply_failed";
      skillProposals.put(proposalId, proposal.withStatus(status, Instant.now()));
    }
    recordEvent(
        request.runId(),
        "completed".equals(result.status()) ? "skill.apply.completed" : "skill.apply.failed",
        "completed".equals(result.status()) ? "Skill proposal applied." : toolFailureSummary(result),
        request.riskTier(),
        request.executionId(),
        executionResultEventPayload(request, result),
        "completed".equals(result.status()) ? null : Map.of("code", "skill_apply_failed", "message", toolFailureSummary(result))
    );
  }

  private boolean hasUnfinishedToolRequests(String runId, String batchId) {
    return executionRequests.values().stream()
        .filter(request -> request.runId().equals(runId))
        .filter(request -> batchId.equals(stringValue(request.input().get("batchId"))))
        .anyMatch(request -> "pending".equals(request.status()) || "waiting_for_approval".equals(request.status()));
  }

  private void requestModelContinuation(
      RunRecord run,
      String summary,
      List<Map<String, Object>> tools,
      String eventMessage
  ) {
    var session = requireChatSessionForRun(run.id());
    var loopIndex = toolIterationCount(session);
    var finalModelRequest = ExecutionRequestRecord.modelInvoke(
        id("exec"),
        run.workspaceId(),
        run.agentId(),
        run.branchId(),
        run.id(),
        "tool_selection",
        loopIndex,
        toolSelectionMessages(session, tools),
        tools,
        activeModelName(run.workspaceId()),
        session.currentWorkspace()
    );
    executionRequests.put(finalModelRequest.executionId(), finalModelRequest);
    recordStep(run.id(), "execution_request", "waiting_for_client", finalModelRequest.executionId());
    recordEvent(
        run.id(),
        "execution.requested",
        eventMessage,
        finalModelRequest.riskTier(),
        finalModelRequest.executionId(),
        Map.of("toolName", finalModelRequest.toolName(), "phase", "tool_selection", "tools", toolNames(tools))
    );
    runs.put(run.id(), run.withStatus("waiting_for_client", summary));
  }

  private void requestAgentLoopContinuation(RunRecord run, String summary, String eventMessage) {
    var session = requireChatSessionForRun(run.id());
    var loopIndex = toolIterationCount(session);
    var execution = ExecutionRequestRecord.modelInvoke(
        id("exec"),
        run.workspaceId(),
        run.agentId(),
        run.branchId(),
        run.id(),
        "agent_loop",
        loopIndex,
        agentLoopMessages(session),
        List.of(),
        activeModelName(run.workspaceId()),
        session.currentWorkspace()
    );
    executionRequests.put(execution.executionId(), execution);
    recordStep(run.id(), "execution_request", "waiting_for_client", execution.executionId());
    recordEvent(
        run.id(),
        "execution.requested",
        eventMessage,
        execution.riskTier(),
        execution.executionId(),
        Map.of("toolName", execution.toolName(), "phase", "agent_loop")
    );
    runs.put(run.id(), run.withStatus("waiting_for_client", summary));
    updateChatSessionRunStatus(run.id(), "waiting_for_client");
  }

  private void replaceToolResultMessage(
      String runId,
      String callId,
      String toolName,
      ExecutionResultRecord result,
      String runStatus
  ) {
    var session = requireChatSessionForRun(runId);
    var messages = new ArrayList<>(session.messages());
    var replacement = toolResultMessage(callId, toolName, result);
    var replaced = false;
    for (var index = 0; index < messages.size(); index++) {
      var message = messages.get(index);
      if ("tool".equals(stringValue(message.get("role")))
          && callId.equals(toolMessageCallId(message))
          && toolName.equals(toolMessageName(message))) {
        messages.set(index, replacement);
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      messages.add(replacement);
    }
    chatSessions.put(session.id(), session.withMessages(messages, runStatus, Instant.now()));
  }

  private void failRun(ExecutionRequestRecord request, RunRecord run, String summary) {
    var visibleSummary = sanitizeRuntimeError(summary);
    runs.put(run.id(), run.withStatus("failed", visibleSummary));
    if (chatSessionIdsByRun.containsKey(run.id())) {
      var session = requireChatSessionForRun(run.id());
      if (isUserFacingModelFailure(request)) {
        var updated = markTrailingUserMessagesFailed(session, visibleSummary);
        chatSessions.put(updated.id(), updated);
        drainNextQueuedInput(updated);
      } else {
        appendChatMessage(run.id(), assistantTextMessage(visibleSummary), "failed");
        drainNextQueuedInput(requireChatSessionForRun(run.id()));
      }
    }
    recordEvent(run.id(), "agent.run.failed", visibleSummary, request.riskTier());
  }

  private boolean isUserFacingModelFailure(ExecutionRequestRecord request) {
    if (!"model.invoke".equals(request.toolName())) {
      return false;
    }
    var phase = stringValue(request.input().get("phase"));
    return phase.isBlank()
        || "agent_loop".equals(phase)
        || "tool_selection".equals(phase)
        || "final_response".equals(phase);
  }

  private ChatSessionRecord markTrailingUserMessagesFailed(ChatSessionRecord session, String message) {
    var messages = new ArrayList<>(session.messages());
    var changed = false;
    for (var index = messages.size() - 1; index >= 0; index--) {
      var candidate = messages.get(index);
      if (!"user".equals(stringValue(candidate.get("role")))) {
        break;
      }
      var updated = new LinkedHashMap<>(candidate);
      updated.put("status", "failed");
      updated.put("error", Map.of(
          "code", "model_provider_error",
          "message", message
      ));
      messages.set(index, Map.copyOf(updated));
      changed = true;
    }
    if (!changed) {
      return session.withMessages(session.messages(), "failed", Instant.now());
    }
    return session.withMessages(messages, "failed", Instant.now());
  }

  private String sanitizeRuntimeError(String message) {
    var cleaned = stringValue(message)
        .replaceFirst("(?i)^model\\.invoke failed:\\s*", "")
        .replaceFirst("(?i)^model provider returned\\s*", "")
        .trim();
    var matcher = Pattern.compile("(?i)HTTP\\s+(\\d{3})\\s*:\\s*(\\{.*\\})").matcher(cleaned);
    if (matcher.find()) {
      try {
        var payload = JSON.readValue(matcher.group(2), new TypeReference<Map<String, Object>>() {});
        var title = stringValue(payload.get("title"));
        return "HTTP " + matcher.group(1) + (title.isBlank() ? "" : ": " + title);
      } catch (JsonProcessingException ignored) {
        return "HTTP " + matcher.group(1);
      }
    }
    return cleaned.isBlank() ? stringValue(message) : cleaned;
  }

  private void appendChatMessage(String runId, Map<String, Object> message, String runStatus) {
    var session = requireChatSessionForRun(runId);
    var messages = new ArrayList<>(session.messages());
    messages.add(message);
    chatSessions.put(session.id(), session.withMessages(messages, runStatus, Instant.now()));
  }

  private void updateChatSessionRunStatus(String runId, String runStatus) {
    var session = requireChatSessionForRun(runId);
    chatSessions.put(session.id(), session.withMessages(session.messages(), runStatus, Instant.now()));
  }

  private String toolCallStatus(String runId, String toolCallId, String toolName) {
    var session = requireChatSessionForRun(runId);
    var found = false;
    for (var message : session.messages()) {
      if ("tool".equals(stringValue(message.get("role")))
          && toolCallId.equals(toolMessageCallId(message))
          && toolName.equals(toolMessageName(message))) {
        if ("waiting_for_user".equals(stringValue(toolResultPayload(message).get("status")))) {
          return "waiting_for_user";
        }
        return "completed";
      }
      for (var call : toolCallsFromMessage(message)) {
        if (toolCallId.equals(stringValue(call.get("id"))) && toolName.equals(toolNameFromCall(call))) {
          found = true;
        }
      }
    }
    if (!found) {
      return "";
    }
    var run = requireRun(runId);
    return "waiting_for_user".equals(run.status()) ? "waiting_for_user" : "running";
  }

  private void updateToolCallStatus(String runId, String toolCallId, String status) {
    // Standard OpenAI messages do not carry UI status. Status is exposed through toolStates.
  }

  private String toolMessageCallId(Map<String, Object> message) {
    var callId = stringValue(message.get("tool_call_id"));
    if (callId.isBlank()) {
      callId = stringValue(message.get("toolCallId"));
    }
    return callId;
  }

  private String toolMessageName(Map<String, Object> message) {
    return normalizeToolName(stringValue(message.get("name")));
  }

  private void expireTimedOutAskUser(Instant now) {
    var waitingRuns = runs.values().stream()
        .filter(run -> "waiting_for_user".equals(run.status()))
        .toList();
    for (var run : waitingRuns) {
      var expiredCalls = expiredAskUserCalls(run.id(), now);
      if (expiredCalls.isEmpty()) {
        continue;
      }
      for (var call : expiredCalls) {
        var callId = stringValue(call.get("id"));
        updateToolCallStatus(run.id(), callId, "completed");
        replaceToolResultMessage(
            run.id(),
            callId,
            "ask_user",
            new ExecutionResultRecord(
                id("ask"),
                "completed",
                "User did not answer before timeout.",
                unansweredAskUserResult(call)
            ),
            "waiting_for_client"
        );
        recordEvent(
            run.id(),
            "tool.user_input.timeout",
            "ask_user timed out without an answer.",
            riskTierForTool("ask_user"),
            null,
            Map.of("toolName", "ask_user", "toolCallId", callId, "reason", "timeout")
        );
      }
      requestAgentLoopContinuation(
          requireRun(run.id()),
          "User did not answer before timeout.",
          "Requested client-side agent loop after ask_user timeout."
      );
    }
  }

  private List<Map<String, Object>> expiredAskUserCalls(String runId, Instant now) {
    var session = requireChatSessionForRun(runId);
    var expired = new ArrayList<Map<String, Object>>();
    for (var message : session.messages()) {
      for (var call : toolCallsFromMessage(message)) {
        if (!"ask_user".equals(toolNameFromCall(call))) {
          continue;
        }
        var callId = stringValue(call.get("id"));
        if (!"waiting_for_user".equals(toolCallStatus(runId, callId, "ask_user"))) {
          continue;
        }
        if (askUserExpired(callId, now)) {
          expired.add(Map.of(
              "id", callId,
              "arguments", toolArgumentsFromCall(call)
          ));
        }
      }
    }
    return expired;
  }

  private boolean askUserExpired(String callId, Instant now) {
    var session = chatSessions.values().stream()
        .filter(candidate -> candidate.messages().stream().anyMatch(message -> toolCallsFromMessage(message).stream().anyMatch(call -> callId.equals(stringValue(call.get("id"))))))
        .findFirst();
    if (session.isEmpty()) {
      return false;
    }
    var run = requireRun(session.get().runId());
    var createdAt = run.createdAt();
    return !createdAt.plus(askUserTimeoutSeconds, ChronoUnit.SECONDS).isAfter(now);
  }

  private Map<String, Object> unansweredAskUserResult(Map<String, Object> call) {
    var arguments = asMap(call.get("arguments"));
    var answers = asMapList(arguments.get("questions")).stream()
        .map(question -> Map.<String, Object>of(
            "id", stringValue(question.get("id")),
            "text", "unanswered",
            "isOther", false,
            "status", "unanswered"
        ))
        .toList();
    return Map.of(
        "answers", answers,
        "status", "unanswered",
        "reason", "timeout"
    );
  }

  private ChatSessionRecord requireChatSessionForRun(String runId) {
    var sessionId = chatSessionIdsByRun.get(runId);
    if (sessionId == null) {
      throw new NotFoundException("Chat session for run not found.");
    }
    var session = chatSessions.get(sessionId);
    if (session == null) {
      throw new NotFoundException("Chat session not found.");
    }
    return session;
  }

  private ChatSessionRecord requireChatSession(String sessionId) {
    var session = chatSessions.get(sessionId);
    if (session == null) {
      throw new NotFoundException("Chat session not found.");
    }
    return session;
  }

  private ChatSessionRecord getRawChatSession(String workspaceId, String sessionId) {
    requireWorkspace(workspaceId);
    var session = requireChatSession(sessionId);
    if (!workspaceId.equals(session.workspaceId())) {
      throw new NotFoundException("Chat session not found.");
    }
    return session;
  }

  private Optional<ChatSessionRecord> primaryChatSession(String workspaceId) {
    requireWorkspace(workspaceId);
    var devSession = chatSessions.get(DEV_CHAT_SESSION_ID);
    if (devSession != null && workspaceId.equals(devSession.workspaceId())) {
      return Optional.of(devSession);
    }
    return chatSessions.values().stream()
        .filter(session -> session.workspaceId().equals(workspaceId))
        .findFirst();
  }

  private String normalizedSessionTitle(String title) {
    var normalized = title == null ? "" : title.trim();
    return normalized.isBlank() ? null : normalized;
  }

  private Set<String> descendantSessionIds(String sessionId) {
    var ids = new HashSet<String>();
    ids.add(sessionId);
    var changed = true;
    while (changed) {
      changed = false;
      for (var session : chatSessions.values()) {
        if (ids.contains(session.id())) {
          continue;
        }
        if (ids.contains(stringValue(session.parentSessionId()))) {
          ids.add(session.id());
          changed = true;
        }
      }
    }
    return Set.copyOf(ids);
  }

  private ChatSessionRecord cancelSessionInternal(ChatSessionRecord session, String summary, boolean recordSessionEvent) {
    var now = Instant.now();
    for (var entry : new ArrayList<>(executionRequests.entrySet())) {
      var request = entry.getValue();
      if (session.id().equals(chatSessionIdsByRun.get(request.runId()))
          && ("pending".equals(request.status()) || "waiting_for_approval".equals(request.status()))) {
        executionRequests.put(request.executionId(), request.withStatus("cancelled"));
      }
    }
    if (session.runId() != null && !session.runId().isBlank() && runs.containsKey(session.runId())) {
      var run = requireRun(session.runId());
      if (!"cancelled".equals(run.status())) {
        runs.put(run.id(), run.withStatus("cancelled", summary));
        recordEvent(run.id(), "agent.run.cancelled", summary, null);
      }
    }
    var updated = session.withQueuedInputs(List.of(), now).withMessages(session.messages(), "cancelled", now);
    chatSessions.put(updated.id(), updated);
    if (recordSessionEvent) {
      recordEventForSession(updated, "chat.session.cancelled", summary, Map.of());
    }
    return updated;
  }

  private void recordEventForSession(ChatSessionRecord session, String type, String message, Map<String, Object> payload) {
    if (session.runId() == null || session.runId().isBlank()) {
      return;
    }
    recordEvent(session.runId(), type, message, null, null, payload);
  }

  private ChatSessionRecord sessionForResponse(ChatSessionRecord session) {
    return session.withResponseState(
        toolStatesForSession(session),
        contextBudgetForSession(session),
        availableModels(session.workspaceId()),
        activeModelName(session.workspaceId())
    );
  }

  private Map<String, Object> contextBudgetForSession(ChatSessionRecord session) {
    var estimatedTokens = estimateTokens(toolSelectionMessages(session, toolsForConversation(session)));
    var maxTokens = contextWindowForWorkspace(session.workspaceId());
    var thresholdTokens = (int) Math.round(maxTokens * 0.75);
    var usage = lastTokenUsageByWorkspace.getOrDefault(session.workspaceId(), Map.of());
    return Map.of(
        "messageCount", session.messages().size(),
        "estimatedTokens", estimatedTokens,
        "maxTokens", maxTokens,
        "thresholdTokens", thresholdTokens,
        "usageRatio", Math.min(1.0, estimatedTokens / (double) maxTokens),
        "lastUsage", usage
    );
  }

  private int estimateTokens(List<Map<String, Object>> messages) {
    var characters = 0;
    for (var message : messages) {
      characters += jsonString(message).length();
    }
    return Math.max(1, (int) Math.ceil(characters / 4.0));
  }

  private int contextWindowForWorkspace(String workspaceId) {
    for (var model : availableModels(workspaceId)) {
      if (activeModelName(workspaceId).equals(stringValue(model.get("name")))) {
        var contextWindow = intValue(model.get("contextWindow"));
        return contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW;
      }
    }
    return DEFAULT_CONTEXT_WINDOW;
  }

  private List<Map<String, Object>> availableModels(String workspaceId) {
    return availableModelsByWorkspace.getOrDefault(workspaceId, defaultAvailableModels());
  }

  private List<Map<String, Object>> defaultAvailableModels() {
    return List.of(
        Map.of(
            "name", DEFAULT_MODEL_NAME,
            "model", "stepfun-ai/step-3.7-flash",
            "protocol", "openai",
            "contextWindow", DEFAULT_CONTEXT_WINDOW
        ),
        Map.of(
            "name", "gpt-5.5",
            "model", "gpt-5.5",
            "protocol", "openai",
            "contextWindow", DEFAULT_CONTEXT_WINDOW
        )
    );
  }

  private String activeModelName(String workspaceId) {
    return activeModelNamesByWorkspace.getOrDefault(workspaceId, DEFAULT_MODEL_NAME);
  }

  private Map<String, Map<String, Object>> toolStatesForSession(ChatSessionRecord session) {
    var states = new LinkedHashMap<String, Map<String, Object>>();
    var finishedCallIds = new HashSet<String>();
    var resultStatuses = new LinkedHashMap<String, String>();
    for (var message : session.messages()) {
      if ("tool".equals(stringValue(message.get("role")))) {
        var callId = toolMessageCallId(message);
        if (!callId.isBlank()) {
          finishedCallIds.add(callId);
          var content = toolResultPayload(message);
          var resultStatus = "waiting_for_user".equals(stringValue(content.get("status")))
              ? "waiting"
              : toolResultFailed(content) ? "failed" : "completed";
          resultStatuses.put(callId, resultStatus);
          var state = new LinkedHashMap<String, Object>();
          state.put("status", resultStatus);
          state.put("riskTier", riskTierForTool(toolMessageName(message)));
          if ("ask_user".equals(toolMessageName(message)) && "waiting".equals(resultStatus)) {
            state.put("expiresAt", askUserExpiresAt(session).toString());
          }
          states.put(callId, Map.copyOf(state));
        }
      }
    }

    for (var message : session.messages()) {
      for (var call : toolCallsFromMessage(message)) {
        var callId = stringValue(call.get("id"));
        if (callId.isBlank()) {
          continue;
        }
        var toolName = toolNameFromCall(call);
        var state = new LinkedHashMap<String, Object>(states.getOrDefault(callId, Map.of()));
        state.putIfAbsent("status", finishedCallIds.contains(callId) ? resultStatuses.getOrDefault(callId, "completed") : defaultPendingStatus(session, toolName));
        state.putIfAbsent("riskTier", riskTierForTool(toolName));
        if ("ask_user".equals(toolName) && !finishedCallIds.contains(callId)) {
          state.putIfAbsent("expiresAt", askUserExpiresAt(session).toString());
        }
        states.put(callId, Map.copyOf(state));
      }
    }

    for (var request : executionRequests.values()) {
      if (!request.runId().equals(session.runId())) {
        continue;
      }
      var callId = stringValue(request.input().get("toolCallId"));
      if (callId.isBlank()) {
        continue;
      }
      var state = new LinkedHashMap<String, Object>(states.getOrDefault(callId, Map.of()));
      state.put("status", statusForExecutionRequest(request.status(), resultStatuses.get(callId)));
      state.put("executionId", request.executionId());
      state.put("riskTier", request.riskTier());
      states.put(callId, Map.copyOf(state));
    }
    return Map.copyOf(states);
  }

  private Map<String, Object> toolResultPayload(Map<String, Object> message) {
    var content = jsonObjectValue(message.get("content"));
    var nestedResult = asMap(content.get("result"));
    return nestedResult.isEmpty() ? content : nestedResult;
  }

  private boolean toolResultFailed(Map<String, Object> content) {
    if (content.containsKey("error")) {
      return true;
    }
    return Boolean.FALSE.equals(content.get("ok"));
  }

  private String defaultPendingStatus(ChatSessionRecord session, String toolName) {
    if ("ask_user".equals(toolName) && "waiting_for_user".equals(session.runStatus())) {
      return "waiting";
    }
    return "running";
  }

  private Instant askUserExpiresAt(ChatSessionRecord session) {
    return requireRun(session.runId()).createdAt().plus(askUserTimeoutSeconds, ChronoUnit.SECONDS);
  }

  private String statusForExecutionRequest(String status, String resultStatus) {
    if (resultStatus != null && !resultStatus.isBlank()) {
      return resultStatus;
    }
    if ("completed".equals(status)) {
      return "completed";
    }
    if ("waiting_for_approval".equals(status)) {
      return "waiting";
    }
    if ("pending".equals(status)) {
      return "running";
    }
    return "queued";
  }

  private RunStepRecord recordStep(String runId, String type, String status, String executionId) {
    var steps = new ArrayList<>(runSteps.getOrDefault(runId, List.of()));
    var step = new RunStepRecord(id("step"), runId, steps.size() + 1, type, status, executionId, Instant.now());
    steps.add(step);
    runSteps.put(runId, List.copyOf(steps));
    return step;
  }

  private ExecutionEventRecord recordEvent(String runId, String type, String message, String riskTier) {
    return recordEvent(runId, type, message, riskTier, null, Map.of());
  }

  private ExecutionEventRecord recordEvent(
      String runId,
      String type,
      String message,
      String riskTier,
      String executionId,
      Map<String, Object> payload
  ) {
    return recordEvent(runId, type, message, riskTier, executionId, payload, null);
  }

  private ExecutionEventRecord recordEvent(
      String runId,
      String type,
      String message,
      String riskTier,
      String executionId,
      Map<String, Object> payload,
      Map<String, Object> error
  ) {
    var events = new ArrayList<>(executionEvents.getOrDefault(runId, List.of()));
    var level = error == null ? "info" : "error";
    if ("model.unsupported_tool".equals(type)) {
      level = "warn";
    }
    var event = new ExecutionEventRecord(
        id("evt"),
        runId,
        type,
        events.size() + 1,
        Instant.now(),
        message,
        riskTier,
        sourceForEvent(type),
        level,
        executionId,
        payload == null ? Map.of() : Map.copyOf(payload),
        error
    );
    events.add(event);
    executionEvents.put(runId, List.copyOf(events));
    return event;
  }

  private Map<String, Object> assistantTextMessage(String content) {
    return Map.of(
        "role", "assistant",
        "content", content
    );
  }

  private Map<String, Object> assistantToolCallsMessage(List<NormalizedToolCall> toolCalls, String content) {
    var calls = toolCalls.stream()
        .map(toolCall -> Map.<String, Object>of(
            "id", toolCall.callId(),
            "type", "function",
            "function", Map.of(
                "name", toolCall.toolName(),
                "arguments", jsonString(toolCall.arguments())
            )
        ))
        .toList();
    return Map.of(
        "role", "assistant",
        "content", content == null ? "" : content,
        "tool_calls", calls
    );
  }

  private Map<String, Object> toolResultMessage(String callId, String toolName, ExecutionResultRecord result) {
    var data = toolResultData(result);
    return Map.of(
        "role", "tool",
        "tool_call_id", callId,
        "name", toolName,
        "content", boundedToolResultContent(data)
    );
  }

  private Map<String, Object> toolResultData(ExecutionResultRecord result) {
    var data = new LinkedHashMap<String, Object>(result.data() == null ? Map.of() : result.data());
    if (!"completed".equals(result.status()) && !data.containsKey("error")) {
      data.put("error", stringValue(result.summary()).isBlank() ? "Tool execution failed." : result.summary());
    }
    return Collections.unmodifiableMap(data);
  }

  private String boundedToolResultContent(Map<String, Object> data) {
    var content = jsonString(data);
    if (content.length() <= MAX_TOOL_RESULT_MESSAGE_CHARS) {
      return content;
    }
    var truncated = new LinkedHashMap<String, Object>();
    truncated.put("toolResultTruncated", true);
    truncated.put("originalChars", content.length());
    truncated.put("content", truncateString(content, MAX_TOOL_RESULT_MESSAGE_CHARS));
    return jsonString(truncated);
  }

  private String truncateString(String value, int maxChars) {
    if (value == null || value.length() <= maxChars) {
      return value == null ? "" : value;
    }
    var marker = "\n...[truncated]";
    var keepChars = Math.max(0, maxChars - marker.length());
    return value.substring(0, keepChars) + marker;
  }

  private List<Map<String, Object>> toolSelectionMessages(ChatSessionRecord session, List<Map<String, Object>> tools) {
    var messages = new ArrayList<Map<String, Object>>();
    messages.add(Map.of(
        "role", "system",
        "content", systemPrompt(tools)
    ));
    messages.addAll(conversationMessages(session));
    return messages;
  }

  private List<Map<String, Object>> agentLoopMessages(ChatSessionRecord session) {
    var messages = new ArrayList<Map<String, Object>>();
    messages.add(Map.of(
        "role", "system",
        "content", AGENT_LOOP_SYSTEM_PROMPT
    ));
    messages.addAll(conversationMessages(session));
    return messages;
  }

  private List<Map<String, Object>> conversationMessages(ChatSessionRecord session) {
    return session.messages().stream()
        .filter(message -> !("user".equals(stringValue(message.get("role"))) && "failed".equals(stringValue(message.get("status")))))
        .toList();
  }

  private List<Map<String, Object>> finalModelMessages(ChatSessionRecord session, ExecutionRequestRecord toolRequest, ExecutionResultRecord toolResult) {
    var userContent = session.messages().stream()
        .filter(message -> "user".equals(stringValue(message.get("role"))))
        .reduce((first, second) -> second)
        .map(message -> stringValue(message.get("content")))
        .orElse("");
    var callId = stringValue(toolRequest.input().get("toolCallId"));
    return List.of(
        Map.of(
            "role", "system",
            "content", "You are brainx, a local agent. Use the tool result to answer the user's request."
        ),
        Map.of("role", "user", "content", userContent),
        Map.of(
            "role", "assistant",
            "content", "",
            "tool_calls", List.of(Map.of(
                "id", callId,
                "type", "function",
                "function", Map.of(
                    "name", toolRequest.toolName(),
                    "arguments", jsonString(stripInternalToolFields(toolRequest.input()))
                )
            ))
        ),
        Map.of(
            "role", "tool",
            "tool_call_id", callId,
            "name", toolRequest.toolName(),
            "content", jsonString(toolResult.data())
        )
    );
  }

  private Map<String, Object> stripInternalToolFields(Map<String, Object> input) {
    var result = new LinkedHashMap<>(input);
    result.remove("toolCallId");
    result.remove("toolName");
    return result;
  }

  private List<Map<String, Object>> toolSchemas() {
    return List.of(
        toolSchema("get_env", "Return OS, CPU architecture, workspace root, default shell, current date/time/timezone, and current model name. Does not expose provider or base URL.", objectSchema(Map.of(), List.of())),
        toolSchema(
            "read_files",
            "Read one or more UTF-8 text files inside the workspace. Use files with one item for single-file reads.",
            objectSchema(Map.of(
                "files", Map.of(
                    "type", "array",
                    "items", Map.of(
                        "type", "object",
                        "properties", Map.of(
                            "path", Map.of("type", "string"),
                            "startLine", Map.of("type", "integer", "minimum", 1),
                            "endLine", Map.of("type", "integer", "minimum", 1)
                        ),
                        "required", List.of("path"),
                        "additionalProperties", false
                    )
                )
            ), List.of("files"))
        ),
        toolSchema(
            "search_workspace",
            "Search workspace files by text, filename, or regex and return structured matches.",
            objectSchema(Map.of(
                "query", Map.of("type", "string"),
                "mode", Map.of("type", "string", "enum", List.of("text", "filename", "regex")),
                "maxResults", Map.of("type", "integer", "minimum", 1)
            ), List.of("query"))
        ),
        toolSchema(
            "apply_patch",
            "Apply a git-apply compatible unified diff inside the workspace after validation. Include diff --git headers, --- a/path and +++ b/path lines, and correct @@ hunk ranges.",
            objectSchema(Map.of(
                "patch", Map.of("type", "string"),
                "dryRun", Map.of("type", "boolean")
            ), List.of("patch"))
        ),
        toolSchema(
            "write_file",
            "Create or overwrite a UTF-8 text file inside the workspace. Existing files require overwrite=true.",
            objectSchema(Map.of(
                "path", Map.of("type", "string"),
                "content", Map.of("type", "string"),
                "overwrite", Map.of("type", "boolean"),
                "createParents", Map.of("type", "boolean")
            ), List.of("path", "content", "overwrite"))
        ),
        toolSchema(
            "run_command",
            "Run a short one-shot shell command in the workspace. Do not use for long-running servers or watchers.",
            objectSchema(Map.of(
                "command", Map.of("type", "string"),
                "workingDirectory", Map.of("type", "string"),
                "timeoutSeconds", Map.of("type", "integer", "minimum", 1, "maximum", 300)
            ), List.of("command"))
        ),
        toolSchema(
            "web_search",
            "Return mock web search results for a query. Current implementation is a local mock and does not perform real network search.",
            objectSchema(Map.of(
                "query", Map.of("type", "string"),
                "domains", Map.of("type", "array", "items", Map.of("type", "string")),
                "recencyDays", Map.of("type", "integer", "minimum", 1),
                "maxResults", Map.of("type", "integer", "minimum", 1)
            ), List.of("query"))
        )
    );
  }

  private List<Map<String, Object>> toolsForConversation(ChatSessionRecord session) {
    return toolSchemas();
  }

  private boolean isWorkspaceIntent(String text) {
    return text.contains("workspace")
        || text.contains("工作区")
        || text.contains("项目")
        || text.contains("目录")
        || text.contains("文件")
        || text.contains("技术栈")
        || text.contains("环境")
        || text.contains("配置")
        || text.contains("任务")
        || text.contains("todo")
        || text.contains("后台")
        || text.contains("background")
        || text.contains("子 agent")
        || text.contains("subagent")
        || text.contains("读取")
        || text.contains("搜索")
        || text.contains("在哪")
        || text.contains("都有啥")
        || text.contains("修改")
        || text.contains("创建")
        || text.contains("命令")
        || text.contains("执行")
        || text.contains("patch")
        || text.contains("package")
        || text.contains("pom.xml")
        || text.contains("cargo.toml");
  }

  private boolean isQuestionIntent(String text) {
    return text.contains("问我")
        || text.contains("提问")
        || text.contains("选择")
        || text.contains("确认")
        || text.contains("不确定")
        || text.contains("ask");
  }

  private List<String> toolNames(List<Map<String, Object>> tools) {
    return tools.stream()
        .map(tool -> asMap(tool.get("function")))
        .map(function -> stringValue(function.get("name")))
        .filter(name -> !name.isBlank())
        .toList();
  }

  private String systemPrompt(List<Map<String, Object>> tools) {
    var names = toolNames(tools);
    return AGENT_LOOP_SYSTEM_PROMPT + "\nAvailable tools for this turn: " + (names.isEmpty() ? "none" : String.join(", ", names)) + ".";
  }

  private String normalizeToolName(String toolName) {
    if ("execute_command".equals(toolName) || "bash".equals(toolName) || "bash_exec".equals(toolName)) {
      return "run_command";
    }
    return toolName;
  }

  private String riskTierForTool(String toolName) {
    return RISKY_TOOLS.contains(toolName) ? "risky" : "safe";
  }

  private boolean requiresBrowserApproval(String workspaceId, String toolName) {
    if (!RISKY_TOOLS.contains(toolName)) {
      return false;
    }
    var policy = approvalPolicies.get(workspaceId);
    var mode = policy == null ? "default" : policy.mode();
    return "default".equals(mode);
  }

  private String sourceForEvent(String type) {
    if (type.startsWith("model.")) {
      return "model";
    }
    if (type.startsWith("tool.")) {
      return "tool";
    }
    return "server";
  }

  private Map<String, Object> toolSchema(String name, String description, Map<String, Object> parameters) {
    return Map.of(
        "type", "function",
        "function", Map.of(
            "name", name,
            "description", description,
            "parameters", parameters
        )
    );
  }

  private Map<String, Object> objectSchema(Map<String, Object> properties, List<String> required) {
    return Map.of(
        "type", "object",
        "properties", properties,
        "required", required,
        "additionalProperties", false
    );
  }

  private List<Map<String, Object>> modelToolCalls(ExecutionResultRecord result) {
    var message = asMap(result.data().get("message"));
    var calls = message.get("toolCalls");
    if (calls == null) {
      calls = message.get("tool_calls");
    }
    return asMapList(calls);
  }

  private NormalizedToolCall normalizeToolCall(Map<String, Object> toolCall) {
    var toolName = toolNameFromCall(toolCall);
    var callId = stringValue(toolCall.get("id"));
    if (callId.isBlank()) {
      callId = id("call");
    }
    return new NormalizedToolCall(callId, toolName, ZERO_ARGUMENT_TOOLS.contains(toolName) ? Map.of() : toolArgumentsFromCall(toolCall));
  }

  private String toolNameFromCall(Map<String, Object> toolCall) {
    var function = asMap(toolCall.get("function"));
    var toolName = normalizeToolName(stringValue(toolCall.get("name")));
    if (toolName.isBlank()) {
      toolName = normalizeToolName(stringValue(toolCall.get("kind")));
    }
    if (toolName.isBlank()) {
      toolName = normalizeToolName(stringValue(function.get("name")));
    }
    return toolName;
  }

  private Map<String, Object> toolArgumentsFromCall(Map<String, Object> toolCall) {
    var function = asMap(toolCall.get("function"));
    var arguments = toolCall.get("arguments");
    if (arguments == null) {
      arguments = function.get("arguments");
    }
    return toolArguments(arguments);
  }

  private String modelMessageContent(ExecutionResultRecord result) {
    var message = asMap(result.data().get("message"));
    return stringValue(message.get("content"));
  }

  private String visibleModelContent(ExecutionResultRecord result) {
    var content = modelMessageContent(result).trim();
    if (content.isBlank()) {
      return result.summary();
    }
    var fallback = readableToolJsonFallback(content);
    return fallback.isBlank() ? content : fallback;
  }

  private String readableToolJsonFallback(String content) {
    try {
      var payload = JSON.readValue(content, new TypeReference<Map<String, Object>>() {});
      var toolName = normalizeToolName(stringValue(payload.get("name")));
      if (!toolName.isBlank()) {
        return "模型返回了未执行的工具请求 `" + toolName + "`，当前回合没有执行该动作。";
      }
    } catch (JsonProcessingException ignored) {
      return "";
    }
    return "";
  }

  private Map<String, Object> toolArguments(Object value) {
    if (value instanceof Map<?, ?> map) {
      return copyStringMap(map);
    }
    if (value instanceof String text && !text.isBlank()) {
      try {
        return JSON.readValue(text, new TypeReference<Map<String, Object>>() {});
      } catch (JsonProcessingException ignored) {
        return Map.of("raw", text);
      }
    }
    return Map.of();
  }

  private Map<String, Object> toolArgumentsFromTarget(String target) {
    if (target.isBlank() || "workspace".equals(target)) {
      return Map.of();
    }
    return toolArguments(target);
  }

  private List<Map<String, Object>> asMapList(Object value) {
    if (value instanceof String text && !text.isBlank()) {
      try {
        return JSON.readValue(text, new TypeReference<List<Map<String, Object>>>() {});
      } catch (JsonProcessingException ignored) {
        return List.of();
      }
    }
    if (!(value instanceof List<?> list)) {
      return List.of();
    }
    return list.stream()
        .filter(Map.class::isInstance)
        .map(Map.class::cast)
        .map(BrainxState::copyStringMap)
        .toList();
  }

  private List<Map<String, Object>> toolCallsFromMessage(Map<String, Object> message) {
    var calls = message.get("tool_calls");
    if (calls == null) {
      calls = message.get("toolCalls");
    }
    return asMapList(calls);
  }

  private Map<String, Object> asMap(Object value) {
    if (value instanceof Map<?, ?> map) {
      return copyStringMap(map);
    }
    return Map.of();
  }

  private Map<String, Object> jsonObjectValue(Object value) {
    if (value instanceof Map<?, ?> map) {
      return copyStringMap(map);
    }
    if (value instanceof String text && !text.isBlank()) {
      try {
        return JSON.readValue(text, new TypeReference<Map<String, Object>>() {});
      } catch (JsonProcessingException ignored) {
        return Map.of();
      }
    }
    return Map.of();
  }

  private static Map<String, Object> copyStringMap(Map<?, ?> map) {
    var copy = new LinkedHashMap<String, Object>();
    for (var entry : map.entrySet()) {
      if (entry.getKey() != null) {
        copy.put(entry.getKey().toString(), entry.getValue());
      }
    }
    return copy;
  }

  private String toolTitle(String toolName) {
    return switch (toolName) {
      case "get_env" -> "Inspect local environment";
      case "read_files" -> "Read workspace files";
      case "search_workspace" -> "Search workspace";
      case "apply_patch" -> "Apply patch";
      case "write_file" -> "Write workspace file";
      case "run_command" -> "Run command";
      case "ask_user" -> "Ask user";
      case "todo_update" -> "Update todo list";
      case "background_start" -> "Start background task";
      case "background_read" -> "Read background task";
      case "background_stop" -> "Stop background task";
      case "subagent_start" -> "Start subagent";
      case "subagent_read" -> "Read subagent";
      case "subagent_stop" -> "Stop subagent";
      default -> toolName;
    };
  }

  private String toolNameFromTitle(String title) {
    return switch (title) {
      case "Inspect local environment" -> "get_env";
      case "Read workspace files" -> "read_files";
      case "Search workspace" -> "search_workspace";
      case "Apply patch" -> "apply_patch";
      case "Write workspace file" -> "write_file";
      case "Run command" -> "run_command";
      case "Ask user" -> "ask_user";
      case "Update todo list" -> "todo_update";
      case "Start background task" -> "background_start";
      case "Read background task" -> "background_read";
      case "Stop background task" -> "background_stop";
      case "Start subagent" -> "subagent_start";
      case "Read subagent" -> "subagent_read";
      case "Stop subagent" -> "subagent_stop";
      default -> title;
    };
  }

  private String jsonString(Object value) {
    try {
      return JSON.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      return String.valueOf(value);
    }
  }

  private String stringValue(Object value) {
    return value == null ? "" : value.toString();
  }

  private String requiredText(String value, String label) {
    var normalized = value == null ? "" : value.trim();
    if (normalized.isBlank()) {
      throw new BadRequestException(label + " is required.");
    }
    return normalized;
  }

  private int intValue(Object value) {
    if (value instanceof Number number) {
      return number.intValue();
    }
    if (value instanceof String text && !text.isBlank()) {
      try {
        return Integer.parseInt(text);
      } catch (NumberFormatException ignored) {
        return 0;
      }
    }
    return 0;
  }

  private int toolIterationCount(ChatSessionRecord session) {
    var count = 0;
    for (var message : session.messages()) {
      if ("tool".equals(stringValue(message.get("role")))) {
        count++;
      }
    }
    return count;
  }

  private boolean isActiveRunStatus(String status) {
    return Set.of("queued", "planning", "waiting_for_client", "running", "waiting_for_approval", "waiting_for_user", "summarizing").contains(status);
  }

  private void seedWorkspaceRuntime(String workspaceId, String workspaceName) {
    var now = Instant.now();
    var branch = new BranchRecord(id("br"), workspaceId, null, "main", "Default branch", "active", now);
    var agent = new AgentRecord(id("a"), workspaceId, "brainx", "active", branch.id(), now);
    var resolvedBranch = new BranchRecord(branch.id(), workspaceId, agent.id(), branch.name(), branch.description(), branch.status(), branch.createdAt());
    branches.put(resolvedBranch.id(), resolvedBranch);
    agents.put(agent.id(), agent);
    var chatId = id("chat");
    chatSessions.put(chatId, new ChatSessionRecord(
        chatId,
        "Main Agent",
        null,
        chatId,
        null,
        workspaceId,
        workspaceName,
        DEFAULT_CURRENT_WORKSPACE,
        agent.id(),
        "brainx",
        resolvedBranch.id(),
        "main",
        "none",
        "current device",
        "",
        "completed",
        List.of(),
        List.of(),
        List.of(),
        Map.of(),
        Map.of(),
        defaultAvailableModels(),
        DEFAULT_MODEL_NAME,
        List.of(),
        List.of(),
        now,
        now,
        List.of()
    ));
    availableModelsByWorkspace.put(workspaceId, defaultAvailableModels());
    activeModelNamesByWorkspace.put(workspaceId, DEFAULT_MODEL_NAME);
  }

  private void seedLocalWorkspace() {
    var now = Instant.now();
    workspaces.put(DEV_WORKSPACE_ID, new WorkspaceRecord(DEV_WORKSPACE_ID, "Brainx Local", "~/.brainx/workspace", true, "active", now));
    branches.put(DEV_BRANCH_ID, new BranchRecord(DEV_BRANCH_ID, DEV_WORKSPACE_ID, DEV_AGENT_ID, "main", "Default branch", "active", now));
    agents.put(DEV_AGENT_ID, new AgentRecord(DEV_AGENT_ID, DEV_WORKSPACE_ID, "brainx", "active", DEV_BRANCH_ID, now));
    chatSessions.put(DEV_CHAT_SESSION_ID, new ChatSessionRecord(
        DEV_CHAT_SESSION_ID,
        "Main Agent",
        null,
        DEV_CHAT_SESSION_ID,
        null,
        DEV_WORKSPACE_ID,
        "Brainx Local",
        DEFAULT_CURRENT_WORKSPACE,
        DEV_AGENT_ID,
        "brainx",
        DEV_BRANCH_ID,
        "main",
        "none",
        "current device",
        "",
        "completed",
        List.of(),
        List.of(),
        List.of(),
        Map.of(),
        Map.of(),
        defaultAvailableModels(),
        DEFAULT_MODEL_NAME,
        List.of(),
        List.of(),
        now,
        now,
        List.of()
    ));
    availableModelsByWorkspace.put(DEV_WORKSPACE_ID, defaultAvailableModels());
    activeModelNamesByWorkspace.put(DEV_WORKSPACE_ID, DEFAULT_MODEL_NAME);
  }

  private static String id(String prefix) {
    return prefix + "_" + UUID.randomUUID().toString().replace("-", "");
  }
}
