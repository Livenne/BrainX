# brainx C 端本地守护进程规格

## 1. 范围与定位

本文定义 brainx C 端本地守护进程的产品与协议规格。C 端是运行在用户本地机器上的 Rust daemon，负责连接托管 S 端、保存本地敏感凭据、执行经过授权的模型/API/文件/Git/shell/tool 操作，并把执行过程与结果回传给 S 端。

brainx 采用 B/S/C 架构：

- B 端：React/TypeScript 浏览器 UI，面向用户展示会话、任务、日志、审批与结果。
- S 端：托管 Java Spring Boot 服务，使用 Postgres 持久化，拥有状态、上下文、agent loop orchestration、REST APIs、WebSocket events、approvals 与 policy。
- C 端：本地低频更新 daemon，拥有用户本地模型/API keys，向 S 注册并维持 heartbeat，接收执行请求，在风险审批通过后执行本地或外部操作，并流式回传日志和结果。

C 端不是独立 agent 产品，也不是策略决策方。所有影响产品行为的状态归属、上下文构建、审批判断、策略裁决与任务编排均由 S 端负责。

## 2. 设计原则

- **Local executor only**：C 端只执行 S 端下发且通过审批链路的 `ExecutionRequest`。
- **S owns state**：长期任务状态、上下文、会话、审批记录、agent loop 状态与审计日志由 S 端持久化。
- **Least privilege by capability**：C 端按注册的 capability 集合暴露本机能力，并在每次执行前应用本地最小权限约束。
- **No product policy decisions**：C 端可以做安全边界校验和本地环境约束，但不能自行决定产品策略、审批豁免、上下文取舍或任务优先级。
- **User-controlled credentials**：用户模型/API keys 优先保存在本地安全存储中，C 端只使用，不上传明文。
- **Observable execution**：每次执行都有稳定的 `executionId`，关键阶段、日志、产物、错误与重试都以事件形式回传 S 端。
- **Low-frequency updates**：C 端协议必须向后兼容，避免要求用户频繁升级本地 daemon。

## 3. 职责

C 端必须承担以下职责：

1. **本地身份与注册**
   - 保存 `clientId`、`installationId`、设备指纹摘要与连接令牌。
   - 通过 `ClientRegisterRequest` 向 S 注册本地 daemon。
   - 在重新安装、用户切换或设备迁移时支持重新绑定。

2. **连接维护**
   - 与 S 建立受认证的长连接通道。
   - 定期发送 `HeartbeatEvent`，报告版本、在线状态、capabilities、当前执行负载与本地健康状态。
   - 接收 S 端的执行、取消、配置刷新、探活与凭据检查请求。

3. **本地凭据管理**
   - 保存并读取用户配置的模型/API keys、provider endpoints、本地工具凭据。
   - 对外只暴露 `CredentialRef`、可用性状态和脱敏摘要。
   - 在执行请求中按 `credentialRef` 注入对应本地凭据。

4. **执行模型/API 请求**
   - 根据 S 下发的 `ExecutionRequestPayload.kind = model.invoke` 或 `api.call` 调用本地配置的 provider。
   - 支持 token usage、stream chunks、provider error、rate limit 等结构化回传。
   - 不缓存或改写 S 构建的 prompt/context，除非请求显式要求本地读取文件内容作为工具输入。

5. **执行本地工具**
   - 在本地 workspace 内执行文件、Git、shell、进程、网络或扩展工具操作。
   - 对每个工具调用执行路径、权限、风险等级与审批凭证校验。
   - 把 stdout/stderr、diff、artifact、exit code 和副作用摘要回传给 S。

6. **风险与审批执行**
   - 按 S 决策的 `RiskTier` 与 `ApprovalGrant` 执行或拒绝操作。
   - 对高风险操作做本地二次边界校验，例如路径越界、命令超出 allowlist、凭据明文外传等。
   - 对缺失、过期或不匹配审批的请求返回 `ExecutionRejectedEvent`。

7. **失败处理与离线恢复**
   - 对可重试连接失败、provider 限流、临时 IO 错误执行有限重试。
   - 在网络中断时缓存未确认的事件 envelope，并在恢复后按序补发。
   - 对已经开始的本地执行应用明确的取消、暂停或完成语义。

8. **审计与诊断**
   - 本地保留有限窗口的诊断日志，不保存完整敏感上下文。
   - 为每次执行生成可关联的 `correlationId`、`spanId`、`executionId`。
   - 支持用户导出脱敏诊断包。

## 4. 非目标

C 端明确不负责：

