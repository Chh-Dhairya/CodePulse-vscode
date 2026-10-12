// Session D2: Index Workspace (existing repo, then a brand-new one) and the MCP server registration.
// Requires a test server already running on :8200 against the scratch DB, and the API key stored in the profile.
import fs from "node:fs";
import path from "node:path";
import { launchCode, Cdp, writeSettings, sleep, FIXTURES, RESULTS, loadFixtures, runCommand, toastText, statusBarText, clickButton, waitFor } from "../lib/cdp.mjs";

const FX = loadFixtures();
const results = [];
const check = (id, ok, evidence) => {
  results.push({ id, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  ${String(evidence).replace(/\s+/g, " ").slice(0, 320)}`);
};

writeSettings({
  "codepulse.serverUrl": `http://127.0.0.1:${FX.port}`,
  "codepulse.autoLaunchServer": false,
  "workbench.startupEditor": "none",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "window.restoreWindows": "none",
  "workbench.tips.enabled": false,
  "chat.disableAIFeatures": false, // MCP lives in the chat feature set
  "editor.minimap.enabled": false,
});

const env = { PATH: `${FX.binDir};${process.env.PATH}` };
const only = process.argv[2] || "all";

async function session(name, folder, body) {
  console.log(`\n--- ${name} ---`);
  const child = launchCode(folder, 9333, env);
  const cdp = await Cdp.connect(9333, 120000);
  try {
    await sleep(6000);
    await body(cdp);
  } catch (e) {
    console.log("HARNESS ERROR", e.stack || e);
    try { await cdp.shot(name + "-error"); } catch { /* ignore */ }
  } finally {
    cdp.close();
    child.kill();
    await sleep(3000);
  }
}

const qiText = (cdp) => cdp.eval(`(() => { const w = document.querySelector('.quick-input-widget'); return w && getComputedStyle(w).display !== 'none' ? w.innerText.replace(/\\s+/g,' ') : ''; })()`);
const qiRows = (cdp) => cdp.eval(`[...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.innerText.replace(/\\s+/g,' ').trim())`);

if (only === "all" || only === "index") {
  await session("D2-index-existing", path.join(FIXTURES, "Test_Repo"), async (cdp) => {
    await waitFor(() => statusBarText(cdp), (s) => /symbols/.test(s), 30000);
    await runCommand(cdp, "CodePulse: Index Workspace");
    // a progress notification appears, then a final toast
    const progress = await waitFor(() => toastText(cdp), (t) => /indexing "Test_Repo"/.test(t), 20000);
    await cdp.shot("D2-01-progress");
    check("E1a Index Workspace shows a progress notification while the job runs", /indexing "Test_Repo"/.test(progress), progress);
    const done = await waitFor(() => toastText(cdp), (t) => /indexed successfully|failed|lost track/i.test(t), 150000, 1000);
    await cdp.shot("D2-02-done");
    check("E1b Index Workspace on an already-indexed repo finishes with 'indexed successfully'", /"Test_Repo" indexed successfully/.test(done), done);
    const st = await statusBarText(cdp);
    check("E1c the status bar still shows the real symbol count afterwards", /55 symbols/.test(st), st);
  });
}

if (only === "all" || only === "mcp") {
  await session("D2-mcp", path.join(FIXTURES, "Test_Repo"), async (cdp) => {
    await waitFor(() => statusBarText(cdp), (s) => /symbols/.test(s), 30000);
    await runCommand(cdp, "MCP: List Servers");
    const list = await waitFor(() => qiRows(cdp), (r) => r.length > 0, 15000);
    await cdp.shot("D2-03-mcp-list");
    check("E2a MCP: List Servers shows the CodePulse server the extension registered", list.some((r) => /CodePulse/.test(r)), list.join(" ; "));
    // pick it, then look at the actions offered for it
    const idx = list.findIndex((r) => /CodePulse/.test(r));
    for (let i = 0; i < Math.max(0, idx); i++) await cdp.down();
    await cdp.enter();
    await sleep(1500);
    const actions = await qiRows(cdp);
    await cdp.shot("D2-04-mcp-actions");
    check("E2b the server offers Start / Show Output style actions", actions.some((r) => /Start Server|Stop Server|Show Output|Restart/i.test(r)), actions.join(" ; "));
    const start = actions.findIndex((r) => /Start Server/i.test(r));
    if (start >= 0) {
      for (let i = 0; i < start; i++) await cdp.down();
      await cdp.enter();
      // The server preloads the embedding model before it answers `initialize`: give it time.
      await sleep(45000);
      await runCommand(cdp, "MCP: List Servers");
      const after = await waitFor(() => qiRows(cdp), (r) => r.length > 0, 15000);
      await cdp.shot("D2-05-mcp-after-start");
      const row = after.find((r) => /CodePulse/.test(r)) || "";
      check("E2c after Start Server the CodePulse MCP server is Running (it handshook and listed its tools)", /Running/i.test(row), row || after.join(" ; "));
      // open its output log and look for the tool discovery line
      const ci = after.findIndex((r) => /CodePulse/.test(r));
      for (let i = 0; i < Math.max(0, ci); i++) await cdp.down();
      await cdp.enter();
      await sleep(1200);
      const acts = await qiRows(cdp);
      const so = acts.findIndex((r) => /Show Output/i.test(r));
      for (let i = 0; i < Math.max(0, so); i++) await cdp.down();
      await cdp.enter();
      await sleep(3000);
      const log = await cdp.eval(`(() => [...document.querySelectorAll('.part.panel .view-lines')].map(e => e.innerText.replace(/\\u00a0/g, ' ')).join(' / '))()`);
      await cdp.shot("D2-05b-mcp-output");
      check("E2d the MCP output log shows the tools were discovered", /Discovered 8 tools|8 tools/i.test(log), log.replace(/\s+/g, " ").slice(0, 300));
      await cdp.escape();
    } else {
      check("E2c start the MCP server", false, "no Start Server action was offered: " + actions.join(" ; "));
    }
  });
}

if (only === "all" || only === "new") {
  await session("D2-index-new", path.join(FIXTURES, "NotIndexed"), async (cdp) => {
    await waitFor(() => statusBarText(cdp), (s) => /not indexed/.test(s), 30000);
    await runCommand(cdp, "CodePulse: Index Workspace");
    const done = await waitFor(() => toastText(cdp), (t) => /indexed successfully|failed|lost track|could not start/i.test(t), 150000, 1000);
    await sleep(2000);
    await cdp.shot("D2-06-new-repo");
    const st = await statusBarText(cdp);
    check("E3 Index Workspace on a NEVER-indexed folder completes and the folder then reads as indexed",
      /indexed successfully/.test(done) && !/not indexed/.test(st), `toast: ${done} | status: ${st}`);
  });
}

fs.writeFileSync(path.join(RESULTS, "workspace-index-mcp.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
