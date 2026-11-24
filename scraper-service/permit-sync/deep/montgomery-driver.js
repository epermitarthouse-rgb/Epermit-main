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
 * Every request still goes through the transport's deep-mode guard.
 *
 * Linked-project portal_data (G-8): syncPortalDataToSupabase writes the captured Files and Reports tabs to every
 * project linked to the permit, whichever project row that is (no project id appears in code). It reuses the DC
 * writer (register-execution-routes `syncPortalDataToSupabase`, forbidInsert + skipCredentialRepoint + contentHash)
 * for the write, the content hash and the capture bookkeeping, but hands it a payload built here so a Montgomery
 * link never wipes what the project already holds: the placeholder status/tasks/info tabs of this driver are not
 * sent, project text fields are not overwritten, and the captured files and reports are merged into the stored
 * tabs (fields the pass left empty keep their older value). With no linked project nothing is written.
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
const SUBTYPE = "montgomery-projectdox";
/** The Review Comments grid header in the rendered viewer text. */
const COMMENT_GRID = /\bref\s*#/i;
/** Thrown errors that end the pass instead of failing one file or report. */
const FATAL = [SafetyViolationError, SessionEndedError, ShutdownError, LeaseLostError];
const isFatal = (err) => FATAL.some((E) => err instanceof E);

function shortError(err) {
  return String((err && (err.code ? `${err.code}: ${err.message}` : err.message)) || err || "error").replace(/https?:\/\/\S+/gi, "<url>").slice(0, 300);
}


const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isEmpty = (v, key) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0) || (key === "commentCount" && v === 0);
const nameKey = (v) => String(v == null ? "" : v).trim().toLowerCase();
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** `fresh` with every empty field taken from `old`; keys in `freshOnly` are never taken from `old`. */
function fillEmpty(fresh, old, freshOnly = []) {
  const out = { ...fresh };
  if (!isPlainObject(old)) return out;
  for (const [k, v] of Object.entries(old)) {
    if (freshOnly.includes(k)) continue;
    if (isEmpty(out[k], k) && !isEmpty(v, k)) out[k] = clone(v);
  }
  return out;
}

const FILE_OUTCOME_KEYS = ["downloadStatus", "downloadError", "downloadGate", "storageRef", "uploadStorageMessage"];

/** One Files-tab entry: this pass's outcome wins when it attempted the file; otherwise the stored entry fills the gaps. */
function mergeFileEntry(fresh, old) {
  if (!old) return fresh;
  const attempted = Boolean(fresh.downloadStatus) && fresh.downloadStatus !== "not_downloaded";
  if (attempted) return fillEmpty(fresh, old, FILE_OUTCOME_KEYS);
  const { downloadStatus, ...rest } = fresh;
  const out = fillEmpty(rest, old, ["downloadGate"]);
  return { ...out, downloadStatus: out.downloadStatus || downloadStatus };
}

function mergeFolders(freshFolders, oldFolders) {
  const fresh = Array.isArray(freshFolders) ? freshFolders : [];
  const old = Array.isArray(oldFolders) ? oldFolders : [];
  const oldByName = new Map(old.map((f) => [nameKey(f && f.name), f]));
  const seen = new Set();
  const out = [];
  for (const folder of fresh) {
    const key = nameKey(folder.name);
    seen.add(key);
    const prev = oldByName.get(key);
    const prevFiles = (prev && Array.isArray(prev.files)) ? prev.files : [];
    // A folder that could not be listed, or came back empty while the project holds files for it, keeps the stored one.
    if (prev && (folder.folderError || ((folder.files || []).length === 0 && prevFiles.length > 0))) {
      out.push(clone(prev));
      continue;
    }
    const byId = new Map(prevFiles.filter((f) => f && f.fileId).map((f) => [String(f.fileId), f]));
    const byName = new Map(prevFiles.map((f) => [nameKey(f && f.name), f]));
    const files = (folder.files || []).map((f) => mergeFileEntry(f, byId.get(String(f.fileId)) || byName.get(nameKey(f.name))));
    out.push({ ...fillEmpty({ ...folder, files }, prev), files });
  }
  for (const folder of old) if (!seen.has(nameKey(folder && folder.name))) out.push(clone(folder));
  return out;
}

