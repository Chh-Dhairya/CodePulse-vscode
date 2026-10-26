// The PACKAGED extension, installed the way a Marketplace user gets it.
//
// Every other scenario loads this folder in development mode (`--extensionDevelopmentPath`), which would hide a problem
// with the package itself: a file missing from the .vsix, a wrong `main`, a broken manifest. Here the extension is built
// with `vsce package`, installed with VS Code's own CLI into a fresh extensions directory, and VS Code is started with
// NO development path. It must activate, connect to the (running) test server with the test API key, and show the real
// symbol count.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { launchCode, Cdp, writeSettings, sleep, EXT_DEV, CODE_EXE, FIXTURES, PROFILE, WORKDIR, loadFixtures, statusBarText, toastText, waitFor, setApiKey, runCommand, quickInputText, quickInputVisible } from "../lib/cdp.mjs";

const FX = loadFixtures();
const pkg = JSON.parse(fs.readFileSync(path.join(EXT_DEV, "package.json"), "utf8"));
const extensionId = `${pkg.publisher}.${pkg.name}`;
const packaged = path.join(WORKDIR, "packaged");
const vsix = path.join(packaged, "codepulse-vscode.vsix");
const installedDir = path.join(PROFILE, "extensions-installed");
const codeCli = path.join(path.dirname(CODE_EXE), "bin", "code.cmd");

const results = [];
const check = (id, ok, evidence) => {
  results.push({ id, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  ${String(evidence).replace(/\s+/g, " ").slice(0, 280)}`);
};
const sh = (cmd, cwd = EXT_DEV) => execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// E2E_FROM_MARKETPLACE=1: do not build anything; install the extension BY ID from the live Marketplace, exactly as a
// user does (the RELEASE channel, as the Install button does; E2E_PRERELEASE=1 asks for the pre-release channel instead),
// and run the same activation checks on what the Marketplace really serves. Used after every release.
const fromMarketplace = process.env.E2E_FROM_MARKETPLACE === "1";
const userData = path.join(PROFILE, "user-data");
fs.rmSync(installedDir, { recursive: true, force: true });

if (fromMarketplace) {
  const out = sh(`"${codeCli}" --install-extension ${extensionId}${process.env.E2E_PRERELEASE === "1" ? " --pre-release" : ""} --extensions-dir "${installedDir}" --user-data-dir "${userData}"`);
  check("P1 the Marketplace serves the package: VS Code installs it by id", /successfully installed/i.test(out), out.trim());
} else {
  // --- build the package and look inside it
  fs.rmSync(packaged, { recursive: true, force: true });
  fs.mkdirSync(packaged, { recursive: true });
  sh(`npx vsce package --out "${vsix}"`);
  const listing = sh("npx vsce ls").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const forbidden = listing.filter((f) => /^(src|test|\.github|\.e2e|\.vscode|node_modules)\//.test(f.replace(/\\/g, "/")));
  const required = ["package.json", "README.md", "LICENSE", "CHANGELOG.md", "out/extension.js", "media/icon.png"];
  const missing = required.filter((f) => !listing.map((l) => l.replace(/\\/g, "/")).includes(f));
  check("P1 the package contains what it needs and no development files", forbidden.length === 0 && missing.length === 0,
    `${listing.length} files; unwanted: ${forbidden.join(",") || "none"}; missing: ${missing.join(",") || "none"}`);

  // --- install it with VS Code's own CLI into a fresh directory
  sh(`"${codeCli}" --install-extension "${vsix}" --extensions-dir "${installedDir}" --user-data-dir "${userData}"`);
}
const installed = sh(`"${codeCli}" --list-extensions --show-versions --extensions-dir "${installedDir}" --user-data-dir "${userData}"`);
check("P2 VS Code lists it with the right id and version",
  installed.toLowerCase().includes(`${extensionId}@${pkg.version}`.toLowerCase()), installed.trim());

// --- run VS Code with ONLY the installed copy
writeSettings({
  "codepulse.serverUrl": `http://127.0.0.1:${FX.port}`,
  "codepulse.autoLaunchServer": false,
  "workbench.startupEditor": "none",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "window.restoreWindows": "none",
  "workbench.tips.enabled": false,
  "chat.disableAIFeatures": true,
  "editor.minimap.enabled": false,
});

const child = launchCode(path.join(FIXTURES, "Test_Repo"), 9333, {}, { installed: installedDir });
const cdp = await Cdp.connect(9333, 120000);
try {
  const status = await waitFor(() => statusBarText(cdp), (t) => /CodePulse/.test(t), 60000);
  check("P3 the installed extension activates (its status-bar item appears)", /CodePulse/.test(status), status);

  // The status-bar item appears as soon as the extension activates, before the workbench is ready to take keystrokes
  // (the other scenarios wait the same way before driving the Command Palette).
  await sleep(5000);
  await setApiKey(cdp, FX.key);
  await cdp.shot("P4-after-set-api-key");
  const withKey = await waitFor(() => statusBarText(cdp), (t) => /CodePulse: \d+ symbols/.test(t), 60000);
  check("P4 it connects with the API key and shows the real symbol count", /CodePulse: 55 symbols/.test(withKey),
    `${withKey} | toasts: ${await toastText(cdp)} | palette open: ${await quickInputVisible(cdp)}`);

  await runCommand(cdp, "CodePulse: Search");
  const prompt = await waitFor(() => quickInputText(cdp), (t) => /Search CodePulse/.test(t), 15000);
  check("P5 its commands are registered (CodePulse: Search opens its input)", /Search CodePulse/.test(prompt), prompt);
  await cdp.shot("P-packaged-install");
} catch (e) {
  console.log("HARNESS ERROR", e.stack || e);
  try { await cdp.shot("P-error"); } catch { /* ignore */ }
} finally {
  cdp.close();
  child.kill();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
}
