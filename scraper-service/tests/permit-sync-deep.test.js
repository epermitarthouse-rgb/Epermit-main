"use strict";

/**
 * DC deep mode units: per-mode guard (D-057), deep transport (injected login, dashboard reopen, context.request
 * guard), credential lock (D-061), deepOptions helpers, change-gate policy (D-059), pipeline driver (D-063),
 * worker-entry deep wiring, and the completed-workflow Reviews fallback (D-066).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const safety = require("../permit-sync/core/safety");
const errors = require("../permit-sync/core/errors");
const live = require("../permit-sync/adapters/dc-projectdox/live-transport");
const lock = require("../lib/dc-credential-lock");
const deepOpts = require("../lib/dc-deep-options");
const policy = require("../permit-sync/deep/policy");
const { createPipelineDriver } = require("../permit-sync/deep/pipeline");
const { createDcAdapter } = require("../permit-sync/adapters/dc-projectdox/adapter");
const { createDcFixtureTransport } = require("./helpers/dc-fixture-transport");

const WEBAPI = "https://washington-dc-us-projectdoxwebapi.avolvecloud.com";
const WEBUI = "https://washington-dc-us-projectdoxwebui.avolvecloud.com";
const SSRS_EXPORT = "https://session.planreview.dob.dc.gov/Reports/ReportViewer.aspx?OpType=Export&FileName=x&Format=PDF";

// ---- D-057 per-mode guard ----------------------------------------------------------------------

test("json mode is unchanged: file bodies, viewer and report exports are refused", () => {
  const g = safety.createRunGuard();
  assert.equal(g.mode, "json");
  for (const url of [`${WEBAPI}/File/viewFile?fileID=1`, SSRS_EXPORT, `${WEBAPI}/x?rs:Format=PDF`]) {
    assert.equal(g.checkRequest("GET", url).allowed, false, url);
  }
  assert.equal(g.checkRequest("GET", `${WEBUI}/WebForms/Frame.aspx`).allowed, false, "webui host is not open in json mode");
  assert.equal(safety.modePolicy("json").deny.length, 28);
});

test("deep mode lifts only the three read deny patterns and opens the file viewer host; mutations stay refused", () => {
  const g = safety.createRunGuard({ mode: "deep" });
  assert.equal(safety.modePolicy("deep").deny.length, safety.modePolicy("json").deny.length - 3);
  assert.equal(g.checkRequest("GET", SSRS_EXPORT).allowed, true);
  assert.equal(g.checkRequest("GET", `${WEBUI}/WebForms/Frame.aspx?tab=filesTab`).allowed, true);
  for (const url of [
    "https://session.planreview.dob.dc.gov/Workflow/AcceptTask?taskId=1",
    "https://session.planreview.dob.dc.gov/Task/ProcessTask?id=1",
    `${WEBAPI}/File/ToggleViewed?fileID=1`,
    `${WEBAPI}/File/Upload`,
    "https://session.planreview.dob.dc.gov/Project/ApprovedPlans",
    "https://session.planreview.dob.dc.gov/Project/Resubmit",
    "https://session.planreview.dob.dc.gov/WebForms/SessionEnded.aspx",
  ]) assert.equal(g.checkRequest("GET", url).allowed, false, url);
  assert.equal(g.checkRequest("POST", SSRS_EXPORT).allowed, false, "non-GET stays refused");
  assert.equal(g.checkRequest("GET", "https://example.com/file.pdf").allowed, false, "unknown hosts stay closed");
  assert.throws(() => safety.createRunGuard({ mode: "write" }), /unknown guard mode/);
});

// ---- deep transport --------------------------------------------------------------------------

/** Network-free Playwright stand-in with closable pages and a context.request API. */
function fakeDeepBrowser({ dashboardText = "My Projects 1 - 10 of 28 records" } = {}) {
  let handler = null;
  const pages = [];
  const apiCalls = [];
  async function navigate(page, url) {
    let action = null;
    await handler({
      request: () => ({ method: () => "GET", url: () => url, resourceType: () => "document" }),
      continue: async () => { action = "continue"; },
      abort: async () => { action = "abort"; },
    });
    page.current = action === "abort" ? "chrome-error://chromewebdata/" : url;
  }
  const newPage = async () => {
    let closed = false;
    const page = {
      current: "about:blank",
      url() { return this.current; },
      async goto(url) { await navigate(page, url); },
      async waitForLoadState() {},
      async waitForTimeout() {},
      async evaluate() { return page.current.startsWith("https://planreview.dob.dc.gov") ? dashboardText : ""; },
      locator: () => ({ first() { return this; }, count: async () => 0, isVisible: async () => false }),
      isClosed: () => closed,
      async close() { closed = true; },
    };
    pages.push(page);
    return page;
  };
  const request = { get: async (url) => { apiCalls.push(url); return { ok: () => true }; } };
  const context = { route: async (_p, h) => { handler = h; }, newPage, waitForEvent: () => new Promise(() => {}), request };
  return { launchContext: async () => ({ context, close: async () => {} }), pages, apiCalls, navigate };
}

