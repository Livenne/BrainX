package com.brainx.server.api;

import com.brainx.server.core.NotFoundException;
import com.brainx.server.core.StateConflictException;
import com.brainx.server.core.UnauthorizedException;
import com.brainx.server.core.ForbiddenException;
import com.brainx.server.core.BadRequestException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
  @ExceptionHandler(NotFoundException.class)
  ResponseEntity<Map<String, Object>> notFound(NotFoundException exception) {
    return error(HttpStatus.NOT_FOUND, "resource.not_found", exception.getMessage());
  }

  @ExceptionHandler(StateConflictException.class)
  ResponseEntity<Map<String, Object>> conflict(StateConflictException exception) {
    return error(HttpStatus.CONFLICT, "state.conflict", exception.getMessage());
  }

  @ExceptionHandler(UnauthorizedException.class)
  ResponseEntity<Map<String, Object>> unauthorized(UnauthorizedException exception) {
    return error(HttpStatus.UNAUTHORIZED, "auth.unauthorized", exception.getMessage());
  }

  @ExceptionHandler(ForbiddenException.class)
  ResponseEntity<Map<String, Object>> forbidden(ForbiddenException exception) {
    return error(HttpStatus.FORBIDDEN, "auth.forbidden", exception.getMessage());
  }

  @ExceptionHandler(BadRequestException.class)
  ResponseEntity<Map<String, Object>> badRequest(BadRequestException exception) {
    return error(HttpStatus.BAD_REQUEST, "request.invalid", exception.getMessage());
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<Map<String, Object>> validation(MethodArgumentNotValidException exception) {
    return error(HttpStatus.BAD_REQUEST, "request.invalid", "Request validation failed.");
  }

  private ResponseEntity<Map<String, Object>> error(HttpStatus status, String code, String message) {
    return ResponseEntity.status(status).body(Map.of(
        "error", Map.of(
            "code", code,
            "message", message
        )
    ));
  }
}
