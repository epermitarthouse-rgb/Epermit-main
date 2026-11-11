"use strict";

/**
 * Pure normalizers: DC ProjectDox payloads (see docs/permit-repository/EXTRACTION_SPEC_DC.md)
 * → canonical repository fields. No network, no Playwright.
 *
 * Personal data rule: reviewer and responder names are reduced to role labels and contact
 * emails/phones are never mapped. ProjectDox ids are the identities (D-001): ProjectID for the
 * permit, FolderID, FileID (one per version), WFlowInstanceID, WFlowTaskID, REF # for comments.
 */

const { keyedItem } = require("../../core/canonical");

const ADAPTER_KEY = "dc-projectdox";
const JURISDICTION = "Washington DC";

const STATUS_MAP = Object.freeze({
  upload: "upload",
  "in review": "in_review",
  resubmit: "resubmit",
  approved: "approved",
});

const PLACEHOLDER_DATE = /^0001-01-01/;

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function int(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function bool(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|yes|1)$/i.test(v.trim());
  return Boolean(v);
}

const PORTAL_TIME_ZONE = "America/New_York";
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

function zoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

/** Wall-clock time in `timeZone` → UTC ISO string (DST-aware). */
function zonedToUtcIso(local, timeZone = PORTAL_TIME_ZONE) {
  const m = LOCAL_DATETIME.exec(local);
  if (!m) return local;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let utc = wall - zoneOffsetMs(wall, timeZone);
  utc = wall - zoneOffsetMs(utc, timeZone);
  return new Date(utc).toISOString();
}

/**
 * ISO date/time or null; ProjectDox uses 0001-01-01 as "no value".
 * Offset-less date-times are portal wall-clock time and are converted to UTC so the database never
 * interprets them in the server zone. The JSON values carry the same wall clock the SSRS report prints,
 * and that clock read as America/New_York (EST) on 2026-11-05; DST handling follows the IANA zone.
 */
function date(v) {
  const s = str(v);
  if (!s || PLACEHOLDER_DATE.test(s)) return null;
  return LOCAL_DATETIME.test(s) ? zonedToUtcIso(s) : s;
}

function normalizePermitNumber(v) {
  const s = str(v);
  return s ? s.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
}

function mapStatus(raw) {
  const s = str(raw);
  if (!s) return null;
  return STATUS_MAP[s.toLowerCase()] || "other";
}

/** Dashboard "My Projects" row → discovery record. */
function discoveryRecord(row) {
  const portalId = str(row.projectId ?? row.ProjectID);
  if (!portalId) throw new Error(`dashboard row ${row.permit || "?"} has no ProjectID`);
  return {
    portal_record_id: portalId,
    fields: {
      jurisdiction: JURISDICTION,
      permit_number: str(row.permit),
      permit_number_normalized: normalizePermitNumber(row.permit),
      status: mapStatus(row.status),
      status_raw: str(row.status),
      title: str(row.title),
      description: str(row.description),
      address: str(row.address),
    },
  };
}

/** GetWorkflowInstanceStatusData → permit fields (status section). */
function statusFields(data) {
  const subs = Array.isArray(data.SubWorkflows) ? data.SubWorkflows : [];
  const unresolved = subs.reduce((n, s) => n + (int(s.UnresolvedComments) || 0), 0);
  const tasks = subs.reduce((n, s) => n + (Array.isArray(s.UncompletedTasks) ? s.UncompletedTasks.length : 0), 0);
  return {
    status: mapStatus(data.ProjectStatus),
    status_raw: str(data.ProjectStatus),
    review_type: str(data.ReviewType),
    total_files: int(data.TotalNumberOfFiles),
    unresolved_comments: subs.length ? unresolved : null,
    uncompleted_tasks: int(data.UncompleteTaskCount) ?? (subs.length ? tasks : null),
    summary: {
      calendar_type: str(data.CalendarType),
      time_elapsed: str(data.TimeElapsed && data.TimeElapsed.FormattedText),
      unresolved_by_group: subs.flatMap((s) =>
        (s.UnresolvedByGroup || []).map((g) => ({ group: str(g.GroupName), unresolved: int(g.UnresolvedComments) || 0 })),
      ),
      open_task_groups: subs.flatMap((s) => (s.UncompletedTasks || []).map((t) => str(t.GroupName))),
    },
  };
}

/** Status JSON → expected unresolved total, used for parity checks against Reviews rows. */
function statusUnresolvedTotal(data) {
  const subs = Array.isArray(data.SubWorkflows) ? data.SubWorkflows : [];
  if (!subs.length) return null;
  return subs.reduce((n, s) => n + (int(s.UnresolvedComments) || 0), 0);
}