const A3 = { PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3" };

test("deep transport: the injected performLogin logs in once; the dashboard is reopened after the manual sweep closes it", async () => {
  const b = fakeDeepBrowser();
  const trace = [];
  let logins = 0;
  const t = await live.createDcLiveTransport({
    launchContext: b.launchContext, username: "u", password: "p", env: A3, minIntervalMs: 0, mode: "deep", log: (e) => trace.push(e),
    login: async (page) => { logins += 1; await page.goto("https://planreview.dob.dc.gov/Dashboard"); },
  });
  assert.equal(logins, 1);
  assert.equal(t.mode, "deep");
  assert.equal(t.guard.mode, "deep");
  assert.ok(trace.some((e) => e.code === "login_ok"));
  const first = await t.dashboardPage();
  assert.equal(t.ownsPage(first), true);
  await first.close();
  const reopened = await t.dashboardPage();
  assert.notEqual(reopened, first);
  assert.equal(reopened.url(), "https://planreview.dob.dc.gov/");
  assert.ok(trace.some((e) => e.code === "dashboard_reopened"));
  assert.equal(logins, 1, "reopening never logs in again");
});

test("deep transport: a performLogin that does not reach the dashboard is a refused login, never retried", async () => {
  const b = fakeDeepBrowser({ dashboardText: "" });
  let logins = 0;
  await assert.rejects(
    live.createDcLiveTransport({
      launchContext: b.launchContext, username: "u", password: "p", env: A3, minIntervalMs: 0, mode: "deep",
      login: async (page) => { logins += 1; await page.goto("https://dcra.okta.com/signin"); throw new Error("Login failed at https://dcra.okta.com/signin?token=secret"); },
    }),
    (e) => e instanceof errors.AuthError && !/secret/.test(e.message),
  );
  assert.equal(logins, 1);
});

test("deep transport: context.request calls pass the guard; a refused call fails the job even if the caller swallows it", async () => {
  const b = fakeDeepBrowser();
  const t = await live.createDcLiveTransport({
    launchContext: b.launchContext, username: "u", password: "p", env: A3, minIntervalMs: 0, mode: "deep",
    login: async (page) => page.goto("https://planreview.dob.dc.gov/Dashboard"),
  });
  await t.context.request.get(`${WEBAPI}/File/RetrieveFile?fileID=700101`);
  assert.equal(b.apiCalls.length, 1);
  await t.context.request.get("https://session.planreview.dob.dc.gov/Workflow/AcceptTask?taskId=1").catch(() => {});
  assert.equal(b.apiCalls.length, 1, "the refused request is never sent");
  assert.throws(() => t.assertHealthy(), (e) => e instanceof errors.SafetyViolationError);
});

test("deep transport: a guard in another mode is refused", async () => {
  const b = fakeDeepBrowser();
  await assert.rejects(
    live.createDcLiveTransport({ launchContext: b.launchContext, username: "u", password: "p", env: A3, mode: "deep", guard: safety.createRunGuard() }),
    (e) => e instanceof errors.SafetyViolationError,
  );
});

// ---- D-061 credential lock ------------------------------------------------------------------

/** supabase-js-like chain over in-memory tables: select/eq/in/gt/limit. */
function memorySupabase(tables, { failOn = null } = {}) {
  return {
    from(table) {
      const filters = [];
      let lim = Infinity;
      const chain = {
        select: () => chain,
        eq: (c, v) => { filters.push((r) => r[c] === v); return chain; },
        in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return chain; },
        gt: (c, v) => { filters.push((r) => String(r[c]) > String(v)); return chain; },
        limit: (n) => { lim = n; return chain; },
        then: (resolve) => resolve(table === failOn
          ? { data: null, error: { message: "boom" } }
          : { data: (tables[table] || []).filter((r) => filters.every((f) => f(r))).slice(0, lim), error: null }),
      };
      return chain;
    },
  };
}