- 不拥有会话、任务、agent loop、审批、policy 或上下文的最终状态。
- 不直接向 B 端提供业务 API。
- 不决定是否需要用户审批，不修改 S 下发的 `RiskTier`。
- 不在本地长期保存完整会话上下文、agent 记忆或产品审计日志。
- 不把本地模型/API key 明文上传给 S。
- 不在 S 未授权时主动执行本地文件、Git、shell 或网络副作用操作。
- 不提供多用户组织管理、计费、团队权限或共享策略。
- 不承担通用远程桌面、远程 shell 或设备管理职责。
- 不通过自动更新绕过用户同意安装新二进制或新 capability。

## 5. 核心对象与稳定标识符

以下英文标识符用于协议、日志和跨端引用，文档正文可使用中文解释。

### 5.1 Identity

- `clientId`：S 端分配给用户本地 daemon 的稳定 ID。
- `installationId`：本机安装实例 ID，重新安装后可变化。
- `deviceId`：本机设备摘要 ID，不应包含可逆硬件序列号。
- `userId`：S 端用户 ID。
- `sessionId`：S 端会话 ID。
- `runId`：S 端 `AgentRun` ID。
- `executionId`：一次 C 端执行请求的唯一 ID。
- `approvalId`：一次审批记录的唯一 ID。
- `approvalGrantId`：审批通过后发给 C 端的执行授权 ID。
- `correlationId`：跨 B/S/C 的请求追踪 ID。

### 5.2 Capability

C 端用 `CapabilityDescriptor` 上报本地能力。稳定 `capabilityId` 包括：

- `model.invoke`：调用模型 provider。
- `api.call`：调用第三方 HTTP API。
- `file.read`：读取本地文件。
- `file.write`：写入或创建本地文件。
- `file.delete`：删除本地文件。
- `file.diff`：生成文件差异。
- `git.status`：读取 Git 状态。
- `git.diff`：读取 Git diff。
- `git.commit`：创建本地 commit。
- `git.branch`：创建、切换或删除分支。
- `git.remote`：执行 fetch、pull、push 等远程 Git 操作。
- `shell.exec`：执行本地 shell 命令。
- `process.spawn`：启动本地长进程。
- `tool.invoke`：调用已注册的本地扩展工具。
- `artifact.upload`：上传执行产物到 S 或 S 指定对象存储。
- `diagnostic.export`：导出脱敏诊断包。

每个 capability 必须声明：

- `capabilityId`
- `version`
- `defaultRiskTier`
- `supportedPlatforms`
- `workspaceScopes`
- `requiresCredential`
- `supportsStreaming`
- `supportsCancellation`
- `maxConcurrentExecutions`
- `localConstraints`

### 5.3 RiskTier

稳定风险等级沿用产品总纲中的用户可见 tier：

- `read`：只读操作，例如读取 Git status、读取允许目录内的小文件、查看 daemon version。
- `write`：本地可恢复写入，例如写 workspace 文件、生成 patch、创建本地 branch。
- `execute`：本地命令或进程执行，例如 shell、测试、构建、安装依赖。
- `network`：外部网络访问，例如模型调用、第三方 API 调用、下载依赖。
- `publish`：对外发布或远端状态变更，例如 `git push`、发布 skill、部署命令。
- `secret`：读取或使用敏感凭据，例如模型/API key、OAuth token、SSH key。

一个请求必须有主 `riskTier`，并可附加 `riskTags` 表示复合风险。例如使用本地 key 调用模型的主 tier 是 `network`，同时带有 `secret` tag。C 端不能降低 S 下发的风险等级或删除 `riskTags`。C 端可以因本地规则把执行拒绝为 `localPolicyDenied`，但不能把 `publish` 当作 `write` 执行。

## 6. Daemon 生命周期

### 6.1 安装与首次启动

1. 用户安装 C 端 daemon。
2. daemon 生成 `installationId`，初始化本地配置目录和安全存储。
3. 用户通过 B/S 端发起设备绑定，S 生成短期 `PairingCode` 或 `DeviceLinkToken`。
4. daemon 使用绑定令牌发送 `ClientRegisterRequest`。
5. S 返回 `ClientRegisterResponse`，包含 `clientId`、连接地址、协议版本范围和短期连接凭证。
6. daemon 上报 `CapabilityInventoryEvent` 与首次 `HeartbeatEvent`。

首次注册不得要求用户把模型/API key 上传到 S。若某 capability 需要本地 key，daemon 只报告 `credentialStatus`。

### 6.2 常驻运行

daemon 以用户级后台服务运行，不要求管理员权限作为默认模式。常驻状态包括：

- `daemon.starting`
- `daemon.unpaired`
- `daemon.connecting`
- `daemon.online`
- `daemon.degraded`
- `daemon.offline`
- `daemon.updating`
- `daemon.stopping`

状态变化通过 `DaemonStatusEvent` 回传 S。`daemon.degraded` 表示 daemon 仍在线，但部分 capability 不可用，例如 keychain 访问失败、Git 不可用或 workspace 路径丢失。