/** GetWorkflowInstancesList.Records[] → permit_workflows items. */
function workflowItems(records) {
  return (records || []).map((r) =>
    keyedItem(r.WFlowInstanceID, {
      name: str(r.InstanceName),
      subtype: str(r.WFlowSubtypeName),
      state: str(r.WFlowInstanceStateName),
      current_activity: str(r.CurrentActivity),
      coordinator_group: str(r.CoordinatorGroup),
      version_num: int(r.VersionNum),
      version_title: str(r.VersionTitle),
      integration_mode: str(r.IntegrationModeName),
      started_at: date(r.DateStarted),
      portal_updated_at: date(r.DateUpdated),
      completed_at: date(r.DateCompleted),
    }),
  );
}

/**
 * GetActiveWorkflowTaskList `Tasks[]` (+ status JSON UncompletedTasks) → permit_tasks items.
 * Observed on the task list: WFlowTaskID, WFlowInstanceID, TaskName, GroupName, TaskStatus, DateAccepted,
 * DateDue, DateCompleted. DateCreated is observed but not mapped (task creation is not workflow start).
 */
function taskItems(tasks) {
  return (tasks || []).map((t) =>
    keyedItem(t.WFlowTaskID, {
      workflow_portal_id: str(t.WFlowInstanceID),
      name: str(t.TaskName ?? t.ActivityName ?? t.WFlowActivityName),
      group_name: str(t.GroupName),
      status: str(t.TaskStatus ?? t.TaskStatusName ?? t.StatusName),
      accepted: date(t.DateAccepted) ? true : t.Accepted === undefined ? null : bool(t.Accepted),
      assigned_to_current_account: t.AssignedToCurrentUser === undefined ? null : bool(t.AssignedToCurrentUser),
      started_at: date(t.DateStarted ?? t.StartDate),
      due_at: date(t.DateDue ?? t.DueDate),
      completed_at: date(t.DateCompleted),
    }),
  );
}

function folderPermissions(folder) {
  const p = folder.permissions || folder.FolderPermissions || null;
  if (!p || p.DownloadFile === undefined) return null;
  return bool(p.DownloadFile);
}

/** Folder key: FolderID; fixtures that lack it fall back to the folder name. */
function folderKey(folder) {
  return str(folder.FolderID) || `name:${str(folder.Name)}`;
}

/**
 * GetProjectFolders + GetFolderFiles → folder and document items.
 * `accountDownload` is the account-level DownloadFile flag (false for the DC account, D-014);
 * a folder-level flag, when present, wins.
 */
function fileItems(folders, filesByFolderKey = {}, { accountDownload = null } = {}) {
  const folderOut = [];
  const docOut = [];
  for (const f of folders || []) {
    const key = folderKey(f);
    const permitted = folderPermissions(f) ?? accountDownload;
    folderOut.push(
      keyedItem(key, {
        name: str(f.Name),
        folder_type: int(f.FolderType),
        parent_portal_folder_id: str(f.ParentFolderID),
        files_count: int(f.FilesCount),
        new_files_count: int(f.NewFilesCount),
        files_with_markups_count: int(f.FilesWithMarkupsCount),
        download_permitted: permitted,
      }),
    );
    for (const file of filesByFolderKey[key] || []) {
      docOut.push(
        keyedItem(file.FileID, {
          version: int(file.Version),
          portal_folder_id: key,
          folder_name: str(f.Name),
          file_name: str(file.FileName),
          original_file_name: str(file.OriginalFileName),
          file_status: str(file.FileStatus),
          file_type_id: int(file.FileTypeID),
          size_bytes: int(file.FileSize),
          page_count: int(file.PageCount),
          sheet_size: str(file.SheetSize),
          review_cycle: int(file.ReviewCycle),
          has_markups: file.HasMarkups === undefined ? null : bool(file.HasMarkups),
          uploaded_by_org: null,
          uploaded_at: date(file.UploadDate),
          published_at: date(file.PublishDate),
          portal_modified_at: date(file.LastModDate),
          download_permitted: permitted,
        }),
      );
    }
  }
  return { folders: folderOut, documents: docOut };
}

/**
 * Reviews tab rows (ProjectCorrections) → comment + response items.
 * Comment key is `ref:<REF #>` (unique per project in observed data); responses `ref:<n>:r<seq>`.
 */