test("credential lock: DC logins with the same username, live leases only, worker rows ignored", async () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const iso = (ms) => new Date(now.getTime() + ms).toISOString();
  const tables = {
    portal_credentials: [
      { id: "c1", jurisdiction: "Washington DC - ProjectDox", portal_username: "acct" },
      { id: "c2", jurisdiction: "Washington DC", portal_username: "acct" },
      { id: "c3", jurisdiction: "Arlington County", portal_username: "acct" },
    ],
    permit_sync_jobs: [{ id: "j1", credential_id: "c1", status: "running", lease_expires_at: iso(-1000) }],
    scrape_jobs: [],
  };
  const sb = memorySupabase(tables);
  assert.deepEqual(await lock.sameLoginCredentialIds(sb, "acct"), ["c1", "c2"]);
  assert.equal(await lock.automatedDcSyncActive(sb, { username: "acct", now }), false, "expired lease does not block");
  tables.permit_sync_jobs[0].lease_expires_at = iso(60000);
  assert.equal(await lock.automatedDcSyncActive(sb, { username: "acct", now }), true);
  assert.equal(await lock.automatedDcSyncActive(sb, { username: "other", now }), false);
  assert.equal(await lock.automatedDcSyncActive(memorySupabase(tables, { failOn: "permit_sync_jobs" }), { username: "acct", now }), false, "lookup error does not block the manual scraper");

  const fresh = iso(-60000);
  const stale = iso(-11 * 60000);
  tables.scrape_jobs = [
    { id: "s1", jurisdiction: "Washington DC", status: "running", last_heartbeat_at: stale, credential_id: null, scraper_session_id: "abc", metadata: { portal_subtype: "dc-planreview" } },
    { id: "s2", jurisdiction: "Washington DC", status: "running", last_heartbeat_at: fresh, credential_id: null, scraper_session_id: "permit-sync:job:1", metadata: { portal_subtype: "dc-planreview" } },
  ];
  assert.equal(await lock.manualDcScrapeActive(sb, { credentialIds: ["c1"], now }), false, "stale rows and the worker's own rows do not block");
  tables.scrape_jobs.push({ id: "s3", jurisdiction: "Washington DC", status: "queued", last_heartbeat_at: fresh, credential_id: null, scraper_session_id: "x", metadata: { portal_subtype: "dc-planreview" } });
  assert.equal(await lock.manualDcScrapeActive(sb, { credentialIds: ["c1"], now }), true, "a manual DC session records no credential id: it blocks");
  tables.scrape_jobs[2].credential_id = "c9";
  assert.equal(await lock.manualDcScrapeActive(sb, { credentialIds: ["c1"], now }), false, "another credential does not block");
  await assert.rejects(lock.manualDcScrapeActive(memorySupabase(tables, { failOn: "scrape_jobs" }), { credentialIds: ["c1"], now }), /scrape_jobs/);
  assert.equal(lock.isDcPortalUrl("https://washington-dc-us.avolvecloud.com"), true);
  assert.equal(lock.isDcPortalUrl("https://aca-prod.accela.com/ARLINGTONCO"), false);
});

// ---- deepOptions helpers and the change gate --------------------------------------------------

test("deepOptions: no gate means manual behaviour; gated entries keep the manual file shape", () => {
  assert.equal(deepOpts.fileGateDecision(null, { id: "1" }), null);
  assert.equal(deepOpts.storesPrivately(null), false);
  assert.equal(deepOpts.isProtectedPage(null, {}), false);
  const now = Date.parse("2026-11-12T12:00:00Z");
  const later = "2026-11-12T13:00:00Z";
  const docs = [
    { portal_file_id: "1", download_permitted: true, download_status: "stored", storage_path: "p/files/1_a.pdf", sha256: "a".repeat(64) },
    { portal_file_id: "2", download_permitted: true, download_status: "not_requested" },
    { portal_file_id: "3", download_permitted: false, download_status: "not_permitted" },
    { portal_file_id: "4", download_permitted: true, download_status: "failed", capture_attempts: 1, capture_next_attempt_at: later },
    { portal_file_id: "5", download_permitted: true, download_status: "failed", capture_attempts: 5, capture_next_attempt_at: null },
    { portal_file_id: "6", download_permitted: null, download_status: "not_requested" },
    { portal_file_id: "7", download_permitted: true, download_status: "failed", capture_attempts: 2, capture_next_attempt_at: "2026-11-12T11:00:00Z" },
  ];
  const deep = { fileGate: policy.buildFileGate(docs, { now }) };
  const d = (id) => deepOpts.fileGateDecision(deep, { id, name: "a.pdf" });
  assert.deepEqual(["1", "2", "3", "4", "5", "6", "7", "9"].map((id) => d(id).download), [false, true, true, false, false, false, true, false]);
  assert.deepEqual(["1", "3", "4", "5", "6", "7", "9"].map((id) => d(id).reason), ["already_stored", "pending", "retry_backoff", "retry_exhausted", "not_permitted", "retry", "not_in_repository"]);
  assert.equal(deepOpts.fileGateDecision({ fileGate: policy.buildFileGate(docs, { now, filesChanged: true }) }, { id: "4" }).download, true, "a files change skips the back-off");
  assert.equal(deepOpts.fileGateDecision({ fileGate: policy.buildFileGate(docs, { now, filesChanged: true }) }, { id: "5" }).download, false, "but never the attempt cap");
  const entry = deepOpts.gatedFileEntry({ id: "1", name: "a.pdf", status: "Approved" }, "Approved Drawings", d("1"));
  assert.deepEqual(entry.storageRef, { bucket: "permit-documents", path: "p/files/1_a.pdf", sha256: "a".repeat(64) });
  assert.equal(entry.downloadStatus, "stored");
  assert.equal(entry.viewUrl, "");
  assert.equal(deepOpts.gatedFileEntry({ id: "3", name: "b" }, "F", d("3")).downloadStatus, "not_downloaded");
});

