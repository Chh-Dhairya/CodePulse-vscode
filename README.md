# CodePulse for VS Code

Search, navigate and assess the impact of changes in a codebase from inside VS Code, using [CodePulse](https://pypi.org/project/codepulse-engine/): a local-first code intelligence engine that combines keyword search, semantic search and a call graph. Everything runs on your own machine. This extension is a thin front end over a CodePulse server on your computer; it never sends your code anywhere else.

**Status: preview (0.1.0).** The features below work and are covered by unit tests and a real-VS-Code end-to-end suite, but the extension has not had wide use yet, so expect rough edges (see [Known limitations](#known-limitations)).

## What it does

- **CodePulse: Search** — one search box over hybrid keyword + semantic + graph search; pick a result to jump to it.
- **Hover** over a function, class or method to see its type, docstring and complexity.
- **CodeLens** above every symbol showing "N callers · M callees"; click it for a browsable impact-analysis list.
- **Sidebar views** (CodePulse icon in the Activity Bar): **References** (direct callers and subclasses) and **Similar Code**, both following the cursor.
- **CodePulse: Module Structure** — browse a repository's module clusters.
- **CodePulse: Index Workspace** — indexes a folder (asks which one when several are open), with a progress notification.
- A **status-bar** indicator for connection and indexing state, following the active editor in multi-root workspaces.
- **MCP integration** — registers CodePulse's MCP server with VS Code, so MCP-aware assistants (GitHub Copilot Chat, Claude, Cline and others) get CodePulse's tools without separate setup.
- Clear "no server reachable" and "not indexed yet" states, each with a button that fixes it.

Supported languages: Python, JavaScript and TypeScript. Files in other languages are not indexed.

## Requirements

- **VS Code 1.101 or newer** (the MCP integration uses an API stabilized in that release).
- **The CodePulse backend**, which provides the `codepulse` command:

  ```bash
  pip install codepulse-engine
  ```

  It needs **Python 3.11 or 3.12**. The install is large (about 2.4 GB in a clean Windows test; it pulls in PyTorch), and the first time you index, it downloads a small embedding model (about 90 MB). Indexing runs on the CPU: a project of around 100 files takes a couple of minutes the first time, and later updates are much faster.

  On Windows, if `pip` stops with a "path too long" error, install into a virtual environment at a short path (for example `C:\cp`) or [enable long paths](https://pip.pypa.io/warnings/enable-long-paths).
- **An API key** for the repository you want to use. Create one with the CodePulse command line, or through the server's `POST /v1/admin/keys` endpoint if you already hold an admin key.

## Getting started

1. Install this extension and the backend (above).
2. Open the folder you want CodePulse to understand.
3. Run **CodePulse: Set API Key** from the Command Palette and paste in your key.
4. If no server is running, the extension offers to start one for you. The prompt shows the exact command it will run. You can also run **CodePulse: Start Local Server** yourself, or **CodePulse: Check Server Connection** at any time.
5. Run **CodePulse: Index Workspace**, then watch the status bar (bottom left): it shows the connection state and, once the folder is indexed, its symbol count.

If the extension says it cannot find `codepulse`, the backend is not installed or is not on your `PATH`: install it, or set `codepulse.serverCommand` to the full path of the `codepulse` executable.

## Settings

| Setting | Default | Description |
|---|---|---|
| `codepulse.serverUrl` | `http://127.0.0.1:8000` | Address of the CodePulse server. Your API key is sent to this address. |
| `codepulse.autoLaunchServer` | `true` | Offer to start a local server when none is reachable. Choosing **Don't Ask Again** in the prompt sets this to `false`. |
| `codepulse.serverCommand` | `codepulse` | The `codepulse` executable used to start the server: on `PATH`, or an absolute path. Run directly as one program, never through a shell. |

`codepulse.serverUrl` and `codepulse.serverCommand` are **machine-scoped**: set them in your user settings. A project's own `.vscode/settings.json` cannot change them, so a repository you open cannot choose which program the extension runs or which host receives your API key.

Your API key is not a setting. It is stored in VS Code's `SecretStorage`, set through **CodePulse: Set API Key**.

## Privacy and security

- There is **no telemetry**. The only network traffic is between the extension and the server address you configured, which is on your own machine by default.
- The extension never starts a program without asking, and the prompt shows the exact command line. In an **untrusted workspace** (Restricted Mode) it never starts a server and does not register its MCP server; search and navigation still work against a server that is already running.
- Your API key is kept in `SecretStorage`. It is passed to the MCP server through an environment variable, never as a command-line argument, so it does not show up in a process listing.

## MCP integration

Once an API key is set, the extension registers CodePulse as an MCP server provider with VS Code. VS Code starts `codepulse serve --mcp` itself (a separate process from the REST server this extension may also launch), and any MCP-aware chat participant can then call CodePulse's tools.

## Known limitations

- **Tested on Windows only.** macOS and Linux have not been tested yet.
- **Same-named methods in one file are merged in the call graph.** If two classes in a file both define `run`, the callers and callees (and the CodeLens counts) for `run` combine both. Search and navigation tell them apart.
- **Search is approximate.** Natural-language queries usually find the right symbol, not always; keyword queries on names are the most reliable. The first index of a large project can take a while on a CPU.
- Call-graph links are labelled with a confidence (`high`, `low`, `unresolved`), because a call like `obj.run()` does not say which `run` it means.

## Development

```bash
npm install
npm run compile   # or: npm run watch
npm test          # unit tests
```

Press `F5` in VS Code to launch an Extension Development Host with this extension loaded. `npm run package` builds an installable `.vsix`. The real-VS-Code end-to-end suite (`npm run test:e2e`, Windows only) is described in `test/e2e/README.md`.

This extension is deliberately a separate project from the CodePulse backend (TypeScript against the VS Code API, versus the backend's Python): see `docs/CODEPULSE_CLIENT_STRATEGY.md` in the backend repository for the plan it is built against.

## License

MIT — see the `LICENSE` file in this repository.
