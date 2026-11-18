"use strict";

/**
 * Live Playwright transport for Montgomery County MD ProjectDox. Same contract as the DC transport
 * (adapters/dc-projectdox/adapter.js header) and the same read-only guard, with the Montgomery tenant.
 *
 * Session (capture 2026-11-18, MONTGOMERY_CAPABILITY_MAP.md):
 *   1. Portal form login at montgomeryco-md-us.avolvecloud.com/Login/Index/MontgomeryDPS-Prod (the existing
 *      performMontgomeryPortalLogin, injected as `login`), landing on /Home/Index. No MFA was asked.
 *   2. WebUI hop: the portal's own "View All Projects" link opens a popup that form-POSTs the portal session to
 *      projectdoxwebui /webforms/index.aspx and lands on /User/Index with Globals.Session.SessionID.
 *   3. Reads: the DC JSON routes on the Montgomery Web API through the popup's own fetch (Sessionid header).
 *      Discovery is the projects grid call (GetPagedActiveProjects): all accessible projects, where the portal
 *      Home table lists only some.
 * Steps 1 and 2 run under the auth policy: anything goes except a deny-pattern request to a Montgomery host
 * (SessionEnded excepted, the login redirects through /Login/SessionEnded). Everything after runs under the read
 * policy shared with DC (routeReadRequest with the tenant guard). No logout is clicked; the context is closed.
 * Deep mode adds two reads for deep/montgomery-driver.js: fetchFile (Web API RetrieveFile) and exportReport
 * (ReportViewer page + SSRS export). Both refuse in JSON mode, and the guard refuses them there too.
 *
 * STATUS: implemented and unit-tested; not yet run as a worker job. Opening a live session requires
 * PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3 and an enabled Montgomery source.
 */

const path = require("node:path");
const safety = require("../../core/safety");
const {
  SafetyViolationError,
  AuthError,
  MfaRequiredError,
  CaptchaError,
  SessionEndedError,
  PortalChangedError,
  TransientError,
} = require("../../core/errors");
const { awaitPopupPage } = require("../../../lib/await-popup-page");
const { buildTenantUrl } = require("../dc-projectdox/routes");
const { extractProjectInfoFields, extractReviewCommentsReport } = require("../dc-projectdox/dom-extract");
const dcLive = require("../dc-projectdox/live-transport");
const { MONTGOMERY } = require("../projectdox-tenants");
const mc = require("./normalize");

const DASHBOARD_URL = `${MONTGOMERY.portalOrigin}/Home/Index`;
const ENTRY_URL = `${MONTGOMERY.portalOrigin}/ProjectDox/index.html`;
const VIEW_ALL_TEXT = /^\s*View All Projects\s*$/i;
const PAGE_SIZE = 100;
const TRAIL_MAX = 25;

const isTenantHost = (host) => MONTGOMERY.hosts.includes(String(host || "").toLowerCase());
const hostOf = (url) => {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
};

/** Auth-phase verdict: a deny-pattern request to a Montgomery host is never part of a login. */
function evaluateMontgomeryAuthRequest(req) {
  let u = null;
  try {
    u = new URL(String(req.url));
  } catch (_) {
    return { allowed: false, rule: "url", reason: "unparseable URL" };
  }
  if (isTenantHost(u.hostname)) {
    const raw = `${u.pathname}${u.search}`;
    const denied = safety.DENY_PATTERNS.find((p) => p.test(raw) && !/SessionEnded/i.test(p.source));
    if (denied) return { allowed: false, rule: "deny_pattern", reason: `matches ${denied}` };
  }
  return { allowed: true, rule: "login_open", reason: "portal login and WebUI hop" };
}