### 6.3 心跳与健康检查

daemon 按 S 指定的 `heartbeatIntervalMs` 发送 `HeartbeatEvent`。事件至少包含：

- `clientId`
- `daemonVersion`
- `protocolVersion`
- `status`
- `capabilityDigest`
- `activeExecutions`
- `queuedExecutions`
- `credentialHealthSummary`
- `workspaceHealthSummary`
- `lastAppliedConfigVersion`
- `observedAt`

S 可下发 `HealthCheckRequest`，daemon 返回 `HealthCheckResultEvent`，用于诊断连接、凭据、安全存储、workspace、Git、shell 和 provider 连通性。

### 6.4 配置刷新

S 通过 `ConfigUpdateRequest` 下发非敏感配置，例如：

- 支持的协议版本。
- heartbeat 间隔。
- 单机最大并发。
- capability enable/disable 开关。
- workspace scope 约束。
- 日志采样策略。
- provider routing 元数据。

C 端应用配置后发送 `ConfigAppliedEvent`。若配置不兼容，发送 `ConfigRejectedEvent`，并继续使用最后一个有效配置。

### 6.5 升级与兼容

C 端是低频更新组件，因此协议必须支持版本协商：

- C 上报 `protocolVersion` 与 `supportedProtocolRange`。
- S 不得下发 C 不支持的 required field 或 capability。
- 新字段默认 optional，旧 C 端忽略 unknown optional fields。
- 对安全相关的破坏性变更，S 应停止向旧 C 下发相关 capability，并提示用户升级。

## 7. 本地存储与 key 处理

### 7.1 存储分类

C 端本地存储分为四类：

1. **安全凭据存储**
   - 内容：模型/API keys、OAuth refresh token、本地工具密钥。
   - 建议介质：OS keychain、secret service、credential manager 或用户加密文件。
   - 协议引用：`CredentialRef`。

2. **运行配置存储**
   - 内容：`clientId`、`installationId`、S 连接地址、协议版本、workspace scope、用户偏好。
   - 不包含明文 key。

3. **执行缓冲存储**
   - 内容：离线待补发事件、未确认 chunk、短期 artifact manifest。
   - 有大小上限和 TTL。

4. **诊断日志存储**
   - 内容：daemon lifecycle、错误码、correlationId、脱敏摘要。
   - 默认不记录 prompt 全文、文件全文、API response 全文或 key。

### 7.2 CredentialRef

`CredentialRef` 是 C 端对本地凭据的稳定引用，不包含密钥明文。

字段：

- `credentialRefId`
- `providerId`
- `credentialType`
- `displayName`
- `fingerprint`
- `createdAt`
- `updatedAt`
- `lastValidatedAt`
- `status`

`fingerprint` 只能是不可逆摘要或 provider 返回的脱敏尾号，例如 `sk-...abcd`。C 端向 S 报告 `CredentialInventoryEvent` 时只能包含 `CredentialRef` 和健康状态。

### 7.3 key 使用规则

- C 端只能在执行相关 provider/API/tool 时读取 key。
- key 不得写入普通日志、事件 payload、crash dump 或 artifact。
- 若 provider SDK 抛出包含 key 的错误，C 端必须脱敏后再发送 `ExecutionFailedEvent`。
- 用户删除 key 后，C 端发送 `CredentialRemovedEvent`，后续引用该 key 的执行必须失败为 `credentialMissing`。
- key 轮换不改变 S 端任务状态，只改变本地 `credentialRefId` 或其 `fingerprint`。

### 7.4 本地 workspace scope

每个 C 端必须维护本地 `WorkspaceScope`：

- `workspaceId`
- `rootPath`
- `allowedPaths`
- `deniedPaths`
- `maxFileReadBytes`
- `maxFileWriteBytes`
- `allowShell`
- `allowNetwork`
- `allowGitRemote`
- `environmentPolicy`

文件与 shell 操作必须限制在对应 scope 内。路径解析必须处理 symlink、相对路径、大小写差异和平台路径分隔符，避免越权访问。

## 8. S 连接协议

### 8.1 传输通道

推荐通道为 S 发起控制的 WebSocket 或等价长连接：

- C 主动连接 S。
- 连接使用 TLS。
- 每个 message 使用 `Envelope` 包装。
- 支持 request/response 与 event streaming。
- 支持断线重连与 resume token。

C 端不需要开放公网监听端口。若未来支持局域网桥接，必须作为单独 capability 和审批策略设计。

### 8.2 Envelope

所有 S/C 消息使用总纲定义的 `EventEnvelope`，字段与 B/S WebSocket 保持兼容：

