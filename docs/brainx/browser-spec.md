# brainx B 端规格

## 1. 定位

B 端是 brainx 的 React/TypeScript 浏览器用户界面。它面向使用者提供工作区、agent、运行、分支、skill、审批和日志的可视化控制面，帮助用户观察 agent 正在做什么、决定高风险动作是否允许、审查自我学习结果，并选择性采纳分支产物。

B 端只连接 S 端：

- REST base path: `/api/v1`
- WebSocket endpoint: `/ws/v1`

B 端不得直接调用模型提供商、不得直接连接 C 端、不得执行本地工具、不得保存用户模型 API key。所有状态、策略、执行调度、事件持久化和审批判定的事实来源都是 S 端。

## 2. 职责

### 2.1 核心职责

- 展示用户可访问的 `Workspace`、`Agent`、`AgentRun`、`AgentBranch`、`Skill`、`SkillVersion`、`SkillDraft`、`LearningRun`、`ApprovalRequest`、`ExecutionEvent` 和 `ClientDaemon` 状态。
- 通过 REST 向 S 端提交用户意图，例如创建 agent、启动 run、取消 run、fork branch、提交审批决定、发布 skill、采纳分支结果。
- 通过 WebSocket 订阅工作区事件并实时更新 UI，例如 `agent.run.updated`、`execution.output`、`approval.requested`、`skill.draft.created`、`branch.adoption.completed`。
- 为高风险动作提供清晰的审批体验，帮助用户理解动作、影响范围、风险等级、执行主体和可拒绝原因。
- 为分支开发提供并行观察、差异比较、产物选择和结果采纳体验。
- 为自我学习提供 skill 草案审查、版本对比、发布确认和驳回反馈体验。
- 为执行过程提供可追溯的日志、阶段、输出、错误、重试提示和最终结果视图。
- 在 C 端离线、S 端错误、WebSocket 断开或资源为空时提供明确、可恢复的界面状态。

### 2.2 设计原则

- **S 端事实优先**：B 端所有持久状态必须来自 S 端响应或事件，不在本地推导长期业务状态。
- **事件驱动但可恢复**：实时体验依赖 WebSocket，页面刷新和重连后必须能通过 REST 重新拉取当前状态。
- **用户可解释**：agent 的计划、审批、执行、失败和采纳结果必须能被用户理解，不能只显示内部状态码。
- **风险动作显式确认**：`write`、`execute`、`network`、`publish`、`secret` 等风险动作必须在 UI 中标明风险 tier 和影响范围。
- **分支不自动合并认知状态**：B 端在文案和交互上必须明确 `branch.adoption` 是选择性采纳产物，不代表自动合并 agent 记忆、上下文或任务历史。

## 3. 非目标

B 端第一版明确不做：

- 不保存、读取、展示或转发模型 API key 明文。
- 不直接调用 OpenAI、Anthropic、GitHub、本地 shell、文件系统、Git 或其他外部工具。
- 不绕过 S 端审批策略执行任何动作。
- 不承担 agent loop、上下文裁剪、skill 生成、分支 fork、结果合并或事件审计逻辑。
- 不实现多人组织、复杂 RBAC、计费、企业审计和跨工作区私有 skill 治理。
- 不提供离线可编辑模式。断网时只允许展示已加载数据和连接恢复入口。
- 不在浏览器端长期缓存敏感执行内容；本地缓存仅限非敏感 UI 偏好和短期查询状态。
- 不把 WebSocket 事件当作唯一事实来源；任何重要写入完成后都应以 S 端确认结果为准。

## 4. App Shell

### 4.1 全局结构

App shell 由以下区域组成：

| 区域 | 说明 |
| --- | --- |
| `top-bar` | 当前 workspace、全局搜索入口、WebSocket 连接状态、当前用户菜单。 |
| `primary-nav` | 主要导航：Dashboard、Agents、Branches、Approvals、Skills、Learning、Daemons、Settings。 |
| `content-region` | 当前 route 的主体内容。 |
| `side-panel` | 可选详情面板，用于审批、日志、diff、skill 版本等上下文详情。 |
| `toast-region` | 非阻塞反馈，例如保存成功、连接恢复、审批已提交。 |
| `modal-layer` | 高风险确认、发布确认、采纳确认、取消 run 等阻塞动作。 |

### 4.2 全局能力

