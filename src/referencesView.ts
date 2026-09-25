import * as vscode from "vscode";
import { CodePulseClient } from "./client";
import { ActiveSymbolTracker } from "./activeSymbolTracker";

interface GraphEntry {
  symbol: string;
  file: string;
  confidence: string;
}

type Node =
  | { kind: "group"; label: string; entries: GraphEntry[] }
  | { kind: "entry"; entry: GraphEntry }
  | { kind: "empty"; message: string };

/**
 * Sidebar TreeView -- References, per Phase 2's scope:
 * `GET /v1/symbols/{id}/references` for whatever symbol the cursor is
 * currently in (via `ActiveSymbolTracker`). Direct callers and direct
 * subclasses only (that endpoint is deliberately single-hop, never
 * transitive -- see `analyze_references`'s own docstring) -- the
 * broader transitive view lives in the impact-analysis panel instead.
 */
export class ReferencesTreeDataProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly client: CodePulseClient,
    private readonly tracker: ActiveSymbolTracker,
  ) {
    tracker.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "empty") {
      return new vscode.TreeItem(node.message);
    }
    if (node.kind === "group") {
      const item = new vscode.TreeItem(
        `${node.label} (${node.entries.length})`,
        node.entries.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
      );
      item.contextValue = "codepulseReferenceGroup";
      return item;
    }
    const item = new vscode.TreeItem(node.entry.symbol, vscode.TreeItemCollapsibleState.None);
    item.description = node.entry.file;
    item.tooltip = `${node.entry.file} · confidence: ${node.entry.confidence}`;
    item.iconPath = new vscode.ThemeIcon("symbol-method");
    item.command = {
      command: "codepulse.openReferenceFile",
      title: "Open File",
      arguments: [node.entry.file],
    };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const symbol = this.tracker.currentSymbol;
    if (!symbol) {
      return [{ kind: "empty", message: "Place the cursor in an indexed symbol to see its references." }];
    }

    if (!node) {
      try {
        const refs = await this.client.getReferences(symbol.symbol_id);
        return [
          { kind: "group", label: "Callers", entries: refs.callers as GraphEntry[] },
          { kind: "group", label: "Subclasses", entries: refs.subclasses as GraphEntry[] },
        ];
      } catch (err: any) {
        return [{ kind: "empty", message: `CodePulse: ${err?.message ?? err}` }];
      }
    }

    if (node.kind === "group") {
      return node.entries.map((entry) => ({ kind: "entry", entry }));
    }
    return [];
  }
}

export function registerReferencesView(
  context: vscode.ExtensionContext,
  client: CodePulseClient,
  tracker: ActiveSymbolTracker,
): void {
  const provider = new ReferencesTreeDataProvider(client, tracker);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("codepulse.references", provider),
    vscode.commands.registerCommand("codepulse.openReferenceFile", async (file: string) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        return;
      }
      const uri = vscode.Uri.joinPath(folder.uri, file);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
      } catch (err: any) {
        vscode.window.showErrorMessage(`CodePulse: could not open ${file}: ${err?.message ?? err}`);
      }
    }),
  );
}
