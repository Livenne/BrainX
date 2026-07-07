# brainx S端服务规格

本文定义 brainx 的 S 端（Server）规格。S 端使用 Java Spring Boot + Postgres，作为 B/S/C 架构中的托管控制面，负责长期业务状态、agent loop 编排、策略、审批、事件、审计、REST API 与 WebSocket 契约。

`docs/brainx/product-api-overview.md` 是跨端产品与接口总纲；本文在不改变总纲公共契约的前提下，细化 S 端开发实现边界。公共资源、事件、状态和错误码使用稳定 English identifier，中文只用于说明。

## 1. 架构定位

brainx 三端职责：

- `B`：React/TypeScript 浏览器 UI。只连接 S，负责工作区、agent、运行、审批、skill、分支和日志的交互展示。
- `S`：Java Spring Boot 托管服务。使用 Postgres 保存账号、工作区、agent、上下文、agent loop、skill、分支、审批、审计、事件和策略状态。
- `C`：Rust local daemon。持有用户模型/API key，执行真实模型请求、外部 API 请求和本地工具请求，并把结果回传 S。

S 端是 `control plane`，不是 `execution plane`。S 可以决定是否允许某个动作、何时需要审批、如何推进 `AgentRun`，但不得直接使用用户模型/API key，也不得绕过 C 执行本地工具。

## 2. 设计原则

- `Server as source of truth`：除 C 私有密钥和本地执行细节外，核心业务状态以 S/Postgres 为准。
- `Policy before execution`：写文件、执行命令、外部网络写入、发布、分支采纳、secret 使用等风险动作必须先经过 policy evaluation。
- `Event first`：关键状态变化先持久化为 `ExecutionEvent` 和必要的 `AuditLog`，再通过 WebSocket 广播。
- `Idempotent by contract`：B/C 重试不得造成重复 run、重复审批决议、重复 execution request 或重复 skill 发布。
- `Workspace scoped`：所有业务资源必须归属 `Workspace`；API 和查询层都必须验证 workspace 边界。
- `C owns secrets`：用户模型/API key 只由 C 保存和使用；S 只能保存脱敏能力摘要和执行结果引用。
- `Recoverable realtime`：WebSocket 只提供实时体验；B/C 断线后必须能通过 REST 和事件续传恢复。

## 3. S端职责

### 3.1 核心职责

S 端必须提供以下能力：

- 账号与身份：管理 `Account`、`User`、`Session` 和 `WorkspaceMember`，完成认证、授权、会话撤销。
- 工作区：管理 `Workspace`、成员、策略默认值和资源隔离。
- Agent 管理：管理 `Agent`、`AgentConfig`、状态、默认分支、默认上下文和 skill 指针。
- Agent loop 编排：创建和推进 `AgentRun`、`RunStep`，生成 `ExecutionRequest`，处理 C 回传结果。
- C 端网关：管理 `ClientDaemon` 注册、心跳、能力声明、连接租约、执行请求分配和结果接收。
- 上下文：管理 `ContextSnapshot`、上下文引用、敏感级别和 run 使用记录。
- 分支：管理 `AgentBranch` fork、状态、分支产物、选择性采纳 `BranchAdoption`。
- 自我学习：按提交计数或用户触发创建 `LearningRun`，生成 `SkillDraft`，推进审核与发布为 `SkillVersion`。
- 技能：管理 `Skill`、`SkillVersion`、版本不可变性、作用域和 agent 引用。
- 审批：创建 `ApprovalRequest`，接收 `ApprovalDecision`，处理过期、取消和拒绝后的 run 推进。
- 策略：维护 `PolicyRule`，生成 `PolicyDecision`，输出风险 tier 与执行约束。
- 事件中心：持久化 `ExecutionEvent`，通过 WebSocket 广播给 B/C，并支持断线续传。
- 审计：记录 `AuditLog`，覆盖认证、权限失败、策略变更、审批、执行请求、分支采纳和 skill 发布。
- REST API：向 B/C 提供 `/api/v1` 资源 API、幂等写入、统一错误响应和分页查询。

### 3.2 非目标

S 端明确不做：

- 不保存、代理、打印、回显用户模型/API key 明文。
- 不直接调用 OpenAI、Anthropic、GitHub、本地 shell、文件系统或其他外部工具。
- 不直接连接用户本地环境；所有本地执行必须通过 C。
- 不把 WebSocket 当作唯一状态来源；事件缺口必须能通过 REST 补齐。
- 不自动合并 agent 记忆、上下文或任务历史；分支第一版只做选择性结果采纳。
- 不在第一版实现复杂企业 RBAC、计费、组织层审计和跨工作区私有 skill 治理。
- 不承担大文件对象存储；大内容应保存为 `contentRef`，S 只管理 metadata 和权限。

## 4. 服务模块

| Module | 职责 | 主要资源 |
| --- | --- | --- |
| `IdentityModule` | 登录会话、用户、账号、会话撤销 | `Account`, `User`, `Session` |
| `WorkspaceModule` | 工作区、成员、角色、邀请、资源边界 | `Workspace`, `WorkspaceMember` |
| `AgentModule` | Agent 定义、配置、状态、默认 branch/context/skill 指针 | `Agent`, `AgentConfig` |
| `RunOrchestratorModule` | Agent run 状态机、step 推进、取消、重试、租约 | `AgentRun`, `RunStep` |
| `ClientDaemonGatewayModule` | C 端注册、心跳、能力、WebSocket、执行请求分配 | `ClientDaemon`, `ExecutionRequest` |
| `ContextModule` | 上下文快照、引用、敏感级别、run 使用记录 | `ContextSnapshot`, `ContextReference` |
| `BranchModule` | AgentBranch fork、暂停、归档、选择性采纳 | `AgentBranch`, `BranchAdoption` |
| `SkillModule` | Skill registry、版本、草案、发布、引用关系 | `Skill`, `SkillDraft`, `SkillVersion` |
| `LearningModule` | 12 次确认提交触发学习、证据收集、候选草案生成 | `LearningRun`, `LearningEvidence` |
| `ApprovalModule` | 审批请求、审批决议、过期、通知 | `ApprovalRequest`, `ApprovalDecision` |
| `PolicyModule` | 策略规则、风险 tier、执行约束、策略评估 | `PolicyRule`, `PolicyDecision` |
| `EventModule` | 事件持久化、序号、续传、WebSocket 广播 | `ExecutionEvent` |
| `AuditModule` | 安全审计、不可变日志、导出记录 | `AuditLog` |
| `NotificationModule` | 待审批、失败、离线、草案等站内通知 | `Notification` |
| `ApiModule` | REST controller、鉴权、错误响应、分页、幂等 | `ErrorResponse` |
| `OpsModule` | 健康检查、指标、限流、后台任务 lease | health, metrics |

