# brainx 产品与接口总纲

## 1. 产品定位

brainx 是一个面向开发工作的 agent 平台，灵感来自 Codex，但核心目标不是单次对话生成代码，而是让 agent 能长期维护项目上下文、沉淀 skill、并通过分支化 agent 状态并行探索多个开发方向。

第一版按完整平台蓝图设计，默认支持个人账号和多个工作区，团队协作和复杂 RBAC 只预留扩展点。

## 2. 三端职责

| 端 | 技术默认 | 核心职责 | 明确不做 |
| --- | --- | --- | --- |
| B | React + TypeScript | 用户界面、任务控制、分支观察、skill 审核、审批响应、运行日志展示 | 不保存密钥，不直接调用模型或本地工具 |
| S | Java Spring Boot + Postgres | 账号、工作区、agent、上下文、agent loop、skill、分支、审批、审计、REST/WebSocket 契约 | 不保存模型 API key 明文，不直接代用户调用模型提供商 |
| C | Rust daemon | 本地注册、用户 API key 保管、模型/API 请求、本地 Git/文件/shell/tool 执行、心跳、结果回传 | 不决定产品策略，不维护长期业务状态 |

架构原则：核心状态和热更新逻辑集中在 S 端；C 端低频更新且尽量通用；B 端只承载交互。

## 3. 核心能力

### 3.1 自我学习

agent 在项目中每产生并确认 12 次 Git 工作提交后，S 端创建 `LearningRun`。学习任务读取最近工作事件、上下文摘要、提交说明和结果反馈，生成 `SkillDraft`。草案必须通过用户或策略审核后成为 `SkillVersion`，不会自动污染正式 skill。

Skill 源格式采用 `SKILL.md` + YAML frontmatter + 资源目录。S 端保存索引、版本、作用域和审核状态；文件内容可存对象存储或数据库文本字段。

### 3.2 分支开发

创建 agent 分支时 fork 以下状态：

- agent 上下文摘要和必要事件引用。
- 当前 skill 版本指针。
- agent 策略配置。
- 与代码仓库 Git 分支或远端引用的关联。

分支合并第一版采用“结果采纳”：用户选择性采纳代码变更、skill 草案、总结或实验结论到主分支。不自动合并上下文、记忆或任务历史。

## 4. 领域模型

| 实体 | 说明 |
| --- | --- |
| `Account` | 用户账号和登录身份。 |
| `Workspace` | 项目工作区，包含 agents、skills、branches 和策略。 |
| `Agent` | 可长期工作的 agent 实例。 |
| `AgentBranch` | 从 agent 当前状态 fork 的探索分支。 |
| `AgentRun` | 一次任务执行或 agent loop。 |
| `ContextSnapshot` | 上下文快照，包含摘要、引用和敏感级别。 |
| `CommitRecord` | agent 确认产生的 Git 工作提交，用于学习触发计数。 |
| `Skill` | 可复用能力单元，作用域为 `global` 或 `workspace`。 |
| `SkillVersion` | skill 的不可变版本，包含内容哈希和发布状态。 |
| `LearningRun` | 自我学习任务，产出一个或多个 skill 草案。 |
| `ApprovalRequest` | 写文件、命令、网络、发布、合并等风险动作的审批单。 |
| `ExecutionEvent` | agent loop、C 端执行、审批和错误的事件日志。 |
| `ClientDaemon` | 已注册的 C 端实例。 |

## 5. 状态机

### AgentRun

`queued -> planning -> waiting_for_client -> running -> waiting_for_approval -> running -> summarizing -> completed`

异常状态：`failed`、`cancelled`、`client_offline`。所有状态变化写入 `ExecutionEvent` 并通过 WebSocket 广播。

### ApprovalRequest

`pending -> approved | denied | expired | cancelled`

审批通过后，S 端只授权动作；实际执行仍由 C 端完成并回传结果。

### SkillDraft / SkillVersion

`draft -> review_requested -> approved -> published`

驳回路径：`draft/review_requested -> rejected`。已发布 `SkillVersion` 不可变，后续修改产生新版本。

### AgentBranch

`active -> paused -> adopted | archived`

`adopted` 表示分支结果被选择性采纳，不代表完整状态合并。

## 6. REST API 契约

Base path: `/api/v1`  
认证：B 端使用用户会话 token；C 端使用 daemon registration token + mTLS 或设备密钥。  
写接口支持 `Idempotency-Key`。错误体统一为：

```json
{
  "error": {
    "code": "approval.required",
    "message": "Approval is required before executing this action.",
    "requestId": "req_..."
  }
}
```

### Workspace

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/workspaces` | 列出工作区。 |
| `POST` | `/workspaces` | 创建工作区。 |
| `GET` | `/workspaces/{workspaceId}` | 获取工作区详情。 |
| `PATCH` | `/workspaces/{workspaceId}/policy` | 更新 agent 和审批策略。 |

### Agent

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/workspaces/{workspaceId}/agents` | 创建 agent。 |
| `GET` | `/agents/{agentId}` | 获取 agent 当前状态。 |
| `POST` | `/agents/{agentId}/runs` | 启动任务。 |
| `GET` | `/agents/{agentId}/runs/{runId}` | 获取任务执行详情。 |
| `POST` | `/agents/{agentId}/runs/{runId}/cancel` | 取消任务。 |
| `GET` | `/agents/{agentId}/context-snapshots` | 查看上下文快照。 |

