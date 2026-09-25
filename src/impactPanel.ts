import * as vscode from "vscode";
import { CodePulseClient } from "./client";

/**
 * "codepulse.showImpact" -- the panel the CodeLens's "N callers · M
 * callees" opens on click. Call-graph entries from
 * `POST /v1/symbols/{id}/impact-analysis` are `{symbol, file,
 * confidence, depth}` -- no line number -- so selecting one opens the
 * containing file rather than jumping to an exact line; that's an
 * honest reflection of what the endpoint actually returns, not a
 * client-side approximation of a line it doesn't have.
 */
export function registerShowImpactCommand(context: vscode.ExtensionContext, client: CodePulseClient): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codepulse.showImpact", (symbolId: number) => showImpact(client, symbolId)),
  );
}

async function showImpact(client: CodePulseClient, symbolId: number): Promise<void> {
  let symbol;
  let impact;
  try {
    [symbol, impact] = await Promise.all([
      client.getSymbolDetails(symbolId),
      client.getImpactAnalysis(symbolId),
    ]);
  } catch (err: any) {
    vscode.window.showErrorMessage(`CodePulse: could not load impact analysis: ${err?.message ?? err}`);
    return;
  }

  type Entry = { symbol: string; file: string; confidence: string; depth: number };
  const items: Array<vscode.QuickPickItem & { file?: string }> = [];

  const addSection = (title: string, entries: Entry[]) => {
    if (entries.length === 0) {
      return;
    }
    items.push({ label: title, kind: vscode.QuickPickItemKind.Separator });
    for (const e of entries as Entry[]) {
      items.push({
        label: `$(symbol-method) ${e.symbol}`,
        description: e.file,
        detail: `confidence: ${e.confidence}${e.depth > 1 ? ` · depth ${e.depth}` : ""}`,
        file: e.file,
      });
    }
  };

  addSection("Direct callers", impact.callers.direct as Entry[]);
  addSection("Indirect callers", impact.callers.transitive as Entry[]);
  addSection("Direct callees", impact.callees.direct as Entry[]);
  addSection("Transitive callees", impact.callees.transitive as Entry[]);

  if (items.length === 0) {
    vscode.window.showInformationMessage(`CodePulse: "${symbol.name}" has no recorded callers or callees.`);
    return;
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: `Impact analysis: ${symbol.name} (${symbol.file})`,
  });
  if (!picked?.file) {
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }
  const fileUri = vscode.Uri.joinPath(folder.uri, picked.file);
  try {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc);
  } catch (err: any) {
    vscode.window.showErrorMessage(`CodePulse: could not open ${picked.file}: ${err?.message ?? err}`);
  }
}
