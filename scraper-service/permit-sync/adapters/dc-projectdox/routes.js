"use strict";

/**
 * Observed DC ProjectDox read routes (EXTRACTION_SPEC_DC.md "Data routes"). Every URL the adapter
 * requests is built here and must pass core/safety.evaluateRequest before it is sent.
 */

const API_ORIGIN = "https://washington-dc-us-projectdoxwebapi.avolvecloud.com";
const UI_ORIGIN = "https://session.planreview.dob.dc.gov";

const ROUTES = Object.freeze({
  project_folders: { origin: "api", path: "/Folder/GetProjectFolders", defaults: { folderID: "" } },
  folder_files: { origin: "api", path: "/File/GetFolderFiles", defaults: { listMode: 3, pageIndex: 0, pageSize: 500, pk: "FileID" } },
  active_task_list: {
    origin: "api", path: "/WorkflowAggregate/GetActiveWorkflowTaskList",
    defaults: { wflowActivityID: "", onlyActiveTaskStatus: true, showTasksForAllUsers: false, pk: "WFlowTaskID" },
  },
  workflow_instances_list: {
    origin: "api", path: "/WorkflowAggregate/GetWorkflowInstancesList",
    defaults: { WFlowStateName: "", entityTypeID: 1, checkForRevCoordPerm: true, pageNumber: 0, rowCount: 50, pk: "WFlowInstanceID" },
  },
  workflow_status: { origin: "api", path: "/WorkflowInstance/GetWorkflowInstanceStatusData", defaults: {} },
  // Reviews tab data: the ProjectCorrections partial is a template shell filled from this call.
  project_corrections_json: {
    origin: "api", path: "/WorkflowAggregate/GetProjectCorrectionsByCycleInstance",
    defaults: { wflowTaskID: "", wflowActivityID: "", groupID: "", wflowReviewCycleID: "", retrieveFilterOptions: true },
  },
  report_list: {
    origin: "api", path: "/Report/GetReportList",
    defaults: { assignedToProjectOnly: true, reportTypes: [1, 10, 11] },
  },
  project_corrections: { origin: "ui", path: "/Project/ProjectCorrections", defaults: {} },
  project_info: { origin: "ui", path: "/Project/ProjectInfo", defaults: {} },
  review_comments_report: {
    origin: "ui", path: "/WebForms/ReportViewer.aspx",
    defaults: { ReportID: 14, ReportPath: "/WashingtonDCProd/ProjectDox/Plan Review - Review Comments", DataSourceName: "DataSource1" },
  },
});

function buildDcUrl(route, params = {}, { apiOrigin = API_ORIGIN, uiOrigin = UI_ORIGIN } = {}) {
  const def = ROUTES[route];
  if (!def) throw new Error(`unknown DC route ${route}`);
  const u = new URL(def.path, def.origin === "api" ? apiOrigin : uiOrigin);
  for (const [k, v] of Object.entries({ ...def.defaults, ...params })) {
    if (Array.isArray(v)) {
      u.searchParams.delete(k);
      for (const item of v) u.searchParams.append(k, String(item));
    } else if (v !== undefined && v !== null) {
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

module.exports = { API_ORIGIN, UI_ORIGIN, ROUTES, buildDcUrl };