- `eventId`
- `type`
- `schemaVersion`
- `direction`
- `occurredAt`
- `workspaceId`
- `agentId`
- `branchId`
- `runId`
- `clientId`
- `userId`
- `daemonSessionId`
- `executionId`
- `streamId`
- `sequence`
- `correlationId`
- `causationId`
- `idempotencyKey`
- `payload`

`direction` 取值：

- `s2c`
- `c2s`

`type` 必须使用稳定 `domain.event` 英文标识，例如 `execution.requested`、`execution.completed`。

### 8.3 认证与会话

连接认证流程：

1. C 使用注册时获得的连接凭证发起 `ClientConnectRequest`。
2. S 校验凭证、用户、client 状态和协议版本。
3. S 返回 `ClientConnectResponse`，包含 `connectionId`、`resumeToken`、heartbeat 参数和 server time。
4. C 发送 `CapabilityInventoryEvent` 与 `HeartbeatEvent`。

连接凭证必须可轮换、可吊销、短期有效。长期绑定材料保存在本地安全存储中，不应在普通配置文件中明文保存。

### 8.4 顺序与幂等

- `ExecutionRequest` 以 `executionId` 幂等。
- 事件以 `eventId` 去重。
- chunk 类事件使用 envelope 的 `streamId + sequence` 保序。
- C 端重连后使用 `resumeToken` 和最后确认的 `eventId` 或 `streamId + sequence` 请求恢复。
- S 对重复的完成事件应按同一 `executionId` 合并，不创建重复任务结果。

## 9. 模型/API 请求流程

### 9.1 模型调用

模型请求由 S 下发 `ExecutionRequestPayload`，其中 `kind = model.invoke`。C 端执行步骤：

1. 校验 `executionId` 未处理或可恢复。
2. 校验 `capabilityId = model.invoke` 已启用。
3. 校验 `credentialRef` 存在且状态可用。
4. 校验 `RiskTier` 与 `ApprovalGrant`。
5. 构造 provider 请求。
6. 调用 provider 并通过 `execution.output` 发送 `ModelStreamChunkEventPayload`。
7. 完成后发送 `execution.completed`，payload 中包含 `resultKind = model.invoke`、usage 和 provider request id。

C 端不得自行增删 system prompt、开发者指令、工具定义或上下文片段。若 provider 对 payload 有限制，C 端应返回结构化错误，例如 `providerContextTooLarge`，由 S 决定如何压缩或重试。

### 9.2 API 调用

API 请求由 S 下发 `ExecutionRequestPayload`，其中 `kind = api.call`。C 端执行步骤：

1. 校验 `capabilityId = api.call`。
2. 校验目标域名、方法、headers 与 body 是否符合本地 `NetworkPolicy`。
3. 注入 `credentialRef` 对应凭据。
4. 发送请求。
5. 回传 `execution.completed`，payload 中包含 `resultKind = api.call`、status、headers allowlist、body 摘要或完整 body 的受控片段。

API response 可能包含敏感信息。C 端必须按 S 下发的 `responseCapturePolicy` 决定回传级别：

- `capture.none`
- `capture.metadata`
- `capture.summary`
- `capture.body`

若 `responseCapturePolicy` 与本地安全策略冲突，C 端应拒绝执行或降级回传，并发送 `LocalPolicyNoticeEvent`。

### 9.3 费用与限流

涉及模型或付费 API 的请求主风险至少为 `network`。若使用本地凭据，必须带有 `secret` risk tag。C 端必须回传：

- `providerId`
- `modelId`
- `requestUnits`
- `responseUnits`
- `estimatedCost`
- `rateLimitState`
- `providerRequestId`

C 端只报告观测到的费用/用量，不决定预算策略。预算、配额与是否继续由 S 端决定。

## 10. 本地工具 capability 模型

### 10.1 CapabilityDescriptor

每个 capability 上报为 `CapabilityDescriptor`：

- `capabilityId`
- `displayName`
- `description`
- `version`
- `defaultRiskTier`
- `maxRiskTier`
- `inputSchemaRef`
- `outputSchemaRef`
- `platforms`
- `workspaceRequired`
- `credentialRequired`
- `networkRequired`
- `sideEffectTypes`
- `streamingModes`
- `cancellationMode`
- `limits`

`sideEffectTypes` 取值包括：

- `sideEffect.none`
- `sideEffect.localRead`
- `sideEffect.localWrite`
- `sideEffect.localDelete`
- `sideEffect.process`
- `sideEffect.networkRead`
- `sideEffect.networkWrite`
- `sideEffect.externalMutation`
- `sideEffect.cost`

### 10.2 文件操作

文件 capability 包括 `file.read`、`file.write`、`file.delete`、`file.diff`。

约束：

