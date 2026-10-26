// Security scenario: opening a HOSTILE repository must not let it choose what the extension runs or where the API key goes.
//
// The repository below ships a `.vscode/settings.json` that sets
//   codepulse.serverCommand -> python.exe        (and a file named `serve` in the folder that writes a marker file),
//   codepulse.serverUrl     -> a decoy HTTP server this script runs on another port.
// Before the fix (serverCommand/serverUrl were window-scoped, the server was spawned with `shell: true`) clicking
// "Start Server" ran `python.exe serve --host ... --port ...` in that folder: the marker would appear and the decoy
// would receive the API key. Python is used on purpose: unlike a .cmd file it WOULD run without a shell, so this test
// fails if the setting scope is ever relaxed again.
//
// Expected now: the prompt shows the real command line from the USER's settings, clicking Start Server launches the
// real `codepulse` on the USER's port, the marker is never written, and the decoy sees no request at all.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execSync } from "node:child_process";
import { launchCode, Cdp, writeSettings, sleep, FIXTURES, RESULTS, loadFixtures, toastText, statusBarText, clickButton, waitFor, setApiKey } from "../lib/cdp.mjs";

const PORT = process.env.D2_PORT || "8202";
const DECOY_PORT = Number(process.env.D2_DECOY_PORT || "8999");
const fx = loadFixtures();
const repo = path.join(FIXTURES, "Test_Repo");
const marker = path.join(FIXTURES, "HOSTILE-RAN.txt");
const hostileFiles = [path.join(repo, "serve"), path.join(repo, ".vscode", "settings.json")];

const results = [];
const check = (id, ok, evidence) => {
  results.push({ id, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  ${String(evidence).replace(/\s+/g, " ").slice(0, 280)}`);
};
const listeners = () => {
  try {
    return execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in ${PORT},${DECOY_PORT} } | ForEach-Object { '' + $_.LocalPort + ':' + $_.OwningProcess }"`, { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
  } catch { return []; }
};
const killTree = (pid) => { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } };
const hasButton = (cdp, label) => cdp.eval(`[...document.querySelectorAll(".notifications-toasts .monaco-button")].some(b => b.textContent.trim() === ${JSON.stringify(label)})`);

// --- plant the hostile repository
if (fs.existsSync(marker)) fs.rmSync(marker);
fs.mkdirSync(path.join(repo, ".vscode"), { recursive: true });
fs.writeFileSync(path.join(repo, "serve"), `open(r"${marker}", "w").write("the hostile repository ran a command")\n`);
fs.writeFileSync(
  path.join(repo, ".vscode", "settings.json"),
  JSON.stringify({ "codepulse.serverCommand": path.join(fx.binDir, "python.exe"), "codepulse.serverUrl": `http://127.0.0.1:${DECOY_PORT}` }, null, 2),
);

// --- the decoy "attacker" server: records every request it gets
const decoyRequests = [];
const decoy = http.createServer((req, res) => { decoyRequests.push(`${req.method} ${req.url} auth=${req.headers.authorization || req.headers["x-api-key"] || "-"}`); res.statusCode = 503; res.end("{}"); });  // "not healthy": the old code then offered to start a server, i.e. the exploit path
await new Promise((resolve) => decoy.listen(DECOY_PORT, "127.0.0.1", resolve));

// --- the USER's own settings: a different port, prompt on
writeSettings({
  "codepulse.serverUrl": `http://127.0.0.1:${PORT}`,
  "codepulse.autoLaunchServer": true,
  "workbench.startupEditor": "none",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "window.restoreWindows": "none",
  "workbench.tips.enabled": false,
  "chat.disableAIFeatures": true,
  "editor.minimap.enabled": false,
});

const before = listeners().filter((l) => !l.startsWith(`${DECOY_PORT}:`));
const child = launchCode(repo, 9333, { PATH: `${fx.binDir};${process.env.PATH}` });
const cdp = await Cdp.connect(9333, 120000);
try {
  // The offer is a notification VS Code hides by itself some 10-15 s after it appears (about 3 s after the window
  // connects), so look at it FIRST and act on it at once; setting the API key takes several seconds and used to come
  // first, which raced the notification's self-dismissal.
  const toast = await waitFor(() => toastText(cdp), (t) => /Start one locally/i.test(t), 40000);
  await cdp.shot("D2-01-offer");
  check("D2a the offer shows the real command line from the USER's settings (not the repository's)",
    toast.includes(`codepulse serve --host 127.0.0.1 --port ${PORT}`) && !/python/i.test(toast), toast);
  check("D2b the offer has a Don't Ask Again button", await hasButton(cdp, "Don't Ask Again"), "buttons checked");

  const clicked = await clickButton(cdp, "Start Server");
  check("D2c the Start Server button can be clicked", clicked, String(clicked));
  await setApiKey(cdp, fx.key); // while the server starts
  await sleep(35000);

  const ls = listeners();
  const status = await statusBarText(cdp);
  await cdp.shot("D2-02-after-start");
  check("D2d the hostile command did NOT run (no marker file)", !fs.existsSync(marker), fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : "no marker");
  check("D2e the repository's decoy server received NO request (the API key stayed home)", decoyRequests.length === 0, decoyRequests.join(" | ") || "0 requests");
  check(`D2f the real server was started on the USER's port ${PORT}`, ls.some((l) => l.startsWith(`${PORT}:`)), `listeners now: ${ls.join(",") || "(none)"}`);
  check("D2g the status bar ends up connected", /\[check\]|CodePulse: \d+ symbols|not indexed/.test(status) && !/circle-slash/.test(status), status);
  fs.writeFileSync(path.join(RESULTS, "hostile-workspace.json"), JSON.stringify({ before, after: ls, decoyRequests, markerExists: fs.existsSync(marker) }));
  for (const l of ls) if (!before.includes(l) && !l.startsWith(`${DECOY_PORT}:`)) killTree(l.split(":")[1]);
} catch (e) {
  console.log("HARNESS ERROR", e.stack || e);
  try { await cdp.shot("D2-error"); } catch { /* ignore */ }
} finally {
  cdp.close();
  child.kill();
  decoy.close();
  for (const f of hostileFiles) { try { fs.rmSync(f); } catch { /* already gone */ } }
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
}
