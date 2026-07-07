# brainx Agent Core 规格

本文固化 brainx 的 agent 核心工作机制。它优先采用 `docs/brainx/AI Agent解析.md` 中确认的新核心设计；当本文与现有 `product-api-overview.md`、`server-spec.md`、`client-daemon-spec.md` 冲突时，以本文作为后续实现和文档同步的优先事实源。

本文暂不展开 B/S/C API、页面交互和三端协议细节，只定义后端与客户端服务必须支撑的 agent runtime 行为。

## 1. 核心目标

brainx 不是固定流程聊天机器人，而是面向项目工作的 agent runtime。它需要理解工作区、维护上下文、调用工具、执行任务、验证结果、沉淀 skill，并允许用户通过分支化 agent 状态并行探索多个方向。

核心原则：

- 主 Agent 统一面向用户，负责理解目标、规划、执行、委派、汇总和最终回复。
- 子 Agent 是当前分支内的动态执行实例，不是硬编码角色。
- Branch Agent 是用户显式创建的隔离运行环境，不由主 Agent 随意 fork。
- 工具保持少量、正交、可审计，通过参数表达差异，通过策略表达风险。
- Skill 更新采用 proposal-first，不允许 agent 无限制自我污染正式 skill。
- 分支合并不是代码合并，而是对上下文、产物、决策、发现、todo、skill proposal 等进度单元的选择性采纳。

## 2. 分层状态模型

agent core 按以下层次理解：

```text
User Space
  用户选择当前 agent/branch，创建分支，批准高风险动作，确认合并与 skill 发布。

Branch Runtime
  每个 branch 拥有隔离 workspace、上下文、todo、notes、terminal sessions、tool history、skill proposals。

Agent Runtime
  每个 branch 内运行自己的主 Agent。主 Agent 可以按任务创建临时子 Agent。

Tool Runtime
  工具调用受当前 branch、workspace scope、权限策略和审批结果约束。

Merge Runtime
  生成 branch capsule，比较产物，准备合并提案，处理冲突，应用用户选择项。

Skill Runtime
  搜索、读取、生成 proposal、审核、发布和版本化 Markdown skill。
```

S 端最终应维护长期状态、策略、上下文引用、事件和审计。C 端执行模型/API/本地工具请求并保护本地密钥。B 端只负责控制、观察和审批。

## 3. Agent 执行循环

主 Agent 的基础 loop：

1. 接收用户目标。
2. 更新 todo 和 run 状态。
3. 获取环境、workspace 和当前 branch 概况。
4. 搜索或读取必要上下文，不把整个项目塞进 prompt。
5. 制定局部执行计划。
6. 判断任务是否需要动态子 Agent。
7. 调用工具或创建子 Agent 执行受限任务。
8. 汇总工具和子 Agent 结果。
9. 修改或生成产物。
10. 运行测试、构建、类型检查、浏览器验证或其他可证据化验证。
11. 查看 diff、日志和结果证据。
12. 必要时修复问题并重复验证。
13. 任务结束后进行 skill reflection。
14. 向用户报告完成内容、验证证据和剩余风险。

loop 必须以证据驱动完成判断。不能只依赖模型自信断言任务已完成。

## 4. 动态子 Agent

子 Agent 是一次独立 agent 执行实例，服务于当前 branch 内的主 Agent。系统不内置 `frontend-agent`、`backend-agent`、`reviewer-agent` 等固定角色；这些只能作为运行时生成的任务说明。

创建子 Agent 时必须指定：

- `task`：具体子任务。
- `context`：完成该任务所需的最小背景。
- `allowed_tools`：允许使用的工具。
- `allowed_paths`：允许读写的路径范围。
- `write_access`：是否允许写入。
- `budget`：最大时间、步骤、token 或工具调用数。
- `output_schema`：结构化返回契约。
- `success_criteria`：主 Agent 如何判断结果可用。

建议输出结构：

```json
{
  "status": "success | partial | failed",
  "summary": "what was done or found",
  "changed_files": [],
  "evidence": [],
  "risks": [],
  "next_actions": []
}
```

只有当子任务可隔离、可并行、上下文相对独立、需要不同权限边界或主 Agent 上下文压力过大时，才创建子 Agent。不要为了形式创建子 Agent。

## 5. 核心工具集合

第一版工具应保持精简：

```text
get_environment
read_files
search_workspace
apply_patch
write_file
run_command
ask_user
todo_update
background_start
background_read
background_stop
subagent_start
subagent_read
subagent_stop
```

工具合并规则：