- Workspace 切换：切换后刷新 route 范围内数据并重新订阅对应工作区事件。
- 连接状态：展示 `connected`、`reconnecting`、`disconnected`、`stale`。
- 全局搜索：搜索 `Agent`、`AgentBranch`、`AgentRun`、`Skill` 和 `ApprovalRequest`。
- 通知入口：聚合待处理 `ApprovalRequest`、新 `SkillDraft`、失败 run、C 端离线。
- 面包屑：深层页面必须显示从 workspace 到当前资源的定位路径。
- 快捷操作：常用入口包括 `new-agent`、`start-run`、`fork-branch`、`review-approval`。

## 5. Routes

Route 使用稳定英文标识。URL 中的资源 ID 与 S 端 REST 资源一致。

| Route ID | Path | 页面 |
| --- | --- | --- |
| `workspace.dashboard` | `/workspaces/:workspaceId` | 工作区总览。 |
| `workspace.agents` | `/workspaces/:workspaceId/agents` | agent 列表。 |
| `agent.detail` | `/workspaces/:workspaceId/agents/:agentId` | agent 详情。 |
| `agent.runs` | `/workspaces/:workspaceId/agents/:agentId/runs` | run 列表。 |
| `agent.run.detail` | `/workspaces/:workspaceId/agents/:agentId/runs/:runId` | run 详情与实时日志。 |
| `agent.context` | `/workspaces/:workspaceId/agents/:agentId/context-snapshots` | 上下文快照。 |
| `branch.list` | `/workspaces/:workspaceId/branches` | 分支列表。 |
| `branch.detail` | `/workspaces/:workspaceId/branches/:branchId` | 分支详情。 |
| `branch.adoption` | `/workspaces/:workspaceId/branches/:branchId/adoptions/new` | 分支结果采纳。 |
| `approval.queue` | `/workspaces/:workspaceId/approvals` | 审批队列。 |
| `approval.detail` | `/workspaces/:workspaceId/approvals/:approvalId` | 审批详情。 |
| `skill.list` | `/workspaces/:workspaceId/skills` | skill 列表。 |
| `skill.detail` | `/workspaces/:workspaceId/skills/:skillId` | skill 详情。 |
| `skill.version.detail` | `/workspaces/:workspaceId/skills/:skillId/versions/:versionId` | skill 版本详情。 |
| `skill.draft.review` | `/workspaces/:workspaceId/skill-drafts/:draftId/review` | skill 草案审核。 |
| `learning.list` | `/workspaces/:workspaceId/learning-runs` | learning run 列表。 |
| `learning.detail` | `/workspaces/:workspaceId/learning-runs/:learningRunId` | learning run 详情。 |
| `daemon.list` | `/workspaces/:workspaceId/client-daemons` | C 端 daemon 状态。 |
| `workspace.settings` | `/workspaces/:workspaceId/settings` | 工作区设置。 |
| `workspace.policy` | `/workspaces/:workspaceId/settings/policy` | agent 与审批策略。 |

## 6. 主要页面

### 6.1 `workspace.dashboard`

展示工作区整体健康度和待处理事项：

- 活跃 `AgentRun` 数量，按 `queued`、`planning`、`waiting_for_client`、`running`、`waiting_for_approval`、`summarizing` 分组。
- 待处理 `ApprovalRequest`，优先展示高风险和即将过期项。
- 最新 `execution.failed`、`client_offline`、`skill.draft.created`、`branch.adoption.completed`。
- C 端在线状态与最近 heartbeat 时间。
- 最近分支和学习活动。

用户可从该页面进入创建 agent、处理审批、查看失败 run、审核 skill 草案和查看 daemon 状态。

### 6.2 `workspace.agents`

展示当前 workspace 下所有 `Agent`：

- 基本信息：名称、描述、状态、默认 branch、最近 run、最近 commit 计数、当前 skill 指针摘要。
- 过滤：状态、是否有活跃 run、是否需要审批、是否有失败 run。
- 操作：创建 agent、进入详情、启动 run、fork branch。

### 6.3 `agent.detail`

展示单个 `Agent` 的操作中心：

- 当前状态、策略摘要、绑定仓库或项目引用。
- 最近 `AgentRun` 时间线。
- 当前上下文摘要和 `ContextSnapshot` 入口。
- 当前使用的 `SkillVersion` 指针。
- 分支入口和最近采纳记录。
- 启动任务输入区，提交后调用 `POST /agents/{agentId}/runs`。

### 6.4 `agent.run.detail`

展示一次 `AgentRun` 的实时状态和审计线索：

- run 状态机：`queued`、`planning`、`waiting_for_client`、`running`、`waiting_for_approval`、`summarizing`、`completed`、`failed`、`cancelled`、`client_offline`。
- 阶段时间线：计划、执行请求、审批、C 端输出、完成或失败。
- 实时输出：订阅 `execution.output`，按来源、阶段、时间排序。
- 关联审批：展示当前 run 触发的 `ApprovalRequest`。
- 产物摘要：补丁、文件变更、测试结果、提交记录、skill 草案引用、分支引用。
- 操作：取消 run、打开审批、复制诊断信息、查看上下文快照。