/** Login page state from URL and visible text (text never logged). */
function classifyMontgomeryPage({ url, text, hasPasswordField = false }) {
  const generic = dcLive.classifyLoginPage({ url: "about:blank", text, hasPasswordField: false });
  if (["mfa", "captcha", "locked", "bad_credentials"].includes(generic)) return generic;
  let u = null;
  try {
    u = new URL(String(url));
  } catch (_) {
    return "unknown";
  }
  if (dcLive.isDeadUrl(u.href) && !/\/Login\//i.test(u.pathname)) return "session_dead";
  if (isTenantHost(u.hostname) && !/\/Login(\/|$)/i.test(u.pathname) && !hasPasswordField) return "authenticated";
  return hasPasswordField ? "login_form" : "unknown";
}

/** Element the WebUI hop clicks: the portal's "View All Projects" link, with no deny-pattern handler. */
function evaluateViewAllClick(el) {
  const blob = [el && el.href, el && el.onclick, el && el.id].filter(Boolean).join(" | ");
  if (!el || String(el.tag || "").toLowerCase() !== "a" || !VIEW_ALL_TEXT.test(String(el.text || ""))) {
    return { allowed: false, rule: "not_view_all", reason: "element is not the View All Projects link" };
  }
  const denied = safety.DENY_PATTERNS.find((p) => p.test(blob));
  if (denied) return { allowed: false, rule: "deny_pattern", reason: `click matches ${denied}` };
  return { allowed: true, rule: "webui_hop", reason: "portal View All Projects link (WebUI session hop)" };
}

/**
 * Runs inside the WebUI page (page.evaluate): one RetrieveFile GET with the page's session, the body returned as
 * base64. A refused, failed or over-limit response returns no body (b64 null); an over-limit declared size is
 * aborted before the body is read.
 */
async function pageRetrieveFile({ target, sid, max }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 180000);
  try {
    const r = await fetch(target, { method: "GET", credentials: "include", cache: "no-store", signal: ctl.signal, headers: { Sessionid: sid, "X-Requested-With": "XMLHttpRequest" } });
    const declared = r.headers.get("content-length");
    const out = { status: r.status, contentType: r.headers.get("content-type") || "", retryAfter: r.headers.get("retry-after") || "", finalUrl: r.url || "", declared: declared === null ? null : Number(declared), b64: null, size: 0 };
    if (!r.ok || (out.declared !== null && out.declared > max)) {
      ctl.abort();
      return out;
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    out.size = bytes.length;
    if (bytes.length > max) return out;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    out.b64 = btoa(bin);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{
 *   launchContext: () => Promise<{ context: import('playwright').BrowserContext, close: () => Promise<void> }>,
 *   username: string, password: string, login: (page: import('playwright').Page) => Promise<unknown>,
 *   guard?: ReturnType<typeof safety.createRunGuard>, minIntervalMs?: number, env?: NodeJS.ProcessEnv,
 *   log?: (event: object) => void, mode?: "json"|"deep",
 * }} opts
 */
async function createMontgomeryLiveTransport(opts) {
  const env = opts.env || process.env;
  if (env.PERMIT_SYNC_LIVE_PORTAL_APPROVED !== dcLive.LIVE_APPROVAL_VALUE) {
    throw new SafetyViolationError("live portal sessions are not approved (A-3)", { rule: "approval" });
  }
  if (!opts.username || !opts.password) throw new AuthError("credential is missing username or password");
  if (typeof opts.login !== "function") throw new AuthError("Montgomery transport needs the portal login");
  const mode = opts.mode || "json";
  const guard = opts.guard || safety.createRunGuard({ mode, tenant: MONTGOMERY });
  if (guard.mode !== mode) throw new SafetyViolationError(`guard mode ${guard.mode} does not match transport mode ${mode}`, { rule: "mode" });
  if (safety.tenantFor(guard.tenant).key !== MONTGOMERY.key) throw new SafetyViolationError("guard tenant is not Montgomery", { rule: "tenant" });
  const log = opts.log || (() => {});
  const throttle = dcLive.createThrottle(opts.minIntervalMs ?? 1500);
  const { context, close } = await opts.launchContext();

  let phase = "auth";
  let violation = null;
  let sessionEnded = false;
  let sessionEndedAt = null;
  let sessionId = null;
  let apiPage = null;
  let dashboard = null;
  const trail = [];
  /** ProjectID -> ProjectTemplateID from discovery (the Info partial needs it). */
  const templates = new Map();

  const remember = (entry) => {
    trail.push(entry);
    if (trail.length > TRAIL_MAX) trail.shift();
  };
  const markSessionEnded = (method, url, extra) => {
    sessionEnded = true;
    if (!sessionEndedAt) sessionEndedAt = dcLive.requestPoint(method, url, { match: dcLive.deadUrlMatch(url), phase, ...extra });
  };

  await context.route("**/*", async (route) => {
    const req = route.request();
    const r = { method: req.method(), url: req.url(), resourceType: req.resourceType() };
    if (phase === "auth") {
      const v = evaluateMontgomeryAuthRequest(r);
      if (!v.allowed) {
        violation = violation || dcLive.describeViolation(v, r);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    }
    const d = dcLive.routeReadRequest(r, guard);
    if (d.violation) violation = violation || dcLive.describeViolation(d, r);
    if (d.sessionEnded) markSessionEnded(r.method, r.url, { type: r.resourceType || null, via: "browser" });
    if (isTenantHost(hostOf(r.url)) && (["document", "xhr", "fetch", "other"].includes(r.resourceType) || d.action !== "continue")) {
      remember(dcLive.requestPoint(r.method, r.url, { type: r.resourceType || null, rule: d.rule, action: d.action }));
    }
    return d.action === "continue" ? route.continue() : route.abort("blockedbyclient");
  });

  function assertHealthy() {
    if (violation) throw new SafetyViolationError(dcLive.violationMessage(violation), violation);
    if (sessionEnded) throw new SessionEndedError(sessionEndedAt ? `portal session ended (${sessionEndedAt.match}: ${sessionEndedAt.method} ${sessionEndedAt.host}${sessionEndedAt.path})` : undefined);
  }

  const isOpen = (p) => Boolean(p) && !(typeof p.isClosed === "function" && p.isClosed());

  // context.request bypasses context.route; in deep mode the manual scraper may use it, so it is guarded here.
  if (mode === "deep" && context.request) {
    const api = context.request;
    for (const m of ["get", "head", "post", "put", "patch", "delete", "fetch"]) {
      const orig = api[m];
      if (typeof orig !== "function") continue;
      api[m] = async (target, options = {}) => {
        const url = typeof target === "string" ? target : target && typeof target.url === "function" ? target.url() : String(target);
        const method = m === "fetch" ? String((options && options.method) || "GET").toUpperCase() : m.toUpperCase();
        if (isTenantHost(hostOf(url)) && dcLive.isDeadUrl(url)) markSessionEnded(method, url, { type: "api_request", via: "context_request" });
        const v = guard.checkRequest(method, url);
        if (!v.allowed) {
          violation = violation || dcLive.describeViolation(v, { method, url });
          throw new SafetyViolationError(dcLive.violationMessage(violation), violation);
        }
        return orig.call(api, target, options);
      };
    }
  }

  async function settle(page, ms = 1000) {
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(ms);
  }

  async function pageState(page) {
    const info = await page.evaluate(() => ({
      text: document.body ? document.body.innerText.slice(0, 4000) : "",
      hasPasswordField: Boolean(document.querySelector('input[type="password"]')),
    })).catch(() => ({ text: "", hasPasswordField: false }));
    return classifyMontgomeryPage({ url: page.url(), ...info });
  }

  async function login() {
    const page = await context.newPage();
    dashboard = page;
    let failed = false;
    try {
      await opts.login(page, ENTRY_URL);
    } catch (_) {
      failed = true;
    }
    if (violation) assertHealthy();
    const state = await pageState(page);
    log({ code: "login_step", step: "montgomery_login", state, at: dcLive.loginLocation(page.url()) });
    if (state === "mfa") throw new MfaRequiredError();
    if (state === "captcha") throw new CaptchaError();
    if (state === "bad_credentials" || state === "locked") throw new AuthError(`portal login refused (${state})`);
    if (state !== "authenticated") throw new AuthError(`portal login ${failed ? "failed" : "did not reach the dashboard"} at ${dcLive.loginLocation(page.url())} (state ${state})`);
    log({ code: "login_ok" });
    phase = "read";
  }

  /** The portal Home page; reopened (cookies kept) when the manual scraper closed it. */
  async function getDashboard() {
    if (isOpen(dashboard)) return dashboard;
    dashboard = await context.newPage();
    await dashboard.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 45000 });
    await settle(dashboard);
    assertHealthy();
    const state = await pageState(dashboard);
    if (state !== "authenticated") throw new SessionEndedError(`dashboard reopen landed on ${dcLive.loginLocation(dashboard.url())} (${state})`);
    log({ code: "dashboard_reopened" });
    return dashboard;
  }

  async function ensureApiSession() {
    if (sessionId && isOpen(apiPage)) return;
    sessionId = null;
    apiPage = null;
    const dash = await getDashboard();
    const link = dash.locator("a", { hasText: "View All Projects" }).first();
    if ((await link.count()) === 0) throw new PortalChangedError("portal dashboard has no View All Projects link");
    const el = await link.evaluate((n) => ({
      tag: n.tagName.toLowerCase(), href: n.getAttribute("href"), onclick: n.getAttribute("onclick"), text: (n.textContent || "").trim().slice(0, 80), id: n.id || null,
    }));
    const v = evaluateViewAllClick(el);
    if (!v.allowed) throw new SafetyViolationError(`click refused (${v.rule})`, v);
    phase = "auth";
    let popup;
    try {
      await throttle();
      popup = await awaitPopupPage(context, () => link.click(), { timeout: 30000, label: "Montgomery WebUI hop popup" });
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        await popup.waitForLoadState("domcontentloaded").catch(() => {});
        const u = popup.url();
        if (dcLive.isDeadUrl(u)) throw new SessionEndedError("WebUI hop reached a dead session page");
        if (hostOf(u) === MONTGOMERY.webuiHost && !/\/webforms\/index\.aspx/i.test(u)) {
          const sid = await popup.evaluate(() => (window.Globals && window.Globals.Session && window.Globals.Session.SessionID) || null).catch(() => null);
          if (sid) break;
        }
        await popup.waitForTimeout(500);
      }
    } finally {
      phase = "read";
    }
    assertHealthy();
    sessionId = await popup.evaluate(() => (window.Globals && window.Globals.Session && window.Globals.Session.SessionID) || null);
    if (!sessionId || typeof sessionId !== "string") throw new PortalChangedError(`WebUI hop did not reach a session page (at ${dcLive.loginLocation(popup.url())})`);
    apiPage = popup;
    log({ code: "api_session_ok" });
  }

  /** One read-only GET through the WebUI page's own fetch (Sessionid header), as on DC (D-047). */
  async function pageGet(route, params, accept) {
    assertHealthy();
    await ensureApiSession();
    const url = buildTenantUrl(MONTGOMERY, route, params);
    const v = guard.checkRequest("GET", url);
    if (!v.allowed) throw new SafetyViolationError(`blocked ${route}: ${v.reason}`, v);
    await throttle();
    let res;
    try {
      res = await apiPage.evaluate(
        async ({ url: target, sid, accept: acceptType }) => {
          const r = await fetch(target, {
            method: "GET", credentials: "include", cache: "no-store",
            headers: { Sessionid: sid, Accept: acceptType, "X-Requested-With": "XMLHttpRequest" },
          });
          return { status: r.status, contentType: r.headers.get("content-type") || "", retryAfter: r.headers.get("retry-after") || "", finalUrl: r.url || "", text: await r.text() };
        },
        { url, sid: sessionId, accept },
      );
    } catch (e) {
      assertHealthy();
      throw new TransientError(`${route} request failed in the page (${String((e && e.name) || "error")})`);
    }
    assertHealthy();
    if (res.finalUrl && dcLive.isDeadUrl(res.finalUrl)) throw new SessionEndedError(`${route} ended on a session page`);
    const err = dcLive.errorForStatus(res.status, { "retry-after": res.retryAfter }, "");
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

  async function fetchPartial(route, params) {
    const res = await pageGet(route, params, "text/html, */*");
    if (!/html/i.test(res.contentType)) throw new PortalChangedError(`${route} did not return HTML`);
    return res.text;
  }

  function requireDeep(what) {
    if (mode !== "deep") throw new SafetyViolationError(`${what} is a deep-mode read`, { rule: "mode" });
  }

  /**
   * One RetrieveFile GET through the WebUI page's own fetch (Sessionid header, page cookies), the same way every
   * JSON read goes (pageGet, D-047). A context.request GET with the same session id got 401 for every file (live
   * run 2026-11-18 12:17). The browser request passes the context route guard as well as the check below.
   */
  async function retrieve(fileId, rendition, maxBytes) {
    const url = `${MONTGOMERY.apiOrigin}/File/RetrieveFile?${rendition ? "convertToPDF=true&inline=true&blackCADBackground=false" : "inline=true"}&fileID=${encodeURIComponent(String(fileId))}`;
    const v = guard.checkRequest("GET", url);
    if (!v.allowed) throw new SafetyViolationError(`blocked RetrieveFile: ${v.reason}`, v);
    await throttle();
    let res;
    try {
      res = await apiPage.evaluate(pageRetrieveFile, { target: url, sid: sessionId, max: maxBytes });
    } catch (e) {
      assertHealthy();
      throw new TransientError(`RetrieveFile request failed in the page (${String((e && e.name) || "error")})`);
    }
    assertHealthy();
    if (res.finalUrl && dcLive.isDeadUrl(res.finalUrl)) {
      markSessionEnded("GET", res.finalUrl, { type: "fetch", via: "retrieve_file" });
      assertHealthy();
    }
    // A refused file is a portal answer for that file (as for view-only files on DC), not a dead session; a session
    // that really ended is caught by the next page read or report open.
    if (res.status === 401 || res.status === 403) throw new PortalChangedError(`portal_refused_${res.status} (RetrieveFile)`);
    const err = dcLive.errorForStatus(res.status, { "retry-after": res.retryAfter }, "");
    if (err) {
      err.message = `${err.message} (RetrieveFile)`;
      throw err;
    }
    if (res.declared !== null && res.declared > maxBytes) throw new PortalChangedError(`file is ${res.declared} bytes, over the per-file limit`);
    if (res.b64 === null) throw new PortalChangedError(`file is ${res.size} bytes, over the per-file limit`);
    return { buf: Buffer.from(res.b64, "base64"), url, contentType: res.contentType };
  }

  /**
   * File body for the deep pass. A view-only file (folder DownloadFile false) is fetched as the PDF rendition the
   * file viewer shows (D-082); a downloadable one as the original first, then the rendition (D-084).
   */
  async function fetchFile(fileId, { viewerOnly = false, preferOriginal = true, maxBytes = 200 * 1024 * 1024 } = {}) {
    requireDeep("RetrieveFile");
    assertHealthy();
    await ensureApiSession();
    if (viewerOnly || !preferOriginal) return retrieve(fileId, true, maxBytes);
    try {
      return await retrieve(fileId, false, maxBytes);
    } catch (err) {
      if (err instanceof SafetyViolationError || err instanceof SessionEndedError) throw err;
      return retrieve(fileId, true, maxBytes);
    }
  }

  /**
   * Renders one report in the ReportViewer (new page, guarded like every page) and saves its SSRS exports through
   * the viewer's own control (ReportViewer1.exportReport), after the report has finished loading, with the SSRS
   * rs:Format GET of the same URL as the fallback (httpExport). The handle lookup and the body checks are the
   * shared pgc helpers.
   */
  async function exportReport({ url, dir, formats = ["EXCELOPENXML", "PDF"] }) {
    requireDeep("report export");
    assertHealthy();
    await ensureApiSession();
    const v = guard.checkRequest("GET", url);
    if (!v.allowed) throw new SafetyViolationError(`blocked report viewer: ${v.reason}`, v);
    const pgc = opts.reportExporter || require("../../../pgc-eplan-scraper");
    await throttle();
    const page = await context.newPage();
    const out = { excelPath: null, pdfPath: null, text: "", pages: null, error: null, method: "viewer_export" };
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      assertHealthy();
      if (dcLive.isDeadUrl(page.url())) throw new SessionEndedError("report viewer reached a dead session page");
      const handle = await pgc.waitForPgcReportViewerHandle(page, 45000);
      assertHealthy();
      if (!handle) {
        out.error = "viewer_not_ready";
        return out;
      }
      const loaded = await waitViewerLoaded(handle, 90000);
      const meta = await handle.frame.evaluate(() => {
        const body = document.body ? document.body.innerText : "";
        const m = body.match(/\b1\s+of\s+(\d{1,4})\b/);
        return { text: body.slice(0, 20000), pages: m ? Number(m[1]) : null };
      }).catch(() => ({ text: "", pages: null }));
      out.text = meta.text;
      out.pages = meta.pages;
      if (!loaded) {
        out.error = "viewer_still_loading";
        return out;
      }
      const errors = [];
      for (const fmt of formats) {
        const dest = path.join(dir, fmt === "PDF" ? "report.pdf" : "report.xlsx");
        let err = await viewerExport(page, handle, fmt, dest, pgc);
        assertHealthy();
        if (err) {
          const httpErr = await httpExport(url, fmt, dest, pgc);
          assertHealthy();
          err = httpErr ? `viewer ${err}, http ${httpErr}` : null;
          if (!err) out.method = "viewer_export+http_export";
        }
        if (err) errors.push(`${fmt}: ${err}`);
        else out[fmt === "PDF" ? "pdfPath" : "excelPath"] = dest;
      }
      if (errors.length) out.error = errors.join("; ");
      return out;
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** True once the viewer reports it is not loading (SSRS async rendering), false on timeout. */
  async function waitViewerLoaded(handle, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const loading = await handle.frame.evaluate((id) => {
        const rv = window.$find && window.$find(id);
        return rv && typeof rv.get_isLoading === "function" ? rv.get_isLoading() : false;
      }, handle.clientId).catch(() => true);
      if (!loading) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  /**
   * Fallback when the viewer control gives no download: the SSRS GET export of the same report URL (rs:Format),
   * through the guarded context.request. Its files are checked like the viewer's; the driver still fails a Review
   * Comments export whose grid has no rows. Null on success, else a short reason code.
   */
  async function httpExport(viewerUrl, fmt, dest, pgc) {
    const target = `${viewerUrl}${viewerUrl.includes("?") ? "&" : "?"}rs:Format=${encodeURIComponent(fmt)}`;
    const v = guard.checkRequest("GET", target);
    if (!v.allowed) throw new SafetyViolationError(`blocked report export: ${v.reason}`, v);
    await throttle();
    let res;
    try {
      res = await context.request.get(target, { timeout: 120000, failOnStatusCode: false, maxRedirects: 3 });
    } catch (e) {
      if (e instanceof SafetyViolationError) throw e;
      return "request_failed";
    }
    if (dcLive.isDeadUrl(res.url())) {
      markSessionEnded("GET", res.url(), { type: "api_request", via: "report_export" });
      assertHealthy();
    }
    if (res.status() >= 400) return `http_${res.status()}`;
    try {
      require("node:fs").writeFileSync(dest, Buffer.from(await res.body()));
    } catch (_) {
      return "save_failed";
    }
    const check = await pgc.pgcValidateReportExportFile(dest, fmt);
    if (check.ok) return null;
    require("node:fs").rmSync(dest, { force: true });
    return String(check.error || "invalid_export").slice(0, 60);
  }

  /** One export through the viewer control; null on success, else a short reason code. */
  async function viewerExport(page, handle, fmt, dest, pgc) {
    const download = page.waitForEvent("download", { timeout: 120000 });
    download.catch(() => {});
    try {
      await handle.frame.evaluate(({ id, f }) => {
        const rv = window.$find && window.$find(id);
        if (!rv || typeof rv.exportReport !== "function") throw new Error("export_control_missing");
        rv.exportReport(f);
      }, { id: handle.clientId, f: fmt });
    } catch (e) {
      if (/export_control_missing/.test(String(e && e.message))) return "export_control_missing";
      // Reason class only (no page text): a closed or navigated frame, or an error thrown by the viewer control.
      const msg = String((e && e.message) || "");
      const why = /closed|detached/i.test(msg) ? "frame_gone" : /navigat|context was destroyed/i.test(msg) ? "navigated" : /is not a function|undefined|null/i.test(msg) ? "control_error" : "other";
      return `export_call_failed_${why}`;
    }
    let d;
    try {
      d = await download;
    } catch (_) {
      return "no_download_event";
    }
    try {
      await d.saveAs(dest);
    } catch (_) {
      return "download_save_failed";
    }
    const check = await pgc.pgcValidateReportExportFile(dest, fmt);
    return check.ok ? null : String(check.error || "invalid_export").slice(0, 60);
  }

  await login();
  assertHealthy();

  return {
    guard,
    mode,
    tenant: MONTGOMERY,
    context,
    assertHealthy,
    diagnostics() {
      return { sessionEndedAt, trail: trail.slice() };
    },
    dashboardPage: getDashboard,
    adoptDashboard(page) {
      if (isOpen(page)) dashboard = page;
    },
    ownsPage(page) {
      return Boolean(page) && (page === dashboard || page === apiPage);
    },
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
    /** Projects grid JSON, PAGE_SIZE per page (20 projects on 2026-11-18, one page). */
    async listDashboardPage(n) {
      const data = await getJson("paged_active_projects", { pageIndex: Number(n) - 1, pageSize: PAGE_SIZE });
      const rows = mc.rowsFromPagedProjects(data);
      if (!rows || !Number.isInteger(data.TotalRowsCount)) throw new PortalChangedError("projects grid payload has no Items/TotalRowsCount");
      for (const r of rows) if (r.projectId && r.templateId) templates.set(r.projectId, r.templateId);
      // Template rows are dropped from the listing, so they do not count toward the expected total either.
      return { rows, totalRecords: data.TotalRowsCount - (data.Items.length - rows.length), pageSize: PAGE_SIZE };
    },
    getJson,
    /**
     * Montgomery records review comments in the Review Comments report, not in the corrections JSON (its
     * Corrections array was empty for permits whose report lists comments). An empty JSON read returns null so
     * the adapter reads the report; non-empty rows are used as on DC.
     */
    async getCorrectionsRows(projectId, wflowInstanceId) {
      if (!wflowInstanceId) return null;
      const data = await getJson("project_corrections_json", { wflowInstanceID: wflowInstanceId });
      const rows = mc.correctionRowsFromJson(data);
      return rows && rows.length ? rows : null;
    },
    /** One-page HTML report only; a longer report fails here and the deep pass reads its stored Excel export (D-103). */
    async getReviewCommentsReport(projectId, wflowInstanceId) {
      const html = await fetchPartial("review_comments_report", { ProjectID: projectId, WFlowInstanceID: wflowInstanceId, Timezone: "" });
      const parsed = await (await getDashboard()).evaluate(extractReviewCommentsReport, html);
      if (!parsed) throw new PortalChangedError("report page has no Review Comments table");
      if (parsed.totalPages !== 1) throw new PortalChangedError(`report has ${parsed.totalPages ?? "unknown"} pages`);
      return parsed.rows;
    },
    async getProjectInfo(projectId) {
      const templateId = templates.get(String(projectId));
      const html = await fetchPartial("project_info", templateId ? { ProjectID: projectId, ProjectTemplateID: templateId } : { ProjectID: projectId });
      const parsed = await (await getDashboard()).evaluate(extractProjectInfoFields, html);
      if (!parsed) throw new PortalChangedError("Info partial has no project info container");
      return parsed.values;
    },
    async listReports(projectId) {
      const list = await getJson("report_list", { projectId });
      if (!Array.isArray(list)) throw new PortalChangedError("report list is not an array");
      return mc.reportListItems(list);
    },
    fetchFile,
    exportReport,
    async close() {
      sessionId = null;
      apiPage = null;
      await close();
    },
  };
}

module.exports = {
  DASHBOARD_URL,
  ENTRY_URL,
  createMontgomeryLiveTransport,
  pageRetrieveFile,
  evaluateMontgomeryAuthRequest,
  classifyMontgomeryPage,
  evaluateViewAllClick,
};
