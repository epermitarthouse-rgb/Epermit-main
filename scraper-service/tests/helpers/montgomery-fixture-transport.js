"use strict";

/**
 * Offline Montgomery portal: synthetic payloads in the shapes the supervised capture of 2026-11-18 recorded
 * (keys and nesting only; every value here is made up). Every URL goes through the real read-only guard with
 * the Montgomery tenant, so a route the guard would refuse fails here too.
 *
 * Projects: 900001 Decision Issued (one workflow, empty corrections JSON, 2-row report),
 * 900002 PreApproval Corrections (no workflow), 900003 Approved (one workflow, no comments),
 * a template row and a row whose name is not a portal permit number.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createRunGuard } = require("../../permit-sync/core/safety");
const { SafetyViolationError, PortalChangedError } = require("../../permit-sync/core/errors");
const { buildTenantUrl } = require("../../permit-sync/adapters/dc-projectdox/routes");
const { MONTGOMERY } = require("../../permit-sync/adapters/projectdox-tenants");
const mc = require("../../permit-sync/adapters/montgomery-projectdox/normalize");

const PAGED = {
  Items: [
    { ProjectID: 900001, Name: "COMBUILD-1000001", Status: "Decision Issued", ProjectTemplateID: 44, IsProjectTemplate: false, Address1: "1 Test St", City: "Rockville", State: "MD", PostalCode: "20850" },
    { ProjectID: 900002, Name: "COMBUILD-1000002", Status: "PreApproval Corrections", ProjectTemplateID: 44, IsProjectTemplate: false },
    { ProjectID: 900003, Name: "SIGN-1000003", Status: "Approved", ProjectTemplateID: 38, IsProjectTemplate: false },
    { ProjectID: 900004, Name: "Template COMBUILD", Status: "Approved", ProjectTemplateID: 44, IsProjectTemplate: true },
    { ProjectID: 900005, Name: "Mont test", Status: "Approved", ProjectTemplateID: 17, IsProjectTemplate: false },
  ],
  TotalRowsCount: 5,
};

const WORKFLOWS = {
  900001: { Records: [{ WFlowInstanceID: 61001, WFlowTypeName: "BIC DPR", WFlowSubtypeName: "ComBuild", WFlowInstanceStateName: null, VersionTitle: "Rejection Path", VersionNum: 3, DateStarted: "2026-04-13T12:06:28" }], TotalRecordCount: 1 },
  900002: { Records: [], TotalRecordCount: 0 },
  900003: { Records: [{ WFlowInstanceID: 61003, WFlowTypeName: "BIC Building", WFlowSubtypeName: "Sign", WFlowInstanceStateName: null, VersionTitle: "Rejection Track", VersionNum: 1, DateStarted: "2026-05-01T09:00:00" }], TotalRecordCount: 1 },
};

// Folder ids repeat across projects that share a template (observed): 1244443 is "Drawings" in 900001 and 900002.
const FOLDERS = {
  900001: [
    { FolderID: 1244443, Name: "Drawings", FilesCount: 2, NewFilesCount: 0, FilesWithMarkupsCount: 1, SubFolderCount: 0, FolderPermissions: { ProjectID: 900001, FolderID: 1244443, ViewFolder: true, DownloadFile: false } },
    { FolderID: 1244447, Name: "Approved", FilesCount: 1, NewFilesCount: 0, FilesWithMarkupsCount: 0, SubFolderCount: 0, FolderPermissions: { ProjectID: 900001, FolderID: 1244447, ViewFolder: true, DownloadFile: true } },
  ],
  900002: [
    { FolderID: 1244443, Name: "Drawings", FilesCount: 1, NewFilesCount: 0, FilesWithMarkupsCount: 0, SubFolderCount: 0, FolderPermissions: { ProjectID: 900002, FolderID: 1244443, ViewFolder: true, DownloadFile: true } },
  ],
  900003: [],
};

const FILES = {
  "900001:1244443": [
    { FileID: 7001, FolderID: 1244443, ProjectID: 900001, FileName: "A-101.pdf", Version: 1, FileSize: 2048, FileStatus: "Rejected", HasMarkups: true, UploadDate: "2026-04-13T12:10:00" },
    { FileID: 7002, FolderID: 1244443, ProjectID: 900001, FileName: "A-101.pdf", Version: 2, FileSize: 4096, FileStatus: "Approved", HasMarkups: false, UploadDate: "2026-05-02T08:00:00" },
  ],
  "900001:1244447": [{ FileID: 7003, FolderID: 1244447, ProjectID: 900001, FileName: "Approved-Set.pdf", Version: 1, FileSize: 8192, FileStatus: "Approved" }],
  "900002:1244443": [{ FileID: 7101, FolderID: 1244443, ProjectID: 900002, FileName: "S-001.pdf", Version: 1, FileSize: 1024, FileStatus: "Pending" }],
};

const REPORT_LIST = (pid, wf) => [
  { QueryReportID: 132, QueryReportTitle: "Plan Review - Discussion Board Plan Review", ReportPath: "/MontgomeryCountyProd/ProjectDox/Plan Review - Discussion Board Plan Review", ReportType: "Project", ReportDataSourceName: "DataSource1", ReportParamQueryString: `&ProjectID=${pid}&Timezone=` },
  { QueryReportID: 133, QueryReportTitle: "Plan Review - Review Comments", ReportPath: "/MontgomeryCountyProd/ProjectDox/Plan Review - Review Comments", ReportType: "Project", ReportDataSourceName: "DataSource1", ReportParamQueryString: `&ProjectID=${pid}&WFlowInstanceID=${wf || ""}&Timezone=` },
];

/** Report rows in the reviewItems shape (what extractReviewCommentsReport returns). */
const REPORT_ROWS = {
  900001: [
    { ref: 1, workflowInstanceId: "61001", department: "Building", reviewer: "reviewer", cycle: 1, status: "Unresolved", type: "Correction", text: "Provide egress plan.", fileName: "A-101.pdf", reviewedAt: "2026-04-20T10:00:00", responses: [{ by: "applicant", at: "2026-05-02T08:00:00", text: "Added sheet A-102." }], responseColumn: "none" },
    { ref: 2, workflowInstanceId: "61001", department: "Zoning", reviewer: "reviewer", cycle: 1, status: "Info Only", type: "Comment", text: "Setback verified.", fileName: null, reviewedAt: "2026-04-21T10:00:00", responses: [], responseColumn: "No response required." },
  ],
  900003: [],
};

