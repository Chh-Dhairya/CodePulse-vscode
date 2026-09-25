import * as vscode from "vscode";
import { CodePulseClient, ResolvedSymbol } from "./client";
import { resolveWorkspaceRepository, toRepoRelativePath } from "./workspaceRepo";

/**
 * Resolves "what symbol is the cursor in right now" once, shared by
 * both sidebar TreeViews (References, Similar Code) so they don't each
 * independently re-resolve on every cursor move -- one debounced
 * `GET /v1/repositories/{id}/resolve` call per (editor, selection)
 * change feeds both.
 */
export class ActiveSymbolTracker implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<ResolvedSymbol | undefined>();
  readonly onDidChange = this._onDidChange.event;

  private current: ResolvedSymbol | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private generation = 0;

  constructor(private readonly client: CodePulseClient) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => this.schedule(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.schedule(editor);
        } else {
          this.setCurrent(undefined);
        }
      }),
    );
    if (vscode.window.activeTextEditor) {
      this.schedule(vscode.window.activeTextEditor);
    }
  }

  get currentSymbol(): ResolvedSymbol | undefined {
    return this.current;
  }

  private schedule(editor: vscode.TextEditor): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.resolve(editor), 300);
  }

  private async resolve(editor: vscode.TextEditor): Promise<void> {
    const myGeneration = ++this.generation;
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const relPath = folder ? toRepoRelativePath(folder, editor.document.uri) : undefined;
    if (!folder || !relPath) {
      this.setCurrent(undefined);
      return;
    }

    const repo = await resolveWorkspaceRepository(this.client, folder).catch(() => undefined);
    if (myGeneration !== this.generation) {
      return; // superseded by a newer cursor move
    }
    if (!repo) {
      this.setCurrent(undefined);
      return;
    }

    try {
      const line = editor.selection.active.line + 1;
      const resolved = await this.client.resolveSymbol(repo.repository_id, relPath, line);
      if (myGeneration === this.generation) {
        this.setCurrent(resolved.symbol ?? undefined);
      }
    } catch {
      if (myGeneration === this.generation) {
        this.setCurrent(undefined);
      }
    }
  }

  private setCurrent(symbol: ResolvedSymbol | undefined): void {
    const changed =
      symbol?.symbol_id !== this.current?.symbol_id || (symbol === undefined) !== (this.current === undefined);
    this.current = symbol;
    if (changed) {
      this._onDidChange.fire(symbol);
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.disposables.forEach((d) => d.dispose());
    this._onDidChange.dispose();
  }
}
