"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const live = require("../permit-sync/adapters/dc-projectdox/live-transport");
const { createRunGuard, LOGIN_EXTRA_HOSTS } = require("../permit-sync/core/safety");
const errors = require("../permit-sync/core/errors");
const { downloadDecision } = require("../permit-sync/core/downloads");

test("live transport refuses to start without approval A-3 and never launches a browser", async () => {
  let launched = 0;
  const launchContext = async () => { launched += 1; return { context: {}, close: async () => {} }; };
  for (const env of [{}, { PERMIT_SYNC_LIVE_PORTAL_APPROVED: "yes" }, { PERMIT_SYNC_LIVE_PORTAL_APPROVED: "a-3" }]) {
    await assert.rejects(
      live.createDcLiveTransport({ launchContext, username: "u", password: "p", env }),
      (e) => e instanceof errors.SafetyViolationError,
    );
  }
  assert.equal(launched, 0);
});

test("login-phase policy (D-046): follows every redirect like the existing DC scraper; only DC deny patterns abort", () => {
  const ok = [
    { method: "POST", url: "https://dcra.b2clogin.com/tenant/SelfAsserted?tx=1" },
    { method: "POST", url: "https://example.okta.com/idp/idx/identify" },
    { method: "GET", url: "https://planreview.dob.dc.gov/Home/SSOLanding" },
    { method: "GET", url: "https://session.planreview.dob.dc.gov/WebForms/SessionEnded.aspx" },
    { method: "POST", url: "https://planreview.dob.dc.gov/signin-oidc" },
    { method: "GET", url: "https://cdn.example.net/app.js", resourceType: "script" },
    { method: "GET", url: "https://avolvecspiam-as-authmiddleware.azurewebsites.net/Auth2/SsoCallback", resourceType: "document" },
    { method: "GET", url: "https://avolvecspiamsa.blob.core.windows.net/c/config.json", resourceType: "xhr" },
    { method: "GET", url: "https://some-new-identity-host.example/continue", resourceType: "document" },
  ];
  for (const r of ok) assert.equal(live.evaluateAuthRequest(r).allowed, true, r.url);
  const bad = [
    { method: "GET", url: "https://session.planreview.dob.dc.gov/Workflow/AcceptTask?id=1" },
    { method: "GET", url: "https://planreview.dob.dc.gov/Account/LogOut" },
    { method: "POST", url: "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/File/Upload" },
  ];
  for (const r of bad) assert.equal(live.evaluateAuthRequest(r).allowed, false, r.url);
});

test("the read phase drops unknown hosts, and a deny-pattern write still violates", () => {
  const guard = createRunGuard();
  for (const host of ["avolvecspiam-as-authmiddleware.azurewebsites.net", "avolvecspiamsa.blob.core.windows.net", "some-new-identity-host.example"]) {
    for (const method of ["GET", "POST"]) {
      const d = live.routeReadRequest({ method, url: `https://${host}/x`, resourceType: "xhr" }, guard);
      assert.deepEqual([d.action, d.violation], ["abort", false], `${method} ${host}`);
    }
  }
  const benign = live.routeReadRequest({ method: "POST", url: "https://session.planreview.dob.dc.gov/Project/Index", resourceType: "xhr" }, guard);
  assert.equal(benign.action, "abort");
  assert.equal(benign.violation, false);
  assert.equal(live.routeReadRequest({ method: "POST", url: "https://session.planreview.dob.dc.gov/File/Upload", resourceType: "xhr" }, guard).violation, true);
});

test("read-phase routing: portal traffic goes through the guard, off-host traffic is dropped without a violation", () => {
  const guard = createRunGuard();
  const r = (method, url, resourceType = "xhr") => live.routeReadRequest({ method, url, resourceType }, guard);
  assert.equal(r("GET", "https://session.planreview.dob.dc.gov/Project/Index?tab=filesTab&ProjectID=1", "document").action, "continue");
  assert.equal(r("GET", "https://session.planreview.dob.dc.gov/Content/site.css", "stylesheet").action, "continue");
  assert.deepEqual(
    (({ action, violation }) => ({ action, violation }))(r("GET", "https://www.google-analytics.com/collect")),
    { action: "abort", violation: false },
  );
  const dead = r("GET", "https://session.planreview.dob.dc.gov/WebForms/SessionEnded.aspx", "document");
  assert.equal(dead.sessionEnded, true);
  assert.equal(dead.violation, false);
  assert.equal(guard.violations().length, 0);
  const post = r("POST", "https://session.planreview.dob.dc.gov/Project/Index");
  assert.equal(post.action, "abort");
  assert.equal(post.violation, false);
  const accept = r("GET", "https://session.planreview.dob.dc.gov/Workflow/AcceptTask?x=1", "script");
  assert.equal(accept.violation, true);
  const status = r("GET", "https://session.planreview.dob.dc.gov/Project/ProjectStatus?projectID=9187&wflowInstanceID=&timeStamp=1", "xhr");
  assert.equal(status.action, "continue");
  assert.equal(status.violation, false);
  assert.equal(status.rule, "portal_page_read");
  assert.equal(guard.violations().length, 1);
});

