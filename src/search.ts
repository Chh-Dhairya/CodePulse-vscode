import * as vscode from "vscode";
import { CodePulseClient } from "./client";
import { resolveWorkspaceRepository } from "./workspaceRepo";

/**
 * "CodePulse: Search" -> `POST /v1/search` (hybrid by default, per
 * CODEPULSE_CLIENT_STRATEGY.md's Phase 2 scope). A thin quick-pick: type
 * a query, hit enter, jump to the chosen result's file:line. No ranking,
 * filtering, or result re-ordering happens client-side -- the server's
 * `SearchResultItem.to_dict()` ordering is shown as-is.
 */
export function registerSearchCommand(context: vscode.ExtensionContext, client: CodePulseClient): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codepulse.search", () => runSearch(client)),
  );
}

async function runSearch(client: CodePulseClient): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("CodePulse: open a workspace folder to search.");
    return;
  }

  const repo = await resolveWorkspaceRepository(client, folder).catch(() => undefined);
  if (!repo) {
    vscode.window.showWarningMessage(
      "CodePulse: this workspace isn't indexed yet. Run \"CodePulse: Index Workspace\" first.",
    );
    return;
  }

  const query = await vscode.window.showInputBox({
    prompt: "Search CodePulse (hybrid lexical + semantic + graph)",
    placeHolder: "e.g. \"parse authentication token\" or a symbol name",
  });
  if (!query) {
    return;
  }

  let response;
  try {
    response = await client.search(query, { repositoryId: repo.repository_id, searchType: "hybrid" });
  } catch (err: any) {
    vscode.window.showErrorMessage(`CodePulse search failed: ${err?.message ?? err}`);
    return;
  }

  if (response.results.length === 0) {
    vscode.window.showInformationMessage(`CodePulse: no results for "${query}".`);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    response.results.map((r) => ({
      label: `$(symbol-${iconFor(r.type)}) ${r.symbol_name}`,
      description: `${r.file_path}:${r.start_line}`,
      detail: r.snippet ?? r.docstring ?? undefined,
      result: r,
    })),
    {
      title: `CodePulse search: "${query}" (${response.results.length} results, ${response.execution_time_ms}ms)`,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!picked) {
    return;
  }

  const fileUri = vscode.Uri.joinPath(folder.uri, picked.result.file_path);
  const doc = await vscode.workspace.openTextDocument(fileUri);
  const editor = await vscode.window.showTextDocument(doc);
  const line = Math.max(0, picked.result.start_line - 1);
  const position = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

function iconFor(type: string): string {
  switch (type) {
    case "class":
      return "class";
    case "method":
      return "method";
    case "module":
      return "namespace";
    default:
      return "function";
  }
}
