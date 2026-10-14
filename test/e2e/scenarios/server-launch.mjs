// Session D1: the extension's "Start Server" path. No server is running; serverUrl points at a NON-default port.
// What happens when the user clicks "Start Server"?
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { launchCode, Cdp, writeSettings, sleep, FIXTURES, RESULTS, loadFixtures, toastText, statusBarText, clickButton, waitFor , setApiKey, quickInputText } from "../lib/cdp.mjs";

const PORT = process.env.D1_PORT || "8201";
const BIN_DIR = loadFixtures().binDir;
const results = [];
const check = (id, ok, evidence) => {
  results.push({ id, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  ${String(evidence).replace(/\s+/g, " ").slice(0, 280)}`);
};
const listeners = () => {
  try {
    return execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8000,${PORT} } | ForEach-Object { '' + $_.LocalPort + ':' + $_.OwningProcess }"`, { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
  } catch { return []; }
};
const killTree = (pid) => { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch { /* gone */ } };

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

const before = listeners();
console.log("listeners before:", before.join(",") || "(none)");
const child = launchCode(path.join(FIXTURES, "Test_Repo"), 9333, { PATH: `${BIN_DIR};${process.env.PATH}` });
const cdp = await Cdp.connect(9333, 120000);
try {
  await sleep(5000);
  await setApiKey(cdp, loadFixtures().key);
  const toast = await waitFor(() => toastText(cdp), (t) => /Start one locally/i.test(t), 40000);
  await cdp.shot("D1-01-offer");
  check("D1a no reachable server -> the extension offers to start one", /No CodePulse server is reachable/.test(toast) && /Start Server/.test(toast), toast);

  const clicked = await clickButton(cdp, "Start Server");
  check("D1b the Start Server button can be clicked", clicked, String(clicked));

  // Give it longer than the extension's own 10s ready-wait, then see what really happened.
  await sleep(30000);
  const ls = listeners();
  const status = await statusBarText(cdp);
  const onTarget = ls.some((l) => l.startsWith(PORT + ":"));
  const onDefault = ls.some((l) => l.startsWith("8000:"));
  await cdp.shot("D1-02-after-start");
  check(`D1c the launched server is listening on the configured port ${PORT}`, onTarget, `listeners now: ${ls.join(",") || "(none)"}; started on default 8000 instead: ${onDefault}`);
  check("D1d the status bar ends up connected", /\[check\]|CodePulse: \d+ symbols|not indexed/.test(status) && !/circle-slash/.test(status), status);
  fs.writeFileSync(path.join(RESULTS, "server-launch-listeners.json"), JSON.stringify({ before, after: ls }));
  // stop anything this test started
  for (const l of ls) if (!before.includes(l)) killTree(l.split(":")[1]);
} catch (e) {
  console.log("HARNESS ERROR", e.stack || e);
  try { await cdp.shot("D1-error"); } catch { /* ignore */ }
} finally {
  cdp.close();
  child.kill();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
}
