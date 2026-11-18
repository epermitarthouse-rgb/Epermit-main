"use strict";

/**
 * Montgomery deep driver (MONTGOMERY_GAPS.md G-1, option B). The deep runner (runner.js) drives the manual DC
 * scraper through `scrapeAll(session, [project], ..., tabs, ..., deepOptions)` and reads `session.data[id].tabs`.
 * The manual Montgomery flow (scrapeMontgomeryAll) has none of the deepOptions hooks, so this driver implements
 * the same contract over the Montgomery live transport instead:
 *
 *   files    folders and files from the same JSON routes as the JSON pass; each file passes the runner's
 *            fileGate first; bodies come from transport.fetchFile (Web API RetrieveFile) and go to
 *            deepOptions.storeFile, which validates, stores privately and records provenance.
 *   reports  GetReportList items; each report URL passes deepOptions.beforeReport (guard pre-check) before it
 *            is opened; transport.exportReport renders it in the ReportViewer and saves the SSRS Excel and PDF
 *            exports; both go to deepOptions.storeReportArtifact. The Review Comments Excel export is parsed by
 *            the shared deterministic parser (lib/reviewCommentsExcelStructuredRows.js) into structuredRows,
 *            which the JSON pass reads back through the D-103 stored-report fallback.
 *   status, tasks, info   already read by the JSON pass; returned empty (no portal requests).
 *
 * Every request still goes through the transport's deep-mode guard. Linked-project portal_data sync is not
 * available for Montgomery (project linking is not approved): syncPortalDataToSupabase refuses.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const deepOptionsLib = require("../../lib/dc-deep-options");
const policy = require("./policy");
const { MONTGOMERY } = require("../adapters/projectdox-tenants");
const { SafetyViolationError, SessionEndedError, ShutdownError, LeaseLostError } = require("../core/errors");

const REVIEW_COMMENTS = /review comments/i;
/** The Review Comments grid header in the rendered viewer text. */
const COMMENT_GRID = /\bref\s*#/i;
/** Thrown errors that end the pass instead of failing one file or report. */
const FATAL = [SafetyViolationError, SessionEndedError, ShutdownError, LeaseLostError];
const isFatal = (err) => FATAL.some((E) => err instanceof E);

function shortError(err) {
  return String((err && (err.code ? `${err.code}: ${err.message}` : err.message)) || err || "error").replace(/https?:\/\/\S+/gi, "<url>").slice(0, 300);
}

/**
 * @param {{
 *   transport: { getJson: Function, listReports: Function, fetchFile: Function, exportReport: Function },
 *   parseReviewExcel?: (excelPath: string) => Promise<object[]>,
 *   tmpRoot?: string,
 * }} deps
 */
