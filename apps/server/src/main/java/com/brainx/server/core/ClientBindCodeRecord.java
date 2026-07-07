package com.brainx.server.core;

import java.time.Instant;
import java.util.List;

public record ClientBindCodeRecord(
    String code,
    String userId,
    String workspaceId,
    String deviceName,
    List<String> capabilities,
    Instant expiresAt,
    Instant usedAt
) {
  public ClientBindCodeRecord used(Instant now) {
    return new ClientBindCodeRecord(code, userId, workspaceId, deviceName, capabilities, expiresAt, now);
  }
}
