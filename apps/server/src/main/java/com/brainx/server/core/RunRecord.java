package com.brainx.server.core;

import java.time.Instant;

public record RunRecord(
    String id,
    String workspaceId,
    String agentId,
    String branchId,
    String goal,
    String status,
    String summary,
    Instant createdAt
) {
  public RunRecord withStatus(String status, String summary) {
    return new RunRecord(id, workspaceId, agentId, branchId, goal, status, summary, createdAt);
  }
}
