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
 * Converts an absolute file URI into the workspace-relative,
 * forward-slash path that `FileModel.path` stores (and that every
 * path-keyed REST endpoint -- resolve, file-symbols -- expects).
 * Returns `undefined` when the file isn't inside the given folder.
 */
export function toRepoRelativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
  const rel = vscode.workspace.asRelativePath(uri, false);
  if (rel === uri.fsPath) {
    return undefined;
  }
  return rel.replace(/\\/g, "/");
}

/** Language ids CodePulse's indexer actually parses (`codepulse/parser/factory.py`). */
export const SUPPORTED_LANGUAGE_SELECTOR: vscode.DocumentSelector = [
  { language: "python", scheme: "file" },
  { language: "javascript", scheme: "file" },
  { language: "javascriptreact", scheme: "file" },
  { language: "typescript", scheme: "file" },
  { language: "typescriptreact", scheme: "file" },
];