- `get_environment` 返回 OS、arch、workspace root、默认 shell、当前时间/时区、当前模型名；不得返回 provider 或 base URL。
- `read_files` 统一处理单文件和多文件读取，单文件读取也使用 `files` 数组。
- `search_workspace` 通过 `mode` 区分 `filename`、`text`、`regex`。
- `run_command` 只面向一次性短命令；后台任务、watcher 和长期进程使用 `background_start/read/stop`。
- `ask_user` 由 B 端回答后作为标准 tool result 注入上下文。
- `todo_update` 是 S 端工具，用于维护当前 run 的 checklist，不下发 C。
- `background_start/read/stop` 是 C 端工具，用于长期进程启动、输出读取和停止。
- `subagent_start/read/stop` 是 S 端工具，用于当前 branch 内的受限子 agent 任务状态。
- 不暴露 `bash`、`powershell`、`cmd` 等平行工具；C 端按平台自动选择 shell，但 `run_command` v1 入参不提供 `shell`。
- `web_search`、`create_subagent`、`branch_action`、`skill_action`、`request_approval`、`check_policy` 暂缓或属于 S 端内部能力，不作为本批模型工具暴露。

v1 模型可见工具入参固定如下，禁止旧别名和额外字段：

| Tool | Required | Optional | Notes |
| --- | --- | --- | --- |
| `get_environment` | none | none | 参数必须是 `{}`。 |
| `read_files` | `files[]` | `files[].startLine`, `files[].endLine` | 每项必须有 `path`；不支持顶层 `path`、`paths` 或 `range`。 |
| `search_workspace` | `query` | `mode`, `maxResults` | `mode` 只能是 `text`、`filename`、`regex`；`maxResults >= 1`。 |
| `apply_patch` | `patch` | `dryRun` | `patch` 是 unified diff 字符串；不支持 `files`。 |
| `write_file` | `path`, `content`, `overwrite` | `createParents` | `overwrite` 必须显式传入；不支持 `mode` 或 `bytes`。 |
| `run_command` | `command` | `workingDirectory`, `timeoutSeconds` | 不支持 `cwd`、`timeout_ms` 或 `shell`；`timeoutSeconds` 范围 1-300。 |
| `ask_user` | `questions[]` | `questions[].allowOther`, `options[].description`, `options[].recommended` | S/B 端工具，不下发给 C 端执行。 |
| `todo_update` | `items[]` | `reason`, `items[].note` | S 端工具；每次提交完整 todo 列表，最多 20 项，同一时刻最多一个 `in_progress`。 |
| `background_start` | `name`, `command`, `purpose` | `workingDirectory`, `maxRuntimeSeconds` | C 端工具；启动长期后台命令，默认审批策略按执行类处理。 |
| `background_read` | `taskId` | `cursor`, `maxBytes` | C 端工具；增量读取后台任务输出。 |
| `background_stop` | `taskId` | `mode` | C 端工具；`mode` 为 `terminate` 或 `kill`。 |
| `subagent_start` | `task`, `context`, `allowedTools`, `allowedPaths`, `writeAccess`, `budget`, `successCriteria` | `outputSchema` | S 端工具；创建当前 run/branch 内的受限子 agent 任务。 |
| `subagent_read` | `subagentId` | `includeEvents` | S 端工具；读取子 agent 状态和结构化输出。 |
| `subagent_stop` | `subagentId`, `reason` | none | S 端工具；取消当前 run 下的子 agent。 |

所有工具返回结构化结果，至少包含：

```json
{
  "ok": true,
  "tool": "tool_name",
  "summary": "short result",
  "data": {},
  "warnings": [],
  "error": null,
  "duration_ms": 0
}
```

工具结果必须有输出预算。C 端应在原始结果处截断大文本，S 端在写入下一轮标准 `tool` message 前必须再次兜底截断。目录排除只能作为搜索降噪策略，不能替代长度限制。第一版预算原则：

- `search_workspace` 限制 `maxResults`、单条 `preview` 长度和总 preview 长度。
- `read_files` 限制单文件返回内容长度，并标记 `contentTruncated`。
- `run_command` 限制 `stdout`/`stderr`，并标记对应截断字段。
- `write_file`、`apply_patch` 限制 diff/stdout/stderr 等文本结果。
- `background_read` 限制单次读取字节数，即使模型请求更大的 `maxBytes` 也必须受系统硬上限约束。
- S 端若收到旧版 C 端或异常 C 端的大结果，必须把 tool message content 包装为截断摘要，保留 `toolResultTruncated` 与 `originalChars`。

## 6. 后台任务与持久终端边界

`run_command` 面向一次性命令；持续进程应拆为后台任务工具。后台任务用于：

- dev server。
- test watcher。
- backend worker。
- 持续日志观察。
- 多个后台进程并行运行。

