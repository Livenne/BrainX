# brainx B 端轻量设计规范

## 1. 设计定位

B 端是 agent 工作台，不是营销页。整体气质应高级、克制、动态但不炫技：信息密度服务于观察 agent 状态、对话协作、审批风险、管理分支、维护 skill 和绑定 Client。

设计视角按场景切换：

- 全局层面以产品设计负责人视角控制一致性、扩展性和信息优先级。
- AppShell 与通用组件以前端页面设计师视角保证可实现、可维护。
- Chat、Agents、Branches、Approvals、Skills、Client 等页面按具体任务目标设计。

## 2. 内容原则

- "One thousand no's for every yes." 每个元素必须有明确任务价值。
- "Never pad a design with placeholder text, dummy sections just to fill space. Every element should earn its place."
- 当前阶段只展示项目已有数据、真实 mock API 能力或明确待接入的 agent 能力，不为了撑满版面堆砌数字、说明段落或假区块。
- 禁止 emoji 图标、复杂手绘 SVG、彩色色条卡和装饰性紫粉蓝渐变。

## 3. 色彩与 Token

品牌源色固定为 `#2563EB`，对应 `oklch(54.61% 0.2152 262.88)`。组件优先使用品牌色；不够用时只能从该 OKLCH 源派生亮度、色度、色相变体，并通过语义 token 输出。

实现规则：

- 禁止在组件中随意写入新的 hex 色值。
- 状态色使用 `--color-state-info/success/warning/danger/branch`，由品牌 OKLCH 派生。
- 明暗主题都使用 `--color-bg-*`、`--color-text-*`、`--color-border-*`，避免主题内直接造色。
- 底层背景覆盖整个 app shell，包括侧栏、标题栏和内容区；背景应是低饱和工作台材质，不使用离散光球或强烈色块。

## 4. 字体与排版

- UI 字体：`Plus Jakarta Sans`。
- 页面标题与品牌短标可用 `Space Grotesk`，不要在普通内容中混用多套字体。
- 代码、日志、终端使用系统等宽字体。
- 字间距保持 `0`；按钮、卡片、侧栏内不要使用英雄页级别字号。

## 5. AppShell

- 左侧导航默认展开，可折叠；折叠时图标槽位固定居中，文案用 opacity、visibility、max-width 和 transform 过渡，避免闪跳。
- 顶栏左侧只显示当前页面名，不显示 `brainx`、路径、workspace、agent、branch 或状态标签。
- 语言切换不放在顶栏；主题切换为单个可点击滑动 switch。
- 主内容区不重复页面名和说明文案；页面名称由顶栏负责。

## 6. Chat 工作台

Chat 是主要工作区，应可视化 agent loop 的真实能力：

- 左侧上下文：workspace、agent、branch、skill、subagent、Client、当前状态。
- 中央对话：普通文本、Markdown、上下文引用、tool call、tool result、图片块；图片只在有真实 payload 时展示。
- 右侧执行态：todo list、background terminal、运行状态、阻塞信息。
- v1 tool call 类型包括 `get_environment`、`read_files`、`search_workspace`、`apply_patch`、`write_file`、`run_command`、`ask_user`、`todo_update`、`background_start/read/stop`、`subagent_start/read/stop`。
- 气泡、工具调用和终端内容都必须保持可扫描，不使用装饰性填充内容。

## 7. 页面模式

- Agents：管理可运行 agent、能力边界、运行入口和 fork 分支动作。
- Branches：支持并行探索、分支评审和选择性采纳；明确不会自动合并记忆、上下文或任务历史。
- Approvals：围绕风险处理，解释动作、影响范围、来源 run/branch 和批准后的结果。
- Skills：审查自我学习产物、版本差异、来源证据和发布风险。
- Client：展示已绑定客户端、设备名称、操作系统、在线状态、版本、工作目录和备注操作。
- Dashboard：只展示真实总览信号，不用冗余标题区撑空间。

## 8. 动效与交互

- 动效表达状态变化、路由切换、侧栏折叠、流式输出和 pending，不做无意义循环动画。
- 路由切换仅让内容轻微淡入和短距离位移，AppShell 保持稳定。
- 所有 transition 不得改变布局尺寸，避免列表、按钮、终端和侧栏抖动。
- 必须支持 `prefers-reduced-motion`。
- 写操作必须有 pending、success、failure 状态；高风险操作需要明确确认。

## 9. 可访问性与响应式

- 图标按钮必须有 `aria-label` 或 tooltip。
- 重要状态不能只依赖颜色，必须配合文字或 badge。
- 明暗主题都要保证正文、按钮、badge、日志和 diff 的对比度。
- 768px 以下侧栏可保持折叠，详情面板改为单列或抽屉式呈现。

## 10. 实现约束

- 先维护 tokens、AppShell、核心组件，再扩展页面。
- mock 数据必须来自项目定义的 API fixture；后端接入后替换数据源。
- 任何新页面都要先说明用途、主要对象、可执行动作和失败状态。
- 更新 UI 时同步测试和本文档，避免设计规则停留在口头约定。
