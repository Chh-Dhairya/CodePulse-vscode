# Changelog

All notable changes to the CodePulse VS Code extension are documented in this file.

## [Unreleased]

Publishing metadata:

- The publisher is now `codepulse-repository-indexer`: `codepulse` is registered by someone else, and the Marketplace/`vsce` accept only letters, digits and hyphens. The manifest and README now link the source repository, the issue tracker and the home page (`vsce package` no longer warns about a missing `repository`).
- Tests: a `packaged-install` scenario that installs the built `.vsix` into a fresh VS Code with no development path (every other scenario loads the source folder); guards that the publisher id is valid and the repository metadata is present. Two races in the end-to-end harness were fixed along the way (the API-key helper typed into the closing Command Palette; three scenarios looked at the self-dismissing "Start Server?" notification too late). The extension's own code did not change.

First-run flow (needs the backend that adds `codepulse key create` and the per-user database; both ship in `codepulse-engine` 0.1.0):

- Fixed: a new user could not get a first API key. The key prompt and README said "create one with the CodePulse CLI", but the CLI had no such command, and the server endpoint needs a key that already exists. They now give the exact command, `codepulse key create --repo <your folder>`, which the backend now provides: it prints the key once and registers the folder, so Set API Key and Index Workspace work straight away.
- Changed: CodePulse keeps its database in your per-user data directory, not inside the project you opened. Before, the server the extension started wrote a `codepulse.db` into every project (and into the MCP server's working directory); the README now says where the data lives.

Security (found while checking the extension was safe to publish; these change behaviour):

- Fixed: a repository could choose which program the extension runs. `codepulse.serverCommand` was run with `shell: true` and could be set by a project's own `.vscode/settings.json`, so opening a hostile repository and clicking the "Start Server" button ran an arbitrary command. `codepulse.serverCommand` and `codepulse.serverUrl` are now machine-scoped (user settings only), the server is started as a single program with no shell, and nothing is started in an untrusted workspace. The same applies to the MCP server definition, which carries the API key in its environment.
- Fixed: a repository could redirect the API key. A workspace `codepulse.serverUrl` made the extension send the stored key to whatever address the project named. It is machine-scoped now, as above.
- Changed (a consequence of the two fixes): `codepulse.serverUrl` and `codepulse.serverCommand` can no longer be set per project; set them in user settings. `codepulse.serverCommand` is one program name or path (it used to be passed to a shell, so a command line such as `python -m codepulse` worked; use the `codepulse` executable's path).
- The manifest now declares limited support in untrusted workspaces and no support in virtual workspaces.
- Tests: 24 new unit tests (the launch plan, launch-error messages, and guards on the manifest, `.vscodeignore` and README) and two new real-window scenarios, `hostile-workspace` and `dont-ask-again` and a `packaged-install` scenario that installs the built `.vsix` into a fresh VS Code and checks it activates, connects and registers its commands (54 end-to-end checks in all). `hostile-workspace` was run against the previous code first: there the hostile repository's command ran and its decoy server received requests.

Start-up prompt and launch errors:

- The "Start one locally now?" prompt shows the exact command line it will run, has a **Don't Ask Again** button (sets `codepulse.autoLaunchServer` to `false`), and is not shown when no folder is open or the workspace is untrusted.
- A server that cannot be started (backend not installed, not executable, a Windows `.cmd` wrapper) is reported at once with what to do about it, instead of after the 10-second wait.

Packaging and documentation:

- The CI workflow file is no longer shipped inside the `.vsix`.
- The README is rewritten for Marketplace users: how to install the backend and what it needs, the setting scopes, privacy and security, supported languages, known limitations. The development-time "Publishing" section is gone.

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
