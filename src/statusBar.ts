import * as vscode from "vscode";

export type ConnectionState = "unknown" | "connecting" | "connected" | "disconnected";

/**
 * A single status bar item reflecting the extension's connection state
 * and, once known, the current workspace's indexing status -- §23's
 * own "status-bar indexing indicator." Clicking it re-runs the
 * connection check (`codepulse.checkConnection`), so a user who fixed
 * the server in the meantime doesn't need to reload the window.
 */
export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "codepulse.checkConnection";
    this.item.show();
    this.setState("unknown");
  }

  setState(state: ConnectionState, detail?: string): void {
    switch (state) {
      case "connecting":
        this.item.text = "$(sync~spin) CodePulse";
        this.item.tooltip = "Connecting to the CodePulse server...";
        break;
      case "connected":
        this.item.text = detail ? `$(check) CodePulse: ${detail}` : "$(check) CodePulse";
        this.item.tooltip = "Connected to the CodePulse server. Click to re-check.";
        break;
      case "disconnected":
        this.item.text = "$(circle-slash) CodePulse";
        this.item.tooltip = "Not connected to a CodePulse server. Click to check / start one.";
        break;
      case "unknown":
      default:
        this.item.text = "$(question) CodePulse";
        this.item.tooltip = "CodePulse status not yet checked.";
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
