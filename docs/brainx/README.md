# brainx 文档索引

brainx 是一个面向开发工作的 agent 平台，采用 B/S/C 三端架构。本文档集先固化 agent 核心机制，再按产品契约和端侧职责拆分开发细节。

当前以 [Agent Core 规格](./agent-core-spec.md) 作为 agent runtime、分支、skill、动态子 Agent 和持久终端机制的优先事实源。旧的产品/API/S/C 文档如有冲突，后续按 Agent Core 规格同步。

## 阅读顺序

1. [Agent Core 规格](./agent-core-spec.md)  
   优先事实源。定义 agent loop、动态子 Agent、工具、持久终端、Branch Agent、branch capsule 合并和 Markdown-only skill 迭代。
2. [产品与接口总纲](./product-api-overview.md)  
   平台契约草案。定义产品定位、三端职责、核心实体、REST API、WebSocket 事件、安全边界和验收场景；与 Agent Core 冲突处待同步。
3. [S 端规格](./server-spec.md)  
   Java Spring Boot 托管服务，负责状态、上下文、agent loop、skill、分支、审批、审计和 API。
4. [C 端规格](./client-daemon-spec.md)  
   Rust 本地守护进程，负责用户密钥、本地执行、模型/API 请求、工具能力和事件回传。
5. [B 端规格](./browser-spec.md)  
   React/TypeScript 用户界面，负责控制台、分支、skill 审核、审批队列和运行观察。
6. [B 端轻量设计规范](./browser-design-system.md)  
   前端页面设计基线，定义视觉方向、布局系统、token、动效、核心组件和页面模式。
7. [B 端前端原型实现计划](../superpowers/plans/2026-07-04-brainx-browser-prototype.md)  
   将设计规范落地为 Vite/React/TypeScript 原型的分步执行计划。

## 开发顺序

1. 先按 Agent Core 规格同步后端/客户端核心模型：agent loop、branch runtime、terminal session、skill proposal、policy/approval。
2. 再实现 S 端契约骨架：领域模型、事件、状态机、OpenAPI、WebSocket envelope 和 mock 响应。
3. C 端基于 S 端契约开发本地执行、心跳、持久终端和结果回传。
4. B 端原型先保持当前阶段，等 S/C 核心服务可联调后再继续改善。

## 当前实现入口

- `apps/server`：Spring Boot S 端原型，当前为内存态垂直切片。
- `apps/client-daemon`：Rust C 端原型，当前支持注册、polling、结果回传和安全只读 workspace tools。
- `.env.example`：本地 C 端连接 S 端的环境变量样例。
- `docker-compose.yml`：后续替换为 Postgres 持久化时使用的本地数据库服务。

## 契约规则

- B 端只连接 S 端，不直接调用模型提供商、本地工具或 C 端。
- C 端持有用户 API key，并实际发起模型/API/本地工具请求。
- S 端托管上下文、状态机和策略，但不保存模型 API key 明文。
- REST 资源使用稳定英文复数名，例如 `agents`、`branches`、`skills`。
- WebSocket 事件使用 `domain.event` 命名，例如 `agent.run.updated`。
