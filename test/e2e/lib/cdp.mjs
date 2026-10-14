// Minimal Chrome-DevTools-Protocol driver for a REAL VS Code window (Node 22 global WebSocket).
// Windows-only as written (default VS Code location, PowerShell helpers in the scenarios).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The extension under test: this repository (its compiled `out/`). */
export const EXT_DEV = path.resolve(HERE, "..", "..", "..");
/** Everything the suite creates (fixtures, throwaway VS Code profile, screenshots, results). Gitignored. */
export const WORKDIR = process.env.E2E_WORKDIR ? path.resolve(process.env.E2E_WORKDIR) : path.join(EXT_DEV, ".e2e");
export const FIXTURES = path.join(WORKDIR, "fixtures");
export const PROFILE = path.join(WORKDIR, "profile");
export const SHOTS = path.join(WORKDIR, "shots");
export const RESULTS = path.join(WORKDIR, "results");
for (const dir of [SHOTS, RESULTS]) fs.mkdirSync(dir, { recursive: true });

export const CODE_EXE =
  process.env.CODE_EXE ||
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe");

/** Written by setup-fixtures.py: where the backend's `codepulse` lives, the test API key, the database. */
export function loadFixtures() {
  const file = path.join(FIXTURES, "fixtures.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No fixtures at ${file}. Run test/e2e/setup-fixtures.py first (see test/e2e/README.md).`);
  }
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  fx.key = fs.readFileSync(path.join(FIXTURES, "key.txt"), "utf8").trim();
  return fx;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function writeSettings(settings) {
  const dir = path.join(PROFILE, "user-data", "User");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2));
}

export function launchCode(target, port = 9333, env = {}) {
  fs.mkdirSync(path.join(PROFILE, "extensions"), { recursive: true });
  const args = [
    `--user-data-dir=${path.join(PROFILE, "user-data")}`,
    `--extensions-dir=${path.join(PROFILE, "extensions")}`,
    `--extensionDevelopmentPath=${EXT_DEV}`,
    `--remote-debugging-port=${port}`,
    "--disable-workspace-trust",
    "--skip-release-notes",
    "--skip-welcome",
    "--disable-telemetry",
    "--disable-updates",
    "--new-window",
    target,
  ];
  const child = spawn(CODE_EXE, args, { stdio: "ignore", detached: false, env: { ...process.env, ...env } });
  return child;
}

async function getTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  return res.json();
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }

  static async connect(port = 9333, timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const targets = await getTargets(port);
        const page = targets.find((t) => t.type === "page" && /workbench/.test(t.url));
        if (page) {
          const ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((res, rej) => {
            ws.addEventListener("open", res);
            ws.addEventListener("error", rej);
          });
          return new Cdp(ws);
        }
      } catch { /* not up yet */ }
      await sleep(500);
    }
    throw new Error("could not connect to the VS Code workbench over CDP");
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  }

  async key(key, { ctrl = false, shift = false, alt = false, code, vk } = {}) {
    const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const base = { key, code: code ?? key, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  enter() { return this.key("Enter", { code: "Enter", vk: 13 }); }
  escape() { return this.key("Escape", { code: "Escape", vk: 27 }); }
  down() { return this.key("ArrowDown", { code: "ArrowDown", vk: 40 }); }
  f1() { return this.key("F1", { code: "F1", vk: 112 }); }
  ctrlP() { return this.key("p", { ctrl: true, code: "KeyP", vk: 80 }); }
  insert(text) { return this.send("Input.insertText", { text }); }

  async mouseMove(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }
  async click(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    const file = path.join(SHOTS, name + ".png");
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// ---- higher-level helpers -------------------------------------------------
export async function runCommand(cdp, title) {
  await cdp.f1();
  await sleep(600);
  await cdp.insert(title);
  // Press Enter only once the palette's top row IS this command; a fixed delay raced the filter
  // and sometimes executed nothing (or the wrong entry).
  const want = title.toLowerCase();
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    const top = await cdp.eval(`(() => { const r = document.querySelector('.quick-input-list .monaco-list-row'); return r ? r.innerText.toLowerCase() : ''; })()`);
    if (top.includes(want)) break;
    await sleep(150);
  }
  await cdp.enter();
}

export async function quickInputVisible(cdp) {
  return cdp.eval(`!!document.querySelector('.quick-input-widget') && getComputedStyle(document.querySelector('.quick-input-widget')).display !== 'none'`);
}

export async function quickInputText(cdp) {
  return cdp.eval(`(() => { const w = document.querySelector('.quick-input-widget'); return w ? w.innerText : ''; })()`);
}

export async function statusBarText(cdp) {
  return cdp.eval(`(() => { const items = [...document.querySelectorAll('.statusbar-item')].map(e => e.innerText.trim()).filter(t => /CodePulse/.test(t)); return items.join(' | '); })()`);
}

export async function toastText(cdp) {
  return cdp.eval(`[...document.querySelectorAll('.notifications-toasts .notification-list-item, .notification-toast')].map(e => e.innerText.replace(/\\s+/g,' ').trim()).join(' || ')`);
}

export async function openFile(cdp, name) {
  await cdp.ctrlP();
  await sleep(500);
  await cdp.insert(name);
  await sleep(700);
  await cdp.enter();
  await sleep(1200);
}

export async function gotoLine(cdp, line) {
  await cdp.ctrlP();
  await sleep(400);
  await cdp.insert(":" + line);
  await sleep(300);
  await cdp.enter();
  await sleep(500);
}

export async function clickButton(cdp, label, scope = ".notifications-toasts") {
  const pos = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll(${JSON.stringify(scope + " .monaco-button")})].find(x => x.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!pos) return false;
  await cdp.click(pos.x, pos.y);
  return true;
}

export async function waitFor(fn, pred, timeoutMs = 30000, step = 500) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < timeoutMs) {
    v = await fn();
    if (pred(v)) return v;
    await sleep(step);
  }
  return v;
}

/**
 * Enters the API key through the extension's real masked input box. Every scenario does this itself, so it
 * never depends on what an earlier scenario (or an earlier run, against rebuilt fixtures with a new key) left
 * in the profile's secret storage.
 */
export async function setApiKey(cdp, key) {
  await runCommand(cdp, "CodePulse: Set API Key");
  await waitFor(() => quickInputText(cdp), (t) => /API Key/i.test(t), 15000);
  await cdp.insert(key);
  await sleep(300);
  await cdp.enter();
  await sleep(2500);
}