function reviewItems(rows, { sourceKind = "html" } = {}) {
  const comments = [];
  const responses = [];
  for (const row of rows || []) {
    const ref = int(row.ref);
    if (ref === null) throw new Error("review row without REF #");
    const key = `ref:${ref}`;
    const responseColumn = str(row.responseColumn) || "";
    comments.push(
      keyedItem(key, {
        ref_number: ref,
        workflow_portal_id: str(row.workflowInstanceId),
        department: str(row.department),
        reviewer_name: null,
        reviewer_role: str(row.reviewer) ? "reviewer" : null,
        cycle: int(row.cycle),
        status: str(row.status),
        comment_type: str(row.type),
        body: str(row.text),
        file_name: str(row.fileName),
        reviewed_at: date(row.reviewedAt),
        response_required: /no response required/i.test(responseColumn) ? false : str(row.status) === "Unresolved" ? true : null,
        source_kind: sourceKind,
      }),
    );
    (row.responses || []).forEach((r, i) => {
      responses.push(
        keyedItem(`${key}:r${i + 1}`, {
          comment_key: key,
          seq: i + 1,
          responder_role: str(r.by) || "applicant",
          responder_name: null,
          responded_at: date(r.at),
          body: str(r.text),
        }),
      );
    });
  }
  return { comments, responses };
}

const HTML_ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " });

/** Comment HTML (CommentText may be rich text) → visible text; mailbox addresses become "[email]". */
function htmlToText(v) {
  const s = str(v);
  if (!s) return null;
  const t = s
    .replace(/<\s*\/?\s*(br|p|div|li|ul|ol|tr|td|th|h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return HTML_ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

/**
 * GetProjectCorrectionsByCycleInstance → rows in the reviewItems shape. Returns null when the payload
 * has no Corrections array. Field mapping verified against the rendered Reviews tab for 11854
 * (DC_DEEP_EXTRACTION_REQUIREMENTS.md §3.5). Reviewer and responder names are never read.
 */
function correctionRowsFromJson(data) {
  const list = data && Array.isArray(data.Corrections) ? data.Corrections : null;
  if (!list) return null;
  return list.map((c) => {
    const status = str(c.StatusName);
    const fileName = str(c.FileName);
    const responses = (Array.isArray(c.Discussions) ? c.Discussions : [])
      .map((n) => ({
        by: str(n.ResponseType) ? str(n.ResponseType).toLowerCase() : null,
        at: str(n.DateUpdated),
        text: htmlToText(n.Description),
      }))
      .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
    return {
      ref: int(c.ReferenceNumber),
      workflowInstanceId: str(c.WFlowInstanceID),
      department: str(c.Department),
      reviewer: str(c.ReviewerName) ? "reviewer" : null,
      reviewedAt: str(c.DateCreated),
      cycle: int(c.ReviewCycle),
      status,
      type: str(c.CorrectionType),
      text: htmlToText(c.CommentText),
      // The portal sends the literal "None" when no sheet is attached; the Reviews tab and report show blank.
      fileName: fileName && !/^none$/i.test(fileName) ? fileName : null,
      responses,
      responseColumn: c.RequireApplicantResponse === true
        ? "Type your response here."
        : status === "Info Only" ? "No response required." : "none",
    };
  });
}

/**
 * GetReportList items → listReports shape. `viewer` holds the ReportViewer.aspx query parts the Reports tab
 * opens, so the deep pass can check each report's URL against the guard before opening it (D-079).
 */
function reportListItems(list) {
  return (Array.isArray(list) ? list : []).map((r) => {
    const item = {
      key: str(r.QueryReportID),
      name: str(r.QueryReportTitle),
      category: str(r.ReportType),
      reportId: str(r.QueryReportID),
    };
    if (r.ReportPath) {
      item.viewer = { reportPath: String(r.ReportPath), dataSourceName: String(r.ReportDataSourceName || ""), paramQuery: String(r.ReportParamQueryString || "") };
    }
    return item;
  });
}

/** Reports tab listing → permit_reports items. */
function reportItems(reports) {
  return (reports || []).map((r) =>
    keyedItem(str(r.key) || str(r.name), {
      name: str(r.name),
      category: str(r.category),
      portal_report_id: str(r.reportId),
    }),
  );
}

/** ProjectInfo fields → permit fields. Contact emails/phones are deliberately not mapped. */
function infoFields(info) {
  return {
    title: str(info.projectName ?? info.title),
    description: str(info.description),
    address: str(info.address),
    job_class: str(info.jobClass),
    owner_org: str(info.ownerOrg),
    contact_org: str(info.contactOrg),
    project_start_date: date(info.startDate),
    project_end_date: date(info.endDate),
  };
}

module.exports = {
  ADAPTER_KEY,
  JURISDICTION,
  PORTAL_TIME_ZONE,
  zonedToUtcIso,
  normalizePermitNumber,
  mapStatus,
  discoveryRecord,
  statusFields,
  statusUnresolvedTotal,
  workflowItems,
  taskItems,
  fileItems,
  folderKey,
  reviewItems,
  htmlToText,
  correctionRowsFromJson,
  reportListItems,
  reportItems,
  infoFields,
};