模块边界要求：

- 跨模块调用使用 resource id 和命令对象，不共享可变 entity。
- 任何状态写入必须经过权限校验、状态机校验、幂等校验和必要审计。
- 后台推进器必须可重入；进程重启后从 Postgres 当前状态恢复。

## 5. Postgres 领域模型

本节描述领域表和约束，不规定 ORM 或迁移工具。所有表默认包含 `id`, `created_at`, `updated_at`。被事件或审计引用的记录不得物理删除；使用 `archived_at`、`deleted_at` 或 tombstone。

### 5.1 Identity 与 Workspace

| Table | 关键字段 | 约束与说明 |
| --- | --- | --- |
| `account` | `id`, `display_name`, `status` | 账号/组织边界。`status`: `active`, `suspended`, `closed`。 |
| `user` | `id`, `primary_email`, `display_name`, `status` | 登录主体。`status`: `active`, `disabled`, `pending_verification`。 |
| `account_user` | `account_id`, `user_id`, `role` | Account 成员关系；唯一键 `account_id + user_id`。 |
| `session` | `id`, `user_id`, `issued_at`, `expires_at`, `revoked_at` | B 端会话；撤销后不可恢复。 |
| `workspace` | `id`, `account_id`, `name`, `slug`, `status` | S 端主要隔离边界；唯一键 `account_id + slug`。 |
| `workspace_member` | `workspace_id`, `user_id`, `role`, `status` | 角色：`owner`, `admin`, `developer`, `viewer`, `approver`。 |
| `workspace_invitation` | `workspace_id`, `email`, `role`, `token_hash`, `expires_at`, `accepted_at` | 邀请 token 只保存 hash。 |

### 5.2 Agent 与 Branch

| Table | 关键字段 | 约束与说明 |
| --- | --- | --- |
| `agent` | `id`, `workspace_id`, `name`, `status`, `default_branch_id`, `current_skill_version_id` | `status`: `draft`, `active`, `paused`, `archived`。 |
| `agent_config` | `id`, `agent_id`, `version`, `policy_profile_id`, `context_policy`, `model_preference` | 配置版本不可原地覆盖；唯一键 `agent_id + version`。 |
| `agent_branch` | `id`, `workspace_id`, `agent_id`, `name`, `source_branch_id`, `source_run_id`, `status` | `status`: `active`, `paused`, `adopted`, `archived`。 |
| `branch_state_snapshot` | `id`, `branch_id`, `context_snapshot_id`, `skill_version_id`, `policy_profile_id`, `git_ref`, `created_at` | fork 时保存上下文、skill、策略和 Git 引用指针。 |
| `branch_artifact` | `id`, `branch_id`, `run_id`, `type`, `content_ref`, `summary`, `risk_tier` | 可采纳产物：代码变更、总结、skill 草案、实验结论。 |
| `branch_adoption` | `id`, `workspace_id`, `branch_id`, `target_agent_id`, `status`, `requested_by` | `status`: `requested`, `waiting_for_approval`, `applying`, `completed`, `failed`, `cancelled`。 |
| `branch_adoption_item` | `id`, `adoption_id`, `artifact_id`, `status`, `result_ref` | 逐项采纳，不自动采纳完整认知状态。 |

### 5.3 Context

| Table | 关键字段 | 约束与说明 |
| --- | --- | --- |
| `context_snapshot` | `id`, `workspace_id`, `agent_id`, `branch_id`, `summary`, `sensitivity`, `digest` | 表示某一时点的上下文快照。 |
| `context_reference` | `id`, `snapshot_id`, `type`, `uri`, `content_ref`, `digest`, `metadata` | `type`: `file`, `snippet`, `doc`, `memory`, `conversation`, `external_ref`。 |
| `context_revision` | `id`, `context_reference_id`, `version`, `digest`, `content_ref`, `created_by` | 上下文引用版本，不覆盖历史。 |
| `run_context_usage` | `id`, `run_id`, `context_snapshot_id`, `context_reference_id`, `reason`, `token_estimate` | 记录某次 run 使用了哪些 context 以及原因。 |

### 5.4 AgentRun 与执行

| Table | 关键字段 | 约束与说明 |
| --- | --- | --- |
| `agent_run` | `id`, `workspace_id`, `agent_id`, `branch_id`, `created_by`, `goal`, `status`, `correlation_id` | `status` 见 AgentRun 状态机。 |
| `run_step` | `id`, `run_id`, `sequence`, `type`, `status`, `approval_request_id`, `execution_request_id` | 唯一键 `run_id + sequence`。 |
| `run_artifact` | `id`, `run_id`, `step_id`, `type`, `content_ref`, `digest`, `metadata` | 保存补丁、日志摘要、测试结果、草案引用等 metadata。 |
| `run_cancellation` | `id`, `run_id`, `requested_by`, `reason`, `requested_at`, `effective_at` | 取消请求必须可审计。 |
| `commit_record` | `id`, `workspace_id`, `agent_id`, `branch_id`, `run_id`, `git_commit`, `confirmed_at` | 用户确认的 Git 工作提交；用于触发 `LearningRun`。 |

`run_step.type` 至少包括 `plan`, `execution_request`, `approval_gate`, `observe_output`, `summarize`, `finalize`。S 可细分内部 step，但对 B/C 暴露时必须映射到稳定类型。

### 5.5 ClientDaemon 与 Execution

