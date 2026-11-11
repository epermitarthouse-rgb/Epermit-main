"use strict";

/**
 * Child-process probe for the manual scraper closure (registerExecutionRoutes keeps timers and clients
 * open, so it is loaded here and the process exits explicitly). Prints one JSON line. Offline only:
 * Supabase points at a local fake PostgREST on 127.0.0.1, and the browser scenario serves its pages
 * from Playwright route handlers.
 *
 *   node dc-deep-closure-probe.js routes <module path>
 *   node dc-deep-closure-probe.js sync
 *   node dc-deep-closure-probe.js pager
 *   node dc-deep-closure-probe.js login409
 */

const http = require("node:http");
const path = require("node:path");

const KILL = ["ARLINGTON_DURABLE_WORKER_ENABLED", "UCI_DURABLE_WORKER_ENABLED", "UCI_GRAPH_INBOUND_POLLER_ENABLED", "UCI_LIFECYCLE_SCHEDULER_ENABLED"];

function load(modulePath, supabaseUrl = "http://127.0.0.1:9", { json = false } = {}) {
  process.env.SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "probe-key";
  for (const k of KILL) process.env[k] = "false";
  const express = require("express");
  const { registerExecutionRoutes } = require(modulePath);
  const app = express();
  if (json) app.use(express.json());
  const out = registerExecutionRoutes(app);
  return { app, out };
}

function routeList(app) {
  const routes = [];
  for (const l of (app.router || app._router).stack) {
    if (l.route) routes.push(`${Object.keys(l.route.methods).sort().join(",")} ${l.route.path}`);
    else if (l.name === "router" && l.handle.stack) {
      for (const s of l.handle.stack) if (s.route) routes.push(`sub ${Object.keys(s.route.methods).sort().join(",")} ${s.route.path}`);
    }
  }
  return routes;
}

const APP = path.join(__dirname, "..", "..", "app", "register-execution-routes.js");

/** Fake PostgREST: one existing project row; records every request (method + table + filter keys). */
function fakePostgrest(existing, tables = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      const table = u.pathname.replace(/^\/rest\/v1\//, "");
      const patch = req.method === "PATCH" && body ? JSON.parse(body) : null;
      requests.push({ method: req.method, table, filters: [...u.searchParams.keys()].filter((k) => k !== "select").sort(), ...(patch ? { patchKeys: Object.keys(patch).sort() } : {}) });
      res.setHeader("content-type", "application/json");
      if (table === "projects" && req.method === "GET") {
        const id = u.searchParams.get("id");
        return res.end(JSON.stringify(existing && id === `eq.${existing.id}` ? [existing] : []));
      }
      if (table === "projects" && req.method === "PATCH") {
        if (existing && tables.statefulProjects) Object.assign(existing, patch);
        return res.end(JSON.stringify(existing ? [{ id: existing.id, portal_data: patch.portal_data }] : []));
      }
      if (req.method === "GET" && tables[table]) return res.end(JSON.stringify(tables[table]));
      return res.end("[]");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests })));
}

async function syncScenario() {
  const existing = { id: "00000000-0000-4000-8000-0000000000a1", portal_data_hash: "old", portal_data: { tabs: {} }, address: null, jurisdiction: null };
  const pg = await fakePostgrest(existing);
  const { out } = load(APP, pg.url);
  const d = out.dcDeep;
  const session = () => ({ portalType: "projectdox", data: { 11105: { name: "B2407514", projectNum: "B2407514", portalType: "projectdox", tabs: { status: { keyValues: [], tables: [], links: [] } } } } });
  const project = { id: "11105", projectNum: "B2407514" };
  const deepOpts = { forbidInsert: true, skipCredentialRepoint: true };
  const results = {};
  const run = async (name, fn) => {
    const start = pg.requests.length;
    const ok = await fn();
    results[name] = { ok, requests: pg.requests.slice(start) };
  };
  await run("deep_missing_project", () => d.syncPortalDataToSupabase(session(), [project], "00000000-0000-4000-8000-0000000000ff", "u1", null, deepOpts));
  await run("deep_no_project_id", () => d.syncPortalDataToSupabase(session(), [project], null, "u1", null, deepOpts));
  await run("deep_linked_project", () => d.syncPortalDataToSupabase(session(), [project], existing.id, "u1", null, deepOpts));
  await run("manual_default", () => d.syncPortalDataToSupabase(session(), [project], existing.id, "u1", null));
  return { keys: Object.keys(d).sort(), results };
}

/**
 * D-072: the deep sync with contentHash against a stateful projects row. Each scrape stamps new volatile
 * fields (scrape time, signed/public URLs, temp paths, screenshots, SSRS render time, download outcome).
 */