- 所有路径必须落在 `WorkspaceScope` 允许范围内。
- `file.read` 默认只读文本或小型二进制摘要；大文件需要 S 明确 `readMode`。
- `file.write` 必须携带 expected base hash 或 overwrite policy。
- `file.delete` 至少为 `write`，批量删除或目录删除应提升为 `execute` 或 `publish`，由 S 根据影响范围决定。
- `file.diff` 不产生副作用，可用于审批前预览。

### 10.3 Git 操作

Git capability 包括 `git.status`、`git.diff`、`git.commit`、`git.branch`、`git.remote`。

约束：

- `git.status` 和 `git.diff` 是只读能力。
- `git.commit` 必须包含 author policy、message、included paths 和 diff hash。
- `git.branch` 修改本地仓库状态，至少为 `write`。
- `git.remote` 涉及外部副作用，`push` 必须为 `publish`。
- C 端不得自动执行 `git reset --hard`、force push 或清理未跟踪文件，除非 S 下发明确请求且审批授权匹配。

### 10.4 Shell 与进程

`shell.exec` 与 `process.spawn` 是高风险能力。

约束：

- 默认禁用，用户必须在本地配置或 S policy 中显式启用。
- 每次执行必须包含命令、参数、cwd、环境变量策略、超时、输出捕获策略。
- C 端必须避免通过字符串拼接生成 shell 命令；协议应区分 `command` 与 `args`。
- 环境变量默认使用 allowlist，不继承全部用户环境。
- 输出必须支持流式回传、截断和脱敏。
- 长进程必须支持 `CancelExecutionRequest`。

### 10.5 扩展工具

`tool.invoke` 用于本地扩展工具。扩展工具必须先注册为 `ToolDescriptor`：

- `toolId`
- `toolVersion`
- `capabilityId`
- `inputSchema`
- `outputSchema`
- `defaultRiskTier`
- `declaredSideEffects`
- `binaryPath` 或 `runtime`
- `publisher`
- `checksum`

C 端不得执行未注册、checksum 不匹配或超出声明 side effects 的扩展工具。

## 11. 风险等级与审批执行

### 11.1 审批来源

S 端负责根据上下文、用户策略、组织策略、tool metadata 和请求内容决定：

- `RiskTier`
- 是否需要审批。
- 审批展示内容。
- 审批人和审批范围。
- 审批有效期。
- 是否允许自动批准。

C 端只验证 S 下发的 `ApprovalGrant` 是否与当前执行匹配。

### 11.2 ApprovalGrant

`ApprovalGrant` 字段：

- `approvalGrantId`
- `approvalId`
- `executionId`
- `capabilityId`
- `riskTier`
- `approvedBy`
- `approvedAt`
- `expiresAt`
- `scope`
- `requestDigest`
- `constraints`
- `signature`

`requestDigest` 必须覆盖会产生副作用的关键字段，例如路径、命令、URL、Git remote、diff hash、provider、模型 ID 和费用上限。C 端执行前重新计算 digest，不匹配则拒绝。

### 11.3 本地执行门禁

执行前 C 端按顺序检查：

1. `clientId` 与当前连接匹配。
2. `executionId` 未完成或允许恢复。
3. capability 存在且启用。
4. `RiskTier` 满足 capability 的 `defaultRiskTier`、`maxRiskTier` 和 `riskTags` 要求。
5. 需要审批时存在有效 `ApprovalGrant`。
6. `ApprovalGrant.requestDigest` 与请求匹配。
7. workspace、路径、网络、环境变量、本地 key 策略通过。
8. 并发、大小、超时和速率限制通过。

任何失败都必须发送 `ExecutionRejectedEvent`，并包含稳定 `rejectionCode`：

- `approvalMissing`
- `approvalExpired`
- `approvalScopeMismatch`
- `requestDigestMismatch`
- `capabilityDisabled`
- `capabilityUnsupported`
- `credentialMissing`
- `workspaceDenied`
- `networkDenied`
- `localPolicyDenied`
- `concurrencyLimitExceeded`

### 11.4 审批后变更

审批通过后，若请求的副作用字段发生变化，C 端不得复用原审批。典型例子：

- 写入路径变化。
- shell 参数变化。
- Git diff hash 变化。
- API URL 或 HTTP method 变化。
- 模型 provider 或费用上限变化。

此时 C 端必须拒绝并要求 S 重新发起审批。

## 12. 失败、重试与离线行为

### 12.1 错误分类

C 端错误使用稳定 `errorCode`：

- `connectionLost`
- `serverUnavailable`
- `protocolVersionUnsupported`
- `authenticationFailed`
- `credentialMissing`
- `credentialInvalid`
- `providerRateLimited`
- `providerUnavailable`
- `providerRejected`
- `workspaceNotFound`
- `pathDenied`
- `fileConflict`
- `gitConflict`
- `commandFailed`
- `commandTimedOut`
- `toolCrashed`
- `localPolicyDenied`
- `userCancelled`
- `daemonShuttingDown`
- `unknownError`

