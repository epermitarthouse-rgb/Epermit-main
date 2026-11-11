"use strict";

/**
 * Offline DC portal built from the redacted Phase 0 fixtures. Implements the adapter transport
 * contract and sends every URL through the real read-only guard, so a route the guard would refuse
 * fails here too. Deep data exists for 11854 (Resubmit: status + Reviews) and 11105 (Approved:
 * folders); the other permits get minimal, internally consistent payloads.
 *
 * Fault injection: { fail: { [route]: Set<projectId> }, violateOn: projectId, mutate(route, projectId, data) }.
 */

const { createRunGuard } = require("../../permit-sync/core/safety");
const { SafetyViolationError, TransientError } = require("../../permit-sync/core/errors");
const { buildDcUrl } = require("../../permit-sync/adapters/dc-projectdox/routes");
const { reportListItems } = require("../../permit-sync/adapters/dc-projectdox/normalize");
const fx = require("./permit-repo-fixtures");

const REPORTS = reportListItems(require("../fixtures/permit-sync/dc/report-list-11854.json").items);
const clone = (v) => JSON.parse(JSON.stringify(v));

function createDcFixtureTransport(options = {}) {
  const guard = options.guard || createRunGuard();
  const requests = [];
  const rows = fx.inventory.records.map((r) => ({ ...r, projectId: r.projectId === null ? `test-${r.permit}` : r.projectId }));
  const byId = new Map(rows.map((r) => [String(r.projectId), r]));
  const wflowFor = (pid) => (String(pid) === "11854" ? 11975 : 50000 + rows.findIndex((r) => String(r.projectId) === String(pid)));

  function check(route, params) {
    const url = buildDcUrl(route, params);
    const verdict = guard.checkRequest("GET", url);
    requests.push({ route, url, allowed: verdict.allowed });
    if (!verdict.allowed) throw new SafetyViolationError(`blocked ${route}: ${verdict.reason}`, verdict);
  }

  function maybeFail(route, pid) {
    const set = options.fail && options.fail[route];
    if (set && set.has(String(pid))) throw new TransientError(`injected failure ${route} ${pid}`);
    if (options.violateOn && String(options.violateOn) === String(pid) && route === "workflow_status") {
      const url = "https://session.planreview.dob.dc.gov/Workflow/AcceptTask?taskId=1";
      const verdict = guard.checkRequest("GET", url);
      requests.push({ route: "accept_task", url, allowed: verdict.allowed });
      if (!verdict.allowed) throw new SafetyViolationError("blocked AcceptTask", verdict);
    }
  }

  const out = (route, pid, data) => (options.mutate ? options.mutate(route, String(pid), data) : data);

  return {
    guard,
    requests,
    async listDashboardPage(page) {
      const pageRows = rows.filter((r) => r.page === page).map(({ permit, projectId, status }) => ({ permit, projectId, status }));
      return out("dashboard", page, { rows: pageRows, totalRecords: fx.inventory.totalRecords, pageSize: fx.inventory.pageSize });
    },
    async getJson(route, params) {
      check(route, params);
      const pid = String(params.projectID ?? params.entityID ?? "");
      const instancePid = route === "workflow_status"
        ? [...byId.keys()].find((k) => wflowFor(k) === Number(params.wflowInstanceID))
        : pid;
      maybeFail(route, instancePid);
      const row = byId.get(instancePid);
      switch (route) {
        case "workflow_instances_list":
          return out(route, pid, {
            Records: [{
              WFlowInstanceID: wflowFor(pid), InstanceName: `${row.permit} BIC Building`, WFlowSubtypeName: "BIC Building",
              WFlowInstanceStateName: row.status === "Approved" ? "Completed" : "Active", CurrentActivity: row.status,
              VersionNum: 1, VersionTitle: "Accela Integration (Version 1)", IntegrationModeName: "Production",
              DateStarted: "2025-06-01T09:00:00", DateCompleted: row.status === "Approved" ? "2025-12-01T09:00:00" : null,
            }],
            TotalRecordCount: 1,
          });
        case "workflow_status":
          if (instancePid === "11854") return out(route, instancePid, JSON.parse(JSON.stringify(fx.status)));
          return out(route, instancePid, { ProjectStatus: row.status, ReviewType: "BIC Building", TotalNumberOfFiles: 0, UncompleteTaskCount: 0, SubWorkflows: [] });
        case "active_task_list":
          return out(route, pid, { Tasks: [], PagedTasks: [], RecordCount: 0 });
        case "project_folders":
          return out(route, pid, pid === "11105" ? fx.folders.folders.map((f) => ({ ...f })) : []);
        case "folder_files":
          return out(route, pid, {
            Items: [
              { FileID: 700101, Version: 1, FileName: "A-101.pdf", FileStatus: "Approved", FileSize: 2048, UploadDate: "2025-03-01T10:00:00" },
              { FileID: 700102, Version: 2, FileName: "A-101.pdf", FileStatus: "Approved V2", FileSize: 4096, UploadDate: "2025-04-01T10:00:00" },
            ],
            TotalRowsCount: 2,
          });
        default:
          throw new Error(`fixture has no data for ${route}`);
      }
    },
    async getCorrectionsRows(projectId, wflowInstanceId) {
      if (!wflowInstanceId) return null;
      check("project_corrections_json", { wflowInstanceID: wflowInstanceId });
      maybeFail("project_corrections_json", projectId);
      return out("project_corrections", projectId, String(projectId) === "11854" ? clone(fx.corrections.rows) : []);
    },
    async getReviewCommentsReport(projectId, wflowInstanceId) {
      check("review_comments_report", { ProjectID: projectId, WFlowInstanceID: wflowInstanceId, Timezone: "" });
      maybeFail("review_comments_report", projectId);
      return out("review_comments_report", projectId, String(projectId) === "11854" ? clone(fx.corrections.rows) : []);
    },
    async getProjectInfo(projectId) {
      check("project_info", { projectID: projectId });
      maybeFail("project_info", projectId);
      return out("project_info", projectId, { projectName: `Project ${byId.get(String(projectId)).permit}`, jobClass: "Alteration" });
    },
    async listReports(projectId) {
      check("report_list", { projectId });
      maybeFail("report_list", projectId);
      return out("reports", projectId, clone(REPORTS));
    },
  };
}

module.exports = { createDcFixtureTransport, REPORTS };
