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
class BranchAndSkillTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;

  @Test
  void branchCapsuleIsCandidateContextNotAutomaticMerge() throws Exception {
    String workspaceId = postJson("/api/v1/workspaces", "{\"name\":\"Branch Workspace\"}").get("id").asText();
    String agentId = postJson("/api/v1/workspaces/" + workspaceId + "/agents", "{\"name\":\"Main Agent\"}").get("id").asText();

    JsonNode branch = postJson("/api/v1/agents/" + agentId + "/branches", """
      {"name":"experiment-auth","description":"Explore auth alternatives"}
      """);

    JsonNode capsule = getJson("/api/v1/branches/" + branch.get("id").asText() + "/capsule");
    assertThat(capsule.get("branchName").asText()).isEqualTo("experiment-auth");
    assertThat(capsule.get("mergeRecommendation").get("context").asText()).isEqualTo("review");
    assertThat(capsule.get("summary").asText()).contains("candidate");
  }

  @Test
  void skillProposalStartsInReviewQueue() throws Exception {
    String workspaceId = postJson("/api/v1/workspaces", "{\"name\":\"Skill Workspace\"}").get("id").asText();

    JsonNode proposal = postJson("/api/v1/skill-proposals", """
      {
        "workspaceId":"%s",
        "name":"debug-node-esm-import-error",
        "scope":"project",
        "markdownContent":"---\\nname: debug-node-esm-import-error\\n---\\n# Skill\\n",
        "evidence":["Resolved repeated ESM import issue"],
        "confidence":0.72
      }
      """.formatted(workspaceId));

    assertThat(proposal.get("status").asText()).isEqualTo("review_requested");
    assertThat(proposal.get("version").asInt()).isEqualTo(1);
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