错误必须区分：

- `retryable`
- `nonRetryable`
- `requiresUserAction`
- `requiresUpgrade`
- `requiresReapproval`

### 12.2 重试策略

C 端只对明确可重试的阶段做本地重试：

- S 连接断开：指数退避重连。
- 事件 ack 丢失：按 `eventId` 幂等重发。
- provider 临时网络错误：在请求允许时有限重试。
- artifact 上传失败：保留 manifest 并后台补传。

C 端不得对有副作用且不具备幂等键的操作自动重试，例如文件追加、shell 命令、Git push、外部 POST mutation。

### 12.3 离线缓存

离线时 C 端可缓存：

- 已执行但未被 S ack 的事件。
- 执行日志 chunk。
- artifact manifest。
- 本地最终状态摘要。

离线时 C 端不得接收新的 S 任务。若执行中断线：

- 对可继续的模型/API stream，C 端继续执行并缓存结果，直到达到本地缓存上限。
- 对高风险 shell/Git 操作，C 端按请求的 `offlineExecutionPolicy` 决定继续、取消或等待。
- 缓存超过上限时，C 端发送 `ExecutionOutputTruncatedEvent` 并保留最终状态。

### 12.4 取消与超时

S 可发送 `CancelExecutionRequest`。C 端应：

1. 发送 `ExecutionCancellingEvent`。
2. 尝试取消 provider request、终止进程或停止工具。
3. 回传 `ExecutionCancelledEvent` 或 `ExecutionCancelFailedEvent`。

若本地超时触发，C 端发送 `ExecutionFailedEvent`，`errorCode = commandTimedOut` 或对应超时错误。

## 13. 事件与 payload

### 13.1 S -> C 消息

WebSocket envelope 的 `type` 使用总纲约定的 `domain.event` 命名；payload type 使用 PascalCase，便于生成类型定义。

| event type | payload type | 用途 |
| --- | --- | --- |
| `client.connect.accepted` | `ClientConnectResponsePayload` | 完成连接握手 |
| `daemon.config.update_requested` | `ConfigUpdateRequestPayload` | 下发非敏感配置 |
| `daemon.health.check_requested` | `HealthCheckRequestPayload` | 请求本地健康检查 |
| `execution.requested` | `ExecutionRequestPayload` | 请求执行 capability |
| `execution.cancel_requested` | `CancelExecutionRequestPayload` | 取消执行 |
| `credential.check_requested` | `CredentialCheckRequestPayload` | 检查本地 key 可用性 |
| `artifact.upload_requested` | `ArtifactUploadRequestPayload` | 请求补传产物 |

### 13.2 C -> S 事件

| event type | payload type | 用途 |
| --- | --- | --- |
| `client.register.requested` | `ClientRegisterRequestPayload` | 注册本地 daemon |
| `client.connect.requested` | `ClientConnectRequestPayload` | 建立连接 |
| `daemon.status.changed` | `DaemonStatusEventPayload` | daemon 状态变化 |
| `client.heartbeat` | `HeartbeatEventPayload` | 心跳 |
| `daemon.capabilities.reported` | `CapabilityInventoryEventPayload` | 上报能力清单 |
| `daemon.credentials.reported` | `CredentialInventoryEventPayload` | 上报凭据引用清单 |
| `credential.status.changed` | `CredentialStatusEventPayload` | 上报凭据状态变化 |
| `daemon.config.applied` | `ConfigAppliedEventPayload` | 配置应用成功 |
| `daemon.config.rejected` | `ConfigRejectedEventPayload` | 配置应用失败 |
| `daemon.health.checked` | `HealthCheckResultEventPayload` | 健康检查结果 |
| `execution.accepted` | `ExecutionAcceptedEventPayload` | 请求通过本地门禁 |
| `execution.rejected` | `ExecutionRejectedEventPayload` | 请求被本地拒绝 |
| `execution.started` | `ExecutionStartedEventPayload` | 执行开始 |
| `execution.output` | `ExecutionLogEventPayload`, `ExecutionProgressEventPayload`, `ModelStreamChunkEventPayload` | 执行日志、进度或模型流式输出 |
| `execution.progressed` | `ExecutionProgressEventPayload` | 执行进度 |
| `file.diff.created` | `FileDiffEventPayload` | 文件 diff |
| `artifact.created` | `ArtifactCreatedEventPayload` | 本地产物创建 |
| `artifact.uploaded` | `ArtifactUploadedEventPayload` | 产物上传完成 |
| `execution.output_truncated` | `ExecutionOutputTruncatedEventPayload` | 输出被截断 |
| `execution.completed` | `ExecutionCompletedEventPayload` | 执行成功完成；`resultKind` 区分 `model.invoke`, `api.call`, `tool.invoke`, `file.write`, `git.*` 等结果 |
| `execution.failed` | `ExecutionFailedEventPayload` | 执行失败 |
| `execution.cancelling` | `ExecutionCancellingEventPayload` | 正在取消 |
| `execution.cancelled` | `ExecutionCancelledEventPayload` | 已取消 |
| `execution.cancel_failed` | `ExecutionCancelFailedEventPayload` | 取消失败 |
| `daemon.local_policy.noticed` | `LocalPolicyNoticeEventPayload` | 本地策略降级或提醒 |