### 6.5 `approval.queue`

展示待用户处理的审批：

- 默认只显示 `pending`，可切换 `approved`、`denied`、`expired`、`cancelled` 历史。
- 按风险 tier、过期时间、agent、branch、run、动作类型过滤。
- 支持批量选择低风险同类审批，但 `publish`、`secret`、跨分支采纳类审批必须单独确认。
- 新 `approval.requested` 事件到达时实时插入队列，并在当前页面可见位置提示。

### 6.6 `approval.detail`

展示审批详情：

- 审批状态：`pending`、`approved`、`denied`、`expired`、`cancelled`。
- 风险 tier：`read`、`write`、`execute`、`network`、`publish`、`secret`。
- 请求来源：workspace、agent、run、branch、daemon。
- 动作摘要：要做什么、为什么需要做、影响哪些资源。
- 证据区：命令摘要、文件路径、diff 摘要、网络目标、发布目标或脱敏 secret 用途。
- 决策区：`approve`、`deny`，拒绝时要求填写原因；批准高风险动作时显示二次确认。
- 结果区：提交后展示 `approval.decided` 结果和后续 `execution.completed` 或 `execution.failed`。

### 6.7 `branch.list`

展示工作区内 agent 分支：

- 分支状态：`active`、`paused`、`adopted`、`archived`。
- 来源 agent、来源 run、fork 时间、关联 Git branch 或 ref。
- 最近 run、待审批数、产物数、是否存在可采纳结果。
- 操作：进入详情、归档、创建采纳流程。

### 6.8 `branch.detail`

展示单个 `AgentBranch`：

- fork 来源：agent、上下文快照、skill 指针、策略配置、Git 引用。
- 分支 run 时间线和执行日志入口。
- 与主线的产物差异：代码变更、总结、skill 草案、实验结论。
- 当前风险和阻塞：待审批、C 端离线、失败 run。
- 操作：启动分支 run、暂停或归档、进入采纳流程。

### 6.9 `branch.adoption`

用于选择性采纳分支结果：

- 显示可采纳项：代码变更、提交记录、skill 草案、总结、实验结论。
- 用户逐项选择采纳范围，不提供“自动合并全部认知状态”的选项。
- 展示冲突、风险 tier、目标 agent 或主线分支。
- 提交调用 `POST /branches/{branchId}/adoptions`。
- 完成后等待 `branch.adoption.completed`，并显示采纳记录。

### 6.10 `skill.list`

展示全局和工作区 skill：

- 维度：`global`、`workspace`。
- 状态：草案数、已发布版本、最近引用、最近学习来源。
- 搜索：名称、描述、标签、作用域。
- 操作：查看详情、查看版本、进入待审核草案。

### 6.11 `skill.detail` 与 `skill.version.detail`

展示 `Skill` 与不可变 `SkillVersion`：

- 元信息：名称、作用域、版本、内容哈希、发布时间、审核来源。
- 版本历史：按发布时间倒序。
- 引用情况：哪些 agent 或 run 使用过该版本。
- 内容视图：展示 `SKILL.md`、frontmatter 摘要和资源目录索引。
- 对比视图：比较两个 `SkillVersion` 的说明、frontmatter、资源清单和内容变更。

### 6.12 `skill.draft.review`

用于审核 `SkillDraft`：

- 草案来源：`LearningRun`、触发 commit 计数、相关 run、生成时间。
- 草案状态：`draft`、`review_requested`、`approved`、`published`、`rejected`。
- 变更预览：新 skill 或现有 skill 新版本。
- 风险提示：是否扩大作用域、是否改变 agent 行为、是否包含敏感内容摘要。
- 审核动作：批准、驳回、发布。发布调用 `POST /skill-drafts/{draftId}/publish`。
- 驳回必须填写原因，原因回传 S 端供后续学习策略参考。

### 6.13 `learning.list` 与 `learning.detail`

展示自我学习任务：

- 列表展示 `LearningRun` 状态、触发原因、关联 agent、产出草案数。
- 详情展示输入摘要：最近工作事件、上下文摘要、提交说明、结果反馈引用。
- 详情展示输出：`SkillDraft`、失败诊断、审核状态。
- 支持手动触发学习任务，调用 `POST /learning-runs`。

### 6.14 `daemon.list`

展示 `ClientDaemon` 状态：