test("a viewFile or Download GET on a DC portal host is still refused and fails the job (D-048)", () => {
  const guard = createRunGuard();
  for (const url of [
    "https://session.planreview.dob.dc.gov/File/viewFile?fileID=1",
    "https://session.planreview.dob.dc.gov/Project/Download%20Files?projectID=9187",
  ]) {
    const d = live.routeReadRequest({ method: "GET", url, resourceType: "xhr" }, guard);
    assert.equal(d.action, "abort", url);
    assert.equal(d.violation, true, url);
    assert.equal(d.rule, "deny_pattern", url);
  }
  assert.equal(guard.shouldAbort(), true);
  const outcome = errors.classify(new errors.SafetyViolationError("portal request refused", { rule: "deny_pattern" }));
  assert.equal(outcome.outcome, "failed_unrecoverable");
  assert.equal(outcome.code, "safety_violation");
  assert.equal(outcome.retryable, false);
  const post = live.routeReadRequest(
    { method: "POST", url: "https://session.planreview.dob.dc.gov/Project/ProjectStatus?projectID=9187", resourceType: "xhr" },
    guard,
  );
  assert.equal(post.action, "abort");
  assert.equal(post.violation, false);
  const other = live.routeReadRequest(
    { method: "GET", url: "https://example.com/Project/ProjectStatus?projectID=9187", resourceType: "xhr" },
    guard,
  );
  assert.equal(other.action, "abort");
  assert.equal(other.violation, false);
});

test("a viewFile or Download GET on the ProjectDox API host is still refused and fails the job (D-049)", () => {
  const guard = createRunGuard();
  const api = "https://washington-dc-us-projectdoxwebapi.avolvecloud.com";
  const keepalive = live.routeReadRequest({ method: "GET", url: `${api}/User/GetSessionTimeout`, resourceType: "xhr" }, guard);
  assert.equal(keepalive.action, "continue");
  assert.equal(keepalive.violation, false);
  for (const url of [`${api}/File/viewFile?fileID=1`, `${api}/Project/Download%20Files?projectID=9187`]) {
    const d = live.routeReadRequest({ method: "GET", url, resourceType: "xhr" }, guard);
    assert.equal(d.action, "abort", url);
    assert.equal(d.violation, true, url);
    assert.equal(d.rule, "deny_pattern", url);
  }
  assert.equal(guard.shouldAbort(), true);
  const outcome = errors.classify(new errors.SafetyViolationError("portal request refused", { rule: "deny_pattern" }));
  assert.equal(outcome.outcome, "failed_unrecoverable");
  assert.equal(outcome.retryable, false);
  const post = live.routeReadRequest({ method: "POST", url: `${api}/User/GetSessionTimeout`, resourceType: "xhr" }, guard);
  assert.equal(post.action, "abort");
  assert.equal(post.violation, false);
  const other = live.routeReadRequest(
    { method: "GET", url: "https://washington-dc-us-projectdoxwebui.avolvecloud.com/User/GetSessionTimeout", resourceType: "xhr" },
    guard,
  );
  assert.equal(other.violation, true);
  assert.equal(other.rule, "not_allowlisted");
});

test("POST FileViewer is dropped in deep mode with no violation; GET RetrieveFile stays allowed (D-089)", () => {
  const guard = createRunGuard({ mode: "deep" });
  const post = live.routeReadRequest(
    { method: "POST", url: "https://washington-dc-us-projectdoxwebui.avolvecloud.com/File/FileViewer?fileID=700101", resourceType: "document" },
    guard,
  );
  assert.equal(post.action, "abort");
  assert.equal(post.violation, false);
  assert.equal(post.rule, "method_dropped");
  assert.equal(guard.violations().length, 0);
  assert.equal(guard.shouldAbort(), false);
  const get = live.routeReadRequest(
    { method: "GET", url: "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/File/RetrieveFile?inline=true&fileID=700101", resourceType: "xhr" },
    guard,
  );
  assert.equal(get.action, "continue");
  assert.equal(get.violation, false);
  assert.equal(get.rule, "file_retrieve");
});

