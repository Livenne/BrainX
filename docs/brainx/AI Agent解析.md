# 🤖 AI Agent解析

## 用户:
那么现在你给我出一份完善的符合结构设计等专业分析后的完整tools方案，包含说明，架构，采取原因，未采取tool的原因。

## gpt-5.5:
下面给你一份面向 **本地项目开发型 Agent / Coding Agent / 全栈 Agent / 多子 Agent 协作系统** 的完整 tools 方案。

假设场景：Agent 运行在本地或云端工作区中，可读写项目文件、运行命令、调用浏览器、访问文档、创建子 agent，并需要完成中大型工程任务。

---

# 一、总体架构

推荐采用 **分层工具架构**，而不是把所有能力平铺成一组工具。

```text
用户
 ↓
主 Agent / Manager Agent
 ↓
工具编排层 Tool Runtime / Orchestrator
 ↓
┌──────────────────────────────────────────────┐
│  高层任务工具                                 │
│  run_tests / run_build / review_diff / delegate_task │
├──────────────────────────────────────────────┤
│  中层语义工具                                 │
│  read_file / search_code / apply_patch / run_command │
├──────────────────────────────────────────────┤
│  底层原子工具                                 │
│  screenshot / mouse_click / key_press / scroll        │
└──────────────────────────────────────────────┘
 ↓
文件系统 / Shell / Git / 浏览器 / 数据库 / 网络 / 子 Agent
```

这个架构的核心原则：

1. **主 Agent 优先使用语义工具**，例如 `read_file`、`search_code`、`apply_patch`、`run_tests`。
2. **底层工具只作为兜底**，例如坐标点击、截图、键盘输入。
3. **高风险能力必须独立成工具**，例如 `delete_file`、`run_migration`、`deploy`、`push_to_remote`。
4. **工具权限按 Agent 角色分配**，主 Agent、frontend agent、backend agent、reviewer agent、validator agent 不应拥有完全相同的工具。
5. **所有工具返回结构化结果**，避免只返回一大段非结构化日志。

---

# 二、完整 Tool 分类方案

## 1. 环境与工作区工具

这组工具用于让 Agent 理解当前运行环境，避免靠模型猜测系统、路径、shell、包管理器。

### 采取工具

```text
get_environment_info
get_workspace_info
get_project_structure
list_directory
get_file_metadata
```

### 工具说明

#### `get_environment_info`

返回操作系统、shell、路径分隔符、可用命令、网络权限、沙箱信息。

```json
{
  "os": "windows",
  "default_shell": "powershell",
  "available_shells": ["powershell", "cmd", "git-bash"],
  "cwd": "C:\\workspace\\app",
  "path_separator": "\\",
  "network_access": "restricted"
}
```

#### `get_workspace_info`

返回当前工作区、仓库根目录、是否 git 仓库、项目语言栈初步判断。

#### `get_project_structure`

返回项目概要结构，例如 monorepo、frontend/backend 目录、主要配置文件。

#### `list_directory`

列出目录内容。

#### `get_file_metadata`

返回文件大小、修改时间、类型、权限。

### 采取原因

Agent 需要先知道“自己在哪里”和“环境能做什么”。如果没有这类工具，Agent 容易在 Windows 上写 Linux 命令，在 pnpm 项目里运行 npm，在错误目录里执行测试。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `pwd` 独立工具 | 可由 `get_environment_info` 或 `run_command` 覆盖 |
| `ls` 独立工具 | 用 `list_directory` 更结构化、更跨平台 |
| `detect_os` 独立工具 | 合并进 `get_environment_info` |
| `detect_package_manager` 独立工具 | 合并进 `get_project_structure` 或后面的 package 工具 |

---

## 2. 文件读取工具

### 采取工具

```text
read_file
read_many_files
```

### 工具说明

#### `read_file`

按路径和行号读取文件。

```json
{
  "path": "src/auth/login.ts",
  "start_line": 1,
  "end_line": 120
}
```

#### `read_many_files`

一次读取多个小文件，适合读取相关配置或相邻模块。

```json
{
  "paths": [
    "package.json",
    "tsconfig.json",
    "src/auth/index.ts"
  ]
}
```

### 采取原因

`read_file` 比 `cat` 更适合 Agent 使用，因为它可以限制行数、阻止读取超大文件、避免误读二进制文件，也方便审计。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `read` 泛化工具 | 语义过宽，容易和网页读取、数据库读取、日志读取混淆 |
| `cat` 工具 | 平台相关，输出不可控 |
| `open_file` | 与 `read_file` 重叠 |
| `read_binary_file` | 默认不提供，除非 Agent 需要处理图片、PDF、模型文件等二进制资源 |

---

## 3. 搜索与探索工具

### 采取工具

```text
find_files
search_text
search_code
explore_project
```

### 工具说明

#### `find_files`

按文件名、扩展名、glob 模式查找文件。

```json
{
  "pattern": "**/*auth*"
}
```

#### `search_text`

全文搜索字符串或正则。

```json
{
  "query": "JWT_SECRET",
  "path": "backend/"
}
```

#### `search_code`

按代码符号、定义、引用、调用关系搜索。

```json
{
  "symbol": "loginUser",
  "mode": "references"
}
```

#### `explore_project`

对某个目录生成结构摘要，帮助 Agent 在未知项目里建立地图。

```json
{
  "path": "backend/src",
  "depth": 3
}
```

### 采取原因

`search`、`read`、`explore` 需要分开。  
`search_text` 适合找文本，`search_code` 适合找符号，`find_files` 适合找路径，`explore_project` 适合理解结构。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `search` 单一工具 | 语义过宽，模型容易混用全文搜索、文件搜索、代码搜索 |
| `grep` 原始工具 | 可作为底层实现，但不建议暴露给 Agent 作为主接口 |
| `semantic_search` 默认工具 | 在没有索引系统时容易伪语义化；可作为增强能力后续接入 |
| `tree` 工具 | 与 `explore_project`、`list_directory` 重叠 |

---

## 4. 文件修改工具

### 采取工具

```text
apply_patch
write_file
edit_file
create_directory
move_file
delete_file
```

### 工具说明

#### `apply_patch`

使用 diff patch 修改文件。

```json
{
  "patch": "*** Begin Patch\n*** Update File: src/auth/login.ts\n@@\n- const timeout = 3000\n+ const timeout = 5000\n*** End Patch"
}
```

#### `write_file`

新建文件或完整覆盖文件。

```json
{
  "path": "src/auth/types.ts",
  "content": "export interface LoginRequest { email: string; password: string }"
}
```

#### `edit_file`

按自然语言指令修改文件，但 runtime 应生成可审计 diff。

```json
{
  "path": "src/auth/login.ts",
  "instruction": "Add explicit handling for expired tokens."
}
```

#### `create_directory`

创建目录。

#### `move_file`

移动或重命名文件。

#### `delete_file`

删除文件。

### 采取原因

`apply_patch` 适合可审计的小范围修改，`write_file` 适合新文件，`edit_file` 适合高层语义编辑。  
`move_file` 和 `delete_file` 单独拆出，方便施加更严格权限。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `write` 泛化工具 | 覆盖、追加、patch、移动、删除混在一起，风险过高 |
| `append_file` 默认工具 | 容易造成重复追加；可由 `apply_patch` 覆盖 |
| `replace_text` | 对大型代码修改不够稳，容易误替换 |
| `sed` / `perl` 编辑工具 | 平台和转义差异较大，不建议作为主编辑方式 |
| 不受限的 `delete_directory` | 风险过高，应通过高权限确认机制处理 |

---

## 5. 命令执行工具

### 采取工具

```text
run_command
run_package_script
```

### 工具说明

#### `run_command`

统一命令执行入口，支持 shell 自动选择和超时控制。

```json
{
  "command": "pnpm test",
  "cwd": "/workspace/app",
  "shell": "auto",
  "timeout_ms": 120000,
  "env": {},
  "risk_level": "medium"
}
```