- 在线状态、最近 heartbeat、能力摘要、绑定 workspace、版本、执行中任务数。
- 离线时展示受影响的 run 和恢复建议。
- 不展示本地密钥、密钥名称或密钥内容。

### 6.15 `workspace.policy`

展示和编辑工作区 agent 与审批策略：

- 风险 tier 默认策略。
- 命令、网络、发布、采纳等动作的审批规则摘要。
- 白名单或策略例外只展示 S 端允许编辑的字段。
- 保存调用 `PATCH /workspaces/{workspaceId}/policy`。

## 7. 用户工作流

### 7.1 创建 workspace 与 agent

1. 用户进入工作区列表或创建入口。
2. B 端调用 `POST /workspaces` 创建 `Workspace`。
3. 用户在 `workspace.agents` 创建 agent。
4. B 端调用 `POST /workspaces/{workspaceId}/agents`。
5. 创建成功后进入 `agent.detail`，展示空 run 状态和下一步入口。

### 7.2 启动 agent run

1. 用户在 `agent.detail` 输入任务目标并提交。
2. B 端调用 `POST /agents/{agentId}/runs`，请求携带 `Idempotency-Key`。
3. S 端返回 `AgentRun`，B 端跳转到 `agent.run.detail`。
4. B 端订阅并展示 `agent.run.created`、`agent.run.updated`、`execution.output`。
5. run 进入终态后展示结果、失败诊断或后续采纳入口。

### 7.3 处理风险审批

1. S 端创建 `ApprovalRequest` 并广播 `approval.requested`。
2. B 端在全局通知和 `approval.queue` 中显示待处理项。
3. 用户进入 `approval.detail` 检查动作、证据、风险和来源。
4. 用户选择 `approve` 或 `deny`。
5. B 端调用 `POST /approvals/{approvalId}/decide`。
6. S 端广播 `approval.decided` 更新审批状态；若批准，S 端在后续 `execution.requested` 中向 C 端提供 `ApprovalGrant`。
7. B 端继续展示后续 `execution.completed` 或 `execution.failed`。

### 7.4 C 端离线恢复

1. run 状态变为 `waiting_for_client` 或 `client_offline`。
2. B 端在 run、dashboard、daemon 页面提示受影响范围。
3. 用户恢复 C 端后，S 端接收 `client.heartbeat`。
4. B 端通过 WebSocket 或 REST 刷新状态，移除离线阻塞提示。

### 7.5 第 12 次提交后的 skill 学习

1. S 端确认第 12 次 Git 工作提交后创建 `LearningRun`。
2. B 端收到 `learning.run.started` 并在 dashboard 和 learning 页面提示。
3. 学习完成后，S 端广播 `skill.draft.created`。
4. 用户进入 `skill.draft.review` 审核草案。
5. 用户批准并发布后，B 端调用 `POST /skill-drafts/{draftId}/publish`。
6. 新 `SkillVersion` 出现在 `skill.detail` 版本历史中，后续 run 可引用。

### 7.6 分支并行开发与采纳

1. 用户在 `agent.detail` 或 `branch.list` 发起 fork。
2. B 端调用 `POST /agents/{agentId}/branches`。
3. S 端创建 `AgentBranch` 并广播 `branch.created`。
4. 用户在 `branch.detail` 启动分支 run、观察日志和审批。
5. 分支产生结果后，用户进入 `branch.adoption`。
6. 用户选择要采纳的代码变更、skill 草案、总结或实验结论。
7. B 端调用 `POST /branches/{branchId}/adoptions`。
8. S 端完成后广播 `branch.adoption.completed`。
9. B 端展示采纳记录，并明确分支上下文和记忆未自动合并。

## 8. REST 依赖

B 端依赖的 REST 资源必须由 S 端提供。B 端可以组合调用，但不得更改资源语义。

### 8.1 Workspace

| Method | Path | B 端用途 |
| --- | --- | --- |
| `GET` | `/workspaces` | 工作区选择器和初始入口。 |
| `POST` | `/workspaces` | 创建工作区。 |
| `GET` | `/workspaces/{workspaceId}` | app shell、dashboard 和权限范围。 |
| `PATCH` | `/workspaces/{workspaceId}/policy` | 保存审批与 agent 策略。 |

### 8.2 Agent 与 Run

| Method | Path | B 端用途 |
| --- | --- | --- |
| `POST` | `/workspaces/{workspaceId}/agents` | 创建 agent。 |
| `GET` | `/agents/{agentId}` | agent 详情和状态刷新。 |
| `POST` | `/agents/{agentId}/runs` | 启动任务。 |
| `GET` | `/agents/{agentId}/runs/{runId}` | run 详情兜底加载和重连恢复。 |
| `POST` | `/agents/{agentId}/runs/{runId}/cancel` | 用户取消任务。 |
| `GET` | `/agents/{agentId}/context-snapshots` | 上下文快照页面。 |

