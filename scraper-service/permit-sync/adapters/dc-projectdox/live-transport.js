"use strict";

/**
 * Live Playwright transport for the DC ProjectDox adapter. Implements the same contract as
 * tests/helpers/dc-fixture-transport.js.
 *
 * STATUS: Implemented, never run against the live portal. Opening a live session requires
 * approval A-3 (HANDOFF.md); `createDcLiveTransport` refuses to start unless
 * PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3.
 *
 * Two request policies:
 *   auth  - login and the launchRemote SSO hop. Identity-provider hosts may receive POSTs; DC hosts
 *           only GETs (plus a narrow OIDC callback list) and never anything matching a deny pattern
 *           other than the SessionEnded landing page.
 *   read  - everything else. GET and HEAD on the two DC web hosts and the one ProjectDox API host
 *           pass core/safety even when the path is not a named route (the page itself requests
 *           those paths). A deny pattern aborts the request and fails the run, for every method.
 *           Any other non-GET/HEAD on those hosts is aborted and not sent, and the run continues.
 *           A non-GET/HEAD on another DC host still fails the run. Off-host requests are aborted
 *           without a violation. Static assets are allowed.
 * Playwright's context.route does not see context.request calls, so every API call is checked
 * against the guard explicitly before it is sent, with redirects disabled.
 *
 * No logout is ever clicked: the context is closed instead. The login is attempted once per job.
 */

const safety = require("../../core/safety");
const {
  SafetyViolationError,
  AuthError,
  MfaRequiredError,
  CaptchaError,
  SessionEndedError,
  RateLimitedError,
  PortalChangedError,
  TransientError,
} = require("../../core/errors");
const { awaitPopupPage } = require("../../../lib/await-popup-page");
const { buildDcUrl } = require("./routes");
const { extractProjectInfoFields, extractReviewCommentsReport } = require("./dom-extract");
const { correctionRowsFromJson, reportListItems } = require("./normalize");

const LIVE_APPROVAL_VALUE = "A-3";
const DASHBOARD_URL = "https://planreview.dob.dc.gov/";
const IDP_HOSTS = [/(^|\.)b2clogin\.com$/i, /(^|\.)okta\.com$/i, /^login\.microsoftonline\.com$/i];
const STATIC_RESOURCE_TYPES = new Set(["stylesheet", "image", "font", "media", "script"]);
const AUTH_TRACE_TYPES = new Set(["document", "xhr", "fetch"]);
const DEAD_URL = [/SessionEnded\.aspx/i, /SessionIDDoesNotExist/i, /\/oauth2\/v2\.0\/logout/i];
const DEAD_URL_CODES = ["session_ended_page", "session_id_missing", "b2c_logout"];
/** Read-phase request trail kept for a session-end diagnosis (method, host, path, type, rule; no query). */
const TRAIL_MAX = 25;
const TRAIL_TYPES = new Set(["document", "xhr", "fetch", "other"]);

function parse(url) {
  try {
    return new URL(String(url));
  } catch (_) {
    return null;
  }
}

const isIdpHost = (host) => IDP_HOSTS.some((p) => p.test(host));
const isDcHost = (host) => safety.DC_HOSTS.includes(String(host).toLowerCase());
const isDeadUrl = (url) => DEAD_URL.some((p) => p.test(String(url)));

/** Which session-dead pattern a URL matched, and whether in the path or only in the query. */
function deadUrlMatch(url) {
  const i = DEAD_URL.findIndex((p) => p.test(String(url)));
  if (i < 0) return null;
  const u = parse(url);
  const inPath = u ? DEAD_URL[i].test(u.pathname) : true;
  return `${DEAD_URL_CODES[i]}${inPath ? "" : "_in_query"}`;
}

/** Method, host and masked path of a request (no query, no fragment). */
function requestPoint(method, url, extra = {}) {
  const at = loginLocation(url);
  const slash = at.indexOf("/");
  return { method: String(method || "GET").toUpperCase(), host: slash < 0 ? at : at.slice(0, slash), path: slash < 0 ? "/" : at.slice(slash), ...extra };
}

function sessionEndedMessage(at) {
  if (!at) return undefined;
  return `portal session ended (${at.match}: ${at.method} ${at.host}${at.path}, ${at.type || "request"} via ${at.via}, step ${at.phase})`;
}

/**
 * Login-phase request policy (D-046). The existing DC scraper (performLogin in
 * app/register-execution-routes.js) has no request filter: it follows every redirect of the
 * dashboard -> B2C -> Okta -> Avolve middleware chain. This policy does the same, with one
 * tripwire kept: a request to a DC portal host that matches a DENY_PATTERN (task actions, uploads,
 * Log Out, ...) is never part of a login and still aborts the run. SessionEnded is exempt, as before.
 * Nothing here applies after login: the read phase (routeReadRequest) is unchanged.
 *
 * @param {{ method: string, url: string, resourceType?: string }} req
 * @returns {{ allowed: boolean, rule: string, reason: string }}
 */