返回：

```json
{
  "exit_code": 1,
  "stdout": "...",
  "stderr": "...",
  "duration_ms": 8432,
  "shell": "bash"
}
```

#### `run_package_script`

读取项目脚本后执行，例如 npm、pnpm、yarn、bun。

```json
{
  "script": "test",
  "package_manager": "auto",
  "cwd": "/workspace/app"
}
```

### 采取原因

不建议暴露 `bash`、`cmd`、`powershell` 三个平行工具让模型选择。统一 `run_command` 更容易处理跨平台、超时、cwd、环境变量、审计和安全策略。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `bash` 独立工具 | 不跨平台 |
| `cmd` 独立工具 | 与 `run_command(shell="cmd")` 重叠 |
| `powershell` 独立工具 | 与 `run_command(shell="powershell")` 重叠 |
| `terminal` 泛化工具 | 语义过宽，不利于审计 |
| 默认 `python_execute` | 权限面较大，普通计算交给 `calc`，复杂脚本通过受控 `run_command` |

---

## 6. 测试、构建与质量检查工具

### 采取工具

```text
run_tests
run_test_file
run_linter
run_formatter
run_typecheck
run_build
run_static_analysis
```

### 工具说明

#### `run_tests`

运行测试，可按全部、变更范围、指定目录执行。

```json
{
  "scope": "changed",
  "timeout_ms": 180000
}
```

#### `run_test_file`

运行指定测试文件。

#### `run_linter`

运行 lint。

#### `run_formatter`

运行 formatter。

#### `run_typecheck`

运行类型检查。

#### `run_build`

运行构建。

#### `run_static_analysis`

运行安全扫描、依赖扫描或静态代码分析。

### 采取原因

这些工具表达的是工程意图，而不是具体命令。Agent 说“运行测试”比猜 `npm test`、`pnpm vitest`、`pytest` 更稳定。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| 只依赖 `run_command` | Agent 需要猜命令，错误率更高 |
| `npm_test` / `pytest` / `cargo_test` 分散工具 | 语言绑定过强，工具爆炸 |
| `compile` | 与 `run_build`、`run_typecheck` 语义重叠 |

---

## 7. Git 与变更管理工具

### 采取工具

```text
git_status
git_diff
git_diff_file
git_log
git_show
git_restore
summarize_changes
```

### 工具说明

#### `git_status`

查看工作区状态。

#### `git_diff`

查看当前变更。

#### `git_diff_file`

查看某个文件的 diff。

#### `git_log`

查看提交历史。

#### `git_show`

查看某个 commit 或对象。

#### `git_restore`

恢复文件，需权限控制。

#### `summarize_changes`

对当前改动生成结构化摘要。

### 采取原因

Coding Agent 必须知道自己改了什么。`git_diff` 对 reviewer agent、validator agent 和主 agent 汇总结果都非常关键。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `git_commit` 默认开放 | 提交属于较高风险动作，通常需要用户确认 |
| `git_push` 默认开放 | 高风险，容易影响远端仓库 |
| `git_rebase` 默认开放 | 可能破坏历史 |
| `git_reset_hard` 默认开放 | 数据破坏风险高 |
| 只使用 `run_command("git ...")` | 审计和权限控制不如结构化 git 工具 |

---

## 8. Web、文档与包信息工具

### 采取工具

```text
web_search
fetch_url
docs_search
package_info
release_notes_search
```

### 工具说明

#### `web_search`

公网搜索，返回标题、摘要、URL、时间等。

#### `fetch_url`

读取指定网页。

#### `docs_search`

查询官方文档、内部文档或指定知识库。

#### `package_info`

查询 npm、PyPI、crates.io、Maven、Go module 等包信息。

#### `release_notes_search`

查询版本变更、breaking changes。

### 采取原因

模型知识存在时间边界，依赖 API、框架版本、错误信息需要外部验证。  
`docs_search` 和 `web_search` 分开，有利于优先使用官方或内部可信资料。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `google` / `bing` 具体搜索工具名 | 绑定供应商，不适合作为抽象接口 |
| `browser_search` | 与 `web_search` 重叠 |
| `read_url` | 与 `fetch_url` 重叠 |
| 默认爬取整站工具 | 成本高、权限和合规风险更高 |

---

## 9. 浏览器与 Computer Use 工具

### 采取工具

优先提供浏览器结构化工具：

```text
browser_navigate
browser_click
browser_fill
browser_select
browser_extract
browser_evaluate
browser_screenshot
```

再提供底层 computer use 兜底工具：

```text
screenshot
mouse_click
mouse_move
mouse_drag
key_press
type_text
scroll
wait
get_window_info
```

### 工具说明

#### `browser_navigate`

打开 URL。

#### `browser_click`

按 selector 或 accessibility target 点击。

#### `browser_fill`

填写表单。

#### `browser_extract`

抽取页面文本、DOM、可访问性树。

#### `browser_evaluate`

执行受限 JS。

#### `screenshot`

获取屏幕截图。

#### `mouse_click`

按坐标点击。

#### `key_press`

发送键盘事件。

### 采取原因

网页操作优先走 DOM / accessibility / Playwright 风格接口，稳定性明显高于截图加坐标。  
底层 computer use 工具保留，用于桌面软件、没有 DOM 的界面、验证码外的人工确认界面、远程桌面等特殊情况。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| 单一 `computer_use` 万能工具 | 过粗，不利于权限、审计和失败定位 |
| `screen_cut` | 与 `screenshot` 重叠，截图可通过区域参数支持裁剪 |
| `cursor_control` 单一工具 | 鼠标移动、点击、拖拽语义不同，应拆开 |
| 优先使用坐标点击 | 脆弱，受窗口大小、缩放、主题影响 |
| 默认 OCR 工具 | 可作为 `browser_extract` 或 `screenshot` 的扩展，不建议一开始暴露为主路径 |

---

## 10. 服务、API 与日志工具

### 采取工具

```text
start_service
stop_service
restart_service
check_port
list_processes
read_logs
tail_log
http_request
```

### 工具说明

#### `start_service`

启动前端、后端、数据库、worker 等服务。

#### `check_port`

检查端口占用。

#### `list_processes`

列出相关进程。

#### `read_logs`

读取日志文件或进程输出。

#### `tail_log`

持续读取最新日志。

#### `http_request`

结构化 HTTP 请求。

```json
{
  "method": "POST",
  "url": "http://localhost:3000/api/login",
  "headers": {
    "content-type": "application/json"
  },
  "json": {
    "email": "a@example.com",
    "password": "test"
  },
  "timeout_ms": 10000
}
```

### 采取原因

全栈 Agent 需要启动服务、查端口、看日志、调接口。用 `http_request` 替代手写 curl，可以减少转义错误和敏感信息泄露。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `curl` 工具 | 可由 `http_request` 覆盖 |
| `kill_process` 默认开放 | 风险较高，应作为高权限工具或由 `stop_service` 管理 |
| `open_port` | 与 `check_port`、服务启动工具重叠 |
| `watch_logs` | 可由 `tail_log` 覆盖 |

---

## 11. 数据库工具

### 采取工具

```text
database_schema
database_query
database_explain
run_migration
seed_database
```

### 工具说明

#### `database_schema`

查看表结构、索引、字段。

#### `database_query`

执行只读查询为默认模式。

```json
{
  "connection": "local_dev",
  "query": "SELECT id, email FROM users LIMIT 10",
  "mode": "read_only"
}
```

#### `database_explain`

分析 SQL 执行计划。

#### `run_migration`

运行迁移。

#### `seed_database`

填充测试数据。

### 采取原因

后端和全栈 Agent 经常需要确认 schema、验证 API 数据、排查迁移问题。数据库写操作需要与读操作分离，避免误删数据。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| 默认开放任意 SQL 写入 | 风险过高 |
| `drop_database` | 破坏性太强，应只在临时沙箱中通过审批执行 |
| 让 Agent 用 shell 调数据库 CLI | 容易泄露凭据，也不利于权限控制 |
| `database_admin` 万能工具 | 权限边界不清晰 |

