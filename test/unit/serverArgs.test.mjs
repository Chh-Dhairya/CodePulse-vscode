// Unit tests for serveArgsForUrl (plain Node, no VS Code needed): `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { serveArgsForUrl } = require("../../out/serverArgs.js");

test("the default URL maps to the default port on loopback", () => {
  assert.deepEqual(serveArgsForUrl("http://127.0.0.1:8000"), { args: ["serve", "--host", "127.0.0.1", "--port", "8000"] });
});

test("a non-default port is passed through (the launched server must listen where the extension looks)", () => {
  assert.deepEqual(serveArgsForUrl("http://127.0.0.1:8201"), { args: ["serve", "--host", "127.0.0.1", "--port", "8201"] });
});

test("localhost is bound as 127.0.0.1", () => {
  assert.deepEqual(serveArgsForUrl("http://localhost:9000"), { args: ["serve", "--host", "127.0.0.1", "--port", "9000"] });
});

test("an IPv6 loopback URL is bound without brackets", () => {
  assert.deepEqual(serveArgsForUrl("http://[::1]:8123"), { args: ["serve", "--host", "::1", "--port", "8123"] });
});

test("a URL without a port means port 80", () => {
  assert.deepEqual(serveArgsForUrl("http://127.0.0.1"), { args: ["serve", "--host", "127.0.0.1", "--port", "80"] });
});

test("a trailing slash or path does not matter", () => {
  assert.deepEqual(serveArgsForUrl("http://127.0.0.1:8201/"), { args: ["serve", "--host", "127.0.0.1", "--port", "8201"] });
});

test("a remote host is refused with an explanation, not launched on the wrong machine", () => {
  const r = serveArgsForUrl("http://codepulse.example.com:8000");
  assert.ok("error" in r);
  assert.match(r.error, /not a local address/);
});

test("https is refused (the local server only speaks plain HTTP)", () => {
  const r = serveArgsForUrl("https://127.0.0.1:8443");
  assert.ok("error" in r);
  assert.match(r.error, /http:\/\//);
});

test("an invalid URL is refused", () => {
  const r = serveArgsForUrl("not a url");
  assert.ok("error" in r);
  assert.match(r.error, /not a valid URL/);
});