test("change gate: first pass, unchanged permit, file and report triggers, linked project staleness", () => {
  const hashes = { status: "s1", reviews: "r1", tasks: "t1", workflows: "w1", files: "f1", reports: "p1", info: "i1" };
  const captured = [{ content_status: "captured" }];
  const stored = [{ download_permitted: true, download_status: "stored" }];

  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes, documents: stored, reports: captured }).run, false, "unchanged: no deep pass");
  const firstNoWork = policy.planDeepPass({ previousHashes: null, hashes, documents: [], reports: [] });
  assert.equal(firstNoWork.run, false, "nothing to fetch and no linked project");

  const pending = policy.planDeepPass({ previousHashes: hashes, hashes, documents: [{ download_permitted: true, download_status: "not_requested" }], reports: captured });
  assert.deepEqual(pending.tabs, ["files"]);
  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes, documents: [{ download_permitted: false, download_status: "not_permitted" }], reports: captured }).tabs, ["files"], "view-only files are fetched through the viewer (D-082)");
  assert.equal(policy.planDeepPass({ previousHashes: hashes, hashes, documents: [{ download_permitted: null, download_status: "not_requested" }], reports: captured }).run, false, "unknown permission: never fetched");
  const now = Date.parse("2026-11-12T12:00:00Z");
  const backoff = [{ download_permitted: true, download_status: "failed", capture_attempts: 1, capture_next_attempt_at: "2026-11-12T13:00:00Z" }];
  assert.equal(policy.planDeepPass({ previousHashes: hashes, hashes, documents: backoff, reports: captured, now }).run, false, "a failed file waits out its back-off");
  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes, documents: backoff, reports: captured, now: now + 2 * 3600e3 }).tabs, ["files"], "then it is retried on a later run");
  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes: { ...hashes, files: "f2" }, documents: backoff, reports: captured, now }).tabs, ["files"], "a files change retries at once");
  assert.equal(policy.planDeepPass({ previousHashes: hashes, hashes: { ...hashes, files: "f2" }, documents: [{ ...backoff[0], capture_attempts: 5 }], reports: captured, now }).run, false, "never past the attempt cap");
  const big = policy.planDeepPass({ previousHashes: hashes, hashes, documents: [{ download_permitted: true, download_status: "not_requested", size_bytes: 300 * 1024 * 1024 }], reports: captured });
  assert.equal(big.run, false, "an oversize file never forces a pass");
  assert.equal(big.deferDocuments.length, 1, "it is recorded deferred_oversize instead");
  const deferred = [{ download_permitted: true, download_status: "deferred_oversize", size_bytes: 300 * 1024 * 1024 }];
  assert.equal(policy.planDeepPass({ previousHashes: hashes, hashes, documents: deferred, reports: captured }).run, false);
  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes, documents: deferred, reports: captured, limits: { maxFileBytes: 400 * 1024 * 1024 } }).tabs, ["files"], "fetched once the per-file limit allows it");
  const failedReport = [{ content_status: "failed", content_attempts: 1, content_next_attempt_at: "2026-11-12T13:00:00Z" }];
  assert.equal(policy.planDeepPass({ previousHashes: hashes, hashes, documents: stored, reports: failedReport, now }).run, false, "a failed report waits out its back-off");
  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes, documents: stored, reports: failedReport, now: now + 2 * 3600e3 }).tabs, ["reports"]);
  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes, documents: stored, reports: [{ content_status: "failed" }] }).tabs, ["reports"], "a failure recorded before attempts existed is due");
  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes, links: [{ syncedHashes: hashes, captureHash: "old" }], documents: stored, reports: captured, captureHash: "new" }).tabs, ["files"], "a linked project missing newly stored files is refreshed (D-085)");

  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes, documents: stored, reports: [{ content_status: "not_captured" }] }).tabs, ["reports"]);
  assert.deepEqual(policy.planDeepPass({ previousHashes: hashes, hashes: { ...hashes, reviews: "r2" }, documents: stored, reports: captured }).tabs, ["reports"], "reviews changed: re-export");
  assert.equal(policy.planDeepPass({ previousHashes: hashes, hashes: { ...hashes, info: "i2" }, documents: stored, reports: captured }).run, false, "info change alone exports nothing");

  const linked = policy.planDeepPass({ previousHashes: hashes, hashes, links: [{ syncedHashes: null }], documents: stored, reports: captured });
  assert.deepEqual(linked.tabs, ["status", "files", "tasks", "info", "reports"]);
  assert.equal(policy.planDeepPass({ previousHashes: hashes, hashes, links: [{ syncedHashes: hashes }], documents: stored, reports: captured }).run, false);
  assert.deepEqual(policy.sectionHashes({ sections: { status: { hash: "x", status: "ok" }, reviews: { hash: null, status: "failed" } } }), { status: "x", reviews: "status:failed" });
});

