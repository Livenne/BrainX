package com.brainx.server.core;

import java.time.Instant;

public record BindCodeResponse(String code, Instant expiresAt) {}