function mergeReports(freshPdfs, oldPdfs) {
  const fresh = Array.isArray(freshPdfs) ? freshPdfs : [];
  const old = Array.isArray(oldPdfs) ? oldPdfs : [];
  if (fresh.length === 0) return old.map(clone);
  const oldByName = new Map(old.map((r) => [nameKey(r && r.fileName), r]));
  const seen = new Set();
  const out = [];
  for (const report of fresh) {
    const key = nameKey(report.fileName);
    seen.add(key);
    const { skipped, unavailable, ...entry } = report;
    const merged = fillEmpty(entry, oldByName.get(key), ["error"]);
    if (skipped) merged.skipped = skipped;
    if (unavailable) merged.unavailable = unavailable;
    out.push(merged);
  }
  for (const report of old) if (!seen.has(nameKey(report && report.fileName))) out.push(clone(report));
  return out;
}

/** A captured tab merged into the stored tab: non-empty fresh values win, the stored tab's other keys stay. */
function mergeTab(fresh, old, listKey, mergeList) {
  const out = isPlainObject(old) ? clone(old) : {};
  for (const [k, v] of Object.entries(fresh)) {
    if (k === listKey || k === "cancelled" || k === "error" || isEmpty(v, k)) continue;
    out[k] = v;
  }
  out[listKey] = mergeList(fresh[listKey], isPlainObject(old) ? old[listKey] : undefined);
  return out;
}

/**
 * The portal_data the DC writer receives for one linked project. Only keys this pass actually captured are
 * present; the writer's merge ({...stored, ...payload, tabs: {...storedTabs, ...payloadTabs}}) therefore keeps
 * everything else (status, tasks, info, review tab, report entries, address metadata, ...).
 */
function buildLinkedPayload(data, existing) {
  const old = (existing && isPlainObject(existing.portal_data)) ? existing.portal_data : {};
  const oldTabs = isPlainObject(old.tabs) ? old.tabs : {};
  const payload = { projectNum: data.projectNum, portalType: "projectdox", portalSubtype: old.portalSubtype || SUBTYPE, tabs: {} };
  if (!old.name && data.name) payload.name = data.name;
  if (!old.description && data.description) payload.description = data.description;
  const status = (data.dashboardStatus && String(data.dashboardStatus).trim()) || old.dashboardStatus || (existing && existing.portal_status) || null;
  if (status) payload.dashboardStatus = status;
  if (data.permitRepositorySync) payload.permitRepositorySync = data.permitRepositorySync;
  const tabs = isPlainObject(data.tabs) ? data.tabs : {};
  if (isPlainObject(tabs.files) && !tabs.files.error) payload.tabs.files = mergeTab(tabs.files, oldTabs.files, "folders", mergeFolders);
  if (isPlainObject(tabs.reports) && !tabs.reports.error) payload.tabs.reports = mergeTab(tabs.reports, oldTabs.reports, "pdfs", mergeReports);
  return payload;
}

/**
 * @param {{
 *   transport: { getJson: Function, listReports: Function, fetchFile: Function, exportReport: Function },
 *   parseReviewExcel?: (excelPath: string) => Promise<object[]>,
 *   tmpRoot?: string,
 *   loadWriter?: () => { syncPortalDataToSupabase: Function, supabase?: object },  the DC writer export (loaded on first linked sync)
 *   readProject?: (projectId: string) => Promise<{ portal_data: object|null, portal_status?: string }|null>,
 * }} deps
 */