---

## 12. 计划、Todo 与认知辅助工具

### 采取工具

```text
todo_update
todo_list
calc
date_calc
estimate_tokens
```

### 工具说明

#### `todo_update`

维护任务计划和状态。

```json
{
  "items": [
    {
      "id": "1",
      "content": "Inspect project structure",
      "status": "completed"
    },
    {
      "id": "2",
      "content": "Implement backend login API",
      "status": "in_progress"
    },
    {
      "id": "3",
      "content": "Run tests",
      "status": "pending"
    }
  ]
}
```

#### `todo_list`

读取当前 todo。

#### `calc`

执行确定性计算。

```json
{
  "expression": "(128 * 1024 * 1024) / 4096"
}
```

#### `date_calc`

处理日期、时区、工作日、时间间隔。

#### `estimate_tokens`

估算文本或文件集合的 token 占用。

### 采取原因

`todolist` 对长任务、子 agent 调度、进度可视化很有价值。  
`calc` 用于弥补 LLM 精确计算弱点。  
`estimate_tokens` 帮助 Agent 控制上下文预算。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `scratchpad_write` 默认开放 | 容易保存未经验证的推理噪声 |
| `thought_tool` | 容易和模型内部推理混淆，也不一定适合展示 |
| 用 `python` 替代 `calc` | 简单计算使用 Python 成本和权限面都更高 |
| `planner` 独立工具 | 与 `todo_update` 高度重叠，除非系统有专门规划器 |

---

## 13. 记忆与上下文管理工具

### 采取工具

```text
read_project_memory
write_project_memory
search_project_memory
write_session_note
read_session_notes
```

### 工具说明

#### `read_project_memory`

读取长期项目记忆。

#### `write_project_memory`

写入长期记忆，建议需要确认或自动校验。

#### `search_project_memory`

搜索长期记忆。

#### `write_session_note`

写入当前会话临时记录。

#### `read_session_notes`

读取当前会话记录。

### 采取原因

长期项目需要保存架构约定、常用命令、代码风格、用户偏好。  
长期记忆和短期会话记录必须分开，避免把临时猜测污染为长期事实。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| 单一 `memory_write` | 无法区分长期事实和临时笔记 |
| 自动永久记忆所有内容 | 污染风险高，隐私风险高 |
| 保存完整用户对话 | token 成本和隐私风险较高 |
| `forget` 默认工具 | 删除长期记忆需要权限和审计 |

---

## 14. 子 Agent 与任务委派工具

### 采取工具

```text
delegate_task
create_subagent
get_subagent_result
list_subagents
cancel_subagent
```

### 工具说明

#### `delegate_task`

委派一次性任务。

```json
{
  "agent_type": "reviewer",
  "task": "Review the current diff for regression risks.",
  "allowed_tools": [
    "read_file",
    "search_code",
    "git_diff",
    "run_tests"
  ],
  "write_access": false,
  "budget": {
    "max_steps": 20,
    "timeout_ms": 300000
  }
}
```

#### `create_subagent`

创建持续性子 Agent，例如 frontend/backend。

```json
{
  "name": "frontend-agent",
  "role": "frontend",
  "scope": ["frontend/**"],
  "allowed_tools": [
    "read_file",
    "search_code",
    "apply_patch",
    "run_package_script",
    "browser_navigate",
    "browser_extract"
  ]
}
```

#### `get_subagent_result`

获取子 Agent 结果。

#### `cancel_subagent`

取消子 Agent。

### 采取原因

长任务和全栈任务适合拆分给子 Agent。  
子 Agent 可以有独立上下文、独立权限、独立预算和独立输出契约。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| `spawn_agent` 无约束工具 | 容易失控，必须带权限、预算、范围 |
| 子 Agent 默认继承主 Agent 全部工具 | 权限过大 |
| 子 Agent 直接回复用户 | 会破坏主 Agent 的统一上下文和交互责任 |
| 无限递归创建子 Agent | 成本和控制风险高 |

---

## 15. 安全、权限与审计工具

### 采取工具

```text
request_approval
check_policy
scan_secrets
redact_secret
sandbox_execute
create_temp_workspace
discard_temp_workspace
audit_log
```

### 工具说明

#### `request_approval`

高风险操作前请求用户确认。

```json
{
  "action": "delete_files",
  "reason": "Remove generated build artifacts",
  "targets": ["dist/", "coverage/"],
  "risk": "high"
}
```

#### `check_policy`

检查某个操作是否符合系统策略。

#### `scan_secrets`

扫描密钥、token、证书。

#### `redact_secret`

脱敏敏感信息。

#### `sandbox_execute`

在沙箱中运行高风险命令。

#### `create_temp_workspace`

创建临时工作区，用于验证、实验、复现。

#### `discard_temp_workspace`

丢弃临时工作区。

#### `audit_log`

记录关键工具调用。

### 采取原因

成熟 Agent 必须处理误删、泄密、越权、供应链安装、外部请求、部署等风险。  
安全工具不能只靠提示词，必须由 runtime 层强制执行。

### 未采取工具

| 未采取工具 | 原因 |
|---|---|
| 默认允许所有命令 | 风险不可控 |
| 默认允许读取任意系统路径 | 容易泄露本机隐私 |
| 默认允许外网访问 | 供应链和数据泄露风险较高 |
| 默认允许部署 | 生产风险高 |
| 只靠系统提示词限制行为 | 模型可能误判，必须有工具层策略 |

---

# 三、推荐完整工具清单

下面是一份相对完整、可落地的工具集合。

```text
环境与工作区
- get_environment_info
- get_workspace_info
- get_project_structure
- list_directory
- get_file_metadata

文件读取
- read_file
- read_many_files

搜索与探索
- find_files
- search_text
- search_code
- explore_project

文件修改
- apply_patch
- write_file
- edit_file
- create_directory
- move_file
- delete_file

命令执行
- run_command
- run_package_script

测试、构建、质量检查
- run_tests
- run_test_file
- run_linter
- run_formatter
- run_typecheck
- run_build
- run_static_analysis

Git 与变更管理
- git_status
- git_diff
- git_diff_file
- git_log
- git_show
- git_restore
- summarize_changes

Web、文档与包信息
- web_search
- fetch_url
- docs_search
- package_info
- release_notes_search

浏览器与 Computer Use
- browser_navigate
- browser_click
- browser_fill
- browser_select
- browser_extract
- browser_evaluate
- browser_screenshot
- screenshot
- mouse_click
- mouse_move
- mouse_drag
- key_press
- type_text
- scroll
- wait
- get_window_info

服务、API 与日志
- start_service
- stop_service
- restart_service
- check_port
- list_processes
- read_logs
- tail_log
- http_request

数据库
- database_schema
- database_query
- database_explain
- run_migration
- seed_database

计划与认知辅助
- todo_update
- todo_list
- calc
- date_calc
- estimate_tokens

记忆与上下文
- read_project_memory
- write_project_memory
- search_project_memory
- write_session_note
- read_session_notes

子 Agent
- delegate_task
- create_subagent
- get_subagent_result
- list_subagents
- cancel_subagent

安全、权限与审计
- request_approval
- check_policy
- scan_secrets
- redact_secret
- sandbox_execute
- create_temp_workspace
- discard_temp_workspace
- audit_log
```

---

# 四、主 Agent 与子 Agent 的工具分配

## 1. 主 Agent

```text
- get_environment_info
- get_workspace_info
- get_project_structure
- todo_update
- todo_list
- delegate_task
- create_subagent
- get_subagent_result
- git_status
- git_diff
- summarize_changes
- run_tests
- run_build
- request_approval
- check_policy
```

主 Agent 负责规划、分派、汇总、审批、最终回复用户。

---

## 2. Frontend Agent

