package com.brainx.server;

import com.brainx.server.api.BscTraceFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class BscTraceFilterTest {
  @TempDir Path tempDir;

  @Test
  void logsBrowserExchangeWithBodiesAndDirections() throws Exception {
    var tracePath = tempDir.resolve("brainx-bsc-trace.ndjson");
    var filter = new BscTraceFilter(true, tracePath.toString(), 20_000);
    var request = jsonRequest(
        "POST",
        "/api/v1/workspaces/w_core/chat/messages",
        """
        {"content":"查看当前目录"}
        """
    );
    var response = new MockHttpServletResponse();
    FilterChain chain = (servletRequest, servletResponse) -> {
      servletResponse.setContentType("application/json");
      servletResponse.getWriter().write("{\"runStatus\":\"waiting_for_client\"}");
    };

    filter.doFilter(request, response, chain);

    var line = Files.readString(tracePath);
    assertThat(line).contains("\"event\":\"bsc.http.exchange\"");
    assertThat(line).contains("\"direction\":\"B->S\"");
    assertThat(line).contains("\"direction\":\"S->B\"");
    assertThat(line).contains("查看当前目录");
    assertThat(line).contains("waiting_for_client");
    assertThat(line).contains("\"traceId\"");
    assertThat(line).contains("\"startedAt\"");
    assertThat(line).contains("\"completedAt\"");
  }

  @Test
  void logsClientDaemonExchangeAndRedactsSecrets() throws Exception {
    var tracePath = tempDir.resolve("brainx-bsc-trace.ndjson");
    var filter = new BscTraceFilter(true, tracePath.toString(), 20_000);
    var request = jsonRequest(
        "POST",
        "/api/v1/client-daemons/cd_1/execution-results",
        """
        {"executionId":"exec_1","status":"failed","data":{"error":"bad"},"password":"secret-password"}
        """
    );
    request.addHeader("Authorization", "Bearer secret-token");
    var response = new MockHttpServletResponse();
    FilterChain chain = (servletRequest, servletResponse) -> {
      servletResponse.setContentType("application/json");
      servletResponse.getWriter().write("{\"accepted\":true,\"userId\":null,\"token\":\"secret-token\"}");
    };

    filter.doFilter(request, response, chain);

    var line = Files.readString(tracePath);
    assertThat(line).contains("\"direction\":\"C->S\"");
    assertThat(line).contains("\"direction\":\"S->C\"");
    assertThat(line).contains("exec_1");
    assertThat(line).contains("bad");
    assertThat(line).contains("\"userId\":null");
    assertThat(line).doesNotContain("secret-password");
    assertThat(line).doesNotContain("secret-token");
    assertThat(line).contains("<redacted>");
  }

  @Test
  void logsJsonResponsesAsUtf8WhenCharsetIsNotExplicit() throws Exception {
    var tracePath = tempDir.resolve("brainx-bsc-trace.ndjson");
    var filter = new BscTraceFilter(true, tracePath.toString(), 20_000);
    var request = jsonRequest(
        "GET",
        "/api/v1/workspaces/w_core/chat/session",
        ""
    );
    var response = new MockHttpServletResponse();
    FilterChain chain = (servletRequest, servletResponse) -> {
      servletResponse.setContentType("application/json");
      servletResponse.getOutputStream().write("{\"message\":\"你好\"}".getBytes(StandardCharsets.UTF_8));
    };

    filter.doFilter(request, response, chain);

    var line = Files.readString(tracePath);
    assertThat(line).contains("你好");
    assertThat(line).doesNotContain("ä½");
  }

  private MockHttpServletRequest jsonRequest(String method, String path, String body) throws IOException, ServletException {
    var request = new MockHttpServletRequest(method, path);
    request.setContentType("application/json");
    request.addHeader("Accept", "application/json");
    request.setContent(body.getBytes(StandardCharsets.UTF_8));
    return request;
  }
}