当前后台任务工具支持：

```text
background_start
background_read
background_stop
```

后台任务归属于当前 workspace/client 执行上下文，不能跨 branch 混用。每个 task 必须可读取、可停止、可审计，并有最大输出、超时、脱敏和取消机制。创建长期进程、安装依赖、访问外网或暴露端口时必须经过 policy 检查。真正的交互式 REPL/PTY 终端不属于本批 v1 工具。

## 7. Branch Agent

Branch Agent 是用户显式创建的隔离运行环境，用于并行探索、试错、纯聊天推演或非代码项目工作。它不同于子 Agent：

| 类型 | 创建者 | 作用域 | 生命周期 | 工作区 |
| --- | --- | --- | --- | --- |
| 子 Agent | 当前主 Agent | 当前 branch 内的局部任务 | 短期 | 默认共享当前 branch 工作区 |
| Branch Agent | 用户显式创建 | 独立探索方向 | 可长期存在 | 与其他 branch 隔离 |

每个 branch 必须隔离：

- workspace snapshot 或 overlay。
- conversation/context summary。
- todo state。
- branch notes。
- tool call history。
- terminal sessions。
- workspace changes。
- skill proposals。

同一路径在不同 branch 中可以表示不同物理状态。例如两个 branch 都看到 `/workspace/project/src/app.ts`，但读写互不影响。底层可以使用 copy-on-write、overlay filesystem、临时目录快照、virtual workspace layer 或 git worktree；上层语义不得绑定 git。

`branch_action` 支持：

```text
create_branch
list_branches
open_branch
snapshot_branch
diff_branch
summarize_branch
prepare_merge
apply_merge
discard_branch
archive_branch
```

主 Agent 可以建议创建 branch，但实际创建需要用户确认。

## 8. Branch Capsule 与合并

第一版采用 context-first 的 `branch capsule` 合并机制，但不合并完整聊天历史，不自动吸收所有上下文。

branch capsule 是分支摘要和可采纳进度目录：

```json
{
  "branch_id": "branch_123",
  "branch_name": "experiment-new-auth-flow",
  "goal": "Explore a new authentication flow",
  "status": "partial",
  "summary": "Backend prototype works; frontend integration is incomplete.",
  "important_context": [],
  "decisions": [],
  "discoveries": [],
  "rejected_approaches": [],
  "changed_artifacts": [],
  "todo_delta": [],
  "skill_proposals": [],
  "validation": [],
  "risks": [],
  "open_questions": [],
  "merge_recommendation": {
    "context": "merge | ignore | review",
    "artifacts": "all | partial | none",
    "skills": "apply | review | ignore"
  }
}
```

合并流程：

1. source branch 生成 branch capsule。
2. target branch 读取 capsule 和必要 evidence。
3. target branch Agent 判断哪些上下文值得吸收。
4. 可复用信息进入 session notes、memory candidates 或 merge proposal。
5. target branch 再查看 artifacts/workspace diff。
6. 用户选择采纳 context、artifact、todo、skill proposal 或文件变更。
7. 高风险采纳走 policy/approval。
8. 合并完成后生成 merge report。

冲突类型不只包括文件冲突，还包括：

- 决策冲突。
- 目标冲突。
- 上下文或记忆冲突。
- skill 冲突。
- todo 冲突。
- 外部依赖冲突。
- 用户偏好冲突。

branch capsule 是候选信息，不是无条件事实。

## 9. Skill Runtime

第一版 skill 只支持单个 Markdown 文件加 YAML frontmatter。明确不支持：

- 脚本。
- 外部资源目录。
- 插件包。
- 可执行代码。
- 多文件 skill。

推荐格式：

```markdown
---
name: "debug-node-esm-import-error"
description: "Diagnose common Node.js ESM/CJS import errors in TypeScript projects."
triggers:
  - "ERR_REQUIRE_ESM"
  - "moduleResolution"
scope:
  project_types:
    - "node"
    - "typescript"
risk: "low"
version: 1
status: "active"
confidence: 0.72
last_updated: "2026-01-01"
source:
  type: "agent_learned"
  evidence_count: 3
---

# Skill

## When to use

Use this when a Node.js or TypeScript project shows ESM/CJS compatibility errors.

## Procedure

1. Inspect package.json type field.
2. Inspect tsconfig module and moduleResolution.
3. Check whether the dependency is ESM-only.

## Common pitfalls

- Do not blindly switch the whole project to ESM.

## Evidence

- Learned from repeated fixes in local Node projects.
```

`skill_action` 支持：

```text
search
read
propose_create
propose_update
apply_proposal
list_proposals
archive
```

