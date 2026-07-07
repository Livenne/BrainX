package com.brainx.server.core;

import java.util.List;
import java.util.Map;

public record ApprovalPolicyRecord(
    String workspaceId,
    String mode,
    List<Map<String, Object>> levels
) {}