const EMPTY_CORRECTIONS = { WFlowInstanceID: 0, CorrectionStatusTypes: [{ WFlowCorrectionStatusTypeID: 1, StatusName: "Unresolved" }], ReviewGroups: [], Corrections: [], ReviewCycles: [] };

function createMontgomeryFixtureTransport(options = {}) {
  const guard = options.guard || createRunGuard({ tenant: MONTGOMERY });
  const requests = [];
  const templates = new Map();
  const deepCalls = { files: [], reports: [] };

  function check(route, params) {
    const url = buildTenantUrl(MONTGOMERY, route, params);
    const verdict = guard.checkRequest("GET", url);
    requests.push({ route, url, allowed: verdict.allowed, rule: verdict.rule });
    if (!verdict.allowed) throw new SafetyViolationError(`blocked ${route}: ${verdict.reason}`, verdict);
    return url;
  }

  return {
    guard,
    requests,
    async listDashboardPage(n) {
      check("paged_active_projects", { pageIndex: n - 1, pageSize: 100 });
      const rows = mc.rowsFromPagedProjects(PAGED);
      for (const r of rows) templates.set(r.projectId, r.templateId);
      return { rows, totalRecords: rows.length, pageSize: 100 };
    },
    async getJson(route, params) {
      check(route, params);
      const pid = String(params.projectID ?? params.entityID ?? params.projectId ?? "");
      switch (route) {
        case "workflow_instances_list": return JSON.parse(JSON.stringify(WORKFLOWS[pid]));
        case "workflow_status": {
          const status = Number(params.wflowInstanceID) === 61001 ? "Decision Issued" : "Approved";
          return { ReviewType: "Plan Review", CalendarType: "Business", TotalNumberOfFiles: 3, TimeElapsed: { Days: 1, Hours: 2 }, ProjectStatus: status, PrescreenStatus: null, SubWorkflows: null, UncompleteTaskCount: 0 };
        }
        case "active_task_list": return { Tasks: [], PagedTasks: [], RecordCount: 0 };
        case "project_folders": return JSON.parse(JSON.stringify(FOLDERS[pid] || []));
        case "folder_files": {
          const items = FILES[`${pid}:${params.folderID}`] || [];
          return { Items: JSON.parse(JSON.stringify(items)), TotalRowsCount: items.length };
        }
        default: throw new Error(`fixture has no data for ${route}`);
      }
    },
    async getCorrectionsRows(projectId, wflowInstanceId) {
      if (!wflowInstanceId) return null;
      check("project_corrections_json", { wflowInstanceID: wflowInstanceId });
      const rows = mc.correctionRowsFromJson(EMPTY_CORRECTIONS);
      return rows.length ? rows : null;
    },
    async getReviewCommentsReport(projectId, wflowInstanceId) {
      check("review_comments_report", { ProjectID: projectId, WFlowInstanceID: wflowInstanceId, Timezone: "" });
      if (options.multiPageReport && options.multiPageReport.has(String(projectId))) throw new PortalChangedError("report has 8 pages");
      return JSON.parse(JSON.stringify(REPORT_ROWS[String(projectId)] || []));
    },
    async getProjectInfo(projectId) {
      const templateId = templates.get(String(projectId));
      check("project_info", { ProjectID: projectId, ProjectTemplateID: templateId });
      return { projectName: `Project ${projectId}`, description: "Interior alteration", address: "1 Test St, Rockville, MD", statusRaw: "Decision Issued" };
    },
    async listReports(projectId) {
      check("report_list", { projectId });
      const wf = WORKFLOWS[String(projectId)].Records[0];
      return mc.reportListItems(REPORT_LIST(projectId, wf && wf.WFlowInstanceID));
    },
    /** Deep reads (montgomery-driver.js): bodies and exports are made up; the URLs pass the real guard. */
    async fetchFile(fileId, { viewerOnly = false, preferOriginal = true } = {}) {
      const rendition = viewerOnly || !preferOriginal;
      const url = `${MONTGOMERY.apiOrigin}/File/RetrieveFile?${rendition ? "convertToPDF=true&" : ""}inline=true&fileID=${fileId}`;
      gate("GET", url);
      deepCalls.files.push({ fileId: String(fileId), rendition });
      if (options.onFetchFile) await options.onFetchFile(String(fileId), deepCalls);
      const meta = Object.values(FILES).flat().find((f) => String(f.FileID) === String(fileId));
      return { buf: pdfOfSize(meta ? meta.FileSize : 512, `file ${fileId}`), url, contentType: "application/pdf" };
    },
    async exportReport({ url, dir, formats }) {
      gate("GET", url);
      const u = new URL(url);
      const id = u.searchParams.get("ReportID");
      const pid = u.searchParams.get("ProjectID");
      deepCalls.reports.push({ reportId: id, projectId: pid, formats: [...formats] });
      if (options.reportExportFails && options.reportExportFails(id, pid)) return { excelPath: null, pdfPath: null, text: "", pages: null, error: "EXCELOPENXML: export failed; PDF: export failed" };
      const rows = id === "133" && !(options.reviewExcelWithoutRows && options.reviewExcelWithoutRows.has(pid)) ? REVIEW_EXCEL_ROWS[pid] || [] : [];
      const grid = id === "133" && (REVIEW_EXCEL_ROWS[pid] || []).length ? "\nRef # Cycle Reviewed By Type Filename Discussion Status" : "";
      const out = { excelPath: null, pdfPath: null, text: `Report ${id} for ${pid}${grid}\nPage 1 of 8`, pages: 8, error: null };
      if (formats.includes("EXCELOPENXML")) {
        out.excelPath = path.join(dir, "report.xlsx");
        await writeReportExcel(out.excelPath, rows, rows.length > 0);
      }
      if (formats.includes("PDF")) {
        out.pdfPath = path.join(dir, "report.pdf");
        fs.writeFileSync(out.pdfPath, pdfOfSize(400, `report ${id} ${pid}`));
      }
      return out;
    },
    deepCalls,
  };

  function gate(method, url) {
    const verdict = guard.checkRequest(method, url);
    requests.push({ route: "deep", url, allowed: verdict.allowed, rule: verdict.rule });
    if (!verdict.allowed) throw new SafetyViolationError(`blocked deep read: ${verdict.reason}`, verdict);
  }
}

