package com.brainx.server.api;

import com.brainx.server.core.AgentRecord;
import com.brainx.server.core.ApprovalPolicyRecord;
import com.brainx.server.core.AuthResponse;
import com.brainx.server.core.BadRequestException;
import com.brainx.server.core.BindCodeResponse;
import com.brainx.server.core.BranchCapsule;
import com.brainx.server.core.BranchRecord;
import com.brainx.server.core.BrainxState;
import com.brainx.server.core.ChatSessionRecord;
import com.brainx.server.core.ClientDaemonRecord;
import com.brainx.server.core.ClientWorkspaceRecord;
import com.brainx.server.core.ExecutionEventRecord;
import com.brainx.server.core.ExecutionRequestRecord;
import com.brainx.server.core.ExecutionResultRecord;
import com.brainx.server.core.RunRecord;
import com.brainx.server.core.SkillProposalRecord;
import com.brainx.server.core.UserView;
import com.brainx.server.core.WorkspaceRecord;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1")
public class BrainxApiController {
  private final BrainxState state;
  private final ObjectMapper mapper;

  public BrainxApiController(BrainxState state, ObjectMapper mapper) {
    this.state = state;
    this.mapper = mapper;
  }

  @PostMapping("/auth/register")
  AuthResponse register(@Valid @RequestBody AuthRequest request) {
    return state.registerUser(request.username(), request.password());
  }

  @PostMapping("/auth/login")
  AuthResponse login(@Valid @RequestBody AuthRequest request) {
    return state.login(request.username(), request.password());
  }

  @GetMapping("/auth/me")
  UserView currentUser(@RequestHeader("Authorization") String authorization) {
    return state.currentUser(bearerToken(authorization));
  }

  @PostMapping("/auth/logout")
  ResponseEntity<Map<String, Boolean>> logout(@RequestHeader("Authorization") String authorization) {
    state.logout(bearerToken(authorization));
    return ResponseEntity.accepted().body(Map.of("accepted", true));
  }

  @PostMapping("/workspaces")
  WorkspaceRecord createWorkspace(@Valid @RequestBody CreateWorkspaceRequest request) {
    return state.createWorkspace(request.name());
  }

  @GetMapping("/workspaces")
  List<WorkspaceRecord> workspaces(@RequestHeader("Authorization") String authorization) {
    return state.workspaces(bearerToken(authorization));
  }

  @PostMapping("/workspaces/{workspaceId}/agents")
  AgentRecord createAgent(
      @PathVariable String workspaceId,
      @Valid @RequestBody CreateAgentRequest request
  ) {
    return state.createAgent(workspaceId, request.name());
  }

  @PostMapping("/agents/{agentId}/runs")
  RunRecord createRun(
      @PathVariable String agentId,
      @Valid @RequestBody CreateRunRequest request
  ) {
    return state.createRun(agentId, request.goal());
  }

  @GetMapping("/workspaces/{workspaceId}/chat/session")
  ChatSessionRecord getChatSession(@PathVariable String workspaceId) {
    return state.getChatSession(workspaceId);
  }

  @GetMapping("/workspaces/{workspaceId}/chat/sessions")
  List<ChatSessionRecord> chatSessions(@PathVariable String workspaceId) {
    return state.chatSessions(workspaceId);
  }

  @GetMapping("/workspaces/{workspaceId}/chat/sessions/{sessionId}")
  ChatSessionRecord getChatSession(
      @PathVariable String workspaceId,
      @PathVariable String sessionId
  ) {
    return state.getChatSession(workspaceId, sessionId);
  }

  @PostMapping("/workspaces/{workspaceId}/chat/sessions")
  ChatSessionRecord createChatSession(
      @PathVariable String workspaceId,
      @RequestBody(required = false) CreateChatSessionRequest request
  ) {
    return state.createChatSession(workspaceId, request == null ? null : request.title());
  }

  @PostMapping("/workspaces/{workspaceId}/chat/messages")
  ChatSessionRecord sendChatMessage(
      @PathVariable String workspaceId,
      @Valid @RequestBody SendChatMessageRequest request
  ) {
    return state.sendChatMessage(workspaceId, request.content(), request.attachments());
  }

  @PostMapping("/workspaces/{workspaceId}/chat/sessions/{sessionId}/messages")
  ChatSessionRecord sendSessionChatMessage(
      @PathVariable String workspaceId,
      @PathVariable String sessionId,
      @Valid @RequestBody SendChatMessageRequest request
  ) {
    return state.sendChatMessage(workspaceId, sessionId, request.content(), request.attachments());
  }