### Branch

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/agents/{agentId}/branches` | fork agent 分支。 |
| `GET` | `/agents/{agentId}/branches` | 列出分支。 |
| `GET` | `/branches/{branchId}` | 分支详情。 |
| `POST` | `/branches/{branchId}/adoptions` | 采纳分支结果。 |
| `POST` | `/branches/{branchId}/archive` | 归档分支。 |

### Skill / Learning

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/skills` | 查询全局和工作区 skill。 |
| `GET` | `/skills/{skillId}/versions` | 查询版本。 |
| `POST` | `/learning-runs` | 手动触发学习任务。 |
| `GET` | `/learning-runs/{learningRunId}` | 查看学习任务结果。 |
| `POST` | `/skill-drafts/{draftId}/review` | 提交审核结论。 |
| `POST` | `/skill-drafts/{draftId}/publish` | 发布为新 `SkillVersion`。 |

### Approval / ClientDaemon

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/approvals` | 查询待处理审批。 |
| `POST` | `/approvals/{approvalId}/decide` | B 端提交批准或拒绝。 |
| `GET` | `/client-daemons` | B 端查询 C 端设备和在线状态。 |
| `POST` | `/client-daemons/register` | C 端注册设备。 |
| `POST` | `/client-daemons/{daemonId}/heartbeat` | C 端心跳兜底。 |
| `POST` | `/client-daemons/{daemonId}/execution-results` | C 端回传执行结果。 |

## 7. WebSocket 契约

Endpoint: `/ws/v1`  
连接方：B 端和 C 端都连接 S 端。B 端订阅工作区事件；C 端订阅分配给自己的执行请求。

统一 envelope：

```json
{
  "eventId": "evt_...",
  "type": "agent.run.updated",
  "schemaVersion": "1.0",
  "direction": "s2b",
  "occurredAt": "2026-07-04T12:00:00Z",
  "userId": "u_...",
  "workspaceId": "w_...",
  "agentId": "a_...",
  "branchId": "br_...",
  "runId": "run_...",
  "clientId": "cd_...",
  "daemonSessionId": "ds_...",
  "executionId": "exec_...",
  "streamId": "stream_...",
  "sequence": 42,
  "correlationId": "corr_...",
  "causationId": "evt_...",
  "idempotencyKey": "idem_...",
  "payload": {}
}
```

`eventId`, `type`, `schemaVersion`, `direction`, `occurredAt` 和 `payload` 为通用必填字段；资源 ID 字段按事件上下文填写。B/C 端必须使用 `eventId` 或 `streamId + sequence` 去重和续传。

| Event | Direction | Payload 摘要 |
| --- | --- | --- |
| `agent.run.created` | S -> B/C | 新任务、目标 agent、输入摘要。 |
| `agent.run.updated` | S -> B | run 状态变化。 |
| `execution.requested` | S -> B/C | B 端观察执行请求，C 端接收并执行模型/API/本地工具请求。 |
| `execution.output` | C -> S -> B | 流式日志、stdout、模型 token 或阶段输出。 |
| `execution.completed` | C -> S -> B | 执行结果、耗时、产物引用。 |
| `execution.failed` | C -> S -> B | 错误码、可重试标记、诊断摘要。 |
| `approval.requested` | S -> B | 风险动作审批单。 |
| `approval.decided` | B -> S -> B | 审批状态变化；批准后由 S 在后续 `execution.requested` 中向 C 提供 `ApprovalGrant`。 |
| `client.heartbeat` | C -> S -> B | daemon 在线状态和能力摘要；S 转发给 B 时必须脱敏。 |
| `client.offline` | S -> B | daemon 心跳超时或连接断开。 |
| `learning.run.started` | S -> B | 自我学习任务开始。 |
| `skill.draft.created` | S -> B | 新 skill 草案可审核。 |
| `branch.created` | S -> B/C | agent 分支已创建。 |
| `branch.adoption.completed` | S -> B | 分支结果采纳完成。 |

重连规则：客户端以最近确认的 `eventId` 请求续传；S 端至少保留工作区事件 30 天。

## 8. 风险分级

| Tier | 示例 | 默认策略 |
| --- | --- | --- |
| `read` | 读取文件、查看 Git 状态 | 默认允许并审计。 |
| `write` | 修改文件、生成补丁 | 需要审批。 |
| `execute` | shell 命令、测试、构建 | 按命令风险审批。 |
| `network` | 调用外部 API、下载依赖 | 需要审批或工作区白名单。 |
| `publish` | 发布 skill、采纳分支、推送远端 | 必须显式审批。 |
| `secret` | 读取或使用密钥 | C 端本地处理，S 端只记录脱敏摘要。 |

## 9. 关键验收场景

1. 用户在 B 端创建工作区和 agent，S 端持久化状态并推送 `agent.run.created`。
2. S 端规划任务后向 C 端发送 `execution.requested`，C 端使用本地 API key 调用模型并回传输出。
3. agent 需要写文件时，S 端创建 `ApprovalRequest`，B 端批准后 C 端执行。
4. 第 12 次确认的 Git 工作提交出现后，S 端自动创建 `LearningRun` 并生成 `SkillDraft`。
5. 用户审核并发布 skill 草案，新的 `SkillVersion` 可被后续 agent run 引用。
6. 用户 fork agent 分支并并行探索，分支使用 fork 时的上下文和 skill 指针。
7. 用户选择性采纳分支结果到主线，S 端记录采纳事件但不自动合并认知状态。

## 10. 延后范围

- 多人组织、复杂 RBAC、计费和企业审计。
- 自动合并 agent 记忆、上下文或 skill 冲突。
- C 端插件市场和第三方工具沙箱标准。
- 跨工作区共享私有 skill 的治理流程。