test("a non-GET that is not a deny pattern is aborted and the job continues (D-050)", () => {
  const guard = createRunGuard();
  const rum = live.routeReadRequest(
    { method: "POST", url: "https://session.planreview.dob.dc.gov/cdn-cgi/rum", resourceType: "xhr" },
    guard,
  );
  assert.equal(rum.action, "abort");
  assert.equal(rum.violation, false);
  assert.equal(rum.rule, "method_dropped");
  const beacon = live.routeReadRequest(
    { method: "PUT", url: "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/cdn-cgi/rum", resourceType: "xhr" },
    guard,
  );
  assert.equal(beacon.action, "abort");
  assert.equal(beacon.violation, false);
  assert.equal(guard.shouldAbort(), false);
  assert.equal(guard.violations().length, 0);

  const denied = live.routeReadRequest(
    { method: "POST", url: "https://session.planreview.dob.dc.gov/File/Upload", resourceType: "xhr" },
    guard,
  );
  assert.equal(denied.action, "abort");
  assert.equal(denied.violation, true);
  assert.equal(denied.rule, "deny_pattern");
  assert.equal(guard.shouldAbort(), true);
  const outcome = errors.classify(new errors.SafetyViolationError("portal request refused", { rule: "deny_pattern" }));
  assert.equal(outcome.outcome, "failed_unrecoverable");
  assert.equal(outcome.retryable, false);

  const keepalive = live.routeReadRequest(
    { method: "GET", url: "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/User/GetSessionTimeout", resourceType: "xhr" },
    guard,
  );
  assert.equal(keepalive.action, "continue");
  assert.equal(keepalive.violation, false);
  const download = live.routeReadRequest(
    { method: "GET", url: "https://session.planreview.dob.dc.gov/Project/Download%20Files?projectID=9187", resourceType: "xhr" },
    guard,
  );
  assert.equal(download.action, "abort");
  assert.equal(download.violation, true);
  assert.equal(download.rule, "deny_pattern");

  const otherDc = live.routeReadRequest(
    { method: "POST", url: "https://washington-dc-us-projectdoxwebui.avolvecloud.com/cdn-cgi/rum", resourceType: "xhr" },
    guard,
  );
  assert.equal(otherDc.violation, true);
  const offHost = live.routeReadRequest(
    { method: "POST", url: "https://example.com/cdn-cgi/rum", resourceType: "xhr" },
    guard,
  );
  assert.equal(offHost.action, "abort");
  assert.equal(offHost.violation, false);
});

test("login page classification detects MFA, CAPTCHA and refused credentials", () => {
  const c = (url, text, hasPasswordField = false) => live.classifyLoginPage({ url, text, hasPasswordField });
  assert.equal(c("https://x.okta.com/signin", "Enter the verification code sent to your phone"), "mfa");
  assert.equal(c("https://x.okta.com/signin", "Get a push notification — Okta Verify"), "mfa");
  assert.equal(c("https://x.b2clogin.com/a", "Please complete the CAPTCHA"), "captcha");
  assert.equal(c("https://x.b2clogin.com/a", "Your password is incorrect. Invalid password", true), "bad_credentials");
  assert.equal(c("https://x.b2clogin.com/a", "Your account is locked"), "locked");
  assert.equal(c("https://x.b2clogin.com/a", "Sign in", true), "login_form");
  assert.equal(c("https://session.planreview.dob.dc.gov/WebForms/SessionEnded.aspx", "Your session has ended"), "session_dead");
  assert.equal(c("https://planreview.dob.dc.gov/Home/SSOLanding", "Continue"), "unknown");
  assert.equal(c("https://planreview.dob.dc.gov/", "My Projects 1 - 10 of 28 records"), "authenticated");
});

test("HTTP status mapping follows the retry taxonomy", () => {
  assert.equal(live.errorForStatus(200), null);
  assert.ok(live.errorForStatus(401) instanceof errors.SessionEndedError);
  assert.ok(live.errorForStatus(403) instanceof errors.SessionEndedError);
  assert.ok(live.errorForStatus(302, {}, "https://session.planreview.dob.dc.gov/WebForms/SessionEnded.aspx") instanceof errors.SessionEndedError);
  assert.ok(live.errorForStatus(302, {}, "https://elsewhere/") instanceof errors.PortalChangedError);
  const rl = live.errorForStatus(429, { "retry-after": "120" });
  assert.ok(rl instanceof errors.RateLimitedError);
  assert.equal(errors.classify(rl).retryAfterSeconds, 120);
  assert.equal(errors.classify(live.errorForStatus(429)).retryAfterSeconds, 3600);
  assert.ok(live.errorForStatus(503) instanceof errors.TransientError);
  assert.ok(live.errorForStatus(404) instanceof errors.PortalChangedError);
});

