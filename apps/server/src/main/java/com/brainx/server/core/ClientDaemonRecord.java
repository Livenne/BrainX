package com.brainx.server.core;

import java.time.Instant;
import java.util.List;

public record ClientDaemonRecord(
    String id,
    String workspaceId,
    String userId,
    String deviceName,
    String status,
    List<String> capabilities,
    Instant boundAt,
    Instant lastHeartbeatAt
) {
  public ClientDaemonRecord withStatus(String status, Instant now) {
    return new ClientDaemonRecord(id, workspaceId, userId, deviceName, status, capabilities, boundAt, now);
  }

  public ClientDaemonRecord heartbeat(Instant now) {
    return new ClientDaemonRecord(id, workspaceId, userId, deviceName, status, capabilities, boundAt, now);
  }
}
