"use strict";

/**
 * Observed DC ProjectDox read routes (EXTRACTION_SPEC_DC.md "Data routes"). Every URL the adapter
 * requests is built here and must pass core/safety.evaluateRequest before it is sent.
 */

const { DC, tenantFor } = require("../projectdox-tenants");

const API_ORIGIN = DC.apiOrigin;
const UI_ORIGIN = DC.uiOrigin;

const ROUTES = Object.freeze({
  project_folders: { origin: "api", path: "/Folder/GetProjectFolders", defaults: { folderID: "" } },
  folder_files: { origin: "api", path: "/File/GetFolderFiles", defaults: { listMode: 3, pageIndex: 0, pageSize: 500, pk: "FileID" } },
  // Child folders under a tree parent (Prince George's files live here, not on the parent row).
  folder_children: { origin: "api", path: "/Folder/GetFolders", defaults: { depth: 1 } },
  // Prince George's task list. GetActiveWorkflowTaskList 404s on that host.
  workflow_task_list: { origin: "api", path: "/WorkflowAggregate/GetWorkflowTaskList", defaults: {} },
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
  // Projects grid data call (Montgomery discovery): every project the account can open, with ProjectID and status.
  paged_active_projects: { origin: "api", path: "/Project/GetPagedActiveProjects", defaults: { pageIndex: 0, pageSize: 100 } },
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

function prefixPath(pathname, base) {
  if (!base) return pathname;
  if (pathname === base || pathname.startsWith(`${base}/`)) return pathname;
  return `${base}${pathname}`;
}

/**
 * The same routes on a tenant's origins; the Review Comments report takes the tenant's report identity.
 * A tenant that serves the API and Web UI as path prefixes on one host (PGC) sets apiBasePath / uiBasePath.
 * A leading-slash route path would otherwise drop that prefix (URL resolution). DC and Montgomery set neither.
 */
function buildTenantUrl(tenant, route, params = {}) {
  const t = tenantFor(tenant);
  const merged = route === "review_comments_report" ? { ...t.reviewReport, ...params } : params;
  const url = buildDcUrl(route, merged, { apiOrigin: t.apiOrigin, uiOrigin: t.uiOrigin });
  const def = ROUTES[route];
  const u = new URL(url);
  if (route === "review_comments_report" && t.reportViewerPath) u.pathname = t.reportViewerPath;
  else if (def.origin === "api") u.pathname = prefixPath(u.pathname, t.apiBasePath);
  else if (def.origin === "ui") u.pathname = prefixPath(u.pathname, t.uiBasePath);
  else return url;
  return u.toString();
}

module.exports = { API_ORIGIN, UI_ORIGIN, ROUTES, buildDcUrl, buildTenantUrl };