  @PostMapping("/workspaces/{workspaceId}/chat/commands")
  ChatSessionRecord handleChatCommand(
      @PathVariable String workspaceId,
      @Valid @RequestBody ChatCommandRequest request
  ) {
    return state.handleChatCommand(workspaceId, request.command(), request.arguments());
  }

  @PostMapping("/workspaces/{workspaceId}/chat/sessions/{sessionId}/commands")
  ChatSessionRecord handleSessionChatCommand(
      @PathVariable String workspaceId,
      @PathVariable String sessionId,
      @Valid @RequestBody ChatCommandRequest request
  ) {
    return state.handleChatCommand(workspaceId, sessionId, request.command(), request.arguments());
  }

  @PostMapping("/workspaces/{workspaceId}/chat/sessions/{sessionId}/cancel")
  ChatSessionRecord cancelChatSession(
      @PathVariable String workspaceId,
      @PathVariable String sessionId
  ) {
    return state.cancelChatSession(workspaceId, sessionId);
  }

  @PatchMapping("/workspaces/{workspaceId}/chat/sessions/{sessionId}")
  ChatSessionRecord updateChatSession(
      @PathVariable String workspaceId,
      @PathVariable String sessionId,
      @RequestBody UpdateChatSessionRequest request
  ) {
    return state.renameChatSession(workspaceId, sessionId, request == null ? null : request.title());
  }

  @PostMapping("/workspaces/{workspaceId}/chat/sessions/{sessionId}/fork")
  ChatSessionRecord forkChatSession(
      @PathVariable String workspaceId,
      @PathVariable String sessionId
  ) {
    return state.forkChatSession(workspaceId, sessionId);
  }

  @DeleteMapping("/workspaces/{workspaceId}/chat/sessions/{sessionId}")
  ResponseEntity<Map<String, Boolean>> deleteChatSession(
      @PathVariable String workspaceId,
      @PathVariable String sessionId,
      @RequestParam(defaultValue = "false") boolean confirm
  ) {
    state.deleteChatSession(workspaceId, sessionId, confirm);
    return ResponseEntity.accepted().body(Map.of("accepted", true));
  }

  @GetMapping("/agents/{agentId}/runs/{runId}")
  RunRecord getRun(@PathVariable String agentId, @PathVariable String runId) {
    return state.getRun(agentId, runId);
  }

  @GetMapping("/agents/{agentId}/runs/{runId}/events")
  List<ExecutionEventRecord> getRunEvents(@PathVariable String agentId, @PathVariable String runId) {
    return state.runEvents(agentId, runId);
  }

  @PostMapping("/client-daemons/register")
  ClientDaemonRecord registerDaemon(@Valid @RequestBody RegisterDaemonRequest request) {
    return state.registerDaemon(request.workspaceId(), request.deviceName(), request.capabilities());
  }

  @PostMapping("/client-daemons/bind-codes")
  BindCodeResponse createBindCode(
      @RequestHeader("Authorization") String authorization,
      @Valid @RequestBody CreateBindCodeRequest request
  ) {
    return state.createBindCode(
        bearerToken(authorization),
        request.workspaceId(),
        request.deviceName(),
        request.password(),
        request.capabilities()
    );
  }

  @PostMapping("/client-daemons/{daemonId}/bind-code")
  BindCodeResponse createBindCodeForDaemon(@PathVariable String daemonId) {
    return state.createBindCodeForDaemon(daemonId);
  }

  @PostMapping("/client-daemons/complete-bind")
  ClientDaemonRecord completeBind(
      @RequestHeader("Authorization") String authorization,
      @Valid @RequestBody CompleteBindRequest request
  ) {
    return state.completeBind(bearerToken(authorization), request.code());
  }

  @GetMapping("/client-daemons")
  List<ClientDaemonRecord> clientDaemons(@RequestHeader("Authorization") String authorization) {
    return state.clientDaemons(bearerToken(authorization));
  }

  @PostMapping("/client-daemons/{daemonId}/unbind")
  ResponseEntity<Map<String, Boolean>> unbindDaemon(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable String daemonId,
      @Valid @RequestBody UnbindDaemonRequest request
  ) {
    if (authorization != null && !authorization.isBlank()) {
      state.unbindDaemon(bearerToken(authorization), daemonId, request.confirm());
    } else {
      state.unbindDaemon(daemonId, request.confirm());
    }
    return ResponseEntity.accepted().body(Map.of("accepted", true));
  }

  @PutMapping("/client-daemons/{daemonId}/workspaces")
  ResponseEntity<Map<String, Boolean>> syncClientWorkspaces(
      @RequestHeader("Authorization") String authorization,
      @PathVariable String daemonId,
      @Valid @RequestBody SyncClientWorkspacesRequest request
  ) {
    state.syncClientWorkspaces(
        bearerToken(authorization),
        daemonId,
        request.workspaces().stream()
            .map(workspace -> new ClientWorkspaceRecord(
                workspace.id(),
                workspace.name(),
                workspace.path(),
                workspace.defaultWorkspace()
            ))
            .toList()
    );
    return ResponseEntity.accepted().body(Map.of("accepted", true));
  }

