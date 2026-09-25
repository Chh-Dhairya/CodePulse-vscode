import * as vscode from "vscode";
import { CodePulseClient } from "./client";
import { resolveWorkspaceRepository, toRepoRelativePath } from "./workspaceRepo";

/**
 * Hover provider backed entirely by `GET /v1/repositories/{id}/resolve`
 * (Phase 0). That single call already returns name/type/docstring for
 * the narrowest symbol at the hovered line, so no second round-trip to
 * `GET /v1/symbols/{id}` is needed for a lightweight hover -- keeping
 * hover latency to one request, matching how VS Code expects hover
 * providers to behave (called on every mouse-over).
 */
export class CodePulseHoverProvider implements vscode.HoverProvider {
  constructor(private readonly client: CodePulseClient) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) {
      return undefined;
    }
    const relPath = toRepoRelativePath(folder, document.uri);
    if (!relPath) {
      return undefined;
    }

    const repo = await resolveWorkspaceRepository(this.client, folder).catch(() => undefined);
    if (!repo || token.isCancellationRequested) {
      return undefined;
    }

    let resolved;
    try {
      resolved = await this.client.resolveSymbol(repo.repository_id, relPath, position.line + 1);
    } catch {
      return undefined;
    }
    if (token.isCancellationRequested || !resolved.symbol) {
      return undefined;
    }

    const sym = resolved.symbol;
    const md = new vscode.MarkdownString();
    md.appendCodeblock(`${sym.type} ${sym.name}`, document.languageId);
    if (sym.docstring) {
      md.appendMarkdown(sym.docstring);
    }
    md.appendMarkdown(`\n\n---\ncomplexity: ${sym.complexity} · CodePulse`);

    const range = new vscode.Range(
      new vscode.Position(Math.max(0, sym.line_start - 1), 0),
      new vscode.Position(Math.max(0, sym.line_start - 1), document.lineAt(Math.max(0, sym.line_start - 1)).text.length),
    );
    return new vscode.Hover(md, range);
  }
}
