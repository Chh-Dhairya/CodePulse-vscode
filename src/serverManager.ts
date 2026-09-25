import * as vscode from "vscode";
import * as cp from "child_process";
import { CodePulseClient } from "./client";

/**
 * Detects whether a CodePulse server is already reachable at the
 * configured URL and, if not, offers to launch one locally as a
 * managed child process (`<codepulse.serverCommand> serve`) -- the
 * exact command the CLI already supports (`codepulse serve --host
 * --port`, Phase 6.1). This extension never re-implements indexing,
 * search, or any retrieval logic itself; it only ever talks to a real
 * server process over HTTP, matching §23's own "thin presentation
 * layer, never reimplementing retrieval logic client-side" instruction.
 */
export class ServerManager implements vscode.Disposable {
  private launchedProcess: cp.ChildProcess | undefined;

  constructor(
    private readonly client: CodePulseClient,
    private readonly output: vscode.OutputChannel,
  ) {}

  /**
   * Called once at activation: if a server is already reachable, does
   * nothing. Otherwise, respects `codepulse.autoLaunchServer` and asks
   * the user before ever launching a process on their machine --
   * launching a background server is not something this extension
   * does silently.
   */
  async ensureServerRunning(): Promise<boolean> {
    if (await this.client.health()) {
      return true;
    }

    const config = vscode.workspace.getConfiguration("codepulse");
    if (!config.get<boolean>("autoLaunchServer", true)) {
      return false;
    }

    const choice = await vscode.window.showInformationMessage(
      "No CodePulse server is reachable. Start one locally now?",
      "Start Server",
      "Not Now",
    );
    if (choice !== "Start Server") {
      return false;
    }
    return this.launchServer();
  }

  /**
   * Launches `<serverCommand> serve` in the first workspace folder (or
   * the extension's own cwd if none is open) and polls `/health/ready`
   * for up to ~10 seconds, since the server takes a moment to start
   * (model loading, DB hydration). Returns whether it became reachable
   * in that window -- a `false` return does NOT necessarily mean the
   * launch failed outright, only that it wasn't ready in time; the
   * process itself, and any real failure, is visible in the "CodePulse"
   * output channel either way.
   */
  async launchServer(): Promise<boolean> {
    if (this.launchedProcess && !this.launchedProcess.killed) {
      vscode.window.showInformationMessage("CodePulse server is already starting.");
    } else {
      const config = vscode.workspace.getConfiguration("codepulse");
      const command = config.get<string>("serverCommand", "codepulse");
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

      this.output.appendLine(`Launching local CodePulse server: ${command} serve`);
      try {
        this.launchedProcess = cp.spawn(command, ["serve"], {
          cwd: workspaceFolder?.uri.fsPath,
          shell: true,
        });
        this.launchedProcess.stdout?.on("data", (chunk: Buffer) => this.output.append(chunk.toString()));
        this.launchedProcess.stderr?.on("data", (chunk: Buffer) => this.output.append(chunk.toString()));
        this.launchedProcess.on("error", (err) => {
          this.output.appendLine(`Failed to launch CodePulse server: ${err.message}`);
        });
        this.launchedProcess.on("exit", (code) => {
          this.output.appendLine(`CodePulse server process exited (code ${code}).`);
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to launch CodePulse server: ${err?.message ?? err}`);
        return false;
      }
    }

    return this.waitForReady(10_000);
  }

  private async waitForReady(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.client.health()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  dispose(): void {
    if (this.launchedProcess && !this.launchedProcess.killed) {
      this.output.appendLine("Stopping the CodePulse server process this extension launched.");
      this.launchedProcess.kill();
    }
  }
}
