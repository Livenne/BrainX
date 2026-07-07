package com.brainx.server.core;

import java.time.Instant;

public record RunStepRecord(
    String id,
    String runId,
    int sequence,
    String type,
    String status,
    String executionId,
    Instant createdAt
) {}
