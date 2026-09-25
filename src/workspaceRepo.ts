import * as vscode from "vscode";
import { CodePulseClient, CodePulseRepository } from "./client";

/**
 * Every Phase 2 feature (search, index, hover, CodeLens, references,
 * similar-code, module structure) needs the same two things: "which
 * CodePulse repository_id is this workspace?" and "what's this open
 * file's path relative to that repository's root?" -- matching
 * `RepositoryModel.url` (an absolute local path) against the open
 * workspace folder, exactly like `extension.ts`'s own
 * `refreshConnectionState` already does for the status bar. Extracted
 * here so six+ features share one implementation instead of six
 * divergent copies of the same path-matching logic.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export async function resolveWorkspaceRepository(
  client: CodePulseClient,
  folder: vscode.WorkspaceFolder,
): Promise<CodePulseRepository | undefined> {
  const repos = await client.listRepositories();
  return repos.find((r) => normalizePath(r.url) === normalizePath(folder.uri.fsPath));
}

/**
 * Converts an absolute file URI into the path relative to the GIVEN
 * `folder` specifically (not "whichever workspace folder VS Code's own
 * `asRelativePath` happens to find first") -- matters in a multi-root
 * workspace, where relying on global folder-detection instead of the
 * folder a caller already resolved a repository against could silently
 * mismatch. Returns `undefined` when `uri` isn't actually inside
 * `folder`. Case-insensitive comparison on Windows (where a drive
 * letter or path segment's casing can differ harmlessly), exact
 * elsewhere.
 */
export function toRepoRelativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
  const root = folder.uri.fsPath.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const target = uri.fsPath.replace(/\\/g, "/");
  if (target === root) {
    return "";
  }
  const prefix = `${root}/`;
  const matches = process.platform === "win32" ? target.toLowerCase().startsWith(prefix.toLowerCase()) : target.startsWith(prefix);
  if (!matches) {
    return undefined;
  }
  return target.slice(prefix.length);
}

/** Language ids CodePulse's indexer actually parses (`codepulse/parser/factory.py`). */
export const SUPPORTED_LANGUAGE_SELECTOR: vscode.DocumentSelector = [
  { language: "python", scheme: "file" },
  { language: "javascript", scheme: "file" },
  { language: "javascriptreact", scheme: "file" },
  { language: "typescript", scheme: "file" },
  { language: "typescriptreact", scheme: "file" },
];

/**
 * Phase 4 -- multi-root workspace support. Every user-initiated,
 * folder-scoped command (Search, Index Workspace, Module Structure)
 * used to silently operate on `workspaceFolders?.[0]` only, ignoring
 * any other open folder entirely -- correct for the common single-root
 * case, wrong the moment a second repository is open. Returns:
 *  - `undefined` (after warning the user) when no folder is open at all;
 *  - the one open folder directly, with no prompt, when there's exactly
 *    one -- preserves today's zero-friction UX for the common case;
 *  - the user's own choice, via VS Code's built-in workspace-folder
 *    quick-pick, when there's more than one.
 */
export async function pickWorkspaceFolder(placeHolder: string): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage("CodePulse: open a workspace folder first.");
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick({ placeHolder });
}

/**
 * The workspace folder the status bar should currently describe: the
 * ACTIVE editor's own folder when one is open and belongs to a
 * workspace folder (so switching between two open repositories updates
 * the status bar to match, in a multi-root workspace), falling back to
 * the first folder otherwise (no editor open yet, or the active one --
 * e.g. an untitled/output document -- isn't in any workspace folder).
 */
export function activeOrFirstWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const owning = vscode.workspace.getWorkspaceFolder(activeUri);
    if (owning) {
      return owning;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Phase 4 -- distinguishes WHY a workspace folder has no resolved
 * repository, so callers can show an accurate, actionable message
 * instead of a blanket "not indexed yet" that's actively misleading
 * when the real problem is "no server reachable at all."
 */
export type WorkspaceRepoResolution =
  | { status: "found"; repo: CodePulseRepository }
  | { status: "not-indexed" }
  | { status: "unreachable" };

export async function resolveWorkspaceRepositoryDetailed(
  client: CodePulseClient,
  folder: vscode.WorkspaceFolder,
): Promise<WorkspaceRepoResolution> {
  if (!(await client.health())) {
    return { status: "unreachable" };
  }
  try {
    const repo = await resolveWorkspaceRepository(client, folder);
    return repo ? { status: "found", repo } : { status: "not-indexed" };
  } catch {
    // The server IS reachable (checked above) but listing repositories
    // still failed -- most likely no API key set yet, or one scoped to
    // nothing. Same actionable next step as "not indexed" from the
    // user's point of view (there's nothing usable to search/browse
    // yet either way), so treated the same rather than adding a THIRD,
    // narrower error state for what is functionally the same "nothing
    // to show yet" outcome.
    return { status: "not-indexed" };
  }
}

/**
 * Shows the actual reason a folder-scoped command has nothing to work
 * with, with a button that fixes it -- "server unreachable" and "not
 * yet indexed" are genuinely different problems with different fixes,
 * per CODEPULSE_CLIENT_STRATEGY.md's own Phase 4 scope ("error states
 * for 'server unreachable' / 'not yet indexed'").
 */
export async function explainUnresolvedWorkspace(
  resolution: "not-indexed" | "unreachable",
  folderName: string,
): Promise<void> {
  if (resolution === "unreachable") {
    const choice = await vscode.window.showWarningMessage(
      "CodePulse: no server is reachable.",
      "Start Server",
      "Check Connection",
    );
    if (choice === "Start Server") {
      await vscode.commands.executeCommand("codepulse.startServer");
    } else if (choice === "Check Connection") {
      await vscode.commands.executeCommand("codepulse.checkConnection");
    }
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `CodePulse: "${folderName}" isn't indexed yet.`,
    "Index Workspace",
  );
  if (choice === "Index Workspace") {
    await vscode.commands.executeCommand("codepulse.indexWorkspace");
  }
}
