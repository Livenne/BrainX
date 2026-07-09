package com.brainx.server.core;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class SqliteBrainxStateStore implements BrainxStateStore {
  private static final String SNAPSHOT_ID = "brainx";

  private final ObjectMapper mapper;
  private final String jdbcUrl;

  public SqliteBrainxStateStore(
      ObjectMapper mapper,
      @Value("${brainx.state.sqlite-path:~/.brainx/server/brainx.sqlite}") String sqlitePath
  ) {
    this.mapper = mapper;
    this.jdbcUrl = toJdbcUrl(sqlitePath);
    ensureSchema();
  }

  @Override
  public Optional<BrainxStateSnapshot> load() {
    try (var connection = DriverManager.getConnection(jdbcUrl);
         var statement = connection.prepareStatement("select payload from brainx_state where id = ?")) {
      statement.setString(1, SNAPSHOT_ID);
      try (var result = statement.executeQuery()) {
        if (!result.next()) {
          return Optional.empty();
        }
        return Optional.of(mapper.readValue(result.getString("payload"), BrainxStateSnapshot.class));
      }
    } catch (SQLException | IOException exception) {
      throw new IllegalStateException("Failed to load brainx state snapshot.", exception);
    }
  }

  @Override
  public void save(BrainxStateSnapshot snapshot) {
    try (var connection = DriverManager.getConnection(jdbcUrl);
         var statement = connection.prepareStatement("""
             insert into brainx_state(id, payload, updated_at)
             values (?, ?, ?)
             on conflict(id) do update set payload = excluded.payload, updated_at = excluded.updated_at
             """)) {
      statement.setString(1, SNAPSHOT_ID);
      statement.setString(2, mapper.writeValueAsString(snapshot));
      statement.setString(3, Instant.now().toString());
      statement.executeUpdate();
    } catch (SQLException | JsonProcessingException exception) {
      throw new IllegalStateException("Failed to save brainx state snapshot.", exception);
    }
  }

  private void ensureSchema() {
    try (var connection = DriverManager.getConnection(jdbcUrl);
         var statement = connection.createStatement()) {
      statement.executeUpdate("""
          create table if not exists brainx_state(
            id text primary key,
            payload text not null,
            updated_at text not null
          )
          """);
    } catch (SQLException exception) {
      throw new IllegalStateException("Failed to initialize brainx state store.", exception);
    }
  }

  private static String toJdbcUrl(String sqlitePath) {
    if (sqlitePath.startsWith("jdbc:")) {
      return sqlitePath;
    }
    var normalized = sqlitePath.startsWith("~/")
        ? Path.of(System.getProperty("user.home"), sqlitePath.substring(2))
        : Path.of(sqlitePath);
    var parent = normalized.toAbsolutePath().getParent();
    if (parent != null) {
      try {
        Files.createDirectories(parent);
      } catch (IOException exception) {
        throw new IllegalStateException("Failed to create brainx state directory.", exception);
      }
    }
    return "jdbc:sqlite:" + normalized.toAbsolutePath();
  }
}
