import * as vscode from "vscode";
import { CodePulseClient } from "./client";
import { pickWorkspaceFolder, resolveWorkspaceRepositoryDetailed, explainUnresolvedWorkspace } from "./workspaceRepo";

/**
 * "CodePulse: Module Structure" -> `GET /v1/repositories/{id}/modules`,
 * rendered as a simple collapsible tree (per Phase 2's own wording).
 * Read-only, one-shot: no live TreeView/refresh machinery, since module
 * clustering only changes when the repository is re-indexed, unlike
 * References/Similar Code which track a moving cursor.
 */
export function registerModuleStructureCommand(context: vscode.ExtensionContext, client: CodePulseClient): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codepulse.moduleStructure", () => showModuleStructure(client)),
  );
}

async function showModuleStructure(client: CodePulseClient): Promise<void> {
  const folder = await pickWorkspaceFolder("Which repository's module structure do you want to browse?");
  if (!folder) {
    return;
  }

  const resolution = await resolveWorkspaceRepositoryDetailed(client, folder);
  if (resolution.status !== "found") {
    await explainUnresolvedWorkspace(resolution.status, folder.name);
    return;
  }
  const repo = resolution.repo;

  let modules;
  try {
    modules = await client.getModules(repo.repository_id);
  } catch (err: any) {
    vscode.window.showErrorMessage(`CodePulse: could not load module structure: ${err?.message ?? err}`);
    return;
  }

  if (modules.clusters.length === 0) {
    vscode.window.showInformationMessage("CodePulse: no module clusters found for this repository.");
    return;
  }

  const items: Array<vscode.QuickPickItem & { file?: string }> = [];
  for (const cluster of modules.clusters) {
    items.push({
      label: `$(folder-library) Cluster ${cluster.id}`,
      kind: vscode.QuickPickItemKind.Separator,
    } as vscode.QuickPickItem);
    for (const file of cluster.files) {
      items.push({ label: `$(file-code) ${file}`, file });
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: `Module structure: ${folder.name} (${modules.clusters.length} clusters)`,
  });
  if (!picked?.file) {
    return;
  }

  const uri = vscode.Uri.joinPath(folder.uri, picked.file);
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  } catch (err: any) {
    vscode.window.showErrorMessage(`CodePulse: could not open ${picked.file}: ${err?.message ?? err}`);
  }
}
