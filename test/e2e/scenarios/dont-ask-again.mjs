// The start-up prompt must be dismissible for good: "Don't Ask Again" turns codepulse.autoLaunchServer off in the user's
// settings, starts nothing, and (checked by reading the user's settings.json) really persists.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { launchCode, Cdp, writeSettings, sleep, FIXTURES, PROFILE, loadFixtures, toastText, clickButton, waitFor } from "../lib/cdp.mjs";

const PORT = process.env.D3_PORT || "8203";
const fx = loadFixtures();
const results = [];
const check = (id, ok, evidence) => {
  results.push({ id, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  ${String(evidence).replace(/\s+/g, " ").slice(0, 280)}`);
};
const listeners = () => {
  try {
    return execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq ${PORT} } | ForEach-Object { '' + $_.LocalPort + ':' + $_.OwningProcess }"`, { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
  } catch { return []; }
};

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

const child = launchCode(path.join(FIXTURES, "Test_Repo"), 9333, { PATH: `${fx.binDir};${process.env.PATH}` });
const cdp = await Cdp.connect(9333, 120000);
try {
  // The offer is a notification VS Code hides by itself some 10-15 s after it appears (about 3 s after the window
  // connects), so look at it FIRST and act on it at once; setting the API key takes several seconds and used to come
  // first, which raced the notification's self-dismissal.
  const toast = await waitFor(() => toastText(cdp), (t) => /Start one locally/i.test(t), 40000);
  check("D3a the offer appears", /No CodePulse server is reachable/.test(toast), toast);

  const clicked = await clickButton(cdp, "Don't Ask Again");
  check("D3b the Don't Ask Again button can be clicked", clicked, String(clicked));
  await sleep(4000);

  const userSettings = JSON.parse(fs.readFileSync(path.join(PROFILE, "user-data", "User", "settings.json"), "utf8"));
  check("D3c the choice is saved: codepulse.autoLaunchServer is now false in the user's settings", userSettings["codepulse.autoLaunchServer"] === false, JSON.stringify(userSettings["codepulse.autoLaunchServer"]));
  await sleep(8000);
  check("D3d nothing was started", listeners().length === 0, `listeners on ${PORT}: ${listeners().join(",") || "(none)"}`);
  check("D3e the offer is gone", !/Start one locally/i.test(await toastText(cdp)), await toastText(cdp));
} catch (e) {
  console.log("HARNESS ERROR", e.stack || e);
  try { await cdp.shot("D3-error"); } catch { /* ignore */ }
} finally {
  cdp.close();
  child.kill();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
}