### 13.3 ExecutionRequestPayload

通用执行请求字段：

- `executionId`
- `capabilityId`
- `riskTier`
- `riskTags`
- `approvalGrant`
- `workspaceId`
- `workingDirectory`
- `input`
- `limits`
- `streaming`
- `timeoutMs`
- `offlineExecutionPolicy`
- `idempotencyKey`
- `requestedAt`

`input` 的 schema 由 `capabilityId` 决定。C 端必须按 capability 的 `inputSchemaRef` 校验输入。

### 13.4 Execution result payload

完成事件至少包含：

- `executionId`
- `capabilityId`
- `status`
- `startedAt`
- `completedAt`
- `durationMs`
- `outputSummary`
- `artifactRefs`
- `usage`
- `sideEffectSummary`
- `warnings`

失败事件至少包含：

- `executionId`
- `capabilityId`
- `status`
- `errorCode`
- `errorMessage`
- `retryable`
- `requiresUserAction`
- `requiresReapproval`
- `sanitizedDetails`
- `lastSequenceNumber`

## 14. 安全边界

### 14.1 S/C 责任边界

S 端负责：

- 用户身份、组织权限和会话状态。
- agent loop 和任务编排。
- 上下文组装和 prompt 生成。
- 风险评估和审批策略。
- 审计日志和最终状态持久化。
- B 端 REST/WebSocket API。

C 端负责：

- 本地凭据保护。
- 本机 capability 暴露和执行。
- 本地 workspace 边界校验。
- 对 S 下发审批授权的机械验证。
- 执行日志、结果和错误回传。

### 14.2 本地安全边界

C 端必须防护：

- 路径穿越和 symlink 越界。
- 未授权读取用户目录、SSH key、浏览器数据、系统凭据。
- 环境变量泄漏。
- shell 注入和参数混淆。
- 未审批的网络外发。
- provider 错误信息中的 key 泄漏。
- 扩展工具二进制被替换。
- 本地缓存无限增长。

### 14.3 明文与脱敏

以下内容不得明文出现在 C -> S 事件中，除非用户在审批中明确允许且 S 请求指定捕获：

- 模型/API key。
- OAuth refresh token。
- SSH private key。
- `.env` 文件全文。
- 浏览器 cookie。
- 系统 credential store 内容。
- 未被任务引用的本地私有文件内容。

脱敏字段应使用 `redactionReason` 标明原因，例如：

- `secretPatternMatched`
- `credentialStoreContent`
- `pathOutsideWorkspace`
- `localPolicyRestricted`
- `capturePolicyMetadataOnly`

### 14.4 供应链与扩展

- C 端二进制应可验证版本和签名。
- 扩展工具必须声明 publisher、checksum、capability 和 side effects。
- C 端升级不得默认启用新增高风险 capability。
- 插件或扩展工具不能绕过统一的 `ExecutionRequest`、`RiskTier` 和 `ApprovalGrant`。

## 15. 可观测性与审计

C 端可观测性输出分为本地诊断和 S 端事件。

本地诊断：

- daemon start/stop。
- 连接状态。
- 协议版本协商。
- capability 加载失败。
- keychain 访问失败。
- 本地策略拒绝。

S 端事件：

- 所有 execution lifecycle。
- 用户可见日志。
- artifact manifest。
- 结构化错误。
- 脱敏后的 provider usage。

C 端不得把完整本地诊断日志当作默认事件上传。用户触发 `diagnostic.export` 时，应生成脱敏包并通过审批流上传。

## 16. 性能与资源约束

C 端默认资源策略：

- 低常驻 CPU 与内存占用。
- 空闲时只保持连接、心跳和少量 watcher。
- 执行并发由 `maxConcurrentExecutions` 和 S 配置共同限制。
- 单次日志 chunk、artifact、模型 stream 均有大小上限。
- 大文件读取、二进制 artifact 上传和长进程执行需要显式 limits。

资源限制字段：

- `timeoutMs`
- `maxOutputBytes`
- `maxFileBytes`
- `maxArtifactBytes`
- `maxNetworkBytes`
- `maxCost`
- `maxRetries`
- `maxConcurrency`

超过限制时，C 端必须优先停止继续产生副作用，并发送结构化失败或截断事件。