```text
- read_file
- read_many_files
- find_files
- search_text
- search_code
- explore_project
- apply_patch
- write_file
- run_package_script
- run_tests
- run_linter
- run_typecheck
- browser_navigate
- browser_click
- browser_fill
- browser_extract
- browser_screenshot
```

Frontend Agent 主要处理 UI、状态管理、路由、前端测试、浏览器验证。

---

## 3. Backend Agent

```text
- read_file
- read_many_files
- find_files
- search_text
- search_code
- apply_patch
- write_file
- run_package_script
- run_tests
- run_typecheck
- database_schema
- database_query
- http_request
- read_logs
```

Backend Agent 主要处理 API、数据库、业务逻辑、服务日志和接口验证。

---

## 4. Reviewer Agent

```text
- read_file
- read_many_files
- search_text
- search_code
- git_diff
- git_diff_file
- run_tests
- run_typecheck
- run_static_analysis
```

Reviewer Agent 通常不应有写权限。它的职责是发现问题，而不是直接修改代码。

---

## 5. Validator Agent

```text
- run_tests
- run_test_file
- run_linter
- run_typecheck
- run_build
- start_service
- stop_service
- check_port
- http_request
- browser_navigate
- browser_extract
- browser_screenshot
- read_logs
```

Validator Agent 主要验证结果，不负责实现。

---

## 6. Temporary Investigation Agent

```text
- read_file
- search_text
- search_code
- run_command
- web_search
- fetch_url
- calc
```

临时 UUID agent 适合做假设验证、错误复现、资料调查。

---

# 五、权限分级方案

工具需要配合权限层，否则 Agent 容易越权。

## 低风险工具

```text
get_environment_info
list_directory
read_file
find_files
search_text
search_code
git_status
git_diff
todo_list
calc
```

通常可直接执行。

## 中风险工具

```text
apply_patch
write_file
run_command
run_tests
run_build
start_service
http_request
database_query(read_only)
```

建议记录审计日志，部分环境可自动执行。

## 高风险工具

```text
delete_file
move_file
git_restore
run_migration
seed_database
database_query(write)
install_dependencies
sandbox_execute
```

建议需要策略检查或用户确认。

## 极高风险工具

```text
deploy
git_push
delete_directory
database_drop
modify_system_files
external_network_exfiltration
```

默认不纳入常规工具集。如必须支持，应通过专门审批工具处理。

---

# 六、工具调用返回格式规范

所有工具应返回结构化结果，至少包含：

```json
{
  "ok": true,
  "tool": "run_tests",
  "summary": "12 tests passed, 1 failed",
  "data": {},
  "warnings": [],
  "error": null,
  "duration_ms": 32841
}
```

命令类工具应额外返回：

```json
{
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "cwd": "/workspace/app",
  "shell": "bash"
}
```

文件修改类工具应额外返回：

```json
{
  "changed_files": ["src/auth/login.ts"],
  "diff": "...",
  "conflicts": []
}
```

搜索类工具应额外返回：

```json
{
  "matches": [
    {
      "path": "src/auth/login.ts",
      "line": 42,
      "preview": "export async function loginUser(...)"
    }
  ]
}
```

---

# 七、明确未采取的工具设计

下面这些设计不建议作为主方案。

## 1. 不采用单一万能 `computer_use`

原因：权限过粗、可审计性差、失败难定位、稳定性弱。  
替代方案：

```text
browser_* 结构化工具优先
screenshot / mouse_click / key_press 底层兜底
```

---

## 2. 不采用 `bash`、`cmd`、`powershell` 三套平行工具

原因：Agent 需要自行判断平台，容易选错。  
替代方案：

```text
run_command(shell="auto" | "bash" | "powershell" | "cmd")
get_environment_info 暴露环境信息
```

---

## 3. 不采用泛化 `read`、`write`、`search`

原因：语义边界不清晰，容易和文件、网页、数据库、日志混淆。  
替代方案：

```text
read_file / fetch_url / database_query / read_logs
apply_patch / write_file / edit_file
find_files / search_text / search_code / web_search
```

---

## 4. 不默认采用坐标点击作为浏览器主路径

原因：窗口大小、缩放、主题、动画都会影响坐标。  
替代方案：

```text
browser_click(selector)
browser_fill(selector)
browser_extract()
```

坐标工具只做兜底。

---

## 5. 不默认开放 `deploy`、`git_push`、`database_drop`

原因：这些操作影响外部系统或生产环境。  
替代方案：

```text
request_approval
check_policy
sandbox_execute
```

---

## 6. 不默认开放任意长期记忆写入

原因：Agent 可能把猜测、临时状态或错误结论写成长期事实。  
替代方案：

```text
write_session_note
write_project_memory 需要确认或校验
```

---

## 7. 不让所有子 Agent 继承全部工具

原因：权限扩大、行为难控、成本升高。  
替代方案：

```text
按角色分配工具
按目录限制写权限
按预算限制步数和 token
```

---

# 八、最推荐的实际落地版本

如果你要真正实现，可以分三个阶段。

## 第一阶段：最小可用 Coding Agent

```text
get_environment_info
get_workspace_info
list_directory
read_file
read_many_files
find_files
search_text
apply_patch
write_file
run_command
run_package_script
run_tests
git_status
git_diff
todo_update
calc
request_approval
```

这套已经可以完成基本项目任务。

---

## 第二阶段：专业项目 Agent

```text
search_code
explore_project
edit_file
run_linter
run_typecheck
run_build
git_diff_file
summarize_changes
web_search
fetch_url
docs_search
package_info
read_logs
http_request
start_service
check_port
todo_list
estimate_tokens
```

这套可以显著提升中型项目表现。

---

## 第三阶段：全栈多 Agent 系统

```text
browser_navigate
browser_click
browser_fill
browser_extract
browser_screenshot
database_schema
database_query
run_migration
delegate_task
create_subagent
get_subagent_result
read_project_memory
write_project_memory
sandbox_execute
scan_secrets
audit_log
```

这套适合全栈开发、浏览器验证、多人角色模拟和长期项目。

---

# 九、最终推荐架构总结

完整方案可以压缩成下面这套结构：

```text
Agent Tools Architecture

1. 环境感知
   让 Agent 理解 OS、shell、workspace、项目结构。

2. 项目理解
   通过 read_file、search_text、search_code、explore_project 建立上下文。

3. 安全修改
   通过 apply_patch、write_file、edit_file 修改项目，并用 git_diff 追踪。

4. 工程验证
   通过 run_tests、run_typecheck、run_build、browser、http_request 验证结果。

5. 外部知识
   通过 web_search、docs_search、package_info 补足模型知识边界。

6. 运行观测
   通过 read_logs、check_port、list_processes、start_service 观察真实运行状态。

7. 任务管理
   通过 todo_update、delegate_task、create_subagent 支持长任务和多 agent 协作。

8. 精确辅助
   通过 calc、date_calc、estimate_tokens 弥补模型计算和预算弱点。

9. 安全控制
   通过 request_approval、check_policy、scan_secrets、sandbox_execute 控制风险。

10. 审计回滚
   通过 git_diff、audit_log、git_restore、temp_workspace 支持追踪和恢复。
```

如果只保留一句核心设计原则：

**优先给 Agent 语义化、结构化、可审计的工具；底层原子操作作为兜底；高风险能力单独拆分并加权限；不同子 Agent 使用不同工具集。**

## 用户:
这份tools确实很完整。我现在想要做一个agent但是是vibecoding。所以我需要你帮我生成一份让ai能够理解的提示词。注意，我需要他了解怎么做，而不是直接让它怎么做。不应该跟他说具体代码怎么实现，而是原理，机制，架构。但是我发现你之前的理解还是有些问题。首先你单独列出来了frontend agent和reviewer这些直接定义工作方向的agent。但我刚刚所说的描述是codex的主agent自己创建的相关的子agent。实际上并没有这样的硬编码式agent。然后是tools是否是有些过多导致部分内容功能重合呢

