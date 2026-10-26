// Unit tests for how the end-to-end runner judges a scenario that did not finish (plain Node): `npm test`.
//
// The runner used to count only the lines that start with PASS or FAIL, so a scenario that CRASHED halfway (VS Code
// refused to start because an update was in progress, so only 2 of 5 checks ever ran) was reported as
// "2 passed, 0 failed": a silent pass. A scenario that does not run to its summary line is a failure.
import test from "node:test";
import assert from "node:assert/strict";

import { scenarioOutcome } from "../e2e/lib/judge.mjs";

const finished = "PASS P1 a  evidence\nPASS P2 b  evidence\n\n2/2 passed\n";

test("a scenario that ran to its summary line and exited 0 is judged finished", () => {
  const outcome = scenarioOutcome({ status: 0, signal: null, error: null, output: finished });
  assert.equal(outcome.crashed, false);
  assert.equal(outcome.reason, null);
});

test("a scenario that exits non-zero is a crash, and the reason says so with the end of its output", () => {
  const output = "PASS P1 a  e\nPASS P2 b  e\nError: could not connect to the VS Code workbench over CDP\n    at Cdp.connect\n";
  const outcome = scenarioOutcome({ status: 1, signal: null, error: null, output });
  assert.equal(outcome.crashed, true);
  assert.match(outcome.reason, /exited with code 1/);
  assert.match(outcome.reason, /could not connect to the VS Code workbench/);
});

test("a scenario that stops without its summary line is a crash even if it exited 0", () => {
  const outcome = scenarioOutcome({ status: 0, signal: null, error: null, output: "PASS P1 a  e\nPASS P2 b  e\n" });
  assert.equal(outcome.crashed, true);
  assert.match(outcome.reason, /did not (finish|reach)/i);
});

test("a scenario killed by a signal or a timeout is a crash", () => {
  assert.equal(scenarioOutcome({ status: null, signal: "SIGTERM", error: null, output: finished }).crashed, true);
  const timedOut = scenarioOutcome({ status: null, signal: null, error: new Error("spawnSync node ETIMEDOUT"), output: "" });
  assert.equal(timedOut.crashed, true);
  assert.match(timedOut.reason, /ETIMEDOUT/);
});

test("a harness error line is not a crash by itself (the scenario handled it and still printed its summary)", () => {
  const output = "PASS P1 a  e\nHARNESS ERROR boom\n\n1/1 passed\n";
  assert.equal(scenarioOutcome({ status: 0, signal: null, error: null, output }).crashed, false);
});

test("the reason shows only the last lines of a long output", () => {
  const output = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const outcome = scenarioOutcome({ status: 1, signal: null, error: null, output });
  assert.match(outcome.reason, /line 59/);
  assert.doesNotMatch(outcome.reason, /line 10\b/);
});
