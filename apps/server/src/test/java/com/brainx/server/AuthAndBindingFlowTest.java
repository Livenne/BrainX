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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class AuthAndBindingFlowTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;

  @Test
  void userRegistersLogsInAndBindsClientDaemonWithSingleUseCode() throws Exception {
    JsonNode registered = postJson("/api/v1/auth/register", """
      {"username":"user_a","password":"correct horse battery"}
      """);
    assertThat(registered.get("user").get("username").asText()).isEqualTo("user_a");
    String browserToken = registered.get("token").asText();

    String clientToken = postJson("/api/v1/auth/login", """
      {"username":"user_a","password":"correct horse battery"}
      """).get("token").asText();

    JsonNode codeResponse = postJson(
        "/api/v1/client-daemons/bind-codes",
        """
        {"workspaceId":"w_core","deviceName":"devbox","password":"correct horse battery","capabilities":["model.invoke","tool.invoke","get_environment","read_files","search_workspace","apply_patch","write_file","run_command","background_start","background_read","background_stop"]}
        """,
        clientToken
    );
    assertThat(codeResponse.get("code").asText()).startsWith("BX-");
    assertThat(codeResponse.get("expiresAt").asText()).isNotBlank();

    JsonNode bound = postJson(
        "/api/v1/client-daemons/complete-bind",
        """
        {"code":"%s"}
        """.formatted(codeResponse.get("code").asText()),
        browserToken
    );
    String daemonId = bound.get("id").asText();
    assertThat(bound.get("deviceName").asText()).isEqualTo("devbox");
    assertThat(bound.get("status").asText()).isEqualTo("active");

    JsonNode devices = getJson("/api/v1/client-daemons", browserToken);
    assertThat(devices).hasSize(1);
    assertThat(devices.get(0).get("id").asText()).isEqualTo(daemonId);

    postJson("/api/v1/workspaces/w_core/chat/messages", "{" + quote("content") + ":" + quote("查看当前目录") + "}", browserToken);
    JsonNode requests = getJson("/api/v1/client-daemons/" + daemonId + "/execution-requests", clientToken);
    assertThat(requests).hasSize(1);

    postJson(
        "/api/v1/client-daemons/complete-bind",
        """
        {"code":"%s"}
        """.formatted(codeResponse.get("code").asText()),
        browserToken,
        status().isConflict()
    );
  }

  @Test
  void bindCodeCanOnlyBeCompletedBySameUserAndRequiresRecentPassword() throws Exception {
    String userAToken = register("user_a", "pw-a-12345");
    String userBToken = register("user_b", "pw-b-12345");

    postJson(
        "/api/v1/client-daemons/bind-codes",
        """
        {"workspaceId":"w_core","deviceName":"devbox","password":"wrong","capabilities":["model.invoke"]}
        """,
        userAToken,
        status().isUnauthorized()
    );

    String code = postJson(
        "/api/v1/client-daemons/bind-codes",
        """
        {"workspaceId":"w_core","deviceName":"devbox","password":"pw-a-12345","capabilities":["model.invoke"]}
        """,
        userAToken
    ).get("code").asText();

    postJson(
        "/api/v1/client-daemons/complete-bind",
        """
        {"code":"%s"}
        """.formatted(code),
        userBToken,
        status().isForbidden()
    );
  }

  @Test
  void unboundClientCannotPollAndUnbindRevokesDevice() throws Exception {
    String browserToken = register("user_a", "pw-a-12345");
    String clientToken = login("user_a", "pw-a-12345");
    String daemonId = bindDevice(browserToken, clientToken, "devbox", "pw-a-12345");

    postJson("/api/v1/client-daemons/" + daemonId + "/unbind", "{" + quote("confirm") + ":false}", clientToken, status().isBadRequest());
    postJson("/api/v1/client-daemons/" + daemonId + "/unbind", "{" + quote("confirm") + ":true}", clientToken);

    getJson("/api/v1/client-daemons/" + daemonId + "/execution-requests", clientToken, status().isForbidden());
    JsonNode devices = getJson("/api/v1/client-daemons", browserToken);
    assertThat(devices.get(0).get("status").asText()).isEqualTo("revoked");
  }

  @Test
  void approvalPolicyCanBeUpdatedPerWorkspace() throws Exception {
    String token = register("user_a", "pw-a-12345");
    JsonNode policy = patchJson("/api/v1/workspaces/w_core/approval-policy", """
      {"mode":"full_accept"}
      """, token);

    assertThat(policy.get("mode").asText()).isEqualTo("full_accept");
    assertThat(policy.get("levels").toString()).contains("safe");
    assertThat(policy.get("levels").toString()).contains("risky");
    assertThat(policy.toString()).doesNotContain("level3");
  }

  @Test
  void workspacesCanBeListedForAuthenticatedUser() throws Exception {
    String token = register("user_a", "pw-a-12345");

    JsonNode workspaces = getJson("/api/v1/workspaces", token);

    assertThat(workspaces).hasSize(1);
    assertThat(workspaces.get(0).get("id").asText()).isEqualTo("w_core");
    assertThat(workspaces.get(0).get("name").asText()).isEqualTo("Brainx Local");
  }

  @Test
  void boundClientCanSyncWorkspaceListOwnedByLocalConfig() throws Exception {
    String browserToken = register("user_a", "pw-a-12345");
    String clientToken = login("user_a", "pw-a-12345");
    String daemonId = bindDevice(browserToken, clientToken, "devbox", "pw-a-12345");

    putJson(
        "/api/v1/client-daemons/" + daemonId + "/workspaces",
        """
        {"workspaces":[
          {"id":"w_core","name":"Brainx Local","path":"/home/user/.brainx/workspace","default":true},
          {"id":"w_project","name":"Project Brainx","path":"/home/user/code/brainx","default":false}
        ]}
        """,
        clientToken
    );

    JsonNode synced = getJson("/api/v1/workspaces", browserToken);
    assertThat(synced).hasSize(2);
    assertThat(synced.get(0).get("id").asText()).isEqualTo("w_core");
    assertThat(synced.get(0).get("path").asText()).isEqualTo("/home/user/.brainx/workspace");
    assertThat(synced.get(0).get("defaultWorkspace").asBoolean()).isTrue();
    assertThat(synced.get(1).get("id").asText()).isEqualTo("w_project");
    assertThat(synced.get(1).get("path").asText()).isEqualTo("/home/user/code/brainx");

    putJson(
        "/api/v1/client-daemons/" + daemonId + "/workspaces",
        """
        {"workspaces":[
          {"id":"w_core","name":"Brainx Local","path":"/home/user/.brainx/workspace","default":true}
        ]}
        """,
        clientToken
    );

    JsonNode afterRemove = getJson("/api/v1/workspaces", browserToken);
    assertThat(afterRemove).hasSize(1);
    assertThat(afterRemove.get(0).get("id").asText()).isEqualTo("w_core");
  }

  @Test
  void logoutRevokesSessionToken() throws Exception {
    String token = register("user_a", "pw-a-12345");

    postJson("/api/v1/auth/logout", "{}", token);

    getJson("/api/v1/auth/me", token, status().isUnauthorized());
  }

  private String register(String username, String password) throws Exception {
    return postJson("/api/v1/auth/register", """
      {"username":"%s","password":"%s"}
      """.formatted(username, password)).get("token").asText();
  }

  private String login(String username, String password) throws Exception {
    return postJson("/api/v1/auth/login", """
      {"username":"%s","password":"%s"}
      """.formatted(username, password)).get("token").asText();
  }

  private String bindDevice(String browserToken, String clientToken, String deviceName, String password) throws Exception {
    String code = postJson(
        "/api/v1/client-daemons/bind-codes",
        """
        {"workspaceId":"w_core","deviceName":"%s","password":"%s","capabilities":["model.invoke","tool.invoke","get_environment","read_files","search_workspace","apply_patch","write_file","run_command","background_start","background_read","background_stop"]}
        """.formatted(deviceName, password),
        clientToken
    ).get("code").asText();
    return postJson(
        "/api/v1/client-daemons/complete-bind",
        """
        {"code":"%s"}
        """.formatted(code),
        browserToken
    ).get("id").asText();
  }

  private JsonNode postJson(String path, String body) throws Exception {
    return postJson(path, body, null, status().is2xxSuccessful());
  }

  private JsonNode postJson(String path, String body, String token) throws Exception {
    return postJson(path, body, token, status().is2xxSuccessful());
  }

  private JsonNode postJson(String path, String body, String token, org.springframework.test.web.servlet.ResultMatcher expectedStatus) throws Exception {
    var request = post(path).contentType(MediaType.APPLICATION_JSON).content(body);
    if (token != null) {
      request.header("Authorization", "Bearer " + token);
    }
    String response = mvc.perform(request)
      .andExpect(expectedStatus)
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
    return mapper.readTree(response);
  }

  private JsonNode putJson(String path, String body, String token) throws Exception {
    var request = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(path)
      .contentType(MediaType.APPLICATION_JSON)
      .content(body)
      .header("Authorization", "Bearer " + token);
    String response = mvc.perform(request)
      .andExpect(status().is2xxSuccessful())
      .andReturn()
      .getResponse()
      .getContentAsString();
    return response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
  }

  private JsonNode getJson(String path, String token) throws Exception {
    return getJson(path, token, status().is2xxSuccessful());
  }

  private JsonNode getJson(String path, String token, org.springframework.test.web.servlet.ResultMatcher expectedStatus) throws Exception {
    var request = get(path);
    if (token != null) {
      request.header("Authorization", "Bearer " + token);
    }
    String response = mvc.perform(request)
      .andExpect(expectedStatus)
      .andReturn()
      .getResponse()
      .getContentAsString();
    return response.isBlank() ? mapper.createObjectNode() : mapper.readTree(response);
  }

  private String quote(String value) throws Exception {
    return mapper.writeValueAsString(value);
  }
}
