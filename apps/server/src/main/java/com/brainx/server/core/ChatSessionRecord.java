package com.brainx.server.core;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record ChatSessionRecord(
    String id,
    String title,
    String workspaceId,
    String workspaceName,
    String agentId,
    String agentName,
    String branchId,
    String branchName,
    String skillName,
    String clientName,
    String runId,
    String runStatus,
    List<Map<String, Object>> todos,
    List<Map<String, Object>> terminals,
    List<Map<String, Object>> subagents,
    Map<String, Map<String, Object>> toolStates,
    Map<String, Object> contextBudget,
    List<Map<String, Object>> availableModels,
    String activeModelName,
    Instant updatedAt,
    List<Map<String, Object>> messages
) {
  public ChatSessionRecord withRun(String nextRunId, String nextRunStatus, Instant nextUpdatedAt) {
    return new ChatSessionRecord(
        id,
        title,
        workspaceId,
        workspaceName,
        agentId,
        agentName,
        branchId,
        branchName,
        skillName,
        clientName,
        nextRunId,
        nextRunStatus,
        todos,
        terminals,
        subagents,
        toolStates,
        contextBudget,
        availableModels,
        activeModelName,
        nextUpdatedAt,
        messages
    );
  }

  public ChatSessionRecord withMessages(List<Map<String, Object>> nextMessages, String nextRunStatus, Instant nextUpdatedAt) {
    return new ChatSessionRecord(
        id,
        title,
        workspaceId,
        workspaceName,
        agentId,
        agentName,
        branchId,
        branchName,
        skillName,
        clientName,
        runId,
        nextRunStatus,
        todos,
        terminals,
        subagents,
        toolStates,
        contextBudget,
        availableModels,
        activeModelName,
        nextUpdatedAt,
        List.copyOf(nextMessages)
    );
  }

  public ChatSessionRecord withToolStates(Map<String, Map<String, Object>> nextToolStates) {
    return new ChatSessionRecord(
        id,
        title,
        workspaceId,
        workspaceName,
        agentId,
        agentName,
        branchId,
        branchName,
        skillName,
        clientName,
        runId,
        runStatus,
        todos,
        terminals,
        subagents,
        Map.copyOf(nextToolStates),
        contextBudget,
        availableModels,
        activeModelName,
        updatedAt,
        messages
    );
  }

  public ChatSessionRecord withResponseState(
      Map<String, Map<String, Object>> nextToolStates,
      Map<String, Object> nextContextBudget,
      List<Map<String, Object>> nextAvailableModels,
      String nextActiveModelName
  ) {
    return new ChatSessionRecord(
        id,
        title,
        workspaceId,
        workspaceName,
        agentId,
        agentName,
        branchId,
        branchName,
        skillName,
        clientName,
        runId,
        runStatus,
        todos,
        terminals,
        subagents,
        Map.copyOf(nextToolStates),
        Map.copyOf(nextContextBudget),
        List.copyOf(nextAvailableModels),
        nextActiveModelName,
        updatedAt,
        messages
    );
  }

  public ChatSessionRecord withState(
      List<Map<String, Object>> nextTodos,
      List<Map<String, Object>> nextTerminals,
      List<Map<String, Object>> nextSubagents,
      String nextRunStatus,
      Instant nextUpdatedAt
  ) {
    return new ChatSessionRecord(
        id,
        title,
        workspaceId,
        workspaceName,
        agentId,
        agentName,
        branchId,
        branchName,
        skillName,
        clientName,
        runId,
        nextRunStatus,
        List.copyOf(nextTodos),
        List.copyOf(nextTerminals),
        List.copyOf(nextSubagents),
        toolStates,
        contextBudget,
        availableModels,
        activeModelName,
        nextUpdatedAt,
        messages
    );
  }
}
