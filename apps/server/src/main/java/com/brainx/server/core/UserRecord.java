package com.brainx.server.core;

import java.time.Instant;

public record UserRecord(
    String id,
    String username,
    String passwordHash,
    String passwordSalt,
    Instant createdAt
) {
  public UserView view() {
    return new UserView(id, username);
  }
}
