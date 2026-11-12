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
const { PortalChangedError, SessionEndedError, LeaseLostError } = require("../core/errors");

const DEFAULT_HEARTBEAT_MS = 60000;
/** Beats on progress (a stored file or report) at most this often; the interval covers long single downloads. */
const PROGRESS_BEAT_MIN_MS = 15000;

/**
 * Lease heartbeats during one deep pass (3d). The worker beats only between permits, and one deep pass can
 * outlast the lease. `heartbeat()` resolves false when the lease is gone (cancelled or reclaimed): the scraper
 * is told to stop at its next cancel check and the pass then ends with LeaseLostError.
 */
function createPassHeartbeat({ heartbeat, session, intervalMs, now = Date.now }) {
  let lost = false;
  let last = now();
  let inflight = null;
  const beat = async () => {
    if (!heartbeat || lost) return !lost;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const ok = await heartbeat();
        last = now();
        if (ok === false) {
          lost = true;
          if (session) session._cancelRequested = true;
        }
      } catch (_) {
        // A failed heartbeat call is not proof the lease is gone; the worker's next beat decides.
      } finally {
        inflight = null;
      }
      return !lost;
    })();
    return inflight;
  };
  const timer = heartbeat && intervalMs > 0 ? setInterval(() => { void beat(); }, intervalMs) : null;
  if (timer && typeof timer.unref === "function") timer.unref();
  return {
    beat,
    /** Beat after progress, throttled. */
    async progress() {
      if (now() - last >= Math.min(PROGRESS_BEAT_MIN_MS, intervalMs || PROGRESS_BEAT_MIN_MS)) await beat();
    },
    get lost() { return lost; },
    stop() { if (timer) clearInterval(timer); },
  };
}

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

  /**
   * Validate, upload, then record at once, so a crash later in the pass never fetches this file again.
   * A body that fails the content checks (3f) is recorded failed (retryable with back-off) and not stored.
   */
  async function storeFile(ctx, { localPath, fileId, fileName, downloadUrl = null }) {
    const doc = ctx.docsByFileId.get(String(fileId));
    const accessPath = policy.captureAccessPath(doc);
    if (!doc || !accessPath) return null;
    const name = doc.file_name || fileName;
    const body = fileDigest(localPath);
    const source = policy.fileSource(downloadUrl);
    const check = policy.validateFileBody({ buf: body.buf, fileName: name, portalSize: doc.size_bytes, isRendition: source.isRendition, fallbackContentType: contentTypeFor(name) });
    if (!check.ok) {
      await repo.recordDocument({ documentId: doc.id, status: "failed", accessPath, error: `invalid_content: ${check.error}`, sourceEndpoint: source.endpoint, runId: ctx.runId });
      ctx.failedRecorded.add(String(fileId));
      ctx.m.files_failed += 1;
      ctx.m.files_invalid += 1;
      return null;
    }
    const objectPath = policy.documentPath(ctx.permitId, fileId, name);
    const ref = await storage.put(objectPath, body, check.contentType);
    const r = await repo.recordDocument({
      documentId: doc.id, status: "stored", accessPath, storagePath: ref.path, sha256: ref.sha256, size: ref.size, contentType: check.contentType,
      sourceEndpoint: source.endpoint, isRendition: source.isRendition, sizeMatchesPortal: check.sizeMatchesPortal, runId: ctx.runId,
    });
    if (budget) budget.settle(fileId, ref.size);
    ctx.m.bytes_downloaded += ref.size || 0;
    if (r === "stored") ctx.m.files_downloaded += 1;
    else ctx.m.files_unchanged += 1;
    if (accessPath === "viewer") ctx.m.files_via_viewer += 1;
    if (source.isRendition) ctx.m.files_rendition += 1;
    if (check.sizeMatchesPortal === false) ctx.m.files_size_mismatch += 1;
    ctx.captured.add(String(fileId));
    await ctx.heartbeat.progress();
    return ref;
  }

  /** Uploads a report render; tracked until a content version references it, or removed (3e). */
  async function storeReport(ctx, reports, { localPath, kind, reportName }) {
    const rep = policy.matchReport(reports, reportName);
    if (!rep) return null;
    const body = fileDigest(localPath);
    const objectPath = policy.reportPath(ctx.permitId, rep.report_key, body.sha256, kind);
    const ref = await storage.put(objectPath, body, kind === "excel" ? contentTypeFor("x.xlsx") : contentTypeFor("x.pdf"));
    ctx.reportUploads.add(ref.path);
    return ref;
  }

  /**
   * Removes uploaded report objects no content version references (an unchanged report keeps its earlier
   * object; a failed or aborted entry leaves none). Paths another version references are always kept.
   */
  async function releaseReportUploads(ctx, paths) {
    for (const p of paths) {
      if (!p || !ctx.reportUploads.has(p)) continue;
      ctx.reportUploads.delete(p);
      try {
        if (typeof storage.remove !== "function" || typeof repo.reportObjectReferenced !== "function") continue;
        if (await repo.reportObjectReferenced(p)) continue;
        await storage.remove(p);
        ctx.m.report_objects_removed += 1;
      } catch (_) {
        ctx.m.report_objects_cleanup_failed += 1;
      }
    }
  }

  /**
   * D-079 / D-081: before a report is opened, its viewer URL is evaluated with the deep-mode guard. Report
   * identity values (ReportPath, ReportID, DataSourceName) are not deny-checked; the path and every other
   * parameter are. A refused report is not opened: it is recorded failed (guard_denied) with a guard event
   * and the pass continues. Every request the browser actually makes still goes through the transport guard,
   * and a refusal there still fails the job.
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
    const uploads = [entry.pdfStorageRef && entry.pdfStorageRef.path, entry.excelStorageRef && entry.excelStorageRef.path];
    try {
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
        await ctx.heartbeat.progress();
      } else if (!prev) {
        await repo.recordReportFailure(ctx.permitId, rep.report_key, entry.error || "no report content");
        ctx.reportsRecorded.set(rep.report_key, "failed");
        ctx.m.reports_failed += 1;
      }
    } finally {
      await releaseReportUploads(ctx, uploads);
    }
  }

  /** Files the gate let through but that were not stored are recorded failed (retried with back-off, D-080). */
  async function recordFileFailures(ctx, filesTab) {
    for (const folder of (filesTab && filesTab.folders) || []) {
      for (const f of folder.files || []) {
        const id = String(f.fileId);
        if (f.downloadGate || ctx.captured.has(id) || ctx.failedRecorded.has(id)) continue;
        const doc = ctx.docsByFileId.get(id);
        const accessPath = policy.captureAccessPath(doc);
        if (!doc || !accessPath) continue;
        await repo.recordDocument({ documentId: doc.id, status: "failed", accessPath, error: String(f.downloadError || f.uploadStorageMessage || f.downloadStatus || "not_downloaded").slice(0, 300), runId: ctx.runId });
        ctx.failedRecorded.add(id);
        ctx.m.files_failed += 1;
      }
    }
  }

  /** Entries the scraper did not hand to onReportEntry (none in the current scraper) are recorded here. */
  async function recordReports(ctx, reports, reportsTab) {
    for (const entry of (reportsTab && reportsTab.pdfs) || []) await recordReportEntry(ctx, reports, entry);
  }

  /** Records deferred_oversize for documents over the per-file limit (2b); they do not force reruns. */
  async function recordDeferrals(ctx, docs, limits) {
    for (const d of docs) {
      const accessPath = policy.captureAccessPath(d);
      if (!accessPath) continue;
      await repo.recordDocument({ documentId: d.id, status: "deferred_oversize", accessPath, error: `size ${d.size_bytes} bytes exceeds the per-file limit of ${limits.maxFileBytes} bytes`, runId: ctx.runId });
      ctx.m.files_deferred_oversize_recorded += 1;
    }
  }

  /** Starts the agent pipeline for each linked project's current hash unless a run for it exists (6c, D-063). */
  async function triggerPipelines(m, links, event, record) {
    if (!pipeline) return;
    for (const link of links) {
      const hash = link.currentHash;
      if (!hash || !link.projectId || !link.ownerUserId) continue;
      try {
        const t = await pipeline.trigger({ projectId: link.projectId, ownerUserId: link.ownerUserId, portalDataHash: hash });
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

  function emptyMetrics() {
    return {
      deep_passes: 0, deep_skipped: 0, files_downloaded: 0, files_unchanged: 0, files_failed: 0, files_invalid: 0, files_capped: 0, bytes_downloaded: 0,
      files_via_viewer: 0, files_rendition: 0, files_size_mismatch: 0, files_deferred_oversize_recorded: 0,
      files_pending: 0, files_deferred_oversize: 0, files_failed_open: 0, reports_open: 0,
      reports_captured: 0, reports_unchanged: 0, reports_failed: 0, reports_unmatched: 0, reports_guard_denied: 0,
      report_objects_removed: 0, report_objects_cleanup_failed: 0,
      portal_syncs: 0, portal_changed: 0, pipeline_runs: 0, pipeline_skipped: 0, pipeline_failed: 0,
    };
  }

  /** Post-pass open items (D-086) for the job outcome. */
  async function countOpenItems(m, permitId, limits) {
    const [documents, reports] = await Promise.all([repo.documents(permitId), repo.reports(permitId)]);
    Object.assign(m, policy.openItems({ documents, reports, limits }));
    return { documents, reports };
  }

  /** core/worker afterPermit hook. `heartbeat` (optional) renews the job lease and resolves false when it is lost. */
  async function afterPermit({ record, batch, result, job, event = async () => {}, heartbeat = null }) {
    const m = emptyMetrics();
    if (!budget) budget = policy.createDownloadBudget(policy.downloadLimits(env, job && job.options));
    const limits = policy.captureLimits(env, job && job.options);
    const permitId = result && result.permit_id;
    if (!permitId) throw new Error("batch result has no permit_id");
    const hashes = policy.sectionHashes(batch);
    const [previousHashes, links, documents, reports] = await Promise.all([
      repo.deepState(permitId), repo.links(permitId), repo.documents(permitId), repo.reports(permitId),
    ]);
    const now = Date.now();
    const plan = policy.planDeepPass({ previousHashes, hashes, links, documents, reports, now, limits, captureHash: policy.captureHash(documents, reports) });
    const ctxBase = { permitId, runId: job.id, m };
    if (plan.deferDocuments.length) await recordDeferrals(ctxBase, plan.deferDocuments, limits);
    if (!plan.run) {
      if (policy.changedSections(previousHashes, hashes).length) await repo.recordDeepPass(permitId, hashes, job.id);
      m.deep_skipped = 1;
      await countOpenItems(m, permitId, limits);
      await triggerPipelines(m, links.map((l) => ({ ...l, currentHash: l.portalDataHash })), event, record);
      return m;
    }

    const row = await index.locate(record.portal_record_id);
    const project = manualProject(record, row);
    if (!project.projectNum) throw new PortalChangedError("permit has no permit number for the deep pass");
    const s = await getSession();
    const hb = createPassHeartbeat({ heartbeat, session: s, intervalMs: Number(env.PERMIT_SYNC_DEEP_HEARTBEAT_MS) > 0 ? Number(env.PERMIT_SYNC_DEEP_HEARTBEAT_MS) : DEFAULT_HEARTBEAT_MS });
    const ctx = {
      ...ctxBase, captured: new Set(), failedRecorded: new Set(), docsByFileId: new Map(documents.map((d) => [String(d.portal_file_id), d])),
      portalRecordId: String(record.portal_record_id),
      reportItems: reportListByRecord.get(String(record.portal_record_id)) || [],
      reportsRecorded: new Map(),
      reportEntriesSeen: new Set(),
      reportUploads: new Set(),
      heartbeat: hb,
    };
    const deepOptions = {
      skipPortalSync: true,
      fileGate: policy.buildFileGate(documents, { filesChanged: plan.filesChanged, budget, now, limits }),
      storeFile: (a) => storeFile(ctx, a),
      storeReportArtifact: (a) => storeReport(ctx, reports, a),
      beforeReport: (a) => precheckReport(ctx, reports, event, a),
      onReportEntry: (entry) => recordReportEntry(ctx, reports, entry),
      // Protect the extraction popup too: the pre-download sweep closes every other page, and if
      // downloadProjectDoxFile's `page` arg ever differs from `_dcExtractionPage` the reopen path
      // used to race waitForEvent and crash the worker on an unhandled timeout.
      isProtectedPage: (p) => transport.ownsPage(p) || p === s.page || p === s._dcExtractionPage,
      maxFileBytes: limits.maxFileBytes,
      preferOriginal: true,
    };
    await event("info", "deep_pass_started", null, { portal_record_id: record.portal_record_id, tabs: plan.tabs, reasons: plan.reasons, budget: { max_files: budget.maxFiles, max_bytes: budget.maxBytes, files_used: budget.files, max_file_bytes: limits.maxFileBytes } });
    const cappedBefore = budget.capped;
    s.status = "logged_in";
    s.data = {};
    s._cancelRequested = false;
    s.dcDeepSessionLost = null;
    try {
      try {
        await quiet(() => dcDeep.scrapeAll(s, [project], `permit-sync:${job.id}`, plan.tabs, null, null, false, null, null, null, deepOptions));
      } finally {
        hb.stop();
        await afterScrape(s);
      }
      if (hb.lost) {
        delete s.data[project.id];
        throw new LeaseLostError();
      }
      // 3c: the scraper refused to re-initialize the browser or re-login (no guard, no password in a deep run).
      if (s.dcDeepSessionLost) {
        delete s.data[project.id];
        throw new SessionEndedError(`portal session lost during the deep pass (${s.dcDeepSessionLost})`);
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
        // D-074: a Reports tab that cannot render marks the open reports failed (retried with back-off, D-080)
        // and keeps the stored Reports tab.
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

      const after = await countOpenItems(m, permitId, limits);
      const capture = policy.captureHash(after.documents, after.reports);
      const current = [];
      if (tabErrors.length === 0) {
        for (const link of links) {
          const stale = policy.changedSections(link.syncedHashes || null, hashes).length > 0 || link.captureHash !== capture;
          if (!stale) {
            current.push({ ...link, currentHash: link.portalDataHash });
            continue;
          }
          if (!link.projectId || !link.ownerUserId) throw new Error("project link without project id or owner");
          s.data[project.id].permitRepositorySync = { permit_id: permitId, section_hashes: hashes, capture_hash: capture };
          const ok = await quiet(() => dcDeep.syncPortalDataToSupabase(s, [project], link.projectId, link.ownerUserId, null, { forbidInsert: true, skipCredentialRepoint: true, contentHash: true }));
          if (!ok) throw new Error("portal_data sync to the linked project failed");
          m.portal_syncs += 1;
          const hash = await repo.projectHash(link.projectId);
          if (hash && hash !== link.portalDataHash) m.portal_changed += 1;
          current.push({ ...link, currentHash: hash });
        }
        await triggerPipelines(m, current, event, record);
      }
      delete s.data[project.id];
      m.deep_passes = 1;
      if (tabErrors.length) throw new Error(`deep tabs failed: ${tabErrors.join(", ")}`);
      await repo.recordDeepPass(permitId, hashes, job.id);
      log({ code: "deep_pass_ok" });
      return m;
    } finally {
      hb.stop();
      await releaseReportUploads(ctx, [...ctx.reportUploads]);
    }
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