## gpt-5.5:
下面这份可以直接作为你给 AI 的 **vibecoding 提示词**。它的目标不是让 AI 立刻写死某个实现，而是让它理解你想构建的 Agent 系统在 **原理、机制、架构、工具边界、动态子 Agent 调度** 上应如何设计。

```text
你需要帮助我设计并逐步实现一个项目型 AI Agent 系统。请先理解架构和机制，不要一上来写具体代码，也不要把系统做成固定模板或硬编码流程。

这个 Agent 面向 vibecoding / coding agent / project agent 场景，主要用于理解本地项目、修改代码、运行验证、调用工具、创建临时子 Agent、汇总结果，并与用户保持统一交互。

请始终围绕以下设计原则思考。

一、核心目标

我要构建的不是一个简单聊天机器人，而是一个可以围绕项目执行工作的 Agent runtime。

它需要具备：

1. 理解当前工作区、项目结构、文件内容和运行环境。
2. 根据用户目标拆解任务。
3. 通过工具读取、搜索、修改、运行、验证项目。
4. 在任务复杂时动态创建子 Agent 协助工作。
5. 子 Agent 由主 Agent 按任务临时创建，而不是提前硬编码成 frontend agent、backend agent、reviewer agent 等固定角色。
6. 所有用户交互默认由主 Agent 统一处理，子 Agent 只向主 Agent 汇报结果。
7. 工具集合应保持精简、正交、可组合，避免为相似能力创建大量重叠工具。
8. 高风险操作需要权限、审计、确认或沙箱机制。
9. 结果应可验证，而不是只依赖模型自信判断。

二、不要采用硬编码式子 Agent

不要把 frontend、backend、reviewer、tester 这些角色写死成系统内置 Agent。

这些名字只能作为运行时动态生成的角色示例，而不是固定模块。

正确思路：

主 Agent 在分析任务后，可以根据需要动态创建子 Agent。

例如：

- 如果任务涉及 UI，可以创建一个临时子 Agent，指令聚焦于相关前端目录。
- 如果任务涉及 API，可以创建一个临时子 Agent，指令聚焦于相关后端目录。
- 如果任务需要验证，可以创建一个只读验证子 Agent。
- 如果任务需要调查，可以创建一个短生命周期 investigation 子 Agent。
- 如果任务很小，主 Agent 可以不创建任何子 Agent。

子 Agent 的角色、权限、上下文、工具范围、预算、输出格式，都应由主 Agent 在运行时生成。

系统不应预设固定组织结构，不应假设每个项目都有 frontend/backend，也不应固定每次都创建 reviewer。

三、子 Agent 的机制

请把子 Agent 理解为一次独立的 Agent 执行实例，而不是独立产品模块。

每个子 Agent 至少包含：

- 独立上下文
- 专用任务说明
- 主 Agent 传入的局部项目背景
- 受限工具集合
- 受限文件范围或操作范围
- 时间、步数、token 或调用预算
- 明确输出契约
- 结果返回给主 Agent 的机制

主 Agent 创建子 Agent 时，应传入类似信息：

- task：要完成的具体子任务
- context：必要背景，不要传整个主上下文
- allowed_tools：允许使用哪些工具
- allowed_paths：允许读写哪些路径
- write_access：是否允许修改文件
- budget：最大步骤、最大时间、最大 token
- output_schema：要求返回什么结构
- success_criteria：如何判断任务完成

子 Agent 不直接面向用户，不自行决定最终交付，不擅自扩大任务范围。

四、主 Agent 的职责

主 Agent 负责：

- 理解用户意图
- 建立全局计划
- 维护 todo
- 判断是否需要工具调用
- 判断是否需要创建子 Agent
- 给子 Agent 分配有限任务
- 汇总子 Agent 结果
- 仲裁冲突
- 运行最终验证
- 向用户解释结果

主 Agent 不应把所有细节都塞进自己的上下文。对于可并行、可隔离、可验证的局部任务，可以委派给子 Agent。

五、工具设计原则

工具不要越多越好。工具应保持少量、正交、可组合。

优先采用一组稳定的核心工具，再通过参数表达差异，而不是为每个小能力创建一个新工具。

例如：

不要设计：
- bash
- powershell
- cmd
- zsh

优先设计：
- run_command(command, cwd, shell="auto", timeout_ms, env, risk_level)

不要设计：
- grep
- ripgrep
- searchFile
- searchText
- findInProject

优先设计：
- search_workspace(query, mode, path, include, exclude)

不要设计：
- frontend_agent
- backend_agent
- reviewer_agent
- tester_agent

优先设计：
- create_subagent(task, context, allowed_tools, allowed_paths, write_access, budget, output_schema)

不要设计一个万能 computer_use 工具。应优先使用结构化浏览器或项目工具，只有没有结构化接口时才使用截图、鼠标、键盘等底层工具。

六、推荐精简工具集合

请优先围绕下面这组核心工具设计系统。除非有明确理由，不要继续膨胀工具数量。

1. 环境与项目感知

- get_environment
  返回 OS、shell、cwd、workspace、网络权限、沙箱状态、可用基础命令。

- inspect_workspace
  返回项目结构概要、主要配置文件、语言栈、包管理器、git 状态概要。

2. 文件与目录

- list_files
  查看目录或按 glob 查找文件。

- read_file
  按路径和行号读取文件。

- read_many_files
  批量读取少量相关文件。

3. 搜索

- search_workspace
  统一搜索入口，通过 mode 区分 filename、text、regex、symbol。

示例 mode：

- filename：按文件名或路径找文件
- text：全文字符串搜索
- regex：正则搜索
- symbol：代码符号、定义、引用搜索；如果当前实现暂不支持，可降级为 text 搜索

4. 修改

- apply_patch
  使用 diff patch 修改文件，作为首选修改方式。

- write_file
  新建文件或明确完整覆盖文件。

- move_path
  移动或重命名文件，需要较高权限。

- delete_path
  删除文件或目录，需要较高权限和确认机制。

5. 命令与验证

- run_command
  统一命令执行入口，支持 shell auto、cwd、timeout、env、risk_level。

- run_task
  高层任务执行入口，用于 test、lint、typecheck、build、format 等标准工程动作。它可以内部识别 package.json、Makefile、pyproject、Cargo.toml 等配置。

6. Git 与变更

- git_status
  查看工作区状态。

- git_diff
  查看全部或指定文件 diff。

- git_restore
  恢复指定文件，需要谨慎权限。

7. Web 与外部资料

- web_search
  搜索公网资料，返回来源、标题、URL、摘要、时间。

- fetch_url
  读取指定 URL 内容。

- package_info
  查询依赖包版本、文档、元数据或 release 信息。

8. 浏览器与界面

- browser_action
  结构化浏览器操作，通过 action 参数区分 navigate、click、fill、extract、evaluate、screenshot。

- computer_action
  底层 GUI 操作，通过 action 参数区分 screenshot、click、type、key_press、scroll、wait。仅作为兜底能力。

9. 服务与接口

- service_action
  通过 action 参数区分 start、stop、restart、check_port、logs。

- http_request
  结构化 HTTP 请求，替代手写 curl。

10. 计划与精确辅助

- todo_update
  维护当前任务计划和状态。

- calc
  用于确定性计算。

11. 子 Agent

- create_subagent
  创建临时或短期子 Agent。

- get_subagent_result
  获取子 Agent 输出。

- cancel_subagent
  取消子 Agent。

12. 安全与审批

- request_approval
  高风险操作前请求用户确认。

- check_policy
  判断操作是否符合权限策略。

- scan_secrets
  检查敏感信息。

- sandbox_action
  创建、执行、丢弃临时沙箱工作区。

七、工具重叠处理规则

如果两个工具只是参数不同，不要拆成两个工具。

如果两个工具的风险等级不同，可以拆开。

如果两个工具的返回结构完全不同，可以拆开。

如果一个工具用于高频核心动作，可以独立保留。

如果一个工具只是底层实现细节，不要暴露给 Agent。

典型合并策略：

- find_files、search_text、search_code 合并为 search_workspace，通过 mode 区分。
- run_tests、run_linter、run_typecheck、run_build 合并为 run_task，通过 task_type 区分。
- browser_click、browser_fill、browser_extract 合并为 browser_action，通过 action 区分。
- start_service、stop_service、read_logs、check_port 合并为 service_action，通过 action 区分。
- bash、cmd、powershell 合并为 run_command，通过 shell 参数区分。
- frontend_agent、backend_agent、reviewer_agent 不作为工具存在，统一由 create_subagent 动态生成。

八、工具分层

请在设计中区分三层：

第一层：Agent 决策层
- 主 Agent 规划、委派、汇总、回复用户。

第二层：语义工具层
- read_file、search_workspace、apply_patch、run_task、git_diff、create_subagent 等。

第三层：执行适配层
- 真正调用文件系统、shell、git、浏览器、HTTP、数据库、沙箱的代码。

Agent 不应直接依赖底层系统差异。比如 Windows、Linux、macOS 的差异应尽量由执行适配层处理。

九、权限与风险

工具需要带风险分级。

低风险：
- get_environment
- inspect_workspace
- list_files
- read_file
- search_workspace
- git_status
- git_diff
- calc
- todo_update

中风险：
- apply_patch
- write_file
- run_command
- run_task
- http_request
- browser_action

高风险：
- delete_path
- move_path
- git_restore
- 安装依赖
- 数据库写入
- 外部网络提交
- 修改系统目录
- 长时间运行命令

高风险操作应经过 check_policy 或 request_approval。

十、Agent 执行循环

主 Agent 的基本循环可以按以下机制理解：

1. 接收用户目标。
2. 更新 todo。
3. 获取环境和项目概况。
4. 根据需要读取、搜索、探索项目。
5. 制定局部执行计划。
6. 判断是否需要子 Agent。
7. 若需要，创建一个或多个动态子 Agent。
8. 子 Agent 执行受限任务并返回结构化结果。
9. 主 Agent 汇总结果。
10. 主 Agent 修改代码或整合子 Agent 修改。
11. 运行测试、lint、typecheck、build 或浏览器验证。
12. 查看 git diff。
13. 必要时修复问题并重复验证。
14. 最终向用户报告做了什么、验证结果、剩余风险。

十一、子 Agent 调度策略

只有在满足以下情况时才创建子 Agent：

- 子任务可以隔离
- 子任务上下文相对独立
- 子任务可并行
- 子任务需要独立验证
- 主 Agent 上下文过大
- 需要不同权限边界
- 需要不同任务视角

不要为了形式而创建子 Agent。

子 Agent 类型应按任务即时生成，而不是从固定枚举中选择。

创建子 Agent 时，必须限制：

- 文件范围
- 工具范围
- 写权限
- 时间预算
- 步数预算
- 输出格式
- 成功标准

十二、上下文管理

不要把全部项目内容放进上下文。

优先使用：

- inspect_workspace 获取项目概要
- search_workspace 找相关文件
- read_file 读取必要片段
- read_many_files 读取少量相关文件
- git_diff 获取当前变更
- 子 Agent 返回结构化摘要

主 Agent 应保留全局目标、关键决策、todo、子 Agent 结果、验证结果。

子 Agent 应只接收完成当前子任务所需的上下文。

十三、输出契约

所有工具和子 Agent 都应返回结构化信息，而不是只返回自由文本。

子 Agent 输出建议包含：

- status：success / partial / failed
- summary：完成摘要
- changed_files：修改文件
- evidence：依据，例如测试结果、搜索结果、日志
- risks：发现的风险
- next_actions：建议主 Agent 后续处理的动作

十四、实现时的注意事项

请先输出架构理解和设计方案，再进入实现。

不要直接写大量代码。

不要把某种技术栈写死。

不要假设项目一定是前后端分离。

不要假设一定需要数据库。

不要假设一定需要浏览器。

不要把所有工具都一次性实现完。

请优先实现最小可用核心：

- get_environment
- inspect_workspace
- list_files
- read_file
- search_workspace
- apply_patch
- write_file
- run_command
- run_task
- git_status
- git_diff
- todo_update
- calc
- create_subagent
- get_subagent_result
- request_approval

然后再逐步扩展：

- web_search
- fetch_url
- package_info
- browser_action
- service_action
- http_request
- scan_secrets
- sandbox_action

十五、你需要产出的内容

请基于以上原则，先给出：

1. 整体架构设计。
2. 主 Agent 执行机制。
3. 动态子 Agent 创建机制。
4. 精简 tools 设计。
5. 工具参数和返回结构建议。
6. 权限和风险控制策略。
7. 最小可用版本范围。
8. 后续扩展路径。

在我确认架构之后，再进入具体代码实现。
```