  @PutMapping("/client-daemons/{daemonId}/skills")
  ResponseEntity<Map<String, Boolean>> syncClientSkills(
      @PathVariable String daemonId,
      @RequestBody Map<String, Object> inventory
  ) {
    state.syncClientSkills(daemonId, inventory == null ? Map.of() : inventory);
    return ResponseEntity.accepted().body(Map.of("accepted", true));
  }

  @GetMapping("/client-daemons/{daemonId}/execution-requests")
  List<ExecutionRequestRecord> getExecutionRequests(
      @PathVariable String daemonId,
      @RequestHeader(value = "Authorization", required = false) String authorization
  ) {
    if (authorization != null && !authorization.isBlank()) {
      return state.pendingExecutionRequests(bearerToken(authorization), daemonId);
    }
    return state.pendingExecutionRequests(daemonId);
  }

  @PostMapping("/client-daemons/{daemonId}/execution-results")
  ResponseEntity<Map<String, Boolean>> submitExecutionResult(
      @PathVariable String daemonId,
      @Valid @RequestBody SubmitExecutionResultRequest request,
      @RequestHeader(value = "Authorization", required = false) String authorization
  ) {
    if (authorization != null && !authorization.isBlank()) {
      state.completeExecution(bearerToken(authorization), daemonId, request.toRecord());
    } else {
      state.completeExecution(daemonId, request.toRecord());
    }
    return ResponseEntity.accepted().body(Map.of("accepted", true));
  }

  @PostMapping("/client-daemons/{daemonId}/execution-stream-events")
  ResponseEntity<Map<String, Boolean>> submitExecutionStreamEvent(
      @PathVariable String daemonId,
      @Valid @RequestBody SubmitExecutionStreamEventRequest request
  ) {
    state.submitExecutionStreamEvent(
        daemonId,
        request.executionId(),
        request.runId(),
        request.sequence(),
        request.type(),
        request.contentDelta(),
        request.payload() == null ? Map.of() : request.payload()
    );
    return ResponseEntity.accepted().body(Map.of("accepted", true));
  }

  @GetMapping(value = "/workspaces/{workspaceId}/chat/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  ResponseEntity<String> chatEvents(
      @PathVariable String workspaceId,
      @RequestParam(required = false) String runId,
      @RequestParam(defaultValue = "0") int after
  ) {
    var events = state.chatStreamEvents(workspaceId, runId, after);
    var body = new StringBuilder("retry: 250\n\n");
    for (var event : events) {
      body.append("id: ").append(event.sequence()).append('\n');
      body.append("event: ").append(event.type()).append('\n');
      body.append("data: ").append(json(event)).append("\n\n");
    }
    return ResponseEntity.ok()
        .contentType(new MediaType(MediaType.TEXT_EVENT_STREAM, StandardCharsets.UTF_8))
        .body(body.toString());
  }

  @PostMapping("/workspaces/{workspaceId}/tool-approvals/{executionId}/approve")
  ChatSessionRecord approveToolRequest(
      @PathVariable String workspaceId,
      @PathVariable String executionId,
      @RequestHeader(value = "Authorization", required = false) String authorization
  ) {
    return state.approveToolRequest(optionalBearerToken(authorization), workspaceId, executionId);
  }

  @PostMapping("/workspaces/{workspaceId}/tool-approvals/{executionId}/reject")
  ChatSessionRecord rejectToolRequest(
      @PathVariable String workspaceId,
      @PathVariable String executionId,
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody(required = false) RejectToolRequest request
  ) {
    return state.rejectToolRequest(
        optionalBearerToken(authorization),
        workspaceId,
        executionId,
        request == null ? "" : request.reason()
    );
  }

  @PostMapping("/workspaces/{workspaceId}/ask-user/{runId}/{toolCallId}/answers")
  ChatSessionRecord answerAskUser(
      @PathVariable String workspaceId,
      @PathVariable String runId,
      @PathVariable String toolCallId,
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @Valid @RequestBody AnswerAskUserRequest request
  ) {
    return state.answerAskUser(
        optionalBearerToken(authorization),
        workspaceId,
        runId,
        toolCallId,
        request.answers()
    );
  }

