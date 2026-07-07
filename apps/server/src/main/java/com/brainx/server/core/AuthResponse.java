package com.brainx.server.core;

public record AuthResponse(String token, UserView user) {}