test("dashboard parsing matches the existing DC dashboard reader", () => {
  assert.equal(live.parseDashboardTotal("Showing 1 - 10 of 28 records"), 28);
  assert.equal(live.parseDashboardTotal("of 1,204 items"), 1204);
  assert.equal(live.parseDashboardTotal("no paging text"), null);
  const rows = live.parseDashboardRows([
    { cells: ["D2500488", "Alteration", "Loc", "ResubmitResubmit", "1"], statusText: "ResubmitResubmit",
      link: { text: "D2500488", href: "javascript:launchRemote('Project/Index?tab=projectStatusTab&ProjectID=11854')" } },
    { cells: ["D2500488", "dup"], link: { text: "D2500488", href: "x" } },
    { cells: ["B2400001", "New", "Loc", "Approved"], link: { text: "B2400001", href: "javascript:void(0)", onclick: "launchRemote('Project/Index?tab=filesTab&ProjectID=11105')" } },
    { cells: ["header"], link: null },
    { cells: ["NOID", "x", "y", ""], link: { text: "NOID", href: "" } },
  ]);
  assert.deepEqual(rows.map(({ dashboard, ...r }) => r), [
    { permit: "D2500488", projectId: "11854", status: "Resubmit" },
    { permit: "B2400001", projectId: "11105", status: "Approved" },
    { permit: "NOID", projectId: null, status: null },
  ]);
  assert.deepEqual(rows[0].dashboard, {
    description: "Alteration", location: "Loc", tasks: "1",
    href: "javascript:launchRemote('Project/Index?tab=projectStatusTab&ProjectID=11854')",
  });
  // discoveryRecord ignores the manual-scraper fields, so JSON-mode permit fields are unchanged.
  const dc = require("../permit-sync/adapters/dc-projectdox/normalize");
  const { dashboard, ...plain } = rows[0];
  assert.deepEqual(dc.discoveryRecord(rows[0]), dc.discoveryRecord(plain));
});

