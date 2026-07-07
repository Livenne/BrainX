package com.brainx.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class AgentLoopFlowTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;

  @Test
  void workspacePromptExposesOnlyV1Tools() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看当前目录，读取多个文件，搜索代码，必要时修改文件或运行命令。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    String tools = modelRequest.get("input").get("tools").toString();

    assertThat(tools).contains("get_env");
    assertThat(tools).contains("read_files");
    assertThat(tools).contains("search_workspace");
    assertThat(tools).contains("apply_patch");
    assertThat(tools).contains("write_file");
    assertThat(tools).contains("run_command");
    assertThat(tools).contains("web_search");
    assertThat(tools).doesNotContain("get_environment");
    assertThat(tools).doesNotContain("ask_user");
    assertThat(tools).doesNotContain("todo_update");
    assertThat(tools).doesNotContain("background_start");
    assertThat(tools).doesNotContain("background_read");
    assertThat(tools).doesNotContain("background_stop");
    assertThat(tools).doesNotContain("subagent_start");
    assertThat(tools).doesNotContain("subagent_read");
    assertThat(tools).doesNotContain("subagent_stop");
    assertThat(tools).doesNotContain("\"name\":\"read_file\"");
    assertThat(tools).doesNotContain("\"name\":\"read_many_files\"");
    assertThat(tools).doesNotContain("list_files");
    assertThat(tools).doesNotContain("create_subagent");
  }

  @Test
  void chatSessionReturnsOpenAiMessagesAndToolStateSidecarOnly() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"先查看环境，再读取 apps/browser/package.json。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_env","name":"get_env","arguments":{}},
          {"id":"call_read","name":"read_files","arguments":{"files":[{"path":"apps/browser/package.json"}]}}
        ]
        """
    );

    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(session.has("toolStates")).isTrue();
    assertThat(session.get("toolStates").get("call_env").get("status").asText()).isEqualTo("running");
    assertThat(session.get("toolStates").get("call_read").get("status").asText()).isEqualTo("running");
    assertThat(session.get("toolStates").get("call_env").has("nickname")).isFalse();
    assertThat(session.get("toolStates").get("call_env").has("summary")).isFalse();
    assertThat(session.get("toolStates").get("call_env").has("renderMode")).isFalse();

    JsonNode messages = session.get("messages");
    assertThat(messages.get(0).get("role").asText()).isEqualTo("user");
    JsonNode assistantMessage = messages.get(1);
    assertThat(assistantMessage.get("role").asText()).isEqualTo("assistant");
    assertThat(assistantMessage.has("blocks")).isFalse();
    assertThat(assistantMessage.get("tool_calls")).hasSize(2);
    assertThat(assistantMessage.get("tool_calls").get(0).get("function").get("name").asText()).isEqualTo("get_env");
  }

  @Test
  void workspacePromptToolSchemasMatchFinalCsContract() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看当前目录，读取多个文件，搜索代码，必要时修改文件或运行命令。"}
      """);

    JsonNode tools = onlyPendingRequest(daemonId).get("input").get("tools");
    List<String> names = new ArrayList<>();
    tools.forEach(tool -> names.add(tool.get("function").get("name").asText()));
    assertThat(names).containsExactlyInAnyOrder(
        "get_env",
        "read_files",
        "search_workspace",
        "apply_patch",
        "write_file",
        "run_command",
        "web_search"
    );

    assertObjectSchema(toolByName(tools, "get_env"), List.of());
    assertThat(propertiesOf(tools, "get_env")).isEmpty();

    assertObjectSchema(toolByName(tools, "read_files"), List.of("files"));
    JsonNode readFiles = propertiesOf(tools, "read_files").get("files");
    assertThat(readFiles.get("type").asText()).isEqualTo("array");
    assertThat(fieldNames(readFiles.get("items").get("properties"))).containsExactlyInAnyOrder("path", "startLine", "endLine");
    assertThat(readFiles.get("items").get("additionalProperties").asBoolean()).isFalse();
    assertThat(propertiesOf(tools, "read_files").has("path")).isFalse();
    assertThat(propertiesOf(tools, "read_files").has("paths")).isFalse();

    assertObjectSchema(toolByName(tools, "search_workspace"), List.of("query"));
    assertThat(fieldNames(propertiesOf(tools, "search_workspace"))).containsExactlyInAnyOrder("query", "mode", "maxResults");
    assertThat(propertiesOf(tools, "search_workspace").get("mode").get("enum").toString()).contains("text", "filename", "regex");

    assertObjectSchema(toolByName(tools, "apply_patch"), List.of("patch"));
    assertThat(fieldNames(propertiesOf(tools, "apply_patch"))).containsExactlyInAnyOrder("patch", "dryRun");
    assertThat(propertiesOf(tools, "apply_patch").has("files")).isFalse();

    assertObjectSchema(toolByName(tools, "write_file"), List.of("path", "content", "overwrite"));
    assertThat(fieldNames(propertiesOf(tools, "write_file"))).containsExactlyInAnyOrder("path", "content", "overwrite", "createParents");
    assertThat(propertiesOf(tools, "write_file").has("mode")).isFalse();
    assertThat(propertiesOf(tools, "write_file").has("bytes")).isFalse();

    assertObjectSchema(toolByName(tools, "run_command"), List.of("command"));
    assertThat(fieldNames(propertiesOf(tools, "run_command"))).containsExactlyInAnyOrder("command", "workingDirectory", "timeoutSeconds");
    assertThat(propertiesOf(tools, "run_command").has("cwd")).isFalse();
    assertThat(propertiesOf(tools, "run_command").has("timeout_ms")).isFalse();
    assertThat(propertiesOf(tools, "run_command").has("shell")).isFalse();

    assertObjectSchema(toolByName(tools, "web_search"), List.of("query"));
    assertThat(fieldNames(propertiesOf(tools, "web_search"))).containsExactlyInAnyOrder("query", "domains", "recencyDays", "maxResults");
  }

  @Test
  void modelCanRequestMultipleToolsBeforeContinuation() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode queuedSession = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"先查看环境，再读取 apps/browser/package.json。"}
      """);
    String runId = queuedSession.get("runId").asText();

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_env","name":"get_env","arguments":{}},
          {"id":"call_read","name":"read_files","arguments":{"files":[{"path":"apps/browser/package.json"}]}}
        ]
        """
    );

    JsonNode toolRequests = pendingRequests(daemonId);
    assertThat(toolRequests).hasSize(2);
    assertThat(toolRequests.get(0).get("toolName").asText()).isEqualTo("get_env");
    assertThat(toolRequests.get(1).get("toolName").asText()).isEqualTo("read_files");

    postCompletedResult(daemonId, toolRequests.get(0), "environment inspected", """
      {"os":"linux","workspaceRoot":"/workspace/brainx"}
      """);
    JsonNode stillPending = pendingRequests(daemonId);
    assertThat(stillPending).hasSize(1);
    assertThat(stillPending.get(0).get("toolName").asText()).isEqualTo("read_files");

    postCompletedResult(daemonId, stillPending.get(0), "package read", """
      {"files":[{"ok":true,"path":"apps/browser/package.json","content":"{\\"dependencies\\":{\\"react\\":\\"19\\"}}"}]}
      """);
    JsonNode continuation = onlyPendingRequest(daemonId);
    assertThat(continuation.get("toolName").asText()).isEqualTo("model.invoke");
    String messages = continuation.get("input").get("messages").toString();
    assertThat(messages).contains("call_env");
    assertThat(messages).contains("call_read");
    assertThat(messages).contains("workspaceRoot");
    assertThat(messages).contains("react");
    assertThat(getJson("/api/v1/agents/a_core/runs/" + runId + "/events").toString()).contains("execution.requested");
  }

  @Test
  void zeroArgumentToolsDropModelSchemaArtifactsBeforeDispatch() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看当前运行环境。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_env","name":"get_env","arguments":{"additionalProperties":false}}
        ]
        """
    );

    JsonNode toolRequest = onlyPendingRequest(daemonId);
    assertThat(toolRequest.get("toolName").asText()).isEqualTo("get_env");
    assertThat(toolRequest.get("input").has("additionalProperties")).isFalse();
    assertThat(toolRequest.get("input").get("toolCallId").asText()).isEqualTo("call_env");
  }

  @Test
  void todoUpdateCompletesInsideServerWithoutClientDispatch() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode queuedSession = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"制定并更新任务列表。"}
      """);
    String runId = queuedSession.get("runId").asText();

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_todo","name":"todo_update","arguments":{"items":[{"id":"t1","title":"Inspect schemas","status":"completed","note":"done"},{"id":"t2","title":"Implement runtime","status":"in_progress"}],"reason":"after schema review"}}
        ]
        """
    );

    JsonNode continuation = onlyPendingRequest(daemonId);
    assertThat(continuation.get("toolName").asText()).isEqualTo("model.invoke");
    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(session.get("todos")).hasSize(2);
    assertThat(session.get("todos").get(0).get("title").asText()).isEqualTo("Inspect schemas");
    assertThat(session.get("todos").get(1).get("status").asText()).isEqualTo("in_progress");
    assertThat(continuation.get("input").get("messages").toString()).contains("call_todo");
    assertThat(getJson("/api/v1/agents/a_core/runs/" + runId + "/events").toString()).contains("tool.server.completed");
  }

  @Test
  void subagentLifecycleCompletesInsideServerWithoutClientDispatch() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"创建一个只读子 agent 检查渲染引用。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_sub_start","name":"subagent_start","arguments":{"task":"Review stale tool names","context":"read_files is the canonical file read tool","allowedTools":["get_env","read_files","search_workspace"],"allowedPaths":["apps/browser/**","docs/brainx/**"],"writeAccess":false,"budget":{"maxTurns":8,"maxMinutes":10},"successCriteria":["return exact file references"],"outputSchema":"summary_evidence_risks"}}
        ]
        """
    );

    JsonNode continuation = onlyPendingRequest(daemonId);
    String messages = continuation.get("input").get("messages").toString();
    assertThat(messages).contains("subagentId");
    JsonNode resultMessage = continuation.get("input").get("messages").get(3);
    String subagentId = mapper.readTree(resultMessage.get("content").asText()).get("subagentId").asText();

    postModelToolCalls(
        daemonId,
        continuation,
        """
        [
          {"id":"call_sub_read","name":"subagent_read","arguments":{"subagentId":"%s","includeEvents":false}}
        ]
        """.formatted(subagentId)
    );

    JsonNode secondContinuation = onlyPendingRequest(daemonId);
    assertThat(secondContinuation.get("toolName").asText()).isEqualTo("model.invoke");
    assertThat(secondContinuation.get("input").get("messages").toString()).contains("running");

    postModelToolCalls(
        daemonId,
        secondContinuation,
        """
        [
          {"id":"call_sub_stop","name":"subagent_stop","arguments":{"subagentId":"%s","reason":"Parent task changed direction."}}
        ]
        """.formatted(subagentId)
    );

    JsonNode thirdContinuation = onlyPendingRequest(daemonId);
    assertThat(thirdContinuation.get("input").get("messages").toString()).contains("cancelled");
    assertThat(pendingRequests(daemonId)).hasSize(1);
  }

  @Test
  void backgroundToolsDispatchToClientDaemon() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"启动后台 dev server。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_bg","name":"background_start","arguments":{"name":"browser-dev-server","command":"npm run dev -- --port 5173","workingDirectory":"apps/browser","maxRuntimeSeconds":14400,"purpose":"manual review"}}
        ]
        """
    );

    assertThat(pendingRequests(daemonId)).isEmpty();
    JsonNode waitingSession = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(waitingSession.get("runStatus").asText()).isEqualTo("waiting_for_approval");
    String approvalExecutionId = waitingSession.get("toolStates").get("call_bg").get("executionId").asText();
    postJson("/api/v1/workspaces/w_core/tool-approvals/" + approvalExecutionId + "/approve", "{}");

    JsonNode toolRequest = onlyPendingRequest(daemonId);
    assertThat(toolRequest.get("toolName").asText()).isEqualTo("background_start");
    assertThat(toolRequest.get("riskTier").asText()).isEqualTo("risky");
    assertThat(toolRequest.get("input").get("toolCallId").asText()).isEqualTo("call_bg");
    assertThat(toolRequest.get("input").get("command").asText()).contains("npm run dev");
  }

  @Test
  void writeToolsWaitForBrowserApprovalBeforeClientDispatch() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"创建 docs/check.md 文件。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_write","name":"write_file","arguments":{"path":"docs/check.md","content":"ok","overwrite":false}}
        ]
        """
    );

    assertThat(pendingRequests(daemonId)).isEmpty();
    JsonNode waitingSession = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(waitingSession.get("runStatus").asText()).isEqualTo("waiting_for_approval");
    JsonNode toolState = waitingSession.get("toolStates").get("call_write");
    assertThat(toolState.get("status").asText()).isEqualTo("waiting");
    String approvalExecutionId = toolState.get("executionId").asText();

    postJson("/api/v1/workspaces/w_core/tool-approvals/" + approvalExecutionId + "/approve", "{}");
    JsonNode toolRequest = onlyPendingRequest(daemonId);
    assertThat(toolRequest.get("toolName").asText()).isEqualTo("write_file");
    assertThat(toolRequest.get("riskTier").asText()).isEqualTo("risky");

    postCompletedResult(daemonId, toolRequest, "file written", """
      {"path":"docs/check.md","bytesWritten":2}
      """);
    JsonNode continuation = onlyPendingRequest(daemonId);
    assertThat(continuation.get("toolName").asText()).isEqualTo("model.invoke");
    assertThat(continuation.get("input").get("messages").toString()).contains("docs/check.md");
  }

  @Test
  void failedLocalToolResultIsRecordedAndContinuesLoop() throws Exception {
    String token = register("user_a", "pw-a-12345");
    patchJson("/api/v1/workspaces/w_core/approval-policy", """
      {"mode":"full_accept"}
      """, token);
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"修改 test_file.txt。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_patch","name":"apply_patch","arguments":{"patch":"--- a/test_file.txt\\n+++ b/test_file.txt\\n@@ -1 +1,2 @@\\n tool_runtime_test\\n+applied patch","dryRun":false}}
        ]
        """
    );

    JsonNode toolRequest = onlyPendingRequest(daemonId);
    postFailedResult(daemonId, toolRequest, "apply_patch failed", "git apply --check failed: patch does not apply");

    JsonNode continuation = onlyPendingRequest(daemonId);
    assertThat(continuation.get("toolName").asText()).isEqualTo("model.invoke");
    String messages = continuation.get("input").get("messages").toString();
    assertThat(messages).contains("\"role\":\"tool\"");
    assertThat(messages).contains("call_patch");
    assertThat(messages).contains("git apply --check failed");

    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(session.get("runStatus").asText()).isEqualTo("waiting_for_client");
    assertThat(session.get("toolStates").get("call_patch").get("status").asText()).isEqualTo("failed");
  }

  @Test
  void localToolResultWithJsonNullIsAcceptedAndContinuesLoop() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"搜索 agent 资料。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_web","name":"web_search","arguments":{"query":"AI agent"}}
        ]
        """
    );

    JsonNode toolRequest = onlyPendingRequest(daemonId);
    assertThat(toolRequest.get("toolName").asText()).isEqualTo("web_search");
    postCompletedResult(daemonId, toolRequest, "web_search completed", """
      {
        "query":"AI agent",
        "mock":true,
        "recencyDays":null,
        "results":[{"title":"Mock","url":"https://example.invalid","snippet":"ok"}]
      }
      """);

    JsonNode continuation = onlyPendingRequest(daemonId);
    assertThat(continuation.get("toolName").asText()).isEqualTo("model.invoke");
    String messages = continuation.get("input").get("messages").toString();
    assertThat(messages).contains("call_web");
    assertThat(messages).contains("recencyDays");
  }

  @Test
  void oversizedLocalToolResultIsBoundedBeforeNextModelContext() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"读取大文件。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_read","name":"read_files","arguments":{"files":[{"path":"large.txt"}]}}
        ]
        """
    );

    JsonNode toolRequest = onlyPendingRequest(daemonId);
    String hugeContent = "x".repeat(120_000);
    postCompletedResult(daemonId, toolRequest, "read_files completed", mapper.writeValueAsString(Map.of(
        "files", List.of(Map.of("ok", true, "path", "large.txt", "content", hugeContent))
    )));

    JsonNode continuation = onlyPendingRequest(daemonId);
    String messages = continuation.get("input").get("messages").toString();
    assertThat(messages.length()).isLessThan(80_000);
    assertThat(messages).contains("toolResultTruncated");
    assertThat(messages).contains("originalChars");
  }

  @Test
  void askUserWaitsForBrowserAnswerAndContinuesAsToolResult() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode queuedSession = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"如果不确定就问我选择哪个方案。"}
      """);
    String runId = queuedSession.get("runId").asText();

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_question","name":"ask_user","arguments":{"questions":[{"id":"plan","question":"选择方案？","options":[{"id":"a","label":"A","description":"推荐","recommended":true}],"allowOther":true}]}}
        ]
        """
    );

    assertThat(pendingRequests(daemonId)).isEmpty();
    JsonNode waitingSession = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(waitingSession.get("runStatus").asText()).isEqualTo("waiting_for_user");
    assertThat(waitingSession.get("messages").get(1).get("tool_calls").get(0).get("function").get("name").asText()).isEqualTo("ask_user");

    postJson("/api/v1/workspaces/w_core/ask-user/" + runId + "/call_question/answers", """
      {"answers":[{"id":"plan","selectedOptionId":"a","text":"A","isOther":false}]}
      """);

    JsonNode continuation = onlyPendingRequest(daemonId);
    assertThat(continuation.get("toolName").asText()).isEqualTo("model.invoke");
    String messages = continuation.get("input").get("messages").toString();
    assertThat(messages).contains("\"role\":\"tool\"");
    assertThat(messages).contains("call_question");
    assertThat(messages).contains("selectedOptionId");
    assertThat(messages).contains("\\\"a\\\"");
  }

  @Test
  void fullAcceptApprovalModeDispatchesRiskyToolsWithoutBrowserApproval() throws Exception {
    String token = register("user_a", "pw-a-12345");
    patchJson("/api/v1/workspaces/w_core/approval-policy", """
      {"mode":"full_accept"}
      """, token);
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"创建 docs/check.md 文件。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelToolCalls(
        daemonId,
        modelRequest,
        """
        [
          {"id":"call_write","name":"write_file","arguments":{"path":"docs/check.md","content":"ok","overwrite":false}}
        ]
        """
    );

    JsonNode toolRequest = onlyPendingRequest(daemonId);
    assertThat(toolRequest.get("toolName").asText()).isEqualTo("write_file");
    assertThat(toolRequest.get("riskTier").asText()).isEqualTo("risky");
    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(session.get("runStatus").asText()).isEqualTo("running");
    assertThat(session.get("toolStates").get("call_write").get("status").asText()).isEqualTo("running");
  }

  @Test
  void clearSlashCommandDoesNotEnterConversationMessages() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"先记住这句话。"}
      """);
    JsonNode modelRequest = onlyPendingRequest(daemonId);
    postModelText(daemonId, modelRequest, "已记录。");
    assertThat(getJson("/api/v1/workspaces/w_core/chat/session").get("messages")).hasSize(2);

    JsonNode cleared = postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"clear","arguments":{}}
      """);

    assertThat(cleared.get("messages")).isEmpty();
    assertThat(cleared.toString()).doesNotContain("/clear");
    assertThat(cleared.get("contextBudget").get("messageCount").asInt()).isEqualTo(0);
  }

  @Test
  void modelSlashCommandSetsWorkspaceModelPreferenceForNextInvoke() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode updated = postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"model","arguments":{"modelName":"nvidia-step"}}
      """);
    assertThat(updated.get("activeModelName").asText()).isEqualTo("nvidia-step");

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看当前环境。"}
      """);

    JsonNode modelRequest = onlyPendingRequest(daemonId);
    assertThat(modelRequest.get("input").get("modelName").asText()).isEqualTo("nvidia-step");
  }

  private JsonNode postJson(String path, String body) throws Exception {
    String response = mvc.perform(post(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body))
      .andExpect(status().is2xxSuccessful())
      .andReturn()
      .getResponse()
      .getContentAsString();
    return response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
  }

  private JsonNode patchJson(String path, String body, String token) throws Exception {
    var request = patch(path).contentType(MediaType.APPLICATION_JSON).content(body).header("Authorization", "Bearer " + token);
    String response = mvc.perform(request)
      .andExpect(status().is2xxSuccessful())
      .andReturn()
      .getResponse()
      .getContentAsString();
    return response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
  }

  private String register(String username, String password) throws Exception {
    return postJson("/api/v1/auth/register", """
      {"username":"%s","password":"%s"}
      """.formatted(username, password)).get("token").asText();
  }

  private JsonNode getJson(String path) throws Exception {
    String response = mvc.perform(get(path))
      .andExpect(status().is2xxSuccessful())
      .andReturn()
      .getResponse()
      .getContentAsString();
    return response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
  }

  private String registerLocalDaemon() throws Exception {
    return postJson("/api/v1/client-daemons/register", """
      {
        "workspaceId":"w_core",
        "deviceName":"local-dev",
        "capabilities":["model.invoke","tool.invoke","get_env","read_files","search_workspace","web_search","apply_patch","write_file","run_command","background_start","background_read","background_stop"]
      }
      """).get("id").asText();
  }

  private JsonNode pendingRequests(String daemonId) throws Exception {
    return getJson("/api/v1/client-daemons/" + daemonId + "/execution-requests");
  }

  private JsonNode onlyPendingRequest(String daemonId) throws Exception {
    JsonNode requests = pendingRequests(daemonId);
    assertThat(requests).hasSize(1);
    return requests.get(0);
  }

  private JsonNode toolByName(JsonNode tools, String name) {
    for (JsonNode tool : tools) {
      if (name.equals(tool.get("function").get("name").asText())) {
        return tool;
      }
    }
    throw new AssertionError("Missing tool schema: " + name);
  }

  private JsonNode propertiesOf(JsonNode tools, String name) {
    return toolByName(tools, name).get("function").get("parameters").get("properties");
  }

  private void assertObjectSchema(JsonNode tool, List<String> required) {
    JsonNode parameters = tool.get("function").get("parameters");
    assertThat(parameters.get("type").asText()).isEqualTo("object");
    assertThat(parameters.get("additionalProperties").asBoolean()).isFalse();
    assertThat(stringValues(parameters.get("required"))).containsExactlyInAnyOrderElementsOf(required);
  }

  private List<String> fieldNames(JsonNode object) {
    var names = new ArrayList<String>();
    object.fieldNames().forEachRemaining(names::add);
    return names;
  }

  private List<String> stringValues(JsonNode array) {
    var values = new ArrayList<String>();
    array.forEach(value -> values.add(value.asText()));
    return values;
  }

  private void postModelToolCalls(String daemonId, JsonNode modelRequest, String toolCalls) throws Exception {
    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"model returned tool calls",
        "data":{
          "message":{
            "role":"assistant",
            "content":"",
            "toolCalls":%s
          }
        }
      }
      """.formatted(modelRequest.get("executionId").asText(), toolCalls));
  }

  private void postModelText(String daemonId, JsonNode modelRequest, String content) throws Exception {
    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"model returned text",
        "data":{
          "message":{
            "role":"assistant",
            "content":"%s"
          },
          "usage":{"promptTokens":10,"completionTokens":3,"totalTokens":13}
        }
      }
      """.formatted(modelRequest.get("executionId").asText(), content));
  }

  private void postCompletedResult(String daemonId, JsonNode request, String summary, String data) throws Exception {
    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"%s",
        "data":%s
      }
      """.formatted(request.get("executionId").asText(), summary, data));
  }

  private void postFailedResult(String daemonId, JsonNode request, String summary, String error) throws Exception {
    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"failed",
        "summary":"%s",
        "data":{"error":"%s"}
      }
      """.formatted(request.get("executionId").asText(), summary, error));
  }
}
