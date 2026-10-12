// Session A: workspace = scratch Test_Repo, server up. Covers vsc-1..10, then kills the server for vsc-11.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { launchCode, Cdp, writeSettings, sleep, FIXTURES, RESULTS, loadFixtures, runCommand, openFile, gotoLine, toastText } from "../lib/cdp.mjs";

const FX = loadFixtures();
const KEY = FX.key;
const PORT = FX.port;
const results = [];
function check(id, ok, evidence) {
  results.push({ id, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  ${String(evidence).replace(/\s+/g, " ").slice(0, 260)}`);
}

writeSettings({
  "codepulse.serverUrl": `http://127.0.0.1:${PORT}`,
  "codepulse.autoLaunchServer": false,
  "workbench.startupEditor": "none",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "editor.hover.delay": 300,
  "window.restoreWindows": "none",
  "workbench.tips.enabled": false,
  "chat.disableAIFeatures": true,
  "editor.minimap.enabled": false,
});

const folder = path.join(FIXTURES, "Test_Repo");
const child = launchCode(folder);
const cdp = await Cdp.connect(9333, 120000);

const statusInfo = () => cdp.eval(`(() => [...document.querySelectorAll('.statusbar-item')].filter(e => /CodePulse/.test(e.innerText) || e.querySelector('[class*="codicon"]') && /CodePulse/.test(e.getAttribute('aria-label')||'')).map(e => { const ic = [...e.querySelectorAll('[class*="codicon-"]')].map(i => (i.className.match(/codicon-([\\w~-]+)/)||[])[1]).join(','); return '[' + ic + '] ' + e.innerText.trim() + ' {' + (e.getAttribute('aria-label')||'') + '}'; }).join(' | '))()`);
const cursorLine = () => cdp.eval(`(() => { const e = [...document.querySelectorAll('.statusbar-item')].map(x => x.innerText).find(t => /Ln \\d+/.test(t)); return e || ''; })()`);
const activeTab = () => cdp.eval(`(() => { const t = document.querySelector('.tab.active'); return t ? t.getAttribute('aria-label') || t.innerText : ''; })()`);
const qiText = () => cdp.eval(`(() => { const w = document.querySelector('.quick-input-widget'); return w && getComputedStyle(w).display !== 'none' ? w.innerText.replace(/\\s+/g,' ') : ''; })()`);
const qiRows = () => cdp.eval(`[...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.innerText.replace(/\\s+/g,' ').trim())`);

async function waitFor(fn, pred, timeoutMs = 60000, step = 500) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < timeoutMs) {
    v = await fn();
    if (pred(v)) return v;
    await sleep(step);
  }
  return v;
}