test("private paths follow D-058 and report content is versioned by text and rows", () => {
  const pid = "11111111-1111-4111-8111-111111111111";
  assert.equal(policy.documentPath(pid, "700101", "A 101 (rev).pdf"), `${pid}/files/700101_A_101_rev_.pdf`);
  assert.equal(policy.documentPath(pid, "1", "../../etc/passwd"), `${pid}/files/1_etc_passwd`);
  assert.equal(policy.reportPath(pid, "123", "a".repeat(64), "excel"), `${pid}/reports/123/${"a".repeat(64)}.xlsx`);
  assert.throws(() => policy.reportPath(pid, "123", "nothex", "pdf"));
  // 6b: the manual scraper's entry field is structuredRows (register-execution-routes pdfEntry.structuredRows).
  const a = policy.reportContent({ text: "t", structuredRows: [{ n: 1 }] }, { pdf: { path: "p", sha256: "b".repeat(64), size: 3 } });
  assert.equal(a.pdf_path, "p");
  assert.deepEqual(a.structured_rows, [{ n: 1 }], "structured rows are recorded");
  assert.notEqual(a.sha256, policy.reportContent({ text: "t" }).sha256, "rows are part of the version");
  assert.equal(a.sha256, policy.reportContent({ text: "t", structuredRows: [{ n: 1 }] }).sha256, "binary bytes do not change the version");
  assert.notEqual(a.sha256, policy.reportContent({ text: "t2" }).sha256);
  assert.equal(policy.matchReport([{ name: "Review  Comments", report_key: "1" }], "review comments").report_key, "1");
  assert.equal(policy.reportCaptured({ text: "", error: "No content extracted" }), false);
});

test("manual scraper console output is dropped during the deep pass; errors are redacted; console is restored", async () => {
  const { withQuietConsole } = require("../permit-sync/deep/runner");
  const seen = [];
  const saved = { log: console.log, error: console.error };
  console.log = (...a) => seen.push(["log", a.join(" ")]);
  console.error = (...a) => seen.push(["error", a.join(" ")]);
  try {
    const out = await withQuietConsole(async () => {
      console.log("Cell Phone 202-555-0100");
      console.warn("Landed on https://dcra.okta.com/x?code=abc");
      console.error("failed for someone@example.com");
      return 7;
    });
    assert.equal(out, 7);
    await assert.rejects(withQuietConsole(async () => { throw new Error("x"); }));
    console.log("after");
  } finally {
    Object.assign(console, saved);
  }
  assert.equal(seen.length, 2);
  assert.equal(seen[0][0], "error");
  assert.doesNotMatch(seen[0][1], /someone@example\.com/);
  assert.deepEqual(seen[1], ["log", "after"]);
});

// ---- D-063 pipeline driver ---------------------------------------------------------------------

function noRuns() {
  return memorySupabase({ project_pipeline_runs: [] });
}

