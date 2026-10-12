# End-to-end tests (real VS Code)

These tests drive a **real VS Code window** with only this extension loaded: real key presses and mouse clicks, the real
masked API-key input box, real hovers and CodeLens, and real notifications, read back from the window's DOM over the Chrome
DevTools protocol. They exist because most of what can go wrong in this extension (a server that comes up on the wrong
port, a status bar that says "disconnected" for a healthy server, a CodeLens that reads "0 callers") only shows up when
the whole chain runs: extension, REST server, database.

They need no extra npm packages (Node 22's built-in `WebSocket`).

## Run

```bash
# 1. once: compile the extension
npm run compile

# 2. build the fixtures, using the CodePulse BACKEND's Python (the one with `codepulse` installed)
C:\path\to\CodePulse\.venv\Scripts\python.exe test\e2e\setup-fixtures.py ^
    --test-repo C:\path\to\Test_Repo --test-repo-other C:\path\to\Test_Repo_Other

# 3. run everything (or name scenarios: core folders server-launch workspace-index-mcp)
npm run test:e2e
```

Everything is created under `.e2e/` (gitignored): copies of the two sample projects, a throwaway database, an admin API
key, an **isolated VS Code profile** (your own settings and extensions are not touched) and screenshots of each step in
`.e2e/shots/`. Your real `codepulse.db` is never used. The runner starts and stops its own CodePulse server on port 8200.

Windows only as written (default VS Code location, PowerShell helpers). Set `CODE_EXE` if VS Code is installed elsewhere.
Windows will open and close on your screen while it runs; leave them alone.

The expectations are tied to the sample project (for example 55 symbols, `calculate_distance`, `Shape`/`Polygon`), so the
fixtures must be built from that project.

## What each scenario covers

| Scenario | Checks |
|---|---|
| `core` | A cold server shows as connected; the API key is entered through the real input box; the status bar shows the real symbol count; hover (and no hover on a blank line); CodeLens `N callers · M callees` and the grouped impact list it opens; Search and the jump to the right file and line; the References and Similar Code sidebars; Module Structure; the "no server is reachable" warning with Start Server. |
| `folders` | A never-indexed folder reads "not indexed" and offers Index Workspace (a different message from "server unreachable"); a multi-root workspace asks which folder to search, and the status bar follows the active editor. |
| `server-launch` | With no server running and a non-default `serverUrl`, the extension offers to start one, **launches it on the configured port**, and connects. |
| `workspace-index-mcp` | Index Workspace on an indexed folder shows progress and finishes; the extension's MCP server is listed, starts, reaches Running, and its tools are discovered; Index Workspace on a never-indexed folder (known gap, below). |

## Known gap

`E3` (Index Workspace on a **never-indexed** folder) is expected to fail and is reported as a known gap, not a
regression. A key may create a new repository, but polling the resulting job needs a grant on that repository, which the
creating key does not have, so the extension reports "lost track of indexing job … API key is not scoped to repository N"
and the folder still reads "not indexed". It is a backend authorization decision, not an extension bug. When it is fixed,
remove `E3` from `KNOWN_GAPS` in `run-all.mjs`.

## Not covered

The Marketplace publish flow, and a real MCP-aware assistant calling the tools (the suite stops at "server running, tools
discovered"). A VS Code update waiting to install blocks any second instance from starting ("Code is currently being
updated"); finish the update first.

Pure logic (server-launch arguments, the repository cache, 429 retry) is covered by the fast unit tests: `npm test`.
