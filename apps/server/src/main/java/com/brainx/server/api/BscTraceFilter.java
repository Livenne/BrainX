package com.brainx.server.api;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class BscTraceFilter extends OncePerRequestFilter {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Set<String> CLIENT_ENDPOINT_SUFFIXES = Set.of(
      "/client-daemons/register",
      "/execution-requests",
      "/execution-results",
      "/workspaces"
  );

  private final boolean enabled;
  private final Path tracePath;
  private final int maxBodyChars;

  public BscTraceFilter(
      @Value("${brainx.trace.enabled:false}") boolean enabled,
      @Value("${brainx.trace.path:logs/brainx-bsc-trace.ndjson}") String tracePath,
      @Value("${brainx.trace.max-body-chars:200000}") int maxBodyChars
  ) {
    this.enabled = enabled;
    this.tracePath = Path.of(tracePath);
    this.maxBodyChars = Math.max(1_000, maxBodyChars);
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !enabled || !request.getRequestURI().startsWith("/api/");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request,
      HttpServletResponse response,
      FilterChain filterChain
  ) throws ServletException, IOException {
    var traceId = UUID.randomUUID().toString();
    var startedAt = Instant.now();
    var startedNanos = System.nanoTime();
    var wrappedRequest = new CachedBodyRequest(request);
    var wrappedResponse = new ContentCachingResponseWrapper(response);
    wrappedResponse.setHeader("X-Brainx-Trace-Id", traceId);

    try {
      filterChain.doFilter(wrappedRequest, wrappedResponse);
    } finally {
      writeExchange(traceId, startedAt, startedNanos, wrappedRequest, wrappedResponse);
      wrappedResponse.copyBodyToResponse();
    }
  }

  private void writeExchange(
      String traceId,
      Instant startedAt,
      long startedNanos,
      CachedBodyRequest request,
      ContentCachingResponseWrapper response
  ) throws IOException {
    var completedAt = Instant.now();
    var entry = new LinkedHashMap<String, Object>();
    entry.put("event", "bsc.http.exchange");
    entry.put("traceId", traceId);
    entry.put("startedAt", startedAt.toString());
    entry.put("completedAt", completedAt.toString());
    entry.put("durationMs", Math.max(0, (System.nanoTime() - startedNanos) / 1_000_000));
    entry.put("request", requestRecord(request));
    entry.put("response", responseRecord(request, response));

    var parent = tracePath.toAbsolutePath().getParent();
    if (parent != null) {
      Files.createDirectories(parent);
    }
    var line = JSON.writeValueAsString(entry) + System.lineSeparator();
    synchronized (BscTraceFilter.class) {
      Files.writeString(
          tracePath,
          line,
          StandardOpenOption.CREATE,
          StandardOpenOption.APPEND,
          StandardOpenOption.WRITE
      );
    }
  }

  private Map<String, Object> requestRecord(CachedBodyRequest request) {
    var record = new LinkedHashMap<String, Object>();
    record.put("direction", requestDirection(request.getRequestURI()));
    record.put("method", request.getMethod());
    record.put("path", request.getRequestURI());
    record.put("query", request.getQueryString() == null ? "" : request.getQueryString());
    record.put("remoteAddr", request.getRemoteAddr());
    record.put("headers", sanitizeHeaders(headerMap(request)));
    record.put("body", bodyValue(request.body(), bodyCharset(request.getCharacterEncoding(), request.getContentType())));
    return Map.copyOf(record);
  }

  private Map<String, Object> responseRecord(
      CachedBodyRequest request,
      ContentCachingResponseWrapper response
  ) {
    var record = new LinkedHashMap<String, Object>();
    record.put("direction", responseDirection(request.getRequestURI()));
    record.put("status", response.getStatus());
    record.put("headers", sanitizeHeaders(responseHeaders(response)));
    record.put("body", bodyValue(response.getContentAsByteArray(), bodyCharset(response.getCharacterEncoding(), response.getContentType())));
    return Map.copyOf(record);
  }

  private Map<String, Object> headerMap(HttpServletRequest request) {
    var headers = new LinkedHashMap<String, Object>();
    Enumeration<String> names = request.getHeaderNames();
    while (names.hasMoreElements()) {
      var name = names.nextElement();
      var values = new ArrayList<String>();
      Enumeration<String> headerValues = request.getHeaders(name);
      while (headerValues.hasMoreElements()) {
        values.add(headerValues.nextElement());
      }
      headers.put(name, values.size() == 1 ? values.get(0) : values);
    }
    return Map.copyOf(headers);
  }

  private Map<String, Object> responseHeaders(HttpServletResponse response) {
    var headers = new LinkedHashMap<String, Object>();
    for (var name : response.getHeaderNames()) {
      var values = new ArrayList<>(response.getHeaders(name));
      headers.put(name, values.size() == 1 ? values.get(0) : values);
    }
    return Map.copyOf(headers);
  }

  private Map<String, Object> sanitizeHeaders(Map<String, Object> headers) {
    var sanitized = new LinkedHashMap<String, Object>();
    for (var entry : headers.entrySet()) {
      sanitized.put(entry.getKey(), isSensitiveKey(entry.getKey()) ? "<redacted>" : entry.getValue());
    }
    return Map.copyOf(sanitized);
  }

  private Object bodyValue(byte[] bytes, Charset charset) {
    if (bytes.length == 0) {
      return "";
    }
    var text = new String(bytes, charset);
    var truncated = text.length() > maxBodyChars;
    var visible = truncated ? text.substring(0, maxBodyChars) : text;
    Object value = parseJson(visible);
    value = redactJson(value);
    if (!truncated) {
      return value;
    }
    return Map.of(
        "truncated", true,
        "maxBodyChars", maxBodyChars,
        "value", value
    );
  }

  private Object parseJson(String text) {
    var trimmed = text.trim();
    if (trimmed.isEmpty()) {
      return "";
    }
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return text;
    }
    try {
      return JSON.readValue(trimmed, new TypeReference<Object>() {});
    } catch (JsonProcessingException ignored) {
      return text;
    }
  }

  private Object redactJson(Object value) {
    if (value instanceof Map<?, ?> map) {
      var redacted = new LinkedHashMap<String, Object>();
      for (var entry : map.entrySet()) {
        if (entry.getKey() == null) {
          continue;
        }
        var key = entry.getKey().toString();
        redacted.put(key, isSensitiveKey(key) ? "<redacted>" : redactJson(entry.getValue()));
      }
      return redacted;
    }
    if (value instanceof List<?> list) {
      return list.stream().map(this::redactJson).toList();
    }
    return value;
  }

  private boolean isSensitiveKey(String key) {
    var normalized = key.toLowerCase().replaceAll("[^a-z0-9]", "");
    return normalized.equals("authorization")
        || normalized.equals("password")
        || normalized.equals("token")
        || normalized.endsWith("token")
        || normalized.contains("apikey")
        || normalized.contains("secret");
  }

  private String requestDirection(String path) {
    return isClientEndpoint(path) ? "C->S" : "B->S";
  }

  private String responseDirection(String path) {
    return isClientEndpoint(path) ? "S->C" : "S->B";
  }

  private boolean isClientEndpoint(String path) {
    if (!path.startsWith("/api/v1/client-daemons")) {
      return false;
    }
    if (path.endsWith("/client-daemons/register")) {
      return true;
    }
    return CLIENT_ENDPOINT_SUFFIXES.stream()
        .filter(suffix -> !"/client-daemons/register".equals(suffix))
        .anyMatch(path::endsWith);
  }

  private Charset charset(String encoding) {
    if (encoding == null || encoding.isBlank()) {
      return StandardCharsets.UTF_8;
    }
    try {
      return Charset.forName(encoding);
    } catch (Exception ignored) {
      return StandardCharsets.UTF_8;
    }
  }

  private Charset bodyCharset(String encoding, String contentType) {
    if (isJsonWithoutExplicitCharset(contentType)) {
      return StandardCharsets.UTF_8;
    }
    return charset(encoding);
  }

  private boolean isJsonWithoutExplicitCharset(String contentType) {
    if (contentType == null || contentType.isBlank()) {
      return false;
    }
    var normalized = contentType.toLowerCase(Locale.ROOT);
    return !normalized.contains("charset=")
        && (normalized.contains("application/json") || normalized.contains("+json"));
  }

  private static final class CachedBodyRequest extends HttpServletRequestWrapper {
    private final byte[] body;

    private CachedBodyRequest(HttpServletRequest request) throws IOException {
      super(request);
      this.body = request.getInputStream().readAllBytes();
    }

    private byte[] body() {
      return body;
    }

    @Override
    public ServletInputStream getInputStream() {
      var input = new ByteArrayInputStream(body);
      return new ServletInputStream() {
        @Override
        public boolean isFinished() {
          return input.available() == 0;
        }

        @Override
        public boolean isReady() {
          return true;
        }

        @Override
        public void setReadListener(ReadListener readListener) {
          throw new UnsupportedOperationException("Async request body reads are not supported by BSC trace wrapper.");
        }

        @Override
        public int read() {
          return input.read();
        }
      };
    }

    @Override
    public BufferedReader getReader() {
      return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
    }
  }
}
