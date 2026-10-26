// Guards on package.json, .vscodeignore and README.md (plain Node): `npm test`.
//
// These pin the decisions made when preparing the extension for the Marketplace, so a later edit cannot quietly undo
// them: the two settings that decide WHAT RUNS and WHERE THE API KEY GOES must not be settable from a repository, the
// extension must say how it behaves in an untrusted workspace, and the published package and README must not carry
// development leftovers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const pkg = JSON.parse(read("package.json"));
const settings = (Array.isArray(pkg.contributes.configuration) ? pkg.contributes.configuration[0] : pkg.contributes.configuration).properties;

test("codepulse.serverCommand cannot be set by a workspace (it decides which program is run, with the API key in its environment)", () => {
  assert.equal(settings["codepulse.serverCommand"].scope, "machine");
});

test("codepulse.serverUrl cannot be set by a workspace (it decides which host receives the API key)", () => {
  assert.equal(settings["codepulse.serverUrl"].scope, "machine");
});

test("the manifest declares limited support in untrusted workspaces, with an explanation", () => {
  const cap = pkg.capabilities?.untrustedWorkspaces;
  assert.equal(cap?.supported, "limited");
  assert.match(cap.description, /never (starts|launches)/i);
});

test("the manifest declares that virtual workspaces are not supported", () => {
  assert.equal(pkg.capabilities?.virtualWorkspaces?.supported, false);
  assert.ok(pkg.capabilities.virtualWorkspaces.description.length > 20);
});

test("development files are kept out of the published package", () => {
  const ignored = read(".vscodeignore").split(/\r?\n/).map((l) => l.trim());
  for (const pattern of [".github/**", "src/**", "test/**", ".e2e/**"]) {
    assert.ok(ignored.includes(pattern), `.vscodeignore must list ${pattern}`);
  }
});

test("the README is written for users: no publishing walkthrough, no 'not yet published' wording", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /^## Publishing/m);
  assert.doesNotMatch(readme, /not yet published/i);
  assert.doesNotMatch(readme, /placeholder/i);
});

test("the README tells a new user how to get the backend, what it needs, and what it supports", () => {
  const readme = read("README.md");
  assert.match(readme, /pip install codepulse-engine/);
  assert.match(readme, /Python 3\.11/);
  assert.match(readme, /Python, JavaScript and TypeScript/);
  assert.match(readme, /no telemetry/i);
  assert.match(readme, /untrusted workspace|Restricted Mode/i);
});

test("the README documents the setting scopes and the Don't Ask Again behaviour", () => {
  const readme = read("README.md");
  assert.match(readme, /user settings/i);
  assert.match(readme, /Don't Ask Again/);
});

test("the key prompt and README give the exact command that creates a first API key", () => {
  // The CLI has `codepulse key create`; before it existed the prompt said "create one with the CLI" and nothing did.
  const readme = read("README.md");
  assert.match(readme, /codepulse key create --repo/);
  assert.match(read("src/auth.ts"), /codepulse key create --repo/);
  assert.doesNotMatch(read("src/auth.ts"), /admin\/keys/, "the first key cannot come from an endpoint that needs a key");
});

test("the README says the database lives in the user's data directory, not in the project", () => {
  assert.match(read("README.md"), /per-user data directory/i);
});

test("the publisher id is one the Marketplace and vsce accept, and is not the taken 'codepulse'", () => {
  // vsce rejects anything but letters, digits and hyphens ("Expected the identifier of a publisher, not its
  // human-friendly name"); 'codepulse' is registered by another account, so it cannot be published under.
  assert.match(pkg.publisher, /^[a-z0-9][a-z0-9-]*$/i);
  assert.notEqual(pkg.publisher.toLowerCase(), "codepulse");
});

test("the manifest says where the source, the issue tracker and the home page are", () => {
  assert.equal(pkg.repository?.type, "git");
  assert.match(pkg.repository.url, /^https:\/\/github\.com\/Chh-Dhairya\/[\w.-]+\.git$/);
  assert.match(pkg.bugs?.url ?? "", /^https:\/\/github\.com\/Chh-Dhairya\/[\w.-]+\/issues$/);
  assert.match(pkg.homepage ?? "", /^https:\/\/github\.com\/Chh-Dhairya\/[\w.-]+#readme$/);
});

test("the README links to the source and the issue tracker", () => {
  const readme = read("README.md");
  assert.ok(readme.includes(pkg.repository.url.replace(/\.git$/, "")), "the README should link the source repository");
  assert.ok(readme.includes(pkg.bugs.url), "the README should link the issue tracker");
});

test("the extension name is not one the Marketplace already has, and the display name is distinctive", () => {
  // The Marketplace rejected an upload with "The extension 'codepulse-vscode' already exists in the Marketplace"
  // (owned by aicodepulse.codepulse-vscode): unlike a publisher-qualified id, the `name` must be unique across
  // publishers. 17 existing extensions already carry "codepulse" in their name, one displayed exactly "CodePulse".
  assert.notEqual(pkg.name, "codepulse-vscode");
  assert.match(pkg.name, /^[a-z0-9][a-z0-9-]*$/);
  assert.notEqual(pkg.displayName.trim().toLowerCase(), "codepulse");
  assert.ok(pkg.displayName.length >= 12, "a display name longer than the bare product name");
});

test("the changelog has a section for the version in package.json", () => {
  // Every upload to the Marketplace is a new version and the listing's Changelog tab shows this file.
  // (No regex on purpose: an escaped bracket silently became a character class once and the test could not fail.)
  const headings = read("CHANGELOG.md").split(/\r?\n/).filter((line) => line.startsWith("## "));
  assert.ok(headings.some((line) => line.startsWith(`## [${pkg.version}]`)), `no "## [${pkg.version}]" heading in: ${headings.join(" | ")}`);
});
