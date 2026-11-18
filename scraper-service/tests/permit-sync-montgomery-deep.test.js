"use strict";

/**
 * Montgomery deep pass offline end to end (MONTGOMERY_GAPS.md G-1, option B): the real migration chain (PGlite),
 * worker core, Montgomery adapter, deep-mode guard with the Montgomery tenant, the shared deep runner with the
 * Montgomery driver, capture RPCs and the shared Review Comments Excel parser. Portal, bucket and agent are
 * offline stand-ins; nothing real is called.
 *
 *   run 1: JSON pass (900001's report is multi-page, so its reviews cannot be read yet) + deep pass: files stored
 *          (view-only files as the viewer rendition), reports exported, Review Comments Excel parsed, then the
 *          permit is read once more and its reviews come from the stored Excel export (D-103, D-142)
 *   run 2: nothing is downloaded, exported or re-read again
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createDeepDb, pgliteDeepRepo, memoryStorage, fakeDeepTransport, fakeDcDeep } = require("./helpers/permit-sync-deep");
const { pgliteWorkerRpc } = require("./helpers/permit-sync-rpc");
const { createMontgomeryFixtureTransport, REVIEW_EXCEL_ROWS } = require("./helpers/montgomery-fixture-transport");
const { createMontgomeryAdapter, ADAPTER_KEY } = require("../permit-sync/adapters/montgomery-projectdox/adapter");
const { createMontgomeryDeepDriver } = require("../permit-sync/deep/montgomery-driver");
const { runOnce } = require("../permit-sync/core/worker");
const { createDeepPass } = require("../permit-sync/deep/runner");
const { createRunGuard } = require("../permit-sync/core/safety");
const { MONTGOMERY } = require("../permit-sync/adapters/projectdox-tenants");
const { REPORT_NEEDS_WORKFLOW } = require("../permit-sync/deep/policy");

const OWNER = "40000000-0000-4000-8000-000000000001";
const ADMIN = "40000000-0000-4000-8000-000000000002";
const CRED = "40000000-0000-4000-8000-0000000000c1";

async function setup() {
  const h = await createDeepDb();
  for (const id of [OWNER, ADMIN]) await h.db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(-1)}@test.invalid`]);
  await h.db.query(`INSERT INTO public.profiles (user_id) VALUES ($1), ($2) ON CONFLICT (user_id) DO NOTHING`, [OWNER, ADMIN]);
  await h.db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  await h.db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $2, 'Montgomery County MD - ProjectDox', 'acct', '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}', 'COMBUILD-1000001')`, [CRED, OWNER]);
  const asAdmin = (sql, params) => h.db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [ADMIN]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return (await tx.query(sql, params)).rows[0];
  });
  await asAdmin(`SELECT admin_set_permit_sync_source($1, $2, true, '{}'::jsonb)`, [CRED, ADAPTER_KEY]);
  return {
    h,
    rpc: pgliteWorkerRpc(h, { mode: "deep" }),
    repo: pgliteDeepRepo(h, { adapterKey: ADAPTER_KEY }),
    storage: memoryStorage(),
    enqueue: (options = {}) => asAdmin(`SELECT admin_request_permit_deep_sync($1, $2::jsonb) AS id`, [CRED, JSON.stringify(options)]),
  };
}

function opener(s, transportOptions = {}, env = {}, extra = {}) {
  const made = [];
  const open = async (job) => {
    const fixture = createMontgomeryFixtureTransport({ guard: createRunGuard({ mode: "deep", tenant: MONTGOMERY }), ...transportOptions });
    const transport = { ...fakeDeepTransport(fixture), fetchFile: fixture.fetchFile, exportReport: fixture.exportReport };
    made.push(fixture);
    const deep = createDeepPass({
      dcDeep: createMontgomeryDeepDriver({ transport, ...(extra.driver || {}) }), transport, tenant: MONTGOMERY, repo: s.repo, storage: s.storage,
      pipeline: extra.pipeline || null, username: "acct", credentialId: job.credential_id, env, trace: () => {},
    });
    return { adapter: createMontgomeryAdapter({ transport: deep.wrapTransport(transport), accountDownload: null }), afterPermit: deep.afterPermit, close: async () => {} };
  };
  return { open, made };
}

const permitId = async (h, pid) => (await h.db.query(`SELECT id FROM permits WHERE adapter_key = $1 AND portal_record_id = $2`, [ADAPTER_KEY, pid])).rows[0].id;

test("Montgomery deep pass: files and report exports stored privately, then reviews from the stored Excel export", async () => {
  const s = await setup();
  const { h } = s;
  const o = opener(s, { multiPageReport: new Set(["900001"]) });

  await s.enqueue();
  const r1 = await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  // The fixture's "Mont test" row is not a permit number: a discovery warning, as on the live portal.
  assert.equal(r1.outcome, "completed_with_warnings", JSON.stringify(r1.metrics));
  assert.equal(r1.metrics.deep_warnings, undefined, "no deep-pass warnings");
  const f1 = o.made[0];
  assert.deepEqual(f1.requests.filter((r) => !r.allowed), [], "every portal read passed the Montgomery deep guard");

  // Only the three portal permits; the template and the non-permit row are not permits.
  assert.deepEqual((await h.db.query(`SELECT portal_record_id FROM permits WHERE adapter_key = $1 ORDER BY 1`, [ADAPTER_KEY])).rows.map((r) => r.portal_record_id), ["900001", "900002", "900003"]);

  // Files: Drawings on 900001 is view-only (folder DownloadFile false) -> viewer rendition; the rest are originals.
  assert.deepEqual(f1.deepCalls.files.sort((a, b) => a.fileId.localeCompare(b.fileId)), [
    { fileId: "7001", rendition: true }, { fileId: "7002", rendition: true }, { fileId: "7003", rendition: false }, { fileId: "7101", rendition: false },
  ]);
  const docs = (await h.db.query(`SELECT portal_file_id, download_status, download_permitted, storage_path, sha256 FROM permit_documents ORDER BY portal_file_id`)).rows;
  assert.deepEqual(docs.map((d) => [d.portal_file_id, d.download_status, d.download_permitted]), [
    ["7001", "stored", false], ["7002", "stored", false], ["7003", "stored", true], ["7101", "stored", true],
  ]);
  const p1 = await permitId(h, "900001");
  assert.ok(docs.every((d) => /^[0-9a-f-]{36}\/files\/\d+_/.test(d.storage_path) && /^[0-9a-f]{64}$/.test(d.sha256)), "private bucket paths with sha256 provenance");
  assert.ok(s.storage.objects.has(`${p1}/files/7003_Approved-Set.pdf`));

  // Reports: two per permit, Excel + PDF each; Review Comments rows come from the shared Excel parser. 900002 has
  // no workflow, so the portal lists its Review Comments with an empty WFlowInstanceID: not opened, recorded with
  // its reason, not counted as open (D-144).
  assert.equal(f1.deepCalls.reports.length, 5);
  assert.ok(f1.deepCalls.reports.every((r) => r.formats.join() === "EXCELOPENXML,PDF"));
  assert.ok(!f1.deepCalls.reports.some((r) => r.projectId === "900002" && r.reportId === "133"), "never opened");
  assert.equal(await h.count("permit_reports", "content_status = 'captured'"), 5);
  const p2 = await permitId(h, "900002");
  assert.deepEqual((await h.db.query(`SELECT content_status, content_error, content_attempts FROM permit_reports WHERE permit_id = $1 AND report_key = '133'`, [p2])).rows[0],
    { content_status: "failed", content_error: REPORT_NEEDS_WORKFLOW, content_attempts: 1 });
  const rc = (await h.db.query(
    `SELECT c.structured_rows, c.excel_storage_path, c.pdf_storage_path FROM permit_reports r JOIN permit_report_contents c ON c.id = r.latest_content_id WHERE r.permit_id = $1 AND r.report_key = '133'`, [p1],
  )).rows[0];
  assert.equal(rc.structured_rows.length, REVIEW_EXCEL_ROWS[900001].length);
  assert.equal(rc.structured_rows[0].ref, "1");
  assert.match(rc.excel_storage_path, /\/reports\/133\/[0-9a-f]{64}\.xlsx$/);
  assert.match(rc.pdf_storage_path, /\/reports\/133\/[0-9a-f]{64}\.pdf$/);
  assert.equal(r1.metrics.deep.deep_passes, 3);
  assert.equal(r1.metrics.deep.portal_syncs, 0, "no linked projects: nothing written to projects");
  // The multi-page report failed the JSON pass's Reviews read; the deep pass captured its Excel export, so the
  // permit was read once more in the same job and the reviews came from the stored export (D-103, D-142).
  assert.equal(r1.metrics.deep.reviews_reread, 1, "only 900001 needed the re-read");
  assert.equal(r1.metrics.permits_reread, 1);
  assert.equal(r1.metrics.sections.reviews.reread_ok, 1);
  assert.equal(await h.count("permit_review_comments", "permit_id = $1", [p1]), REVIEW_EXCEL_ROWS[900001].length);
  assert.equal((await h.db.query(`SELECT status FROM permit_section_state WHERE permit_id = $1 AND section = 'reviews'`, [p1])).rows[0].status, "ok");
  assert.equal((await h.db.query(`SELECT phase FROM permit_sync_job_permits WHERE portal_record_id = '900001' ORDER BY created_at DESC LIMIT 1`)).rows[0].phase, "completed", "the re-read cleared the permit's warning");

  // Run 2: nothing is fetched again and the reviews are unchanged.
  await s.enqueue();
  const r2 = await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  assert.equal(r2.outcome, "completed_with_warnings", JSON.stringify(r2.metrics));
  assert.equal(r2.metrics.deep_warnings, undefined);
  assert.equal(r2.metrics.permits_reread, undefined, "nothing incomplete: no re-read");
  const f2 = o.made[1];
  assert.equal(await h.count("permit_review_comments", "permit_id = $1", [p1]), REVIEW_EXCEL_ROWS[900001].length);
  assert.deepEqual(f2.deepCalls.reports, [], "the re-read recorded the deep pass with the final hashes, so no report is exported again");
  assert.deepEqual(f2.deepCalls.files, [], "stored files are not downloaded again");
  assert.equal(r2.metrics.deep.files_downloaded, 0);
  assert.deepEqual(f2.requests.filter((r) => !r.allowed), []);
  assert.equal((await h.db.query(`SELECT content_attempts FROM permit_reports WHERE permit_id = $1 AND report_key = '133'`, [p2])).rows[0].content_attempts, 1, "its retry attempts are not spent while it cannot render");
});

test("Montgomery deep pass: a failed report export is recorded failed (retryable) and reported as a warning", async () => {
  const s = await setup();
  const o = opener(s, { reportExportFails: (id, pid) => id === "132" && pid === "900002" });
  await s.enqueue();
  const r = await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  assert.equal(r.outcome, "completed_with_warnings", JSON.stringify(r.metrics));
  assert.deepEqual(r.metrics.deep_warnings, ["reports_failed", "reports_open"]);
  const p2 = await permitId(s.h, "900002");
  const rows = (await s.h.db.query(`SELECT report_key, content_status FROM permit_reports WHERE permit_id = $1 ORDER BY 1`, [p2])).rows;
  assert.deepEqual(rows.map((x) => [x.report_key, x.content_status]), [["132", "failed"], ["133", "failed"]], "133: no workflow (D-144)");
  assert.equal(s.storage.puts.filter((p) => p.startsWith(`${p2}/reports/132/`)).length, 0, "no object for a failed export");
});

test("Montgomery deep pass: a Review Comments export without the rows the viewer shows is failed (retryable), not captured", async () => {
  const s = await setup();
  const o = opener(s, { reviewExcelWithoutRows: new Set(["900001"]) });
  await s.enqueue();
  const r = await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  assert.equal(r.outcome, "completed_with_warnings", JSON.stringify(r.metrics));
  const p1 = await permitId(s.h, "900001");
  const rep = (await s.h.db.query(`SELECT content_status, content_error, latest_content_id FROM permit_reports WHERE permit_id = $1 AND report_key = '133'`, [p1])).rows[0];
  assert.equal(rep.content_status, "failed");
  assert.match(rep.content_error, /^review_comments_excel_without_rows/);
  assert.equal(rep.latest_content_id, null);
  assert.equal([...s.storage.objects.keys()].filter((k) => k.startsWith(`${p1}/reports/133/`)).length, 0, "uploads of the refused export are released");
  const r132 = (await s.h.db.query(`SELECT content_status FROM permit_reports WHERE permit_id = $1 AND report_key = '132'`, [p1])).rows[0];
  assert.equal(r132.content_status, "captured", "reports without a comment grid are captured as before");
});

test("shared SSRS exporter: a failed export call does not leave an unhandled download wait (live crash 2026-11-18)", async () => {
  const pgc = require("../pgc-eplan-scraper");
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const page = {
      waitForEvent: () => new Promise((_, reject) => setTimeout(() => reject(new Error("Target page, context or browser has been closed")), 5)),
      waitForTimeout: async () => {},
      frames: () => [],
      url: () => "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com/WebForms/ReportViewer.aspx?ReportID=133",
      request: { get: async () => ({ status: () => 404, body: async () => Buffer.alloc(0) }) },
    };
    const handle = { clientId: "ReportViewer1", frame: { evaluate: async () => { throw new Error("exportReport not available"); } } };
    const r = await pgc.exportReportFormat(page, "EXCELOPENXML", "/tmp/never-written.xlsx", handle, page.url());
    assert.equal(r.ok, false);
    await new Promise((res) => setTimeout(res, 30));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("crash safety: an unexpected throw in a file step is a recorded failure on that file; one in the whole deep pass fails that permit only; the job still finishes", async () => {
  // (a) fetchFile throws a plain TypeError (not a portal error) for one file.
  const s = await setup();
  const o = opener(s, { onFetchFile: async (id) => { if (id === "7003") throw new TypeError("Cannot read properties of null"); } });
  await s.enqueue();
  const a = await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  assert.equal(a.outcome, "completed_with_warnings", JSON.stringify(a.metrics));
  assert.deepEqual((await s.h.db.query(`SELECT download_status FROM permit_documents WHERE portal_file_id = '7003'`)).rows, [{ download_status: "failed" }]);
  assert.equal(await s.h.count("permit_documents", "download_status = 'stored'"), 3, "the other files were stored");
  assert.equal(a.metrics.deep.files_failed, 1);

  // (b) the whole deep pass of one permit throws; the worker records it on that permit and goes on.
  const s2 = await setup();
  const inner = opener(s2);
  const open = async (job) => {
    const session = await inner.open(job);
    return { ...session, afterPermit: async (args) => { if (args.record.portal_record_id === "900002") throw new Error("deep pass blew up"); return session.afterPermit(args); } };
  };
  await s2.enqueue();
  const b = await runOnce({ rpc: s2.rpc, openAdapter: open, workerId: "w1" });
  assert.equal(b.outcome, "completed_with_warnings", JSON.stringify(b.metrics));
  assert.equal(b.metrics.deep_failed, 1);
  assert.equal(b.metrics.permits_ok, 3);
  assert.equal(await s2.h.count("permit_deep_state"), 2, "the other two permits completed their deep pass");
});

test("Montgomery deep pass: the per-job download budget caps files; capped files stay pending", async () => {
  const s = await setup();
  const o = opener(s, {}, { PERMIT_SYNC_DEEP_MAX_FILES: "2" });
  await s.enqueue();
  const r = await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  assert.equal(r.outcome, "completed_with_warnings", JSON.stringify(r.metrics));
  assert.deepEqual(r.metrics.deep_warnings, ["files_pending"]);
  assert.equal(o.made[0].deepCalls.files.length, 2);
  assert.equal(await s.h.count("permit_documents", "download_status = 'stored'"), 2);
  assert.equal(await s.h.count("permit_documents", "download_status <> 'stored'"), 2);
});

test("Montgomery deep driver: refuses project-targeted scrapes; JSON-mode guard refuses its reads", async () => {
  const fixture = createMontgomeryFixtureTransport();
  const driver = createMontgomeryDeepDriver({ transport: fixture });
  const session = { dcReloginDisabled: true, data: {} };
  const project = { id: "900001", projectId: "900001", projectNum: "COMBUILD-1000001", name: "COMBUILD-1000001" };
  await assert.rejects(driver.scrapeAll(session, [project], "x", ["files"], "proj", null, false, null, null, null, { skipPortalSync: true }), /must not target a project/);
  await assert.rejects(driver.scrapeAll(session, [project], "x", ["files"], null, null, false, null, null, null, {}), /skip the portal sync/);
  await assert.rejects(fixture.fetchFile("7003"), (e) => e.verdict.rule === "downloads_disabled");
  await assert.rejects(
    fixture.exportReport({ url: `${MONTGOMERY.uiOrigin}/Reserved.ReportViewerWebControl.axd?OpType=Export&Format=EXCELOPENXML`, dir: "/tmp", formats: ["EXCELOPENXML"] }),
    (e) => e.verdict.rule === "deny_pattern",
  );
  assert.throws(() => createMontgomeryDeepDriver({ transport: { getJson() {}, listReports() {} } }), /deep-mode transport/);
});

const PROBE = path.join(__dirname, "helpers", "dc-deep-closure-probe.js");

test("Montgomery linked sync: an unlinked permit does not throw and writes nothing (before any writer is loaded)", async () => {
  let loaded = 0;
  const driver = createMontgomeryDeepDriver({
    transport: createMontgomeryFixtureTransport(),
    loadWriter: () => { loaded += 1; return { syncPortalDataToSupabase: async () => { throw new Error("must not write"); } }; },
    readProject: async () => { throw new Error("must not read"); },
  });
  const project = { id: "900001", projectId: "900001", projectNum: "COMBUILD-1000001" };
  const session = { data: { 900001: { projectNum: "COMBUILD-1000001", tabs: { files: { folders: [] } } } } };
  const opts = { forbidInsert: true, skipCredentialRepoint: true, contentHash: true };
  for (const link of [null, undefined, ""]) assert.equal(await driver.syncPortalDataToSupabase(session, [project], link, null, null, opts), true);
  assert.equal(loaded, 0);
  await assert.rejects(driver.syncPortalDataToSupabase(session, [project], "any-project-id", "u1", null, {}), /forbid inserts/);
});

test("Montgomery linked sync (real DC writer): files and reports are merged into the stored portal_data; status, info, tasks and other keys are kept", () => {
  const r = spawnSync(process.execPath, [PROBE, "montgomery"], { cwd: path.join(__dirname, ".."), env: process.env, encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const line = String(r.stdout || "").split("\n").find((l) => l.startsWith("PROBE_RESULT ") || l.startsWith("PROBE_ERROR "));
  assert.ok(line, `probe printed no result (exit ${r.status})`);
  assert.ok(line.startsWith("PROBE_RESULT "), line.slice(0, 400));
  const out = JSON.parse(line.slice(13));
  assert.deepEqual(out.unlinked, { ok: true, requests: 0 }, "no linked project: no request at all");
  assert.equal(out.linked_ok, true);
  assert.deepEqual(out.linked_requests.filter((q) => !q.startsWith("GET")), ["PATCH projects"], "one project update, no insert, no credential re-point");
  assert.match(out.refused, /forbid inserts/);
  assert.equal(out.refused_requests, 0);
  const pd = out.after;
  // Stored data the pass did not capture survives.
  assert.deepEqual(pd.tabs.status.keyValues, [{ key: "Status", value: "In Review" }]);
  assert.equal(pd.tabs.status.links.length, 1);
  assert.deepEqual(pd.tabs.info.projectInfo, [{ key: "Applicant", value: "Older applicant" }]);
  assert.deepEqual(pd.tabs.tasks.keyValues, [{ key: "Task", value: "Older task" }]);
  assert.deepEqual(pd.unrelatedKey, { keep: true });
  assert.equal(pd.description, "Older description");
  assert.equal(pd.location, "1 Old Road");
  assert.equal(pd.portalSubtype, "montgomery-projectdox");
  assert.equal(out.address, "1 Old Road");
  for (const t of ["status", "info", "tasks"]) assert.equal(JSON.stringify(pd.tabs[t]).includes("json_pass"), false, `${t} was not replaced by a placeholder`);
  // Files: captured outcome and storage ref in; the stored entry's own fields stay where the pass left them empty.
  const plans = pd.tabs.files.folders.find((f) => f.name === "Plans").files[0];
  assert.deepEqual(plans.storageRef, { bucket: "permit-documents", path: "p1/files/7001.pdf", sha256: "aa" });
  assert.equal(plans.viewUrl, "https://older.example/view/7001");
  assert.equal(plans.commentCount, 2);
  assert.equal(plans.comments.length, 1);
  assert.equal(pd.tabs.files.folders.find((f) => f.name === "Specs").files[0].downloadStatus, "not_downloaded");
  // Reports: the stored table and entries stay, the capture is merged by report name, an unrelated stored report is kept.
  assert.equal(pd.tabs.reports.tables.length, 1);
  assert.equal(pd.tabs.reports.reportEntries[0].pdfUrl, "https://older.example/r.pdf");
  const pdfs = Object.fromEntries(pd.tabs.reports.pdfs.map((x) => [x.fileName, x]));
  assert.equal(pdfs["Review Comments"].text, "new text");
  assert.equal(pdfs["Review Comments"].pdfStorageRef.path, "p1/reports/r.pdf");
  assert.equal(pdfs["Needs workflow"].unavailable, true);
  assert.equal(pdfs["Older only"].text, "kept");
  assert.equal(pd.permitRepositorySync.capture_hash, "c1");
  assert.equal(pd.dashboardStatus, "Open", "the portal's current dashboard status");
  assert.match(out.hash, /^[0-9a-f]{64}$/);
});

test("Montgomery deep pass: every linked project of a permit gets files and reports, an unlinked permit is still fully processed, and comments do not depend on the link", async () => {
  const s = await setup();
  const { h } = s;
  const OLD = "40000000-0000-4000-8000-0000000000a1";
  const NEW = "40000000-0000-4000-8000-0000000000a2";
  await h.db.query(`INSERT INTO public.projects (id, user_id, name, permit_number, portal_data) VALUES ($1, $2, 'Older project', 'COMBUILD-1000001', $3::jsonb), ($4, $2, 'Fresh project', 'COMBUILD-1000001', NULL)`, [OLD, OWNER, JSON.stringify({
    portalType: "projectdox", portalSubtype: "montgomery-projectdox", description: "Older description", unrelatedKey: { keep: true },
    tabs: { status: { keyValues: [{ key: "Status", value: "Older status" }], tables: [], links: [] }, info: { projectInfo: [{ key: "Applicant", value: "Older applicant" }] }, reports: { reportEntries: [{ reportName: "Older entry" }] } },
  }), NEW]);

  // First pass: only 900001 exists as a permit row after discovery; link after the JSON pass has created the permits.
  const calls = { trigger: [], central: [] };
  const pipeline = {
    trigger: async (a) => { calls.trigger.push(a.projectId); return { outcome: "complete" }; },
    triggerCentral: async (a) => { calls.central.push(a.permitId); return { outcome: "complete" }; },
  };
  const fake = fakeDcDeep(h);
  const driver = {
    loadWriter: () => ({ syncPortalDataToSupabase: fake.syncPortalDataToSupabase }),
    readProject: async (id) => (await h.db.query(`SELECT portal_data, portal_status FROM projects WHERE id = $1`, [id])).rows[0] || null,
  };
  const o = opener(s, { multiPageReport: new Set(["900001"]) }, {}, { driver, pipeline });
  await s.enqueue();
  const first = await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  assert.equal(first.metrics.deep.portal_syncs, 0, "nothing linked yet: no write, no failure");
  assert.equal(first.metrics.deep.deep_failed, undefined);
  const p1 = await permitId(h, "900001");
  assert.equal(await h.count("permit_review_comments", "permit_id = $1", [p1]), REVIEW_EXCEL_ROWS[900001].length, "comments are filled with no link");
  assert.ok(calls.central.includes(p1), "the permit-level (central) comment step ran for the unlinked permit");
  assert.deepEqual(calls.trigger, [], "no project pipeline without a link");
  assert.equal(await h.count("projects", "portal_data_hash IS NOT NULL"), 0);

  await h.db.query(`INSERT INTO project_permits (project_id, permit_id) VALUES ($1, $3), ($2, $3)`, [OLD, NEW, p1]);
  calls.central.length = 0;
  await s.enqueue();
  const second = await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  assert.notEqual(second.outcome, "failed", JSON.stringify(second.metrics));
  assert.equal(second.metrics.deep.portal_syncs, 2, "one write per linked project, whichever rows they are");
  assert.deepEqual(fake.calls.syncs.map((x) => x.projectId).sort(), [OLD, NEW].sort());
  assert.ok(calls.central.includes(p1), "the central comment step still runs for a linked permit");
  assert.deepEqual([...calls.trigger].sort(), [NEW, OLD].sort(), "each linked project gets its pipeline run");
  assert.equal(await h.count("permit_review_comments", "permit_id = $1", [p1]), REVIEW_EXCEL_ROWS[900001].length, "comments not duplicated or dropped");

  const row = async (id) => (await h.db.query(`SELECT portal_data FROM projects WHERE id = $1`, [id])).rows[0].portal_data;
  const old = await row(OLD);
  const fresh = await row(NEW);
  for (const pd of [old, fresh]) {
    const files = pd.tabs.files.folders.flatMap((f) => f.files);
    assert.equal(files.filter((f) => f.storageRef).length, 3, "all three files of the permit stored on the project");
    assert.ok(pd.tabs.reports.pdfs.length >= 2 && pd.tabs.reports.pdfs.some((x) => x.pdfStorageRef), "reports with their stored exports");
    assert.equal(pd.projectNum, "COMBUILD-1000001");
    assert.equal(pd.permitRepositorySync.permit_id, p1);
  }
  // Older scraper data on the first project is untouched; placeholders never written to either.
  assert.deepEqual(old.tabs.status.keyValues, [{ key: "Status", value: "Older status" }]);
  assert.deepEqual(old.tabs.info.projectInfo, [{ key: "Applicant", value: "Older applicant" }]);
  assert.deepEqual(old.tabs.reports.reportEntries, [{ reportName: "Older entry" }]);
  assert.equal(old.description, "Older description");
  assert.deepEqual(old.unrelatedKey, { keep: true });
  for (const pd of [old, fresh]) for (const t of ["status", "tasks", "info"]) assert.ok(!pd.tabs[t] || !JSON.stringify(pd.tabs[t]).includes("json_pass"));
  assert.equal(fresh.tabs.status, undefined, "nothing invented for a project that had no status");
});

test("shared Review Comments parser: finds the grid below blank spacer rows (live report 133 layout, D-141)", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { writeReportExcel } = require("./helpers/montgomery-fixture-transport");
  const { extractReviewCommentsStructuredRowsFromExcelFile } = require("../lib/reviewCommentsExcelStructuredRows");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-parser-"));
  try {
    // Two rows: 6 non-empty rows in all, header on row 9 (the stored 200100 export had exactly this shape).
    const dest = path.join(dir, "report.xlsx");
    await writeReportExcel(dest, REVIEW_EXCEL_ROWS[900001].slice(0, 2));
    const rows = await extractReviewCommentsStructuredRowsFromExcelFile(dest);
    assert.deepEqual(rows.map((r) => [r.ref, r.status]), [["1", "Unresolved"], ["2", "Resolved"]]);
    assert.equal(rows[0].type, REVIEW_EXCEL_ROWS[900001][0].type);
    const empty = path.join(dir, "empty.xlsx");
    await writeReportExcel(empty, [], false);
    assert.deepEqual(await extractReviewCommentsStructuredRowsFromExcelFile(empty), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Montgomery deep guard: the RetrieveFile and report-export URLs the live transport sends are deep-only reads", () => {
  const { reportViewerUrl } = require("../permit-sync/deep/policy");
  const deep = createRunGuard({ mode: "deep", tenant: MONTGOMERY });
  const json = createRunGuard({ mode: "json", tenant: MONTGOMERY });
  const viewer = reportViewerUrl({ reportId: "133", name: "Plan Review - Review Comments", viewer: { reportPath: MONTGOMERY.reviewReport.ReportPath, dataSourceName: "DataSource1", paramQuery: "ProjectID=200100&WFlowInstanceID=48637&Timezone=" } }, MONTGOMERY.uiOrigin, "200100");
  const urls = [
    `${MONTGOMERY.apiOrigin}/File/RetrieveFile?convertToPDF=true&inline=true&blackCADBackground=false&fileID=5146086`,
    `${MONTGOMERY.apiOrigin}/File/RetrieveFile?inline=true&fileID=5146086`,
    `${viewer}&rs:Format=EXCELOPENXML`,
    `${viewer}&rs:Format=PDF`,
  ];
  for (const u of urls) {
    assert.equal(deep.checkRequest("GET", u).allowed, true, u);
    assert.equal(json.checkRequest("GET", u).allowed, false, u);
    assert.equal(deep.checkRequest("POST", u).allowed, false, `POST ${u}`);
  }
});

test("D-141 repair script: touches only a rowless Review Comments capture of the one permit; the next pass exports and parses it again", async () => {
  const s = await setup();
  const { h } = s;
  const o = opener(s);
  await s.enqueue();
  await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  const p1 = await permitId(h, "900001");
  const raw = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../scripts/permit-repo/repairs/d141-montgomery-200100-review-comments.sql"), "utf8");
  const sql = raw.replaceAll("9afe3e15-20c2-4e7b-b2f9-80ee377f9f7b", p1).replaceAll("'200100'", "'900001'");
  await assert.rejects(h.db.exec(sql), /expected 1 report, matched 0/, "a capture with parsed rows is not touched");

  // What production holds: a captured version with an Excel export and no parsed rows.
  const v = (await h.db.query(
    `INSERT INTO permit_report_contents (permit_id, report_key, version, content_sha256, text_content, excel_storage_path, pdf_storage_path)
     SELECT permit_id, report_key, version + 1, md5('x') || md5('y'), text_content, excel_storage_path, pdf_storage_path FROM permit_report_contents
     WHERE permit_id = $1 AND report_key = '133' ORDER BY version DESC LIMIT 1 RETURNING id`, [p1])).rows[0].id;
  await h.db.query(`UPDATE permit_reports SET latest_content_id = $2 WHERE permit_id = $1 AND report_key = '133'`, [p1, v]);
  const before = await h.count("permit_reports", "content_status = 'captured'");
  await h.db.exec(sql);
  assert.equal(await h.count("permit_reports", "content_status = 'captured'"), before - 1, "exactly one row changed");
  assert.deepEqual((await h.db.query(`SELECT content_status, content_attempts, latest_content_id FROM permit_reports WHERE permit_id = $1 AND report_key = '133'`, [p1])).rows[0],
    { content_status: "failed", content_attempts: 0, latest_content_id: null });

  await s.enqueue({ only_portal_record_ids: ["900001"] });
  const r2 = await runOnce({ rpc: s.rpc, openAdapter: o.open, workerId: "w1" });
  // The Reports tab renders every listed report again (as on DC); unchanged content keeps its version.
  assert.equal(r2.metrics.deep.reports_failed, 0, JSON.stringify(r2.metrics));
  assert.deepEqual(o.made[1].deepCalls.reports.map((r) => r.reportId).sort(), ["132", "133"]);
  const rows = (await h.db.query(`SELECT jsonb_array_length(c.structured_rows) AS n FROM permit_reports r JOIN permit_report_contents c ON c.id = r.latest_content_id WHERE r.permit_id = $1 AND r.report_key = '133'`, [p1])).rows[0].n;
  assert.equal(rows, REVIEW_EXCEL_ROWS[900001].length);
});

test("Montgomery RetrieveFile runs in the WebUI page with its session (live 401 via context.request, D-143)", async () => {
  const { pageRetrieveFile } = require("../permit-sync/adapters/montgomery-projectdox/live-transport");
  const realFetch = global.fetch;
  const seen = [];
  const body = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(70000, 7)]);
  global.fetch = async (url, init) => {
    seen.push({ url, init });
    if (/fileID=1\b/.test(url)) return new Response(body, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(body.length) } });
    if (/fileID=2\b/.test(url)) return new Response("no", { status: 401 });
    if (/fileID=3\b/.test(url)) return new Response(body, { status: 200, headers: { "content-length": "999999999" } });
    return new Response(body, { status: 200 });
  };
  try {
    const base = `${MONTGOMERY.apiOrigin}/File/RetrieveFile?inline=true&fileID=`;
    const ok = await pageRetrieveFile({ target: `${base}1`, sid: "sid-x", max: 1e6 });
    assert.equal(ok.status, 200);
    assert.ok(Buffer.from(ok.b64, "base64").equals(body), "bytes survive the base64 hop (chunked over 32 KiB)");
    assert.equal(seen[0].init.headers.Sessionid, "sid-x");
    assert.equal(seen[0].init.credentials, "include");
    assert.equal(seen[0].init.method, "GET");
    const refused = await pageRetrieveFile({ target: `${base}2`, sid: "sid-x", max: 1e6 });
    assert.deepEqual([refused.status, refused.b64], [401, null]);
    const declaredTooLarge = await pageRetrieveFile({ target: `${base}3`, sid: "sid-x", max: 1e6 });
    assert.deepEqual([declaredTooLarge.declared, declaredTooLarge.b64], [999999999, null]);
    const bodyTooLarge = await pageRetrieveFile({ target: `${base}4`, sid: "sid-x", max: 1000 });
    assert.deepEqual([bodyTooLarge.size, bodyTooLarge.b64], [body.length, null]);
  } finally {
    global.fetch = realFetch;
  }
});

test("D-144: reports listed with an empty WFlowInstanceID cannot render (live 200100 report 139, 146267 reports 133-135)", () => {
  const { reportNeedsWorkflow, unrenderableReportKeys } = require("../permit-sync/deep/policy");
  const item = (key, paramQuery) => ({ key, reportId: key, viewer: { reportPath: "/MontgomeryCountyProd/ProjectDox/x", dataSourceName: "DataSource1", paramQuery } });
  const listed = [
    item("132", "&ProjectID=146267&Timezone="),
    item("133", "&ProjectID=146267&WFlowInstanceID=&Timezone="),
    item("134", "&ProjectID=200100&WFlowInstanceID=48637&Timezone="),
    item("139", "&ProjectID=200100&WFlowInstanceID=&RootWebURL=https%3a%2f%2fmontgomeryco-md-us-projectdoxwebui.avolvecloud.com&Timezone="),
    item("140", "&ProjectID=200100&WFlowInstanceID="),
    { key: "141", name: "no viewer metadata" },
  ];
  assert.deepEqual(listed.map(reportNeedsWorkflow), [false, true, false, true, true, false]);
  assert.deepEqual([...unrenderableReportKeys(listed)].sort(), ["133", "139", "140"]);
  assert.equal(unrenderableReportKeys(undefined).size, 0, "no listing in this job (resumed): nothing is excluded");
});
