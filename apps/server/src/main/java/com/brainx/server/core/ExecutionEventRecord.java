package com.brainx.server.core;

import java.time.Instant;
import java.util.Map;

public record ExecutionEventRecord(
    String id,
    String runId,
    String type,
    int sequence,
    Instant occurredAt,
    String message,
    String riskTier,
    String source,
    String level,
    String executionId,
    Map<String, Object> payload,
    Map<String, Object> error
) {
  public ExecutionEventRecord(
      String id,
      String runId,
      String type,
      int sequence,
      Instant occurredAt,
      String message,
      String riskTier
  ) {
    this(id, runId, type, sequence, occurredAt, message, riskTier, "server", "info", null, Map.of(), null);
  }
}
