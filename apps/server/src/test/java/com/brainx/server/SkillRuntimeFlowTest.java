package com.brainx.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
    assertThat(session.get("timelineNotices").get(0).get("afterMessageIndex").asInt()).isEqualTo(0);
  }

  @Test
  void modelCommandReturnsUpdatedActiveModelInSession() throws Exception {
    String daemonId = registerLocalDaemon();
    syncModelCatalog(daemonId);

    JsonNode session = postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"model","arguments":{"modelName":"gpt:gpt-5.5"}}
      """);

    assertThat(session.get("activeModelName").asText()).isEqualTo("gpt:gpt-5.5");
    assertThat(session.get("availableModels").toString()).contains("nvidia:stepfun-ai/step-3.7-flash").contains("gpt:gpt-5.5");
    assertThat(session.get("timelineNotices").get(0).get("message").asText()).isEqualTo("已切换模型：gpt:gpt-5.5");
    assertThat(session.get("timelineNotices").get(0).get("afterMessageIndex").asInt()).isEqualTo(0);
  }

  @Test
  void nextAgentLoopUsesModelSelectedByChatCommand() throws Exception {
    String daemonId = registerLocalDaemon();
    syncModelCatalog(daemonId);
    postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"model","arguments":{"modelName":"gpt:gpt-5.5"}}
      """);

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看 env"}
      """);

    JsonNode request = onlyPendingRequest(daemonId);
    assertThat(request.get("toolName").asText()).isEqualTo("model.invoke");
    assertThat(request.get("input").get("modelName").asText()).isEqualTo("gpt:gpt-5.5");
  }

  @Test
  void commandTimelineNoticesAreNotSentToModelContext() throws Exception {
    String daemonId = registerLocalDaemon();
    syncModelCatalog(daemonId);
    postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"model","arguments":{"modelName":"gpt:gpt-5.5"}}
      """);
    postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"workspace","arguments":{"path":"/tmp/brainx-demo"}}
      """);

    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"查看 env"}
      """);

    JsonNode request = onlyPendingRequest(daemonId);
    assertThat(request.get("input").get("messages").toString()).doesNotContain("已切换模型").doesNotContain("已切换工作目录");
    assertThat(request.get("input").get("modelName").asText()).isEqualTo("gpt:gpt-5.5");
    assertThat(request.get("input").get("currentWorkspace").asText()).isEqualTo("/tmp/brainx-demo");
  }

  @Test
  void modelCommandRejectsModelsMissingFromSelectedDaemonCatalog() throws Exception {
    String daemonId = registerLocalDaemon();
    syncModelCatalog(daemonId);

    mvc.perform(post("/api/v1/workspaces/w_core/chat/commands")
        .contentType(MediaType.APPLICATION_JSON)
        .content("""
      {"command":"model","arguments":{"modelName":"other:gpt-5.5"}}
      """))
      .andExpect(status().isBadRequest());
  }

  @Test
  void defaultModelPreferenceUsesStepModelWhenCatalogOrderDiffers() throws Exception {
    String daemonId = registerLocalDaemon();
    putJson("/api/v1/client-daemons/" + daemonId + "/models", """
      {
        "models":[
          {"key":"nvidia:01-ai/yi-large","providerName":"nvidia","model":"01-ai/yi-large","protocol":"openai","contextWindow":128000},
          {"key":"nvidia:stepfun-ai/step-3.7-flash","providerName":"nvidia","model":"stepfun-ai/step-3.7-flash","protocol":"openai","contextWindow":128000},
          {"key":"gpt:gpt-5.5","providerName":"gpt","model":"gpt-5.5","protocol":"openai","contextWindow":128000}
        ],
        "providers":[
          {"name":"nvidia","status":"ok"},
          {"name":"gpt","status":"ok"}
        ]
      }
      """);

    JsonNode session = postJson("/api/v1/workspaces/w_core/chat/sessions", """
      {"clientDaemonId":"%s"}
      """.formatted(daemonId));

    assertThat(session.get("activeModelName").asText()).isEqualTo("nvidia:stepfun-ai/step-3.7-flash");
  }

  @Test
  void contextBudgetUsesActiveModelContextWindowFromDaemonCatalog() throws Exception {
    String daemonId = registerLocalDaemon();
    putJson("/api/v1/client-daemons/" + daemonId + "/models", """
      {
        "models":[
          {"key":"nvidia:stepfun-ai/step-3.7-flash","providerName":"nvidia","model":"stepfun-ai/step-3.7-flash","protocol":"openai","contextWindow":256000},
          {"key":"gpt:gpt-5.5","providerName":"gpt","model":"gpt-5.5","protocol":"openai","contextWindow":1050000}
        ],
        "providers":[
          {"name":"nvidia","status":"ok"},
          {"name":"gpt","status":"ok"}
        ]
      }
      """);

    JsonNode session = postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"model","arguments":{"modelName":"gpt:gpt-5.5"}}
      """);

    JsonNode budget = session.get("contextBudget");
    assertThat(budget.get("maxTokens").asInt()).isEqualTo(1_050_000);
    assertThat(budget.get("thresholdTokens").asInt()).isEqualTo(787_500);
    assertThat(budget.get("contextWindowKnown").asBoolean()).isTrue();
  }

  @Test
  void contextBudgetMarksMissingModelContextWindowAsUnknown() throws Exception {
    String daemonId = registerLocalDaemon();
    putJson("/api/v1/client-daemons/" + daemonId + "/models", """
      {
        "models":[
          {"key":"nvidia:stepfun-ai/step-3.7-flash","providerName":"nvidia","model":"stepfun-ai/step-3.7-flash","protocol":"openai"},
          {"key":"gpt:gpt-5.5","providerName":"gpt","model":"gpt-5.5","protocol":"openai"}
        ],
        "providers":[
          {"name":"nvidia","status":"ok"},
          {"name":"gpt","status":"ok"}
        ]
      }
      """);

    JsonNode session = postJson("/api/v1/workspaces/w_core/chat/commands", """
      {"command":"model","arguments":{"modelName":"gpt:gpt-5.5"}}
      """);

    JsonNode budget = session.get("contextBudget");
    assertThat(budget.get("contextWindowKnown").asBoolean()).isFalse();
    assertThat(budget.get("maxTokens").asInt()).isGreaterThan(0);
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
    assertThat(session.get("timelineNotices").get(0).get("afterMessageIndex").asInt()).isEqualTo(0);
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

  @Test
  void skillProposalsCanBeFilteredByWorkspace() throws Exception {
    JsonNode otherWorkspace = postJson("/api/v1/workspaces", """
      {"name":"Other workspace"}
      """);
    postJson("/api/v1/skill-proposals", """
      {
        "workspaceId":"w_core",
        "name":"core-skill",
        "scope":"project",
        "markdownContent":"# Core Skill\\n",
        "evidence":["core evidence"],
        "confidence":0.7
      }
      """);
    postJson("/api/v1/skill-proposals", """
      {
        "workspaceId":"%s",
        "name":"other-skill",
        "scope":"project",
        "markdownContent":"# Other Skill\\n",
        "evidence":["other evidence"],
        "confidence":0.7
      }
      """.formatted(otherWorkspace.get("id").asText()));

    JsonNode filtered = getJson("/api/v1/skill-proposals?workspaceId=w_core");

    assertThat(filtered).hasSize(1);
    assertThat(filtered.get(0).get("name").asText()).isEqualTo("core-skill");
  }

  @Test
  void skillInventoryGroupsGlobalSkillsByDaemonAndFiltersProjectSkillsByWorkdir() throws Exception {
    String primaryDaemonId = registerLocalDaemon();
    String secondaryDaemonId = postJson("/api/v1/client-daemons/register", """
      {
        "workspaceId":"w_core",
        "deviceName":"secondary-dev",
        "operatingSystem":"Linux test",
        "installationId":"install-secondary",
        "capabilities":["model.invoke","agent.loop"]
      }
      """).get("id").asText();
    putJson("/api/v1/client-daemons/" + primaryDaemonId + "/skills", """
      {
        "projectRoot":"/repo/a",
        "project":[{"id":"project-a","scope":"project","name":"project-a","description":"A","path":"/repo/a/.agents/skills/project-a/SKILL.md"}],
        "global":[{"id":"global-primary","scope":"global","name":"global-primary","description":"Primary","path":"/home/me/.agents/skills/global-primary/SKILL.md"}]
      }
      """);
    putJson("/api/v1/client-daemons/" + primaryDaemonId + "/skills", """
      {
        "projectRoot":"/repo/b",
        "project":[{"id":"project-b","scope":"project","name":"project-b","description":"B","path":"/repo/b/.agents/skills/project-b/SKILL.md"}],
        "global":[{"id":"global-primary","scope":"global","name":"global-primary","description":"Primary","path":"/home/me/.agents/skills/global-primary/SKILL.md"}]
      }
      """);
    putJson("/api/v1/client-daemons/" + secondaryDaemonId + "/skills", """
      {
        "projectRoot":"/repo/a",
        "project":[{"id":"secondary-project","scope":"project","name":"secondary-project","description":"Secondary","path":"/repo/a/.agents/skills/secondary/SKILL.md"}],
        "global":[{"id":"global-secondary","scope":"global","name":"global-secondary","description":"Secondary","path":"/home/me/.agents/skills/global-secondary/SKILL.md"}]
      }
      """);

    JsonNode chatInventory = getJson("/api/v1/workspaces/w_core/skills?clientDaemonId=" + primaryDaemonId + "&currentWorkspace=/repo/a");
    JsonNode overview = getJson("/api/v1/workspaces/w_core/skills");

    assertThat(chatInventory.get("projectRoot").asText()).isEqualTo("/repo/a");
    assertThat(chatInventory.get("project")).hasSize(1);
    assertThat(chatInventory.get("project").get(0).get("name").asText()).isEqualTo("project-a");
    assertThat(chatInventory.get("global")).hasSize(1);
    assertThat(chatInventory.get("global").get(0).get("name").asText()).isEqualTo("global-primary");
    assertThat(overview.get("globalByDaemon")).hasSize(2);
    assertThat(overview.get("globalByDaemon").toString()).contains("global-primary").contains("global-secondary");
  }

  @Test
  void skillInventoryMatchesTildeWorkspaceAgainstAbsoluteClientProjectRoot() throws Exception {
    String daemonId = registerLocalDaemon();
    String homeWorkspace = System.getProperty("user.home").replace('\\', '/') + "/.brainx/workspace";
    putJson("/api/v1/client-daemons/" + daemonId + "/skills", """
      {
        "projectRoot":"%s",
        "project":[{"id":"ui-design-review","scope":"project","name":"ui-design-review","description":"Review UI design","path":"%s/.agents/skills/ui-design-review/SKILL.md"}],
        "global":[]
      }
      """.formatted(homeWorkspace, homeWorkspace));

    JsonNode chatInventory = getJson("/api/v1/workspaces/w_core/skills?clientDaemonId=" + daemonId + "&currentWorkspace=~/.brainx/workspace");

    assertThat(chatInventory.get("projectRoot").asText()).isEqualTo(homeWorkspace);
    assertThat(chatInventory.get("project")).hasSize(1);
    assertThat(chatInventory.get("project").get(0).get("name").asText()).isEqualTo("ui-design-review");
  }

  @Test
  void approvingSkillProposalSupersedesDuplicatePendingProposalForSameWorkspacePath() throws Exception {
    String daemonId = registerLocalDaemon();
    postJson("/api/v1/workspaces/w_core/chat/messages", """
      {"content":"创建重复 skill 草案"}
      """);
    JsonNode request = onlyPendingRequest(daemonId);
    String skillPath = "/tmp/project/.agents/skills/debug/SKILL.md";

    postJson("/api/v1/client-daemons/" + daemonId + "/execution-results", """
      {
        "executionId":"%s",
        "status":"completed",
        "summary":"skill proposals",
        "data":{"messages":[
          {"role":"system","content":"hidden"},
          {"role":"user","content":"创建重复 skill 草案"},
          {"role":"assistant","content":"","toolCalls":[]},
          {"role":"tool","toolCallId":"call_skill_1","name":"create_skill","content":"{\\\"ok\\\":true,\\\"result\\\":{\\\"proposalType\\\":\\\"create_skill\\\",\\\"scope\\\":\\\"project\\\",\\\"path\\\":\\\"%s\\\",\\\"name\\\":\\\"debug\\\",\\\"content\\\":\\\"# Debug\\\\n\\\",\\\"reason\\\":\\\"Repeated flow\\\",\\\"evidence\\\":[\\\"run evidence\\\"]}}"},
          {"role":"tool","toolCallId":"call_skill_2","name":"create_skill","content":"{\\\"ok\\\":true,\\\"result\\\":{\\\"proposalType\\\":\\\"create_skill\\\",\\\"scope\\\":\\\"project\\\",\\\"path\\\":\\\"%s\\\",\\\"name\\\":\\\"debug\\\",\\\"content\\\":\\\"# Debug\\\\n\\\",\\\"reason\\\":\\\"Repeated flow\\\",\\\"evidence\\\":[\\\"run evidence\\\"]}}"}
        ]}
      }
      """.formatted(request.get("executionId").asText(), skillPath, skillPath));

    JsonNode proposals = getJson("/api/v1/skill-proposals?workspaceId=w_core");
    assertThat(proposals).hasSize(2);

    postJson("/api/v1/skill-proposals/" + proposals.get(0).get("id").asText() + "/approve", "{}");
    JsonNode updated = getJson("/api/v1/skill-proposals?workspaceId=w_core");

    assertThat(updated).hasSize(2);
    assertThat(statuses(updated)).containsExactlyInAnyOrder("approved", "superseded");
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

  private void syncModelCatalog(String daemonId) throws Exception {
    putJson("/api/v1/client-daemons/" + daemonId + "/models", """
      {
        "models":[
          {"key":"nvidia:stepfun-ai/step-3.7-flash","providerName":"nvidia","model":"stepfun-ai/step-3.7-flash","protocol":"openai","contextWindow":128000},
          {"key":"gpt:gpt-5.5","providerName":"gpt","model":"gpt-5.5","protocol":"openai","contextWindow":128000}
        ],
        "providers":[
          {"name":"nvidia","status":"ok"},
          {"name":"gpt","status":"ok"}
        ]
      }
      """);
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

  private JsonNode putJson(String path, String body) throws Exception {
    String response = mvc.perform(put(path)
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

  private List<String> statuses(JsonNode proposals) {
    var statuses = new ArrayList<String>();
    proposals.forEach(proposal -> statuses.add(proposal.get("status").asText()));
    return statuses;
  }
}