async function contentHashScenario() {
  const PROJECT_ID = "00000000-0000-4000-8000-0000000000b1";
  const stamp = (n, { comments = 1 } = {}) => ({
    name: "B2407514", projectNum: "B2407514", portalType: "projectdox", scrapedAt: `2026-11-1${n}T10:00:00Z`,
    permitRepositorySync: { permit_id: "p1", section_hashes: { files: `h${n}` } },
    tabs: {
      status: { keyValues: [{ key: "Status", value: "Approved" }], tables: [], links: [] },
      files: { filesScrapeStatus: n % 2 ? "complete" : "in_progress", folders: [{ name: "Approved Drawings", files: [
        { fileId: "700101", name: "A-101.pdf", status: "Approved", commentCount: comments, viewUrl: `https://x.supabase.co/storage/v1/object/sign/permit-documents/a?token=t${n}`, downloadStatus: n % 2 ? "success" : "stored", storageRef: { bucket: "permit-documents", path: "p1/files/700101_A-101.pdf" } },
      ] }] },
      reports: { pdfs: [{ fileName: "Plan Review - Review Comments", text: `Comments\nGenerated:  11/1${n}/2026 10:4${n} AM\nRef 1 fix`, pages: 1, screenshot: `b64-${n}`, pdfPath: `/tmp/wa_report_${n}.pdf`, url: `https://webui.example/WebForms/ReportViewer.aspx?ReportID=14&ProjectID=11105&sessionid=s${n}` }] },
    },
  });
  const existing = { id: PROJECT_ID, portal_data_hash: "legacy-full-hash", portal_data: stamp(0), address: null, jurisdiction: null };
  const pg = await fakePostgrest(existing, { statefulProjects: true });
  const { out } = load(APP, pg.url);
  const d = out.dcDeep;
  const project = { id: "11105", projectNum: "B2407514" };
  const opts = { forbidInsert: true, skipCredentialRepoint: true, contentHash: true };
  const sync = async (data) => {
    const start = pg.requests.length;
    const ok = await d.syncPortalDataToSupabase({ portalType: "projectdox", data: { 11105: data } }, [project], PROJECT_ID, "u1", null, opts);
    return { ok, hash: existing.portal_data_hash, patches: pg.requests.slice(start).filter((r) => r.method === "PATCH").map((r) => r.patchKeys) };
  };
  const results = {};
  results.legacy_row_same_content = await sync(stamp(1));
  results.same_content_again = await sync(stamp(2));
  results.real_change = await sync(stamp(3, { comments: 2 }));
  results.after_change_volatile_only = await sync(stamp(4, { comments: 2 }));
  results.bookkeeping = existing.portal_data.permitRepositorySync;
  results.contentHashOfStamps = [stamp(5), stamp(6)].map((x) => require("../../lib/portal-content-hash").portalContentHash(x));
  return results;
}

const DASH = (page, total) => {
  const rows = [];
  for (let i = (page - 1) * 10 + 1; i <= Math.min(page * 10, total); i += 1) {
    rows.push(`<tr><td><a href="javascript:launchRemote('Project/Index?tab=projectStatusTab&ProjectID=${9000 + i}')">P${String(i).padStart(4, "0")}</a></td><td>Desc ${i}</td><td>Loc ${i}</td><td><span class="badge">Open</span></td><td>1</td></tr>`);
  }
  const pager = [1, 2, 3].map((n) => (n === page ? `<span>${n}</span>` : `<a href="javascript:goPage(${n})">${n}</a>`)).join(" ");
  return rows.join("") + `</table><div>${(page - 1) * 10 + 1} - ${Math.min(page * 10, total)} of ${total} records</div><div>${pager}</div><table>`;
};

async function pagerScenario() {
  const { out } = load(APP);
  const d = out.dcDeep;
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const total = 25;
    const pagesJson = JSON.stringify([1, 2, 3].map((n) => DASH(n, total)));
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("https://planreview.dob.dc.gov/")) {
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><body><table id="t">${DASH(1, total)}</table><script>
            const P = ${pagesJson};
            function goPage(n) { document.getElementById("t").innerHTML = P[n - 1]; }
            function launchRemote(p) { window.open("https://session.planreview.dob.dc.gov/" + p); }
          </script></body>`,
        });
      }
      if (url.startsWith("https://session.planreview.dob.dc.gov/Project/Index")) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>project</title>" });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto("https://planreview.dob.dc.gov/");
    const firstOnly = await d.collectDcPlanReviewDashboardProjects(page);
    await page.goto("https://planreview.dob.dc.gov/");
    const all = await d.collectDcPlanReviewDashboardProjects(page, { allPages: true });
    const target = all.find((p) => p.projectNum === "P0015");
    const session = { context, page, dcSessionOrigin: null };
    const popup = await d.openDcPlanReviewProjectPopup(session, target);
    return {
      firstOnly: firstOnly.map((p) => p.projectNum),
      all: all.map((p) => [p.projectNum, p.projectId, p.dashboardPage]),
      popupUrl: popup.url(),
      origin: session.dcSessionOrigin,
    };
  } finally {
    await browser.close();
  }
}

/** DC /api/login while an automated sync holds a live lease on the same login: 409 before any browser starts. */
async function login409Scenario() {
  const pg = await fakePostgrest(null, {
    portal_credentials: [{ id: "c1", jurisdiction: "Washington DC - ProjectDox" }],
    permit_sync_jobs: [{ id: "j1" }],
  });
  const { app } = load(APP, pg.url, { json: true });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "acct", password: "not-used", portalUrl: "https://washington-dc-us.avolvecloud.com" }),
  });
  server.close();
  return { status: res.status, body: await res.json(), requests: pg.requests.map((q) => `${q.method} ${q.table}`) };
}

async function main() {
  const [scenario, arg] = process.argv.slice(2);
  if (scenario === "routes") {
    const { app, out } = load(path.resolve(arg));
    return { routes: routeList(app), keys: Object.keys(out) };
  }
  if (scenario === "sync") return syncScenario();
  if (scenario === "contenthash") return contentHashScenario();
  if (scenario === "pager") return pagerScenario();
  if (scenario === "login409") return login409Scenario();
  throw new Error(`unknown scenario ${scenario}`);
}

main().then(
  (r) => { process.stdout.write(`\nPROBE_RESULT ${JSON.stringify(r)}\n`); setTimeout(() => process.exit(0), 50); },
  (e) => { process.stdout.write(`\nPROBE_ERROR ${JSON.stringify(String((e && e.stack) || e))}\n`); setTimeout(() => process.exit(1), 50); },
);
