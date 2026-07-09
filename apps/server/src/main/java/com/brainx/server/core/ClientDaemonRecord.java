package com.brainx.server.core;

import java.time.Instant;
import java.util.List;

public record ClientDaemonRecord(
    String id,
    String workspaceId,
    String userId,
    String installationId,
    String clientToken,
    String deviceName,
    String operatingSystem,
    String status,
    List<String> capabilities,
    Instant boundAt,
    Instant lastHeartbeatAt
) {
  public ClientDaemonRecord withStatus(String status, Instant now) {
    return new ClientDaemonRecord(id, workspaceId, userId, installationId, clientToken, deviceName, operatingSystem, status, capabilities, boundAt, now);
  }

  public ClientDaemonRecord boundTo(String nextUserId, Instant now) {
    return new ClientDaemonRecord(id, workspaceId, nextUserId, installationId, clientToken, deviceName, operatingSystem, "active", capabilities, now, now);
  }

  public ClientDaemonRecord heartbeat(Instant now) {
    return new ClientDaemonRecord(id, workspaceId, userId, installationId, clientToken, deviceName, operatingSystem, status, capabilities, boundAt, now);
  }

  public ClientDaemonRecord registered(String nextWorkspaceId, String nextDeviceName, String nextOperatingSystem, List<String> nextCapabilities, Instant now) {
    var resolvedOperatingSystem = nextOperatingSystem == null || nextOperatingSystem.isBlank()
        ? operatingSystem
        : nextOperatingSystem;
    return new ClientDaemonRecord(
        id,
        nextWorkspaceId,
        "revoked".equals(status) ? null : userId,
        installationId,
        clientToken,
        nextDeviceName,
        resolvedOperatingSystem,
        "active",
        List.copyOf(nextCapabilities),
        "revoked".equals(status) ? null : boundAt,
        now
    );
  }
}