test("pipeline driver: service headers, browser-equivalent loop, retry and unknown actions stop", async () => {
  const replies = [
    { next_action: "poll_again", pipeline_run_id: "r", comment_parser: { error: "timeout" } },
    { next_action: "continue_enrichment", pipeline_run_id: "r", comment_parser: { next_cursor: { pdfIndex: 2 }, done: false } },
    { next_action: "complete" },
  ];
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify(replies[calls.length - 1]) };
  };
  const d = createPipelineDriver({ fetch, supabaseUrl: "https://x.invalid/", serviceRoleKey: "k", serviceSecret: "s", supabase: noRuns(), sleep: async () => {} });
  const out = await d.trigger({ projectId: "p", ownerUserId: "u", portalDataHash: "h" });
  assert.deepEqual(out, { outcome: "complete", rounds: 3, pipelineRunId: "r" });
  assert.equal(calls[0].url, "https://x.invalid/functions/v1/intake-pipeline-agent");
  assert.equal(calls[0].init.headers["x-permitpilot-acting-user"], "u");
  assert.equal(calls[0].body.full_refresh, true);
  assert.equal(calls[1].body.cursor, undefined, "a parser timeout restarts without a cursor, as in the browser");
  assert.equal(calls[1].body.full_refresh, undefined, "pipeline_run_id known: no full refresh");
  assert.deepEqual(calls[2].body.cursor, { pdfIndex: 2 });

  const retry = createPipelineDriver({ fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ next_action: "retry_parser" }) }), supabaseUrl: "u", serviceRoleKey: "k", serviceSecret: "s", supabase: noRuns(), sleep: async () => {} });
  assert.equal((await retry.trigger({ projectId: "p", ownerUserId: "u", portalDataHash: "h" })).outcome, "failed");
  const refused = createPipelineDriver({ fetch: async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: "service execution refused" }) }), supabaseUrl: "u", serviceRoleKey: "k", serviceSecret: "s", supabase: noRuns(), sleep: async () => {} });
  await assert.rejects(refused.trigger({ projectId: "p", ownerUserId: "u", portalDataHash: "h" }), /service execution refused/);
  let called = false;
  const off = createPipelineDriver({ fetch: async () => { called = true; }, supabaseUrl: "u", serviceRoleKey: "k", serviceSecret: "", supabase: noRuns() });
  assert.equal((await off.trigger({ projectId: "p", ownerUserId: "u", portalDataHash: "h" })).outcome, "disabled");
  assert.equal(called, false);
});

// ---- worker-entry deep wiring -------------------------------------------------------------------

test("worker entry: deep mode defers while a manual scrape holds the login, then opens the deep transport with performLogin", async () => {
  const crypto = require("node:crypto");
  const prev = process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY;
  process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  try {
    const { encryptPortalPassword } = require("../app/services/portal-credentials/portal-credentials-crypto");
    const entry = require("../permit-sync/worker-entry");
    const rows = {
      portal_credentials: { c1: { portal_username: "acct", portal_password: encryptPortalPassword("s3cret") } },
      permit_sync_sources: { c1: { settings: { account_download: true } } },
    };
    const supabase = { from: (t) => ({ select: () => ({ eq: (_c, id) => ({ single: async () => ({ data: rows[t][id] || null, error: null }) }) }) }) };
    const created = [];
    const createTransport = async (o) => { created.push(o); return { close: async () => {}, listDashboardPage: async () => ({ rows: [], totalRecords: 0 }) }; };
    const env = { PERMIT_SYNC_MODE: "deep" };
    const performLogins = [];
    const dcDeep = { DEFAULT_DASHBOARD_URL: "https://washington-dc-us.avolvecloud.com", performLogin: async (...a) => performLogins.push(a) };

    let busy = true;
    const lockFn = async () => { if (busy) throw new errors.TransientError("a manual DC scrape is using this portal login; deferred"); };
    const open = entry.buildOpenAdapter({ supabase, env, launchContext: async () => ({}), createTransport, lock: lockFn, loadDcDeep: () => dcDeep, createDeepPass: () => ({ afterPermit: async () => ({}), wrapTransport: (t) => t }) });
    await assert.rejects(open({ adapter_key: "dc-projectdox", credential_id: "c1" }), (e) => e instanceof errors.TransientError && errors.classify(e).retryable);
    assert.equal(created.length, 0, "no browser while deferred");

    busy = false;
    const s = await open({ adapter_key: "dc-projectdox", credential_id: "c1" });
    assert.equal(typeof s.afterPermit, "function");
    assert.equal(created.length, 1);
    assert.equal(created[0].mode, "deep");
    await created[0].login("PAGE");
    assert.deepEqual(performLogins, [["PAGE", "acct", "s3cret", "https://washington-dc-us.avolvecloud.com"]]);

    const jsonOpen = entry.buildOpenAdapter({ supabase, env: {}, launchContext: async () => ({}), createTransport, lock: async () => {} });
    const j = await jsonOpen({ adapter_key: "dc-projectdox", credential_id: "c1" });
    assert.equal(j.afterPermit, undefined, "json mode has no deep pass");
    assert.equal(created[1].mode, undefined);
    assert.equal(created[1].login, undefined, "json mode keeps the transport's own login");

    const full = { PERMIT_SYNC_WORKER_ENABLED: "true", PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3", SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k", PORTAL_CREDENTIALS_ENCRYPTION_KEY: "x" };
    assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_MODE: "deep" }).ok, true);
    assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_MODE: "write" }).ok, false);
  } finally {
    if (prev === undefined) delete process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = prev;
  }
});