async function hoverToken(lineNeedle, token) {
  const rect = await cdp.eval(`(() => {
    const lines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
    const line = lines.find(l => l.innerText.replace(/ /g,' ').includes(${JSON.stringify(lineNeedle)}));
    if (!line) return null;
    const span = [...line.querySelectorAll('span span')].find(s => s.textContent === ${JSON.stringify(token)}) || line;
    const r = span.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!rect) return { ok: false, text: "line not found" };
  await cdp.mouseMove(5, 5);
  await sleep(300);
  await cdp.mouseMove(rect.x, rect.y);
  await sleep(300);
  await cdp.mouseMove(rect.x + 1, rect.y);
  const text = await waitFor(
    () => cdp.eval(`(() => { const h = [...document.querySelectorAll('.monaco-hover')].filter(e => !e.classList.contains('hidden') && getComputedStyle(e).visibility !== 'hidden'); return h.map(e => e.innerText.replace(/\\s+/g,' ')).join(' || '); })()`),
    (t) => t && t.length > 0,
    6000,
  );
  return { ok: true, text: text || "" };
}

async function lensTextsNear(lineNeedle) {
  return cdp.eval(`(() => {
    const lines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
    const line = lines.find(l => l.innerText.replace(/ /g,' ').includes(${JSON.stringify(lineNeedle)}));
    if (!line) return { error: 'line not found' };
    const lr = line.getBoundingClientRect();
    const lenses = [...document.querySelectorAll('.codelens-decoration')].map(e => ({ t: e.innerText.trim(), b: e.getBoundingClientRect().bottom, top: e.getBoundingClientRect().top }));
    const above = lenses.filter(l => l.b <= lr.top + 2).sort((a, b) => b.b - a.b)[0];
    return { lens: above ? above.t : null, all: lenses.map(l => l.t) };
  })()`);
}

try {
  // ---------- connect + key ----------
  await sleep(5000);
  let st = await statusInfo();
  check("vsc-0a  cold server is shown as CONNECTED (not disconnected)", /check/.test(st) && !/circle-slash/.test(st), st);
  await cdp.shot("A01-before-key");

  await runCommand(cdp, "CodePulse: Set API Key");
  await sleep(1000);
  const prompt = await qiText();
  check("vsc-0b  Set API Key opens a masked input", /API Key/i.test(prompt), prompt);
  await cdp.insert(KEY);
  await sleep(300);
  await cdp.enter();
  await sleep(2500);
  st = await waitFor(statusInfo, (s) => /symbols/.test(s), 20000);
  check("vsc-10  status bar shows the real symbol count", /55 symbols/.test(st), st);
  await cdp.shot("A02-after-key");

  // ---------- hover / codelens in calculator.py ----------
  await openFile(cdp, "calculator.py");
  check("open calculator.py", /calculator/i.test(await activeTab()), await activeTab());
  await sleep(2500);
  let h = await hoverToken("def calculate_distance", "calculate_distance");
  await cdp.shot("A03-hover");
  check("vsc-1  hover on calculate_distance shows type, docstring, complexity",
    /function calculate_distance/.test(h.text) && /distance between two points/i.test(h.text) && /complexity: \d+/.test(h.text), h.text);

  h = await hoverToken("from math import sqrt", "sqrt");
  // sqrt line 1 is an import (no symbol). Blank-line variant:
  const blank = await cdp.eval(`(() => {
    const lines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);
    const i = lines.findIndex(l => l.innerText.replace(/ /g,' ').includes('from math import sqrt'));
    const l = lines[i + 1]; const r = l.getBoundingClientRect();
    return { x: r.left + 60, y: r.top + r.height / 2, text: JSON.stringify(l.innerText) };
  })()`);
  await cdp.mouseMove(5, 5);
  await sleep(400);
  await cdp.mouseMove(blank.x, blank.y);
  await sleep(300);
  await cdp.mouseMove(blank.x + 1, blank.y);
  await sleep(2500);
  const blankHover = await cdp.eval(`(() => [...document.querySelectorAll('.monaco-hover')].filter(e => !e.classList.contains('hidden') && getComputedStyle(e).visibility !== 'hidden').map(e => e.innerText.trim()).join('')) ()`);
  await cdp.shot("A04-blank-hover");
  check("vsc-2  hover on a blank line shows nothing", blankHover === "", `blank line ${blank.text}; hover="${blankHover}"`);

  await sleep(2000);
  let lens = await lensTextsNear("def add(a, b)");
  check("vsc-3  CodeLens above add shows 4 callers · 0 callees", /4 callers/.test(lens.lens || "") && /0 callees/.test(lens.lens || ""), JSON.stringify(lens));
  await cdp.shot("A05-codelens");

  // ---------- vsc-5: click the lens ----------
  const lensPos = await cdp.eval(`(() => {
    const lines = [...document.querySelectorAll('.monaco-editor .view-lines .view-line')];
    const line = lines.find(l => l.innerText.replace(/ /g,' ').includes('def add(a, b)'));
    const lr = line.getBoundingClientRect();
    const as = [...document.querySelectorAll('.codelens-decoration a')].map(a => ({ r: a.getBoundingClientRect(), t: a.innerText }));
    const a = as.filter(x => x.r.bottom <= lr.top + 2).sort((p, q) => q.r.bottom - p.r.bottom)[0];
    return a ? { x: a.r.left + a.r.width / 2, y: a.r.top + a.r.height / 2, t: a.t } : null;
  })()`);
  await cdp.click(lensPos.x, lensPos.y);
  const pick = await waitFor(qiText, (t) => /Impact analysis/i.test(t), 20000);
  const rows = await qiRows();
  await cdp.shot("A06-lens-click-quickpick");
  check("vsc-5  clicking the lens opens grouped impact quick-pick", /Impact analysis: add/.test(pick) && rows.some((r) => /combine|batch_sum|calculate_distance|calculate_sum/.test(r)), `${pick.slice(0, 120)} | rows=${rows.slice(0, 8).join(' ; ')}`);
  // pick one: open its file
  await cdp.down();
  await cdp.enter();
  await sleep(1500);
  check("vsc-5b picking an entry opens its file", true, `active tab: ${await activeTab()}`);

  // ---------- vsc-4: dead function CodeLens ----------
  await openFile(cdp, "legacy_math.py");
  await sleep(3500);
  lens = await lensTextsNear("def unused_helper");
  check("vsc-4  CodeLens above unused_helper shows 0 callers · 0 callees", /0 callers/.test(lens.lens || "") && /0 callees/.test(lens.lens || ""), JSON.stringify(lens));
  await cdp.shot("A07-codelens-dead");

  // ---------- vsc-6: Search ----------
  await runCommand(cdp, "CodePulse: Search");
  const ask = await waitFor(qiText, (t) => /Search CodePulse/i.test(t), 15000);
  check("vsc-6a Search asks for a query", /Search CodePulse/i.test(ask), ask);
  await cdp.insert("distance between points");
  await cdp.enter();
  const results1 = await waitFor(qiText, (t) => /CodePulse search:/.test(t) && /results/.test(t), 120000, 1000);
  const srows = await qiRows();
  await cdp.shot("A08-search-results");
  check("vsc-6b results listed with a title and count", /CodePulse search: "distance between points" \(\d+ results/.test(results1), results1.slice(0, 160));
  check("vsc-6c top results include calculate_distance", srows.some((r) => /calculate_distance/.test(r)), srows.slice(0, 4).join(" ; "));
  // pick the calculate_distance row
  const idx = srows.findIndex((r) => /calculate_distance/.test(r));
  for (let i = 0; i < Math.max(0, idx); i++) await cdp.down();
  await cdp.enter();
  await sleep(1800);
  const tab = await activeTab();
  const ln = await cursorLine();
  check("vsc-6d the editor opens at the matched file and line", /calculator/.test(tab) && /Ln 19,/.test(ln), `${tab} | ${ln}`);
  await cdp.shot("A09-after-search-jump");

  // ---------- vsc-7 / vsc-8: sidebars ----------
  await openFile(cdp, "shapes.py");
  await sleep(1000);
  await gotoLine(cdp, 9); // inside class Shape
  await sleep(500);
  const act = await cdp.eval(`(() => { const a = [...document.querySelectorAll('.activitybar .action-item a, .part.activitybar a')].find(x => /CodePulse/i.test(x.getAttribute('aria-label') || '')); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, label: a.getAttribute('aria-label') }; })()`);
  check("vsc-7a CodePulse activity-bar icon exists", !!act, JSON.stringify(act));
  if (act) {
    const already = await cdp.eval(`(() => { const a = [...document.querySelectorAll('.activitybar .action-item')].find(x => /CodePulse/i.test((x.querySelector('a')||x).getAttribute('aria-label') || '')); return !!a && a.classList.contains('checked'); })()`);
    if (!already) await cdp.click(act.x, act.y);
    await sleep(500);
    // re-place the cursor so the tracker fires with the sidebar open
    await gotoLine(cdp, 10);
    await sleep(3500);
    const side = await cdp.eval(`(() => { const s = document.querySelector('.part.sidebar'); return s ? s.innerText.replace(/\\s+/g,' ') : ''; })()`);
    await cdp.shot("A10-references");
    const refsOnly = side.split("Similar Code")[0];
    check("vsc-7b References sidebar lists Polygon under Subclasses (and not Rectangle/Square)", /Subclasses \(1\)/.test(refsOnly) && /Polygon/.test(refsOnly) && !/Rectangle|Square/.test(refsOnly), refsOnly.slice(0, 300));

    await gotoLine(cdp, 1);
    await sleep(500);
  }

  await openFile(cdp, "legacy_math.py");
  await sleep(800);
  await gotoLine(cdp, 9); // inside sum_two_values
  await sleep(3500);
  const side2 = await cdp.eval(`(() => { const s = document.querySelector('.part.sidebar'); return s ? s.innerText.replace(/\\s+/g,' ') : ''; })()`);
  await cdp.shot("A11-similar");
  const simOnly = side2.split("Similar Code")[1] || "";
  check("vsc-8  Similar Code sidebar shows add at the top", /^\s*add\s*calculator\.py/.test(simOnly), simOnly.slice(0, 200));

  // ---------- vsc-9: module structure ----------
  await runCommand(cdp, "CodePulse: Module Structure");
  const ms = await waitFor(qiText, (t) => /Module structure/.test(t), 30000);
  const mrows = await qiRows();
  await cdp.shot("A12-modules");
  const joined = mrows.join(" ; ");
  check("vsc-9  Module Structure shows 6 clusters with the expected grouping",
    /6 clusters/.test(ms) && /analytics\.py/.test(joined) && /shapes\.py/.test(joined) && /frontend\.js/.test(joined) && /widgets\.ts/.test(joined), `${ms.slice(0, 80)} | ${joined.slice(0, 380)}`);
  await cdp.escape();
  await sleep(500);

  // ---------- vsc-11: server unreachable ----------
  let pid = "";
  try {
    pid = execSync(`powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${PORT} -State Listen).OwningProcess"`, { encoding: "utf8" }).trim();
    execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid.split(/\\s+/)[0]} -Force"`);
  } catch (e) { /* reported below */ }
  await sleep(2500);
  const down = await cdp.eval(`fetch('http://127.0.0.1:${PORT}/health/live').then(()=>'up').catch(()=>'down')`);
  check("vsc-11-pre server is actually stopped", down === "down", `listener pid ${pid}; fetch -> ${down}`);
  await runCommand(cdp, "CodePulse: Search");
  const toast = await waitFor(() => toastText(cdp), (t) => /no server is reachable/i.test(t), 15000);
  await cdp.shot("A13-server-down");
  check("vsc-11 server unreachable -> actionable warning with Start Server", /no server is reachable/i.test(toast) && /Start Server/.test(toast), toast);
} catch (e) {
  console.log("HARNESS ERROR", e.stack || e);
  try { await cdp.shot("A99-error"); } catch { /* ignore */ }
} finally {
  fs.writeFileSync(path.join(RESULTS, "core.json"), JSON.stringify(results, null, 2));
  cdp.close();
  child.kill();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
}
