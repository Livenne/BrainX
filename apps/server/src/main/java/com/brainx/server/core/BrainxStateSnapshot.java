package com.brainx.server.core;

import java.util.List;
import java.util.Map;
import java.util.Set;

public record BrainxStateSnapshot(
    Map<String, WorkspaceRecord> workspaces,
    Map<String, AgentRecord> agents,
    Map<String, BranchRecord> branches,
    Map<String, RunRecord> runs,
    Map<String, ClientDaemonRecord> daemons,
    Map<String, List<String>> workspaceIdsByDaemon,
    Map<String, UserRecord> users,
    Map<String, String> userIdsByUsername,
    Map<String, AuthSessionRecord> authSessions,
    Map<String, ClientBindCodeRecord> bindCodes,
    Map<String, ApprovalPolicyRecord> approvalPolicies,
    Map<String, String> activeModelNamesByWorkspace,
    Map<String, List<Map<String, Object>>> availableModelsByWorkspace,
    Map<String, Map<String, Object>> lastTokenUsageByWorkspace,
    Map<String, Map<String, Integer>> tokenUsageTotalsByWorkspaceAndModel,
    Map<String, Map<String, Object>> modelCatalogByDaemon,
    Map<String, ExecutionRequestRecord> executionRequests,
    Map<String, SkillProposalRecord> skillProposals,
    Map<String, Map<String, Object>> skillInventoryByDaemon,
    Map<String, String> skillProposalExecutionIds,
    Map<String, Map<String, Object>> subagentTasks,
    Map<String, ChatSessionRecord> chatSessions,
    Map<String, String> chatSessionIdsByRun,
    Map<String, List<RunStepRecord>> runSteps,
    Map<String, List<ExecutionEventRecord>> executionEvents,
    Set<String> streamEventKeys
) {}
