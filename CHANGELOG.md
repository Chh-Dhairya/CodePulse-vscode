# Changelog

All notable changes to the CodePulse VS Code extension are documented in this file.

## [Unreleased] — Phase 4 (polish)

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
