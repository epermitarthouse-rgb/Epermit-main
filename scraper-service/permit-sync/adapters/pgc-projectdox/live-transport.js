"use strict";

/**
 * Live Playwright transport for Prince George's County ePlans. Same read contract as the DC and Montgomery
 * transports. Login, dashboard discovery and the project SSO hop call the existing manual scraper
 * (pgc-eplan-scraper.js). Observed logged in on 2026-11-23:
 *
 *   Dashboard  /Portal/Home/Index — My Projects, 10 rows per page. Project links are
 *              launchRemote('Frame.aspx?tab=projectStatusTab&ProjectID=<n>'). The red Open buttons are
 *              launchEForm(...autoAssignTask=true) and are never clicked.
 *   Project    /ProjectDoxWebUI/Project/Index. Tabs: Tasks, Files, Status, Info, Reports, Discuss, Reviews
 *              (Reviews is #correctionsTab).
 *   Reports    12 rows, including "Plan Review - Review Comments". The viewer is
 *              /ProjectDox/ReportViewer.aspx?ReportPath=/PDoxProdReportPGC/Plan Review - Review Comments.
 *
 * Auth phase allows the login form and the SSO hop. After that every request goes through the shared
 * read-only guard. No logout is clicked.
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
const { buildTenantUrl } = require("../dc-projectdox/routes");
const { extractProjectInfoFields, extractReviewCommentsReport } = require("../dc-projectdox/dom-extract");
const dcLive = require("../dc-projectdox/live-transport");
const { pageRetrieveFile } = require("../montgomery-projectdox/live-transport");
const { PGC } = require("../projectdox-tenants");
const pgcNorm = require("./normalize");

const DASHBOARD_URL = `${PGC.portalOrigin}/Portal/Home/Index`;
const ENTRY_URL = `${PGC.portalOrigin}/Portal/Login/Index/PGC-Prod`;
const TRAIL_MAX = 25;

const isTenantHost = (host) => PGC.hosts.includes(String(host || "").toLowerCase());
const hostOf = (url) => {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
};

function scraper() {
  return require("../../../pgc-eplan-scraper");
}

/** Auth-phase verdict: a deny-pattern request to the ePlans host is never part of a login. */
function evaluatePgcAuthRequest(req) {
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
  return { allowed: true, rule: "login_open", reason: "portal login and project SSO hop" };
}

