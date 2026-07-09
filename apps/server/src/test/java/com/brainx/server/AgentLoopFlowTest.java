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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class AgentLoopFlowTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;

  @Test
  void chatMessageQueuesClientSideAgentLoopWithoutServerToolSchemas() throws Exception {
    String daemonId = registerLocalDaemon();

    JsonNode session = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看当前目录"}
      """);
    JsonNode request = onlyPendingRequest(daemonId);

    assertThat(session.get("runStatus").asText()).isEqualTo("waiting_for_client");
    assertThat(request.get("toolName").asText()).isEqualTo("model.invoke");
    assertThat(request.get("input").get("phase").asText()).isEqualTo("agent_loop");
    assertThat(request.get("input").has("tools")).isFalse();
    assertThat(request.get("input").get("modelName").asText()).isEqualTo("nvidia-step");
    assertThat(request.get("input").get("currentWorkspace").asText()).isEqualTo("~/.brainx/workspace");
    assertThat(request.get("input").get("messages").get(0).get("role").asText()).isEqualTo("system");
    assertThat(request.get("input").get("messages").get(1).get("content").asText()).isEqualTo("查看当前目录");
  }

  @Test
  void clearCommandDuringActiveRunReturnsConflictInsteadOfSilentlyDoingNothing() throws Exception {
    String daemonId = registerLocalDaemon();

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"读取当前目录"}
      """);
    mvc.perform(post("/api/v1/workspaces/w_core/chat/commands")
        .contentType(MediaType.APPLICATION_JSON)
        .content("""
      {"command":"clear","arguments":{}}
      """))
      .andExpect(status().isConflict());
    JsonNode request = onlyPendingRequest(daemonId);

    assertThat(request.get("input").get("phase").asText()).isEqualTo("agent_loop");
    assertThat(request.get("input").get("currentWorkspace").asText()).isEqualTo("~/.brainx/workspace");
  }

  @Test
  void compactCommandDuringActiveRunReturnsConflictInsteadOfSilentlyDoingNothing() throws Exception {
    String daemonId = registerLocalDaemon();

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"准备压缩前先开始一轮"}
      """);
    mvc.perform(post("/api/v1/workspaces/w_core/chat/commands")
        .contentType(MediaType.APPLICATION_JSON)
        .content("""
      {"command":"compact","arguments":{}}
      """))
      .andExpect(status().isConflict());
    JsonNode request = onlyPendingRequest(daemonId);

    assertThat(request.get("input").get("phase").asText()).isEqualTo("agent_loop");
  }

  @Test
  void workspaceChatCommandUpdatesCurrentWorkspaceWhenIdle() throws Exception {
    postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"workspace","arguments":{"path":"/tmp/brainx-project"}}
      """);

    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(session.get("currentWorkspace").asText()).isEqualTo("/tmp/brainx-project");
  }

  @Test
  void workspaceChatCommandUpdatesNextModelInvokeCurrentWorkspace() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"workspace","arguments":{"path":"/tmp/brainx-project"}}
      """);

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看当前目录"}
      """);

    JsonNode request = onlyPendingRequest(daemonId);
    assertThat(request.get("input").get("currentWorkspace").asText()).isEqualTo("/tmp/brainx-project");
  }

  @Test
  void clientStreamEventsAreRecordedAndExposedForChatSse() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode queued = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"流式回复"}
      """);
    JsonNode request = onlyPendingRequest(daemonId);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-stream-events", """
      {
        "executionId":"%s",
        "runId":"%s",
        "sequence":1,
        "type":"assistant_delta",
        "contentDelta":"正在检查",
        "payload":{"protocol":"openai"}
      }
      """.formatted(request.get("executionId").asText(), queued.get("runId").asText()));

    JsonNode events = getJson("/api/v1/agents/a_core/runs/" + queued.get("runId").asText() + "/events");
    assertThat(events.toString()).contains("model.stream.delta").contains("正在检查");

    String stream = mvc.perform(get("/api/v1/workspaces/w_core/chat/events")
        .param("runId", queued.get("runId").asText())
        .param("after", "0"))
      .andExpect(status().isOk())
      .andReturn()
      .getResponse()
      .getContentAsString();
    assertThat(stream).contains("event: model.stream.delta").contains("正在检查");
  }

  @Test
  void completedClientSideAgentLoopReplacesSessionWithReturnedStandardMessages() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode queued = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"列出目录"}
      """);
    String runId = queued.get("runId").asText();
    JsonNode request = onlyPendingRequest(daemonId);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"agent loop completed",
        "data":{
          "message":{"role":"assistant","content":"README.md is present.","toolCalls":[]},
          "messages":[
            {"role":"system","content":"hidden system"},
            {"role":"user","content":"列出目录"},
            {"role":"assistant","content":"","toolCalls":[{"id":"call_list","name":"list_directory","arguments":{"path":"."}}]},
            {"role":"tool","toolCallId":"call_list","name":"list_directory","content":"{\\"entries\\":[{\\"path\\":\\"README.md\\"}]}"},
            {"role":"assistant","content":"README.md is present.","toolCalls":[]}
          ],
          "usage":{"total_tokens":18}
        }
      }
      """.formatted(request.get("executionId").asText()));

    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(session.get("runStatus").asText()).isEqualTo("completed");
    assertThat(session.get("messages")).hasSize(4);
    assertThat(session.get("messages").get(0).get("role").asText()).isEqualTo("user");
    assertThat(session.get("messages").toString()).contains("call_list");
    assertThat(session.get("messages").toString()).contains("README.md is present.");
    assertThat(getJson("/api/v1/agents/a_core/runs/" + runId + "/events").toString()).contains("agent.run.completed");
    assertThat(pendingRequests(daemonId)).hasSize(0);
  }

  @Test
  void chatMessageSentDuringActiveRunIsQueuedAndDrainedAfterCurrentRunCompletes() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode first = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"第一轮"}
      """);
    JsonNode firstRequest = onlyPendingRequest(daemonId);

    JsonNode queued = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"插话：第二轮"}
      """);

    assertThat(queued.get("runStatus").asText()).isEqualTo("waiting_for_client");
    assertThat(queued.get("messages")).hasSize(1);
    assertThat(queued.get("queuedInputs")).hasSize(1);
    assertThat(queued.get("queuedInputs").get(0).get("content").asText()).isEqualTo("插话：第二轮");

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"first completed",
        "data":{
          "message":{"role":"assistant","content":"第一轮完成","toolCalls":[]},
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
    assertThat(session.get("messages").toString()).contains("第一轮完成");
    assertThat(session.get("messages").toString()).contains("插话：第二轮");
    assertThat(nextRequest.get("runId").asText()).isNotEqualTo(first.get("runId").asText());
    assertThat(nextRequest.get("input").get("messages").toString()).contains("插话：第二轮");
  }

  @Test
  void chatMessageAttachmentsAreIncludedInStandardUserContent() throws Exception {
    String daemonId = registerLocalDaemon();

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {
        "content":"看看附件",
        "attachments":[
          {
            "id":"att_1",
            "name":"notes.txt",
            "mimeType":"text/plain",
            "size":11,
            "kind":"text",
            "content":"hello world"
          },
          {
            "id":"att_2",
            "name":"screen.png",
            "mimeType":"image/png",
            "size":12,
            "kind":"image",
            "dataUrl":"data:image/png;base64,AAAA"
          }
        ]
      }
      """);
    JsonNode request = onlyPendingRequest(daemonId);
    JsonNode content = request.get("input").get("messages").get(1).get("content");

    assertThat(content.isArray()).isTrue();
    assertThat(content.get(0).get("type").asText()).isEqualTo("text");
    assertThat(content.get(0).get("text").asText()).isEqualTo("看看附件");
    assertThat(content.toString()).contains("notes.txt").contains("hello world");
    assertThat(content.toString()).contains("image_url").contains("data:image/png;base64,AAAA");
  }

  @Test
  void pausedClientSideAgentLoopKeepsRunWaitingForUser() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"需要时问我"}
      """);
    JsonNode request = onlyPendingRequest(daemonId);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"agent loop paused",
        "data":{
          "paused":true,
          "pause":{"status":"waiting_for_user","question":"选择方案？"},
          "messages":[
            {"role":"system","content":"hidden system"},
            {"role":"user","content":"需要时问我"},
            {"role":"assistant","content":"","toolCalls":[{"id":"call_question","name":"ask_user","arguments":{"question":"选择方案？"}}]},
            {"role":"tool","toolCallId":"call_question","name":"ask_user","content":"{\\"status\\":\\"waiting_for_user\\",\\"question\\":\\"选择方案？\\"}"}
          ]
        }
      }
      """.formatted(request.get("executionId").asText()));

    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(session.get("runStatus").asText()).isEqualTo("waiting_for_user");
    assertThat(session.get("toolStates").get("call_question").get("status").asText()).isEqualTo("waiting");
    assertThat(session.get("messages").toString()).contains("选择方案");
  }

  @Test
  void nestedPausedAskUserResultIsExposedAsWaitingToolState() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"需要时问我"}
      """);
    JsonNode request = onlyPendingRequest(daemonId);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"agent loop paused",
        "data":{
          "paused":true,
          "messages":[
            {"role":"system","content":"hidden system"},
            {"role":"user","content":"需要时问我"},
            {"role":"assistant","content":"","toolCalls":[{"id":"call_question","name":"ask_user","arguments":{"question":"选择方案？","options":["A","B"]}}]},
            {"role":"tool","toolCallId":"call_question","name":"ask_user","content":"{\\"ok\\":true,\\"result\\":{\\"status\\":\\"waiting_for_user\\",\\"question\\":\\"选择方案？\\",\\"options\\":[\\"A\\",\\"B\\"]}}"}
          ]
        }
      }
      """.formatted(request.get("executionId").asText()));

    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");

    assertThat(session.get("runStatus").asText()).isEqualTo("waiting_for_user");
    assertThat(session.get("toolStates").get("call_question").get("status").asText()).isEqualTo("waiting");
    assertThat(session.get("toolStates").get("call_question").has("expiresAt")).isTrue();
  }

  @Test
  void answeringAskUserContinuesThroughClientSideAgentLoop() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode queued = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"需要时问我"}
      """);
    String runId = queued.get("runId").asText();
    JsonNode request = onlyPendingRequest(daemonId);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"agent loop paused",
        "data":{
          "paused":true,
          "messages":[
            {"role":"system","content":"hidden system"},
            {"role":"user","content":"需要时问我"},
            {"role":"assistant","content":"","toolCalls":[{"id":"call_question","name":"ask_user","arguments":{"question":"选择方案？"}}]},
            {"role":"tool","toolCallId":"call_question","name":"ask_user","content":"{\\"status\\":\\"waiting_for_user\\",\\"question\\":\\"选择方案？\\"}"}
          ]
        }
      }
      """.formatted(request.get("executionId").asText()));

    postJson("/api/v1/workspaces/w_core/ask-user/" + runId + "/call_question/answers", """
      {"answers":[{"id":"choice","text":"使用 A","isOther":false}]}
      """);
    JsonNode nextRequest = onlyPendingRequest(daemonId);
    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");

    assertThat(session.get("runStatus").asText()).isEqualTo("waiting_for_client");
    assertThat(nextRequest.get("input").get("phase").asText()).isEqualTo("agent_loop");
    assertThat(nextRequest.get("input").has("tools")).isFalse();
    assertThat(nextRequest.get("input").get("messages").toString()).contains("使用 A");
  }

  @Test
  void answeringNestedAskUserContinuesThroughClientSideAgentLoop() throws Exception {
    String daemonId = registerLocalDaemon();
    JsonNode queued = postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"需要时问我"}
      """);
    String runId = queued.get("runId").asText();
    JsonNode request = onlyPendingRequest(daemonId);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"agent loop paused",
        "data":{
          "paused":true,
          "messages":[
            {"role":"system","content":"hidden system"},
            {"role":"user","content":"需要时问我"},
            {"role":"assistant","content":"","toolCalls":[{"id":"call_question","name":"ask_user","arguments":{"question":"选择方案？","options":["A","B"]}}]},
            {"role":"tool","toolCallId":"call_question","name":"ask_user","content":"{\\"ok\\":true,\\"result\\":{\\"status\\":\\"waiting_for_user\\",\\"question\\":\\"选择方案？\\",\\"options\\":[\\"A\\",\\"B\\"]}}"}
          ]
        }
      }
      """.formatted(request.get("executionId").asText()));

    postJson("/api/v1/workspaces/w_core/ask-user/" + runId + "/call_question/answers", """
      {"answers":[{"id":"choice","text":"使用 A","isOther":false}]}
      """);
    JsonNode nextRequest = onlyPendingRequest(daemonId);
    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");

    assertThat(session.get("runStatus").asText()).isEqualTo("waiting_for_client");
    assertThat(nextRequest.get("input").get("phase").asText()).isEqualTo("agent_loop");
    assertThat(nextRequest.get("input").get("messages").toString()).contains("使用 A");
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
    String response = mvc.perform(post(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body))
      .andExpect(status().is2xxSuccessful())
      .andReturn()
      .getResponse()
      .getContentAsString();
    return response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
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
