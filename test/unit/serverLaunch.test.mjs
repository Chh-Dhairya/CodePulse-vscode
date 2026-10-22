// Unit tests for the server-launch plan (plain Node, no VS Code needed): `npm test`.
//
// Why this exists: the extension used to run `cp.spawn(serverCommand, ..., { shell: true })` where
// `codepulse.serverCommand` could be overridden by a repository's own `.vscode/settings.json`, so opening a hostile
// repository and clicking the harmless-looking "Start Server" button ran an arbitrary command. These tests pin the
// rules that replaced it: nothing is launched in an untrusted workspace, the command is never run through a shell,
// and the user is shown the exact command line before it runs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { planServerLaunch, formatCommandLine, explainLaunchError } = require("../../out/serverLaunch.js");

const trusted = { serverUrl: "http://127.0.0.1:8200", trusted: true };

test("a trusted workspace with the default command gets a plan with the serve arguments", () => {
  const decision = planServerLaunch({ command: "codepulse", ...trusted });
  assert.equal(decision.ok, true);
  assert.equal(decision.plan.command, "codepulse");
  assert.deepEqual(decision.plan.args, ["serve", "--host", "127.0.0.1", "--port", "8200"]);
});

test("nothing is launched in an untrusted workspace, and the reason says why", () => {
  const decision = planServerLaunch({ command: "codepulse", serverUrl: "http://127.0.0.1:8000", trusted: false });
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /not trusted/i);
});

test("an empty or blank command is refused", () => {
  for (const command of ["", "   ", "\t"]) {
    const decision = planServerLaunch({ command, ...trusted });
    assert.equal(decision.ok, false, JSON.stringify(command));
    assert.match(decision.reason, /codepulse\.serverCommand/);
  }
});

test("a command with a newline or other control character INSIDE it is refused", () => {
  for (const command of ["codepulse\nrm -rf x", "code\u0000pulse", "code\tpulse\u001bx"]) {
    assert.equal(planServerLaunch({ command, ...trusted }).ok, false, JSON.stringify(command));
  }
});

test("a trailing newline (a common copy-paste leftover) is just whitespace and is trimmed", () => {
  const decision = planServerLaunch({ command: "codepulse\r\n", ...trusted });
  assert.equal(decision.ok, true);
  assert.equal(decision.plan.command, "codepulse");
});

test("the command is kept exactly as one program name, never split or interpreted", () => {
  // With a shell, this would run `echo` and then the second command. As a single program name it is just a (missing) file.
  const hostile = "codepulse && calc.exe";
  const decision = planServerLaunch({ command: hostile, ...trusted });
  assert.equal(decision.ok, true);
  assert.equal(decision.plan.command, hostile);
  assert.deepEqual(decision.plan.args, ["serve", "--host", "127.0.0.1", "--port", "8200"]);
});

test("a path with spaces is a single program name", () => {
  const decision = planServerLaunch({ command: "C:\\Program Files\\CodePulse\\codepulse.exe", ...trusted });
  assert.equal(decision.ok, true);
  assert.equal(decision.plan.command, "C:\\Program Files\\CodePulse\\codepulse.exe");
});

test("surrounding whitespace in the setting is trimmed", () => {
  assert.equal(planServerLaunch({ command: "  codepulse  ", ...trusted }).plan.command, "codepulse");
});

test("a serverUrl the extension cannot serve is passed through as the refusal reason", () => {
  const decision = planServerLaunch({ command: "codepulse", serverUrl: "http://example.com:8000", trusted: true });
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /not a local address/);
});

test("the display string shows the exact command line the user is agreeing to", () => {
  const decision = planServerLaunch({ command: "codepulse", ...trusted });
  assert.equal(decision.plan.display, "codepulse serve --host 127.0.0.1 --port 8200");
});

test("the display string quotes a command that contains spaces", () => {
  assert.equal(
    formatCommandLine("C:\\Program Files\\CodePulse\\codepulse.exe", ["serve", "--port", "8000"]),
    '"C:\\Program Files\\CodePulse\\codepulse.exe" serve --port 8000',
  );
});

test("the display string makes a suspicious command visible rather than hiding it", () => {
  assert.equal(formatCommandLine("codepulse && calc.exe", ["serve"]), '"codepulse && calc.exe" serve');
});

// --- explaining a launch that failed ---------------------------------------------------------------------------

test("a missing program says how to install the backend or point the setting at it", () => {
  const text = explainLaunchError("ENOENT", "codepulse");
  assert.match(text, /could not find/i);
  assert.match(text, /pip install codepulse-engine/);
  assert.match(text, /codepulse\.serverCommand/);
});

test("a permission problem is explained as such", () => {
  assert.match(explainLaunchError("EACCES", "codepulse"), /permission/i);
});

test("a Windows script wrapper (EINVAL) is explained: point at the .exe instead", () => {
  assert.match(explainLaunchError("EINVAL", "codepulse.cmd"), /\.exe/);
});

test("any other failure still names the command and the code", () => {
  const text = explainLaunchError("EMFILE", "codepulse");
  assert.match(text, /codepulse/);
  assert.match(text, /EMFILE/);
});
