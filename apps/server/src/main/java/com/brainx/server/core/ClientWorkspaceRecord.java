package com.brainx.server.core;

public record ClientWorkspaceRecord(
    String id,
    String name,
    String path,
    boolean defaultWorkspace
) {}
