# brainx Minimal B/S/C Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real B -> S -> C -> NVIDIA/tool -> S -> B agent conversation loop on the current local device.

**Architecture:** S remains the in-memory control plane and owns run state, chat messages, execution requests, and loop progression. C registers to S, polls execution requests, uses local `NVIDIA_API_KEY` for `model.invoke`, executes only LLM-requested read tools, and posts results. B keeps the existing shell but switches Chat to a real S API in dev, with test-mode mock fallback.

**Tech Stack:** Spring Boot 3.5, Rust/reqwest/tokio, React/Vite/Vitest, NVIDIA OpenAI-compatible `/v1/chat/completions`.

---

### Task 1: S端 Chat Loop Contract

**Files:**
- Modify: `apps/server/src/main/java/com/brainx/server/api/BrainxApiController.java`
- Modify: `apps/server/src/main/java/com/brainx/server/core/BrainxState.java`
- Create: focused records under `apps/server/src/main/java/com/brainx/server/core/`
- Test: `apps/server/src/test/java/com/brainx/server/AgentLoopFlowTest.java`

- [ ] Write MockMvc tests for `GET /api/v1/workspaces/{workspaceId}/chat/session`, `POST /api/v1/workspaces/{workspaceId}/chat/messages`, C polling, model tool-call result, tool result, final model result, and completed chat rendering.
- [ ] Verify tests fail because chat endpoints and loop progression are missing.
- [ ] Add seeded local workspace `w_core`, agent `a_core`, branch `br_core`, and a default chat session for dev.
- [ ] Add chat message/block records and endpoint DTOs matching B端 `ChatSession`.
- [ ] Extend execution handling so `model.invoke(tool_selection)` can create tool execution requests, tool results can create `model.invoke(final_response)`, and final model results complete the run.
- [ ] Keep first-loop limits explicit: one run at a time per message, one model-tool-model cycle, read tools only.
- [ ] Run server tests and keep existing branch/skill tests green.

### Task 2: C端 NVIDIA Model Executor

**Files:**
- Create: `apps/client-daemon/src/model.rs`
- Modify: `apps/client-daemon/src/daemon.rs`
- Modify: `apps/client-daemon/src/protocol.rs`
- Modify: `apps/client-daemon/src/main.rs`
- Test: `apps/client-daemon/tests/model_invoke_test.rs`, `apps/client-daemon/tests/protocol_flow_test.rs`

- [ ] Write Rust tests using `wiremock` for `model.invoke`: request includes bearer auth, messages/tools payload, parses assistant text and OpenAI-compatible `tool_calls`.
- [ ] Verify tests fail because model invocation is unsupported.
- [ ] Add provider config: `NVIDIA_API_KEY`, `BRAINX_NVIDIA_MODEL` default `meta/llama-3.1-8b-instruct`, `BRAINX_NVIDIA_BASE_URL` default `https://integrate.api.nvidia.com/v1`.
- [ ] Implement `model.invoke` via `POST /chat/completions`; return normalized `{ message: { content, toolCalls }, model, usage }`.
- [ ] Preserve existing local read tools and reject unsupported or missing-key model requests with structured failed results.
- [ ] Run C端 tests.

### Task 3: B端 Real Chat API

**Files:**
- Create: `apps/browser/src/services/brainxApi.ts`
- Modify: `apps/browser/src/pages/ChatPage.tsx`
- Modify: `apps/browser/vite.config.ts`
- Test: `apps/browser/src/__tests__/realChatApi.test.ts`, existing Chat tests

- [ ] Write service tests for fetching the real chat session, sending a message, and polling updated run state.
- [ ] Verify tests fail because the real API service is missing.
- [ ] Add a typed API client that uses `/api/v1` and Vite proxy to `http://127.0.0.1:8080`.
- [ ] ChatPage uses real API outside test/mock mode and existing mock API in Vitest mode.
- [ ] Render server-provided text, tool call, tool result, context, and final assistant blocks using existing UI components.
- [ ] Run browser tests and production build.

### Task 4: Manual Closed-Loop Verification

**Files:**
- Modify docs only if command names change.

- [ ] Start S端: `cd apps/server && source ../../scripts/use-local-toolchains.sh && mvn spring-boot:run`.
- [ ] Start C端: `cd apps/client-daemon && source ../../scripts/use-local-toolchains.sh && cargo run -- --workspace-id w_core --workspace-root ../..`.
- [ ] Start B端: `cd apps/browser && npm run dev`.
- [ ] In Chat, send: `请查看当前 workspace，并用工具总结项目结构。`
- [ ] Verify B shows user message, LLM tool call, tool result, and final assistant answer.
- [ ] Verify S run reaches `completed`; verify C used `NVIDIA_API_KEY` without logging it.
