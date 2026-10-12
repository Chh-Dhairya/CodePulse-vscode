// Unit tests for CodePulseClient (plain Node, fetch stubbed, time injected): `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CodePulseClient,
  CodePulseApiError,
  REPOSITORY_CACHE_TTL_MS,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_MAX_WAIT_MS,
} = require("../../out/client.js");

const REPOS = { repositories: [{ repository_id: 1, name: "r", url: "/r", branch: "main", file_count: 1, symbol_count: 5, last_sync: null }] };

/** A fetch stub that replays queued responses and records every call. */
function stubFetch(t, responses) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return typeof next === "function" ? next() : next.clone();
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function makeClient({ url = "http://127.0.0.1:8000", clock = { t: 0 }, sleeps = [] } = {}) {
  const client = new CodePulseClient(
    () => url,
    async () => "cpk_test",
    () => clock.t,
    async (ms) => { sleeps.push(ms); },
  );
  return { client, clock, sleeps };
}

// --- health -----------------------------------------------------------------

test("health() checks /health/live, never /health/ready (a cold server answers ready with 503)", async (t) => {
  const calls = stubFetch(t, [new Response("{}", { status: 200 })]);
  const { client } = makeClient();
  assert.equal(await client.health(), true);
  assert.equal(calls[0].url, "http://127.0.0.1:8000/health/live");
});

test("health() is false when the server cannot be reached", async (t) => {
  stubFetch(t, [() => { throw new Error("ECONNREFUSED"); }]);
  assert.equal(await makeClient().client.health(), false);
});

// --- repository cache -----------------------------------------------------

test("listRepositories() is served from the cache inside the TTL", async (t) => {
  const calls = stubFetch(t, [json(200, REPOS)]);
  const { client, clock } = makeClient();
  await client.listRepositories();
  clock.t += REPOSITORY_CACHE_TTL_MS - 1;
  const again = await client.listRepositories();
  assert.equal(calls.length, 1);
  assert.equal(again[0].repository_id, 1);
});

test("listRepositories() refetches once the TTL has passed", async (t) => {
  const calls = stubFetch(t, [json(200, REPOS)]);
  const { client, clock } = makeClient();
  await client.listRepositories();
  clock.t += REPOSITORY_CACHE_TTL_MS;
  await client.listRepositories();
  assert.equal(calls.length, 2);
});

test("concurrent listRepositories() calls share one request", async (t) => {
  const calls = stubFetch(t, [json(200, REPOS)]);
  const { client } = makeClient();
  await Promise.all([client.listRepositories(), client.listRepositories(), client.listRepositories()]);
  assert.equal(calls.length, 1);
});

test("invalidateRepositoryCache() forces a refetch", async (t) => {
  const calls = stubFetch(t, [json(200, REPOS)]);
  const { client } = makeClient();
  await client.listRepositories();
  client.invalidateRepositoryCache();
  await client.listRepositories();
  assert.equal(calls.length, 2);
});

test("the cache is per server URL", async (t) => {
  const calls = stubFetch(t, [json(200, REPOS)]);
  let url = "http://127.0.0.1:8000";
  const client = new CodePulseClient(() => url, async () => "cpk_test", () => 0, async () => {});
  await client.listRepositories();
  url = "http://127.0.0.1:8201";
  await client.listRepositories();
  assert.equal(calls.length, 2);
});

test("a failed fetch is not cached", async (t) => {
  const calls = stubFetch(t, [json(500, { error: { code: "internal_server_error", message: "boom", details: {} } }), json(200, REPOS)]);
  const { client } = makeClient();
  await assert.rejects(client.listRepositories(), (e) => e instanceof CodePulseApiError && e.status === 500);
  const repos = await client.listRepositories();
  assert.equal(calls.length, 2);
  assert.equal(repos.length, 1);
});

// --- 429 retry --------------------------------------------------------------

test("a 429 is retried after the server's Retry-After, then succeeds", async (t) => {
  const calls = stubFetch(t, [json(429, { error: { code: "too_many_requests", message: "slow down", details: { retry_after_seconds: 2 } } }, { "retry-after": "2" }), json(200, REPOS)]);
  const { client, sleeps } = makeClient();
  const repos = await client.listRepositories();
  assert.equal(repos.length, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
});

test("retry_after_seconds in the error envelope is used when there is no Retry-After header", async (t) => {
  stubFetch(t, [json(429, { error: { code: "too_many_requests", message: "slow down", details: { retry_after_seconds: 3 } } }), json(200, REPOS)]);
  const { client, sleeps } = makeClient();
  await client.listRepositories();
  assert.deepEqual(sleeps, [3000]);
});

test("the wait is capped, so a huge Retry-After cannot freeze the editor", async (t) => {
  stubFetch(t, [json(429, { error: { message: "x" } }, { "retry-after": "600" }), json(200, REPOS)]);
  const { client, sleeps } = makeClient();
  await client.listRepositories();
  assert.deepEqual(sleeps, [RATE_LIMIT_MAX_WAIT_MS]);
});

test("it gives up after the retry limit and surfaces the 429", async (t) => {
  const calls = stubFetch(t, [json(429, { error: { code: "too_many_requests", message: "slow down", details: {} } }, { "retry-after": "1" })]);
  const { client } = makeClient();
  await assert.rejects(client.listRepositories(), (e) => e instanceof CodePulseApiError && e.status === 429 && /slow down/.test(e.message));
  assert.equal(calls.length, RATE_LIMIT_MAX_RETRIES + 1);
});

test("errors other than 429 are not retried", async (t) => {
  const calls = stubFetch(t, [json(403, { error: { code: "forbidden", message: "no", details: {} } })]);
  const { client } = makeClient();
  await assert.rejects(client.listRepositories(), (e) => e.status === 403);
  assert.equal(calls.length, 1);
});

test("a rate-limited POST is retried too (the server rejects before handling it)", async (t) => {
  const calls = stubFetch(t, [json(429, { error: { message: "x" } }, { "retry-after": "1" }), json(202, { job_id: "job_1", repository_id: 1, status: "queued", url: "/r" })]);
  const { client } = makeClient();
  const job = await client.indexRepository("/r");
  assert.equal(job.job_id, "job_1");
  assert.deepEqual(calls.map((c) => c.method), ["POST", "POST"]);
});