// ---- D-066 Reviews for completed workflows ----------------------------------------------------

test("Reviews: an empty corrections JSON for a completed workflow falls back to the Review Comments report", async () => {
  const fx = require("./helpers/permit-repo-fixtures");
  const rows = JSON.parse(JSON.stringify(fx.corrections.rows));
  const t = createDcFixtureTransport({ mutate: (route, pid, data) => (route === "review_comments_report" && pid === "11105" ? rows : data) });
  const adapter = createDcAdapter({ transport: t, accountDownload: false });
  const { records } = await adapter.discover();
  const approved = records.find((r) => r.portal_record_id === "11105");
  const { sections } = await adapter.fetchPermit(approved);
  assert.equal(sections.reviews.sourceKind, "report");
  assert.equal(sections.reviews.status, "ok");
  assert.equal(sections.reviews.tables.permit_review_comments.length, rows.length);
  assert.match(sections.reviews.error, /json_empty_inactive_workflow/);

  const failing = createDcFixtureTransport({ fail: { review_comments_report: new Set(["11105"]) } });
  const s2 = (await createDcAdapter({ transport: failing, accountDownload: false }).fetchPermit(approved)).sections;
  assert.equal(s2.reviews.status, "partial", "an unreadable report never confirms an empty Reviews section");
  assert.equal(s2.reviews.tables.permit_review_comments.length, 0);

  const active = records.find((r) => r.portal_record_id === "11854");
  const before = t.requests.filter((q) => q.route === "review_comments_report").length;
  await adapter.fetchPermit(active);
  assert.equal(t.requests.filter((q) => q.route === "review_comments_report").length, before, "active workflows keep the JSON read only");
});

// ---- D-074 / D-075 caps, one-permit scope, service key format -----------------------------------

test("download limits: small env defaults, env override, job options can only lower the cap", () => {
  const policy = require("../permit-sync/deep/policy");
  assert.deepEqual(policy.downloadLimits({}), { maxFiles: 10, maxBytes: 50 * 1024 * 1024 });
  assert.deepEqual(policy.downloadLimits({ PERMIT_SYNC_DEEP_MAX_FILES: "3", PERMIT_SYNC_DEEP_MAX_BYTES: "1000" }), { maxFiles: 3, maxBytes: 1000 });
  assert.deepEqual(policy.downloadLimits({ PERMIT_SYNC_DEEP_MAX_FILES: "3" }, { max_files: 100, max_bytes: 10 }), { maxFiles: 3, maxBytes: 10 });
  assert.deepEqual(policy.downloadLimits({ PERMIT_SYNC_DEEP_MAX_FILES: "junk" }), { maxFiles: 10, maxBytes: 50 * 1024 * 1024 }, "invalid env falls back to the default");

  const b = policy.createDownloadBudget({ maxFiles: 2, maxBytes: 100 });
  assert.equal(b.take("a", 60), null);
  assert.equal(b.take("b", 60), "cap_bytes", "a known size over the byte budget is refused before download");
  assert.equal(b.take("c", 0), null, "unknown size is admitted while bytes remain");
  b.settle("c", 30);
  assert.equal(b.bytes, 90);
  assert.equal(b.take("d", 1), "cap_files");

  const docs = [
    { portal_file_id: "1", download_permitted: true, download_status: "not_requested", size_bytes: 500 },
    { portal_file_id: "2", download_permitted: true, download_status: "not_requested", size_bytes: 10 },
    { portal_file_id: "3", download_permitted: true, download_status: "not_requested", size_bytes: 2000 },
  ];
  const gate = policy.buildFileGate(docs, { budget: policy.createDownloadBudget({ maxFiles: 5, maxBytes: 100 }), limits: { maxFileBytes: 1000 } });
  assert.equal(gate("1").download, true, "D-083: one file larger than the job's byte budget may be its first download");
  assert.equal(gate("2").reason, "cap_bytes", "the budget is then spent; the next file waits for a later job");
  assert.equal(gate("3").reason, "deferred_oversize", "over the per-file limit: deferred, never downloaded");
  assert.equal(policy.createDownloadBudget({ maxFiles: 5, maxBytes: 0 }).take("x", 1), "cap_bytes", "max_bytes 0 still means no downloads");

  assert.deepEqual(policy.captureLimits({}), { maxFileBytes: 200 * 1024 * 1024, maxAttempts: 5 });
  assert.deepEqual(policy.captureLimits({ PERMIT_SYNC_DEEP_MAX_FILE_BYTES: "1000", PERMIT_SYNC_DEEP_MAX_ATTEMPTS: "2" }, { max_file_bytes: 5000 }), { maxFileBytes: 1000, maxAttempts: 2 }, "a job option never raises the env limit");
  assert.deepEqual(policy.captureLimits({}, { max_file_bytes: 1048576 }).maxFileBytes, 1048576);
});

