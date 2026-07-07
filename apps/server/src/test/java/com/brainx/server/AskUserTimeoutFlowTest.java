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

@SpringBootTest(properties = "brainx.ask-user-timeout-seconds=1")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class AskUserTimeoutFlowTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;

  @Test
  void askUserTimeoutContinuesAsUnansweredToolResult() throws Exception {
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

    JsonNode waitingSession = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(waitingSession.get("runStatus").asText()).isEqualTo("waiting_for_user");
    assertThat(waitingSession.get("messages").get(1).has("blocks")).isFalse();
    assertThat(waitingSession.get("messages").get(1).get("tool_calls").get(0).get("function").get("name").asText()).isEqualTo("ask_user");
    JsonNode toolState = waitingSession.get("toolStates").get("call_question");
    assertThat(toolState.get("status").asText()).isEqualTo("waiting");
    assertThat(toolState.get("expiresAt").asText()).isNotBlank();

    Thread.sleep(1100);

    JsonNode continuation = onlyPendingRequest(daemonId);
    assertThat(continuation.get("toolName").asText()).isEqualTo("model.invoke");
    String messages = continuation.get("input").get("messages").toString();
    assertThat(messages).contains("\"role\":\"tool\"");
    assertThat(messages).contains("call_question");
    assertThat(messages).contains("unanswered");
    assertThat(messages).contains("timeout");

    JsonNode updatedSession = getJson("/api/v1/workspaces/w_core/chat/session");
    assertThat(updatedSession.get("runStatus").asText()).isEqualTo("waiting_for_client");
    assertThat(updatedSession.toString()).contains("unanswered");
    assertThat(getJson("/api/v1/agents/a_core/runs/" + runId + "/events").toString()).contains("tool.user_input.timeout");
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
}
