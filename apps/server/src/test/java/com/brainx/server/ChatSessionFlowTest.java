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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class ChatSessionFlowTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;

  @Test
  void sessionScopedMessagesAreIsolatedAndNewSessionStartsUntitled() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode created = postJson("/api/v1/workspaces/w_core/chat/sessions", "{}");

    assertThat(created.get("title").isNull()).isTrue();
    assertThat(created.get("messages")).hasSize(0);
    assertThat(created.get("availableModels").toString()).contains("nvidia-step").contains("gpt-5.5");

    postJson("/api/v1/workspaces/w_core/chat/sessions/" + created.get("id").asText() + "/messages", """
      {"content":"新会话第一轮"}
      """);
    JsonNode request = onlyPendingRequest(daemonId);

    assertThat(request.get("input").get("messages").toString()).contains("新会话第一轮");
    assertThat(getJson("/api/v1/workspaces/w_core/chat/session").get("messages").toString()).doesNotContain("新会话第一轮");
  }

  @Test
  void agentLoopRequestUsesCanonicalBrainxSystemPrompt() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看当前目录"}
      """);

    JsonNode request = onlyPendingRequest(daemonId);
    JsonNode input = request.get("input");
    String systemPrompt = input.get("messages").get(0).get("content").asText();

    assertThat(input.get("phase").asText()).isEqualTo("agent_loop");
    assertThat(input.has("tools") ? input.get("tools").isEmpty() : true).isTrue();
    assertThat(systemPrompt).contains("You are brainx, a local coding agent for project work.");
    assertThat(systemPrompt).contains("You work through a browser/server/client architecture.");
    assertThat(systemPrompt).contains("Use only the tools explicitly available in the current request.");
    assertThat(systemPrompt).contains("Do not claim that a command, file change, test, or tool action happened unless the corresponding tool result is present.");
    assertThat(systemPrompt).doesNotContain("web_search currently returns mock");
    assertThat(systemPrompt).doesNotContain("create_subagent");
    assertThat(systemPrompt).doesNotContain("branch_action");
    assertThat(systemPrompt).doesNotContain("skill_action");
  }

  @Test
  void queuedInputsDrainTogetherIntoOneFollowupRun() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode first = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"第一轮"}
      """);
    JsonNode firstRequest = onlyPendingRequest(daemonId);

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"插话 1"}
      """);
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"插话 2"}
      """);
    JsonNode queued = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"插话 3"}
      """);
    assertThat(queued.get("queuedInputs")).hasSize(3);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"first completed",
        "data":{
          "messages":[
            {"role":"system","content":"hidden system"},
            {"role":"user","content":"第一轮"},
            {"role":"assistant","content":"第一轮完成","toolCalls":[]}
          ]
        }
      }
      """.formatted(firstRequest.get("executionId").asText()));

    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    JsonNode nextRequest = onlyPendingRequest(daemonId);

    assertThat(session.get("runStatus").asText()).isEqualTo("waiting_for_client");
    assertThat(session.get("queuedInputs")).hasSize(0);
    assertThat(session.get("messages").toString()).contains("插话 1").contains("插话 2").contains("插话 3");
    assertThat(nextRequest.get("runId").asText()).isNotEqualTo(first.get("runId").asText());
    assertThat(nextRequest.get("input").get("messages").toString()).contains("插话 1").contains("插话 2").contains("插话 3");
    assertThat(pendingRequests(daemonId)).hasSize(1);
  }

  @Test
  void cancelSessionClearsQueueAndIgnoresLateClientResult() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode running = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"开始长任务"}
      """);
    String runId = running.get("runId").asText();
    JsonNode request = onlyPendingRequest(daemonId);
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"等待时插话"}
      """);

    JsonNode cancelled = postJson("/api/v1/workspaces/w_core/chat/sessions/chat_main/cancel", "{}");

    assertThat(cancelled.get("runStatus").asText()).isEqualTo("cancelled");
    assertThat(cancelled.get("queuedInputs")).hasSize(0);
    assertThat(pendingRequests(daemonId)).hasSize(0);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"late",
        "data":{"messages":[
          {"role":"system","content":"hidden"},
          {"role":"user","content":"开始长任务"},
          {"role":"assistant","content":"迟到结果","toolCalls":[]}
        ]}
      }
      """.formatted(request.get("executionId").asText()));

    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(session.get("runStatus").asText()).isEqualTo("cancelled");
    assertThat(session.get("messages").toString()).doesNotContain("迟到结果");
    assertThat(getJson("/api/v1/agents/a_core/runs/" + runId + "/events").toString()).contains("agent.run.cancelled");
  }

  @Test
  void forkAndDeleteSessionTreeFollowRunRules() throws Exception {
    JsonNode renamed = patchJson("/api/v1/workspaces/w_core/chat/sessions/chat_main", """
      {"title":"关于agent系统知识"}
      """);
    assertThat(renamed.get("title").asText()).isEqualTo("关于agent系统知识");

    JsonNode forked = postJson("/api/v1/workspaces/w_core/chat/sessions/chat_main/fork", "{}");
    assertThat(forked.get("parentSessionId").asText()).isEqualTo("chat_main");
    assertThat(forked.get("title").asText()).startsWith("关于agent系统知识 [fork: ");

    deleteOk("/api/v1/workspaces/w_core/chat/sessions/chat_main?confirm=true");
    JsonNode sessions = getJson("/api/v1/workspaces/w_core/chat/sessions");
    assertThat(sessions.toString()).doesNotContain("chat_main");
    assertThat(sessions.toString()).doesNotContain(forked.get("id").asText());
  }

  @Test
  void runningSessionCannotBeForkedAndDeleteCancelsIt() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"运行中"}
      """);
    postJson("/api/v1/workspaces/w_core/chat/sessions/chat_main/fork", "{}", status().isConflict());

    deleteOk("/api/v1/workspaces/w_core/chat/sessions/chat_main?confirm=true");

    assertThat(pendingRequests(daemonId)).hasSize(0);
    assertThat(getJson("/api/v1/workspaces/w_core/chat/sessions").toString()).doesNotContain("chat_main");
  }

  @Test
  void attachmentPayloadsAreBoundedByTypeAndSize() throws Exception {
    registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {
        "content":"video",
        "attachments":[{"id":"v","name":"demo.mp4","mimeType":"video/mp4","size":1024,"kind":"file"}]
      }
      """, status().isBadRequest());

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {
        "content":"huge text",
        "attachments":[{"id":"t","name":"huge.txt","mimeType":"text/plain","size":524289,"kind":"text","content":"small"}]
      }
      """, status().isBadRequest());
  }

  @Test
  void firstCompletedExchangeRequestsSessionTitleWhenTitleIsBlank() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode created = postJson("/api/v1/workspaces/w_core/chat/sessions", "{}");
    postJson("/api/v1/workspaces/w_core/chat/sessions/" + created.get("id").asText() + "/messages", """
      {"content":"解释 agent loop"}
      """);
    JsonNode firstRequest = onlyPendingRequest(daemonId);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"done",
        "data":{"messages":[
          {"role":"system","content":"hidden"},
          {"role":"user","content":"解释 agent loop"},
          {"role":"assistant","content":"Agent loop coordinates model and tools.","toolCalls":[]}
        ]}
      }
      """.formatted(firstRequest.get("executionId").asText()));

    JsonNode titleRequest = onlyPendingRequest(daemonId);
    assertThat(titleRequest.get("input").get("phase").asText()).isEqualTo("session_title");
    assertThat(titleRequest.get("input").get("messages").toString()).contains("Generate a concise professional chat title");

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"title",
        "data":{"message":{"role":"assistant","content":"Agent Loop Architecture"}}
      }
      """.formatted(titleRequest.get("executionId").asText()));

    JsonNode titled = getJson("/api/v1/workspaces/w_core/chat/sessions/" + created.get("id").asText());
    assertThat(titled.get("title").asText()).isEqualTo("Agent Loop Architecture");
  }

  @Test
  void failedModelInvocationMarksUserMessageFailedAndExcludesItFromNextContext() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"触发限流"}
      """);
    JsonNode failedRequest = onlyPendingRequest(daemonId);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"failed",
        "summary":"model.invoke failed: model provider returned HTTP 429: {\\\"status\\\":429,\\\"title\\\":\\\"Too Many Requests\\\"}",
        "data":{"error":"model provider returned HTTP 429: {\\\"status\\\":429,\\\"title\\\":\\\"Too Many Requests\\\"}"}
      }
      """.formatted(failedRequest.get("executionId").asText()));

    JsonNode failedSession = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(failedSession.get("runStatus").asText()).isEqualTo("failed");
    assertThat(failedSession.get("messages")).hasSize(1);
    assertThat(failedSession.get("messages").get(0).get("role").asText()).isEqualTo("user");
    assertThat(failedSession.get("messages").get(0).get("status").asText()).isEqualTo("failed");
    assertThat(failedSession.get("messages").get(0).get("error").get("message").asText()).isEqualTo("HTTP 429: Too Many Requests");
    assertThat(failedSession.get("messages").toString()).doesNotContain("model.invoke failed");

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"新的请求"}
      """);
    JsonNode nextRequest = onlyPendingRequest(daemonId);

    assertThat(nextRequest.get("input").get("messages").toString()).contains("新的请求");
    assertThat(nextRequest.get("input").get("messages").toString()).doesNotContain("触发限流");
  }

  private String registerLocalDaemon() throws Exception {
    return postJson("/api/v1/client-daemons/register", """
      {
        "workspaceId":"w_core",
        "deviceName":"local-dev",
        "capabilities":["model.invoke","agent.loop"]
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

  private JsonNode postJson(String path, String body) throws Exception {
    return postJson(path, body, status().is2xxSuccessful());
  }

  private JsonNode postJson(String path, String body, org.springframework.test.web.servlet.ResultMatcher status) throws Exception {
    String response = mvc.perform(post(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body))
      .andExpect(status)
      .andReturn()
      .getResponse()
      .getContentAsString();
    return response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
  }

  private JsonNode patchJson(String path, String body) throws Exception {
    String response = mvc.perform(patch(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body))
      .andExpect(status().is2xxSuccessful())
      .andReturn()
      .getResponse()
      .getContentAsString();
    return response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
  }

  private void deleteOk(String path) throws Exception {
    mvc.perform(delete(path)).andExpect(status().is2xxSuccessful());
  }

  private JsonNode getJson(String path) throws Exception {
    String response = mvc.perform(get(path))
      .andExpect(status().is2xxSuccessful())
      .andReturn()
      .getResponse()
      .getContentAsString();
    return response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
  }
}
