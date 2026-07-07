package com.brainx.server.core;

import java.util.List;
import java.util.Map;

public record ExecutionRequestRecord(
    String executionId,
    String workspaceId,
    String agentId,
    String branchId,
    String runId,
    String status,
    String capabilityId,
    String toolName,
    Map<String, Object> input,
    String riskTier,
    String idempotencyKey
) {
  public static ExecutionRequestRecord mockProvider(
      String executionId,
      String workspaceId,
      String agentId,
      String branchId,
      String runId,
      String goal
  ) {
    return new ExecutionRequestRecord(
        executionId,
        workspaceId,
        agentId,
        branchId,
        runId,
        "pending",
        "model.invoke",
        "mock_provider",
        Map.of("goal", goal),
        "read",
        executionId
    );
  }

  public static ExecutionRequestRecord modelInvoke(
      String executionId,
      String workspaceId,
      String agentId,
      String branchId,
      String runId,
      String phase,
      int loopIndex,
      List<Map<String, Object>> messages,
      List<Map<String, Object>> tools
  ) {
    return modelInvoke(executionId, workspaceId, agentId, branchId, runId, phase, loopIndex, messages, tools, "");
  }

  public static ExecutionRequestRecord modelInvoke(
      String executionId,
      String workspaceId,
      String agentId,
      String branchId,
      String runId,
      String phase,
      int loopIndex,
      List<Map<String, Object>> messages,
      List<Map<String, Object>> tools,
      String modelName
  ) {
    var input = new java.util.LinkedHashMap<String, Object>();
    input.put("phase", phase);
    input.put("loopIndex", loopIndex);
    input.put("messages", messages);
    input.put("tools", tools);
    if (modelName != null && !modelName.isBlank()) {
      input.put("modelName", modelName);
    }
    return new ExecutionRequestRecord(
        executionId,
        workspaceId,
        agentId,
        branchId,
        runId,
        "pending",
        "model.invoke",
        "model.invoke",
        Map.copyOf(input),
        "network",
        executionId
    );
  }

  public static ExecutionRequestRecord toolInvoke(
      String executionId,
      String workspaceId,
      String agentId,
      String branchId,
      String runId,
      String toolName,
      Map<String, Object> input
  ) {
    return toolInvoke(executionId, workspaceId, agentId, branchId, runId, toolName, input, "read", "pending");
  }

  public static ExecutionRequestRecord toolInvoke(
      String executionId,
      String workspaceId,
      String agentId,
      String branchId,
      String runId,
      String toolName,
      Map<String, Object> input,
      String riskTier,
      String status
  ) {
    return new ExecutionRequestRecord(
        executionId,
        workspaceId,
        agentId,
        branchId,
        runId,
        status,
        "tool.invoke",
        toolName,
        input,
        riskTier,
        executionId
    );
  }

  public ExecutionRequestRecord completed() {
    return withStatus("completed");
  }

  public ExecutionRequestRecord withStatus(String status) {
    return new ExecutionRequestRecord(
        executionId,
        workspaceId,
        agentId,
        branchId,
        runId,
        status,
        capabilityId,
        toolName,
        input,
        riskTier,
        idempotencyKey
    );
  }
}
