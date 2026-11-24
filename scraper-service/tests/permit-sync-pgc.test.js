"use strict";

/**
 * PGC ePlans adapter offline: tenant URLs, the read-only guard, permit numbers seen on the live
 * My Projects grid (2026-11-23), and worker registration. No browser and no portal.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const safety = require("../permit-sync/core/safety");
const { PGC, DC, MONTGOMERY, tenantFor } = require("../permit-sync/adapters/projectdox-tenants");
const { buildTenantUrl, buildDcUrl } = require("../permit-sync/adapters/dc-projectdox/routes");
const norm = require("../permit-sync/adapters/pgc-projectdox/normalize");
const { createPgcAdapter } = require("../permit-sync/adapters/pgc-projectdox/adapter");
const live = require("../permit-sync/adapters/pgc-projectdox/live-transport");
const worker = require("../permit-sync/worker-entry");
const lock = require("../lib/dc-credential-lock");

const HOST = "https://eplans.princegeorgescountymd.gov";

test("PGC report exports open the ePlans viewer, not the Montgomery WebUI host", () => {
  const { reportViewerUrl } = require("../permit-sync/deep/policy");
  const url = reportViewerUrl(
    {
      reportId: "323",
      name: "Plan Review - Review Comments",
      viewer: {
        reportPath: PGC.reviewReport.ReportPath,
        dataSourceName: "DataSource1",
        paramQuery: "&ProjectID=80172&WFlowInstanceID=1&Timezone=",
      },
    },
    PGC.uiOrigin,
    "80172",
    PGC.reportViewerPath,
    { includeReportId: false },
  );
  const u = new URL(url);
  assert.equal(u.hostname, "eplans.princegeorgescountymd.gov");
  assert.equal(u.pathname, "/ProjectDox/ReportViewer.aspx");
  assert.equal(u.searchParams.get("ReportID"), null);
  assert.equal(u.searchParams.get("ReportPath"), "/PDoxProdReportPGC/Plan Review - Review Comments");
  assert.equal(u.searchParams.get("ProjectID"), "80172");
  const verdict = safety.evaluateRequest({ method: "GET", url, mode: "deep", tenant: PGC });
  assert.equal(verdict.allowed, true, verdict.reason);
  const titled = reportViewerUrl(
    {
      reportId: "1",
      name: "Current Project - All Uploaded Files",
      viewer: { reportPath: "/PDoxProdReportPGC/Current Project - All Uploaded Files", dataSourceName: "DataSource1", paramQuery: "ProjectID=80172" },
    },
    PGC.uiOrigin,
    "80172",
    PGC.reportViewerPath,
    { includeReportId: false },
  );
  assert.equal(safety.evaluateRequest({ method: "GET", url: titled, mode: "deep", tenant: PGC }).allowed, true);
});

test("PGC reads files from child folders and tasks from GetWorkflowTaskList", async () => {
  const calls = [];
  const transport = {
    async getJson(route, params) {
      calls.push([route, params && params.folderID != null ? String(params.folderID) : null]);
      if (route === "workflow_instances_list") return { Records: [{ WFlowInstanceID: 9, WFlowInstanceStateName: "Active", DateStarted: "2026-01-01" }], TotalRecordCount: 1 };
      if (route === "workflow_status") {
        const err = new Error("portal API answered 404 (workflow_status)");
        err.code = "portal_changed";
        throw err;
      }
      if (route === "active_task_list") {
        const err = new Error("portal API answered 404 (active_task_list)");
        err.code = "portal_changed";
        throw err;
      }
      if (route === "workflow_task_list") return [{ WFlowTaskID: 5, TaskName: "Review", TaskStatus: "Pending" }];
      if (route === "project_folders") return [{ FolderID: 10, Name: "Architectural", FilesCount: 0 }];
      if (route === "folder_children") return [{ EntityID: 11, Name: "Plans" }];
      if (route === "folder_files") return String(params.folderID) === "10" ? [] : [{ FileID: 77, Version: 1, FileName: "A.pdf", FileSize: 10 }];
      throw new Error(`unexpected ${route}`);
    },
    async getCorrectionsRows() { return []; },
    async getProjectInfo() { return { projectName: "15385-2022-0" }; },
    async listReports() { return []; },
  };
  const { sections } = await createPgcAdapter({ transport }).fetchPermit({ portal_record_id: "80172" });
  assert.equal(sections.files.status, "ok");
  assert.equal(sections.files.tables.permit_documents.length, 1);
  assert.equal(sections.files.tables.permit_documents[0].key, "77");
  assert.equal(sections.tasks.status, "ok");
  assert.equal(sections.tasks.tables.permit_tasks.length, 1);
  assert.ok(calls.some((c) => c[0] === "workflow_task_list"));
  assert.ok(calls.some((c) => c[0] === "folder_files" && c[1] === "11"));
  assert.equal(calls.some((c) => c[0] === "folder_files" && c[1] === "10"), true);
});

test("PGC status and tasks fall back to the project tabs when both APIs 404", async () => {
  const calls = [];
  const transport = {
    async getJson(route) {
      calls.push(route);
      if (route === "workflow_instances_list") return { Records: [{ WFlowInstanceID: 9, WFlowInstanceStateName: "Active" }], TotalRecordCount: 1 };
      if (route === "workflow_status" || route === "active_task_list" || route === "workflow_task_list") {
        const err = new Error(`portal API answered 404 (${route})`);
        err.code = "portal_changed";
        throw err;
      }
      if (route === "project_folders") return [];
      throw new Error(`unexpected ${route}`);
    },
    async readProjectStatus() {
      calls.push("readProjectStatus");
      return {
        ProjectStatus: "Applicant Re-upload",
        ReviewType: "Building",
        TotalNumberOfFiles: "10",
        UncompleteTaskCount: "1",
        SubWorkflows: [{ UnresolvedComments: 3 }],
      };
    },
    async readProjectTasks() {
      calls.push("readProjectTasks");
      return [{ WFlowTaskID: "dom:Applicant Re-upload::Accepted", TaskName: "Applicant Re-upload", TaskStatus: "Accepted", Accepted: true }];
    },
    async getCorrectionsRows() { return []; },
    async getProjectInfo() { return { projectName: "15385-2022-0" }; },
    async listReports() { return []; },
  };
  const { sections } = await createPgcAdapter({ transport }).fetchPermit({ portal_record_id: "80172" });
  assert.equal(sections.status.status, "ok");
  assert.equal(sections.status.sourceKind, "html");
  assert.equal(sections.status.fields.status, "upload");
  assert.equal(sections.status.fields.status_raw, "Applicant Re-upload");
  assert.equal(sections.status.fields.unresolved_comments, 3);
  assert.equal(sections.tasks.status, "ok");
  assert.equal(sections.tasks.sourceKind, "html");
  assert.equal(sections.tasks.tables.permit_tasks[0].fields.name, "Applicant Re-upload");
  assert.ok(calls.includes("readProjectStatus"));
  assert.ok(calls.includes("readProjectTasks"));
  assert.equal(calls.includes("workflow_task_list"), true);
});

test("PGC status tab text and report parameter prompts map without guessing values", () => {
  const norm = require("../permit-sync/adapters/pgc-projectdox/normalize");
  const status = norm.statusPayloadFromTab({
    keyValues: [
      { key: "Review Type", value: "Building" },
      { key: "Status", value: "Applicant Re-upload" },
      { key: "Total Number of Files", value: "10" },
      { key: "Current Non-Completed Tasks", value: "1" },
      { key: "Prescreen Review Comments (Unresolved)", value: "3" },
    ],
  });
  assert.equal(norm.statusFields(status).status_raw, "Applicant Re-upload");
  assert.equal(norm.statusFields(status).status, "upload");
  assert.equal(norm.statusFields(status).total_files, 10);
  // The Status tab's first label/value row is stored as the table header. Later rows stay data.
  const fromGrid = norm.statusPayloadFromTab({
    tables: [{
      headers: ["Review Type", "Building"],
      rows: [
        { "Review Type": "Status", "Building": "In Review" },
        { "Review Type": "Current Non-Completed Tasks", "Building": "2" },
      ],
    }],
  });
  assert.equal(fromGrid.ProjectStatus, "In Review");
  assert.equal(norm.statusFields(fromGrid).status, "in_review");
  assert.equal(fromGrid.ReviewType, "Building");
  assert.equal(fromGrid.UncompleteTaskCount, "2");
  const fromCells = norm.statusPayloadFromTab({
    tables: [{
      headers: ["Column 1", "Column 2"],
      rowCells: [
        [{ text: "Status" }, { text: "Approved" }],
        [{ text: "Prescreen Review Comments (Unresolved)" }, { text: "4" }],
      ],
    }],
  });
  assert.equal(fromCells.ProjectStatus, "Approved");
  assert.equal(norm.statusFields(fromCells).status, "approved");
  assert.equal(fromCells.SubWorkflows[0].UnresolvedComments, 4);
  // Plain panel text loses the line break before the duration row. Keep the status, not the duration.
  const fromText = norm.statusPayloadFromTab({
    meta: { bodySnippet: "Review Type Electrical Status Applicant Re-upload Applicant Re-upload 1019 days 14.5 hrs Current Non-Completed Tasks 1" },
  });
  assert.equal(fromText.ProjectStatus, "Applicant Re-upload");
  assert.equal(fromText.ReviewType, "Electrical");
  assert.equal(fromText.UncompleteTaskCount, "1");
  const missing = norm.statusPayloadFromTab({ meta: { bodySnippet: "Review Type Building Total Number of Files 10" } });
  assert.equal(missing.ProjectStatus, null);
  assert.equal(norm.statusFields(missing).status_raw, null);
  assert.notEqual(norm.statusFields(missing).status_raw, "Open");
  assert.equal(norm.statusFields(norm.statusPayloadFromTab({ keyValues: [{ key: "Status", value: "Open" }] })).status_raw, "Open");
  const tasks = norm.taskRecordsFromTab({
    tasks: [{ taskName: "Applicant Re-upload", assignee: null, state: "Accepted", rawText: "Waiting [Accepted]" }],
  });
  assert.equal(tasks[0].Accepted, true);
  assert.match(tasks[0].WFlowTaskID, /^dom:/);
  assert.equal(norm.reportParameterReason({ viewReport: true, fields: [{ label: "APNO", empty: true, disabled: false }] }), "parameters_required:APNO");
  assert.equal(norm.reportParameterReason({ viewReport: true, fields: [{ label: "Type", empty: true, disabled: false }, { label: "End Date", empty: true, disabled: true }] }), "parameters_required:Type,End Date");
  assert.equal(norm.reportParameterReason({ viewReport: false, fields: [] }), null);
});

test("the manual scraper exports the project-open used to reach the Web API", () => {
  const manual = require("../pgc-eplan-scraper");
  assert.equal(typeof manual.openProjectViaDashboardRow, "function");
  assert.equal(typeof manual.detectPaginationMode, "function");
  assert.equal(typeof manual.collectAllProjects, "function");
  assert.equal(typeof manual.capturePgcViewerDocument, "function");
  assert.equal(typeof manual.extractStatusTabData, "function");
  assert.equal(typeof manual.extractTasksTabData, "function");
  assert.equal(typeof manual.gotoPgcProjectTab, "function");
  assert.equal(typeof manual.handlePgcTaskAssignmentModal, "function");
  assert.equal(
    manual.buildPgcActiveXViewerFileUrl("4249493"),
    `${HOST}/ProjectDox/ActiveXViewer.aspx?FileID=4249493`,
  );
});

test("a viewer window on the site home is a shell, and the file viewer is ready to publish", () => {
  const manual = require("../pgc-eplan-scraper");
  assert.equal(manual.classifyPgcViewerLocation(""), "blank");
  assert.equal(manual.classifyPgcViewerLocation("about:blank"), "blank");
  assert.equal(manual.classifyPgcViewerLocation(`${HOST}/`), "shell");
  assert.equal(manual.classifyPgcViewerLocation(`${HOST}/Portal/Home/Index`), "shell");
  assert.equal(manual.classifyPgcViewerLocation(`${HOST}/ProjectDoxWebUI/Project/Index?tab=filesTab&ProjectID=80172`), "project");
  assert.equal(manual.classifyPgcViewerLocation(`${HOST}/ProjectDox/ActiveXViewer.aspx?FileID=77`), "viewer");
  assert.equal(manual.classifyPgcViewerLocation(`${HOST}/ProjectDox/FileViewer.aspx?FileID=77`), "viewer");
  assert.equal(manual.classifyPgcViewerLocation(`${HOST}:8443/BravaServer/publishtoformat/doc/1/pdf`), "viewer");
});

test("a PGC file opens from its folder view link", async () => {
  const manual = require("../pgc-eplan-scraper");
  const missing = await manual.openPgcFileViewerFromFilesTab({}, {});
  assert.equal(missing.error, "viewer_file_id");
  assert.equal(missing.viewerPage, null);
  const g = safety.createRunGuard({ mode: "deep", tenant: PGC });
  assert.equal(g.checkRequest("GET", manual.buildPgcTabUrl("80172", "filesTab")).allowed, true);
});

test("viewer publish builds an export context when the caller did not pass one", async () => {
  const manual = require("../pgc-eplan-scraper");
  const page = {
    frames: () => [],
    url: () => `${HOST}/ProjectDox/ActiveXViewer.aspx?FileID=77`,
    evaluate: async () => {
      throw new Error("fake_viewer");
    },
    context: () => ({ pages: () => [] }),
  };
  await assert.rejects(
    () => manual.capturePgcBravaPublishResult(page, { fileId: "77" }, [], { pages: () => [] }, { allowTrigger: true }),
    (err) => err instanceof TypeError && /getByRole/.test(err.message),
  );
});

test("PGC deep mode continues only the Brava publish write, and a failed publish response is not the PDF", () => {
  const liveTransport = require("../permit-sync/adapters/pgc-projectdox/live-transport");
  const dcLive = require("../permit-sync/adapters/dc-projectdox/live-transport");
  const pdf = `${HOST}:8443/BravaServer/publishtoformat/doc/export1/pdf`;
  const dropped = { action: "abort", violation: false, sessionEnded: false, rule: "method_dropped" };
  const denied = { action: "abort", violation: true, sessionEnded: false, rule: "deny_pattern" };
  assert.equal(liveTransport.isPgcBravaPublishWrite("POST", pdf), true);
  assert.equal(liveTransport.isPgcBravaPublishWrite("OPTIONS", pdf), true);
  assert.equal(liveTransport.isPgcBravaPublishWrite("GET", pdf), false);
  assert.equal(liveTransport.isPgcBravaPublishWrite("POST", `${HOST}:8443/BravaServer/search/doc`), false);
  assert.equal(liveTransport.isPgcBravaPublishWrite("POST", `${HOST}/ProjectDoxWebAPI/File/Upload`), false);
  assert.equal(liveTransport.liftPgcBravaPublishWrite(dropped, "POST", pdf, "deep").rule, "brava_publish");
  assert.equal(liveTransport.liftPgcBravaPublishWrite(dropped, "OPTIONS", pdf, "deep").action, "continue");
  assert.equal(liveTransport.liftPgcBravaPublishWrite(dropped, "POST", pdf, "json").rule, "method_dropped");
  assert.equal(liveTransport.liftPgcBravaPublishWrite(dropped, "POST", `${HOST}/Project/Save`, "deep").rule, "method_dropped");
  assert.equal(liveTransport.liftPgcBravaPublishWrite(denied, "POST", `${HOST}/File/Upload`, "deep").violation, true);
  const guard = safety.createRunGuard({ mode: "deep", tenant: PGC });
  assert.equal(dcLive.routeReadRequest({ method: "POST", url: pdf, resourceType: "xhr" }, guard).rule, "method_dropped");
  assert.equal(dcLive.routeReadRequest({ method: "POST", url: `${HOST}/ProjectDoxWebAPI/File/Upload`, resourceType: "xhr" }, guard).violation, true);
  const manual = require("../pgc-eplan-scraper");
  assert.equal(manual.pgcPublishNetworkRecordUsable({ url: pdf, status: 200 }), true);
  assert.equal(manual.pgcPublishNetworkRecordUsable({ url: pdf, status: 500 }), false);
  assert.equal(manual.pgcPublishNetworkRecordUsable({ url: pdf }), true);
});

test("PGC file bytes open the ePlans viewer, and task assignment stays refused", () => {
  const g = safety.createRunGuard({ mode: "deep", tenant: PGC });
  const viewer = `${HOST}/ProjectDox/ActiveXViewer.aspx?FileID=77`;
  assert.equal(g.checkRequest("GET", viewer).allowed, true);
  assert.equal(
    g.checkRequest("GET", `${HOST}/ProjectDoxWebAPI/File/RetrieveFile?inline=true&fileID=77`).allowed,
    true,
  );
  assert.equal(
    g.checkRequest("GET", `${HOST}:8443/BravaServer/publishtoformat/doc/1/pdf`).allowed,
    true,
  );
  assert.equal(
    g.checkRequest("GET", `${HOST}/ProjectDoxWebUI/WorkflowForms/Eform.aspx?wflowTaskID=1&autoAssignTask=true`).rule,
    "deny_pattern",
  );
});

test("tenant URLs keep the ProjectDoxWebAPI and ProjectDoxWebUI prefixes and the PGC report path", () => {
  assert.equal(
    buildTenantUrl(PGC, "project_folders", { projectID: 125622 }),
    `${HOST}/ProjectDoxWebAPI/Folder/GetProjectFolders?folderID=&projectID=125622`,
  );
  assert.equal(
    buildTenantUrl(PGC, "project_info", { ProjectID: 125622 }),
    `${HOST}/ProjectDoxWebUI/Project/ProjectInfo?ProjectID=125622`,
  );
  const rep = new URL(buildTenantUrl(PGC, "review_comments_report", { ProjectID: 125622, WFlowInstanceID: 1, Timezone: "" }));
  assert.equal(rep.pathname, "/ProjectDox/ReportViewer.aspx");
  assert.equal(rep.searchParams.get("ReportID"), null);
  assert.equal(rep.searchParams.get("ReportPath"), "/PDoxProdReportPGC/Plan Review - Review Comments");
  assert.equal(buildTenantUrl(DC, "review_comments_report", { ProjectID: 1 }), buildDcUrl("review_comments_report", { ProjectID: 1 }));
  assert.equal(buildTenantUrl(MONTGOMERY, "project_folders", { projectID: 1 }).includes("ProjectDoxWebAPI"), false);
});

test("guard allows dashboard and corrections reads and refuses task assignment", () => {
  const g = safety.createRunGuard({ tenant: PGC });
  assert.equal(g.checkRequest("GET", `${HOST}/Portal/Home/Index`).allowed, true);
  assert.equal(g.checkRequest("GET", `${HOST}/ProjectDoxWebAPI/WorkflowAggregate/GetProjectCorrectionsByCycleInstance?projectID=125622`).allowed, true);
  assert.equal(g.checkRequest("GET", `${HOST}/ProjectDox/ReportViewer.aspx?ReportPath=/PDoxProdReportPGC/Plan%20Review%20-%20Review%20Comments`).allowed, true);
  assert.equal(
    g.checkRequest("GET", `${HOST}/ProjectDoxWebUI/WorkflowForms/Eform.aspx?wflowTaskID=1758845&autoAssignTask=true`).rule,
    "deny_pattern",
  );
  assert.equal(g.checkRequest("POST", `${HOST}/Portal/Home/Index`).rule, "method");
  assert.equal(tenantFor("pgc-eplan").key, "pgc-eplan");
});

test("permit numbers from the live My Projects grid are accepted, and a header is not", () => {
  for (const permit of ["15385-2022-0", "2102-2023-0", "60581-2024-S", "61766-2024-CI", "10788-2023-CG", "62227-2024-CIEU", "COM-00954-2024"]) {
    assert.equal(norm.PERMIT_NUMBER.test(permit), true, permit);
    const rec = norm.discoveryRecord({ permit, projectId: "125622", status: "In Review" });
    assert.equal(rec.fields.permit_number, permit);
    assert.equal(rec.fields.jurisdiction, "Prince George's County MD");
  }
  assert.equal(norm.mapStatus("Applicant Re-upload"), "upload");
  const dc = require("../permit-sync/adapters/dc-projectdox/normalize");
  assert.equal(dc.isOpenReviewComment("Unresolved"), true);
  assert.equal(dc.isOpenReviewComment("Not Met"), true);
  assert.equal(dc.isOpenReviewComment("Met"), false);
  assert.equal(dc.isOpenReviewComment("Info Only"), false);
  const open = [{ fields: { status: "Not Met" } }, { fields: { status: "Not Met" } }, { fields: { status: "Not Met" } }];
  assert.equal(open.filter((c) => dc.isOpenReviewComment(c.fields.status)).length, 3);
  assert.equal(norm.mapStatus("Awaiting Final Fee Payment"), "other");
  assert.equal(norm.mapStatus("Expired"), "other");
  assert.throws(() => norm.discoveryRecord({ permit: "My Projects", projectId: "1" }));
});

test("discovery keeps one row per project and skips a name that is not a permit number", async () => {
  const transport = {
    async listDashboardPage() {
      return {
        rows: [
          { permit: "62227-2024-CIEU", projectId: "125622", status: "In Review", description: "alteration", address: "6704 CHAVEZ" },
          { permit: "62227-2024-CIEU", projectId: "125622", status: "In Review", description: "alteration", address: "6704 CHAVEZ" },
          { permit: "COM-00954-2024", projectId: "134726", status: "Expired" },
          { permit: "15385-2022-0", projectId: "80172", status: "Applicant Re-upload" },
          { permit: "My Projects", projectId: "9", status: "In Review" },
        ],
        totalRecords: 5,
        pageSize: 5,
      };
    },
  };
  const found = await createPgcAdapter({ transport }).discover();
  assert.deepEqual(found.records.map((r) => r.portal_record_id), ["125622", "134726", "80172"]);
  assert.equal(found.records[0].fields.status, "in_review");
  assert.equal(found.records[2].fields.status, "upload");
  assert.equal(found.complete, false);
  assert.deepEqual(found.skipped, ["My Projects"]);
});

test("login classification refuses a task form during auth and accepts the dashboard", () => {
  assert.equal(live.classifyPgcPage({ url: `${HOST}/Portal/Home/Index`, text: "My Projects" }), "authenticated");
  assert.equal(live.classifyPgcPage({ url: `${HOST}/Portal/Login/Index/PGC-Prod`, text: "Sign in", hasPasswordField: true }), "login_form");
  assert.equal(live.classifyPgcPage({ url: `${HOST}/ProjectDox/SessionEnded.aspx`, text: "" }), "session_dead");
  assert.equal(live.evaluatePgcAuthRequest({ url: `${HOST}/ProjectDoxWebUI/WorkflowForms/Eform.aspx?autoAssignTask=true` }).allowed, false);
  assert.equal(live.evaluatePgcAuthRequest({ url: `${HOST}/Portal/login/sso?url=Frame.aspx` }).allowed, true);
});

test("live transport refuses to start without approval A-3 or without the portal login", async () => {
  const base = { launchContext: async () => { throw new Error("must not launch"); }, username: "u", password: "p" };
  await assert.rejects(live.createPgcLiveTransport({ ...base, env: {} }), /not approved/);
  await assert.rejects(live.createPgcLiveTransport({ ...base, env: { PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3" } }), /needs the portal login/);
});

function fakeSupabase({ password, loginUrl = null, settings = {} } = {}) {
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        async single() {
          if (table === "portal_credentials") return { data: { portal_username: "acct", portal_password: password, login_url: loginUrl }, error: null };
          if (table === "permit_sync_sources") return { data: { settings }, error: null };
          return { data: null, error: { message: "unexpected" } };
        },
      };
      return chain;
    },
  };
}

test("worker: a PGC job opens the PGC transport and lock; deep mode adds the PGC driver", async () => {
  process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
  const enc = require("../app/services/portal-credentials/portal-credentials-crypto").encryptPortalPassword("secret");
  for (const mode of ["json", "deep"]) {
    const locks = [];
    const made = [];
    const deepCalls = [];
    const fakeTransport = { close: async () => {}, fetchFile: async () => {}, exportReport: async () => {} };
    const open = worker.buildOpenAdapter({
      supabase: fakeSupabase({ password: enc, loginUrl: "https://evil.example/login" }),
      env: { PERMIT_SYNC_MODE: mode },
      launchContext: async () => ({}),
      lock: async (a) => { locks.push(a.portal); },
      createTransport: async () => { throw new Error("DC transport must not be used"); },
      createMontgomeryTransport: async () => { throw new Error("Montgomery transport must not be used"); },
      createPgcTransport: async (o) => { made.push({ mode: o.mode, hasLogin: typeof o.login === "function" }); return fakeTransport; },
      createDeepPass: (d) => {
        deepCalls.push({ tenant: d.tenant && d.tenant.key, driver: typeof d.dcDeep.scrapeAll });
        return { wrapTransport: (t) => t, afterPermit: async () => ({}) };
      },
    });
    const s = await open({ adapter_key: "pgc-eplan", credential_id: "c1" });
    assert.equal(s.adapter.key, "pgc-eplan");
    assert.deepEqual(locks, ["pgc"]);
    assert.deepEqual(made, [{ mode, hasLogin: true }]);
    if (mode === "deep") assert.deepEqual(deepCalls, [{ tenant: "pgc-eplan", driver: "function" }]);
    else assert.equal(s.afterPermit, undefined);
  }
});

test("a saved PGC login URL is used only on the ePlans host", () => {
  assert.equal(worker.pgcLoginUrl(`${HOST}/Portal/Login/Index/PGC-Prod`), `${HOST}/Portal/Login/Index/PGC-Prod`);
  assert.equal(worker.pgcLoginUrl("https://evil.example/Login"), null);
  assert.equal(worker.pgcLoginUrl(null), null);
});

test("login lock treats ePlans as its own portal", async () => {
  assert.equal(lock.portalForUrl(`${HOST}/Portal/Home/Index`), "pgc");
  assert.equal(lock.portalForUrl("https://planreview.dob.dc.gov/"), "dc");
  const seen = [];
  const sb = {
    from() {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        ilike(c, v) { seen.push(["ilike", c, v]); return chain; },
        in() { return chain; },
        gt() { return chain; },
        limit() { return Promise.resolve({ data: [], error: null }); },
        then(res) { return Promise.resolve({ data: [{ id: "p1", jurisdiction: "Prince George's County ePlan" }, { id: "d1", jurisdiction: "Washington DC" }], error: null }).then(res); },
      };
      return chain;
    },
  };
  assert.deepEqual(await lock.sameLoginCredentialIds(sb, "acct", "pgc"), ["p1"]);
  assert.deepEqual(seen, []);
  const sb2 = {
    from() {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        ilike(c, v) { seen.push(["ilike", c, v]); return chain; },
        in() { return chain; },
        gt() { return chain; },
        limit() { seen.push(["limit"]); return Promise.resolve({ data: [], error: null }); },
      };
      return chain;
    },
  };
  await lock.manualDcScrapeActive(sb2, { credentialIds: [], portal: "pgc" });
  assert.deepEqual(seen[0], ["ilike", "jurisdiction", "%prince george%"]);
});
