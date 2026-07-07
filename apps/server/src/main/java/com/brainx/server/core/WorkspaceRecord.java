package com.brainx.server.core;

import java.time.Instant;

public record WorkspaceRecord(
    String id,
    String name,
    String path,
    boolean defaultWorkspace,
    String status,
    Instant createdAt
) {}
