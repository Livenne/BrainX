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
  void pausedAskUserResultIsExposedAsWaitingSessionState() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"如果不确定就问我选择哪个方案。"}
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
            {"role":"system","content":"hidden"},
            {"role":"user","content":"如果不确定就问我选择哪个方案。"},
            {"role":"assistant","content":"","toolCalls":[{"id":"call_question","name":"ask_user","arguments":{"question":"选择方案？","options":["A","B"]}}]},
            {"role":"tool","toolCallId":"call_question","name":"ask_user","content":"{\\"status\\":\\"waiting_for_user\\",\\"question\\":\\"选择方案？\\"}"}
          ]
        }
      }
      """.formatted(request.get("executionId").asText()));

    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");

    assertThat(session.get("runStatus").asText()).isEqualTo("waiting_for_user");
    assertThat(session.get("messages").toString()).contains("call_question");
    assertThat(session.get("messages").toString()).contains("选择方案");
    assertThat(pendingRequests(daemonId)).hasSize(0);
  }

  @Test
  void nestedPausedAskUserResultTimesOutAndContinuesAgentLoop() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"如果不确定就问我选择哪个方案。"}
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
            {"role":"system","content":"hidden"},
            {"role":"user","content":"如果不确定就问我选择哪个方案。"},
            {"role":"assistant","content":"","toolCalls":[{"id":"call_question","name":"ask_user","arguments":{"question":"选择方案？","options":["A","B"]}}]},
            {"role":"tool","toolCallId":"call_question","name":"ask_user","content":"{\\"ok\\":true,\\"result\\":{\\"status\\":\\"waiting_for_user\\",\\"question\\":\\"选择方案？\\",\\"options\\":[\\"A\\",\\"B\\"]}}"}
          ]
        }
      }
      """.formatted(request.get("executionId").asText()));

    Thread.sleep(1100);
    JsonNode session = getJson("/api/v1/workspaces/w_core/chat/session");
    JsonNode nextRequest = onlyPendingRequest(daemonId);

    assertThat(session.get("runStatus").asText()).isEqualTo("waiting_for_client");
    assertThat(session.get("messages").toString()).contains("unanswered");
    assertThat(nextRequest.get("toolName").asText()).isEqualTo("model.invoke");
    assertThat(nextRequest.get("input").get("messages").toString()).contains("unanswered");
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