test("throttle spaces portal requests", async () => {
  let t = 0;
  const slept = [];
  const throttle = live.createThrottle(1000, { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  await throttle();
  t += 200;
  await throttle();
  t += 1500;
  await throttle();
  assert.deepEqual(slept, [800]);
});

test("download policy is deny-by-default and always skips DC", () => {
  const on = { PERMIT_SYNC_DOWNLOADS_ENABLED: "true" };
  assert.equal(downloadDecision({ env: on, adapterKey: "dc-projectdox", settings: { download_permitted: true }, accountDownload: true }).reason, "dc_account_download_disabled");
  assert.equal(downloadDecision({ env: {}, adapterKey: "other", settings: { download_permitted: true }, accountDownload: true }).reason, "downloads_flag_off");
  assert.equal(downloadDecision({ env: on, adapterKey: "other", settings: {}, accountDownload: true }).reason, "source_not_permitted");
  assert.equal(downloadDecision({ env: on, adapterKey: "other", settings: { download_permitted: true }, accountDownload: null }).reason, "account_cannot_download");
  for (const d of [
    downloadDecision({ env: on, adapterKey: "other", settings: { download_permitted: true }, accountDownload: true }),
  ]) assert.equal(d.download, false);
});

test("worker entrypoint stays off without both flags and does not load the HTTP app", () => {
  const before = new Set(Object.keys(require.cache));
  const entry = require("../permit-sync/worker-entry");
  const loaded = Object.keys(require.cache).filter((k) => !before.has(k));
  assert.equal(loaded.some((k) => /register-execution-routes|server\.js|http-app/.test(k)), false);
  const full = { PERMIT_SYNC_WORKER_ENABLED: "true", PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3", SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k", PORTAL_CREDENTIALS_ENCRYPTION_KEY: "x" };
  assert.equal(entry.startupCheck(full).ok, true);
  for (const drop of Object.keys(full)) {
    const env = { ...full };
    delete env[drop];
    assert.equal(entry.startupCheck(env).ok, false, drop);
  }
  assert.equal(entry.startupCheck({ ...full, PERMIT_SYNC_WORKER_ENABLED: "1" }).ok, false);
});

test("openAdapter decrypts the stored envelope, refuses plaintext and unknown adapters", async () => {
  const prev = process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY;
  process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  try {
    const { encryptPortalPassword } = require("../app/services/portal-credentials/portal-credentials-crypto");
    const { buildOpenAdapter } = require("../permit-sync/worker-entry");
    const rows = {
      portal_credentials: { c1: { portal_username: "acct", portal_password: encryptPortalPassword("s3cret") }, c2: { portal_username: "acct", portal_password: "plain" } },
      permit_sync_sources: { c1: { settings: { account_download: false } }, c2: { settings: {} } },
    };
    const supabase = {
      from: (t) => ({ select: () => ({ eq: (_c, id) => ({ single: async () => ({ data: rows[t][id] || null, error: rows[t][id] ? null : { message: "none" } }) }) }) }),
    };
    const seen = [];
    const createTransport = async (o) => { seen.push({ username: o.username, password: o.password }); return { close: async () => {} }; };
    const open = buildOpenAdapter({ supabase, launchContext: async () => ({}), createTransport, lock: async () => {} });

    const s = await open({ adapter_key: "dc-projectdox", credential_id: "c1" });
    assert.equal(typeof s.adapter.discover, "function");
    assert.deepEqual(seen, [{ username: "acct", password: "s3cret" }]);
    await assert.rejects(open({ adapter_key: "dc-projectdox", credential_id: "c2" }), (e) => e instanceof errors.AuthError);
    await assert.rejects(open({ adapter_key: "dc-projectdox", credential_id: "missing" }), (e) => e instanceof errors.AuthError);
    await assert.rejects(open({ adapter_key: "other", credential_id: "c1" }), (e) => e instanceof errors.PortalChangedError);
    assert.equal(seen.length, 1);

    // Envelope written under another key: refused before any transport (browser) is created, not retried.
    process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    let err;
    await open({ adapter_key: "dc-projectdox", credential_id: "c1" }).catch((e) => { err = e; });
    assert.ok(err instanceof errors.AuthError);
    assert.doesNotMatch(err.message, /s3cret|acct/);
    assert.equal(errors.classify(err).retryable, false);
    assert.equal(seen.length, 1);
  } finally {
    if (prev === undefined) delete process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = prev;
  }
});

test("guard violations name the refused method and path with query values masked", () => {
  const callback = { method: "post", url: "https://planreview.dob.dc.gov/Workflow/AcceptTask?code=abc123&state=xyz" };
  const v = live.describeViolation(live.evaluateAuthRequest(callback), callback);
  assert.equal(v.allowed, false);
  assert.equal(v.method, "POST");
  assert.equal(v.url, "https://planreview.dob.dc.gov/Workflow/AcceptTask?code=*&state=*");
  const msg = live.violationMessage(v);
  assert.match(msg, /^portal request refused \(deny_pattern: POST https:\/\/planreview\.dob\.dc\.gov\/Workflow\/AcceptTask\?code=\*&state=\*\)$/);
  assert.doesNotMatch(msg, /abc123|xyz/);

  const guard = createRunGuard();
  const read = { method: "GET", url: "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/File/viewFile?fileID=1&token=t0k" };
  const r = live.describeViolation(live.routeReadRequest(read, guard), read);
  assert.equal(r.violation, true);
  assert.equal(r.url, "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/File/viewFile?fileID=1&token=*");
  assert.equal(live.violationMessage({ rule: "approval" }), "portal request refused (approval)");
});

/**
 * Network-free stand-in for a Playwright context: every navigation goes through the transport's
 * context.route handler; an aborted navigation lands on Chromium's error page, as a click-driven
 * navigation does in a real browser.
 */
function fakeLoginBrowser({ pages, redirects = {}, onTimeout = null }) {
  let handler = null;
  const typed = [];
  const clicks = [];
  const keys = [];
  const page = {
    current: "about:blank",
    url() { return this.current; },
    async goto(url) { await navigate(url); },
    async waitForLoadState() {},
    async waitForNavigation() {},
    keyboard: { press: async (key) => { keys.push(key); } },
    async waitForTimeout(ms) { if (onTimeout) await onTimeout(page, ms, navigate); },
    async evaluate() { return (pages[page.current] || {}).text || ""; },
    locator(sel) {
      const spec = () => (pages[page.current] || {}).elements || {};
      const match = () => sel.split(", ").find((s) => spec()[s] !== undefined);
      const loc = {
        first: () => loc,
        count: async () => (match() ? 1 : 0),
        isVisible: async () => Boolean(match()),
        fill: async () => { typed.push(sel); },
        getAttribute: async () => null,
        evaluate: async () =>
          sel.includes("launchRemote")
            ? { tag: "a", type: null, href: "javascript:void(0)", onclick: "launchRemote('Project/Index?tab=projectStatusTab&ProjectID=11854')", text: "D2500488", id: null }
            : { tag: "button", type: null, href: null, onclick: null, text: "Continue", id: null },
        click: async () => {
          clicks.push(sel);
          const to = spec()[match()];
          if (typeof to === "function") await to();
          else if (to) await navigate(to);
        },
      };
      return loc;
    },
  };
  async function navigate(url) {
    let target = url;
    for (;;) {
      let action = null;
      await handler({
        request: () => ({ method: () => "GET", url: () => target, resourceType: () => "document" }),
        continue: async () => { action = "continue"; },
        abort: async () => { action = "abort"; },
      });
      if (action === "abort") { page.current = "chrome-error://chromewebdata/"; return; }
      if (!redirects[target]) { page.current = target; return; }
      target = redirects[target];
    }
  }
  let popupResolve;
  const popupPromise = new Promise((resolve) => { popupResolve = resolve; });
  // No `request` here on purpose: a transport that reads the API through context.request fails with a TypeError.
  const context = { route: async (_pattern, h) => { handler = h; }, newPage: async () => page, waitForEvent: () => popupPromise };
  return { launchContext: async () => ({ context, close: async () => {} }), typed, clicks, keys, navigate, openPopup: (p) => popupResolve(p) };
}

const A3 = { PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3" };

test("login locations drop query and fragment and mask long opaque path segments", () => {
  assert.equal(live.loginLocation("https://x.okta.com/signin/verify/okta/push?stateToken=abc#f"), "x.okta.com/signin/verify/okta/push");
  assert.equal(live.loginLocation(`https://x.b2clogin.com/t/${"a".repeat(64)}/confirmed`), "x.b2clogin.com/t/*/confirmed");
  assert.equal(live.loginLocation("chrome-error://chromewebdata/"), "chrome-error://chromewebdata");
  assert.equal(live.loginLocation("not a url"), "[unparseable]");
  assert.equal(live.blockedAuthRequest({ url: "https://login.idp.example.gov/a?b=c", resourceType: "xhr" }), "GET xhr login.idp.example.gov");
  assert.equal(live.blockedAuthRequest({ method: "POST", url: "https://login.idp.example.gov/a", resourceType: "document" }), "POST document login.idp.example.gov");
});


// ---- Login follows the existing DC scraper (performLogin), D-046 ----------------------------------

const B2C = "https://washingtondcb2cprod.b2clogin.com/t/oauth2/v2.0/authorize?client_id=abc";
const OKTA = "https://dcra.okta.com/oauth2/default/v1/authorize?state=s3cret";
const CALLBACK = "https://avolvecspiam-as-authmiddleware.azurewebsites.net/Auth2/SsoCallback?code=secret";
const HOME = "https://planreview.dob.dc.gov/Dashboard";
const OKTA_USER = 'input[name="identifier"]';
const OKTA_PASS = 'input[name="credentials.passcode"]';
const SUBMIT_SEL = 'input[type="submit"]';

/**
 * B2C (organisation button) -> Okta -> field-less Avolve callback -> dashboard, as seen live in runs 3 and 4.
 * twoStep: the Okta password field only appears a few waits after Next (it did not appear in run 4).
 * callbackRedirectsAfter: how many waits on the callback before the browser redirects (Infinity: never).
 */
function loginScenario({ twoStep = true, passwordNeverAppears = false, callbackRedirectsAfter = 3, afterNextText = null, submitTarget = CALLBACK } = {}) {
  let t = 0;
  let nextClicked = false;
  let waitsAfterNext = 0;
  let waitsOnCallback = 0;
  let browser;
  const elements = {
    [OKTA_USER]: "",
    [SUBMIT_SEL]: async () => {
      if (elements[OKTA_PASS] !== undefined) await browser.navigate(submitTarget);
      else nextClicked = true;
    },
  };
  const showPassword = () => { elements[OKTA_PASS] = ""; elements['input[type="password"]'] = ""; };
  if (!twoStep) showPassword();
  const pages = {
    [B2C]: { text: "Sign in with your organisation", elements: { "#OktaExchange": OKTA } },
    [OKTA]: { text: "Sign in", elements },
    [CALLBACK]: { text: "" },
    [HOME]: { text: "My Projects 1 - 10 of 28 records" },
  };
  browser = fakeLoginBrowser({
    redirects: { "https://planreview.dob.dc.gov/": B2C },
    pages,
    onTimeout: async (page, ms, navigate) => {
      t += ms;
      if (nextClicked && !passwordNeverAppears && elements[OKTA_PASS] === undefined) {
        waitsAfterNext += 1;
        if (waitsAfterNext >= 3) showPassword();
      }
      if (nextClicked && afterNextText) pages[OKTA].text = afterNextText;
      if (page.url() === CALLBACK) {
        waitsOnCallback += 1;
        if (waitsOnCallback >= callbackRedirectsAfter) await navigate(HOME);
      }
    },
  });
  const trace = [];
  const open = () =>
    live.createDcLiveTransport({ launchContext: browser.launchContext, username: "user@example.com", password: "pw-secret", env: A3, minIntervalMs: 0, now: () => t, log: (e) => trace.push(e) });
  return { browser, trace, open, pages, elapsed: () => t };
}

test("login follows performLogin: Okta username screen, password field appears after Next, then the field-less callback redirects", async () => {
  const s = loginScenario({ twoStep: true, callbackRedirectsAfter: 3 });
  const transport = await s.open();
  assert.ok(transport);
  assert.deepEqual(s.browser.clicks, ["#OktaExchange", SUBMIT_SEL, SUBMIT_SEL], "organisation button, Next once, submit once");
  assert.deepEqual(s.browser.typed, [OKTA_USER, OKTA_PASS], "username once, password once");
  assert.deepEqual(s.browser.keys, []);
  const steps = s.trace.filter((e) => e.code === "login_step").map((e) => [e.step, e.at]);
  assert.deepEqual(steps, [
    ["landed", "washingtondcb2cprod.b2clogin.com/t/oauth2/v2.0/authorize"],
    ["b2c", "dcra.okta.com/oauth2/default/v1/authorize"],
    ["username", "dcra.okta.com/oauth2/default/v1/authorize"],
    ["password", "avolvecspiam-as-authmiddleware.azurewebsites.net/Auth2/SsoCallback"],
    ["wait", "avolvecspiam-as-authmiddleware.azurewebsites.net/Auth2/SsoCallback"],
    ["wait", "planreview.dob.dc.gov/Dashboard"],
  ]);
  assert.equal(s.trace.at(-1).code, "login_ok");
  assert.doesNotMatch(JSON.stringify(s.trace), /secret|pw-secret|user@example/);
});

test("login with the password on the first Okta screen presses no Next", async () => {
  const s = loginScenario({ twoStep: false, callbackRedirectsAfter: 1 });
  await s.open();
  assert.deepEqual(s.browser.clicks, ["#OktaExchange", SUBMIT_SEL]);
  assert.deepEqual(s.browser.typed, [OKTA_USER, OKTA_PASS]);
});

test("a callback that never moves stops after about 30 s, without extra clicks or typing, naming host, path and step", async () => {
  const s = loginScenario({ twoStep: false, callbackRedirectsAfter: Infinity });
  await assert.rejects(s.open(), (e) => {
    assert.ok(e instanceof errors.PortalChangedError);
    assert.equal(
      e.message,
      "login did not reach the dashboard at avolvecspiam-as-authmiddleware.azurewebsites.net/Auth2/SsoCallback (step wait, state unknown, password submitted)",
    );
    return true;
  });
  assert.deepEqual(s.browser.clicks, ["#OktaExchange", SUBMIT_SEL], "no click during the wait");
  assert.deepEqual(s.browser.typed, [OKTA_USER, OKTA_PASS], "the password is typed once");
  assert.ok(s.elapsed() >= 30000, `waited ${s.elapsed()} ms`);
});

test("a password field that never appears stops after one Next, without typing the password", async () => {
  const s = loginScenario({ twoStep: true, passwordNeverAppears: true });
  await assert.rejects(s.open(), (e) => {
    assert.ok(e instanceof errors.PortalChangedError);
    assert.equal(e.message, "no password field at dcra.okta.com/oauth2/default/v1/authorize (step username, state unknown, password not submitted)");
    return true;
  });
  assert.deepEqual(s.browser.clicks, ["#OktaExchange", SUBMIT_SEL], "exactly one Next");
  assert.deepEqual(s.browser.typed, [OKTA_USER]);
  assert.ok(s.elapsed() >= 15000, `waited ${s.elapsed()} ms`);
});

test("MFA after the username step parks the job and no password or code is typed", async () => {
  const s = loginScenario({ twoStep: true, passwordNeverAppears: true, afterNextText: "Enter the verification code" });
  await assert.rejects(s.open(), (e) => e instanceof errors.MfaRequiredError);
  assert.deepEqual(s.browser.typed, [OKTA_USER]);
});

test("a sign-in form shown again after the password is a refused credential, not a retry", async () => {
  const s = loginScenario({ twoStep: false, submitTarget: OKTA });
  await assert.rejects(s.open(), (e) => e instanceof errors.AuthError && /shown again/.test(e.message));
  assert.deepEqual(s.browser.clicks, ["#OktaExchange", SUBMIT_SEL]);
  assert.deepEqual(s.browser.typed, [OKTA_USER, OKTA_PASS], "the password is typed once");
});

test("login still aborts on a DC deny-pattern request and records its method and redacted path", async () => {
  const accept = "https://planreview.dob.dc.gov/Workflow/AcceptTask?id=7";
  const browser = fakeLoginBrowser({ redirects: { "https://planreview.dob.dc.gov/": accept }, pages: {} });
  await assert.rejects(
    live.createDcLiveTransport({ launchContext: browser.launchContext, username: "u", password: "p", env: A3, minIntervalMs: 0 }),
    (e) => {
      assert.ok(e instanceof errors.SafetyViolationError);
      assert.equal(e.message, "portal request refused (deny_pattern: GET https://planreview.dob.dc.gov/Workflow/AcceptTask?id=*)");
      return true;
    },
  );
  assert.deepEqual(browser.typed, []);
});

// ---- API session: the project page's own fetch, like the manual scrape (D-047) --------------------

const API_URL = "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/WorkflowAggregate/GetWorkflowInstancesList";

/** Logs in through the fake browser, opens the launchRemote popup and runs `body` with a stubbed in-page fetch. */
async function withApiSession({ sessionId = "sid-test-123", reply }, body) {
  const s = loginScenario({ twoStep: false, callbackRedirectsAfter: 1 });
  const seen = [];
  const popup = {
    url: () => "https://session.planreview.dob.dc.gov/Project/Index?tab=projectStatusTab&ProjectID=11854",
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    evaluate: async (fn, arg) => fn(arg),
  };
  s.pages[HOME].elements = { 'table tr td:first-child a[href*="launchRemote"]': () => s.browser.openPopup(popup) };
  const prev = { fetch: globalThis.fetch, window: globalThis.window };
  globalThis.window = { Globals: sessionId === null ? {} : { Session: { SessionID: sessionId } } };
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    const r = reply(url, init);
    return { status: r.status, url: r.finalUrl || url, headers: { get: (h) => ({ "content-type": r.contentType, "retry-after": r.retryAfter }[h.toLowerCase()] || null) }, text: async () => r.body };
  };
  try {
    const transport = await s.open();
    return await body({ transport, seen, browser: s.browser });
  } finally {
    globalThis.fetch = prev.fetch;
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
  }
}

const jsonReply = () => ({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify({ Records: [{ WFlowInstanceID: 1 }] }) });

test("an API read is made by the project page's own fetch, with the session header and the browser's cookies and origin headers", async () => {
  await withApiSession({ reply: jsonReply }, async ({ transport, seen }) => {
    const data = await transport.getJson("workflow_instances_list", { entityID: 11854 });
    assert.deepEqual(data, { Records: [{ WFlowInstanceID: 1 }] });
    assert.equal(seen.length, 1);
    const { url, init } = seen[0];
    assert.ok(url.startsWith(`${API_URL}?`), url);
    assert.match(url, /entityID=11854/);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "include", "the browser's cookies ride along");
    assert.equal(init.headers.Sessionid, "sid-test-123", "same header name and value the portal's own calls use");
    assert.equal(init.headers["X-Requested-With"], "XMLHttpRequest");
    assert.match(init.headers.Accept, /json/);
  });
});

test("every API read repeats the session header and cookies, and a read the guard refuses is never sent", async () => {
  await withApiSession({ reply: jsonReply }, async ({ transport, seen }) => {
    await transport.getJson("workflow_instances_list", { entityID: 1 });
    await transport.getJson("project_folders", { projectID: 1, folderID: "" });
    assert.equal(seen.length, 2);
    for (const { init } of seen) {
      assert.equal(init.credentials, "include");
      assert.equal(init.headers.Sessionid, "sid-test-123");
    }
    await assert.rejects(transport.getJson("not_a_route", {}));
    assert.equal(seen.length, 2);
  });
});

test("a 401 from the API is session_ended and names the route; a session page landing is session_ended too", async () => {
  await withApiSession({ reply: () => ({ status: 401, contentType: "text/plain", body: "" }) }, async ({ transport }) => {
    await assert.rejects(transport.getJson("workflow_instances_list", { entityID: 1 }), (e) => {
      assert.ok(e instanceof errors.SessionEndedError);
      assert.equal(e.message, "portal API answered 401 (workflow_instances_list)");
      return true;
    });
  });
  await withApiSession(
    { reply: () => ({ status: 200, contentType: "text/html", body: "", finalUrl: "https://session.planreview.dob.dc.gov/WebForms/SessionEnded.aspx" }) },
    async ({ transport }) => {
      await assert.rejects(transport.getJson("workflow_instances_list", { entityID: 1 }), (e) => e instanceof errors.SessionEndedError);
    },
  );
});

test("a project page without Globals.Session.SessionID stops before any API read", async () => {
  await assert.rejects(
    withApiSession({ sessionId: null, reply: jsonReply }, async ({ transport, seen }) => {
      await transport.getJson("workflow_instances_list", { entityID: 1 });
      assert.equal(seen.length, 0);
    }),
    (e) => e instanceof errors.PortalChangedError && /SessionID not present/.test(e.message),
  );
});
