"use strict";

/**
 * DC deep pass (D-055): after the JSON pass applied a permit, runs the existing manual DC scraper
 * (`dcDeep.scrapeAll`) in the same browser session for the tabs the change gate asks for, stores file and
 * report binaries in the private bucket, records them through the capture RPCs, writes portal_data to
 * linked projects only, and starts the agent pipeline when a linked project's portal data changed.
 *
 * Used as the worker session's `afterPermit` hook (core/worker.js). Everything external is injected:
 *   dcDeep    the additive export of registerExecutionRoutes (app-loader.js)
 *   transport the live DC transport in deep mode (one login per job)
 *   repo      repo.js (service-role reads + capture RPCs)
 *   storage   repo.js supabaseDeepStorage (private bucket)
 *   pipeline  pipeline.js driver (or null = no agent trigger)
 */

const policy = require("./policy");
const safety = require("../core/safety");
const { fileDigest, contentTypeFor } = require("./repo");
const { PortalChangedError, SessionEndedError } = require("../core/errors");

const DC_SESSION_ORIGIN = "https://session.planreview.dob.dc.gov";

/**
 * The manual scraper logs page content (file names, report text previews, Info values including phone
 * fields). Worker logs must not carry portal personal data, so its console output is dropped while it runs;
 * errors are kept as one redacted line.
 */
async function withQuietConsole(fn) {
  const { redactText } = require("../core/redact");
  const saved = { log: console.log, info: console.info, warn: console.warn, debug: console.debug, error: console.error };
  const drop = () => {};
  Object.assign(console, { log: drop, info: drop, warn: drop, debug: drop, error: (...a) => saved.error(`[permit-sync] scraper error: ${redactText(a.map(String).join(" ")).slice(0, 200)}`) });
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
}

/** Remembers dashboard rows (page number, description, location) seen by discovery, for the manual project object. */
function createDashboardIndex(transport) {
  const rows = new Map();
  let total = null;
  let scannedAll = false;
  const remember = (pageNo, page) => {
    if (page && Number.isInteger(page.totalRecords)) total = page.totalRecords;
    for (const r of (page && page.rows) || []) if (r.projectId) rows.set(String(r.projectId), { ...r, dashboardPage: pageNo });
  };
  return {
    /** Wraps transport.listDashboardPage so adapter discovery fills the index. */
    wrap(t) {
      return { ...t, listDashboardPage: async (n) => { const p = await t.listDashboardPage(n); remember(n, p); return p; } };
    },
    /** Row for a project; after a resumed job (discovery skipped) the dashboard is re-read once. */
    async locate(projectId) {
      const id = String(projectId);
      if (rows.has(id) || scannedAll) return rows.get(id) || null;
      scannedAll = true;
      const first = await transport.listDashboardPage(1);
      remember(1, first);
      const pages = Math.ceil((first.totalRecords || 0) / (first.pageSize || first.rows.length || 10));
      for (let n = 2; n <= Math.min(pages, 20) && !rows.has(id); n += 1) remember(n, await transport.listDashboardPage(n));
      return rows.get(id) || null;
    },
    get total() { return total; },
  };
}

function manualProject(record, row) {
  const permit = String((record.fields && record.fields.permit_number) || (row && row.permit) || "");
  const dash = (row && row.dashboard) || {};
  return {
    id: String(record.portal_record_id),
    name: permit,
    projectNum: permit,
    projectId: String(record.portal_record_id),
    description: dash.description || "",
    location: dash.location || "",
    status: (row && row.status) || "",
    tasks: dash.tasks || "",
    href: dash.href || "",
    ...(row && Number.isInteger(row.dashboardPage) ? { dashboardPage: row.dashboardPage } : {}),
  };
}

/**
 * @param {object} deps
 * @param {object} deps.dcDeep
 * @param {object} deps.transport
 * @param {object} deps.repo
 * @param {object} deps.storage
 * @param {object|null} deps.pipeline
 * @param {string} deps.username
 * @param {string|null} deps.credentialId
 * @param {Function} [deps.log]
 */