你指出的问题需要修正成两点：**子 Agent 不应预置成固定 frontend/reviewer 等硬编码角色，而应由主 Agent 基于当前任务动态生成；tools 也应从“大而全清单”收敛成少量正交工具，通过参数表达差异，通过权限表达风险。**

## 用户:
我还要进行一些补充和拓展已经一些定制化需求。backend terminal这个tool是不是没有，以及我的agent项目还有两个特殊功能，分支功能和skill功能(skill迭代功能)，首先是前者，分支功能类似git但不是git，他的功能像是fork agent，但是其具体的使用体验是，比如我当前有一个项目，现在我有好几个拓展功能想要开发，但是一个一个来太慢了，且有些功能就是想先测试一下，试错一下。那么在git开发中，多个开发者可以创建几个分支，分别在不同的分支上去开发，而又不影响主分支。这个就是我想说的。我想在agent系统中实现它，与子agent不同的是，影响的作用域。子agent影响的代码文件和主agent是共享的，但分支agent和主agent的工作区域虽然路径相同但确是隔离的。再然后是它的操作控制，我想了想应该和子agent不同，子agent由主agent创建，分支agent应该由用户自己创建。因为不同的分支信息量差异极大，如果让一个agent中心化管控会出问题。然后就是合并，首先不同的分支agent不仅仅是代码文件不同，其上下文也不同，这里既要处理代码合并还要处理上下文合并。我能想出的方案还比较有限，我觉得应该先合并上下文再合并工作内容。这样agent更好工作。但我还有的顾虑是有的agent分支未必是有代码的，可能是纯聊天也可能是别的项目，因为本agent未必是面相code，所以不能说合并代码。而是让上下文合并后的agent自行决定要合并和是否合并什么进度。而合并上下文就是关键问题。目前我没想到好的想法，这个功能实现还有待商榷。然后是skill功能，这里的skill功能只面向单md文件元数据这种说明skill，不包含带脚本和引用资源的类型。然后是它的迭代功能，或者说自我学习。在完成特定任务或者让agent认为他学到东西了之后会进行一次总结，然后会更新旧skill或新增skill，这个功能就可以迭代和自我产出skill让agent越用越聪明。这里的难点在于何时触发。

## gpt-5.5:
你补充的三点会让架构从“普通 coding agent”进一步变成 **多工作区、多上下文、可自学习的 Agent Runtime**。需要新增三块机制：**持久终端会话、用户创建的分支 Agent、Skill 迭代系统**。

下面这份内容可以直接追加进你之前的 vibecoding 提示词里。

