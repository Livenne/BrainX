package com.brainx.server.core;

import java.util.Map;

public record ExecutionResultRecord(
    String executionId,
    String status,
    String summary,
    Map<String, Object> data
) {}