function createMontgomeryDeepDriver({ transport, parseReviewExcel = null, tmpRoot = os.tmpdir() }) {
  if (!transport || typeof transport.fetchFile !== "function" || typeof transport.exportReport !== "function") {
    throw new Error("Montgomery deep driver needs a deep-mode transport (fetchFile, exportReport)");
  }
  const parse = parseReviewExcel || require("../../lib/reviewCommentsExcelStructuredRows").extractReviewCommentsStructuredRowsFromExcelFile;

  const cancelled = (s) => Boolean(s._cancelRequested || s.dcDeepSessionLost);

  async function filesTab(session, projectId, deep, tmp) {
    const folders = [];
    const list = await transport.getJson("project_folders", { projectID: projectId, folderID: "" });
    for (const folder of Array.isArray(list) ? list : []) {
      const out = { name: String(folder.Name || ""), folderId: String(folder.FolderID || ""), files: [] };
      const folderViewOnly = !(folder.FolderPermissions && folder.FolderPermissions.DownloadFile === true);
      folders.push(out);
      let items;
      try {
        const page = await transport.getJson("folder_files", { folderID: folder.FolderID, projectID: projectId, listMode: 3, pageIndex: 0, pageSize: 500 });
        items = (page && page.Items) || [];
      } catch (err) {
        if (isFatal(err)) throw err;
        out.folderError = shortError(err);
        continue;
      }
      for (const item of items) {
        if (cancelled(session)) return { folders, cancelled: true };
        const file = { id: String(item.FileID), name: String(item.FileName || ""), status: item.FileStatus || null, uploadedDate: item.UploadDate || null };
        const gate = deepOptionsLib.fileGateDecision(deep, file);
        if (gate && !gate.download) {
          out.files.push(deepOptionsLib.gatedFileEntry(file, out.name, gate));
          continue;
        }
        const entry = { name: file.name, fileId: file.id, folderName: out.name, status: file.status, uploadedDate: file.uploadedDate, commentCount: 0, comments: [], viewUrl: "" };
        const localPath = path.join(tmp, `${crypto.randomUUID()}_${policy.safeName(file.name)}`);
        try {
          const body = await transport.fetchFile(file.id, {
            viewerOnly: folderViewOnly || !gate || gate.accessPath !== "download",
            preferOriginal: deepOptionsLib.prefersOriginal(deep),
            maxBytes: deepOptionsLib.maxFileBytes(deep, policy.DEFAULT_MAX_FILE_BYTES),
          });
          fs.writeFileSync(localPath, body.buf);
          const ref = await deep.storeFile({ localPath, fileId: file.id, fileName: file.name, downloadUrl: body.url });
          entry.downloadStatus = ref ? "success" : "failed";
          if (ref) entry.storageRef = ref;
        } catch (err) {
          if (isFatal(err)) throw err;
          entry.downloadStatus = "failed";
          entry.downloadError = shortError(err);
        } finally {
          fs.rmSync(localPath, { force: true });
        }
        out.files.push(entry);
      }
    }
    return { keyValues: [], tables: [], links: [], folders };
  }

  async function reportsTab(session, projectId, deep, tmp) {
    const pdfs = [];
    const items = await transport.listReports(projectId);
    for (const item of Array.isArray(items) ? items : []) {
      if (cancelled(session)) break;
      // Not opened: SSRS cannot render a report listed with an empty workflow parameter (D-144).
      if (policy.reportNeedsWorkflow(item)) {
        const entry = { fileName: item.name, text: "", pages: null, error: policy.REPORT_NEEDS_WORKFLOW, unavailable: true };
        pdfs.push(entry);
        await deepOptionsLib.reportFinished(deep, entry);
        continue;
      }
      const skipped = await deepOptionsLib.reportSkipEntry(deep, item.name);
      if (skipped) {
        pdfs.push(skipped);
        await deepOptionsLib.reportFinished(deep, skipped);
        continue;
      }
      const entry = { fileName: item.name, text: "", pages: null };
      const dir = fs.mkdtempSync(path.join(tmp, "report-"));
      try {
        const out = await transport.exportReport({ url: policy.reportViewerUrl(item, MONTGOMERY.uiOrigin, projectId), dir, formats: ["EXCELOPENXML", "PDF"] });
        entry.text = String(out.text || "");
        entry.pages = Number.isInteger(out.pages) ? out.pages : null;
        if (out.excelPath) {
          entry.excelStorageRef = await deep.storeReportArtifact({ localPath: out.excelPath, kind: "excel", reportName: item.name });
          if (REVIEW_COMMENTS.test(item.name)) {
            const rows = await parse(out.excelPath);
            if (Array.isArray(rows) && rows.length) {
              entry.structuredRows = rows;
              entry.structuredRowsSource = "excel";
            }
          }
        }
        if (out.pdfPath) entry.pdfStorageRef = await deep.storeReportArtifact({ localPath: out.pdfPath, kind: "pdf", reportName: item.name });
        if (!entry.excelStorageRef && !entry.pdfStorageRef) entry.error = out.error ? String(out.error).slice(0, 300) : "no report export";
        // An export without the comment rows the viewer shows is not a capture: recorded failed (retryable), uploads released.
        if (REVIEW_COMMENTS.test(item.name) && !entry.error && !entry.structuredRows && COMMENT_GRID.test(entry.text)) {
          entry.error = `review_comments_excel_without_rows${out.error ? ` (${String(out.error).slice(0, 120)})` : ""}`;
        }
      } catch (err) {
        if (isFatal(err)) throw err;
        entry.error = shortError(err);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      pdfs.push(entry);
      await deepOptionsLib.reportFinished(deep, entry);
    }
    return { keyValues: [], tables: [], links: [], pdfs };
  }

  return {
    DEFAULT_DASHBOARD_URL: `${MONTGOMERY.portalOrigin}/Home/Index`,
    deriveWebUiBase: () => MONTGOMERY.uiOrigin,

    async scrapeAll(session, projects, _sid, tabs, supabaseProjectId, userId, _c, _tf, _tfs, _hint, deep) {
      if (supabaseProjectId !== null || userId !== null) throw new Error("deep scrape must not target a project");
      if (!deep || deep.skipPortalSync !== true) throw new Error("deep scrape must skip the portal sync");
      if (!session.dcReloginDisabled) throw new Error("session is not a deep session");
      const project = projects[0];
      const data = { name: project.name, projectNum: project.projectNum, description: project.description, location: project.location, dashboardStatus: project.status, portalType: "projectdox", tabs: {} };
      session.data[project.id] = data;
      const tmp = fs.mkdtempSync(path.join(tmpRoot, "montgomery-deep-"));
      try {
        for (const t of tabs) {
          if (cancelled(session)) break;
          if (t === "files") data.tabs.files = await filesTab(session, project.projectId, deep, tmp);
          else if (t === "reports") data.tabs.reports = await reportsTab(session, project.projectId, deep, tmp);
          else data.tabs[t] = { keyValues: [], tables: [], links: [], source: "json_pass" };
        }
      } catch (err) {
        if (err instanceof SessionEndedError) {
          session.dcDeepSessionLost = "session_ended";
          return { cancelled: true };
        }
        throw err;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      session.status = "done";
      return { deep: true };
    },

    async syncPortalDataToSupabase() {
      throw new Error("Montgomery linked-project portal_data sync is not available (project linking is not approved)");
    },
  };
}

module.exports = { createMontgomeryDeepDriver };
