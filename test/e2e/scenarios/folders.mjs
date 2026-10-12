// Session B: never-indexed folder (vsc-12). Session C: multi-root workspace (vsc-13, vsc-14).
import fs from "node:fs";
import path from "node:path";
import { launchCode, Cdp, writeSettings, sleep, FIXTURES, RESULTS, loadFixtures, runCommand, openFile, toastText } from "../lib/cdp.mjs";

const results = [];
function check(id, ok, evidence) {
  results.push({ id, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  ${String(evidence).replace(/\s+/g, " ").slice(0, 300)}`);
}
writeSettings({
  "codepulse.serverUrl": `http://127.0.0.1:${loadFixtures().port}`,
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

async function waitFor(fn, pred, timeoutMs = 30000, step = 500) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < timeoutMs) { v = await fn(); if (pred(v)) return v; await sleep(step); }
  return v;
}

async function session(name, target, body) {
  console.log(`\n--- ${name} ---`);
  const child = launchCode(target);
  const cdp = await Cdp.connect(9333, 120000);
  const statusInfo = () => cdp.eval(`(() => [...document.querySelectorAll('.statusbar-item')].filter(e => /CodePulse/.test(e.innerText)).map(e => { const ic = [...e.querySelectorAll('[class*="codicon-"]')].map(i => (i.className.match(/codicon-([\\w~-]+)/)||[])[1]).join(','); return '[' + ic + '] ' + e.innerText.trim(); }).join(' | '))()`);
  const qiText = () => cdp.eval(`(() => { const w = document.querySelector('.quick-input-widget'); return w && getComputedStyle(w).display !== 'none' ? w.innerText.replace(/\\s+/g,' ') : ''; })()`);
  const qiRows = () => cdp.eval(`[...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.innerText.replace(/\\s+/g,' ').trim())`);
  try {
    await sleep(6000);
    await body({ cdp, statusInfo, qiText, qiRows });
  } catch (e) {
    console.log("HARNESS ERROR", e.stack || e);
    try { await cdp.shot(name + "-error"); } catch { /* ignore */ }
  } finally {
    cdp.close();
    child.kill();
    await sleep(3000);
  }
}

// ---------------- Session B ----------------
if (process.argv[2] !== "C") await session("B-not-indexed", path.join(FIXTURES, "NotIndexed"), async ({ cdp, statusInfo }) => {
  const st = await waitFor(statusInfo, (s) => /not indexed/.test(s), 20000);
  check("vsc-12a status bar says 'not indexed' for an unindexed folder (server is up)", /check/.test(st) && /not indexed/.test(st), st);
  await runCommand(cdp, "CodePulse: Search");
  const toast = await waitFor(() => toastText(cdp), (t) => /indexed yet/i.test(t), 15000);
  await cdp.shot("B01-not-indexed");
  check("vsc-12b 'isn't indexed yet' with an Index Workspace button", /isn't indexed yet/.test(toast) && /Index Workspace/.test(toast), toast);
  check("vsc-12c it is NOT the 'no server is reachable' message", !/no server is reachable/i.test(toast), toast);
});

// ---------------- Session C ----------------
await session("C-multi-root", path.join(FIXTURES, "two.code-workspace"), async ({ cdp, statusInfo, qiText, qiRows }) => {
  await waitFor(statusInfo, (s) => /symbols|not indexed/.test(s), 20000);
  await runCommand(cdp, "CodePulse: Search");
  const placeholder = () => cdp.eval(`(() => { const i = document.querySelector('.quick-input-box input'); return i ? (i.getAttribute('placeholder') || '') : ''; })()`);
  const ph = await waitFor(placeholder, (t) => /Which repository/i.test(t), 15000);
  const pick = (await qiText()) + " [placeholder: " + ph + "]";
  const rows = await qiRows();
  await cdp.shot("C01-folder-picker");
  check("vsc-13 a folder picker appears before the search box, listing both folders",
    /Which repository do you want to search/i.test(pick) && rows.some((r) => /Test_Repo(?!_Other)/.test(r)) && rows.some((r) => /Test_Repo_Other/.test(r)), `${pick.slice(0, 100)} | rows=${rows.join(" ; ")}`);
  await cdp.escape();
  await sleep(800);
  await cdp.escape();

  // vsc-14: status bar follows the active editor
  await openFile(cdp, "calculator.py");
  await sleep(1500);
  const s1 = await waitFor(statusInfo, (s) => /55 symbols/.test(s), 15000);
  await cdp.shot("C02-repo1-active");
  await openFile(cdp, "placeholder.py");
  await sleep(1500);
  const s2 = await waitFor(statusInfo, (s) => /\b1 symbols/.test(s), 15000);
  await cdp.shot("C03-repo2-active");
  await openFile(cdp, "calculator.py");
  await sleep(1500);
  const s3 = await waitFor(statusInfo, (s) => /55 symbols/.test(s), 15000);
  check("vsc-14 status bar follows the active editor across both repos",
    /55 symbols/.test(s1) && /\b1 symbols/.test(s2) && /55 symbols/.test(s3), `calculator.py -> ${s1} | placeholder.py -> ${s2} | back -> ${s3}`);
});

fs.writeFileSync(path.join(RESULTS, "folders.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
