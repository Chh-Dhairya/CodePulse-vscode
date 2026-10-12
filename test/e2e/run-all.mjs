// Runs every real-VS-Code scenario in order, managing the test CodePulse server, and prints one summary.
//   node test/e2e/run-all.mjs [scenario-name ...]
// Prerequisites: `npm run compile`, fixtures built (setup-fixtures.py), VS Code installed. See README.md.
import { spawn, execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_EXE, EXT_DEV, FIXTURES, loadFixtures } from "./lib/cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = loadFixtures();

/** Failures that document a KNOWN, tracked gap rather than a regression (id -> where it is tracked). */
const KNOWN_GAPS = {
  E3: "Index Workspace on a never-indexed folder cannot finish with a scoped key (backend authorization design; see README)",
};

// needsServer: a test server is started before the scenario and stopped after it.
const SCENARIOS = [
  { name: "core", file: "core.mjs", needsServer: true },
  { name: "folders", file: "folders.mjs", needsServer: true },
  { name: "server-launch", file: "server-launch.mjs", needsServer: false },
  { name: "workspace-index-mcp", file: "workspace-index-mcp.mjs", needsServer: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portListener = () => {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${fx.port} -State Listen -ErrorAction SilentlyContinue).OwningProcess"`, { encoding: "utf8" }).trim();
    return out ? out.split(/\s+/)[0] : null;
  } catch { return null; }
};
const stopServer = () => {
  const pid = portListener();
  if (pid) { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } }
};
async function startServer() {
  if (portListener()) throw new Error(`port ${fx.port} is already in use; stop that process first`);
  const exe = path.join(fx.binDir, "codepulse.exe");
  spawn(exe, ["serve", "--port", String(fx.port)], {
    cwd: FIXTURES,
    env: { ...process.env, CODEPULSE_DB_URL: fx.dbUrl, PYTHONUTF8: "1" },
    stdio: "ignore",
    detached: true,
  }).unref();
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${fx.port}/health/live`)).ok) return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error("test server did not come up");
}

// ---- preflight
const problems = [];
if (!fs.existsSync(path.join(EXT_DEV, "out", "extension.js"))) problems.push("extension not compiled: run `npm run compile`");
if (!fs.existsSync(CODE_EXE)) problems.push(`VS Code not found at ${CODE_EXE} (set CODE_EXE)`);
if (!fs.existsSync(path.join(fx.binDir, "codepulse.exe"))) problems.push(`codepulse.exe not found in ${fx.binDir}`);
if (problems.length) { console.error("Cannot run:\n - " + problems.join("\n - ")); process.exit(2); }

const only = process.argv.slice(2);
const chosen = SCENARIOS.filter((s) => only.length === 0 || only.includes(s.name));
let passed = 0, failed = 0, known = 0;
const failures = [];

for (const sc of chosen) {
  console.log(`\n=== ${sc.name} ===`);
  stopServer();
  if (sc.needsServer) await startServer();
  const run = spawnSync(process.execPath, [path.join(HERE, "scenarios", sc.file)], { encoding: "utf8", timeout: 20 * 60 * 1000 });
  stopServer();
  const out = (run.stdout || "") + (run.stderr || "");
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(PASS|FAIL) (\S+)/);
    if (!m) { if (/HARNESS ERROR/.test(line)) { console.log(line); failures.push(`${sc.name}: harness error`); failed++; } continue; }
    const [, verdict, id] = m;
    if (verdict === "PASS") { passed++; console.log(line.slice(0, 200)); continue; }
    const baseId = id.replace(/[a-z]$/, "");
    if (KNOWN_GAPS[id] || KNOWN_GAPS[baseId]) { known++; console.log(`KNOWN GAP ${id}  (${KNOWN_GAPS[id] || KNOWN_GAPS[baseId]})`); continue; }
    failed++; failures.push(`${sc.name}: ${line.slice(0, 200)}`); console.log(line.slice(0, 260));
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${known} known gap(s)`);
if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
