"use strict";

/**
 * Montgomery ProjectDox Phase 0: one supervised, read-only route capture (approved 2026-11-18).
 *
 *   node scripts/permit-repo/montgomery/phase0-capture.js --i-have-approval [--project-ids 195963,200100,146267]
 *
 * Logs in once with the encrypted "Montgomery County MD - Avolve" credential (headed Chromium), opens the WebUI
 * projects grid and each tab of a few projects, and calls the read routes the DC adapter uses on the Montgomery
 * Web API host. Every browser request passes a read-only guard: after login only GET/HEAD to the four Montgomery
 * hosts, never a core/safety DENY_PATTERNS match (task actions, uploads, saves, Download Files, ApprovedPlans,
 * report export, SessionEnded, Logout). No file body, no export, no database write, nothing queued.
 *
 * Output (git-ignored): exports.local/montgomery-phase0-<ts>/summary.json (routes, status, shapes) and
 * payloads/<projectId>/*.json (raw JSON for local normalizer work; never committed). Cookies, the session id
 * and the password are never written.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const SCRAPER = path.join(ROOT, "scraper-service");
require(require.resolve("dotenv", { paths: [process.env.NODE_PATH || SCRAPER] })).config({ path: process.env.ENV_FILE || path.join(SCRAPER, ".env") });

const safety = require(path.join(SCRAPER, "permit-sync/core/safety"));
const { performMontgomeryPortalLogin } = require(path.join(SCRAPER, "scrapers/montgomery/portal-login"));
const { resolveStoredPortalPassword, looksLikeEncryptedEnvelope } = require(path.join(SCRAPER, "app/services/portal-credentials/portal-credentials-crypto"));

const CREDENTIAL_ID = "93857549-eb37-47cd-ad83-6701f835de66";
const PORTAL = "https://montgomeryco-md-us.avolvecloud.com";
const WEBUI = "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com";
const WEBAPI = "https://montgomeryco-md-us-projectdoxwebapi.avolvecloud.com";
const HOSTS = new Set([
  "montgomeryco-md-us.avolvecloud.com",
  "montgomeryco-md-us-projectdoxwebui.avolvecloud.com",
  "montgomeryco-md-us-projectdoxwebapi.avolvecloud.com",
  "montgomeryco-md-us-portalwebapi.avolvecloud.com",
]);
const TABS = ["tasksTab", "filesTab", "projectStatusTab", "projectInfoTab", "reportsTab", "discussionsTab"];
const KEEP_QUERY = new Set(["projectid", "tab", "folderid", "fileid", "entityid", "wflowinstanceid", "wflowtaskid", "reportid", "pageindex", "pagesize", "pagenumber", "rowcount", "listmode"]);
const STATIC = new Set(["stylesheet", "image", "font", "media", "script"]);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

function redact(url) {
  try {
    const u = new URL(url);
    const q = [...u.searchParams].map(([k, v]) => `${k}=${KEEP_QUERY.has(k.toLowerCase()) ? v : "*"}`);
    return `${u.host}${u.pathname}${q.length ? `?${q.join("&")}` : ""}`;
  } catch (_) {
    return "[unparseable]";
  }
}

/** Shape of a JSON value: keys and types, array lengths, first element only. No values. */
function shape(v, depth = 0) {
  if (depth > 4) return "…";
  if (Array.isArray(v)) return { array: v.length, of: v.length ? shape(v[0], depth + 1) : null };
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 60)) o[k] = shape(x, depth + 1);
    return o;
  }
  return v === null ? "null" : typeof v;
}

