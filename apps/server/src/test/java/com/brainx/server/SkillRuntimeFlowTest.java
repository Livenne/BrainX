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
class SkillRuntimeFlowTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;

  @Test
  void workspaceCommandUpdatesCurrentSessionDirectory() throws Exception {
    JsonNode session = postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"workspace","arguments":{"path":"/tmp/brainx-demo"}}
      """);

    assertThat(session.get("currentWorkspace").asText()).isEqualTo("/tmp/brainx-demo");
    assertThat(session.get("timelineNotices").get(0).get("message").asText()).isEqualTo("已切换工作目录：/tmp/brainx-demo");
  }

  @Test
  void modelCommandReturnsUpdatedActiveModelInSession() throws Exception {
    JsonNode session = postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"model","arguments":{"modelName":"gpt-5.5"}}
      """);

    assertThat(session.get("activeModelName").asText()).isEqualTo("gpt-5.5");
    assertThat(session.get("timelineNotices").get(0).get("message").asText()).isEqualTo("已切换模型：gpt-5.5");
  }

  @Test
  void nextAgentLoopUsesModelSelectedByChatCommand() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"model","arguments":{"modelName":"gpt-5.5"}}
      """);

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看 env"}
      """);

    JsonNode request = onlyPendingRequest(daemonId);
    assertThat(request.get("toolName").asText()).isEqualTo("model.invoke");
    assertThat(request.get("input").get("modelName").asText()).isEqualTo("gpt-5.5");
  }

  @Test
  void commandTimelineNoticesAreNotSentToModelContext() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"model","arguments":{"modelName":"gpt-5.5"}}
      """);
    postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"workspace","arguments":{"path":"/tmp/brainx-demo"}}
      """);

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看 env"}
      """);

    JsonNode request = onlyPendingRequest(daemonId);
    assertThat(request.get("input").get("messages").toString()).doesNotContain("已切换模型").doesNotContain("已切换工作目录");
    assertThat(request.get("input").get("modelName").asText()).isEqualTo("gpt-5.5");
    assertThat(request.get("input").get("currentWorkspace").asText()).isEqualTo("/tmp/brainx-demo");
  }

  @Test
  void clearCommandReturnsOnlyDisplayNoticeAfterClearingContext() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"先写入上下文"}
      """);
    JsonNode request = onlyPendingRequest(daemonId);
    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"done",
        "data":{"messages":[
          {"role":"system","content":"hidden"},
          {"role":"user","content":"先写入上下文"},
          {"role":"assistant","content":"上下文已经存在。","toolCalls":[]}
        ]}
      }
      """.formatted(request.get("executionId").asText()));

    JsonNode session = postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"clear","arguments":{}}
      """);

    assertThat(session.get("messages")).isEmpty();
    assertThat(session.get("timelineNotices")).hasSize(1);
    assertThat(session.get("timelineNotices").get(0).get("message").asText()).isEqualTo("已清空上下文");
  }

  @Test
  void modelReturnedSkillToolResultCreatesPendingProposalAndApprovalDispatchesApplyRequest() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"总结并创建 skill"}
      """);
    JsonNode request = onlyPendingRequest(daemonId);

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"skill proposal",
        "data":{"messages":[
          {"role":"system","content":"hidden"},
          {"role":"user","content":"总结并创建 skill"},
          {"role":"assistant","content":"","toolCalls":[
            {"id":"call_skill","type":"function","function":{"name":"create_skill","arguments":"{\\\"scope\\\":\\\"project\\\",\\\"path\\\":\\\"/tmp/project/.agents/skills/debug/SKILL.md\\\",\\\"content\\\":\\\"---\\\\nname: debug\\\\ndescription: Debug workflow\\\\n---\\\\n# Debug\\\\n\\\",\\\"reason\\\":\\\"Repeated debugging flow\\\",\\\"evidence\\\":[\\\"run evidence\\\"]}"}}
          ]},
          {"role":"tool","toolCallId":"call_skill","name":"create_skill","content":"{\\\"ok\\\":true,\\\"result\\\":{\\\"proposalType\\\":\\\"create_skill\\\",\\\"scope\\\":\\\"project\\\",\\\"path\\\":\\\"/tmp/project/.agents/skills/debug/SKILL.md\\\",\\\"name\\\":\\\"debug\\\",\\\"content\\\":\\\"---\\\\nname: debug\\\\ndescription: Debug workflow\\\\n---\\\\n# Debug\\\\n\\\",\\\"reason\\\":\\\"Repeated debugging flow\\\",\\\"evidence\\\":[\\\"run evidence\\\"]}}"},
          {"role":"assistant","content":"已提交 skill 草案。","toolCalls":[]}
        ]}
      }
      """.formatted(request.get("executionId").asText()));

    JsonNode proposals = getJson("/api/v1/skill-proposals");
    assertThat(proposals).hasSize(1);
    assertThat(proposals.get(0).get("status").asText()).isEqualTo("review_requested");
    assertThat(proposals.get(0).get("path").asText()).endsWith(".agents/skills/debug/SKILL.md");

    JsonNode approved = postJson("/api/v1/skill-proposals/" + proposals.get(0).get("id").asText() + "/approve", "{}");
    JsonNode applyRequest = onlyPendingRequest(daemonId);

    assertThat(approved.get("status").asText()).isEqualTo("approved");
    assertThat(applyRequest.get("toolName").asText()).isEqualTo("skill.apply");
    assertThat(applyRequest.get("input").get("path").asText()).endsWith(".agents/skills/debug/SKILL.md");
    assertThat(applyRequest.get("input").has("proposalId")).isFalse();
    assertThat(applyRequest.get("input").has("daemonId")).isFalse();
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
