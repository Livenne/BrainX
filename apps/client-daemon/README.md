# brainx Client Daemon

C-side local daemon prototype for brainx. It registers with the server, polls execution requests, executes safe local read tools or the mock provider, and posts structured results.

## Commands

```bash
cargo test
cargo run -- \
  --server-url http://localhost:8080 \
  --workspace-id w_example \
  --device-name local-dev \
  --workspace-root /path/to/workspace
```

Environment variables are also supported:

```bash
BRAINX_SERVER_URL=http://localhost:8080
BRAINX_WORKSPACE_ID=w_example
BRAINX_DEVICE_NAME=local-dev
BRAINX_WORKSPACE_ROOT=/path/to/workspace
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

`ask_user` is a browser/server tool and is not dispatched to the local daemon. `mock_provider` is kept only for legacy/internal testing and is not part of the model-facing tool list.

The daemon rejects workspace file access outside the configured workspace root. `run_command` is for short one-shot commands only. Long-running commands must use the background task tools, which buffer stdout/stderr, support incremental reads, allow stop control, and enforce `maxRuntimeSeconds`.

Tool results are bounded before they enter S-side context. Large `read_files` content, search previews, command streams, diffs, and background output reads are truncated with explicit `*Truncated` or `truncated` flags. Directory ignores such as `logs/` are only a defensive search filter; they are not the primary context-size control.
