import * as vscode from "vscode";
import { CodePulseClient } from "./client";
import { ServerManager } from "./serverManager";
import { AuthManager } from "./auth";
import { StatusBarController } from "./statusBar";

/**
 * Phase 1 (foundation) of the CodePulse VS Code extension, per
 * CODEPULSE_CLIENT_STRATEGY.md's own plan: activation (detect or offer
 * to launch a local server), settings, API-key storage via
 * SecretStorage, and a status-bar indexing indicator. Deliberately does
 * NOT implement search, hover, CodeLens, or any other Phase 2+ feature
 * yet -- those are separate, later milestones, each its own thin
 * caller of an already-existing CodePulse REST endpoint, never a
 * reimplementation of retrieval/ranking/graph logic client-side (§23).
 */

let serverManager: ServerManager | undefined;
let statusBar: StatusBarController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("CodePulse");
  context.subscriptions.push(output);
  output.appendLine("CodePulse extension activating...");

  const auth = new AuthManager(context.secrets);
  const client = new CodePulseClient(
    () => vscode.workspace.getConfiguration("codepulse").get<string>("serverUrl", "http://127.0.0.1:8000"),
    () => auth.getApiKey(),
  );

  statusBar = new StatusBarController();
  context.subscriptions.push(statusBar);

  serverManager = new ServerManager(client, output);
  context.subscriptions.push(serverManager);

  context.subscriptions.push(
    vscode.commands.registerCommand("codepulse.setApiKey", async () => {
      const saved = await auth.setApiKeyInteractive();
      if (saved) {
        await refreshConnectionState(client, output);
      }
    }),
    vscode.commands.registerCommand("codepulse.checkConnection", () => checkConnection(client, output)),
    vscode.commands.registerCommand("codepulse.startServer", async () => {
      statusBar?.setState("connecting");
      const started = await serverManager!.launchServer();
      if (started) {
        vscode.window.showInformationMessage("CodePulse server is running.");
        await refreshConnectionState(client, output);
      } else {
        statusBar?.setState("disconnected");
        vscode.window.showWarningMessage(
          "CodePulse server did not become reachable in time. Check the \"CodePulse\" output channel.",
        );
      }
    }),
  );

  await initializeConnection(client, output);
}

export function deactivate(): void {
  serverManager?.dispose();
  statusBar?.dispose();
}

async function initializeConnection(client: CodePulseClient, output: vscode.OutputChannel): Promise<void> {
  statusBar?.setState("connecting");
  const healthy = await client.health();
  if (healthy) {
    await refreshConnectionState(client, output);
    return;
  }

  const started = await serverManager?.ensureServerRunning();
  if (started) {
    await refreshConnectionState(client, output);
  } else {
    statusBar?.setState("disconnected");
  }
}

async function checkConnection(client: CodePulseClient, output: vscode.OutputChannel): Promise<void> {
  statusBar?.setState("connecting");
  const healthy = await client.health();
  if (healthy) {
    vscode.window.showInformationMessage("CodePulse server is reachable.");
    await refreshConnectionState(client, output);
    return;
  }

  statusBar?.setState("disconnected");
  const choice = await vscode.window.showWarningMessage(
    "CodePulse server is not reachable.",
    "Start Server",
    "Dismiss",
  );
  if (choice === "Start Server") {
    const started = await serverManager?.launchServer();
    if (started) {
      await refreshConnectionState(client, output);
    } else {
      statusBar?.setState("disconnected");
    }
  }
}

/**
 * Once the server is known reachable, resolves the current workspace's
 * own indexed-repository entry (if any) by matching `RepositoryModel.
 * url` -- the absolute local path for a locally-indexed repository --
 * against the open workspace folder's own path, via `GET
 * /v1/repositories` (Phase 0). Shows a real, measured symbol count in
 * the status bar when a match is found, "not indexed" when the
 * workspace isn't in the list at all -- never a fabricated number.
 */
async function refreshConnectionState(client: CodePulseClient, output: vscode.OutputChannel): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    statusBar?.setState("connected");
    return;
  }

  try {
    const repos = await client.listRepositories();
    const match = repos.find((r) => normalizePath(r.url) === normalizePath(folder.uri.fsPath));
    if (match) {
      statusBar?.setState("connected", `${match.symbol_count} symbols`);
    } else {
      statusBar?.setState("connected", "not indexed");
    }
  } catch (err: any) {
    // A key may simply not be set yet, or may not be scoped to
    // anything -- either way, this is not a connectivity failure, so
    // the status bar still reports "connected," just without a
    // specific workspace match.
    output.appendLine(`Could not list repositories: ${err?.message ?? err}`);
    statusBar?.setState("connected");
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