function createDeepPass({ dcDeep, transport, repo, storage, pipeline = null, username, credentialId = null, log = () => {}, quiet = withQuietConsole, env = {} }) {
  const index = createDashboardIndex(transport);
  /** portal_record_id -> GetReportList items of the JSON pass in this job. */
  const reportListByRecord = new Map();
  let session = null;
  /** One download budget per job (D-074), sized on the first permit from env + job options. */
  let budget = null;

  async function getSession() {
    if (session) return session;
    const page = await transport.dashboardPage();
    let dashboardUrl;
    try {
      dashboardUrl = `${new URL(page.url()).origin}/`;
    } catch (_) {
      dashboardUrl = "https://planreview.dob.dc.gov/";
    }
    // The object /api/login builds for a DC ePlan session; no password (re-login is disabled, D-065).
    session = {
      status: "logged_in",
      portalType: "projectdox",
      portalSubtype: "dc-planreview",
      dcPlanReview: true,
      dcSessionOrigin: DC_SESSION_ORIGIN,
      dashboardUrl,
      webUiBase: dcDeep.deriveWebUiBase(dcDeep.DEFAULT_DASHBOARD_URL),
      browser: null,
      context: transport.context,
      page,
      username,
      credentialId,
      projects: [],
      data: {},
      progress: 0,
      total: 0,
      dcReloginDisabled: true,
      dcAuthHop: (fn) => transport.withAuthPhase(fn),
    };
    return session;
  }

  async function afterScrape(s) {
    transport.assertHealthy();
    transport.adoptDashboard(s.page);
    s.page = await transport.dashboardPage();
    s._dcExtractionPage = null;
  }

  /** Upload, then record at once, so a crash later in the pass never downloads this file again. */
  async function storeFile(ctx, { localPath, fileId, fileName }) {
    const doc = ctx.docsByFileId.get(String(fileId));
    if (!doc || doc.download_permitted !== true) return null;
    const body = fileDigest(localPath);
    const objectPath = policy.documentPath(ctx.permitId, fileId, doc.file_name || fileName);
    const ref = await storage.put(objectPath, body, contentTypeFor(doc.file_name || fileName));
    const r = await repo.recordDocument({ documentId: doc.id, status: "stored", storagePath: ref.path, sha256: ref.sha256, size: ref.size, contentType: ref.contentType, runId: ctx.runId });
    if (budget) budget.settle(fileId, ref.size);
    ctx.m.bytes_downloaded += ref.size || 0;
    if (r === "stored") ctx.m.files_downloaded += 1;
    else ctx.m.files_unchanged += 1;
    ctx.captured.add(String(fileId));
    return ref;
  }

  async function storeReport(permitId, reports, { localPath, kind, reportName }) {
    const rep = policy.matchReport(reports, reportName);
    if (!rep) return null;
    const body = fileDigest(localPath);
    const objectPath = policy.reportPath(permitId, rep.report_key, body.sha256, kind);
    return storage.put(objectPath, body, kind === "excel" ? contentTypeFor("x.xlsx") : contentTypeFor("x.pdf"));
  }

  /**
   * D-079: before a report is opened, its viewer URL is evaluated with the deep-mode guard (same deny patterns,
   * nothing lifted). A refused report is not opened: it is recorded failed (guard_denied) with a guard event and
   * the pass continues. Every request the browser actually makes still goes through the transport guard, and
   * a refusal there still fails the job.
   */
  async function precheckReport(ctx, reports, event, { reportName }) {
    const n = policy.normName(reportName);
    const item = ctx.reportItems.find((r) => policy.normName(r.name) === n) || null;
    const rep = policy.matchReport(reports, reportName);
    const url = policy.reportViewerUrl(item || { reportId: rep && rep.report_key, name: reportName }, DC_SESSION_ORIGIN, ctx.portalRecordId);
    const v = safety.evaluateRequest({ method: "GET", url, mode: "deep" });
    if (v.allowed) return { open: true };
    const at = policy.requestLocation("GET", url);
    await event("warn", "guard_denied", `${at.method} ${at.host}${at.path}`, { ...at, rule: v.rule, report_key: rep ? rep.report_key : null });
    ctx.m.reports_guard_denied += 1;
    if (rep) {
      await repo.recordReportFailure(ctx.permitId, rep.report_key, `guard_denied (${v.rule}): ${at.method} ${at.host}${at.path}`);
      ctx.reportsRecorded.set(rep.report_key, "failed");
      ctx.m.reports_failed += 1;
    }
    return { open: false, reason: "guard_denied" };
  }

  /** Records one Reports-tab entry as soon as it is finished; later entries for an already captured report are ignored. */
  async function recordReportEntry(ctx, reports, entry) {
    if (!entry || ctx.reportEntriesSeen.has(entry)) return;
    ctx.reportEntriesSeen.add(entry);
    if (entry.skipped) return;
    const rep = policy.matchReport(reports, entry.fileName);
    if (!rep) {
      ctx.m.reports_unmatched += 1;
      return;
    }
    const prev = ctx.reportsRecorded.get(rep.report_key);
    if (prev === "captured") return;
    if (policy.reportCaptured(entry)) {
      const out = await repo.recordReport(ctx.permitId, rep.report_key, policy.reportContent(entry, { pdf: entry.pdfStorageRef, excel: entry.excelStorageRef }), ctx.runId);
      if (out && out.result === "inserted") ctx.m.reports_captured += 1;
      else ctx.m.reports_unchanged += 1;
      ctx.reportsRecorded.set(rep.report_key, "captured");
    } else if (!prev) {
      await repo.recordReportFailure(ctx.permitId, rep.report_key, entry.error || "no report content");
      ctx.reportsRecorded.set(rep.report_key, "failed");
      ctx.m.reports_failed += 1;
    }
  }

  /** Files the gate let through but that were not stored are recorded as failed (retried when the files section changes). */
  async function recordFileFailures(ctx, filesTab) {
    for (const folder of (filesTab && filesTab.folders) || []) {
      for (const f of folder.files || []) {
        if (f.downloadGate || ctx.captured.has(String(f.fileId))) continue;
        const doc = ctx.docsByFileId.get(String(f.fileId));
        if (!doc || doc.download_permitted !== true) continue;
        await repo.recordDocument({ documentId: doc.id, status: "failed", error: String(f.downloadError || f.uploadStorageMessage || f.downloadStatus || "not_downloaded").slice(0, 300), runId: ctx.runId });
        ctx.m.files_failed += 1;
      }
    }
  }

  /** Entries the scraper did not hand to onReportEntry (none in the current scraper) are recorded here. */
  async function recordReports(ctx, reports, reportsTab) {
    for (const entry of (reportsTab && reportsTab.pdfs) || []) await recordReportEntry(ctx, reports, entry);
  }

  /** core/worker afterPermit hook. */
  async function afterPermit({ record, batch, result, job, event = async () => {} }) {
    const m = {
      deep_passes: 0, deep_skipped: 0, files_downloaded: 0, files_unchanged: 0, files_failed: 0, files_capped: 0, bytes_downloaded: 0,
      reports_captured: 0, reports_unchanged: 0, reports_failed: 0, reports_unmatched: 0, reports_guard_denied: 0,
      portal_syncs: 0, portal_changed: 0, pipeline_runs: 0, pipeline_skipped: 0, pipeline_failed: 0,
    };
    if (!budget) budget = policy.createDownloadBudget(policy.downloadLimits(env, job && job.options));
    const permitId = result && result.permit_id;
    if (!permitId) throw new Error("batch result has no permit_id");
    const hashes = policy.sectionHashes(batch);
    const [previousHashes, links, documents, reports] = await Promise.all([
      repo.deepState(permitId), repo.links(permitId), repo.documents(permitId), repo.reports(permitId),
    ]);
    const plan = policy.planDeepPass({ previousHashes, hashes, links, documents, reports });
    if (!plan.run) {
      if (policy.changedSections(previousHashes, hashes).length) await repo.recordDeepPass(permitId, hashes, job.id);
      m.deep_skipped = 1;
      return m;
    }

    const row = await index.locate(record.portal_record_id);
    const project = manualProject(record, row);
    if (!project.projectNum) throw new PortalChangedError("permit has no permit number for the deep pass");
    const s = await getSession();
    const ctx = {
      permitId, runId: job.id, m, captured: new Set(), docsByFileId: new Map(documents.map((d) => [String(d.portal_file_id), d])),
      portalRecordId: String(record.portal_record_id),
      reportItems: reportListByRecord.get(String(record.portal_record_id)) || [],
      reportsRecorded: new Map(),
      reportEntriesSeen: new Set(),
    };
    const deepOptions = {
      skipPortalSync: true,
      fileGate: policy.buildFileGate(documents, { retryFailed: plan.changed.includes("files"), budget }),
      storeFile: (a) => storeFile(ctx, a),
      storeReportArtifact: (a) => storeReport(permitId, reports, a),
      beforeReport: (a) => precheckReport(ctx, reports, event, a),
      onReportEntry: (entry) => recordReportEntry(ctx, reports, entry),
      isProtectedPage: (p) => transport.ownsPage(p) || p === s.page,
    };
    await event("info", "deep_pass_started", null, { portal_record_id: record.portal_record_id, tabs: plan.tabs, reasons: plan.reasons, budget: { max_files: budget.maxFiles, max_bytes: budget.maxBytes, files_used: budget.files } });
    const cappedBefore = budget.capped;
    s.status = "logged_in";
    s.data = {};
    try {
      await quiet(() => dcDeep.scrapeAll(s, [project], `permit-sync:${job.id}`, plan.tabs, null, null, false, null, null, null, deepOptions));
    } finally {
      await afterScrape(s);
    }
    m.files_capped = budget.capped - cappedBefore;
    const data = s.data[project.id];
    const tabs = (data && data.tabs) || {};
    let tabErrors = plan.tabs.filter((t) => !tabs[t] || tabs[t].error);
    // D-065: a lost portal session ends the job (retried with back-off); nothing from this pass is recorded.
    if (tabErrors.some((t) => tabs[t] && /session|re-login/i.test(String(tabs[t].error)))) {
      delete s.data[project.id];
      throw new SessionEndedError(`portal session lost during the deep pass (${tabErrors.join(", ")})`);
    }

    if (plan.tabs.includes("files") && tabs.files && !tabs.files.error) await recordFileFailures(ctx, tabs.files);
    if (plan.tabs.includes("reports") && tabs.reports && !tabs.reports.error) await recordReports(ctx, reports, tabs.reports);
    if (tabErrors.includes("reports")) {
      // D-074: a Reports tab that cannot render (e.g. an SSRS postback the read guard drops) marks the reports
      // failed and keeps the stored Reports tab; it is retried only when report inputs change, not every job.
      const why = `reports tab unavailable: ${String((tabs.reports && tabs.reports.error) || "no data")}`.slice(0, 300);
      for (const rep of reports) {
        if (rep.content_status === "captured" || ctx.reportsRecorded.has(rep.report_key)) continue;
        await repo.recordReportFailure(permitId, rep.report_key, why);
        m.reports_failed += 1;
      }
      if (data && data.tabs) delete data.tabs.reports;
      tabErrors = tabErrors.filter((t) => t !== "reports");
      await event("warn", "reports_unavailable", why, { portal_record_id: record.portal_record_id });
    }

    if (tabErrors.length === 0) {
      for (const link of links) {
        if (!policy.changedSections(link.syncedHashes || null, hashes).length) continue;
        if (!link.projectId || !link.ownerUserId) throw new Error("project link without project id or owner");
        s.data[project.id].permitRepositorySync = { permit_id: permitId, section_hashes: hashes };
        const ok = await quiet(() => dcDeep.syncPortalDataToSupabase(s, [project], link.projectId, link.ownerUserId, null, { forbidInsert: true, skipCredentialRepoint: true, contentHash: true }));
        if (!ok) throw new Error("portal_data sync to the linked project failed");
        m.portal_syncs += 1;
        const after = await repo.projectHash(link.projectId);
        if (!after || after === link.portalDataHash) continue;
        m.portal_changed += 1;
        if (!pipeline) continue;
        try {
          const t = await pipeline.trigger({ projectId: link.projectId, ownerUserId: link.ownerUserId, portalDataHash: after });
          if (t.outcome === "complete") m.pipeline_runs += 1;
          else if (t.outcome === "skipped_duplicate" || t.outcome === "disabled") m.pipeline_skipped += 1;
          else {
            m.pipeline_failed += 1;
            await event("warn", "pipeline_not_complete", t.outcome, { portal_record_id: record.portal_record_id });
          }
        } catch (err) {
          m.pipeline_failed += 1;
          await event("warn", "pipeline_failed", String((err && err.message) || "error").slice(0, 200), { portal_record_id: record.portal_record_id });
        }
      }
    }
    delete s.data[project.id];
    m.deep_passes = 1;
    if (tabErrors.length) throw new Error(`deep tabs failed: ${tabErrors.join(", ")}`);
    await repo.recordDeepPass(permitId, hashes, job.id);
    log({ code: "deep_pass_ok" });
    return m;
  }

  /** Adapter transport wrapper: fills the dashboard index and keeps each permit's report list (viewer metadata). */
  function wrapTransport(t) {
    const w = index.wrap(t);
    if (typeof w.listReports !== "function") return w;
    return {
      ...w,
      listReports: async (projectId) => {
        const items = await w.listReports(projectId);
        reportListByRecord.set(String(projectId), Array.isArray(items) ? items : []);
        return items;
      },
    };
  }

  return { afterPermit, wrapTransport, index };
}

module.exports = { createDeepPass, createDashboardIndex, manualProject, withQuietConsole };