function evaluateAuthRequest(req) {
  const u = parse(req.url);
  if (u && isDcHost(u.hostname)) {
    const raw = `${u.pathname}${u.search}`;
    const denied = safety.DENY_PATTERNS.find((p) => p.test(raw) && !/SessionEnded/i.test(p.source));
    if (denied) return { allowed: false, rule: "deny_pattern", reason: `matches ${denied}` };
  }
  return { allowed: true, rule: "login_open", reason: "login follows the same redirects as the existing DC scraper" };
}

/**
 * Read-phase routing decision for browser traffic, including requests the project page itself makes.
 * GET/HEAD decisions come from core/safety (named routes, then any other GET/HEAD on
 * DC_OPEN_READ_HOSTS, plus the one deep-mode keepalive GET/HEAD of /User/GetSessionTimeout on
 * washington-dc-us-portalwebapi.avolvecloud.com). A deny-pattern match is a violation and fails the job, for every method.
 * Any other non-GET/HEAD on those three hosts is aborted and not recorded as a violation (D-050).
 * @returns {{ action: "continue"|"abort", violation: boolean, sessionEnded: boolean, rule: string }}
 */
function routeReadRequest(req, guard) {
  const method = String(req.method || "GET").toUpperCase();
  const u = parse(req.url);
  if (!u) return { action: "abort", violation: true, sessionEnded: false, rule: "url" };
  if (isDcHost(u.hostname) && isDeadUrl(req.url) && method === "GET") {
    return { action: "abort", violation: false, sessionEnded: true, rule: "session_ended" };
  }
  if (safety.matchesDenyPattern(req.url, guard.mode, method)) {
    const v = guard.checkRequest(method, req.url);
    return { action: "abort", violation: true, sessionEnded: false, rule: v.rule };
  }
  if (!isDcHost(u.hostname)) {
    if (method === "GET" && STATIC_RESOURCE_TYPES.has(req.resourceType)) return { action: "continue", violation: false, sessionEnded: false, rule: "asset" };
    return { action: "abort", violation: false, sessionEnded: false, rule: "off_host" };
  }
  if (!safety.ALLOWED_METHODS.includes(method)) {
    if (safety.modePolicy(guard.mode).openHosts.includes(u.hostname.toLowerCase())) {
      return { action: "abort", violation: false, sessionEnded: false, rule: "method_dropped" };
    }
    const v = guard.checkRequest(method, req.url);
    return { action: "abort", violation: true, sessionEnded: false, rule: v.rule };
  }
  if (method === "GET" && STATIC_RESOURCE_TYPES.has(req.resourceType)) {
    return { action: "continue", violation: false, sessionEnded: false, rule: "asset" };
  }
  const v = guard.checkRequest(method, req.url);
  return v.allowed
    ? { action: "continue", violation: false, sessionEnded: false, rule: v.rule }
    : { action: "abort", violation: true, sessionEnded: false, rule: v.rule };
}

/**
 * Classify a login-flow page from its URL and visible text. Text is never logged.
 * @returns {"mfa"|"captcha"|"bad_credentials"|"locked"|"session_dead"|"login_form"|"authenticated"|"unknown"}
 */
