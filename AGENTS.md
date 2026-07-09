# Repository Guidelines

## Project Structure & Module Organization

BrainX is organized as a three-part B/S/C system:

- `apps/browser/` contains the React browser workbench.
- `apps/server/` contains the Spring Boot control plane.
- `apps/client-daemon/` contains the Rust local daemon and CLI.
- `scripts/` contains local development and install helpers.
- `docs/` contains design notes and project references when needed.

Keep generated output, local logs, screenshots, private notes, and runtime state out of the repository.

## Build, Test, and Development Commands

- `cd apps/browser && npm test -- --run` runs the browser test suite.
- `cd apps/browser && npm run build` builds the browser app.
- `cd apps/server && source ../../scripts/use-local-toolchains.sh && mvn test` runs server tests.
- `cd apps/client-daemon && source ../../scripts/use-local-toolchains.sh && cargo test` runs daemon tests.
- `scripts/install-client.sh` builds and installs the `brainx` CLI to `~/.brainx/bin` by default.

Use `README.md` for the full local startup flow.

## Coding Style & Naming Conventions

Follow the existing style in each app. Browser code uses TypeScript and React components with colocated CSS. Server code uses Java package conventions under `com.brainx.server`. Client daemon code follows standard Rust module and test naming.

Prefer clear, narrowly scoped modules. Keep UI mock data separate from API services, and keep C-side tool execution separate from model/provider plumbing.

## Testing Guidelines

Add or update tests for behavior changes. Browser tests live under `apps/browser/src/__tests__/`, server tests under `apps/server/src/test/`, and daemon tests under `apps/client-daemon/tests/`.

For cross-component behavior, cover the owning boundary first: C-side tools in Rust tests, S-side routing/state in Java tests, and B-side rendering/interaction in React tests.

## Commit & Pull Request Guidelines

Use concise imperative commit messages such as `Add client state persistence` or `Fix model switching`. Pull requests should include a short summary, test results, UI screenshots for visual changes, and any configuration or migration notes.

## Security & Configuration Tips

Never commit API keys, passwords, local `~/.brainx` state, logs, screenshots, or private agent notes. Use placeholder examples in `.env.example` and `env:VARIABLE_NAME` references in daemon configuration.