function createMontgomeryDeepDriver({ transport, parseReviewExcel = null, tmpRoot = os.tmpdir(), loadWriter = null, readProject = null, tenant = MONTGOMERY }) {
  if (!transport || typeof transport.fetchFile !== "function" || typeof transport.exportReport !== "function") {
    throw new Error("Montgomery deep driver needs a deep-mode transport (fetchFile, exportReport)");
  }
  const parse = parseReviewExcel || require("../../lib/reviewCommentsExcelStructuredRows").extractReviewCommentsStructuredRowsFromExcelFile;

  let writer = null;
  const getWriter = () => {
    if (!writer) writer = (loadWriter || (() => require("./app-loader").loadDcDeep()))();
    if (!writer || typeof writer.syncPortalDataToSupabase !== "function") throw new Error("Montgomery portal_data sync has no writer");
    return writer;
  };
  const readStored = readProject || (async (projectId) => {
    const client = getWriter().supabase;
    if (!client) throw new Error("Montgomery portal_data sync cannot read the linked project");
    const { data, error } = await client.from("projects").select("portal_data, portal_status").eq("id", projectId).maybeSingle();
    if (error) throw new Error(`linked project read failed: ${String(error.message || error).slice(0, 120)}`);
    return data || null;
  });

  const cancelled = (s) => Boolean(s._cancelRequested || s.dcDeepSessionLost);

  function fileRows(page) {
    if (Array.isArray(page)) return page;
    if (!page || typeof page !== "object") return [];
    for (const key of ["Items", "items", "Data", "data", "Files", "files", "Results", "results", "Rows", "rows"]) {
      if (Array.isArray(page[key])) return page[key];
    }
    return [];
  }

  async function filesTab(session, projectId, deep, tmp) {
    const pgc = tenant.key === "pgc-eplan";
    const folders = [];
    const list = await transport.getJson("project_folders", { projectID: projectId, folderID: "" });
    const parents = Array.isArray(list) ? list : fileRows(list);
    const selected = [...parents];
    if (pgc) {
      for (const folder of parents) {
        if (folder.FolderID === null || folder.FolderID === undefined) continue;
        let peek = [];
        try {
          peek = fileRows(await transport.getJson("folder_files", { folderID: folder.FolderID, listMode: 3, pageIndex: 0, pageSize: 500 }));
        } catch (err) {
          if (isFatal(err)) throw err;
        }
        if (peek.length) continue;
        try {
          const children = await transport.getJson("folder_children", {
            folderID: folder.FolderID,
            path: `PDEntityID:L${folder.FolderID}/@Children`,
            binding: "textKey:RowTemplate,valueKey:EntityID,primaryKey:PDEntityID,childDataProperty:Children,expandedKey:Expanded,checkedKey:__checked__",
            depth: 1,
          });
          for (const node of fileRows(children)) {
            const id = node.FolderID ?? node.folderID ?? node.EntityID ?? node.PDEntityID;
            if (id == null || String(id) === String(folder.FolderID)) continue;
            const rawName = node.Name || node.name || node.Text || String(id);
            selected.push({
              ...node,
              FolderID: id,
              Name: String(rawName).replace(/<[^>]+>/g, "").trim() || String(id),
              ParentName: String(folder.Name || "").replace(/<[^>]+>/g, "").trim(),
            });
          }
        } catch (err) {
          if (isFatal(err)) throw err;
        }
      }
    }
    for (const folder of selected) {
      const out = { name: String(folder.Name || ""), folderId: String(folder.FolderID || ""), parentFolder: String(folder.ParentName || ""), files: [] };
      const folderViewOnly = !(folder.FolderPermissions && folder.FolderPermissions.DownloadFile === true);
      folders.push(out);
      let items;
      try {
        const params = { folderID: folder.FolderID, listMode: 3, pageIndex: 0, pageSize: 500 };
        if (!pgc) params.projectID = projectId;
        const page = await transport.getJson("folder_files", params);
        items = fileRows(page);
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
            projectId,
            folderId: out.folderId,
            folderName: out.name,
            parentFolder: out.parentFolder,
            fileName: file.name,
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
        const out = await transport.exportReport({ url: policy.reportViewerUrl(item, tenant.uiOrigin, projectId, tenant.reportViewerPath, { includeReportId: policy.reportViewerIncludesId(tenant) }), dir, formats: ["EXCELOPENXML", "PDF"] });
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

    /**
     * Writes the captured Files and Reports tabs to the project linked to this permit (the runner calls this once
     * per linked project). No linked project: nothing is written and nothing fails (the permit-level steps do not
     * depend on a link). Returns the writer's result: true when every row was written or safely left as it was.
     */
    async syncPortalDataToSupabase(session, projects, projectId, userId, targetFolder = null, syncOptions = {}) {
      if (!projectId) return true;
      if (!syncOptions || syncOptions.forbidInsert !== true || syncOptions.skipCredentialRepoint !== true) {
        throw new Error("Montgomery portal_data sync must forbid inserts and credential re-points");
      }
      const dc = getWriter();
      let ok = true;
      for (const project of projects || []) {
        const data = session && session.data && session.data[project.id];
        if (!data) continue;
        const stored = await readStored(projectId);
        const payload = buildLinkedPayload(data, stored);
        const written = await dc.syncPortalDataToSupabase({ ...session, data: { [project.id]: payload } }, [project], projectId, userId, targetFolder, syncOptions);
        if (!written) ok = false;
      }
      return ok;
    },
  };
}

module.exports = { createMontgomeryDeepDriver, buildLinkedPayload };
