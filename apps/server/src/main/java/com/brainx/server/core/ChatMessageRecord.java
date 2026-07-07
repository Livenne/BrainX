package com.brainx.server.core;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record ChatMessageRecord(
    String id,
    String role,
    String author,
    String content,
    List<Map<String, Object>> blocks,
    Instant createdAt
) {}
