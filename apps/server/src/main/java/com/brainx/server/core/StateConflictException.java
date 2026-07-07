package com.brainx.server.core;

public class StateConflictException extends RuntimeException {
  public StateConflictException(String message) {
    super(message);
  }
}