### 8.3 Branch

| Method | Path | B 端用途 |
| --- | --- | --- |
| `POST` | `/agents/{agentId}/branches` | fork agent 分支。 |
| `GET` | `/agents/{agentId}/branches` | agent 内分支列表。 |
| `GET` | `/branches/{branchId}` | 分支详情和采纳前刷新。 |
| `POST` | `/branches/{branchId}/adoptions` | 提交选择性采纳。 |
| `POST` | `/branches/{branchId}/archive` | 归档分支。 |

### 8.4 Skill 与 Learning

| Method | Path | B 端用途 |
| --- | --- | --- |
| `GET` | `/skills` | skill 列表、搜索和过滤。 |
| `GET` | `/skills/{skillId}/versions` | 版本历史和对比。 |
| `POST` | `/learning-runs` | 手动触发学习。 |
| `GET` | `/learning-runs/{learningRunId}` | 学习任务详情。 |
| `POST` | `/skill-drafts/{draftId}/review` | 提交审核结论。 |
| `POST` | `/skill-drafts/{draftId}/publish` | 发布新 `SkillVersion`。 |

### 8.5 Approval 与 ClientDaemon

| Method | Path | B 端用途 |
| --- | --- | --- |
| `GET` | `/approvals` | 审批队列和历史。 |
| `POST` | `/approvals/{approvalId}/decide` | 批准或拒绝审批。 |
| `GET` | `/client-daemons` | daemon 列表和在线状态。 |

## 9. WebSocket 依赖

B 端连接 `/ws/v1` 后按 workspace 订阅事件。连接建立时应携带用户会话 token；断线重连时以最近确认的 `eventId` 请求续传。若续传失败或事件过期，B 端必须通过 REST 重新加载当前 route 数据。

| Event | B 端处理 |
| --- | --- |
| `agent.run.created` | 插入或刷新 run 列表，必要时提示新任务已创建。 |
| `agent.run.updated` | 更新 run 状态机、dashboard 计数和相关列表状态。 |
| `execution.output` | 追加到 run 日志流，保持时间顺序和来源标识。 |
| `execution.completed` | 标记执行阶段完成，刷新产物摘要。 |
| `execution.failed` | 标记失败，展示错误码、可重试标记和诊断摘要。 |
| `approval.requested` | 插入审批队列，显示全局通知和 run 关联提示。 |
| `approval.decided` | 更新审批状态，关闭已提交决策的待处理 UI。 |
| `learning.run.started` | 更新 learning 列表和 dashboard 提示。 |
| `skill.draft.created` | 插入待审核草案，通知用户进入 review。 |
| `branch.created` | 更新分支列表和 agent 详情。 |
| `branch.adoption.completed` | 更新采纳状态、分支状态和 dashboard 活动。 |
| `client.heartbeat` | 更新 daemon 在线状态和受影响 run 的阻塞提示。 |
| `client.offline` | 标记 daemon 离线，提示受影响 run 进入等待或失败路径。 |

### 9.1 事件处理规则

- 事件必须按 `occurredAt` 和服务端顺序应用；同一 `eventId` 只能处理一次。
- 当前 route 不可见的资源可只更新列表摘要和通知，不强制加载完整详情。
- 对用户正在编辑的表单，事件不得覆盖未提交输入。
- 当事件与当前 REST 数据冲突时，以后一次 REST 刷新结果为准。
- 所有事件都应保留用户可见的时间和来源信息，便于审计。

## 10. UI 状态模型

B 端 UI 状态分为三类：服务端状态、会话状态和本地偏好。

### 10.1 服务端状态

服务端状态来自 REST 或 WebSocket，包括：

- `workspace.current`
- `agents.byId`
- `agentRuns.byId`
- `branches.byId`
- `approvals.byId`
- `skills.byId`
- `skillVersions.byId`
- `skillDrafts.byId`
- `learningRuns.byId`
- `clientDaemons.byId`
- `executionEvents.byRunId`

服务端状态必须支持：

- 以资源 ID 去重。
- 以 `updatedAt`、`occurredAt` 或服务端版本号处理新旧数据。
- route 进入时加载完整详情。
- WebSocket 到达时增量更新。
- 写操作成功后按 S 端响应更新，而不是只依赖乐观状态。

### 10.2 会话状态

会话状态不应持久化为业务事实，包括：

