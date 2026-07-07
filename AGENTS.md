# Repository Guidelines

## Project Structure & Module Organization

This repository currently contains no source, test, or asset files. When adding implementation code, keep the top-level layout predictable:

- `src/` for application or library code.
- `tests/` for automated tests that mirror `src/` paths.
- `assets/` for static files such as images, fixtures, or sample data.
- `docs/` for design notes, operating instructions, and contributor references.

Avoid placing generated build output or dependency caches in the repository. Update this guide when a concrete framework or module layout is introduced.

## Build, Test, and Development Commands

No build, test, or local development commands are defined yet. When tooling is added, document the canonical commands in `README.md` and keep this section in sync. Prefer standard entry points such as:

- `npm test`, `pytest`, `cargo test`, or equivalent for the full test suite.
- `npm run build`, `make build`, or equivalent for production artifacts.
- `npm run dev`, `make dev`, or equivalent for local development.

## Coding Style & Naming Conventions

Follow the formatter and linter provided by the chosen language stack once one exists. Until then, use consistent indentation within each file, descriptive names, and small modules with a single responsibility. Use lowercase, hyphenated directory names such as `user-flows/`; use language-standard file naming for source files.

## Testing Guidelines

Add tests with any new behavior. Keep unit tests close to the modules they validate through mirrored paths under `tests/`. Use clear names that describe behavior, for example `test_user_can_create_session` or `session-manager.spec.ts`. Include regression tests when fixing bugs.

## Commit & Pull Request Guidelines

No readable Git history is available in this workspace, so no project-specific commit convention can be inferred. Until a convention is established, use concise imperative commits such as `Add session validation` or `Fix build configuration`.

Pull requests should include a short description, relevant issue links, test results, and screenshots or recordings for UI changes. Call out configuration, migration, or security implications explicitly.

## Security & Configuration Tips

Do not commit secrets, local credentials, dependency caches, or generated artifacts. Provide sample configuration files such as `.env.example` when environment variables become required.
