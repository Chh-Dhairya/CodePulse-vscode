import { serveArgsForUrl } from "./serverArgs";

/**
 * Decides whether, and exactly how, the extension may start a local CodePulse server.
 *
 * Before this existed the extension ran `cp.spawn(serverCommand, args, { shell: true })`, where
 * `codepulse.serverCommand` could be overridden by a repository's own `.vscode/settings.json`: opening a hostile
 * repository and clicking the harmless-looking "Start Server" button ran an arbitrary command. The rules now:
 *
 *  - nothing is launched in an untrusted workspace;
 *  - the command is ONE program name, never split, never run through a shell (so `a && b` is just a missing file);
 *  - the user is shown the exact command line before it runs (see `ServerManager.ensureServerRunning`);
 *  - the settings that choose the program and the server URL are machine-scoped in the manifest, so a repository's
 *    own settings cannot set them at all.
 *
 * Pure (no `vscode` import) so it can be unit-tested in plain Node.
 */
export interface LaunchPlan {
  command: string;
  args: string[];
  /** The command line as shown to the user. */
  display: string;
}

export type LaunchDecision = { ok: true; plan: LaunchPlan } | { ok: false; reason: string };

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const NEEDS_QUOTING = /[\s"&|<>^;()]/;

export function formatCommandLine(command: string, args: string[]): string {
  const shown = NEEDS_QUOTING.test(command) ? `"${command}"` : command;
  return [shown, ...args].join(" ");
}

export function planServerLaunch(opts: { command: string; serverUrl: string; trusted: boolean }): LaunchDecision {
  if (!opts.trusted) {
    return {
      ok: false,
      reason:
        "This workspace is not trusted, so CodePulse will not start a server process. " +
        "Trust the workspace, or start the server yourself and point codepulse.serverUrl at it.",
    };
  }

  const command = (opts.command ?? "").trim();
  if (command === "") {
    return {
      ok: false,
      reason: "codepulse.serverCommand is empty. Set it to the path of the codepulse executable.",
    };
  }
  if (CONTROL_CHARACTERS.test(command)) {
    return {
      ok: false,
      reason: "codepulse.serverCommand contains a control character; set it to the plain path of the codepulse executable.",
    };
  }

  const serve = serveArgsForUrl(opts.serverUrl);
  if ("error" in serve) {
    return { ok: false, reason: serve.error };
  }
  return { ok: true, plan: { command, args: serve.args, display: formatCommandLine(command, serve.args) } };
}

/** A user-facing explanation for a process that could not be started (the `code` of Node's spawn error). */
export function explainLaunchError(code: string | undefined, command: string): string {
  switch (code) {
    case "ENOENT":
      return (
        `CodePulse could not find "${command}". Install the CodePulse backend ("pip install codepulse-engine", ` +
        "Python 3.11 or 3.12) or set codepulse.serverCommand to the full path of the codepulse executable."
      );
    case "EACCES":
      return `Permission denied when starting "${command}". Check that it is an executable file you are allowed to run.`;
    case "EINVAL":
      return (
        `"${command}" cannot be started directly. On Windows, script wrappers (.cmd, .bat) cannot be launched this way; ` +
        "set codepulse.serverCommand to the real codepulse.exe instead."
      );
    default:
      return `CodePulse could not start "${command}" (${code ?? "unknown error"}).`;
  }
}
