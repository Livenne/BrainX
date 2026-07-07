package com.brainx.server.core;

import java.time.Instant;

public record BranchRecord(
    String id,
    String workspaceId,
    String agentId,
    String name,
    String description,
    String status,
    Instant createdAt
) {}