async function main() {
  if (!process.argv.includes("--i-have-approval")) {
    console.error("refusing: pass --i-have-approval (one supervised read-only capture)");
    process.exit(2);
  }
  const projectIds = (arg("--project-ids") || "195963,200100,146267").split(",").map((s) => s.trim()).filter((s) => /^\d{1,9}$/.test(s));
  const { createClient } = require(require.resolve("@supabase/supabase-js", { paths: [SCRAPER] }));
  const { chromium } = require(require.resolve("playwright", { paths: [SCRAPER] }));
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: cred, error } = await sb.from("portal_credentials").select("portal_username, portal_password, login_url").eq("id", CREDENTIAL_ID).single();
  if (error || !cred) throw new Error("credential not found");
  if (!looksLikeEncryptedEnvelope(cred.portal_password)) throw new Error("credential is not encrypted");
  const password = resolveStoredPortalPassword(cred.portal_password);

  const outDir = path.join(ROOT, "exports.local", `montgomery-phase0-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(path.join(outDir, "payloads"), { recursive: true });
  const summary = { started_at: new Date().toISOString(), credential: CREDENTIAL_ID.slice(0, 8), refused: [], dropped: [], requests: [], grid: null, projects: {}, api: {} };
  partial = () => fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ ...summary, partial: true }, null, 2));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: false });
  let phase = "auth";
  await context.route("**/*", async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = req.url();
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch (_) {}
    const denied = safety.matchesDenyPattern(url, "json", method);
    const exemptLogin = phase === "auth" && /\/Login\//i.test(url);
    if (denied && !exemptLogin) {
      summary.refused.push({ phase, method, url: redact(url) });
      return route.abort("blockedbyclient");
    }
    // CORS preflight for the page's own Web API calls (Sessionid header); carries no body.
    if (phase === "read" && !["GET", "HEAD"].includes(method) && !(method === "OPTIONS" && HOSTS.has(host))) {
      summary.dropped.push({ method, url: redact(url), type: req.resourceType() });
      return route.abort("blockedbyclient");
    }
    if (!HOSTS.has(host) && !(method === "GET" && STATIC.has(req.resourceType()))) {
      if (phase === "read") summary.dropped.push({ method, url: redact(url), type: req.resourceType(), off_host: true });
      return phase === "auth" ? route.continue() : route.abort("blockedbyclient");
    }
    return route.continue();
  });
  context.on("response", async (res) => {
    const req = res.request();
    const t = req.resourceType();
    if (!["xhr", "fetch", "document"].includes(t)) return;
    let host = "";
    try { host = new URL(res.url()).hostname.toLowerCase(); } catch (_) {}
    if (!HOSTS.has(host)) return;
    const entry = { phase, method: req.method(), type: t, url: redact(res.url()), status: res.status(), ct: (res.headers()["content-type"] || "").split(";")[0] };
    if (/json/i.test(entry.ct)) {
      try { entry.shape = shape(await res.json()); } catch (_) { entry.shape = "unparseable"; }
    }
    summary.requests.push(entry);
  });

  const page = await context.newPage();
  try {
    await performMontgomeryPortalLogin(page, cred.portal_username, password, cred.login_url || `${PORTAL}/ProjectDox/index.html`);
  } catch (e) {
    summary.login_error = String(e && e.message).slice(0, 200);
    throw e;
  }
  phase = "read";
  summary.login_ok_at = new Date().toISOString();
  await page.waitForTimeout(1500);
  summary.portal_dashboard = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll("table tr")).filter((tr) => tr.querySelector('a[href*="launchRemote"]')).length,
    view_all: Boolean(Array.from(document.querySelectorAll("a")).find((a) => /View All Projects/i.test(a.textContent || ""))),
  }));

  // WebUI session: the portal's own "View All Projects" link (the same /login/sso hop as a project link).
  // The hop form-POSTs the portal session to webui /webforms/index.aspx, so it runs under the auth phase (as DC's SSO hop does).
  const viewAll = page.locator("a", { hasText: "View All Projects" }).first();
  phase = "auth";
  const [webui] = await Promise.all([context.waitForEvent("page", { timeout: 30000 }), viewAll.click()]);
  await webui.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await webui.waitForTimeout(3000);
  phase = "read";
  summary.webui_landing = redact(webui.url());
  summary.grid = await webui.evaluate(() => {
    const label = Array.from(document.querySelectorAll("*")).map((e) => e.childElementCount === 0 ? (e.textContent || "").trim() : "").find((t) => /\d+\s*-\s*\d+ of \d+ records/i.test(t)) || null;
    const links = Array.from(document.querySelectorAll('a[href*="Project/Index?ProjectID="]')).filter((a) => !/tab=/i.test(a.getAttribute("href") || ""));
    return { label, firstPage: links.map((a) => ({ permit: (a.textContent || "").trim(), projectId: ((a.getAttribute("href") || "").match(/ProjectID=(\d+)/) || [])[1] })) };
  });
  const sid = await webui.evaluate(() => (window.Globals && window.Globals.Session && window.Globals.Session.SessionID) ? "present" : "absent");
  summary.globals_session = sid;
  summary.globals_keys = await webui.evaluate(() => Object.keys((window.Globals) || {}).slice(0, 40));
  summary.api_url = await webui.evaluate(() => (window.Globals && (window.Globals.ApiUrl || window.Globals.apiUrl)) || null);

  // The grid's own data call, read as JSON (all pages at once) through the page.
  async function pageGet(url) {
    return webui.evaluate(async (target) => {
      const sidv = window.Globals && window.Globals.Session && window.Globals.Session.SessionID;
      const r = await fetch(target, { method: "GET", credentials: "include", cache: "no-store", headers: { Sessionid: sidv || "", Accept: "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest" } });
      return { status: r.status, ct: r.headers.get("content-type") || "", text: await r.text() };
    }, url);
  }
  async function api(name, pathAndQuery, projectId) {
    const url = `${WEBAPI}${pathAndQuery}`;
    const v = safety.evaluateRequest({ method: "GET", url, hosts: [...HOSTS], allowlist: safety.DC_READ_ALLOW, mode: "json" });
    if (!v.allowed && v.rule === "deny_pattern") {
      summary.api[`${projectId || "_"}:${name}`] = { refused: v.reason };
      return null;
    }
    await webui.waitForTimeout(1200);
    let r;
    try {
      r = await pageGet(url);
    } catch (e) {
      summary.api[`${projectId || "_"}:${name}`] = { url: redact(url), error: String((e && e.message) || e).split("\n")[0].slice(0, 160) };
      return null;
    }
    let json = null;
    if (/json/i.test(r.ct)) { try { json = JSON.parse(r.text); } catch (_) {} }
    summary.api[`${projectId || "_"}:${name}`] = { url: redact(url), status: r.status, ct: r.ct.split(";")[0], shape: json ? shape(json) : null, bytes: r.text.length };
    if (json && projectId) fs.writeFileSync(path.join(outDir, "payloads", String(projectId), `${name}.json`), JSON.stringify(json, null, 2));
    if (json && !projectId) fs.writeFileSync(path.join(outDir, "payloads", `${name}.json`), JSON.stringify(json, null, 2));
    return json;
  }

  await api("paged_active_projects", "/Project/GetPagedActiveProjects?pageIndex=0&pageSize=50", null);

  for (const pid of projectIds) {
    fs.mkdirSync(path.join(outDir, "payloads", pid), { recursive: true });
    const proj = { tabs: {} };
    for (const tab of TABS) {
      await webui.goto(`${WEBUI}/Project/Index?ProjectID=${pid}&tab=${tab}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await webui.waitForTimeout(2500);
      proj.tabs[tab] = await webui.evaluate((tabId) => {
        const panel = document.getElementById(tabId) || document.body;
        const heads = Array.from(panel.querySelectorAll("th")).map((th) => (th.textContent || "").trim()).filter(Boolean).slice(0, 30);
        const rows = panel.querySelectorAll("tbody tr").length;
        const selects = Array.from(panel.querySelectorAll("select")).map((s) => ({ name: s.id || s.name || null, options: Array.from(s.options).map((o) => (o.textContent || "").trim()).slice(0, 20) }));
        const tree = Array.from(panel.querySelectorAll(".k-treeview .k-in, [role=treeitem]")).map((n) => (n.textContent || "").trim()).filter(Boolean).slice(0, 40);
        const labels = Array.from(panel.querySelectorAll("label, .label, dt, td.label")).map((l) => (l.textContent || "").trim()).filter(Boolean).slice(0, 40);
        return { heads, rows, selects, tree, labels, text_len: (panel.innerText || "").length };
      }, tab);
    }
    proj.title = await webui.title();
    summary.projects[pid] = proj;

    const wf = await api("workflow_instances_list", `/WorkflowAggregate/GetWorkflowInstancesList?entityID=${pid}&WFlowStateName=&entityTypeID=1&checkForRevCoordPerm=true&pageNumber=0&rowCount=50&pk=WFlowInstanceID`, pid);
    const recs = (wf && wf.Records) || [];
    const wfi = recs[0] && recs[0].WFlowInstanceID;
    await api("active_task_list", `/WorkflowAggregate/GetActiveWorkflowTaskList?projectID=${pid}&wflowActivityID=&onlyActiveTaskStatus=true&showTasksForAllUsers=false&pk=WFlowTaskID`, pid);
    const folders = await api("project_folders", `/Folder/GetProjectFolders?projectID=${pid}&folderID=`, pid);
    const flist = Array.isArray(folders) ? folders : (folders && folders.folders) || [];
    for (const f of flist.slice(0, 12)) {
      if (f && f.FolderID !== undefined && f.FolderID !== null) {
        await api(`folder_files_${f.FolderID}`, `/File/GetFolderFiles?folderID=${f.FolderID}&projectID=${pid}&listMode=3&pageIndex=0&pageSize=500&pk=FileID`, pid);
      }
    }
    await api("report_list", `/Report/GetReportList?projectId=${pid}&assignedToProjectOnly=true&reportTypes=1&reportTypes=10&reportTypes=11`, pid);
    for (const r of recs.slice(0, 4)) {
      const id = r.WFlowInstanceID;
      await api(`workflow_status_${id}`, `/WorkflowInstance/GetWorkflowInstanceStatusData?wflowInstanceID=${id}`, pid);
      await api(`corrections_${id}`, `/WorkflowAggregate/GetProjectCorrectionsByCycleInstance?wflowInstanceID=${id}&wflowTaskID=&wflowActivityID=&groupID=&wflowReviewCycleID=&retrieveFilterOptions=true`, pid);
    }
    if (wfi) {
      // Render-only GET of the Review Comments report (no export); records whether the HTML holds the table.
      const rpt = `${WEBUI}/WebForms/ReportViewer.aspx?ReportID=133&ReportPath=${encodeURIComponent("/MontgomeryCountyProd/ProjectDox/Plan Review - Review Comments")}&DataSourceName=DataSource1&ProjectID=${pid}&WFlowInstanceID=${wfi}&Timezone=`;
      await webui.waitForTimeout(1200);
      const r = await webui.evaluate(async (target) => {
        const res = await fetch(target, { credentials: "include", cache: "no-store" });
        const t = await res.text();
        return { status: res.status, bytes: t.length, hasTable: /<table/i.test(t), pages: (t.match(/of\s*<span[^>]*>\s*(\d+)/i) || t.match(/TotalPages[^\d]*(\d+)/i) || [])[1] || null, comments: (t.match(/Comment/gi) || []).length };
      }, rpt);
      summary.api[`${pid}:review_comments_report_render`] = r;
    }
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  }

  summary.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`capture written: ${path.relative(ROOT, outDir)} (requests ${summary.requests.length}, refused ${summary.refused.length}, dropped ${summary.dropped.length})`);
  await context.close();
  await browser.close();
}

let partial = null;
main().catch((e) => {
  console.error(`[phase0] failed: ${String((e && e.message) || e).slice(0, 300)}`);
  if (partial) partial();
  process.exit(1);
});
