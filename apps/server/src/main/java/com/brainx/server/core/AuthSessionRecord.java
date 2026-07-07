package com.brainx.server.core;

import java.time.Instant;

public record AuthSessionRecord(String token, String userId, Instant createdAt) {}
