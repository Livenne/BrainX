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
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class BrainxState {
  private static final String DEV_WORKSPACE_ID = "w_core";
  private static final String DEV_AGENT_ID = "a_core";
  private static final String DEV_BRANCH_ID = "br_core";
  private static final String DEV_CHAT_SESSION_ID = "chat_main";
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Set<String> SAFE_TOOLS = Set.of("get_env", "read_files", "search_workspace", "web_search", "background_read", "ask_user", "todo_update", "subagent_start", "subagent_read", "subagent_stop");
  private static final Set<String> RISKY_TOOLS = Set.of("apply_patch", "write_file", "run_command", "background_start", "background_stop");
  private static final Set<String> BROWSER_TOOLS = Set.of("ask_user");
  private static final Set<String> SERVER_TOOLS = Set.of("todo_update", "subagent_start", "subagent_read", "subagent_stop");
  private static final Set<String> LOCAL_TOOLS = Set.of("get_env", "read_files", "search_workspace", "web_search", "apply_patch", "write_file", "run_command", "background_start", "background_read", "background_stop");
  private static final Set<String> SUPPORTED_TOOLS = union(union(LOCAL_TOOLS, BROWSER_TOOLS), SERVER_TOOLS);
  private static final Set<String> ZERO_ARGUMENT_TOOLS = Set.of("get_env");
  private static final String DEFAULT_MODEL_NAME = "nvidia-step";
  private static final int DEFAULT_CONTEXT_WINDOW = 128_000;
  private static final int MAX_TOOL_RESULT_MESSAGE_CHARS = 64_000;

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
  private final Map<String, Map<String, Object>> subagentTasks = new LinkedHashMap<>();
  private final Map<String, ChatSessionRecord> chatSessions = new LinkedHashMap<>();
  private final Map<String, String> chatSessionIdsByRun = new LinkedHashMap<>();
  private final Map<String, List<RunStepRecord>> runSteps = new LinkedHashMap<>();
  private final Map<String, List<ExecutionEventRecord>> executionEvents = new LinkedHashMap<>();

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
        workspaceId,
        deviceName,
        List.copyOf(capabilities == null ? List.of() : capabilities),
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
    if (!bindCode.userId().equals(user.id())) {
      throw new ForbiddenException("Bind code belongs to a different user.");
    }
    var now = Instant.now();
    if (bindCode.usedAt() != null) {
      throw new StateConflictException("Bind code has already been used.");
    }
    if (bindCode.expiresAt().isBefore(now)) {
      throw new StateConflictException("Bind code has expired.");
    }
    var daemon = new ClientDaemonRecord(
        id("cd"),
        bindCode.workspaceId(),
        user.id(),
        bindCode.deviceName(),
        "active",
        bindCode.capabilities(),
        now,
        now
    );
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
    return chatSessions.values().stream()
        .filter(session -> session.workspaceId().equals(workspaceId))
        .findFirst()
        .map(this::sessionForResponse)
        .orElseThrow(() -> new NotFoundException("Chat session not found."));
  }

  public synchronized ChatSessionRecord sendChatMessage(String workspaceId, String content) {
    var session = getChatSession(workspaceId);
    if (isActiveRunStatus(session.runStatus())) {
      throw new StateConflictException("A chat run is already active for this session.");
    }

    var now = Instant.now();
    var run = new RunRecord(id("run"), workspaceId, session.agentId(), session.branchId(), content, "waiting_for_client", "", now);
    runs.put(run.id(), run);
    chatSessionIdsByRun.put(run.id(), session.id());
    recordEvent(run.id(), "agent.run.created", "Chat run created.", null);

    var messages = new ArrayList<>(session.messages());
    messages.add(Map.of("role", "user", "content", content));

    var updated = session.withRun(run.id(), run.status(), now).withMessages(messages, run.status(), now);
    chatSessions.put(updated.id(), updated);

    var tools = toolsForConversation(updated);
    var execution = ExecutionRequestRecord.modelInvoke(
        id("exec"),
        workspaceId,
        session.agentId(),
        session.branchId(),
        run.id(),
        "tool_selection",
        0,
        toolSelectionMessages(updated, tools),
        tools,
        activeModelName(workspaceId)
    );
    executionRequests.put(execution.executionId(), execution);
    recordStep(run.id(), "execution_request", "waiting_for_client", execution.executionId());
    recordEvent(
        run.id(),
        "execution.requested",
        "Requested model tool selection.",
        execution.riskTier(),
        execution.executionId(),
        Map.of("toolName", execution.toolName(), "phase", "tool_selection", "tools", toolNames(tools))
    );
    return sessionForResponse(updated);
  }

  public synchronized ChatSessionRecord handleChatCommand(String workspaceId, String command, Map<String, Object> arguments) {
    var session = getChatSession(workspaceId);
    var normalized = normalizeSlashCommand(command);
    var args = arguments == null ? Map.<String, Object>of() : Map.copyOf(arguments);
    return switch (normalized) {
      case "clear" -> clearChatContext(session);
      case "model" -> setActiveModel(session, args);
      case "compact" -> requestContextCompact(session);
      default -> throw new BadRequestException("Unsupported chat command: /" + normalized);
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
    return normalized;
  }

  private ChatSessionRecord clearChatContext(ChatSessionRecord session) {
    if (isActiveRunStatus(session.runStatus())) {
      throw new StateConflictException("Cannot clear context while a run is active.");
    }
    var cleared = session.withMessages(List.of(), "completed", Instant.now());
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
    activeModelNamesByWorkspace.put(session.workspaceId(), modelName);
    recordEventForSession(session, "model.preference.updated", "Active model changed.", Map.of("modelName", modelName));
    return sessionForResponse(requireChatSession(session.id()));
  }

  private ChatSessionRecord requestContextCompact(ChatSessionRecord session) {
    if (isActiveRunStatus(session.runStatus())) {
      throw new StateConflictException("Cannot compact context while a run is active.");
    }
    if (session.messages().isEmpty()) {
      return sessionForResponse(session);
    }
    var now = Instant.now();
    var run = new RunRecord(id("run"), session.workspaceId(), session.agentId(), session.branchId(), "/compact", "waiting_for_client", "Context compact requested.", now);
    runs.put(run.id(), run);
    chatSessionIdsByRun.put(run.id(), session.id());
    var updated = session.withRun(run.id(), run.status(), now);
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
        activeModelName(session.workspaceId())
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
    appendChatMessage(
        run.id(),
        toolResultMessage(
            toolCallId,
            "ask_user",
            new ExecutionResultRecord(
                id("ask"),
                "completed",
                "User answered.",
                Map.of("answers", List.copyOf(answers == null ? List.of() : answers))
            )
        ),
        "waiting_for_client"
    );
    recordEvent(
        run.id(),
        "tool.user_input.answered",
        "User answered ask_user.",
        riskTierForTool("ask_user"),
        null,
        Map.of("toolName", "ask_user", "toolCallId", toolCallId)
    );
    requestModelContinuation(run, "User answered.", toolsForConversation(requireChatSessionForRun(run.id())), "Requested model continuation after user answer.");
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
    requireWorkspace(workspaceId);
    var proposal = new SkillProposalRecord(
        id("sp"),
        workspaceId,
        name,
        scope,
        markdownContent,
        List.copyOf(evidence),
        confidence,
        "review_requested",
        1,
        Instant.now()
    );
    skillProposals.put(proposal.id(), proposal);
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
    if ("tool_selection".equals(phase)) {
      completeToolSelectionModel(request, run, result);
      return;
    }
    if ("compact".equals(phase)) {
      completeCompactModel(request, run, result);
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
    chatSessions.put(session.id(), session.withMessages(compacted, "completed", Instant.now()));
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
        var callId = stringValue(message.get("tool_call_id"));
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
        var function = asMap(call.get("function"));
        if (!toolName.equals(normalizeToolName(stringValue(function.get("name"))))) {
          continue;
        }
        if (toolArguments(function.get("arguments")).equals(arguments)) {
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
        activeModelName(run.workspaceId())
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

  private void failRun(ExecutionRequestRecord request, RunRecord run, String summary) {
    runs.put(run.id(), run.withStatus("failed", summary));
    if (chatSessionIdsByRun.containsKey(run.id())) {
      appendChatMessage(run.id(), assistantTextMessage(summary), "failed");
    }
    recordEvent(run.id(), "agent.run.failed", summary, request.riskTier());
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
          && toolCallId.equals(stringValue(message.get("tool_call_id")))
          && toolName.equals(stringValue(message.get("name")))) {
        return "completed";
      }
      for (var call : toolCallsFromMessage(message)) {
        var function = asMap(call.get("function"));
        if (toolCallId.equals(stringValue(call.get("id"))) && toolName.equals(stringValue(call.get("kind")))) {
          found = true;
        }
        if (toolCallId.equals(stringValue(call.get("id"))) && toolName.equals(stringValue(function.get("name")))) {
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
        appendChatMessage(
            run.id(),
            toolResultMessage(
                callId,
                "ask_user",
                new ExecutionResultRecord(
                    id("ask"),
                    "completed",
                    "User did not answer before timeout.",
                    unansweredAskUserResult(call)
                )
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
      requestModelContinuation(
          requireRun(run.id()),
          "User did not answer before timeout.",
          toolsForConversation(requireChatSessionForRun(run.id())),
          "Requested model continuation after ask_user timeout."
      );
    }
  }

  private List<Map<String, Object>> expiredAskUserCalls(String runId, Instant now) {
    var session = requireChatSessionForRun(runId);
    var expired = new ArrayList<Map<String, Object>>();
    for (var message : session.messages()) {
      for (var call : toolCallsFromMessage(message)) {
        var function = asMap(call.get("function"));
        if (!"ask_user".equals(stringValue(function.get("name")))) {
          continue;
        }
        var callId = stringValue(call.get("id"));
        if (!"waiting_for_user".equals(toolCallStatus(runId, callId, "ask_user"))) {
          continue;
        }
        if (askUserExpired(callId, now)) {
          expired.add(Map.of(
              "id", callId,
              "arguments", toolArguments(function.get("arguments"))
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
    return List.of(Map.of(
        "name", DEFAULT_MODEL_NAME,
        "model", "stepfun-ai/step-3.7-flash",
        "protocol", "openai",
        "contextWindow", DEFAULT_CONTEXT_WINDOW
    ));
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
        var callId = stringValue(message.get("tool_call_id"));
        if (!callId.isBlank()) {
          finishedCallIds.add(callId);
          var resultStatus = jsonObjectValue(message.get("content")).containsKey("error") ? "failed" : "completed";
          resultStatuses.put(callId, resultStatus);
          var state = new LinkedHashMap<String, Object>();
          state.put("status", resultStatus);
          state.put("riskTier", riskTierForTool(stringValue(message.get("name"))));
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
        var function = asMap(call.get("function"));
        var toolName = normalizeToolName(stringValue(function.get("name")));
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
    messages.addAll(session.messages());
    return messages;
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
    return """
        You are brainx, a local agent runtime for project work.
        Only call a tool when the user's request requires a real capability exposed in this request.
        Available tools for this turn: %s.
        Do not invent tool names. If a capability is not available, say that the current version cannot perform it and do not claim it was executed.
        Use get_env for runtime and workspace environment facts.
        Use read_files only when exact file content is needed.
        Use search_workspace when paths or matching code locations are unknown.
        For apply_patch, first know the target file content, then provide a git apply compatible patch with diff --git headers and correct @@ hunk ranges. Do not send informal patch snippets.
        Use run_command only for short one-shot commands. Do not use it for long-running servers, watchers, or interactive sessions.
        web_search currently returns mock local results only; do not claim it performed real network browsing.
        Never request get_environment, list_files, read_file, read_many_files, create_subagent, branch_action, skill_action, check_policy, or request_approval.
        For ordinary conversation, identity questions, or capability questions, answer directly without tool calls.
        Keep replies concise and factual.
        """.formatted(names.isEmpty() ? "none" : String.join(", ", names));
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
    var function = asMap(toolCall.get("function"));
    var toolName = normalizeToolName(stringValue(toolCall.get("name")));
    if (toolName.isBlank()) {
      toolName = normalizeToolName(stringValue(function.get("name")));
    }
    var callId = stringValue(toolCall.get("id"));
    if (callId.isBlank()) {
      callId = id("call");
    }
    var arguments = toolCall.get("arguments");
    if (arguments == null) {
      arguments = function.get("arguments");
    }
    return new NormalizedToolCall(callId, toolName, ZERO_ARGUMENT_TOOLS.contains(toolName) ? Map.of() : toolArguments(arguments));
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
        workspaceId,
        workspaceName,
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
        DEV_WORKSPACE_ID,
        "Brainx Local",
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
