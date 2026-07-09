# BrainX

BrainX is an early B/S/C agent system prototype:

- **B side**: React browser workbench for chat, sessions, clients, dashboard, and skills.
- **S side**: Spring Boot control plane with SQLite state, client binding, chat sessions, streaming events, and execution request routing.
- **C side**: Rust local daemon that binds to S, calls configured model providers, executes local tools, and returns streaming/tool results.

This repository is a first testable version. The core chat loop, tool execution, model switching, client binding, session state, skills review, and Tavily-backed `web_search` are the current focus. Agents and branch workflows are intentionally marked as future roadmap work in the UI.

## Requirements

- Node.js 20.19+ or 22.12+
- Java 21 and Maven
- Rust toolchain
- API keys for the model/search providers you plan to use

The repository includes `scripts/use-local-toolchains.sh` for the local development toolchains used in this workspace.

## Configuration

Copy `.env.example` to `.env` for local shell configuration, then provide your own secrets:

```bash
NVIDIA_API_KEY=...
SHANGAN_API_KEY=...
TAVILY_API_KEY=...
```

The C-side daemon stores runtime config in `~/.brainx/config.json`. Use `env:VARIABLE_NAME` values there instead of committing literal secrets.

## Run Locally

Start S side:

```bash
cd apps/server
source ../../scripts/use-local-toolchains.sh
mvn spring-boot:run
```

Start B side:

```bash
cd apps/browser
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Install and start C side:

```bash
scripts/install-client.sh
export PATH="$HOME/.brainx/bin:$PATH"
brainx --server-url http://127.0.0.1:8080 start
brainx status
```

Open `http://127.0.0.1:5173/`.

## Verification

```bash
cd apps/client-daemon && source ../../scripts/use-local-toolchains.sh && cargo test
cd apps/server && source ../../scripts/use-local-toolchains.sh && mvn test
cd apps/browser && npm test -- --run && npm run build
```

## Security Notes

Do not commit local state, secrets, logs, screenshots, generated output, or `~/.brainx` files. The checked-in configuration examples use placeholders only.