```text
请继续理解以下定制化需求。这些需求会影响 Agent runtime 的架构设计，不要把它们写成简单业务功能，也不要直接给出代码实现。请先从机制、边界、状态、权限和数据流角度理解。

一、Backend Terminal / Persistent Terminal Session

之前的工具设计里有 run_command 和 service_action，但这两者还不能完全覆盖 backend terminal 体验。

run_command 适合一次性命令，例如：
- pnpm test
- git diff
- python script.py
- npm run build

但 backend terminal 更接近持久终端会话，适合：
- 启动长期运行的 dev server
- 观察持续输出的日志
- 与 REPL 或交互式 CLI 通信
- 保持后端服务运行，再让 Agent 继续做别的事
- 多个终端并行存在，例如 frontend server、backend server、worker、test watcher

因此需要增加一个持久终端类工具，但不要拆成 bash/cmd/powershell 多个工具。

推荐工具：

- terminal_action

通过 action 参数区分具体行为：

- create_session
- send_input
- read_output
- stop_session
- list_sessions
- resize_session
- clear_session

示例参数：

{
  "action": "create_session",
  "name": "backend-dev-server",
  "cwd": "/workspace/project",
  "shell": "auto",
  "command": "pnpm dev:backend",
  "env": {},
  "timeout_ms": 10000
}

读取输出：

{
  "action": "read_output",
  "session_id": "term_123",
  "since": "last_read",
  "max_bytes": 12000
}

发送输入：

{
  "action": "send_input",
  "session_id": "term_123",
  "input": "rs\n"
}

停止会话：

{
  "action": "stop_session",
  "session_id": "term_123",
  "signal": "SIGTERM"
}

terminal_action 与 run_command 的区别：

- run_command 面向一次性命令。
- terminal_action 面向持续进程和交互式终端。
- service_action 面向更高层的服务生命周期，例如 start、stop、logs、check_port。
- terminal_action 可以作为 service_action 的底层实现，但 Agent 侧可以在需要时直接使用 terminal_action。

权限规则：

- 创建普通本地终端属于中风险。
- 安装依赖、访问外网、启动暴露端口、执行删除命令、运行未知脚本需要策略检查。
- 长时间运行的 terminal session 需要预算、超时、最大输出限制。
- 所有 terminal session 需要可列出、可停止、可审计。

二、分支 Agent / Branch Agent

我需要一个分支功能，它类似 git 分支的体验，但不能简单等同于 git。

核心体验：

用户当前有一个项目或一个会话，想同时尝试多个方向，例如：
- 开发功能 A
- 开发功能 B
- 尝试一个实验性方案
- 进行纯聊天推演
- 做一个非代码项目探索
- 让某个 Agent 分支独立试错

这些分支应该互不影响。每个分支看起来路径相同，但实际工作区隔离。

这和子 Agent 不同。

子 Agent：
- 由主 Agent 根据任务动态创建。
- 通常服务于当前主 Agent。
- 默认共享当前工作区或在受限范围内操作当前工作区。
- 结果返回主 Agent。
- 生命周期偏临时或短期。

分支 Agent：
- 由用户显式创建。
- 拥有隔离的工作区状态。
- 拥有隔离的上下文、todo、记忆、工具历史和可能的 skill 变更草案。
- 不由某个中心主 Agent 完全管控。
- 可以长期存在。
- 可以纯聊天，也可以处理代码，也可以处理非代码项目。
- 合并时不能假设一定合并代码，而应合并“进度、上下文、产物、决策、洞察或文件变更”。

分支 Agent 的关键机制：

1. 工作区隔离

每个 branch agent 拥有独立 workspace snapshot 或 overlay workspace。

可选实现思路包括：
- copy-on-write workspace
- overlay filesystem
- 临时目录快照
- virtual workspace layer
- git worktree 作为底层实现之一，但上层语义不应绑定 git

每个分支看到的路径可以相同，例如：

/workspace/project/src/app.ts

但 branch-A 和 branch-B 实际读写互不影响。

2. 上下文隔离

每个分支拥有独立：

- conversation history
- todo state
- agent notes
- branch memory
- tool call history
- terminal sessions
- workspace changes
- skill proposals

不要让一个中心 Agent 同时吞下所有分支上下文，这会造成上下文污染和决策混乱。

3. 用户创建分支

分支不应由主 Agent 随意创建。

用户可以显式执行类似操作：

- 创建新分支
- 从当前状态 fork 出一个分支
- 打开某个分支
- 比较分支
- 请求分支总结
- 请求合并分支
- 丢弃分支

主 Agent 可以建议创建分支，但实际创建需要用户确认。

4. 分支工具设计

推荐使用一个合并式工具：

- branch_action

通过 action 参数区分：

- create_branch
- list_branches
- open_branch
- snapshot_branch
- diff_branch
- summarize_branch
- prepare_merge
- apply_merge
- discard_branch
- archive_branch

示例：

{
  "action": "create_branch",
  "name": "experiment-new-auth-flow",
  "from": "current",
  "mode": "copy_on_write",
  "description": "Try a new auth flow without affecting the main workspace."
}

比较分支：

{
  "action": "diff_branch",
  "source_branch": "experiment-new-auth-flow",
  "target_branch": "main",
  "include": ["workspace", "context", "skills", "notes"]
}

准备合并：

{
  "action": "prepare_merge",
  "source_branch": "experiment-new-auth-flow",
  "target_branch": "main",
  "merge_mode": "proposal"
}

应用合并：

{
  "action": "apply_merge",
  "merge_proposal_id": "merge_123",
  "selected_items": ["context_insights", "file_changes", "skill_proposals"]
}

5. 分支合并不要只理解成代码合并

分支可能包含：

- 代码文件修改
- 文档修改
- 配置修改
- 设计决策
- 聊天结论
- 研究结果
- 用户偏好
- todo 进度
- bug 复现路径
- 已验证失败的方案
- skill 更新建议
- 没有任何文件变更的纯上下文成果

因此合并对象应抽象成 artifacts / progress units，而不是只处理 code diff。

推荐合并对象：

- workspace_changes
- context_summary
- decisions
- discoveries
- rejected_approaches
- open_questions
- todo_delta
- memory_candidates
- skill_proposals
- terminal_evidence
- validation_results
- external_references

6. 上下文合并机制

上下文合并不能直接把 source branch 的完整聊天记录塞进 target branch。

应该先生成 branch capsule，也就是分支胶囊摘要。

branch capsule 应包含：

{
  "branch_id": "branch_123",
  "branch_name": "experiment-new-auth-flow",
  "goal": "Explore a new authentication flow",
  "status": "partial",
  "summary": "Tried replacing session auth with token-based flow. Backend prototype works, frontend integration incomplete.",
  "important_context": [
    "Existing auth middleware assumes cookie session.",
    "Token refresh requires changes in API client."
  ],
  "decisions": [
    {
      "decision": "Do not remove cookie session yet.",
      "reason": "Several routes still depend on it."
    }
  ],
  "discoveries": [
    {
      "content": "The login handler is shared by web and mobile clients.",
      "evidence": ["src/auth/login.ts", "src/mobile/auth.ts"]
    }
  ],
  "changed_artifacts": [
    {
      "type": "file",
      "path": "src/auth/token.ts",
      "summary": "Added prototype token issue/verify helpers."
    }
  ],
  "validation": [
    {
      "type": "test",
      "status": "failed",
      "summary": "Auth tests fail because cookie assertions still expect session."
    }
  ],
  "risks": [
    "May break mobile login if merged directly."
  ],
  "merge_recommendation": {
    "context": "merge",
    "workspace_changes": "partial",
    "skills": "review_required"
  }
}

合并上下文时，target branch 的 Agent 只接收 capsule 和必要 evidence，而不是完整原始历史。

目标分支 Agent 需要把 capsule 当成候选信息处理，而不是无条件事实。

7. 推荐合并流程

分支合并建议采用 context-first，但不是自动吸收全部上下文。

流程：

1. source branch 生成 branch capsule。
2. target branch 读取 capsule。
3. target branch Agent 判断哪些上下文值得吸收。
4. target branch 将可复用上下文写入 session notes 或 memory candidates。
5. target branch 再查看 workspace/artifact diff。
6. target branch 决定是否合并文件、文档、todo、skill proposal 或其他产物。
7. 高风险合并需要用户确认。
8. 合并完成后生成 merge report。

合并顺序：

- 先理解分支做了什么。
- 再决定是否吸收上下文。
- 再决定是否合并产物。
- 最后验证合并后的目标分支状态。

不要自动把所有上下文和所有文件变更合并进去。

8. 分支冲突

冲突不只包括文件冲突，还包括：

- 决策冲突
- 目标冲突
- 记忆冲突
- skill 冲突
- todo 冲突
- 外部依赖冲突
- 用户偏好冲突

合并报告应明确列出冲突类型。

三、Skill 功能与 Skill 迭代

Skill 功能只面向单个 Markdown 文件加元数据的技能说明。

不包含脚本。
不包含外部资源引用。
不包含复杂目录结构。
不包含工具插件包。
不包含可执行代码。

Skill 文件可以采用 Markdown + YAML frontmatter。

示例：

---
name: "debug-node-esm-import-error"
description: "Diagnose common Node.js ESM/CJS import errors in TypeScript projects."
triggers:
  - "ERR_REQUIRE_ESM"
  - "Cannot use import statement outside a module"
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
3. Check whether dependency is ESM-only.
4. Prefer aligning build target before changing imports broadly.

## Common pitfalls

- Do not blindly switch the whole project to ESM.
- Check test runner support before changing tsconfig.

## Evidence

- Learned from repeated fixes in local Node projects.
- Verified by successful test runs in previous tasks.

Skill 的作用：

- 让 Agent 在相似任务中更快进入正确处理路径。
- 保存可复用操作经验。
- 保存项目约定或跨项目经验。
- 帮助 Agent 减少重复探索。

四、Skill 工具设计

不要拆太多 skill 工具。

推荐一个合并式工具：

- skill_action

通过 action 参数区分：

- search
- read
- propose_create
- propose_update
- apply_proposal
- list_proposals
- archive

示例：

{
  "action": "search",
  "query": "Node.js ESM import error",
  "context": {
    "project_type": "typescript",
    "error": "ERR_REQUIRE_ESM"
  }
}

提出新增 skill：

{
  "action": "propose_create",
  "skill": {
    "name": "debug-node-esm-import-error",
    "description": "Diagnose common ESM/CJS import errors in Node.js TypeScript projects.",
    "triggers": ["ERR_REQUIRE_ESM", "moduleResolution"],
    "body": "..."
  },
  "reason": "The Agent resolved a non-obvious repeated error pattern."
}

提出更新 skill：

{
  "action": "propose_update",
  "skill_name": "debug-node-esm-import-error",
  "changes": [
    {
      "section": "Common pitfalls",
      "content": "Check Vitest/Jest ESM support before changing tsconfig."
    }
  ],
  "evidence": [
    "Task succeeded after changing test runner config, not package type."
  ]
}

五、Skill 迭代触发机制

Skill 更新不应在每个任务后自动发生。需要触发条件。

推荐触发来源：

1. 用户显式要求

例如用户说：
- 记住这个做法
- 以后遇到这种情况这样处理
- 把这个总结成 skill
- 更新某个 skill

这种情况优先级最高。

2. Agent 完成非平凡任务后

任务满足以下条件时，可以进入 skill reflection：

- 过程包含多步排查
- 解决方案不明显
- 遇到了错误并修复
- 发现了项目特有约定
- 形成了可复用流程
- 工具验证证明方案有效
- 之前 skill 不完整或有误

3. 重复出现的模式

如果同类任务、错误、项目结构、用户偏好重复出现多次，可以提出 skill。

例如：
- 连续多次遇到同一种框架配置坑
- 多个项目都采用相同目录约定
- 用户反复要求同一种代码风格
- 某个测试运行命令被多次验证

4. 用户纠正 Agent 后

如果用户指出 Agent 做法错误，且纠正内容有长期价值，可以提出 skill 更新。

5. 分支合并时

branch agent 在分支中发现可复用经验时，不应直接写入全局 skill，而应产生 skill_proposal。

目标分支或用户确认后再应用。

6. 失败任务也可以触发

失败也可能产生 skill，但应记录为 avoid / pitfall，而不是成功流程。

例如：
- 某个方法不可行
- 某个版本存在限制
- 某个命令在当前项目不适用
- 某个依赖组合冲突

六、不要触发 Skill 更新的情况

以下情况不应自动写入 skill：

- 一次性事实
- 未验证猜测
- 用户临时偏好
- 敏感信息
- token、密码、私有 URL
- 版本变化很快的外部资料
- 只属于当前会话的偶然上下文
- 没有复用价值的普通步骤
- Agent 没有证据支持的总结

七、Skill 写入策略

Skill 迭代建议采用 proposal-first 机制。

流程：

1. Agent 完成任务。
2. Agent 判断是否满足 skill reflection 条件。
3. 如果满足，生成 skill proposal。
4. proposal 标明：
   - 新增还是更新
   - 适用范围
   - 触发条件
   - 证据
   - 置信度
   - 风险
5. 低风险项目级 skill 可以自动进入待确认队列。
6. 全局 skill 或高影响 skill 需要用户确认。
7. 应用后更新 skill version 和 last_updated。

不要让 Agent 无限制自我写入 skill。否则会污染技能库。

八、Skill 作用域

Skill 至少分为：

- global skill
- project skill
- branch skill
- session skill proposal

global skill：
适合跨项目通用经验。

project skill：
适合当前项目约定，例如常用命令、目录结构、代码风格。

branch skill：
适合实验分支中的待验证经验。

session skill proposal：
尚未确认的候选 skill。

分支合并时，branch skill 不直接进入 global skill，而是转换成 proposal。

九、Branch 与 Skill 的关系

每个 branch agent 可以拥有自己的 skill proposals。

当 branch 合并到目标分支时，merge proposal 中应包含：

- branch 中新增的 skill proposal
- branch 中对旧 skill 的更新建议
- skill 更新证据
- 与目标分支现有 skill 的冲突
- 是否建议应用

目标分支 Agent 应先理解这些 skill proposals，再决定是否应用。

十、最小新增工具集合

在原有最小工具基础上，请新增以下三个合并式工具：

1. terminal_action

用于持久终端会话。

2. branch_action

用于用户创建、打开、比较、总结、合并、丢弃分支 Agent。

3. skill_action

用于搜索、读取、提出、更新、应用、归档 Markdown skill。

更新后的核心工具集合：

- get_environment
- inspect_workspace
- list_files
- read_file
- read_many_files
- search_workspace
- apply_patch
- write_file
- run_command
- run_task
- terminal_action
- git_status
- git_diff
- todo_update
- calc
- create_subagent
- get_subagent_result
- branch_action
- skill_action
- request_approval
- check_policy

十一、整体架构补充

请把系统理解为多层状态模型：

1. User Space
用户显式控制当前分支、创建分支、请求合并、批准高风险操作。

2. Branch Runtime
每个 branch 拥有隔离 workspace、上下文、todo、notes、terminal sessions、skill proposals。

3. Agent Runtime
每个 branch 内部运行自己的主 Agent。主 Agent 可以在该 branch 内创建子 Agent。

4. Tool Runtime
工具调用受到当前 branch 的 workspace、权限和上下文限制。

5. Merge Runtime
负责生成 branch capsule、比较产物、准备合并提案、处理冲突、应用用户选择的合并项。

6. Skill Runtime
负责 skill 搜索、读取、proposal、版本更新、作用域管理和污染防护。

十二、重要设计边界

- 子 Agent 由当前 branch 内的主 Agent 创建。
- Branch Agent 由用户创建。
- 子 Agent 默认服务于所在 branch。
- Branch 之间工作区隔离。
- Branch 之间上下文隔离。
- Branch 合并通过 proposal，而不是直接覆盖。
- Skill 更新通过 proposal-first，而不是直接自我改写。
- Terminal session 归属于某个 branch，不能跨 branch 混用。
- 合并不等于合并代码，它可以只合并上下文、结论、skill 或其他产物。
- 对非代码项目，workspace_changes 可以代表文档、笔记、配置、设计稿描述或其他文本产物。
```

这三个补充里，最关键的架构调整在于：**子 Agent 属于某个分支内部的任务委派机制；分支 Agent 属于用户显式创建的隔离运行环境；Skill 属于跨任务复用的知识资产，但写入必须经过 proposal 和证据约束。**