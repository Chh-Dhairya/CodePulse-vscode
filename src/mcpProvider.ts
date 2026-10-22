import * as vscode from "vscode";
import { AuthManager } from "./auth";

/**
 * Phase 3 -- MCP integration (CODEPULSE_CLIENT_STRATEGY.md's own Phase 3:
 * "Register CodePulse's existing MCP server as a discoverable MCP
 * provider inside VS Code... reuses `codepulse serve --mcp` exactly as
 * it exists today -- no new backend work, just extension-side wiring.")
 * so any MCP-aware assistant already running in the editor (Copilot
 * Chat, Claude, Cline, etc.) gets CodePulse's tools automatically.
 *
 * `codepulse serve --mcp` is a SEPARATE, self-contained process from the
 * REST server this extension's `ServerManager` manages -- it opens its
 * own connection to the same local database directly, per
 * `cmd_serve`'s own implementation. VS Code's own MCP host spawns and
 * owns this process's lifecycle entirely; this provider only describes
 * how to start it.
 */
export class CodePulseMcpServerDefinitionProvider implements vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> {
  private readonly _onDidChangeMcpServerDefinitions = new vscode.EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this._onDidChangeMcpServerDefinitions.event;

  constructor(private readonly auth: AuthManager) {}

  /** Fired after the stored API key changes, so VS Code re-resolves the definition (and its tools) instead of caching a stale/missing key. */
  notifyApiKeyChanged(): void {
    this._onDidChangeMcpServerDefinitions.fire();
  }

  /** Fired when the workspace becomes trusted, so the definition withheld until then is offered. */
  notifyTrustGranted(): void {
    this._onDidChangeMcpServerDefinitions.fire();
  }

  /**
   * Called eagerly and often -- must NOT do anything requiring user
   * interaction (per this API's own contract). Returns a placeholder
   * definition with no key yet; `resolveMcpServerDefinition` below is
   * where the real key (and any prompting) happens, only when the
   * editor actually needs to start the server.
   */
  provideMcpServerDefinitions(): vscode.ProviderResult<vscode.McpStdioServerDefinition[]> {
    // This definition names a program VS Code will start with the API key in its environment, so it is only offered
    // in a trusted workspace (and `codepulse.serverCommand` is machine-scoped: a repository cannot set it).
    if (!vscode.workspace.isTrusted) {
      return [];
    }
    const command = vscode.workspace.getConfiguration("codepulse").get<string>("serverCommand", "codepulse").trim();
    if (command === "") {
      return [];
    }
    return [
      new vscode.McpStdioServerDefinition(
        "CodePulse",
        command,
        ["serve", "--mcp"],
        {},
      ),
    ];
  }

  /**
   * Called when the editor actually needs to start the server -- may
   * prompt for the API key here. The raw key is passed via the
   * `CODEPULSE_MCP_API_KEY` environment variable, never as a `--api-key`
   * command-line argument -- CLI args are visible to other processes on
   * the same machine (`ps`/Task Manager), a real, avoidable exposure a
   * spawned child process's own env is not (backend support for this
   * added alongside this feature, `codepulse.cli.resolve_mcp_api_key`).
   * Returns `undefined` to cancel the start (per this API's own
   * contract) when no key is available and the user doesn't provide one.
   */
  async resolveMcpServerDefinition(
    server: vscode.McpStdioServerDefinition,
    token: vscode.CancellationToken,
  ): Promise<vscode.McpStdioServerDefinition | undefined> {
    let apiKey = await this.auth.getApiKey();
    if (!apiKey && !token.isCancellationRequested) {
      const choice = await vscode.window.showWarningMessage(
        "CodePulse: an API key is required to start the MCP server.",
        "Set API Key",
      );
      if (choice === "Set API Key") {
        await this.auth.setApiKeyInteractive();
        apiKey = await this.auth.getApiKey();
      }
    }
    if (!apiKey || token.isCancellationRequested) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    server.cwd = workspaceFolder?.uri;
    server.env = { CODEPULSE_MCP_API_KEY: apiKey };
    return server;
  }
}

export function registerMcpProvider(
  context: vscode.ExtensionContext,
  auth: AuthManager,
): CodePulseMcpServerDefinitionProvider {
  const provider = new CodePulseMcpServerDefinitionProvider(auth);
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("codepulse.mcpServers", provider),
    vscode.workspace.onDidGrantWorkspaceTrust(() => provider.notifyTrustGranted()),
  );
  return provider;
}
