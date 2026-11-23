"use strict";

/**
 * Montgomery County MD ProjectDox adapter (MONTGOMERY_CAPABILITY_MAP.md): tenant guard, routes, normalizers,
 * the shared adapter over a synthetic Montgomery portal, the transport's pure policies, the worker registry and
 * the per-portal login lock. DC behaviour is covered by the existing suites and asserted unchanged here where
 * the shared code was generalized.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const safety = require("../permit-sync/core/safety");
const { DC, MONTGOMERY, tenantFor } = require("../permit-sync/adapters/projectdox-tenants");
const { buildDcUrl, buildTenantUrl } = require("../permit-sync/adapters/dc-projectdox/routes");
const mc = require("../permit-sync/adapters/montgomery-projectdox/normalize");
const { createMontgomeryAdapter } = require("../permit-sync/adapters/montgomery-projectdox/adapter");
const live = require("../permit-sync/adapters/montgomery-projectdox/live-transport");
const dcLive = require("../permit-sync/adapters/dc-projectdox/live-transport");
const { buildBatch, buildDiscovery } = require("../permit-sync/core/ingest");
const worker = require("../permit-sync/worker-entry");
const lock = require("../lib/dc-credential-lock");
const { createMontgomeryFixtureTransport } = require("./helpers/montgomery-fixture-transport");

const API = MONTGOMERY.apiOrigin;
const UI = MONTGOMERY.uiOrigin;
const PORTAL = MONTGOMERY.portalOrigin;

// --- guard -------------------------------------------------------------------------------------------------

test("DC guard policy is unchanged by the tenant generalization", () => {
  assert.deepEqual([...safety.MODES.json.openHosts], ["planreview.dob.dc.gov", "session.planreview.dob.dc.gov", "washington-dc-us-projectdoxwebapi.avolvecloud.com"]);
  assert.deepEqual([...safety.MODES.deep.openHosts], [...safety.MODES.json.openHosts, "washington-dc-us-projectdoxwebui.avolvecloud.com"]);
  assert.equal(safety.modePolicy("json"), safety.MODES.json);
  assert.equal(safety.modePolicy("deep", "dc-projectdox"), safety.MODES.deep);
  assert.equal(safety.createRunGuard().tenant.key, DC.key);
  assert.equal(safety.evaluateRequest({ url: `${API}/Folder/GetProjectFolders?projectID=1` }).rule, "host", "a DC guard refuses Montgomery hosts");
  assert.equal(safety.evaluateRequest({ url: "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/Project/GetPagedActiveProjects" }).allowed, true, "open DC API host");
});

test("Montgomery guard: shared routes and the projects grid call on Montgomery hosts only", () => {
  const g = safety.createRunGuard({ tenant: MONTGOMERY });
  const ok = (url) => g.checkRequest("GET", url);
  assert.equal(ok(`${API}/Project/GetPagedActiveProjects?pageIndex=0&pageSize=100`).rule, "paged_active_projects");
  assert.equal(ok(`${API}/WorkflowAggregate/GetWorkflowInstancesList?entityID=900001`).rule, "workflow_instances_list");
  assert.equal(ok(`${API}/File/GetFolderFiles?folderID=1&projectID=2`).rule, "folder_files");
  assert.equal(ok(`${UI}/WebForms/ReportViewer.aspx?ReportID=133`).rule, "review_comments_report");
  assert.equal(ok(`${UI}/Project/Index?ProjectID=900001&tab=filesTab`).rule, "project_page");
  assert.equal(ok(`${PORTAL}/Home/Index`).rule, "portal_page_read");
  assert.equal(ok("https://session.planreview.dob.dc.gov/Project/Index?ProjectID=1").rule, "host", "DC hosts are off the Montgomery allowlist");
  assert.equal(ok(`${MONTGOMERY.portalOrigin.replace("https", "http")}/Home/Index`).rule, "scheme");
  assert.equal(ok("https://montgomeryco-md-us-portalwebapi.avolvecloud.com/User/Profile").rule, "not_allowlisted", "portalwebapi is not an open host");
});

test("Montgomery guard keeps every mutation deny, in both modes", () => {
  for (const mode of ["json", "deep"]) {
    const g = safety.createRunGuard({ tenant: MONTGOMERY, mode });
    for (const url of [
      `${PORTAL}/Project/ApprovedPlans?ProjectID=900001`,
      `${UI}/WebForms/SessionEnded.aspx`,
      `${UI}/Workflow/AcceptTask?taskId=1`,
      `${API}/File/Upload?folderID=1`,
      `${UI}/WebForms/Eform.aspx?x=1`,
      `${PORTAL}/Home/Download Files?ProjectID=1`,
    ]) {
      assert.equal(g.checkRequest("GET", url).rule, "deny_pattern", `${mode}: ${url}`);
    }
    assert.equal(g.checkRequest("POST", `${API}/Folder/GetProjectFolders?projectID=1`).rule, "method");
  }
  const json = safety.createRunGuard({ tenant: MONTGOMERY });
  assert.equal(json.checkRequest("GET", `${UI}/Reserved.ReportViewerWebControl.axd?OpType=Export&Format=EXCELOPENXML`).rule, "deny_pattern", "report export stays a deep-mode read");
});

test("deep mode: report identity exemption on the Montgomery report host, keepalive on its portal API host", () => {
  const deep = safety.createRunGuard({ tenant: MONTGOMERY, mode: "deep" });
  const viewer = `${UI}/WebForms/ReportViewer.aspx?ReportID=133&ReportPath=/MontgomeryCountyProd/ProjectDox/Plan Review - Review Comments&DataSourceName=DataSource1&ProjectID=900001`;
  assert.equal(deep.checkRequest("GET", viewer).allowed, true);
  assert.equal(deep.checkRequest("GET", "https://montgomeryco-md-us-portalwebapi.avolvecloud.com/User/GetSessionTimeout").rule, "session_timeout_keepalive");
  assert.equal(safety.createRunGuard({ tenant: MONTGOMERY }).checkRequest("GET", "https://montgomeryco-md-us-portalwebapi.avolvecloud.com/User/GetSessionTimeout").allowed, false, "json mode: no keepalive exemption");
  assert.equal(safety.evaluateRequest({ url: "https://montgomeryco-md-us-portalwebapi.avolvecloud.com/User/GetSessionTimeout", mode: "deep" }).rule, "host", "DC guard: not a DC host");
  assert.equal(deep.checkRequest("GET", `${UI}/File/ViewFile?fileID=1`).allowed, true, "viewer reads are deep-mode reads on the WebUI host");
});

test("unknown tenant keys are refused", () => {
  assert.throws(() => tenantFor("not-a-tenant"), /unknown ProjectDox tenant/);
  assert.throws(() => safety.createRunGuard({ tenant: "nope" }), /unknown ProjectDox tenant/);
});

// --- routes ------------------------------------------------------------------------------------------------

test("tenant URLs: Montgomery origins and the Review Comments report identity (ReportID 133)", () => {
  assert.equal(buildTenantUrl(MONTGOMERY, "project_folders", { projectID: 900001 }), `${API}/Folder/GetProjectFolders?folderID=&projectID=900001`);
  const rep = new URL(buildTenantUrl(MONTGOMERY, "review_comments_report", { ProjectID: 900001, WFlowInstanceID: 61001, Timezone: "" }));
  assert.equal(rep.origin, UI);
  assert.equal(rep.searchParams.get("ReportID"), "133");
  assert.equal(rep.searchParams.get("ReportPath"), "/MontgomeryCountyProd/ProjectDox/Plan Review - Review Comments");
  assert.equal(new URL(buildTenantUrl(MONTGOMERY, "paged_active_projects", {})).search, "?pageIndex=0&pageSize=100");
  assert.equal(buildTenantUrl(DC, "review_comments_report", { ProjectID: 1 }), buildDcUrl("review_comments_report", { ProjectID: 1 }), "DC URLs unchanged");
});

// --- normalizers -------------------------------------------------------------------------------------------

test("normalize: grid rows, permit-number identity, Montgomery statuses", () => {
  const rows = mc.rowsFromPagedProjects({ Items: [
    { ProjectID: 1, Name: "COMBUILD-1154415", Status: "Decision Issued", ProjectTemplateID: 44, Address1: "1 A St", City: "Rockville", State: "MD", PostalCode: "20850" },
    { ProjectID: 2, Name: "x", IsProjectTemplate: true },
  ], TotalRowsCount: 2 });
  assert.deepEqual(rows.map((r) => [r.permit, r.projectId, r.templateId, r.address]), [["COMBUILD-1154415", "1", "44", "1 A St, Rockville, MD, 20850"]]);
  assert.equal(mc.rowsFromPagedProjects({}), null);

  const rec = mc.discoveryRecord({ permit: "sign-1159714", projectId: "200100", status: "PreApproval Corrections" });
  assert.equal(rec.portal_record_id, "200100");
  assert.deepEqual(
    { j: rec.fields.jurisdiction, p: rec.fields.permit_number, n: rec.fields.permit_number_normalized, s: rec.fields.status, raw: rec.fields.status_raw },
    { j: "Montgomery County MD", p: "SIGN-1159714", n: "SIGN1159714", s: "resubmit", raw: "PreApproval Corrections" },
  );
  for (const bad of ["Mont test", "B2600602", "COM-00333-2026", "COMM 1140088", ""]) {
    assert.throws(() => mc.discoveryRecord({ permit: bad, projectId: "5" }), /permit number/, bad);
  }
  assert.throws(() => mc.discoveryRecord({ permit: "COMBUILD-1", projectId: null }), /ProjectID/);
  assert.deepEqual(["Pending Upload", "Approved", "Decision Issued", "In Review", null].map(mc.mapStatus), ["upload", "approved", "other", "in_review", null]);
  assert.equal(mc.statusFields({ ProjectStatus: "PreApproval Corrections", SubWorkflows: null, UncompleteTaskCount: 0 }).status, "resubmit");
  assert.equal(mc.ADAPTER_KEY, "montgomery-projectdox");
  assert.equal(mc.fileItems, require("../permit-sync/adapters/dc-projectdox/normalize").fileItems, "section normalizers are the shared ones");
});

// --- adapter over the synthetic portal ---------------------------------------------------------------------

test("adapter: discovery lists portal permits only and reports the skipped row", async () => {
  const t = createMontgomeryFixtureTransport();
  const a = createMontgomeryAdapter({ transport: t });
  assert.equal(a.key, "montgomery-projectdox");
  const d = await a.discover();
  assert.deepEqual(d.records.map((r) => r.portal_record_id), ["900001", "900002", "900003"]);
  assert.deepEqual(d.skipped, ["Mont test"]);
  assert.equal(d.complete, false, "a skipped row makes discovery incomplete, so nothing is marked removed");
  const disc = buildDiscovery({ adapterKey: a.key, records: d.records, expectedTotal: d.expectedTotal, complete: d.complete });
  assert.equal(disc.complete, false);
  assert.ok(t.requests.every((r) => r.allowed));
});

test("adapter: Decision Issued permit — workflow, status, versions, reviews from the report", async () => {
  const t = createMontgomeryFixtureTransport();
  const a = createMontgomeryAdapter({ transport: t });
  await a.discover();
  const { sections } = await a.fetchPermit({ portal_record_id: "900001" });
  assert.equal(sections.workflows.status, "ok");
  assert.equal(sections.status.fields.status, "other");
  assert.equal(sections.status.fields.status_raw, "Decision Issued");
  assert.equal(sections.files.status, "ok");
  const docs = sections.files.tables.permit_documents;
  assert.deepEqual(docs.map((d) => [d.key, d.fields.version, d.fields.download_permitted]), [["7001", 1, false], ["7002", 2, false], ["7003", 1, true]]);
  assert.equal(sections.reviews.status, "ok");
  assert.equal(sections.reviews.sourceKind, "report", "empty corrections JSON -> the Review Comments report");
  assert.deepEqual(sections.reviews.tables.permit_review_comments.map((c) => [c.key, c.fields.department, c.fields.response_required]), [["ref:1", "Building", true], ["ref:2", "Zoning", false]]);
  assert.equal(sections.reviews.tables.permit_review_responses.length, 1);
  assert.equal(sections.reports.tables.permit_reports.length, 2);
  assert.equal(sections.info.status, "ok");
  const infoReq = t.requests.find((r) => r.route === "project_info");
  assert.equal(new URL(infoReq.url).searchParams.get("ProjectTemplateID"), "44", "Info partial uses the project's own template");

  const { batch, warnings } = buildBatch({ adapterKey: a.key, portalRecordId: "900001", permitFields: { permit_number: "COMBUILD-1000001" }, sections });
  assert.equal(batch.adapter_key, "montgomery-projectdox");
  assert.deepEqual(warnings, []);
  assert.deepEqual(batch.permit.fields.available_sections, ["files", "info", "reports", "reviews", "status", "tasks", "workflows"]);
  assert.ok(t.requests.every((r) => r.allowed), "every read passed the Montgomery guard");
});

test("adapter: permit without a workflow has no reviews (absent), files still read", async () => {
  const a = createMontgomeryAdapter({ transport: createMontgomeryFixtureTransport() });
  await a.discover();
  const { sections } = await a.fetchPermit({ portal_record_id: "900002" });
  assert.equal(sections.workflows.confirmedEmpty, true);
  assert.equal(sections.status.status, "absent");
  assert.equal(sections.reviews.status, "absent");
  assert.equal(sections.files.tables.permit_documents.length, 1);
  assert.equal(sections.files.tables.permit_document_folders[0].key, "1244443", "folder ids repeat across projects; identity is per permit");
});

test("adapter: a multi-page report fails the reviews section (deep export needed), other sections ok", async () => {
  const a = createMontgomeryAdapter({ transport: createMontgomeryFixtureTransport({ multiPageReport: new Set(["900001"]) }) });
  await a.discover();
  const { sections } = await a.fetchPermit({ portal_record_id: "900001" });
  assert.equal(sections.reviews.status, "failed");
  assert.match(sections.reviews.error, /portal_changed: report has 8 pages/);
  assert.equal(sections.files.status, "ok");
});

// --- transport policies (pure) -----------------------------------------------------------------------------

test("auth policy: login and WebUI hop pass; deny patterns on Montgomery hosts never do", () => {
  const ok = (method, url) => live.evaluateMontgomeryAuthRequest({ method, url }).allowed;
  assert.equal(ok("GET", `${PORTAL}/Login/SessionEnded`), true, "login redirects through /Login/SessionEnded");
  assert.equal(ok("POST", "https://montgomeryco-md-us-portalwebapi.avolvecloud.com/User/Login"), true);
  assert.equal(ok("POST", `${UI}/webforms/index.aspx`), true, "the WebUI session hop");
  assert.equal(ok("GET", `${PORTAL}/Project/ApprovedPlans?ProjectID=1`), false);
  assert.equal(ok("GET", `${UI}/Workflow/AcceptTask?x=1`), false);
  assert.equal(ok("GET", "notaurl"), false);
});

test("read policy (shared router) with the Montgomery guard", () => {
  const g = safety.createRunGuard({ tenant: MONTGOMERY });
  const r = (method, url, resourceType = "xhr") => dcLive.routeReadRequest({ method, url, resourceType }, g);
  assert.equal(r("GET", `${API}/Project/GetPagedActiveProjects?pageIndex=0`).action, "continue");
  assert.equal(r("POST", `${UI}/Project/SomethingHarmless`).rule, "method_dropped");
  assert.equal(r("GET", `${UI}/WebForms/SessionEnded.aspx`, "document").sessionEnded, true);
  assert.equal(r("GET", `${PORTAL}/Project/ApprovedPlans?ProjectID=1`, "document").violation, true);
  assert.equal(r("GET", "https://session.planreview.dob.dc.gov/Project/Index", "document").rule, "off_host");
  const dc = dcLive.routeReadRequest({ method: "GET", url: `${API}/Folder/GetProjectFolders`, resourceType: "xhr" }, safety.createRunGuard());
  assert.equal(dc.rule, "off_host", "a DC guard still treats Montgomery as off-host");
});

test("login page classification and the View All Projects click rule", () => {
  assert.equal(live.classifyMontgomeryPage({ url: `${PORTAL}/Home/Index`, text: "My Projects" }), "authenticated");
  assert.equal(live.classifyMontgomeryPage({ url: `${PORTAL}/Login/Index/MontgomeryDPS-Prod`, text: "Sign in", hasPasswordField: true }), "login_form");
  assert.equal(live.classifyMontgomeryPage({ url: `${PORTAL}/Login/Index/MontgomeryDPS-Prod`, text: "Invalid username or password", hasPasswordField: true }), "bad_credentials");
  assert.equal(live.classifyMontgomeryPage({ url: `${PORTAL}/Login/Index/MontgomeryDPS-Prod`, text: "Enter the verification code we sent" }), "mfa");
  assert.equal(live.classifyMontgomeryPage({ url: `${UI}/WebForms/SessionEnded.aspx`, text: "" }), "session_dead");

  assert.equal(live.evaluateViewAllClick({ tag: "a", href: "Home/Index?t=1#", text: "View All Projects" }).allowed, true);
  assert.equal(live.evaluateViewAllClick({ tag: "a", href: "#", onclick: "launchEForm('x')", text: "View All Projects" }).rule, "deny_pattern");
  assert.equal(live.evaluateViewAllClick({ tag: "a", href: "#", text: "Download Files" }).rule, "not_view_all");
  assert.equal(live.evaluateViewAllClick({ tag: "button", text: "View All Projects" }).rule, "not_view_all");
});

test("live transport refuses to start without approval A-3 or without the portal login", async () => {
  const base = { launchContext: async () => { throw new Error("must not launch"); }, username: "u", password: "p" };
  await assert.rejects(live.createMontgomeryLiveTransport({ ...base, env: {} }), /not approved/);
  await assert.rejects(live.createMontgomeryLiveTransport({ ...base, env: { PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3" } }), /needs the portal login/);
  await assert.rejects(
    live.createMontgomeryLiveTransport({ ...base, login: async () => {}, guard: safety.createRunGuard(), env: { PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3" } }),
    /guard tenant is not Montgomery/,
  );
});

// --- worker registry ---------------------------------------------------------------------------------------

function fakeSupabase({ password = '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', loginUrl = null, settings = {} } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, cols: null };
      const chain = {
        select(cols) { q.cols = cols; return chain; },
        eq() { return chain; },
        async single() {
          calls.push(q);
          if (table === "portal_credentials") return { data: { portal_username: "acct", portal_password: password, login_url: loginUrl }, error: null };
          if (table === "permit_sync_sources") return { data: { settings }, error: null };
          return { data: null, error: { message: "unexpected" } };
        },
      };
      return chain;
    },
  };
}

test("worker: a Montgomery job opens the Montgomery transport, lock and login; deep mode adds the Montgomery deep driver", async () => {
  process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
  const enc = require("../app/services/portal-credentials/portal-credentials-crypto").encryptPortalPassword("secret");
  for (const mode of ["json", "deep"]) {
    const sb = fakeSupabase({ password: enc, loginUrl: "https://evil.example/login" });
    const locks = [];
    const made = [];
    const deepCalls = [];
    const fakeTransport = { close: async () => {}, fetchFile: async () => {}, exportReport: async () => {} };
    const open = worker.buildOpenAdapter({
      supabase: sb,
      env: { PERMIT_SYNC_MODE: mode },
      launchContext: async () => ({}),
      lock: async (a) => { locks.push(a.portal); },
      createTransport: async () => { throw new Error("DC transport must not be used"); },
      createMontgomeryTransport: async (o) => { made.push({ mode: o.mode, hasLogin: typeof o.login === "function" }); return fakeTransport; },
      loadDcDeep: () => { throw new Error("no DC deep scraper for Montgomery"); },
      createDeepPass: (d) => {
        deepCalls.push({ tenant: d.tenant && d.tenant.key, transport: d.transport === fakeTransport, driver: typeof d.dcDeep.scrapeAll, credentialId: d.credentialId });
        return { wrapTransport: (t) => t, afterPermit: async () => ({}) };
      },
    });
    const s = await open({ adapter_key: "montgomery-projectdox", credential_id: "c1" });
    assert.equal(s.adapter.key, "montgomery-projectdox");
    assert.deepEqual(locks, ["montgomery"]);
    assert.deepEqual(made, [{ mode, hasLogin: true }]);
    assert.equal(sb.calls[0].cols, "portal_username, portal_password, login_url");
    if (mode === "deep") {
      assert.equal(typeof s.afterPermit, "function");
      assert.deepEqual(deepCalls, [{ tenant: "montgomery-projectdox", transport: true, driver: "function", credentialId: "c1" }]);
    } else {
      assert.equal(s.afterPermit, undefined);
      assert.deepEqual(deepCalls, []);
    }
  }
});

test("worker: unencrypted credential and unknown adapters are refused before any browser starts", async () => {
  const open = worker.buildOpenAdapter({
    supabase: fakeSupabase({ password: "plaintext" }), env: {}, launchContext: async () => { throw new Error("no launch"); },
    lock: async () => {}, createMontgomeryTransport: async () => { throw new Error("no transport"); },
  });
  await assert.rejects(open({ adapter_key: "montgomery-projectdox", credential_id: "c" }), /not encrypted/);
  await assert.rejects(open({ adapter_key: "not-a-tenant", credential_id: "c" }), /no adapter registered/);
  assert.deepEqual(Object.keys(worker.ADAPTERS).sort(), ["dc-projectdox", "montgomery-projectdox", "pgc-eplan"]);
});

test("worker: a saved Montgomery login URL is used only on the Montgomery portal host", () => {
  assert.equal(worker.montgomeryLoginUrl(`${PORTAL}/Login/Index/MontgomeryDPS-Prod`), `${PORTAL}/Login/Index/MontgomeryDPS-Prod`);
  assert.equal(worker.montgomeryLoginUrl("https://evil.example/Login"), null);
  assert.equal(worker.montgomeryLoginUrl(`${PORTAL.replace("https", "http")}/Login`), null);
  assert.equal(worker.montgomeryLoginUrl(null), null);
});

// --- per-portal login lock ---------------------------------------------------------------------------------

function lockSupabase({ creds = [], jobs = [] } = {}) {
  const seen = [];
  return {
    seen,
    from(table) {
      const filters = [];
      const chain = {
        select() { return chain; },
        eq(c, v) { filters.push(["eq", c, v]); return chain; },
        ilike(c, v) { filters.push(["ilike", c, v]); return chain; },
        in() { return chain; },
        gt() { return chain; },
        limit() { seen.push({ table, filters }); return Promise.resolve({ data: table === "scrape_jobs" ? jobs : [], error: null }); },
        then(res) { seen.push({ table, filters }); return Promise.resolve({ data: creds, error: null }).then(res); },
      };
      return chain;
    },
  };
}

test("login lock: Montgomery credentials, scrape jobs and URLs are their own portal", async () => {
  assert.equal(lock.portalForUrl(`${PORTAL}/Home/Index`), "montgomery");
  assert.equal(lock.portalForUrl("https://planreview.dob.dc.gov/"), "dc");
  assert.equal(lock.portalForUrl("https://example.com/"), null);
  assert.equal(lock.isDcPortalUrl(`${PORTAL}/Home/Index`), false);

  const sb = lockSupabase({ creds: [{ id: "m1", jurisdiction: "Montgomery County MD - Avolve" }, { id: "d1", jurisdiction: "Washington DC - ProjectDox" }] });
  assert.deepEqual(await lock.sameLoginCredentialIds(sb, "acct", "montgomery"), ["m1"]);
  assert.deepEqual(await lock.sameLoginCredentialIds(sb, "acct"), ["d1"], "DC default unchanged");

  const jobs = [
    { id: "j1", credential_id: null, scraper_session_id: "abc", metadata: { portal_subtype: "montgomery-projectdox" } },
  ];
  const sb2 = lockSupabase({ jobs });
  assert.equal(await lock.manualDcScrapeActive(sb2, { credentialIds: ["m1"], portal: "montgomery" }), true);
  assert.deepEqual(sb2.seen[0].filters[0], ["ilike", "jurisdiction", "%montgomery%"]);
  assert.equal(await lock.manualDcScrapeActive(lockSupabase({ jobs }), { credentialIds: ["d1"] }), false, "a Montgomery subtype never blocks DC");
  const sb3 = lockSupabase({ jobs: [] });
  await lock.manualDcScrapeActive(sb3, { credentialIds: [] });
  assert.deepEqual(sb3.seen[0].filters[0], ["eq", "jurisdiction", "Washington DC"], "DC query unchanged");
  assert.throws(() => lock.PORTALS.nope.subtype, TypeError);
});