- 当前 route 和选中的 tab。
- 列表过滤、排序、分页游标。
- 日志展开状态和滚动锚点。
- side panel 打开状态。
- 当前表单草稿。
- 最近确认的 WebSocket `eventId`。
- 当前连接状态和重连次数。

### 10.3 本地偏好

可以持久化到浏览器本地的非敏感偏好：

- 主题。
- 语言。
- 列表密度。
- 是否自动跟随日志滚动。
- 默认 dashboard 时间范围。

不得本地持久化：

- API key、daemon token、设备密钥。
- 未脱敏命令输出中的 secret。
- 审批决策 token。
- 大段执行日志或模型输出。

### 10.4 写操作状态

所有写操作都应有明确状态：

- `idle`
- `submitting`
- `succeeded`
- `failed`

重复提交风险较高的写操作必须使用 `Idempotency-Key`，包括创建 run、创建 branch、提交 adoption、审批决定、发布 skill。

## 11. Approval UX

### 11.1 审批信息架构

审批详情必须回答五个问题：

- 谁请求：agent、run、branch、daemon。
- 要做什么：动作类型和目标资源。
- 为什么做：agent 计划或执行阶段摘要。
- 风险是什么：risk tier、影响范围、是否可恢复。
- 用户能怎么决定：批准、拒绝、查看上下文。

### 11.2 风险 tier 展示

| Tier | UI 要求 |
| --- | --- |
| `read` | 可合并展示，强调只读和审计记录。 |
| `write` | 展示文件路径、diff 摘要、是否覆盖现有内容。 |
| `execute` | 展示命令摘要、工作目录、环境摘要、超时和副作用提示。 |
| `network` | 展示目标域名或 API、数据出站摘要、是否命中白名单。 |
| `publish` | 二次确认，展示发布或采纳后的可见范围和不可逆部分。 |
| `secret` | 不展示 secret 明文，只展示脱敏用途和本地处理说明。 |

### 11.3 决策交互

- `approve`：高风险 tier 需要二次确认；确认文本必须包含目标动作和资源名称。
- `deny`：必须填写拒绝原因；原因应回传 S 端并展示在 run 时间线。
- 过期：`expired` 审批不可再提交，页面提供刷新或返回队列。
- 已决策：`approved`、`denied`、`cancelled` 只读展示，不允许重复提交。
- 批量审批：仅允许同一 agent、同一 run、同一风险 tier 的低风险同类动作；`publish` 和 `secret` 不允许批量。

### 11.4 审批后的反馈

提交决策后：

- 立即将按钮置为不可重复提交。
- 显示 S 端确认状态。
- 在 run 时间线添加审批决策节点。
- 若 C 端后续失败，展示 `execution.failed`，不得把审批成功误表述为执行成功。

## 12. Branch Development UX

### 12.1 Fork 体验

创建分支前，B 端应展示 fork 内容：

- agent 上下文摘要和必要事件引用。
- 当前 skill 版本指针。
- agent 策略配置。
- 关联 Git branch 或远端 ref。

用户提交后，B 端调用 `POST /agents/{agentId}/branches` 并等待 `branch.created` 或 REST 返回。

### 12.2 并行观察

分支列表和详情应帮助用户比较多个探索方向：

- 目标和假设。
- 最近 run 状态。
- 产物类型和数量。
- 待审批阻塞。
- 失败诊断。
- 与主线关系。

### 12.3 采纳体验

采纳页面必须以“选择性采纳”为核心：

- 默认不全选高风险项。
- 每个采纳项有独立说明、风险、预览和目标。
- 代码变更展示文件级摘要和 diff 入口。
- skill 草案采纳后仍进入 skill 审核流程，除非 S 端策略明确允许同步发布。
- 总结和实验结论应标明采纳到哪个 agent 或 workspace 记录。
- 提交前展示最终选择清单。

### 12.4 采纳后的状态

采纳完成后：

- 分支可进入 `adopted`，但仍可保留只读详情。
- B 端展示采纳记录、时间、操作者和目标资源。
- 未采纳项保留在分支详情中，直到分支归档。
- UI 文案必须避免“已合并全部上下文”之类表述。

## 13. Skill Review UX

### 13.1 草案入口

用户可以从以下位置进入 `skill.draft.review`：

- dashboard 新草案通知。
- `learning.detail` 输出区。
- `skill.list` 待审核过滤。
- run 结果中的 skill 草案引用。

### 13.2 审核内容

审核页面必须展示：

