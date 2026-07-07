package com.brainx.server.core;

import java.time.Instant;
import java.util.List;

public record SkillProposalRecord(
    String id,
    String workspaceId,
    String name,
    String scope,
    String markdownContent,
    List<String> evidence,
    double confidence,
    String status,
    int version,
    Instant createdAt
) {}