| Table | 关键字段 | 约束与说明 |
| --- | --- | --- |
| `client_daemon` | `id`, `user_id`, `workspace_id`, `device_name`, `status`, `public_key`, `last_heartbeat_at` | C 端注册实例；对 C 协议暴露为 `clientId`。`status`: `pending`, `active`, `offline`, `revoked`。 |
| `daemon_session` | `id`, `daemon_id`, `connected_at`, `disconnected_at`, `capabilities`, `lease_expires_at` | WebSocket 或 fallback session。 |
| `execution_request` | `id`, `workspace_id`, `run_id`, `step_id`, `daemon_id`, `type`, `status`, `risk_tier`, `idempotency_key` | S 发给 C 的执行单元；对 C 协议暴露为 `executionId`。 |
| `execution_result` | `id`, `execution_request_id`, `status`, `result_ref`, `error_code`, `started_at`, `finished_at` | C 回传结果；大内容必须引用化。 |

`execution_request.type` 至少包括 `model_request`, `local_file_read`, `local_file_write`, `shell_command`, `git_operation`, `external_api_request`, `skill_generation`。

### 5.6 Approval 与 Policy

| Table | 关键字段 | 约束与说明 |
| --- | --- | --- |
| `policy_profile` | `id`, `workspace_id`, `name`, `status` | 工作区或 Agent 使用的策略集合。 |
| `policy_rule` | `id`, `profile_id`, `action`, `effect`, `risk_tier`, `condition`, `priority` | `effect`: `allow`, `deny`, `require_approval`, `require_client_confirmation`。 |
| `policy_decision` | `id`, `workspace_id`, `subject_type`, `subject_id`, `action`, `effect`, `risk_tier`, `reason`, `expires_at` | 一次策略评估结果。 |
| `approval_request` | `id`, `workspace_id`, `run_id`, `step_id`, `policy_decision_id`, `status`, `risk_tier`, `expires_at` | `status`: `pending`, `approved`, `denied`, `expired`, `cancelled`。 |
| `approval_decision` | `id`, `approval_request_id`, `decider_user_id`, `decision`, `reason`, `decided_at` | `decision`: `approved`, `denied`。同一审批只能有一个最终决议。 |

`risk_tier` 使用总纲定义：`read`, `write`, `execute`, `network`, `publish`, `secret`。

### 5.7 Skill 与 Learning

| Table | 关键字段 | 约束与说明 |
| --- | --- | --- |
| `skill` | `id`, `workspace_id`, `name`, `slug`, `scope`, `status` | `scope`: `global`, `workspace`。 |
| `skill_version` | `id`, `skill_id`, `version`, `content_ref`, `digest`, `status`, `published_at` | 不可变版本；`status`: `approved`, `published`, `deprecated`。 |
| `skill_draft` | `id`, `workspace_id`, `skill_id`, `learning_run_id`, `status`, `content_ref`, `digest` | `status`: `draft`, `review_requested`, `approved`, `published`, `rejected`。 |
| `learning_run` | `id`, `workspace_id`, `agent_id`, `source_run_id`, `trigger_type`, `status`, `commit_count_at_trigger` | 自我学习任务；自动触发由每 12 次确认提交触发，也允许用户手动触发。 |
| `learning_evidence` | `id`, `learning_run_id`, `source_type`, `source_ref`, `summary`, `confidence` | 记录学习依据和来源。 |
| `agent_skill_pointer` | `id`, `agent_id`, `skill_version_id`, `branch_id`, `enabled`, `created_at` | Agent 或 branch 当前引用的 skill version。 |

Skill 源格式采用 `SKILL.md` + YAML frontmatter + 资源目录。S 保存索引、版本、作用域、审核状态和内容引用；内容可存对象存储或数据库文本字段。

### 5.8 Event、Audit 与 Notification

| Table | 关键字段 | 约束与说明 |
| --- | --- | --- |
| `execution_event` | `id`, `workspace_id`, `stream_id`, `sequence`, `event_type`, `resource_type`, `resource_id`, `payload`, `occurred_at` | 持久化事件；唯一键 `stream_id + sequence`。 |
| `event_checkpoint` | `id`, `subscriber_type`, `subscriber_id`, `stream_id`, `last_sequence` | 支持 B/C 断线续传。 |
| `audit_log` | `id`, `workspace_id`, `actor_type`, `actor_id`, `action`, `resource_type`, `resource_id`, `result`, `request_id`, `created_at` | 安全审计不可变；更正只能追加新记录。 |
| `notification` | `id`, `workspace_id`, `recipient_user_id`, `type`, `status`, `event_id`, `read_at` | 由事件驱动产生。 |

### 5.9 数据约束

- 所有 workspace-scoped 表必须包含 `workspace_id`，并防止跨 workspace 外键引用。
- 所有可重试写操作必须支持 `Idempotency-Key` 或业务唯一键。
- 所有状态枚举只能通过状态机迁移，不允许直接任意更新。
- 所有来自 C 的结果必须关联 `execution_request_id`；C 不得直接修改 `agent_run` 终态。
- 所有可能显示给 B 的资源必须有稳定 `id`、`createdBy` 或可追溯 actor。

## 6. REST API 分组

REST base path 为 `/api/v1`。B 使用用户 session 认证；C 使用 client daemon registration token + 设备密钥或 mTLS。公共路径遵循总纲，S 内部仍必须通过 resource ownership 校验 workspace。

### 6.1 通用约定

- 写请求必须接受 `X-Request-Id`；可重试写请求必须接受 `Idempotency-Key`。
- 列表接口使用 cursor pagination：`limit`, `cursor`, `nextCursor`。
- API JSON 字段使用 camelCase；数据库字段可使用 snake_case。
- 时间使用 RFC 3339 UTC。
- 错误响应使用 `ErrorResponse`：`error.code`, `error.message`, `error.requestId`, `error.details`。