## 17. 验收场景

### 17.1 首次注册成功

前置条件：用户已安装 C 端，并在 B/S 端生成绑定令牌。

期望：

- C 端发送 `ClientRegisterRequest`。
- S 返回 `clientId` 和连接参数。
- C 端发送 `CapabilityInventoryEvent`、`CredentialInventoryEvent` 和 `HeartbeatEvent`。
- S 能在 B 端显示 C 端为 online。
- 没有任何模型/API key 明文上传到 S。

### 17.2 模型调用使用本地 key

前置条件：用户本地保存了 `CredentialRef`，S 下发 `ExecutionRequestPayload(kind=model.invoke)`。

期望：

- C 端验证 `credentialRef` 和 `ApprovalGrant`。
- C 端调用 provider。
- C 端通过 `execution.output` 发送 `ModelStreamChunkEventPayload`。
- C 端发送 `execution.completed`，包含 `resultKind = model.invoke`、usage 和 provider request id。
- C 端不修改 S 下发的 prompt/context。

### 17.3 低风险只读 Git 状态

前置条件：S 下发 `ExecutionRequest`，`capabilityId = git.status`，`riskTier = read`。

期望：

- C 端验证 workspace 在允许范围内。
- C 端执行只读 Git status。
- C 端发送 `execution.completed`。
- 不要求写入审批。

### 17.4 写文件需要匹配审批

前置条件：S 下发 `file.write` 请求，包含 `ApprovalGrant` 和 expected base hash。

期望：

- C 端重新计算 `requestDigest`。
- digest 匹配时执行写入并发送 `file.diff.created` 与 `execution.completed`。
- digest 不匹配时发送 `ExecutionRejectedEvent`，`rejectionCode = requestDigestMismatch`。
- 若目标路径越出 workspace，发送 `ExecutionRejectedEvent`，`rejectionCode = workspaceDenied`。

### 17.5 shell 命令被本地策略拒绝

前置条件：S 下发 `shell.exec`，但本地 `WorkspaceScope.allowShell = false`。

期望：

- C 端不执行命令。
- C 端发送 `ExecutionRejectedEvent`。
- `rejectionCode = localPolicyDenied` 或 `capabilityDisabled`。
- S 保留审批记录和拒绝原因，B 端可展示给用户。

### 17.6 Git push 必须 publish 审批

前置条件：S 下发 `git.remote` push 请求。

期望：

- 请求风险为 `publish`。
- `ApprovalGrant.requestDigest` 覆盖 remote、branch、commit range 和 push mode。
- C 端验证授权后才执行。
- force push 或 remote 变化必须触发 `requestDigestMismatch` 或重新审批。

### 17.7 执行中断线后恢复

前置条件：模型 stream 或 artifact 上传过程中 S 连接断开。

期望：

- C 端进入 `daemon.offline` 或 `daemon.degraded`。
- C 端缓存未 ack 的事件和 chunk。
- 重连后使用 `resumeToken` 恢复。
- S 通过 `eventId` 和 `streamId + sequence` 去重并补齐事件。
- 用户在 B 端看到连续的执行状态。

### 17.8 provider key 失效

前置条件：`credentialRef` 对应 key 已被 provider 拒绝。

期望：

- C 端发送 `ExecutionFailedEvent`，`errorCode = credentialInvalid`。
- C 端发送 `CredentialStatusEvent`，状态为 unavailable。
- 错误详情脱敏，不包含 key。
- S 提示用户在本地更新凭据。

### 17.9 用户取消长进程

前置条件：S 已下发 `process.spawn`，随后发送 `CancelExecutionRequest`。

期望：

- C 端发送 `ExecutionCancellingEvent`。
- C 端尝试终止本地进程。
- 成功时发送 `ExecutionCancelledEvent`。
- 失败时发送 `ExecutionCancelFailedEvent`，包含脱敏原因。

### 17.10 离线缓存超限

前置条件：S 长时间不可达，C 端执行输出超过本地缓存上限。

期望：

- C 端停止缓存更多输出 chunk。
- C 端保留最终状态和截断摘要。
- 重连后发送 `ExecutionOutputTruncatedEvent`。
- S 不把缺失 chunk 误判为执行成功完整输出。

## 18. 未来扩展边界

以下能力不属于第一版 C 端职责。若未来引入，必须以独立 capability、风险等级和审批策略进入协议，不能隐式扩大现有 daemon 权限：

- 多个 S environment 同时绑定。
- team-managed policy 下发到 C 的本地强制约束。
- 用户自托管 S。
- 局域网内 broker 或本地 browser 直连 C。
- 第三方扩展工具 marketplace。
- 本地模型运行时作为 `model.invoke` provider。

这些能力若引入，仍必须遵守 S owns state、C local executor、capability/risk/approval 统一模型。