/** Login page state from URL and visible text (text never logged). */
function classifyPgcPage({ url, text, hasPasswordField = false }) {
  const generic = dcLive.classifyLoginPage({ url: "about:blank", text, hasPasswordField: false });
  if (["mfa", "captcha", "locked", "bad_credentials"].includes(generic)) return generic;
  let u = null;
  try {
    u = new URL(String(url));
  } catch (_) {
    return "unknown";
  }
  if (dcLive.isDeadUrl(u.href) && !/\/Login\//i.test(u.pathname)) return "session_dead";
  if (isTenantHost(u.hostname) && !/\/Portal\/Login(\/|$)/i.test(u.pathname) && !hasPasswordField) return "authenticated";
  return hasPasswordField ? "login_form" : "unknown";
}

/**
 * @param {{
 *   launchContext: () => Promise<{ context: import('playwright').BrowserContext, close: () => Promise<void> }>,
 *   username: string, password: string, login: (page: import('playwright').Page, entryUrl: string) => Promise<unknown>,
 *   guard?: ReturnType<typeof safety.createRunGuard>, minIntervalMs?: number, env?: NodeJS.ProcessEnv,
 *   log?: (event: object) => void, mode?: "json"|"deep",
 * }} opts
 */
async function createPgcLiveTransport(opts) {
  const env = opts.env || process.env;
  if (env.PERMIT_SYNC_LIVE_PORTAL_APPROVED !== dcLive.LIVE_APPROVAL_VALUE) {
    throw new SafetyViolationError("live portal sessions are not approved (A-3)", { rule: "approval" });
  }
  if (!opts.username || !opts.password) throw new AuthError("credential is missing username or password");
  if (typeof opts.login !== "function") throw new AuthError("PGC transport needs the portal login");
  const mode = opts.mode || "json";
  const guard = opts.guard || safety.createRunGuard({ mode, tenant: PGC });
  if (guard.mode !== mode) throw new SafetyViolationError(`guard mode ${guard.mode} does not match transport mode ${mode}`, { rule: "mode" });
  if (safety.tenantFor(guard.tenant).key !== PGC.key) throw new SafetyViolationError("guard tenant is not PGC", { rule: "tenant" });
  const log = opts.log || (() => {});
  const throttle = dcLive.createThrottle(opts.minIntervalMs ?? 1500);
  const { context, close } = await opts.launchContext();
  const { withQuietConsole } = require("../../deep/runner");

  let phase = "auth";
  let violation = null;
  let sessionEnded = false;
  let sessionEndedAt = null;
  let sessionId = null;
  let apiPage = null;
  let dashboard = null;
  let discovered = null;
  const trail = [];

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
      const v = evaluatePgcAuthRequest(r);
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
    return classifyPgcPage({ url: page.url(), ...info });
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
    log({ code: "login_step", step: "pgc_login", state, at: dcLive.loginLocation(page.url()) });
    if (state === "mfa") throw new MfaRequiredError();
    if (state === "captcha") throw new CaptchaError();
    if (state === "bad_credentials" || state === "locked") throw new AuthError(`portal login refused (${state})`);
    if (state !== "authenticated") throw new AuthError(`portal login ${failed ? "failed" : "did not reach the dashboard"} at ${dcLive.loginLocation(page.url())} (state ${state})`);
    log({ code: "login_ok" });
    phase = "read";
  }

  async function getDashboard() {
    if (isOpen(dashboard) && /\/Portal\/Home\/Index/i.test(dashboard.url())) return dashboard;
    if (!isOpen(dashboard)) dashboard = await context.newPage();
    await dashboard.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await settle(dashboard);
    assertHealthy();
    const state = await pageState(dashboard);
    if (state !== "authenticated") throw new SessionEndedError(`dashboard reopen landed on ${dcLive.loginLocation(dashboard.url())} (${state})`);
    log({ code: "dashboard_reopened" });
    return dashboard;
  }

  /** All My Projects rows, via the manual grid walker. One task per project can list the project twice. */
  async function loadProjects() {
    if (discovered) return discovered;
    const dash = await getDashboard();
    const manual = scraper();
    const rows = await withQuietConsole(async () => {
      const pager = await manual.detectPaginationMode(dash);
      const collection = await manual.collectAllProjects(dash, {
        initialMode: pager.mode,
        viewAllVisible: pager.viewAllVisible,
      });
      return pgcNorm.rowsFromDashboard(collection && collection.projects);
    });
    if (!rows.length) throw new PortalChangedError("PGC project grid returned no projects");
    discovered = rows;
    return rows;
  }

  async function ensureApiSession() {
    if (sessionId !== null && isOpen(apiPage)) return;
    sessionId = null;
    apiPage = null;
    const rows = await loadProjects();
    const first = rows.find((r) => r.projectId && /^\d{1,12}$/.test(r.projectId));
    if (!first) throw new PortalChangedError("PGC project grid has no ProjectID");
    const dash = await getDashboard();
    const manual = scraper();
    phase = "auth";
    let opened;
    try {
      await throttle();
      opened = await withQuietConsole(() => manual.openProjectViaDashboardRow(dash, DASHBOARD_URL, first.projectId, { projectNumber: first.permit || "" }));
    } finally {
      phase = "read";
    }
    assertHealthy();
    if (!opened || !opened.ok) throw new PortalChangedError("project link did not open ProjectDox");
    const popup = opened.detailPage && isOpen(opened.detailPage) ? opened.detailPage : null;
    const page = popup || (isOpen(dash) ? dash : null);
    if (!page) throw new PortalChangedError("project open left no page");
    const deadline = Date.now() + 45000;
    let sid = null;
    while (Date.now() < deadline) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      if (dcLive.isDeadUrl(page.url())) throw new SessionEndedError("project open reached a dead session page");
      sid = await page.evaluate(() => (window.Globals && window.Globals.Session && window.Globals.Session.SessionID) || null).catch(() => null);
      if (sid || /ProjectID=/i.test(page.url())) break;
      await page.waitForTimeout(500);
    }
    if (!sid && !/ProjectID=/i.test(page.url())) throw new PortalChangedError(`project open did not reach a project page (at ${dcLive.loginLocation(page.url())})`);
    sessionId = sid || "";
    apiPage = page;
    log({ code: "api_session_ok" });
  }

  async function pageGet(route, params, accept) {
    assertHealthy();
    await ensureApiSession();
    const url = buildTenantUrl(PGC, route, params);
    const v = guard.checkRequest("GET", url);
    if (!v.allowed) throw new SafetyViolationError(`blocked ${route}: ${v.reason}`, v);
    await throttle();
    let res;
    try {
      res = await apiPage.evaluate(
        async ({ url: target, sid, accept: acceptType }) => {
          const headers = { Accept: acceptType, "X-Requested-With": "XMLHttpRequest" };
          if (sid) headers.Sessionid = sid;
          const r = await fetch(target, { method: "GET", credentials: "include", cache: "no-store", headers });
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
    if (!/html/i.test(res.contentType) && !/<html/i.test(res.text || "")) throw new PortalChangedError(`${route} did not return HTML`);
    return res.text;
  }

  function requireDeep(what) {
    if (mode !== "deep") throw new SafetyViolationError(`${what} is a deep-mode read`, { rule: "mode" });
  }

  async function retrieve(fileId, rendition, maxBytes) {
    const url = `${PGC.apiOrigin}${PGC.apiBasePath}/File/RetrieveFile?${rendition ? "convertToPDF=true&inline=true&blackCADBackground=false" : "inline=true"}&fileID=${encodeURIComponent(String(fileId))}`;
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

  /** One SSRS export through the viewer control. Null on success, else a short reason. */
  async function viewerExport(page, handle, fmt, dest, manual) {
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
      return "export_call_failed";
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
    const check = await manual.pgcValidateReportExportFile(dest, fmt);
    return check.ok ? null : String(check.error || "invalid_export").slice(0, 60);
  }

  async function exportReport({ url, dir, formats = ["EXCELOPENXML", "PDF"] }) {
    requireDeep("report export");
    assertHealthy();
    await ensureApiSession();
    const v = guard.checkRequest("GET", url);
    if (!v.allowed) throw new SafetyViolationError(`blocked report viewer: ${v.reason}`, v);
    const manual = scraper();
    await throttle();
    const page = await context.newPage();
    const out = { excelPath: null, pdfPath: null, text: "", pages: null, error: null, method: "viewer_export" };
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      assertHealthy();
      if (dcLive.isDeadUrl(page.url())) throw new SessionEndedError("report viewer reached a dead session page");
      const handle = await manual.waitForPgcReportViewerHandle(page, 45000);
      assertHealthy();
      if (!handle) {
        out.error = "viewer_not_ready";
        return out;
      }
      const meta = await handle.frame.evaluate(() => {
        const body = document.body ? document.body.innerText : "";
        const m = body.match(/\b1\s+of\s+(\d{1,4})\b/);
        return { text: body.slice(0, 20000), pages: m ? Number(m[1]) : null };
      }).catch(() => ({ text: "", pages: null }));
      out.text = meta.text;
      out.pages = meta.pages;
      const errors = [];
      for (const fmt of formats) {
        const dest = path.join(dir, fmt === "PDF" ? "report.pdf" : "report.xlsx");
        const err = await viewerExport(page, handle, fmt, dest, manual);
        assertHealthy();
        if (err) errors.push(`${fmt}: ${err}`);
        else out[fmt === "PDF" ? "pdfPath" : "excelPath"] = dest;
      }
      if (errors.length) out.error = errors.join("; ");
      return out;
    } finally {
      await page.close().catch(() => {});
    }
  }

  await login();
  assertHealthy();

  return {
    guard,
    mode,
    tenant: PGC,
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
    async listDashboardPage(n) {
      const rows = await loadProjects();
      const pageSize = rows.length;
      if (Number(n) !== 1) return { rows: [], totalRecords: rows.length, pageSize };
      return { rows, totalRecords: rows.length, pageSize };
    },
    getJson,
    async getCorrectionsRows(projectId, wflowInstanceId) {
      if (!wflowInstanceId) return null;
      const data = await getJson("project_corrections_json", { wflowInstanceID: wflowInstanceId, projectID: projectId });
      const rows = pgcNorm.correctionRowsFromJson(data);
      return rows && rows.length ? rows : null;
    },
    async getReviewCommentsReport(projectId, wflowInstanceId) {
      const html = await fetchPartial("review_comments_report", { ProjectID: projectId, WFlowInstanceID: wflowInstanceId, Timezone: "" });
      const parsed = await (await getDashboard()).evaluate(extractReviewCommentsReport, html);
      if (!parsed) throw new PortalChangedError("report page has no Review Comments table");
      if (parsed.totalPages !== 1) throw new PortalChangedError(`report has ${parsed.totalPages ?? "unknown"} pages`);
      return parsed.rows;
    },
    async getProjectInfo(projectId) {
      const html = await fetchPartial("project_info", { ProjectID: projectId });
      const parsed = await apiPage.evaluate(extractProjectInfoFields, html);
      if (!parsed) throw new PortalChangedError("Info partial has no project info container");
      return parsed.values;
    },
    async listReports(projectId) {
      const list = await getJson("report_list", { projectId });
      if (!Array.isArray(list)) throw new PortalChangedError("report list is not an array");
      return pgcNorm.reportListItems(list);
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
  createPgcLiveTransport,
  evaluatePgcAuthRequest,
  classifyPgcPage,
};