### 6.2 Workspace

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/workspaces` | 列出当前用户可访问工作区。 |
| `POST` | `/api/v1/workspaces` | 创建工作区。 |
| `GET` | `/api/v1/workspaces/{workspaceId}` | 获取工作区详情。 |
| `PATCH` | `/api/v1/workspaces/{workspaceId}` | 更新工作区元数据。 |
| `GET` | `/api/v1/workspaces/{workspaceId}/members` | 查询成员。 |
| `PATCH` | `/api/v1/workspaces/{workspaceId}/policy` | 更新 agent 与审批策略。 |

### 6.3 Agent 与 Run

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/workspaces/{workspaceId}/agents` | 创建 agent。 |
| `GET` | `/api/v1/workspaces/{workspaceId}/agents` | 列出工作区 agent。 |
| `GET` | `/api/v1/agents/{agentId}` | 获取 agent 当前状态。 |
| `PATCH` | `/api/v1/agents/{agentId}` | 更新 agent 元数据或状态。 |
| `POST` | `/api/v1/agents/{agentId}/runs` | 启动任务，创建 `AgentRun`。 |
| `GET` | `/api/v1/agents/{agentId}/runs` | 查询 agent run 列表。 |
| `GET` | `/api/v1/agents/{agentId}/runs/{runId}` | 获取任务执行详情。 |
| `GET` | `/api/v1/agents/{agentId}/runs/{runId}/events` | 查询某次 run 事件。 |
| `POST` | `/api/v1/agents/{agentId}/runs/{runId}/cancel` | 取消任务。 |
| `GET` | `/api/v1/agents/{agentId}/context-snapshots` | 查询上下文快照。 |

创建 run 时可包含 `goal`, `branchId`, `contextSnapshotId`, `priority`。若未指定 `branchId`，S 使用 agent 当前默认 branch。

### 6.4 Branch

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/agents/{agentId}/branches` | fork agent 分支。 |
| `GET` | `/api/v1/agents/{agentId}/branches` | 列出 agent 分支。 |
| `GET` | `/api/v1/branches/{branchId}` | 获取分支详情。 |
| `PATCH` | `/api/v1/branches/{branchId}` | 暂停、恢复或重命名分支。 |
| `POST` | `/api/v1/branches/{branchId}/archive` | 归档分支。 |
| `GET` | `/api/v1/branches/{branchId}/artifacts` | 查询可采纳产物。 |
| `POST` | `/api/v1/branches/{branchId}/adoptions` | 创建选择性采纳请求。 |
| `GET` | `/api/v1/branches/{branchId}/adoptions/{adoptionId}` | 查询采纳结果。 |

第一版 `BranchAdoption` 是结果采纳，不是完整状态 merge。S 不自动合并上下文、记忆或任务历史。

### 6.5 Skill 与 Learning

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/skills` | 查询全局和工作区 skill。 |
| `GET` | `/api/v1/skills/{skillId}` | 获取 skill 详情。 |
| `GET` | `/api/v1/skills/{skillId}/versions` | 查询版本。 |
| `POST` | `/api/v1/learning-runs` | 手动触发学习任务。 |
| `GET` | `/api/v1/learning-runs/{learningRunId}` | 查看学习任务结果。 |
| `GET` | `/api/v1/skill-drafts/{draftId}` | 获取 skill 草案。 |
| `POST` | `/api/v1/skill-drafts/{draftId}/review` | 提交审核结论。 |
| `POST` | `/api/v1/skill-drafts/{draftId}/publish` | 发布为新 `SkillVersion`。 |

S 在同一 agent 出现第 12 次、24 次、36 次等确认 `CommitRecord` 后，必须自动创建 `LearningRun(triggerType=commit_threshold)`。

### 6.6 Approval

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/approvals` | 查询当前用户可处理或可查看的审批。 |
| `GET` | `/api/v1/approvals/{approvalId}` | 获取审批详情。 |
| `POST` | `/api/v1/approvals/{approvalId}/decide` | 提交 `approved` 或 `denied` 决议。 |

审批决议必须记录 `deciderUserId`、`decision`、`reason`、`policyDecisionId` 和 `requestId`。同一审批只能有一个最终决议。

### 6.7 ClientDaemon

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/client-daemons/register` | C 端注册设备。 |
| `GET` | `/api/v1/client-daemons` | B 查询工作区 C 端状态。 |
| `POST` | `/api/v1/client-daemons/{daemonId}/heartbeat` | C 端心跳兜底。 |
| `GET` | `/api/v1/client-daemons/{daemonId}/execution-requests` | C 在 WebSocket 不可用时拉取请求。 |
| `POST` | `/api/v1/client-daemons/{daemonId}/execution-results` | C 回传执行结果或失败。 |

S 必须校验 `daemonId` 与认证 C 实例一致。REST path 中的 `daemonId` 对应 C 协议中的 `clientId`；执行结果中的 `executionId` 对应 S 表 `execution_request.id`。C 不能读取或提交其他 daemon 的执行结果。