- `SkillDraft` 名称、作用域、目标 skill 或新 skill 标识。
- 来源 `LearningRun`、关联 commits、关联 runs。
- 草案 `SKILL.md` 内容预览。
- YAML frontmatter 摘要。
- 资源目录清单。
- 与上一 `SkillVersion` 的差异。
- 潜在风险和敏感内容检测摘要。

### 13.3 审核动作

| 动作 | 说明 |
| --- | --- |
| `approve` | 标记草案通过审核，但不一定立即发布。 |
| `reject` | 驳回草案，必须填写原因。 |
| `publish` | 发布为新的不可变 `SkillVersion`。 |

发布前必须展示：

- 发布作用域：`global` 或 `workspace`。
- 新版本号或版本标识。
- 内容哈希。
- 受影响 agent 或后续 run 的引用范围。

### 13.4 版本对比

版本对比应支持：

- frontmatter 差异。
- 正文差异。
- 资源目录增删改。
- 行为摘要差异。
- 引用情况差异。

B 端只展示和提交审核决定，不在浏览器内自动改写 skill 内容。

## 14. Empty、Loading、Error States

### 14.1 Empty

| 场景 | 文案方向 | 主要操作 |
| --- | --- | --- |
| 无 workspace | 说明需要先创建工作区。 | `create-workspace` |
| 无 agent | 说明 agent 是长期执行单元。 | `new-agent` |
| 无 run | 说明可启动第一个任务。 | `start-run` |
| 无 branch | 说明可从 agent fork 探索方向。 | `fork-branch` |
| 无 approval | 说明当前没有待处理风险动作。 | 返回 dashboard |
| 无 skill | 说明 skill 会来自学习或手动导入的后续能力。 | 查看 learning |
| 无 learning run | 说明第 12 次确认提交后会自动学习，也可手动触发。 | `start-learning-run` |
| 无 daemon | 说明需要本地 C 端连接后才能执行模型和本地工具。 | 查看连接说明 |

### 14.2 Loading

- 首屏加载使用页面级 skeleton，避免空白闪烁。
- 表格分页加载使用行级 skeleton。
- run 日志首次加载显示历史日志加载状态；后续实时追加不阻塞页面。
- 写操作使用按钮内 `submitting` 状态和不可重复提交保护。

### 14.3 Error

错误展示必须包含：

- S 端错误码，例如 `approval.required`。
- 用户可读 message。
- `requestId`，方便排查。
- 可执行恢复动作，例如重试、刷新、返回列表、打开审批。

常见错误：

| 错误 | UI 行为 |
| --- | --- |
| 认证失效 | 跳转登录或展示重新认证入口。 |
| 无权限 | 展示无权限页，不泄漏资源详情。 |
| 资源不存在 | 展示 not found，并提供返回上级 route。 |
| WebSocket 断开 | 顶部连接状态变为 `reconnecting`，保留已加载数据。 |
| 事件续传失败 | 通过 REST 重新加载当前 route。 |
| C 端离线 | 标记受影响 run，提示恢复 daemon。 |
| 审批已过期 | 禁用决策按钮，提示刷新队列。 |
| 写操作冲突 | 展示冲突说明并重新拉取资源。 |

## 15. 可访问性

B 端应满足以下要求：

- 所有核心操作可通过键盘完成。
- Modal 和 side panel 必须正确管理焦点，关闭后焦点返回触发元素。
- 审批、发布、采纳等高风险操作不能只依赖颜色表达风险。
- 日志流需要提供暂停自动滚动、跳到最新、复制片段和按阶段过滤能力。
- 实时事件更新应通过非打扰方式提示；关键审批可使用可访问的 live region。
- 表格支持明确的列标题、排序状态和行操作标签。
- 图标按钮必须有可读名称。
- 错误提示应与对应表单字段关联。
- diff 和日志内容需要保证等宽字体可读、对比度足够、长行可横向滚动或换行。
- 动画和自动滚动应尊重用户的 reduced motion 偏好。

## 16. i18n

第一版界面默认中文，但 route、resource、event、status 和 API identifier 保持稳定英文。

i18n 规则：

- 用户可见文案走翻译资源，不把中文硬编码到业务状态枚举里。
- 状态枚举保持英文，例如 `waiting_for_approval`、`client_offline`、`published`。
- 时间、数字、持续时间按用户 locale 格式化。
- 错误码保持英文，错误 message 可本地化。
- 审批风险 tier 使用英文 identifier 和中文解释同时展示。
- 文档、日志和模型输出按原文展示，不强制翻译。
- 搜索应支持英文 identifier 和中文显示名。

## 17. 安全与隐私

