// Decides whether an end-to-end scenario ran to completion. Pure (no VS Code, no processes), so it is unit-tested.
//
// The runner only understands lines that start with PASS or FAIL. A scenario that CRASHES before or between checks
// (VS Code refusing to start, a thrown error outside the scenario's own try block) prints no FAIL line at all, so it
// used to be counted as "N passed, 0 failed". Every scenario ends by printing "<passed>/<total> passed"; one that exits
// non-zero, is killed, times out, or never prints that line did not finish, and that is a failure.

const SUMMARY = /\d+\/\d+ passed/;

function lastLines(text, count = 8) {
  return text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(-count).join("\n");
}

export function scenarioOutcome({ status, signal, error, output }) {
  const tail = lastLines(output ?? "");
  if (error) {
    return { crashed: true, reason: `the scenario could not run to completion: ${error.message}\n${tail}`, tail };
  }
  if (signal) {
    return { crashed: true, reason: `the scenario was killed by ${signal}\n${tail}`, tail };
  }
  if (status !== 0) {
    return { crashed: true, reason: `the scenario exited with code ${status}\n${tail}`, tail };
  }
  if (!SUMMARY.test(output ?? "")) {
    return { crashed: true, reason: `the scenario did not finish (it never printed its "<passed>/<total> passed" line)\n${tail}`, tail };
  }
  return { crashed: false, reason: null, tail };
}
