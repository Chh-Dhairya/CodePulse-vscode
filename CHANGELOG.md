# Changelog

All notable changes to the CodePulse VS Code extension are documented in this file.

## [Unreleased]

Publishing preparation:

- Marked as a Marketplace preview release (`preview: true`); the README status line now says so instead of describing an in-progress phase.
- Upgraded the dev-only packaging tool `@vscode/vsce` to 4.x, which clears the 6 high-severity `npm audit` advisories (all in its dependency chain; the extension has no runtime dependencies). `vsce` 4 needs Node 22 or newer.
- Added a GitHub Actions workflow: compile, unit tests, and `vsce package`.

Found and fixed by driving the extension in a real VS Code window (see `test/e2e/README.md`):

- Fixed: a freshly started server was shown as disconnected. Reachability now uses `/health/live`; `/health/ready` answers 503 until the server's lazily loaded embedding model loads, and nothing in the extension triggers that, so a healthy new server looked down and auto-launch waited on a check that could never pass.
- Fixed: "Start Server" always started the server on port 8000, whatever `codepulse.serverUrl` said, so with any other port the extension never connected. The launched server now listens on the configured host and port; a non-local or non-`http` `serverUrl` gets a clear message instead of a launch.
- Fixed: Index Workspace on a folder that was already indexed could create a duplicate repository instead of re-indexing it (VS Code reports `c:\...`, the server had it as `C:\...`). It now sends the stored repository URL when the folder matches.
- Rate limiting: the repository lookup (about a third of all requests) is cached for 30 seconds and shared by concurrent callers, invalidated when the API key changes or an index run finishes; a `429` is retried up to twice, honouring the server's `Retry-After` (capped at 5 seconds).
- Tests: 23 fast unit tests (`npm test`) and a real-window end-to-end suite (`npm run test:e2e`, 36 checks) covering hover, CodeLens, Search, the sidebars, Module Structure, status bar, error states, multi-root, Start Server, Index Workspace and the MCP registration.

## Phase 4 (polish)

- Multi-root workspace support: Index Workspace, Search, and Module Structure now prompt for which folder when more than one is open, instead of silently only ever operating on the first one. The status bar follows the active editor's own folder.
- Clearer error states: Search and Module Structure now distinguish "no CodePulse server is reachable" from "this repository isn't indexed yet," each with an actionable button, instead of one generic message covering both.
- Packaging: added a Marketplace icon, `LICENSE` (MIT), and `vsce`-based `npm run package` script.

## 0.1.0 — Phase 3 (MCP integration)

- Registers `codepulse serve --mcp` as a discoverable MCP server provider, so MCP-aware chat participants (Copilot Chat, Claude, Cline, etc.) get CodePulse's tools automatically.

## Phase 2 (core navigation)

- Index Workspace and Search commands.
- Hover provider and CodeLens ("N callers · M callees") with a clickable impact-analysis panel.
- References and Similar Code sidebar views.
- Module Structure command.

## Phase 1 (foundation)

- Server detection and managed local launch (`codepulse serve`).
- API key storage via `SecretStorage`.
- Status bar connection/indexing indicator.