  @PatchMapping("/workspaces/{workspaceId}/approval-policy")
  ApprovalPolicyRecord updateApprovalPolicy(
      @RequestHeader("Authorization") String authorization,
      @PathVariable String workspaceId,
      @Valid @RequestBody UpdateApprovalPolicyRequest request
  ) {
    return state.approvalPolicy(bearerToken(authorization), workspaceId, request.mode());
  }

  @PostMapping("/agents/{agentId}/branches")
  BranchRecord createBranch(
      @PathVariable String agentId,
      @Valid @RequestBody CreateBranchRequest request
  ) {
    return state.createBranch(agentId, request.name(), request.description());
  }

  @GetMapping("/branches/{branchId}/capsule")
  BranchCapsule getBranchCapsule(@PathVariable String branchId) {
    return state.branchCapsule(branchId);
  }

  @PostMapping("/skill-proposals")
  SkillProposalRecord createSkillProposal(@Valid @RequestBody CreateSkillProposalRequest request) {
    return state.createSkillProposal(
        request.workspaceId(),
        request.name(),
        request.scope(),
        request.markdownContent(),
        request.evidence(),
        request.confidence()
    );
  }

  @GetMapping("/skill-proposals")
  List<SkillProposalRecord> skillProposals() {
    return state.skillProposals();
  }

  @PostMapping("/skill-proposals/{proposalId}/approve")
  SkillProposalRecord approveSkillProposal(@PathVariable String proposalId) {
    return state.approveSkillProposal(proposalId);
  }

  @PostMapping("/skill-proposals/{proposalId}/reject")
  SkillProposalRecord rejectSkillProposal(@PathVariable String proposalId) {
    return state.rejectSkillProposal(proposalId);
  }

  @GetMapping("/workspaces/{workspaceId}/skills")
  Map<String, Object> workspaceSkills(@PathVariable String workspaceId) {
    return state.skillInventory(workspaceId);
  }

  public record CreateWorkspaceRequest(@NotBlank String name) {}

  public record AuthRequest(@NotBlank String username, @NotBlank String password) {}

  public record CreateAgentRequest(@NotBlank String name) {}

  public record CreateRunRequest(@NotBlank String goal) {}

  public record CreateChatSessionRequest(String title) {}

  public record UpdateChatSessionRequest(String title) {}

  public record SendChatMessageRequest(@NotBlank String content, List<Map<String, Object>> attachments) {}

  public record ChatCommandRequest(@NotBlank String command, Map<String, Object> arguments) {}

  public record RegisterDaemonRequest(
      @NotBlank String workspaceId,
      @NotBlank String deviceName,
      @NotEmpty List<String> capabilities
  ) {}

  public record CreateBindCodeRequest(
      @NotBlank String workspaceId,
      @NotBlank String deviceName,
      @NotBlank String password,
      @NotEmpty List<String> capabilities
  ) {}

  public record CompleteBindRequest(@NotBlank String code) {}

  public record UnbindDaemonRequest(boolean confirm) {}

  public record SyncClientWorkspacesRequest(@NotNull List<@Valid SyncedWorkspaceRequest> workspaces) {}

  public record SyncedWorkspaceRequest(
      @NotBlank String id,
      @NotBlank String name,
      @NotBlank String path,
      @JsonProperty("default") boolean defaultWorkspace
  ) {}

  public record UpdateApprovalPolicyRequest(@NotBlank String mode) {}

  public record RejectToolRequest(String reason) {}

  public record AnswerAskUserRequest(@NotNull List<Map<String, Object>> answers) {}

  public record SubmitExecutionResultRequest(
      @NotBlank String executionId,
      @NotBlank String status,
      @NotBlank String summary,
      Map<String, Object> data
  ) {
    ExecutionResultRecord toRecord() {
      return new ExecutionResultRecord(executionId, status, summary, data == null ? Map.of() : data);
    }
  }

  public record SubmitExecutionStreamEventRequest(
      @NotBlank String executionId,
      @NotBlank String runId,
      int sequence,
      @NotBlank String type,
      String contentDelta,
      Map<String, Object> payload
  ) {}

  public record CreateBranchRequest(@NotBlank String name, String description) {}

  public record CreateSkillProposalRequest(
      @NotBlank String workspaceId,
      @NotBlank String name,
      @NotBlank String scope,
      @NotBlank String markdownContent,
      @NotNull List<String> evidence,
      double confidence
  ) {}

  private String json(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (JsonProcessingException error) {
      throw new BadRequestException("Failed to encode event stream payload.");
    }
  }

  private String bearerToken(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) {
      throw new BadRequestException("Authorization header must use Bearer token.");
    }
    return authorization.substring("Bearer ".length()).trim();
  }

  private String optionalBearerToken(String authorization) {
    if (authorization == null || authorization.isBlank()) {
      return null;
    }
    return bearerToken(authorization);
  }
}
