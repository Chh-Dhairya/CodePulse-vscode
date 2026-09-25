import * as vscode from "vscode";
import { CodePulseClient } from "./client";
import { ActiveSymbolTracker } from "./activeSymbolTracker";

interface SimilarEntry {
  symbol_name: string;
  file_path: string;
  similarity: number;
  relevance_score: number;
}

type Node = { kind: "entry"; entry: SimilarEntry } | { kind: "empty"; message: string };

/**
 * Sidebar TreeView -- Similar Code, per Phase 2's scope:
 * `POST /v1/symbols/{id}/similar` for whatever symbol the cursor is
 * currently in. Purely semantic-vector results as the server computed
 * and ordered them -- no client-side re-ranking or filtering.
 */
export class SimilarCodeTreeDataProvider implements vscode.TreeDataProvider<Node> {
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
    const item = new vscode.TreeItem(node.entry.symbol_name, vscode.TreeItemCollapsibleState.None);
    item.description = `${node.entry.file_path} · ${Math.round(node.entry.relevance_score * 100)}%`;
    item.tooltip = `similarity: ${node.entry.similarity} · relevance: ${node.entry.relevance_score}`;
    item.iconPath = new vscode.ThemeIcon("symbol-method");
    item.command = {
      command: "codepulse.openReferenceFile",
      title: "Open File",
      arguments: [node.entry.file_path],
    };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node) {
      return [];
    }
    const symbol = this.tracker.currentSymbol;
    if (!symbol) {
      return [{ kind: "empty", message: "Place the cursor in an indexed symbol to see similar code." }];
    }
    try {
      const response = await this.client.getSimilar(symbol.symbol_id);
      const entries = response.similar as SimilarEntry[];
      if (entries.length === 0) {
        return [{ kind: "empty", message: "No similar code found above the similarity threshold." }];
      }
      return entries.map((entry) => ({ kind: "entry", entry }));
    } catch (err: any) {
      return [{ kind: "empty", message: `CodePulse: ${err?.message ?? err}` }];
    }
  }
}

export function registerSimilarCodeView(
  context: vscode.ExtensionContext,
  client: CodePulseClient,
  tracker: ActiveSymbolTracker,
): void {
  const provider = new SimilarCodeTreeDataProvider(client, tracker);
  context.subscriptions.push(vscode.window.registerTreeDataProvider("codepulse.similarCode", provider));
}