### 6.8 Event、Audit 与 Notification

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/workspaces/{workspaceId}/events` | 按 stream、resource 或 sequence 查询事件。 |
| `GET` | `/api/v1/workspaces/{workspaceId}/audit-logs` | 查询审计日志。 |
| `GET` | `/api/v1/workspaces/{workspaceId}/notifications` | 查询通知。 |
| `POST` | `/api/v1/workspaces/{workspaceId}/notifications/{notificationId}/read` | 标记通知已读。 |

审计日志查询默认只允许 `owner`、`admin` 或具备显式权限的用户访问。

## 7. WebSocket Event Hub

WebSocket endpoint 为 `/ws/v1`。B 和 C 都连接 S：B 订阅工作区事件；C 订阅分配给自己的 execution request。WebSocket 消息用于低延迟通知，不替代 REST 查询。

S 对外统一使用 `domain.event` 事件命名：

- 面向产品事件流和 B 的 `ExecutionEvent.eventType` 使用总纲中的 domain event，例如 `execution.requested`、`agent.run.updated`。
- 面向 C 的传输消息也使用 envelope 的 `type` 字段承载 domain event；payload type 使用 PascalCase，例如 `ExecutionRequestPayload`、`ExecutionCompletedEventPayload`。两者必须通过同一个 `executionId` 和 `correlationId` 关联。

### 7.1 连接与订阅

- B 建连后发送 workspace subscription，范围可包括 `workspace`, `agent`, `run`, `branch`, `approval`, `skill`, `daemon`。
- C 建连后绑定 `clientId` 和 `daemonSessionId`，只接收分配给自己的 `ExecutionRequest`。
- S 建连成功后发送 `connection.ready`，包含 `connectionId`, `serverTime`, `lastSequenceHint`。
- 客户端定期发送 `client.heartbeat` 或 `heartbeat.ping`；S 返回在线状态和续约结果。
- 客户端重连时带上最近处理的 `eventId` 或 `streamId + sequence`。

### 7.2 Envelope

对外 WebSocket envelope 使用总纲字段，并允许 S 增加续传字段：

| Field | 说明 |
| --- | --- |
| `eventId` | 事件唯一 id。 |
| `type` | 事件类型，例如 `agent.run.updated`。 |
| `schemaVersion` | envelope schema 版本。 |
| `direction` | `s2b`, `b2s`, `s2c`, `c2s`。 |
| `occurredAt` | 事件发生时间。 |
| `userId` | 相关用户，可为空。 |
| `workspaceId` | workspace scope。 |
| `agentId` | 相关 agent，可为空。 |
| `branchId` | 相关 branch，可为空。 |
| `runId` | 相关 run，可为空。 |
| `clientId` | 相关 C 端 daemon，可为空。 |
| `daemonSessionId` | C 端本次连接会话，可为空。 |
| `executionId` | 相关执行请求，可为空。 |
| `streamId` | S 端事件流 id，用于续传。 |
| `sequence` | stream 内单调序号。 |
| `correlationId` | 端到端追踪 id。 |
| `causationId` | 触发当前事件的上游事件 id，可为空。 |
| `idempotencyKey` | 写请求或执行请求的幂等键，可为空。 |
| `payload` | 类型化 payload，不包含 secret。 |

### 7.3 事件类型

| Event | Direction | 触发时机 |
| --- | --- | --- |
| `agent.run.created` | S -> B/C | 新任务创建。 |
| `agent.run.updated` | S -> B | run 状态、阶段、阻塞原因变化。 |
| `execution.requested` | S -> B/C | S 通知 B 有执行请求，并向 C 下发 `ExecutionRequestPayload` 执行模型/API/本地工具动作。 |
| `execution.output` | C -> S -> B | C 上报流式输出、阶段日志或摘要。 |
| `execution.completed` | C -> S -> B | 执行成功，结果引用可用。 |
| `execution.failed` | C -> S -> B | 执行失败，包含错误码和可重试标记。 |
| `approval.requested` | S -> B | 风险动作需要审批。 |
| `approval.decided` | B -> S -> B | 审批已批准或拒绝；C 通过后续 `execution.requested` 中的 `ApprovalGrant` 获得执行授权。 |
| `client.heartbeat` | C -> S -> B | C 在线状态和能力摘要；S 转发给 B 时必须脱敏。 |
| `client.offline` | S -> B | C 心跳超时或连接断开。 |
| `learning.run.started` | S -> B | 自我学习任务开始。 |
| `learning.run.updated` | S -> B | 学习任务状态变化。 |
| `skill.draft.created` | S -> B | 新 skill 草案可审核。 |
| `skill.version.published` | S -> B | 草案发布为版本。 |
| `branch.created` | S -> B/C | agent 分支已创建。 |
| `branch.updated` | S -> B | 分支状态变化。 |
| `branch.adoption.completed` | S -> B | 分支结果采纳完成。 |
| `notification.created` | S -> B | 产生通知。 |

### 7.4 S/C Payload 映射

| Event type | S/C payload type | 说明 |
| --- | --- | --- |
| `execution.requested` | `ExecutionRequestPayload` | S 下发执行请求，包含 `executionId`, `capabilityId`, `riskTier`, `approvalGrant`, `idempotencyKey`。 |
| `execution.output` | `ExecutionLogEventPayload`, `ExecutionProgressEventPayload`, `ModelStreamChunkEventPayload` | C 回传日志、进度或模型流式输出；S 可聚合后广播给 B。 |
| `execution.completed` | `ExecutionCompletedEventPayload` | C 执行成功；S 合并到 `execution_result` 并推进 `RunStep`。 |
| `execution.failed` | `ExecutionFailedEventPayload` | C 执行失败；S 根据 `retryable` 和 policy 决定重试、等待审批或失败。 |
| `client.heartbeat` | `HeartbeatEventPayload` | C 上报在线状态、版本、capabilities 和健康摘要。 |
| `client.offline` | `DaemonStatusEventPayload` 或 S 心跳超时检测 | S 判断 C 离线后广播给 B。 |

### 7.5 投递语义

- 对持久化业务事件，S 提供 at-least-once delivery。
- B/C 必须按 `eventId` 或 `streamId + sequence` 去重。
- S 至少保留工作区事件 30 天，供 REST 续传。
- `ExecutionRequest` 不是 exactly-once；C 必须使用 `executionId` 和 `idempotencyKey` 防止重复执行。
- C 断线时，未完成 `execution_request` 的 lease 到期；S 根据策略重派、等待或将 run 标记为 `client_offline`/`failed`。

## 8. 关键状态机

所有状态机由 S 强制执行。任何状态迁移都必须写入 `ExecutionEvent`；涉及权限、策略、审批、C 执行、分支采纳或 skill 发布的迁移还必须写入 `AuditLog`。

### 8.1 AgentRun

状态：

- `queued`：Run 已创建，等待调度。
- `planning`：S 正在规划 step、选择上下文、评估初始策略。
- `waiting_for_client`：已生成 `ExecutionRequest`，等待 C 接受、执行或回传。
- `running`：C 已接受执行请求，或 S 正在处理执行输出。
- `waiting_for_approval`：被 policy gate 阻塞，等待人工审批。
- `summarizing`：执行结束，S 正在整理结果、产物、提交记录和上下文摘要。
- `completed`：成功完成。
- `failed`：不可自动恢复失败。
- `cancelled`：用户或系统取消。
- `client_offline`：所需 C 离线，run 暂停或失败前的可见异常状态。

允许迁移：

| From | To | 触发 |
| --- | --- | --- |
| `queued` | `planning` | 调度器获取 run lease。 |
| `planning` | `waiting_for_client` | 需要 C 执行模型/API/本地工具请求。 |
| `planning` | `waiting_for_approval` | 初始 policy 返回 `require_approval`。 |
| `waiting_for_client` | `running` | C 接受 `ExecutionRequest`。 |
| `running` | `waiting_for_approval` | 执行中发现新风险动作。 |
| `waiting_for_approval` | `waiting_for_client` | 审批通过后继续派发原动作。 |
| `waiting_for_approval` | `failed` | 审批拒绝且无替代路径。 |
| `running` | `summarizing` | 执行请求全部完成，进入总结和产物整理。 |
| `summarizing` | `completed` | 摘要、产物、提交记录、事件写入成功。 |
| `waiting_for_client` / `running` | `client_offline` | C 心跳超时或执行 lease 过期。 |
| 任意非终态 | `cancelled` | 用户或系统取消且执行已收敛。 |
| 任意非终态 | `failed` | 策略拒绝、不可恢复错误、内部一致性失败。 |

终态为 `completed`, `failed`, `cancelled`。终态不可重开；重试必须创建新的 `AgentRun`，并可记录 `retryOfRunId`。

### 8.2 ApprovalRequest

状态：

- `pending`：等待审批人处理。
- `approved`：已批准。
- `denied`：已拒绝。
- `expired`：超过 `expiresAt`。
- `cancelled`：关联 run、step 或 action 已取消。

规则：

- 只有具备 `approver`, `admin`, `owner` 或策略指定权限的用户可以决议。
- `approved`, `denied`, `expired`, `cancelled` 为终态。
- 审批只放行 `policy_decision` 覆盖的原 action；action 内容变化必须重新评估。
- 重复提交同一决议必须幂等返回当前结果，不得创建第二个最终 `ApprovalDecision`。
- 审批过期后，S 不得继续使用旧授权。

### 8.3 Skill Learning

`LearningRun` 状态：

- `queued`：学习任务已创建。
- `collecting_evidence`：收集 run、commit、上下文摘要和用户反馈。
- `generating_draft`：通过 C 执行模型请求或 S 端整理生成候选草案。
- `draft_ready`：已生成 `SkillDraft`，等待审核。
- `completed`：草案流程已结束。
- `failed`：学习过程失败。
- `cancelled`：用户取消或来源失效。

`SkillDraft` 状态：

- `draft`：草案已生成但未提交审核。
- `review_requested`：等待用户或策略审核。
- `approved`：审核通过，可发布。
- `published`：已发布为不可变 `SkillVersion`。
- `rejected`：审核拒绝。

规则：

- 自动触发以确认的 `CommitRecord` 计数为准，每 12 次提交创建一次 `LearningRun`。
- 学习证据必须可追溯到 `sourceRunId`、`commitRecordId`、`contextSnapshotId` 或用户提交内容。
- 生成草案如需模型调用，必须通过 C；S 不直接调用模型 provider。
- 未审核通过的 `SkillDraft` 不得污染正式 `SkillVersion`。
- 发布 skill 属于 `publish` risk tier，必须经过 policy evaluation。

### 8.4 AgentBranch

状态：

- `active`：可在该分支上启动 run。
- `paused`：暂停新 run，保留查看和采纳能力。
- `adopted`：分支结果已被选择性采纳。
- `archived`：归档，不参与默认列表和新 run。

允许迁移：

| From | To | 触发 |
| --- | --- | --- |
| `active` | `paused` | 用户暂停、C 离线导致冻结或 policy 要求。 |
| `paused` | `active` | 用户恢复或阻塞解除。 |
| `active` / `paused` | `adopted` | 至少一个 `BranchAdoption` 成功完成。 |
| `active` / `paused` / `adopted` | `archived` | 用户归档。 |

规则：

- fork 时必须保存 `branch_state_snapshot`，包含上下文摘要、skill 指针、策略配置和 Git ref。
- `adopted` 不代表完整 merge；只表示用户选择的产物被采纳。
- `archived` 分支不得创建新 run。
- 分支采纳如果涉及写文件、发布 skill 或修改 agent 指针，必须按对应 risk tier 走 policy/approval。

## 9. 安全边界

### 9.1 B/S 边界

- B 只能使用用户 session 访问 S API，不得持有 daemon token。
- B 不直接连接 C，不直接调用模型 provider，不直接执行本地工具。
- B 提交的所有 resource id 都必须由 S 重新鉴权。
- B 的实时状态来自 S 事件；页面刷新必须以 REST 返回为准。

### 9.2 S/C 边界

- C 持有用户模型/API key；S 不保存、不记录、不回显这些密钥。
- S 发送给 C 的是 `ExecutionRequest` 和策略约束，不发送超出任务所需的数据。
- C 回传的 `ExecutionResult` 必须经过大小、类型、digest、workspace ownership 和 policy 校验。
- C 不能决定 `AgentRun` 终态；只能提交执行结果，由 S 状态机推进。
- `ClientDaemon` 注册和 session 必须可撤销；撤销后未完成请求进入等待、重派或失败路径。

### 9.3 Workspace 边界

- 所有 user-facing 和 daemon-facing API 都必须校验 workspace membership 或 client daemon scope。
- 跨 workspace 引用必须拒绝，错误码 `workspace.scope_violation`。
- 查询不可见资源时，S 可按安全策略返回 `resource.not_found`，避免泄露存在性。
- `AuditLog` 查询只允许授权角色访问。

### 9.4 Policy 与 Approval 边界

- `deny` 优先级高于 `require_approval`，`require_approval` 高于 `allow`。
- 审批是一次性授权，不是长期通用授权。
- 高风险 action 至少包括：`local_file.write`, `shell.command`, `network.write`, `skill.publish`, `branch.adopt`, `secret.use`。
- Policy 规则变更必须写入 audit，并广播策略相关事件或通知。

### 9.5 数据保护

- event payload、audit detail、应用日志不得包含 secret、access token、API key 或完整敏感上下文。
- 大段输出、补丁、模型响应和文件内容使用 `contentRef`，读取时重新鉴权。
- 审计日志不可变；合规删除通过 anonymization/tombstone 保留安全事实。
- 导出 audit/event 数据必须记录审计动作，例如 `audit.exported`。

## 10. 错误码

错误码使用稳定 lower dot identifier，与 HTTP status 同时返回。

| Code | HTTP | 含义 | 典型处理 |
| --- | --- | --- | --- |
| `authentication.required` | 401 | 未认证或 token 缺失。 | B/C 重新认证。 |
| `session.expired` | 401 | 用户会话过期。 | B 重新登录。 |
| `client_daemon.auth_failed` | 401 | C 端认证失败。 | C 重新注册或刷新 session。 |
| `permission.denied` | 403 | 当前 actor 无权限。 | B 隐藏操作或提示申请权限。 |
| `workspace.scope_violation` | 403 | 资源跨 workspace 或不属于当前 workspace。 | 停止请求并写安全审计。 |
| `resource.not_found` | 404 | 资源不存在或不可见。 | B 显示不存在或已删除。 |
| `resource.archived` | 409 | 资源已归档，不允许操作。 | 选择其他资源或恢复。 |
| `state.invalid_transition` | 409 | 不允许的状态机迁移。 | B 刷新当前状态。 |
| `update.conflict` | 409 | 版本、状态或指针冲突。 | 重新拉取后重试。 |
| `idempotency.conflict` | 409 | 同一 idempotency key 对应不同请求体。 | 使用新 key 或复用原请求。 |
| `policy.denied` | 403 | 策略拒绝动作。 | 展示策略原因，不自动重试。 |
| `approval.required` | 202 | 动作已暂停等待审批。 | B 跳转审批；C 等待后续事件。 |
| `approval.expired` | 409 | 审批已过期。 | 重新发起动作。 |
| `client_daemon.offline` | 409 | 所需 C 端离线。 | 提示启动 C 或排队等待。 |
| `client_daemon.capability_missing` | 422 | C 缺少所需 provider/tool 能力。 | 提示配置 C。 |
| `execution.lease_expired` | 409 | 执行请求租约过期。 | S 重派、等待或失败。 |
| `validation.failed` | 422 | 请求字段非法。 | B 显示字段错误。 |
| `payload.too_large` | 413 | 请求或结果过大。 | 改用 `contentRef`。 |
| `rate_limited` | 429 | 请求超过限流。 | 按 `Retry-After` 重试。 |
| `internal.error` | 500 | 未分类服务端错误。 | 记录 request id，稍后重试。 |
| `service.unavailable` | 503 | S 依赖不可用或维护中。 | 客户端退避重试。 |

## 11. 可观测性与运维要求

- 每个 API 请求必须有 `requestId`，并能关联 event、audit 和日志。
- 每个 `AgentRun` 必须有 `correlationId`，贯穿 B 请求、S 调度、C 执行、事件和审计。
- 指标至少包括：API latency、API error rate、run state counts、approval pending age、client daemon online count、execution latency、policy decision counts、event delivery lag。
- 健康检查至少区分 `liveness`, `readiness`, `postgres`, `eventHub`, `clientDaemonGateway`。
- 后台推进器必须使用 lease，避免多实例重复推进同一 `AgentRun` 或 `ExecutionRequest`。
- 事件广播失败不得回滚已提交业务状态；客户端通过事件续传补偿。

## 12. 开发约束

- API、事件、错误码、状态枚举一经 B/C 消费，必须兼容演进。
- 新增状态必须同步更新状态机、事件列表、错误处理和验收场景。
- 新增可执行 action 必须先定义 policy action identifier、risk tier 和审批行为。
- 涉及 C 执行的功能必须定义 `ExecutionRequest.type`、输入摘要、输出引用、失败码和幂等规则。
- 涉及 UI 实时展示的状态必须定义对应 WebSocket event，并说明 REST 补偿路径。
- schema migration 必须保留历史 event/audit 可读性。

## 13. 验收场景

### 13.1 创建 workspace、agent 并启动 run

前置条件：

- 用户 `UserA` 已登录。
- `WorkspaceW` 存在，`UserA` 是 `developer`。
- `ClientDaemonD` 已注册到 `WorkspaceW` 且在线。

步骤与期望：

1. B 调用 `POST /api/v1/workspaces/{workspaceId}/agents` 创建 `AgentA`。
2. B 调用 `POST /api/v1/agents/{agentId}/runs` 创建 `AgentRun`。
3. S 校验 membership、agent 状态、branch 状态和 policy。
4. S 写入 `agent_run.status = queued` 和 `agent.run.created`。
5. 调度器推进到 `planning`，生成 `RunStep`。
6. 若需要模型或本地工具，S 创建 `ExecutionRequest`，持久化 `execution.requested`，并向 C 发送 `ExecutionRequestPayload`。
7. C 完成后回传 `execution.completed` + `ExecutionCompletedEventPayload`，S 持久化事件，推进 run 到 `summarizing` 和 `completed`。

验收标准：

- Postgres 中存在 `Agent`, `AgentRun`, `RunStep`, `ExecutionRequest`, `ExecutionEvent`。
- 所有事件共享同一 `correlationId`。
- S 未保存用户模型/API key。

### 13.2 C 执行模型/API/本地工具请求

步骤与期望：

1. S 通过 WebSocket 向 C 发送 `execution.requested` + `ExecutionRequestPayload`，并在事件流中记录该事件。
2. C 使用本地保存的 provider key 或本地工具执行动作。
3. C 通过 `execution.output` 回传 `ExecutionLogEventPayload`、`ExecutionProgressEventPayload` 或 `ModelStreamChunkEventPayload`，并通过 `execution.completed` 回传结果引用。
4. S 校验 `executionId`、workspace scope、digest 和大小限制。
5. S 写入 `ExecutionResult`，推进对应 `RunStep`。

验收标准：

- 重复的 `execution.completed` 不会重复推进 step。
- 结果大内容只以 `contentRef` 形式进入 S。
- B 可以通过 WebSocket 看到输出，也可以通过 REST 查询最终状态。

### 13.3 高风险动作触发审批

前置条件：

- `PolicyRule(action=local_file.write)` 的 `effect=require_approval`。
- `UserApprover` 具备 `approver` 权限。

步骤与期望：

1. run 中出现 `local_file.write` 动作。
2. S 创建 `PolicyDecision(effect=require_approval)` 和 `ApprovalRequest(status=pending)`。
3. `AgentRun` 进入 `waiting_for_approval`。
4. S 广播 `approval.requested` 和 `agent.run.updated`。
5. `UserApprover` 调用 `POST /api/v1/approvals/{approvalId}/decide` 提交 `approved`。
6. S 写入 `ApprovalDecision` 和 audit log。
7. S 只恢复原 action 覆盖的执行请求。

验收标准：

- 审批前 C 不会收到可执行该写入的最终授权。
- 重复 approve 请求幂等返回已有决议。
- audit 可追踪到审批人、风险 tier、action 和 request id。

### 13.4 审批拒绝导致 run 失败

步骤与期望：

1. `ApprovalRequest(status=pending)` 被提交 `decision=denied`。
2. S 写入 `approval.decided`。
3. 若 run 无替代路径，S 将 `AgentRun` 从 `waiting_for_approval` 迁移到 `failed`。
4. B 收到 `agent.run.updated`，错误码为 `policy.denied` 或审批拒绝原因。

验收标准：

- 被拒绝 action 不会继续派发给 C。
- 同一 run 不会从终态重新打开；重试必须创建新 run。

### 13.5 C 离线与 execution lease

步骤与期望：

1. S 已派发 `ExecutionRequest(status=leased)` 给 `ClientDaemonD`。
2. C 心跳超时或 WebSocket 断开。
3. S 广播 `client.offline`。
4. 执行 lease 到期后，S 根据策略重派、等待或将 run 标记为 `client_offline`/`failed`。

验收标准：

- 同一 `ExecutionRequest` 不会被两个 C 并发执行。
- C 重连后使用 `idempotencyKey` 不会重复提交已完成结果。

### 13.6 第 12 次确认提交触发 LearningRun

步骤与期望：

1. Agent 产生并被用户确认第 12 次 `CommitRecord`。
2. S 创建 `LearningRun(triggerType=commit_threshold)`。
3. S 广播 `learning.run.started`。
4. S 收集最近工作事件、上下文摘要、提交说明和结果反馈为 `LearningEvidence`。
5. S 通过 C 或内部整理生成 `SkillDraft(status=draft)`，广播 `skill.draft.created`。

验收标准：

- 学习证据可追溯到 commit、run 和 context。
- 学习任务不会直接发布正式 skill。
- 自动学习失败不会影响原 run 的完成状态。

### 13.7 Skill 草案审核与发布

步骤与期望：

1. B 展示 `SkillDraft`。
2. 用户提交审核通过，S 将状态推进到 `approved`。
3. 用户发布草案，S 对 `skill.publish` 执行 policy evaluation。
4. 若允许，S 创建不可变 `SkillVersion`，将草案状态置为 `published`。
5. S 广播 `skill.version.published`。

验收标准：

- 已发布 `SkillVersion` 的 `digest` 不可改变。
- 被拒绝草案不能被 agent 默认引用。
- 发布动作有 audit log。

### 13.8 Fork 分支并采纳结果

步骤与期望：

1. 用户调用 `POST /api/v1/agents/{agentId}/branches` fork `AgentBranch`。
2. S 保存 `branch_state_snapshot`，包含上下文摘要、skill 指针、策略配置和 Git ref。
3. 用户在分支上启动 run，产生 `BranchArtifact`。
4. 用户调用 `POST /api/v1/branches/{branchId}/adoptions` 选择性采纳部分产物。
5. S 对采纳动作执行 policy/approval，完成后广播 `branch.adoption.completed`。

验收标准：

- 采纳只影响用户选择的 artifact。
- S 不自动合并 branch 的记忆、上下文或任务历史。
- 采纳结果可审计，可回溯到 artifact 和审批记录。

### 13.9 跨 workspace 访问被拒绝

步骤与期望：

1. 用户属于 `WorkspaceA`，尝试读取 `WorkspaceB` 的 `AgentRun`。
2. S 在 API 层和查询层校验 resource ownership。
3. S 返回 `workspace.scope_violation` 或不可见资源的 `resource.not_found`。
4. S 写入安全 audit log。

验收标准：

- 响应不泄露 `WorkspaceB` 的名称、状态或资源存在性细节。
- audit log 包含 actor、目标 resource、结果和 request id。

### 13.10 WebSocket 断线恢复

步骤与期望：

1. B 已订阅工作区事件，最后处理到 `streamId=S1, sequence=10`。
2. 断线期间 S 产生 `sequence=11..15`。
3. B 重连并提交 checkpoint。
4. S 补发缺失事件，或 B 调用 `/api/v1/workspaces/{workspaceId}/events` 拉取。
5. B 按 `eventId` 或 `streamId + sequence` 去重。

验收标准：

- B 最终显示状态与 REST `GET /api/v1/agents/{agentId}/runs/{runId}` 一致。
- 重复事件不会导致 UI 重复应用。

## 14. 最小上线检查清单

- 已实现 workspace-scoped authorization，覆盖 B 和 C API。
- 已实现 `AgentRun`、`ApprovalRequest`、`LearningRun`、`SkillDraft`、`AgentBranch` 状态机校验。
- 已实现 `ExecutionEvent` 持久化、WebSocket 广播和 REST 续传。
- 已实现 `ClientDaemon` 注册、心跳、能力声明、execution lease 和幂等。
- 已实现 `PolicyDecision`、`ApprovalRequest`、`ApprovalDecision` 关联。
- 已实现 `AuditLog`，覆盖权限失败、策略变更、审批、执行请求、分支采纳和 skill 发布。
- 已定义并测试错误码到 HTTP status 的映射。
- 已为本文验收场景准备集成测试或端到端测试计划。
