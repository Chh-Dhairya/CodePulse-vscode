# CodePulse for VS Code

Bring [CodePulse](https://github.com/) — a local-first, agent-native code intelligence engine — into VS Code. This extension is a thin presentation layer over a CodePulse REST server running on your own machine; it never re-implements search, ranking, or graph logic itself, only calls the same API the CLI and MCP server already use.

**Status: Phase 1 (foundation).** This is an early, in-progress build. What exists today:

- Detects a running local CodePulse server, or offers to launch one (`codepulse serve`).
- Stores your API key securely (VS Code's `SecretStorage`, never a plain settings file).
- A status-bar indicator showing connection and indexing status for the current workspace.

Search, symbol hover, references, impact analysis, and similar-code panels are planned for later phases — not implemented yet.

## Requirements

- A working [CodePulse](../CodePulse) installation, reachable via the `codepulse` command on your `PATH` (or configure `codepulse.serverCommand` to an absolute path).
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

## Development

```bash
npm install
npm run compile   # or: npm run watch
```

Then press `F5` in VS Code to launch an Extension Development Host with this extension loaded.

## Relationship to the CodePulse backend

This extension is deliberately a separate project/repository from the [CodePulse backend](../CodePulse) itself (a different tech stack — TypeScript against the `vscode` extension API, vs. the backend's Python/FastAPI), per the CodePulse roadmap's own framing (§23, backlog item B22: "New extension repo/package"). See `CodePulse/CODEPULSE_CLIENT_STRATEGY.md` in the backend repository for the full plan this extension is being built against.