- B 端不得显示模型 API key、daemon registration token、设备密钥或 secret 明文。
- 对疑似 secret 的日志内容，优先展示 S 端或 C 端已脱敏结果；B 端不得自作主张恢复原文。
- 浏览器本地存储只保存非敏感 UI 偏好。
- 审批详情中的命令、网络目标和 diff 可能包含敏感路径，应遵循 S 端返回的脱敏字段。
- 用户复制日志或诊断信息时，应提示其中可能包含项目路径或输出内容。
- 所有写操作依赖 S 端鉴权和策略校验，B 端本地禁用按钮不能作为安全边界。

## 18. 验收场景

### 18.1 创建并运行 agent

Given 用户已进入 `workspace.dashboard`  
When 用户创建 agent 并启动 run  
Then B 端调用 `POST /workspaces/{workspaceId}/agents` 和 `POST /agents/{agentId}/runs`  
And 页面进入 `agent.run.detail`  
And WebSocket 收到 `agent.run.created` 与 `agent.run.updated` 后状态实时更新。

### 18.2 实时执行日志

Given `AgentRun` 处于 `running`  
When S 端转发 `execution.output`  
Then B 端在 run 日志中追加输出  
And 不覆盖用户当前过滤条件或滚动暂停设置。

### 18.3 审批写文件

Given agent 请求 `write` tier 动作  
When B 端收到 `approval.requested`  
Then `approval.queue` 出现待处理项  
And `approval.detail` 展示文件路径、diff 摘要、来源 run 和风险说明  
When 用户批准  
Then B 端调用 `POST /approvals/{approvalId}/decide`  
And 后续执行结果以 `execution.completed` 或 `execution.failed` 为准。

### 18.4 拒绝高风险命令

Given 审批 tier 为 `execute`  
When 用户选择 `deny` 且填写原因  
Then B 端提交拒绝决定  
And run 时间线显示拒绝原因  
And 审批状态变为 `denied`。

### 18.5 C 端离线

Given run 等待本地执行  
When S 端将 run 状态更新为 `client_offline`  
Then B 端在 dashboard、run 详情和 daemon 页面提示 C 端离线  
And 不提供任何直接调用本地工具的替代入口。

### 18.6 自动学习与 skill 草案

Given S 端因第 12 次确认提交创建 `LearningRun`  
When B 端收到 `learning.run.started` 和 `skill.draft.created`  
Then dashboard 显示学习活动和待审核草案  
And 用户可以进入 `skill.draft.review` 查看来源、diff 和风险。

### 18.7 发布 skill 版本

Given `SkillDraft` 已通过审核  
When 用户确认发布  
Then B 端调用 `POST /skill-drafts/{draftId}/publish`  
And `skill.detail` 展示新的不可变 `SkillVersion`  
And 发布确认显示作用域、内容哈希和影响范围。

### 18.8 Fork 分支并并行运行

Given 用户在 `agent.detail` 发起 fork  
When B 端调用 `POST /agents/{agentId}/branches`  
Then 收到 `branch.created` 后 `branch.detail` 展示 fork 来源、上下文摘要、skill 指针和 Git 引用  
And 用户可以在分支上启动独立 run。

### 18.9 选择性采纳分支结果

Given 分支产生代码变更、skill 草案和实验总结  
When 用户进入 `branch.adoption`  
Then B 端允许逐项选择采纳内容  
And 提交调用 `POST /branches/{branchId}/adoptions`  
And 收到 `branch.adoption.completed` 后展示采纳记录  
And 页面明确说明未自动合并分支上下文、记忆或任务历史。

### 18.10 WebSocket 重连恢复

Given B 端 WebSocket 断开  
When 连接恢复  
Then B 端使用最近确认的 `eventId` 请求续传  
And 如果续传失败，则通过 REST 重新加载当前 route 数据  
And 用户未提交的表单输入不被覆盖。

### 18.11 错误可诊断

Given 任意 REST 写操作失败  
When S 端返回统一错误体  
Then B 端展示错误 message、错误 code 和 `requestId`  
And 提供重试、返回或打开相关审批的恢复动作。

## 19. 第一版完成标准

B 端第一版完成时应满足：

- 所有 route 能基于 S 端 REST 契约加载对应资源。
- WebSocket 可驱动 run、approval、learning、skill、branch、daemon 的实时状态变化。
- 审批队列和审批详情可完成批准、拒绝、过期只读展示。
- 分支详情和采纳流程明确支持选择性采纳，不表达自动合并认知状态。
- skill 草案审核和发布流程可追溯来源、差异、风险和结果。
- 空、加载、错误、断线、C 端离线状态均有可用界面。
- 关键用户工作流具备可访问性标签、键盘路径和清晰错误恢复。
