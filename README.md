# CodePulse for VS Code

Bring CodePulse — a local-first, agent-native code intelligence engine — into VS Code. This extension is a thin presentation layer over a CodePulse REST server running on your own machine; it never re-implements search, ranking, or graph logic itself, only calls the same API the CLI and MCP server already use.

**Status: preview (0.1.0).** The features below work and are covered by unit tests and a real-VS-Code end-to-end suite, but the extension has not had wide use yet, so expect rough edges. What it does:

- Detects a running local CodePulse server, or offers to launch one (`codepulse serve`).
- Stores your API key securely (VS Code's `SecretStorage`, never a plain settings file).
- A status-bar indicator showing connection and indexing status for the repository you're currently looking at (follows the active editor in a multi-root workspace).
- **CodePulse: Index Workspace** — indexes a workspace folder (prompts you to choose one if more than one is open), with a progress notification tracking the job to completion.
- **CodePulse: Search** — a quick-pick over hybrid lexical + semantic + graph search; pick a result to jump to it.
- Hover over a function/class/method to see its type, docstring, and complexity.
- CodeLens above every symbol showing "N callers · M callees"; click it for a browsable impact-analysis list.
- Sidebar views (CodePulse icon in the Activity Bar) — **References** (direct callers/subclasses) and **Similar Code** — both follow the cursor.
- **CodePulse: Module Structure** — browse a repository's module clusters.
- Registers CodePulse's MCP server (`codepulse serve --mcp`) with VS Code automatically — any MCP-aware assistant in the editor (Copilot Chat, Claude, Cline, etc.) gets CodePulse's tools without separate setup.
- Clear "server unreachable" vs. "not indexed yet" error states, each with an actionable button.

Not yet published to the Marketplace — see [Publishing](#publishing) below.

## Requirements

- **VS Code 1.101 or newer** — this extension's MCP integration uses the `vscode.lm.registerMcpServerDefinitionProvider` API, stabilized in that release.
- A working CodePulse backend installation (the `codepulse-engine` Python package, which provides the `codepulse` command), reachable on your `PATH` (or configure `codepulse.serverCommand` to an absolute path).
- An API key for the repository you want to use — create one with the CodePulse CLI, or via `POST /v1/admin/keys` if you already have an admin-role key for the target repository.

## Getting started

1. Install this extension (from a `.vsix` for now — not yet published to the Marketplace).
2. Open the workspace/folder you want CodePulse to understand.
3. Run **CodePulse: Set API Key** from the Command Palette and paste in your key.
4. If no server is running, the extension will offer to start one locally for you. You can also run **CodePulse: Start Local Server** manually, or **CodePulse: Check Server Connection** at any time.
5. Watch the status bar (bottom left) — it shows connection state and, once a repository is indexed, its symbol count.

## Settings

| Setting | Default | Description |
|---|---|---|
| `codepulse.serverUrl` | `http://127.0.0.1:8000` | Base URL of the CodePulse REST API server. |
| `codepulse.autoLaunchServer` | `true` | Offer to launch a local server automatically if none is reachable at startup. |
| `codepulse.serverCommand` | `codepulse` | Command used to launch the local server (`<command> serve`). |

Your API key is **not** a setting — it's stored via VS Code's `SecretStorage`, set through the **CodePulse: Set API Key** command.

## MCP integration

Once an API key is set, this extension registers CodePulse as an MCP server provider with VS Code — no separate configuration needed. Any MCP-aware chat participant (GitHub Copilot Chat, Claude, Cline, etc.) can then call CodePulse's tools directly. Under the hood, VS Code starts `codepulse serve --mcp` itself (a separate, self-contained process from the REST server this extension may also launch); your API key is passed to it via an environment variable, never a command-line argument, so it isn't visible in a process listing on your machine.

## Development

```bash
npm install
npm run compile   # or: npm run watch
```

Then press `F5` in VS Code to launch an Extension Development Host with this extension loaded.

Run `npm run package` to produce an installable `.vsix` (via `@vscode/vsce`) without publishing anything.

## Relationship to the CodePulse backend

This extension is deliberately a separate project/repository from the CodePulse backend itself (a different tech stack — TypeScript against the `vscode` extension API, vs. the backend's Python/FastAPI), per the CodePulse roadmap's own framing (§23, backlog item B22: "New extension repo/package"). See `CODEPULSE_CLIENT_STRATEGY.md` in the backend repository for the full plan this extension is being built against.

## Publishing

This extension packages cleanly (`npm run package`, using [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce)) into an installable `.vsix`, but has **not** been submitted to the Marketplace. Two things only you can do, since they require your own Microsoft/Azure DevOps account and credentials:

1. **Register a publisher** at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) (or via `vsce create-publisher`) and update `publisher` in `package.json` from the current placeholder (`codepulse`) to your real, registered publisher ID.
2. **Get a Personal Access Token** (Azure DevOps, `Marketplace (Manage)` scope) and run `vsce publish` with it, or upload the `.vsix` manually through the Marketplace management page.

Also worth doing before a real submission: add a `repository` field to `package.json` once this project has a real git remote (currently local-only), and replace the placeholder MIT copyright holder in `LICENSE` if that's not who should hold it.

## License

MIT — see the `LICENSE` file in this repository.
