package com.brainx.server.api;

import com.brainx.server.core.BrainxState;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class BrainxStatePersistenceFilter extends OncePerRequestFilter {
  private final BrainxState state;

  public BrainxStatePersistenceFilter(BrainxState state) {
    this.state = state;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request,
      HttpServletResponse response,
      FilterChain filterChain
  ) throws ServletException, IOException {
    try {
      filterChain.doFilter(request, response);
    } finally {
      if (request.getRequestURI().startsWith("/api/v1")) {
        state.persist();
      }
    }
  }
}
