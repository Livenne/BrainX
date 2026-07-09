package com.brainx.server;

import com.brainx.server.core.BrainxState;
import com.brainx.server.core.BrainxStateSnapshot;
import com.brainx.server.core.BrainxStateStore;
import com.brainx.server.core.ChatSessionRecord;
import com.brainx.server.core.ExecutionRequestRecord;
import com.brainx.server.core.SkillProposalRecord;
import com.brainx.server.core.SqliteBrainxStateStore;
import com.brainx.server.core.WorkspaceRecord;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class StatePersistenceTest {
  @Test
  void sqliteSnapshotPersistsBoundClientsUsersAndChatSessions() throws Exception {
    var database = Files.createTempFile("brainx-state-", ".sqlite");
    var mapper = new ObjectMapper().findAndRegisterModules();
    var store = new SqliteBrainxStateStore(mapper, database.toString());
    var firstState = new BrainxState(120, store);

    var auth = firstState.registerUser("user_a", "pw-a-12345");
    var registered = firstState.registerDaemon(
        "w_core",
        "devbox",
        "Linux test",
        "install-devbox",
        java.util.List.of("model.invoke", "agent.loop")
    );
    var bindCode = firstState.createBindCodeForDaemon(registered.id());
    firstState.completeBindView(auth.token(), bindCode.code());
    var createdSession = firstState.createChatSession("w_core", "Persisted session", registered.id());
    firstState.persist();

    var restoredState = new BrainxState(120, store);

    assertThat(restoredState.clientDaemons(auth.token())).hasSize(1);
    assertThat(restoredState.chatSessions("w_core", registered.id()))
        .extracting(session -> session.id())
        .contains(createdSession.id());
  }

  @Test
  void restoredSnapshotDropsLegacyBlankToolCallsAndTheirResults() {
    var now = Instant.now();
    var pollutedSession = new ChatSessionRecord(
        "chat_polluted",
        "Polluted",
        null,
        "chat_polluted",
        null,
        "w_core",
        "",
        "Brainx Local",
        "~/.brainx/workspace",
        "a_core",
        "Brainx Agent",
        "b_main",
        "mainline",
        "",
        "Local device",
        "",
        "completed",
        List.of(),
        List.of(),
        List.of(),
        Map.of(),
        Map.of(),
        List.of(),
        "primary:example-chat-model",
        List.of(),
        List.of(),
        now,
        now,
        List.of(
            Map.of("role", "user", "content", "调 env"),
            Map.of(
                "role", "assistant",
                "content", "",
                "toolCalls", List.of(Map.of("id", "call_blank", "name", "", "arguments", Map.of()))
            ),
            Map.of(
                "role", "tool",
                "toolCallId", "call_blank",
                "name", "",
                "content", "{\"ok\":false,\"error\":\"unsupported tool: \"}"
            ),
            Map.of("role", "assistant", "content", "后续回复")
        )
    );
    var pollutedRequest = ExecutionRequestRecord.modelInvoke(
        "exec_polluted",
        "w_core",
        "a_core",
        "b_main",
        "run_polluted",
        "agent_loop",
        1,
        pollutedSession.messages(),
        List.of()
    );
    var state = new BrainxState(120, new MemoryStateStore(emptySnapshot(
        Map.of("chat_polluted", pollutedSession),
        Map.of("exec_polluted", pollutedRequest)
    )));

    var restored = state.getChatSession("w_core", "chat_polluted");
    var daemon = state.registerDaemon("w_core", "devbox", "Linux test", "install-test", List.of("model.invoke"));
    var request = state.pendingExecutionRequests(daemon.id());

    assertThat(restored.messages())
        .extracting(message -> message.get("role"))
        .containsExactly("user", "assistant");
    assertThat(restored.messages().get(1).get("content")).isEqualTo("后续回复");
    assertThat(restored.messages().toString()).doesNotContain("unsupported tool");
    assertThat(restored.messages().toString()).doesNotContain("name=");
    assertThat(request.getFirst().input().get("messages").toString()).doesNotContain("unsupported tool");
    assertThat(request.getFirst().input().get("messages").toString()).doesNotContain("name=");
  }

  @Test
  void restoredSnapshotSupersedesPendingSkillProposalsAlreadyPublishedAtSamePath() {
    var now = Instant.now();
    var path = "/tmp/project/.agents/skills/debug/SKILL.md";
    var published = new SkillProposalRecord(
        "sp_published",
        "w_core",
        "run_skill",
        "daemon_local",
        "debug",
        "project",
        path,
        "# Debug\n",
        "Already approved",
        List.of("evidence"),
        0.8,
        "published",
        1,
        now.minusSeconds(60),
        now.minusSeconds(30)
    );
    var duplicatePending = new SkillProposalRecord(
        "sp_pending",
        "w_core",
        "run_skill",
        "daemon_local",
        "debug",
        "project",
        path,
        "# Debug\n",
        "Duplicate pending proposal",
        List.of("evidence"),
        0.8,
        "review_requested",
        1,
        now,
        null
    );

    var state = new BrainxState(120, new MemoryStateStore(emptySnapshot(
        Map.of(),
        Map.of(),
        Map.of(published.id(), published, duplicatePending.id(), duplicatePending)
    )));

    assertThat(state.skillProposals())
        .filteredOn(proposal -> proposal.id().equals("sp_pending"))
        .singleElement()
        .extracting(SkillProposalRecord::status)
        .isEqualTo("superseded");
  }

  @Test
  void restoredLegacyModelPreferenceMapsToProviderPrefixedCatalogKey() {
    var now = Instant.now();
    var session = new ChatSessionRecord(
        "chat_model",
        "Model session",
        null,
        "chat_model",
        null,
        "w_core",
        "daemon_local",
        "Brainx Local",
        "~/.brainx/workspace",
        "a_core",
        "Brainx Agent",
        "b_main",
        "mainline",
        "",
        "Local device",
        "",
        "completed",
        List.of(),
        List.of(),
        List.of(),
        Map.of(),
        Map.of(),
        List.of(),
        "example-reasoning-model",
        List.of(),
        List.of(),
        now,
        now,
        List.of()
    );
    Map<String, Map<String, Object>> catalog = Map.of(
        "daemon_local",
        Map.<String, Object>of(
            "models",
            List.of(
                Map.of("name", "primary:01-ai/yi-large", "key", "primary:01-ai/yi-large", "providerName", "primary", "model", "01-ai/yi-large", "protocol", "openai"),
                Map.of("name", "primary:example-chat-model", "key", "primary:example-chat-model", "providerName", "primary", "model", "example-chat-model", "protocol", "openai"),
                Map.of("name", "secondary:example-reasoning-model", "key", "secondary:example-reasoning-model", "providerName", "secondary", "model", "example-reasoning-model", "protocol", "openai")
            )
        )
    );
    var state = new BrainxState(120, new MemoryStateStore(emptySnapshot(
        Map.of("chat_model", session),
        Map.of(),
        Map.of(),
        Map.of("w_core", "example-reasoning-model"),
        catalog,
        Map.of("w_core", new WorkspaceRecord("w_core", "Brainx Local", "~/.brainx/workspace", true, "active", now))
    )));

    assertThat(state.getChatSession("w_core", "chat_model").activeModelName()).isEqualTo("secondary:example-reasoning-model");
  }

  private static BrainxStateSnapshot emptySnapshot(Map<String, ChatSessionRecord> chatSessions) {
    return emptySnapshot(chatSessions, Map.of());
  }

  private static BrainxStateSnapshot emptySnapshot(
      Map<String, ChatSessionRecord> chatSessions,
      Map<String, ExecutionRequestRecord> executionRequests
  ) {
    return emptySnapshot(chatSessions, executionRequests, Map.of());
  }

  private static BrainxStateSnapshot emptySnapshot(
      Map<String, ChatSessionRecord> chatSessions,
      Map<String, ExecutionRequestRecord> executionRequests,
      Map<String, SkillProposalRecord> skillProposals
  ) {
    return emptySnapshot(chatSessions, executionRequests, skillProposals, Map.of(), Map.of());
  }

  private static BrainxStateSnapshot emptySnapshot(
      Map<String, ChatSessionRecord> chatSessions,
      Map<String, ExecutionRequestRecord> executionRequests,
      Map<String, SkillProposalRecord> skillProposals,
      Map<String, String> activeModelNamesByWorkspace,
      Map<String, Map<String, Object>> modelCatalogByDaemon
  ) {
    return emptySnapshot(chatSessions, executionRequests, skillProposals, activeModelNamesByWorkspace, modelCatalogByDaemon, Map.of());
  }

  private static BrainxStateSnapshot emptySnapshot(
      Map<String, ChatSessionRecord> chatSessions,
      Map<String, ExecutionRequestRecord> executionRequests,
      Map<String, SkillProposalRecord> skillProposals,
      Map<String, String> activeModelNamesByWorkspace,
      Map<String, Map<String, Object>> modelCatalogByDaemon,
      Map<String, WorkspaceRecord> workspaces
  ) {
    return new BrainxStateSnapshot(
        workspaces,
        Map.of(), // agents
        Map.of(), // branches
        Map.of(), // runs
        Map.of(), // daemons
        Map.of(), // workspaceIdsByDaemon
        Map.of(), // users
        Map.of(), // userIdsByUsername
        Map.of(), // authSessions
        Map.of(), // bindCodes
        Map.of(), // approvalPolicies
        activeModelNamesByWorkspace,
        Map.of(), // availableModelsByWorkspace
        Map.of(), // lastTokenUsageByWorkspace
        Map.of(), // tokenUsageTotalsByWorkspaceAndModel
        modelCatalogByDaemon,
        executionRequests,
        skillProposals,
        Map.of(), // skillInventoryByDaemon
        Map.of(), // skillProposalExecutionIds
        Map.of(), // subagentTasks
        chatSessions,
        Map.of(), // chatSessionIdsByRun
        Map.of(), // runSteps
        Map.of(), // executionEvents
        java.util.Set.of()
    );
  }

  private static final class MemoryStateStore implements BrainxStateStore {
    private final BrainxStateSnapshot snapshot;

    private MemoryStateStore(BrainxStateSnapshot snapshot) {
      this.snapshot = snapshot;
    }

    @Override
    public Optional<BrainxStateSnapshot> load() {
      return Optional.of(snapshot);
    }

    @Override
    public void save(BrainxStateSnapshot snapshot) {
    }
  }
}
