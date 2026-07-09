# brainx Client Daemon

C-side local daemon for BrainX. It registers with the S-side server, polls execution requests, calls the configured model provider, executes local tools, and streams model/tool results back to S.

The daemon keeps local runtime state under `~/.brainx` on Linux/macOS or `%USERPROFILE%\.brainx` on Windows. Secrets should stay in environment variables and be referenced from `config.json` with `env:VARIABLE_NAME`.

## Commands

```bash
../../scripts/install-client.sh
export PATH="$HOME/.brainx/bin:$PATH"
brainx status
brainx --server-url http://localhost:8080 start
brainx bind
brainx unbind --confirm
brainx stop
```

Development commands:

```bash
cargo test
cargo run -- \
  --server-url http://localhost:8080 \
  run-foreground
```

Environment variables are also supported:

```bash
BRAINX_SERVER_URL=http://localhost:8080
BRAINX_DEVICE_NAME="$(hostname)"
BRAINX_POLL_INTERVAL_MS=1000
BRAINX_CONFIG_PATH=/path/to/config.json
```

## Configuration

The default config is created at `~/.brainx/config.json` and uses placeholder provider references. Replace the provider names, URLs, protocols, model IDs, and environment variable names with the services you actually use. A typical local config looks like:

```json
{
  "serverUrl": "http://127.0.0.1:8080",
  "deviceName": "your-hostname",
  "providers": [
    {
      "name": "primary",
      "baseUrl": "https://api.primary-model.example/v1",
      "apiKey": "env:BRAINX_MODEL_API_KEY",
      "protocol": "openai"
    }
  ],
  "webSearch": {
    "provider": "tavily",
    "baseUrl": "https://api.tavily.com",
    "apiKey": "env:BRAINX_WEB_SEARCH_API_KEY",
    "timeoutSeconds": 20
  },
  "modelContextWindows": {
    "primary:example-chat-model": 256000
  }
}
```

## Current Local Tools

The C-side daemon executes the local workspace tools below. S-side may add internal fields (`toolCallId`, `toolName`, `batchId`) to correlate execution requests; tool implementations ignore those fields. Other unknown fields are rejected so preview mocks and model calls stay aligned with the S/C contract.

| Tool | Input |
| --- | --- |
| `get_env` | `{}` |
| `read_files` | `{ "files": [{ "path": string, "startLine"?: number, "endLine"?: number }] }` |
| `search_workspace` | `{ "query": string, "mode"?: "text" \| "filename" \| "regex", "maxResults"?: number }` |
| `apply_patch` | `{ "patch": string, "dryRun"?: boolean }` |
| `write_file` | `{ "path": string, "content": string, "overwrite": boolean, "createParents"?: boolean }` |
| `run_command` | `{ "command": string, "workingDirectory"?: string, "timeoutSeconds"?: number }` |
| `background_start` | `{ "name": string, "command": string, "purpose": string, "workingDirectory"?: string, "maxRuntimeSeconds"?: number }` |
| `background_read` | `{ "taskId": string, "cursor"?: number, "maxBytes"?: number }` |
| `background_stop` | `{ "taskId": string, "mode"?: "terminate" \| "kill" }` |
| `web_search` | `{ "query": string, "searchDepth"?: "basic" \| "advanced", "maxResults"?: number, "includeAnswer"?: boolean }` |

`ask_user` is a browser/server tool and is not dispatched to the local daemon. `mock_provider` is kept only for legacy/internal testing and is not part of the model-facing tool list.

The daemon allows read tools to inspect paths outside the current workspace, but write and command execution tools are constrained to the current workspace. `run_command` is for short one-shot commands only. Long-running commands must use the background task tools, which buffer stdout/stderr, support incremental reads, allow stop control, and enforce `maxRuntimeSeconds`.

Tool results are bounded before they enter S-side context. Large `read_files` content, search previews, command streams, diffs, and background output reads are truncated with explicit `*Truncated` or `truncated` flags. Directory ignores such as `logs/` are only a defensive search filter; they are not the primary context-size control.
