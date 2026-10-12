import * as vscode from "vscode";
import { CodePulseClient, JobStatus } from "./client";
import { pickWorkspaceFolder, resolveWorkspaceRepository } from "./workspaceRepo";

/**
 * "CodePulse: Index Workspace" -> `POST /v1/repositories/index`, then
 * polls `GET /v1/jobs/{id}` inside a progress notification until the job
 * reaches a terminal status. Indexing is asynchronous server-side (the
 * POST returns 202 immediately with a `job_id`); this is the only client
 * feature that needs to poll rather than make one request and render.
 */
const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);
const POLL_INTERVAL_MS = 1500;

export function registerIndexWorkspaceCommand(context: vscode.ExtensionContext, client: CodePulseClient): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codepulse.indexWorkspace", () => runIndexWorkspace(client)),
  );
}

async function runIndexWorkspace(client: CodePulseClient): Promise<void> {
  const folder = await pickWorkspaceFolder("Which repository do you want to index?");
  if (!folder) {
    return;
  }

  // The server identifies a repository by the EXACT url string it was first
  // indexed under. VS Code reports a Windows path as `c:\...` (lowercase
  // drive) while a CLI-indexed repository is stored as `C:\...`, so sending the
  // raw folder path re-indexed nothing and created a duplicate repository the
  // key could not see. When this folder already matches an indexed repository
  // (the extension matches case/slash-insensitively), send THAT repository's
  // stored url.
  const existing = await resolveWorkspaceRepository(client, folder).catch(() => undefined);
  let job;
  try {
    job = await client.indexRepository(existing?.url ?? folder.uri.fsPath);
  } catch (err: any) {
    vscode.window.showErrorMessage(`CodePulse: could not start indexing: ${err?.message ?? err}`);
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `CodePulse: indexing "${folder.name}"`,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "queued" });
      let status: JobStatus;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await sleep(POLL_INTERVAL_MS);
        try {
          status = await client.getJobStatus(job.job_id);
        } catch (err: any) {
          vscode.window.showErrorMessage(`CodePulse: lost track of indexing job ${job.job_id}: ${err?.message ?? err}`);
          return;
        }
        progress.report({ message: status.status });
        if (TERMINAL_STATUSES.has(status.status)) {
          break;
        }
      }

      // Whether or not it succeeded, the repository list (and its symbol
      // counts) may have changed.
      client.invalidateRepositoryCache();
      if (status.status === "succeeded") {
        vscode.window.showInformationMessage(`CodePulse: "${folder.name}" indexed successfully.`);
      } else {
        vscode.window.showErrorMessage(
          `CodePulse: indexing "${folder.name}" ${status.status}${status.error ? `: ${status.error}` : "."}`,
        );
      }
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
