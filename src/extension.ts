import * as vscode from "vscode";
import { CodePulseClient } from "./client";
import { ServerManager } from "./serverManager";
import { AuthManager } from "./auth";
import { StatusBarController } from "./statusBar";
import { resolveWorkspaceRepository, SUPPORTED_LANGUAGE_SELECTOR } from "./workspaceRepo";
import { registerSearchCommand } from "./search";
import { registerIndexWorkspaceCommand } from "./indexWorkspace";
import { CodePulseHoverProvider } from "./hoverProvider";
import { CodePulseCodeLensProvider } from "./codeLensProvider";
import { registerShowImpactCommand } from "./impactPanel";
import { ActiveSymbolTracker } from "./activeSymbolTracker";
import { registerReferencesView } from "./referencesView";
import { registerSimilarCodeView } from "./similarView";
import { registerModuleStructureCommand } from "./moduleStructure";

/**
 * Phase 1 (foundation): activation (detect or offer to launch a local
 * server), settings, API-key storage via SecretStorage, a status-bar
 * indexing indicator.
 *
 * Phase 2 (core navigation), per CODEPULSE_CLIENT_STRATEGY.md's own
 * plan: Index Workspace / Search commands, a hover provider, a CodeLens
 * provider, References/Similar Code sidebar TreeViews, and a Module
 * Structure command -- every one a thin caller of an already-existing
 * CodePulse REST endpoint, never a reimplementation of
 * retrieval/ranking/graph logic client-side (§23).
 */

let serverManager: ServerManager | undefined;
let statusBar: StatusBarController | undefined;
let activeSymbolTracker: ActiveSymbolTracker | undefined;

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

  registerSearchCommand(context, client);
  registerIndexWorkspaceCommand(context, client);
  registerModuleStructureCommand(context, client);
  registerShowImpactCommand(context, client);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SUPPORTED_LANGUAGE_SELECTOR, new CodePulseHoverProvider(client)),
    vscode.languages.registerCodeLensProvider(SUPPORTED_LANGUAGE_SELECTOR, new CodePulseCodeLensProvider(client)),
  );

  activeSymbolTracker = new ActiveSymbolTracker(client);
  context.subscriptions.push(activeSymbolTracker);
  registerReferencesView(context, client, activeSymbolTracker);
  registerSimilarCodeView(context, client, activeSymbolTracker);

  await initializeConnection(client, output);
}

export function deactivate(): void {
  serverManager?.dispose();
  statusBar?.dispose();
  activeSymbolTracker?.dispose();
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
    const match = await resolveWorkspaceRepository(client, folder);
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
