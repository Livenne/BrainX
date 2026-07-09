package com.brainx.server.core;

import java.time.Instant;
import java.util.List;

public record ClientBindCodeRecord(
    String code,
    String userId,
    String daemonId,
    String workspaceId,
    String deviceName,
    List<String> capabilities,
    Instant expiresAt,
    Instant usedAt
) {
  public ClientBindCodeRecord used(Instant now) {
    return new ClientBindCodeRecord(code, userId, daemonId, workspaceId, deviceName, capabilities, expiresAt, now);
  }
}
