import * as vscode from "vscode";
import { CodePulseClient } from "./client";
import { resolveWorkspaceRepository, toRepoRelativePath } from "./workspaceRepo";

/**
 * "N callers · M callees" above every function/class, per
 * CODEPULSE_CLIENT_STRATEGY.md's Phase 2 scope. Two-phase, matching
 * VS Code's own CodeLens contract: `provideCodeLenses` places one lens
 * per symbol cheaply (`GET /v1/repositories/{id}/file-symbols`, one
 * call for the whole file), and `resolveCodeLens` -- called only for
 * lenses actually scrolled into view -- makes the one
 * `POST /v1/symbols/{id}/impact-analysis` call each needs. This avoids
 * N impact-analysis calls for a file with N symbols when most aren't
 * even visible.
 */
interface PendingLens extends vscode.CodeLens {
  codepulseSymbolId?: number;
}

export class CodePulseCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly client: CodePulseClient) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) {
      return [];
    }
    const relPath = toRepoRelativePath(folder, document.uri);
    if (!relPath) {
      return [];
    }

    const repo = await resolveWorkspaceRepository(this.client, folder).catch(() => undefined);
    if (!repo || token.isCancellationRequested) {
      return [];
    }

    let fileSymbols;
    try {
      fileSymbols = await this.client.getFileSymbols(repo.repository_id, relPath);
    } catch {
      return [];
    }
    if (token.isCancellationRequested) {
      return [];
    }

    return fileSymbols.symbols.map((s) => {
      const line = Math.max(0, s.line_start - 1);
      const lens: PendingLens = new vscode.CodeLens(new vscode.Range(line, 0, line, 0));
      lens.codepulseSymbolId = s.symbol_id;
      return lens;
    });
  }

  async resolveCodeLens(lens: PendingLens, token: vscode.CancellationToken): Promise<vscode.CodeLens> {
    const symbolId = lens.codepulseSymbolId;
    if (symbolId === undefined) {
      lens.command = { title: "CodePulse: unavailable", command: "" };
      return lens;
    }
    try {
      const impact = await this.client.getImpactAnalysis(symbolId);
      if (token.isCancellationRequested) {
        return lens;
      }
      lens.command = {
        title: `$(references) ${impact.direct_callers} callers · ${impact.callees.direct.length} callees`,
        command: "codepulse.showImpact",
        arguments: [symbolId],
      };
    } catch (err: any) {
      lens.command = { title: "CodePulse: impact unavailable", command: "" };
    }
    return lens;
  }
}