Skill 作用域：

- `global`：跨项目通用经验。
- `project`：当前项目约定。
- `branch`：分支内待验证经验。
- `session_proposal`：当前任务产生、尚未确认的候选。

## 10. Skill 自我学习

第一版采用任务后反思优先，而不是只依赖 12 次提交阈值。

触发来源：

- 用户显式要求记住、总结或更新 skill。
- 非平凡任务完成后进行 reflection。
- 重复出现的错误、流程、项目结构或用户偏好。
- 用户纠正 Agent 后，且纠正内容有长期价值。
- 分支合并时，branch 产生 skill proposal。
- 失败任务产生 avoid/pitfall 类型经验。
- 每 12 次确认提交作为强触发条件保留，但不是唯一触发。

进入 skill reflection 的条件：

- 过程包含多步排查。
- 解决方案不明显。
- 遇到错误并修复。
- 发现项目特有约定。
- 形成可复用流程。
- 有工具验证或用户确认作为证据。
- 现有 skill 不完整、有误或缺失。

不得自动写入 skill 的内容：

- 一次性事实。
- 未验证猜测。
- 临时偏好。
- 密钥、token、私有 URL。
- 快速变化的外部资料。
- 无复用价值的普通步骤。
- 没有证据支持的总结。

写入流程：

1. Agent 完成任务并进入 reflection。
2. 判断是否满足 skill 条件。
3. 生成 create/update proposal。
4. proposal 必须包含适用范围、触发条件、证据、置信度、风险和建议动作。
5. 用户或策略审核。
6. 应用后生成新版本并更新 `last_updated`。

正式 skill 版本不可原地覆盖；任何修改都生成新版本。

## 11. 上下文管理

上下文不等于完整聊天记录。Agent 应优先使用：

- workspace 概要。
- 当前 branch capsule 或 context summary。
- 搜索命中的相关文件片段。
- 当前 run 的 todo 和决策。
- 工具结果摘要。
- 子 Agent 结构化输出。
- skill 搜索结果。
- git/workspace diff。

长期上下文写入必须有证据和作用域。branch 的上下文候选在合并前不能直接污染目标 branch。

## 12. 风险与审批

风险分级保持工具层强制，而不是只靠提示词。

低风险：

- 环境读取。
- 文件列表。
- 小范围只读文件读取。
- workspace 搜索。
- git status/diff。
- todo 更新。
- 计算。

中风险：

- patch/write。
- 一次性命令。
- 本地测试、构建、格式化。
- browser/http 操作。
- 普通终端 session。

高风险：

- 删除或移动路径。
- 依赖安装。
- 长期进程。
- 外部网络写入。
- 数据库写入。
- git restore/reset/remote。
- skill 发布。
- branch merge/adoption。
- secret 使用。

高风险动作必须通过 S 端 policy/approval runtime。审批授权必须绑定具体动作摘要，不能泛化授权一类操作；`check_policy` 和 `request_approval` 不作为本批模型工具暴露。

## 13. V1 开发边界

第一版要实现的核心能力：

- 单 workspace 内 agent/branch 基础状态。
- 当前 branch 内主 Agent loop。
- 动态子 Agent 调度接口和输出契约。
- 核心工具抽象与结构化结果。
- 后台任务启动、读取、停止模型。
- Branch Agent 创建、打开、隔离、summarize、capsule、prepare/apply merge proposal。
- Markdown-only skill registry、proposal、review、version。
- 任务后 skill reflection。
- policy/approval/audit 的最低闭环。

第一版不做：

- 固定角色 agent 编排。
- 企业 RBAC、计费和团队协作。
- 自动完整合并聊天历史、记忆或所有 branch 状态。
- 多文件/脚本/插件型 skill。
- 跨 workspace 私有 skill 治理。
- 直接把 branch 语义绑定到 git branch。

## 14. 与现有文档的冲突点

后续同步现有文档时应调整：

- `product-api-overview.md` 当前写 Skill 源格式为 `SKILL.md + YAML frontmatter + 资源目录`；本文改为第一版只支持单 Markdown 文件，无资源目录。
- `product-api-overview.md` 和 `server-spec.md` 当前强调分支第一版只做结果采纳；本文改为 branch capsule 上下文优先，再选择性采纳产物。
- `server-spec.md` 当前未把后台任务作为一等 agent core 能力；本文要求 `background_start/read/stop` 和 branch-scoped background tasks。
- 现有文档以每 12 次确认提交作为自动学习主触发；本文改为任务后反思优先，12 次提交是强触发之一。
- 现有文档对动态子 Agent 机制描述不足；本文明确禁止硬编码固定角色 Agent。