/** A PDF body padded to exactly `size` bytes (an original smaller than the portal FileSize is refused as truncated). */
function pdfOfSize(size, label) {
  const head = `%PDF-1.4\n% ${label}\n`;
  const tail = "\n%%EOF\n";
  return Buffer.from(head + " ".repeat(Math.max(0, size - head.length - tail.length)) + tail);
}

/** Review Comments Excel rows (the SSRS grid; ten rows, more than the one-page HTML report shows). */
const REVIEW_EXCEL_ROWS = {
  900001: Array.from({ length: 10 }, (_, i) => ({
    ref: i + 1, cycle: 1, reviewed_by: "Building\nreviewer\n04/20/2026 10:00 AM", type: `Correction\nItem ${i + 1}: provide detail.`,
    filename: "A-101.pdf", discussion: "", status: i % 2 ? "Resolved" : "Unresolved",
  })),
};

/**
 * Same shape as the live Montgomery report 133 export (2026-11-18, structure only): column A empty, title on row 2,
 * a printed-on line on row 4, a section band on row 7, the grid header on row 9, rows from row 10, blank spacer rows.
 * `grid` false: title and printed line only (an export without its grid).
 */
async function writeReportExcel(dest, rows, grid = true) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Review Comments");
  const put = (n, cells) => cells.forEach((v, i) => { if (v !== null && v !== undefined && v !== "") ws.getRow(n).getCell(i + 2).value = v; });
  put(2, ["Plan Review - Review Comments"]);
  put(4, ["SIGN-0000000 printed 11/18/2026 6:29 AM"]);
  if (grid) {
    put(7, Array(7).fill("REVIEW COMMENTS"));
    put(9, ["REF #", "CYCLE", "REVIEWED BY", "TYPE", "FILENAME", "DISCUSSION", "STATUS"]);
  }
  rows.forEach((r, i) => put(10 + i, [r.ref, r.cycle, r.reviewed_by, r.type, r.filename, r.discussion, r.status]));
  await wb.xlsx.writeFile(dest);
}

module.exports = { createMontgomeryFixtureTransport, PAGED, REPORT_ROWS, REVIEW_EXCEL_ROWS, writeReportExcel };