test("3f: file content checks, provenance and size comparison", () => {
  const policy = require("../permit-sync/deep/policy");
  const pdf = (n) => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(n - 9, 32)]);
  assert.deepEqual(policy.fileSource("https://w/File/RetrieveFile?convertToPDF=true&inline=true&fileID=1"), { endpoint: "retrieve_file_rendition", isRendition: true });
  assert.deepEqual(policy.fileSource("https://w/File/RetrieveFile?inline=true&fileID=1"), { endpoint: "retrieve_file_original", isRendition: false });
  assert.deepEqual(policy.fileSource(null), { endpoint: "unknown", isRendition: null });
  const v = (buf, o = {}) => policy.validateFileBody({ buf, fileName: "A.pdf", portalSize: 1000, isRendition: false, ...o });
  assert.deepEqual(v(Buffer.alloc(0)), { ok: false, error: "empty_body" });
  assert.deepEqual(v(Buffer.from("<!DOCTYPE html><html>login</html>")), { ok: false, error: "html_instead_of_file" });
  assert.deepEqual(v(Buffer.from("PK\u0003\u0004 not a pdf")), { ok: false, error: "not_a_pdf" });
  assert.deepEqual(v(pdf(900)), { ok: false, error: "truncated: 900 of 1000 bytes" }, "a short original is never stored");
  assert.deepEqual(v(pdf(1000)), { ok: true, sizeMatchesPortal: true, contentType: "application/pdf" });
  assert.deepEqual(v(pdf(980), { isRendition: true }), { ok: true, sizeMatchesPortal: false, contentType: "application/pdf" }, "a rendition is stored, flagged");
  assert.deepEqual(v(pdf(980), { isRendition: null }), { ok: true, sizeMatchesPortal: false, contentType: "application/pdf" }, "unknown source: stored, flagged");
  assert.deepEqual(v(pdf(980), { portalSize: null }), { ok: true, sizeMatchesPortal: null, contentType: "application/pdf" });
});

test("worker entry: one-permit scope env, numeric caps, service key format guard for the agent trigger", () => {
  const entry = require("../permit-sync/worker-entry");
  assert.equal(entry.workerScope({}), null);
  assert.deepEqual(entry.workerScope({ PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS: " 11105, 9187 " }), ["11105", "9187"]);
  const full = { PERMIT_SYNC_WORKER_ENABLED: "true", PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3", SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k", PORTAL_CREDENTIALS_ENCRYPTION_KEY: "x", PERMIT_SYNC_MODE: "deep" };
  assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS: "11105" }).ok, true);
  assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS: "B2407514" }).ok, false, "a permit number is not a ProjectID");
  assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_DEEP_MAX_FILES: "-1" }).ok, false);
  assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_DEEP_MAX_BYTES: "5" }).ok, true);

  const jwt = (claims) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
  assert.equal(entry.serviceKeyFormat(jwt({ role: "service_role" })), "legacy_service_role_jwt");
  assert.equal(entry.serviceKeyFormat(jwt({ role: "anon" })), "unknown");
  assert.equal(entry.serviceKeyFormat("sb_secret_abc"), "sb_secret");
  assert.equal(entry.serviceKeyFormat("eyJbroken"), "unknown");
});
