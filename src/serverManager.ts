import * as vscode from "vscode";
import * as cp from "child_process";
import { CodePulseClient } from "./client";
import { explainLaunchError, planServerLaunch } from "./serverLaunch";

/**
 * Detects whether a CodePulse server is already reachable at the
 * configured URL and, if not, offers to launch one locally as a
 * managed child process (`<codepulse.serverCommand> serve`) -- the
 * exact command the CLI already supports (`codepulse serve --host
 * --port`, Phase 6.1). This extension never re-implements indexing,
 * search, or any retrieval logic itself; it only ever talks to a real
 * server process over HTTP, matching §23's own "thin presentation
 * layer, never reimplementing retrieval logic client-side" instruction.
 *
 * What may be launched, and from which settings, is decided by
 * `planServerLaunch` (see its notes): nothing in an untrusted workspace,
 * never through a shell, and the user sees the exact command line first.
 */
export class ServerManager implements vscode.Disposable {
  private launchedProcess: cp.ChildProcess | undefined;
  private launchFailure: string | undefined;

  constructor(
    private readonly client: CodePulseClient,
    private readonly output: vscode.OutputChannel,
  ) {}

  /**
   * Called once at activation: if a server is already reachable, does
   * nothing. Otherwise, respects `codepulse.autoLaunchServer` and asks
   * the user before ever launching a process on their machine --
   * launching a background server is not something this extension
   * does silently. The question names the exact command line, and
   * "Don't Ask Again" turns the setting off for good. There is nothing
   * to ask about when no folder is open or the workspace is untrusted.
   */
  async ensureServerRunning(): Promise<boolean> {
    if (await this.client.health()) {
      return true;
    }

    const config = vscode.workspace.getConfiguration("codepulse");
    if (!config.get<boolean>("autoLaunchServer", true)) {
      return false;
    }
    if (!vscode.workspace.workspaceFolders?.length) {
      return false;
    }

    const decision = planServerLaunch({
      command: config.get<string>("serverCommand", "codepulse"),
      serverUrl: config.get<string>("serverUrl", "http://127.0.0.1:8000"),
      trusted: vscode.workspace.isTrusted,
    });
    if (!decision.ok) {
      this.output.appendLine(`Not offering to start a server: ${decision.reason}`);
      return false;
    }

    const choice = await vscode.window.showInformationMessage(
      `No CodePulse server is reachable. Start one locally now? This runs: ${decision.plan.display}`,
      "Start Server",
      "Not Now",
      "Don't Ask Again",
    );
    if (choice === "Don't Ask Again") {
      await config.update("autoLaunchServer", false, vscode.ConfigurationTarget.Global);
      this.output.appendLine("Server start-up prompt turned off (codepulse.autoLaunchServer = false).");
      return false;
    }
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
   * output channel either way. A program that cannot be started at all
   * (not installed, not executable) is reported straight away, with what
   * to do about it, instead of after the wait.
   */
  async launchServer(): Promise<boolean> {
    if (this.launchedProcess && !this.launchedProcess.killed) {
      vscode.window.showInformationMessage("CodePulse server is already starting.");
    } else {
      const config = vscode.workspace.getConfiguration("codepulse");
      const decision = planServerLaunch({
        command: config.get<string>("serverCommand", "codepulse"),
        // Listen where the extension will look: derive host/port from serverUrl
        // (a bare `serve` always binds 8000, which broke any other port).
        serverUrl: config.get<string>("serverUrl", "http://127.0.0.1:8000"),
        trusted: vscode.workspace.isTrusted,
      });
      if (!decision.ok) {
        this.output.appendLine(decision.reason);
        if (!vscode.workspace.isTrusted) {
          const choice = await vscode.window.showWarningMessage(`CodePulse: ${decision.reason}`, "Manage Workspace Trust");
          if (choice === "Manage Workspace Trust") {
            await vscode.commands.executeCommand("workbench.trust.manage");
          }
        } else {
          vscode.window.showErrorMessage(`CodePulse: ${decision.reason}`);
        }
        return false;
      }

      const { command, args, display } = decision.plan;
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      this.launchFailure = undefined;
      this.output.appendLine(`Launching local CodePulse server: ${display}`);
      try {
        // No shell: the setting is one program name, never a command line to be interpreted.
        const child = cp.spawn(command, args, { cwd: workspaceFolder?.uri.fsPath, shell: false });
        this.launchedProcess = child;
        child.stdout?.on("data", (chunk: Buffer) => this.output.append(chunk.toString()));
        child.stderr?.on("data", (chunk: Buffer) => this.output.append(chunk.toString()));
        child.on("error", (err: NodeJS.ErrnoException) => {
          const explanation = explainLaunchError(err.code, command);
          this.launchFailure = explanation;
          this.output.appendLine(`Failed to launch CodePulse server: ${err.message}\n${explanation}`);
          vscode.window.showErrorMessage(explanation);
          if (this.launchedProcess === child) {
            this.launchedProcess = undefined;
          }
        });
        child.on("exit", (code) => {
          this.output.appendLine(`CodePulse server process exited (code ${code}).`);
          if (this.launchedProcess === child) {
            this.launchedProcess = undefined;
          }
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(explainLaunchError(err?.code, command));
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
      if (this.launchFailure) {
        return false;
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
