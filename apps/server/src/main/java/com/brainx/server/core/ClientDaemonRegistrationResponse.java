package com.brainx.server.core;

import java.time.Instant;
import java.util.List;

public record ClientDaemonRegistrationResponse(
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
  public static ClientDaemonRegistrationResponse from(ClientDaemonRecord daemon) {
    return new ClientDaemonRegistrationResponse(
        daemon.id(),
        daemon.workspaceId(),
        daemon.userId(),
        daemon.installationId(),
        daemon.clientToken(),
        daemon.deviceName(),
        daemon.operatingSystem(),
        daemon.status(),
        daemon.capabilities(),
        daemon.boundAt(),
        daemon.lastHeartbeatAt()
    );
  }
}
