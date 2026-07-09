package com.brainx.server.core;

import java.time.Instant;
import java.util.List;

public record SkillProposalRecord(
    String id,
    String workspaceId,
    String runId,
    String daemonId,
    String name,
    String scope,
    String path,
    String markdownContent,
    String reason,
    List<String> evidence,
    double confidence,
    String status,
    int version,
    Instant createdAt,
    Instant reviewedAt
) {
  public SkillProposalRecord withStatus(String nextStatus, Instant reviewedAt) {
    return new SkillProposalRecord(
        id,
        workspaceId,
        runId,
        daemonId,
        name,
        scope,
        path,
        markdownContent,
        reason,
        evidence,
        confidence,
        nextStatus,
        version,
        createdAt,
        reviewedAt
    );
  }
}
