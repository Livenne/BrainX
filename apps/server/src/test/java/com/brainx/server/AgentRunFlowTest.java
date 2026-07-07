package com.brainx.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class AgentRunFlowTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;

  @Test
  void daemonCompletesFirstAgentRunExecution() throws Exception {
    String workspaceId = postJson("/api/v1/workspaces", """
      {"name":"Brainx Local"}
      """).get("id").asText();

    String agentId = postJson("/api/v1/workspaces/" + workspaceId + "/agents", """
      {"name":"Main Agent"}
      """).get("id").asText();

    String daemonId = postJson("/api/v1/client-daemons/register", """
      {"workspaceId":"%s","deviceName":"devbox","capabilities":["model.invoke","tool.invoke"]}
      """.formatted(workspaceId)).get("id").asText();

    JsonNode run = postJson("/api/v1/agents/" + agentId + "/runs", """
      {"goal":"Inspect workspace and report status"}
      """);
    assertThat(run.get("status").asText()).isEqualTo("waiting_for_client");

    JsonNode requests = getJson("/api/v1/client-daemons/" + daemonId + "/execution-requests");
    assertThat(requests).hasSize(1);
    String executionId = requests.get(0).get("executionId").asText();
    assertThat(requests.get(0).get("toolName").asText()).isEqualTo("mock_provider");

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {"executionId":"%s","status":"completed","summary":"Mock provider completed the run.","data":{"message":"ok"}}
      """.formatted(executionId));

    JsonNode completed = getJson("/api/v1/agents/" + agentId + "/runs/" + run.get("id").asText());
    assertThat(completed.get("status").asText()).isEqualTo("completed");
    assertThat(completed.get("summary").asText()).contains("Mock provider completed");
  }

  private JsonNode postJson(String path, String body) throws Exception {
    String response = mvc.perform(post(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body))
      .andExpect(status().is2xxSuccessful())
      .andReturn()
      .getResponse()
      .getContentAsString();
    return mapper.readTree(response);
  }

  private JsonNode getJson(String path) throws Exception {
    String response = mvc.perform(get(path))
      .andExpect(status().is2xxSuccessful())
      .andReturn()
      .getResponse()
      .getContentAsString();
    return mapper.readTree(response);
  }
}
