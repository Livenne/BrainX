package com.brainx.server.core;

import java.util.List;
import java.util.Map;

public record BranchCapsule(
    String branchId,
    String branchName,
    String goal,
    String status,
    String summary,
    List<String> importantContext,
    List<String> decisions,
    List<String> discoveries,
    List<String> rejectedApproaches,
    List<String> changedArtifacts,
    List<String> todoDelta,
    List<String> skillProposals,
    List<String> validation,
    List<String> risks,
    Map<String, String> mergeRecommendation
) {}