function classifyLoginPage({ url, text, hasPasswordField = false }) {
  const t = String(text || "");
  const u = parse(url);
  if (/captcha|i'?m not a robot|verify you are human/i.test(t)) return "captcha";
  if (/verification code|one-time (pass)?code|authenticator app|okta verify|enter (the )?code|multi-?factor|two-?step verification|security code|send (me )?(a )?(push|code)|verify (it'?s|it is) you/i.test(t)) return "mfa";
  if (/account (is )?locked|too many (failed|unsuccessful)/i.test(t)) return "locked";
  if (/(incorrect|invalid) (username|user name|email|password|credentials)|unable to sign in|sign-?in failed|we can'?t find an account/i.test(t)) return "bad_credentials";
  if (u && isDeadUrl(u.href)) return "session_dead";
  if (u && (isIdpHost(u.hostname) || safety.isLoginIdpHost(u.hostname))) return hasPasswordField ? "login_form" : "unknown";
  if (u && isDcHost(u.hostname) && !/SSOLanding|Home\/SSO|\/login/i.test(u.pathname)) return "authenticated";
  return hasPasswordField ? "login_form" : "unknown";
}

function throwForLoginState(state) {
  if (state === "mfa") throw new MfaRequiredError();
  if (state === "captcha") throw new CaptchaError();
  if (state === "bad_credentials" || state === "locked") throw new AuthError(`portal login refused (${state})`);
}

/** Map an API response status to the error taxonomy; null when the status is usable. */
function errorForStatus(status, headers = {}, location = "") {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403 || (status >= 300 && status < 400 && isDeadUrl(location))) {
    return new SessionEndedError(`portal API answered ${status}`);
  }
  if (status === 429) {
    const ra = Number.parseInt(headers["retry-after"] || "", 10);
    return new RateLimitedError("portal API answered 429", Number.isFinite(ra) && ra > 0 ? ra : null);
  }
  if (status >= 500) return new TransientError(`portal API answered ${status}`);
  return new PortalChangedError(`portal API answered ${status}`);
}

/** "1 - 10 of 28 records" / "of 28 items" → 28 */
function parseDashboardTotal(text) {
  const m = String(text || "").match(/\bof\s+([\d,]+)\s+(records|items|projects|results)\b/i);
  return m ? Number.parseInt(m[1].replace(/,/g, ""), 10) : null;
}

/**
 * Port of collectDcPlanReviewDashboardProjects (register-execution-routes.js) as a pure function over
 * raw cells captured in the page: [{ cells: [text...], link: { text, href, onclick } }].
 */
function parseDashboardRows(rawRows) {
  const out = [];
  const seen = new Set();
  for (const r of rawRows || []) {
    if (!r || !r.link || !Array.isArray(r.cells) || r.cells.length < 2) continue;
    const permit = String(r.link.text || "").trim();
    if (!permit || seen.has(permit)) continue;
    seen.add(permit);
    const handler = `${r.link.href || ""} ${r.link.onclick || ""}`;
    const pid = handler.match(/ProjectID=(\d+)/);
    let status = String(r.statusText || r.cells[3] || "").trim();
    if (status.length > 2 && status.length % 2 === 0) {
      const half = status.slice(0, status.length / 2);
      if (status === half + half) status = half;
    }
    out.push({
      permit,
      projectId: pid ? pid[1] : null,
      status: status || null,
      // Manual-scraper project fields (collectDcPlanReviewDashboardProjects); not read by discoveryRecord.
      dashboard: {
        description: String(r.cells[1] || "").trim(),
        location: String(r.cells[2] || "").trim(),
        tasks: String(r.cells[4] || "").trim(),
        href: r.link.href || "",
      },
    });
  }
  return out;
}

/**
 * Login-flow location for errors and the console trace: scheme-less host and path, no query or fragment.
 * Long opaque path segments are masked. Browser error pages (a blocked navigation) report their scheme.
 */
function loginLocation(url) {
  const u = parse(url);
  if (!u) return "[unparseable]";
  if (u.protocol !== "https:" && u.protocol !== "http:") return `${u.protocol}//${u.hostname}`;
  const path = u.pathname
    .split("/")
    .map((s) => (s.length > 40 ? "*" : s))
    .join("/")
    .slice(0, 120);
  return `${u.hostname}${path}`;
}

/** Auth-phase request the policy dropped, as "<method> <resourceType> <host>" (no path, no query). */
function blockedAuthRequest(req) {
  const u = parse(req && req.url);
  const method = String((req && req.method) || "GET").toUpperCase();
  return `${method} ${(req && req.resourceType) || "request"} ${u ? u.hostname || u.protocol : "[unparseable]"}`;
}

function unrecognisedLoginMessage({ what, at, step, state, passwordSubmitted, blocked = [] }) {
  const tail = blocked.length ? `; blocked during login: ${blocked.join(", ")}` : "";
  return `${what} at ${at} (step ${step}, state ${state}, password ${passwordSubmitted ? "submitted" : "not submitted"})${tail}`;
}

/** Refused-request record for errors and events: method and redacted URL only (query values masked except ids). */
function describeViolation(verdict, req) {
  return { ...verdict, method: String((req && req.method) || "GET").toUpperCase(), url: safety.redactUrl(req && req.url) };
}

function violationMessage(v) {
  return `portal request refused (${v.rule}${v.method && v.url ? `: ${v.method} ${v.url}` : ""})`;
}

function createThrottle(minIntervalMs, { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = -Infinity;
  return async function throttle() {
    const wait = last + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };
}

async function elementDescriptor(locator) {
  return locator.evaluate((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type"),
    href: el.getAttribute("href"),
    onclick: el.getAttribute("onclick"),
    text: (el.textContent || "").trim().slice(0, 80),
    id: el.id || null,
  }));
}

/**
 * @param {{
 *   launchContext: () => Promise<{ context: import('playwright').BrowserContext, close: () => Promise<void> }>,
 *   username: string, password: string,
 *   guard?: ReturnType<typeof safety.createRunGuard>,
 *   minIntervalMs?: number, env?: NodeJS.ProcessEnv, log?: (event: object) => void,
 *   mode?: "json"|"deep",
 *   login?: (page: import('playwright').Page) => Promise<unknown>,
 * }} opts
 *
 * `mode: "deep"` (D-055, D-057): the read guard uses the deep policy, and context.request calls (the manual
 * scraper's RetrieveFile reads) are checked by the same guard before they are sent.
 * `login`: the existing manual DC login (performLogin), called once in the auth phase instead of the port below.
 */
async function createDcLiveTransport(opts) {
  const env = opts.env || process.env;
  if (env.PERMIT_SYNC_LIVE_PORTAL_APPROVED !== LIVE_APPROVAL_VALUE) {
    throw new SafetyViolationError("live DC portal sessions are not approved (A-3)", { rule: "approval" });
  }
  if (!opts.username || !opts.password) throw new AuthError("credential is missing username or password");
  const mode = opts.mode || "json";
  const guard = opts.guard || safety.createRunGuard({ mode });
  if (guard.mode !== mode) throw new SafetyViolationError(`guard mode ${guard.mode} does not match transport mode ${mode}`, { rule: "mode" });
  const log = opts.log || (() => {});
  const throttle = createThrottle(opts.minIntervalMs ?? 1500);
  const { context, close } = await opts.launchContext();

  let phase = "auth";
  let violation = null;
  let sessionEnded = false;
  let sessionId = null;
  let apiPage = null;
  let dashboard = null;
  let currentPage = 0;
  const authBlocked = [];
  const trail = [];
  let sessionEndedAt = null;
  const remember = (entry) => {
    trail.push(entry);
    if (trail.length > TRAIL_MAX) trail.shift();
  };
  const markSessionEnded = (method, url, extra) => {
    sessionEnded = true;
    if (!sessionEndedAt) sessionEndedAt = requestPoint(method, url, { match: deadUrlMatch(url), phase, ...extra });
  };

  await context.route("**/*", async (route) => {
    const req = route.request();
    const r = { method: req.method(), url: req.url(), resourceType: req.resourceType() };
    if (phase === "auth") {
      const v = evaluateAuthRequest(r);
      if (!v.allowed && isDcHost(parse(r.url)?.hostname || "")) violation = violation || describeViolation(v, r);
      if (!v.allowed && AUTH_TRACE_TYPES.has(r.resourceType)) {
        const b = blockedAuthRequest(r);
        if (!authBlocked.includes(b) && authBlocked.length < 5) authBlocked.push(b);
      }
      if (!v.allowed) return route.abort("blockedbyclient");
      return route.continue();
    }
    const d = routeReadRequest(r, guard);
    if (d.violation) violation = violation || describeViolation(d, r);
    if (d.sessionEnded) markSessionEnded(r.method, r.url, { type: r.resourceType || null, via: "browser" });
    if (isDcHost(parse(r.url)?.hostname || "") && (TRAIL_TYPES.has(r.resourceType) || d.action !== "continue")) {
      remember(requestPoint(r.method, r.url, { type: r.resourceType || null, rule: d.rule, action: d.action }));
    }
    return d.action === "continue" ? route.continue() : route.abort("blockedbyclient");
  });

  function assertHealthy() {
    if (violation) throw new SafetyViolationError(violationMessage(violation), violation);
    if (sessionEnded) throw new SessionEndedError(sessionEndedMessage(sessionEndedAt));
  }

  const isOpen = (p) => Boolean(p) && !(typeof p.isClosed === "function" && p.isClosed());

  // Playwright's context.route does not see context.request; in deep mode the manual scraper uses it for
  // RetrieveFile, so every such call passes the same guard first. A refused call is recorded as a
  // violation even if the caller swallows the error, and assertHealthy then fails the job.
  if (mode === "deep" && context.request) {
    const api = context.request;
    for (const m of ["get", "head", "post", "put", "patch", "delete", "fetch"]) {
      const orig = api[m];
      if (typeof orig !== "function") continue;
      api[m] = async (target, options = {}) => {
        const url = typeof target === "string" ? target : target && typeof target.url === "function" ? target.url() : String(target);
        const method = m === "fetch" ? String((options && options.method) || (target && typeof target.method === "function" ? target.method() : "GET")).toUpperCase() : m.toUpperCase();
        const onDcHost = isDcHost(parse(url)?.hostname || "");
        if (onDcHost && isDeadUrl(url)) markSessionEnded(method, url, { type: "api_request", via: "context_request" });
        const v = guard.checkRequest(method, url);
        if (onDcHost) remember(requestPoint(method, url, { type: "api_request", rule: v.rule, action: v.allowed ? "continue" : "refused" }));
        if (!v.allowed) {
          violation = violation || describeViolation(v, { method, url });
          throw new SafetyViolationError(violationMessage(violation), violation);
        }
        return orig.call(api, target, options);
      };
    }
  }

  /** The dashboard page; reopened (cookies kept) when the manual scraper closed it, e.g. its pre-download page sweep. */
  async function getDashboard() {
    if (isOpen(dashboard)) return dashboard;
    dashboard = await context.newPage();
    await dashboard.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 45000 });
    await settle(dashboard, 1000);
    currentPage = 1;
    assertHealthy();
    const state = await loginState(dashboard);
    if (state !== "authenticated") throw new SessionEndedError(`dashboard reopen landed on ${loginLocation(dashboard.url())} (${state})`);
    log({ code: "dashboard_reopened" });
    return dashboard;
  }

  async function settle(page, ms = 1500) {
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(ms);
  }

  async function loginState(page) {
    const text = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 5000) : "")).catch(() => "");
    const hasPasswordField = (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
    return classifyLoginPage({ url: page.url(), text, hasPasswordField });
  }

  async function clickFirst(page, selectors) {
    for (const s of selectors) {
      const loc = page.locator(s).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        const el = await elementDescriptor(loc);
        if (safety.DENY_PATTERNS.some((p) => p.test(`${el.href || ""} ${el.onclick || ""} ${el.text || ""} ${el.id || ""}`))) {
          throw new SafetyViolationError(`login click refused: ${el.text}`, { rule: "deny_pattern" });
        }
        await loc.click();
        return true;
      }
    }
    return false;
  }

  // Selector lists copied from performLogin (app/register-execution-routes.js).
  const USER_FIELDS = [
    'input[name="identifier"]',
    "#okta-signin-username",
    'input[name="username"]',
    'input[type="email"]',
    'input[type="text"]:not([type="checkbox"]):not([type="radio"]):not([role="checkbox"])',
  ];
  const PASS_FIELDS = ['input[name="credentials.passcode"]', "#okta-signin-password", 'input[name="password"]', 'input[type="password"]'];
  const SUBMIT = ['input[type="submit"]', 'button[type="submit"]'];
  const CONTINUE = ['button:has-text("Continue")', 'a:has-text("Continue")', 'input[value="Continue"]'];
  const LOGIN_AGAIN = ['a:has-text("Log in again")', 'a:has-text("Login")', 'a[href*="Login"]'];
  const PASSWORD_APPEARS_MS = 15000;
  const DASHBOARD_WAIT_MS = 30000;

  /**
   * Port of performLogin (app/register-execution-routes.js), the login the manual DC scrape has used
   * successfully. It cannot be called directly: it is not exported and lives in the 13.9k-line HTTP
   * app module, which the worker must not load (D-025). Same order, selectors and waits:
   *   goto (networkidle) + 2 s -> SessionEnded "Log in again" -> SSOLanding "Continue" ->
   *   B2C #OktaExchange (else submit) + navigation wait 30 s + 3 s -> if the URL is an IdP page: fill
   *   username; when no password field is there yet, press Next once, wait 15 s + 2 s -> fill password
   *   once, submit, navigation wait 30 s + 3 s -> SSOLanding "Continue" -> success unless the URL is still
   *   B2C, Okta sign-in or SessionEnded.
   * Differences, all fail-safe: MFA, CAPTCHA and refused credentials park or fail the job instead of being
   * ignored; the password is typed at most once; after the password the page may still be on a
   * field-less callback that redirects on its own (the Avolve SsoCallback), so the final check waits up to
   * 30 s without clicking or typing, instead of judging the first URL it sees. An unrecognised page is
   * never fatal by itself.
   */
  async function login() {
    const page = await context.newPage();
    dashboard = page;
    let passwordSubmitted = false;
    let state = "unknown";
    let stepName = "start";
    const now = opts.now || Date.now;
    const where = (what) =>
      unrecognisedLoginMessage({ what, at: loginLocation(page.url()), step: stepName, state, passwordSubmitted, blocked: authBlocked });
    const nav = (timeout) => page.waitForNavigation({ waitUntil: "networkidle", timeout }).catch(() => {});
    const checkpoint = async (name) => {
      stepName = name;
      state = await loginState(page);
      log({ code: "login_step", step: name, state, at: loginLocation(page.url()), blocked: authBlocked.length });
      if (violation) assertHealthy();
      throwForLoginState(state);
    };
    const visibleField = async (selectors) => {
      for (const s of selectors) {
        const loc = page.locator(s).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          const type = await loc.getAttribute("type").catch(() => "");
          if (type === "checkbox" || type === "radio") continue;
          return loc;
        }
      }
      return null;
    };
    const clickContinue = async () => {
      if (!(await clickFirst(page, CONTINUE))) return false;
      await nav(15000);
      await page.waitForTimeout(2000);
      return true;
    };

    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);
    await checkpoint("landed");

    let url = page.url();
    if (/SessionEnded/i.test(url) && (await clickFirst(page, LOGIN_AGAIN))) {
      await nav(15000);
      await page.waitForTimeout(2000);
      url = page.url();
    }
    if (/SSOLanding|Home\/SSO/i.test(url) && (await clickContinue())) url = page.url();
    if (/b2clogin\.com/i.test(url)) {
      if (!(await clickFirst(page, ["#OktaExchange"])) && !(await clickFirst(page, ['button[type="submit"]']))) {
        throw new PortalChangedError(where("B2C page has no sign-in button"));
      }
      await nav(30000);
      await page.waitForTimeout(3000);
      url = page.url();
      await checkpoint("b2c");
    }
    if (/okta|b2clogin|login|signin/i.test(url)) {
      const userField = await visibleField(USER_FIELDS);
      if (!userField) throw new PortalChangedError(where("no username field"));
      await userField.fill(opts.username);
      let passField = await visibleField(PASS_FIELDS);
      if (!passField) {
        // Two-step login: Next once. Never a second click.
        if (!(await clickFirst(page, SUBMIT))) await page.keyboard.press("Enter");
        await nav(15000);
        await page.waitForTimeout(2000);
        const deadline = now() + PASSWORD_APPEARS_MS;
        for (;;) {
          passField = await visibleField(PASS_FIELDS);
          if (passField || now() >= deadline) break;
          await page.waitForTimeout(500);
        }
        await checkpoint("username");
        if (!passField) throw new PortalChangedError(where("no password field"));
      }
      passwordSubmitted = true;
      await passField.fill(opts.password);
      if (!(await clickFirst(page, SUBMIT))) await page.keyboard.press("Enter");
      await nav(30000);
      await page.waitForTimeout(3000);
      await checkpoint("password");
      url = page.url();
    }
    let continuedAfterLogin = false;
    if (/SSOLanding|Home\/SSO/i.test(url) && (await clickContinue())) {
      continuedAfterLogin = true;
      url = page.url();
    }

    // Wait only: the redirect chain after the password (including the field-less Avolve callback)
    // lands on the dashboard by itself. A second Continue is allowed once, as performLogin does.
    const deadline = now() + DASHBOARD_WAIT_MS;
    let lastAt = null;
    for (;;) {
      state = await loginState(page);
      const at = loginLocation(page.url());
      if (at !== lastAt) {
        lastAt = at;
        stepName = "wait";
        log({ code: "login_step", step: "wait", state, at, blocked: authBlocked.length });
      }
      if (violation) assertHealthy();
      throwForLoginState(state);
      if (state === "authenticated") break;
      if (passwordSubmitted && state === "login_form") throw new AuthError("login form shown again after the password was submitted");
      if (!continuedAfterLogin && /SSOLanding|Home\/SSO/i.test(page.url()) && (await clickContinue())) {
        continuedAfterLogin = true;
        continue;
      }
      if (now() >= deadline) break;
      await page.waitForTimeout(500);
    }
    // A page that never moves is a portal problem, not a refused credential (that is AuthError above).
    if (state !== "authenticated") throw new PortalChangedError(where("login did not reach the dashboard"));
    log({ code: "login_ok" });
    phase = "read";
    currentPage = 1;
  }

  async function readDashboard() {
    const dash = await getDashboard();
    const raw = await dash.evaluate(() =>
      Array.from(document.querySelectorAll("table tr")).map((tr) => {
        const cells = Array.from(tr.querySelectorAll("td"));
        const a = cells[0] && cells[0].querySelector("a");
        const sc = cells[3] && cells[3].querySelector("button, a.btn, span.badge, a");
        return {
          cells: cells.map((c) => (c.textContent || "").trim()),
          statusText: sc ? (sc.textContent || "").trim() : null,
          link: a ? { text: (a.textContent || "").trim(), href: a.getAttribute("href"), onclick: a.getAttribute("onclick") } : null,
        };
      }),
    );
    const bodyText = await dash.evaluate(() => (document.body ? document.body.innerText : ""));
    return { rows: parseDashboardRows(raw), totalRecords: parseDashboardTotal(bodyText) };
  }

  async function safeClick(locator) {
    const el = await elementDescriptor(locator);
    const v = guard.checkClick(el);
    if (!v.allowed) throw new SafetyViolationError(`click refused (${v.rule})`, v);
    await throttle();
    await locator.click();
  }

  async function ensureApiSession() {
    if (sessionId && isOpen(apiPage)) return;
    sessionId = null;
    apiPage = null;
    const dash = await getDashboard();
    const link = dash.locator('table tr td:first-child a[href*="launchRemote"], table tr td:first-child a[onclick*="launchRemote"]').first();
    if ((await link.count()) === 0) throw new PortalChangedError("dashboard has no project links");
    phase = "auth";
    let popup;
    try {
      popup = await awaitPopupPage(context, () => safeClick(link), {
        timeout: 25000,
        label: "DC API SSO hop popup",
      });
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        await popup.waitForLoadState("domcontentloaded").catch(() => {});
        const u = popup.url();
        if (isDeadUrl(u)) throw new SessionEndedError("SSO hop reached a dead session page");
        if (/session\.planreview\.dob\.dc\.gov\/Project\/Index/i.test(u)) break;
        throwForLoginState(await loginState(popup));
        await popup.waitForTimeout(400);
      }
      if (!/\/Project\/Index/i.test(popup.url())) {
        const tail = authBlocked.length ? `; blocked during login: ${authBlocked.join(", ")}` : "";
        throw new PortalChangedError(`SSO hop did not reach Project/Index (at ${loginLocation(popup.url())})${tail}`);
      }
    } finally {
      phase = "read";
    }
    assertHealthy();
    sessionId = await popup.evaluate(() => (window.Globals && window.Globals.Session && window.Globals.Session.SessionID) || null);
    if (!sessionId || typeof sessionId !== "string") throw new PortalChangedError("Globals.Session.SessionID not present");
    apiPage = popup;
    log({ code: "api_session_ok" });
  }

  /**
   * One read-only GET made by the logged-in project page itself (the page's own fetch), the way the manual
   * scrape reads the Avolve web API (D-047). The browser then sends what the portal's own calls send: the
   * session cookies for that host (credentials "include"), Origin and Referer of the project page, and
   * `X-Requested-With: XMLHttpRequest`; `Sessionid` is Globals.Session.SessionID, the value the page's
   * own calls use. The first live attempt used the bare `context.request` with `Sessionid` and `Accept`
   * only, and the API answered 401 (run 5). The URL has passed the guard before this call and the request
   * passes it again in the browser route handler; redirects are followed by the browser, and a landing on a
   * session-ended page is reported as `session_ended` by that handler.
   */
  async function pageGet(route, params, accept) {
    assertHealthy();
    await ensureApiSession();
    const url = buildDcUrl(route, params);
    const v = guard.checkRequest("GET", url);
    if (!v.allowed) throw new SafetyViolationError(`blocked ${route}: ${v.reason}`, v);
    await throttle();
    let res;
    try {
      res = await apiPage.evaluate(
        async ({ url: target, sid, accept: acceptType }) => {
          const r = await fetch(target, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            headers: { Sessionid: sid, Accept: acceptType, "X-Requested-With": "XMLHttpRequest" },
          });
          return {
            status: r.status,
            contentType: r.headers.get("content-type") || "",
            retryAfter: r.headers.get("retry-after") || "",
            finalUrl: r.url || "",
            text: await r.text(),
          };
        },
        { url, sid: sessionId, accept },
      );
    } catch (e) {
      assertHealthy();
      throw new TransientError(`${route} request failed in the page (${String((e && e.name) || "error")})`);
    }
    assertHealthy();
    if (res.finalUrl && isDeadUrl(res.finalUrl)) throw new SessionEndedError(`${route} ended on a session page`);
    const err = errorForStatus(res.status, { "retry-after": res.retryAfter }, "");
    if (err) {
      err.message = `${err.message} (${route})`;
      throw err;
    }
    return res;
  }

  async function getJson(route, params) {
    const res = await pageGet(route, params, "application/json, text/plain, */*");
    if (!/json/i.test(res.contentType)) throw new PortalChangedError(`${route} did not return JSON`);
    try {
      return JSON.parse(res.text);
    } catch (_) {
      throw new PortalChangedError(`${route} returned unparseable JSON`);
    }
  }

  /**
   * Fetches a read-only HTML partial over the logged-in session. The URL must pass the same
   * guard as the JSON routes. Returns the HTML text; the caller parses it inside the page with DOMParser
   * (dom-extract.js), so no script in the partial runs.
   */
  async function fetchPartial(route, params) {
    const res = await pageGet(route, params, "text/html, */*");
    if (!/html/i.test(res.contentType)) throw new PortalChangedError(`${route} did not return HTML`);
    return res.text;
  }

  /**
   * D-055: the existing manual DC login (performLogin) in the auth phase, once. Its own failure text is never
   * surfaced (it may carry URLs); the page state decides the error. A failed login is not retried (AuthError),
   * so a refused password is never typed twice.
   */
  async function injectedLogin() {
    const page = await context.newPage();
    dashboard = page;
    let failed = false;
    try {
      await opts.login(page);
    } catch (_) {
      failed = true;
    }
    if (violation) assertHealthy();
    const state = await loginState(page);
    log({ code: "login_step", step: "performLogin", state, at: loginLocation(page.url()), blocked: authBlocked.length });
    throwForLoginState(state);
    if (state !== "authenticated") {
      const tail = authBlocked.length ? `; blocked during login: ${authBlocked.join(", ")}` : "";
      throw new AuthError(`performLogin ${failed ? "failed" : "did not reach the dashboard"} at ${loginLocation(page.url())} (state ${state})${tail}`);
    }
    log({ code: "login_ok" });
    phase = "read";
    currentPage = 1;
  }

  if (typeof opts.login === "function") await injectedLogin();
  else await login();
  assertHealthy();

  return {
    guard,
    mode,
    context,
    assertHealthy,
    /** Session-end point and recent portal requests (method, host, masked path, type, rule only). */
    diagnostics() {
      return { sessionEndedAt, trail: trail.slice() };
    },
    /** The dashboard page (reopened if it was closed); the deep pass shares it as session.page. */
    dashboardPage: getDashboard,
    /**
     * After a deep pass: adopt the dashboard page the manual scraper used (it may have replaced it) and forget
     * the pager position, because the manual scraper may have clicked the pager itself.
     */
    adoptDashboard(page) {
      if (isOpen(page)) dashboard = page;
      currentPage = null;
    },
    /** True for the pages the JSON pass reads through (dashboard and API page); the deep pass must not close them. */
    ownsPage(page) {
      return Boolean(page) && (page === dashboard || page === apiPage);
    },
    /** Runs `fn` (a launchRemote SSO hop opened by the manual scraper) under the login-phase policy, as ensureApiSession does. */
    async withAuthPhase(fn) {
      const prev = phase;
      phase = "auth";
      try {
        return await fn();
      } finally {
        phase = prev;
        assertHealthy();
      }
    },
    async listDashboardPage(n) {
      assertHealthy();
      const dashboardPageRef = await getDashboard();
      if (currentPage === null) {
        await dashboardPageRef.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 45000 });
        await settle(dashboardPageRef, 1000);
        assertHealthy();
        currentPage = 1;
      }
      if (n !== currentPage) {
        const pager = dashboardPageRef.locator(`a[href^="javascript"]:text-is("${Number(n)}")`).first();
        if ((await pager.count()) === 0) throw new PortalChangedError(`dashboard pager has no page ${n}`);
        await safeClick(pager);
        await settle(dashboardPageRef, 1000);
        currentPage = n;
      }
      assertHealthy();
      return readDashboard();
    },
    getJson,
    /**
     * Reviews rows from the JSON the Reviews tab renders from; null when there is no workflow instance.
     * The ProjectCorrections HTML partial carries only row templates, so it is not read.
     */
    async getCorrectionsRows(projectId, wflowInstanceId) {
      if (!wflowInstanceId) return null;
      const data = await getJson("project_corrections_json", { wflowInstanceID: wflowInstanceId });
      const rows = correctionRowsFromJson(data);
      if (!rows) throw new PortalChangedError("corrections payload has no Corrections array");
      return rows;
    },
    /** SSRS Review Comments report rows (fallback source). A report with more than one page is refused. */
    async getReviewCommentsReport(projectId, wflowInstanceId) {
      const html = await fetchPartial("review_comments_report", {
        ProjectID: projectId,
        WFlowInstanceID: wflowInstanceId,
        Timezone: "",
      });
      const parsed = await (await getDashboard()).evaluate(extractReviewCommentsReport, html);
      if (!parsed) throw new PortalChangedError("report page has no Review Comments table");
      if (parsed.totalPages !== 1) throw new PortalChangedError(`report has ${parsed.totalPages ?? "unknown"} pages`);
      return parsed.rows;
    },
    /** Info tab values (allowlisted labels only; emails and phones are never read). */
    async getProjectInfo(projectId) {
      const html = await fetchPartial("project_info", { ProjectID: projectId, ProjectTemplateID: 5 });
      const parsed = await (await getDashboard()).evaluate(extractProjectInfoFields, html);
      if (!parsed) throw new PortalChangedError("Info partial has no project info container");
      return parsed.values;
    },
    /** Reports tab listing (the grid's own data call). Report bodies are not fetched here. */
    async listReports(projectId) {
      const list = await getJson("report_list", { projectId });
      if (!Array.isArray(list)) throw new PortalChangedError("report list is not an array");
      return reportListItems(list);
    },
    async close() {
      sessionId = null;
      apiPage = null;
      await close();
    },
  };
}

module.exports = {
  LIVE_APPROVAL_VALUE,
  createDcLiveTransport,
  evaluateAuthRequest,
  routeReadRequest,
  classifyLoginPage,
  errorForStatus,
  parseDashboardTotal,
  parseDashboardRows,
  createThrottle,
  describeViolation,
  violationMessage,
  loginLocation,
  blockedAuthRequest,
};
