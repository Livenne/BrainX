package com.brainx.server.core;

import java.time.Instant;

public record AgentRecord(
    String id,
    String workspaceId,
    String name,
    String status,
    String defaultBranchId,
    Instant createdAt
) {}
