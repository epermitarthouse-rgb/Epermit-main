"use strict";

/**
 * DC ProjectDox adapter: turns transport reads into discovery records and per-permit section input
 * for core/ingest.buildBatch. It owns no browser and writes nothing; all portal access goes through
 * `transport`, which must enforce the read-only guard (see live-transport.js, and the fixture
 * transport in tests/helpers).
 *
 * Transport contract (all reads):
 *   listDashboardPage(pageNumber) -> { rows: [{permit, projectId, status, description?, address?}], totalRecords, pageSize }
 *   getJson(route, params)         -> parsed JSON; route is a DC_READ_ALLOW name
 *   getCorrectionsRows(projectId, wflowInstanceId) -> rows | null   (GetProjectCorrectionsByCycleInstance; null = no workflow)
 *   getReviewCommentsReport(projectId, wflowInstanceId) -> rows      (SSRS report; fallback when the JSON read fails)
 *   getProjectInfo(projectId)      -> info object
 *   listReports(projectId)         -> [{ key?, name, category?, reportId? }]
 */

const dc = require("./normalize");
const { PortalChangedError } = require("../../core/errors");

const MAX_DASHBOARD_PAGES = 20;

function isNotImplemented(err) {
  return err && err.code === "not_implemented";
}

function pickActiveWorkflow(records) {
  const list = Array.isArray(records) ? records : [];
  const active = list.filter((r) => /active/i.test(String(r.WFlowInstanceStateName || "")));
  const pool = active.length ? active : list;
  return pool.slice().sort((a, b) => String(b.DateStarted || "").localeCompare(String(a.DateStarted || "")))[0] || null;
}

/**
 * @param {object} opts
 * @param {object} opts.transport
 * @param {boolean|null} [opts.accountDownload] account-level DownloadFile permission when folders do not
 *   report one (source setting; false for the DC account, D-014)
 */
function createDcAdapter({ transport, accountDownload = null }) {
  if (!transport) throw new Error("transport is required");

  async function discover() {
    const first = await transport.listDashboardPage(1);
    if (!first || !Array.isArray(first.rows) || !Number.isInteger(first.totalRecords)) {
      throw new PortalChangedError("dashboard listing has no rows/total");
    }
    const pages = Math.ceil(first.totalRecords / (first.pageSize || first.rows.length || 10));
    if (pages > MAX_DASHBOARD_PAGES) throw new PortalChangedError(`dashboard reports ${pages} pages`);
    const rows = [...first.rows];
    for (let p = 2; p <= pages; p += 1) {
      const page = await transport.listDashboardPage(p);
      rows.push(...((page && page.rows) || []));
    }
    const records = [];
    const seen = new Set();
    const skipped = [];
    for (const row of rows) {
      let rec;
      try {
        rec = dc.discoveryRecord(row);
      } catch (_) {
        skipped.push(row.permit || null);
        continue;
      }
      if (seen.has(rec.portal_record_id)) continue;
      seen.add(rec.portal_record_id);
      records.push(rec);
    }
    return {
      records,
      expectedTotal: first.totalRecords,
      complete: skipped.length === 0 && records.length === first.totalRecords,
      skipped,
    };
  }

  /** Reads every section for one permit. Section failures are captured, never thrown, except guard violations. */
  async function fetchPermit(record) {
    const projectId = record.portal_record_id;
    const sections = {};
    const guardOrThrow = (err) => {
      if (err && (err.code === "safety_violation" || err.code === "session_ended" || err.code === "rate_limited")) throw err;
    };
    const failed = (sourceKind, err) => ({ status: "failed", sourceKind, error: String((err && err.code) || "error") + ": " + String((err && err.message) || "").slice(0, 200) });

    let workflow = null;
    let statusData = null;

    try {
      const wf = await transport.getJson("workflow_instances_list", { entityID: projectId });
      const recs = (wf && wf.Records) || [];
      workflow = pickActiveWorkflow(recs);
      sections.workflows = {
        status: "ok", sourceKind: "json", tables: { permit_workflows: dc.workflowItems(recs) },
        expectedCounts: Number.isInteger(wf && wf.TotalRecordCount) ? { permit_workflows: wf.TotalRecordCount } : undefined,
        confirmedEmpty: recs.length === 0 && wf && wf.TotalRecordCount === 0, raw: wf,
      };
    } catch (err) {
      guardOrThrow(err);
      sections.workflows = failed("json", err);
    }

    if (workflow) {
      try {
        statusData = await transport.getJson("workflow_status", { wflowInstanceID: workflow.WFlowInstanceID });
        sections.status = { status: "ok", sourceKind: "json", fields: dc.statusFields(statusData), raw: statusData };
      } catch (err) {
        guardOrThrow(err);
        sections.status = failed("json", err);
      }
    } else if (sections.workflows.status === "ok") {
      sections.status = { status: "absent", sourceKind: "json" };
    } else {
      sections.status = { status: "failed", sourceKind: "json", error: "workflow unknown" };
    }

    try {
      const active = await transport.getJson("active_task_list", { projectID: projectId });
      const list = Array.isArray(active) ? active : (active && (active.Tasks || active.Items || active.Records)) || [];
      const fromStatus = statusData
        ? (statusData.SubWorkflows || []).flatMap((s) => (s.UncompletedTasks || []).map((t) => ({ ...t, WFlowInstanceID: workflow.WFlowInstanceID })))
        : [];
      const byId = new Map();
      for (const t of [...fromStatus, ...list]) byId.set(String(t.WFlowTaskID), { ...(byId.get(String(t.WFlowTaskID)) || {}), ...t });
      const tasks = dc.taskItems([...byId.values()]);
      const expected = statusData && Number.isInteger(statusData.UncompleteTaskCount) ? statusData.UncompleteTaskCount : null;
      sections.tasks = {
        status: "ok", sourceKind: "json", tables: { permit_tasks: tasks },
        expectedCounts: expected !== null ? { permit_tasks: expected } : undefined,
        confirmedEmpty: tasks.length === 0 && expected === 0, raw: { active, fromStatus },
      };
    } catch (err) {
      guardOrThrow(err);
      sections.tasks = failed("json", err);
    }

    try {
      const folders = await transport.getJson("project_folders", { projectID: projectId, folderID: "" });
      const list = Array.isArray(folders) ? folders : (folders && folders.folders) || [];
      const filesByKey = {};
      let pagingOk = true;
      for (const f of list) {
        if (f.FolderID === null || f.FolderID === undefined) continue;
        const files = await transport.getJson("folder_files", { folderID: f.FolderID, projectID: projectId, listMode: 3, pageIndex: 0, pageSize: 500 });
        const items = (files && files.Items) || [];
        if (Number.isInteger(files && files.TotalRowsCount) && files.TotalRowsCount !== items.length) pagingOk = false;
        filesByKey[dc.folderKey(f)] = items;
      }
      const { folders: fo, documents } = dc.fileItems(list, filesByKey, { accountDownload });
      sections.files = {
        status: pagingOk ? "ok" : "partial", sourceKind: "json",
        tables: { permit_document_folders: fo, permit_documents: documents },
        error: pagingOk ? undefined : "folder_files paging incomplete",
        raw: { folders: list, files: filesByKey },
      };
    } catch (err) {
      guardOrThrow(err);
      sections.files = failed("json", err);
    }

    const wflowId = workflow ? workflow.WFlowInstanceID : null;
    if (!wflowId) {
      sections.reviews = sections.workflows.status === "ok"
        ? { status: "absent", sourceKind: "json" }
        : { status: "failed", sourceKind: "json", error: "workflow unknown" };
    } else {
      try {
        let rows;
        let sourceKind = "json";
        let primaryError = null;
        try {
          rows = await transport.getCorrectionsRows(projectId, wflowId);
        } catch (err) {
          guardOrThrow(err);
          primaryError = err;
        }
        let emptyNote = null;
        if (!Array.isArray(rows)) {
          sourceKind = "report";
          rows = await transport.getReviewCommentsReport(projectId, wflowId);
        } else if (rows.length === 0 && !/active/i.test(String(workflow.WFlowInstanceStateName || ""))) {
          // D-066: for a completed workflow the corrections JSON comes back empty while the Review
          // Comments report still lists the comments, so an empty JSON read is not trusted there.
          try {
            const reportRows = await transport.getReviewCommentsReport(projectId, wflowId);
            if (Array.isArray(reportRows) && reportRows.length > 0) {
              rows = reportRows;
              sourceKind = "report";
              emptyNote = "json_empty_inactive_workflow";
            }
          } catch (err) {
            guardOrThrow(err);
            emptyNote = `json_empty_inactive_workflow; report_failed:${String((err && err.code) || "error")}`;
          }
        }
        const { comments, responses } = dc.reviewItems(rows, { sourceKind });
        const unresolved = statusData ? dc.statusUnresolvedTotal(statusData) : null;
        const actualUnresolved = comments.filter((c) => c.fields.status === "Unresolved").length;
        const parityError = unresolved !== null && unresolved !== actualUnresolved ? `unresolved_parity:${actualUnresolved}/${unresolved}` : null;
        const fallbackNote = primaryError ? `json_failed:${String(primaryError.code || "error")}` : null;
        const reportFailed = Boolean(emptyNote && emptyNote.includes("report_failed"));
        sections.reviews = {
          status: parityError || reportFailed ? "partial" : "ok",
          sourceKind,
          tables: { permit_review_comments: comments, permit_review_responses: responses },
          error: [parityError, fallbackNote, emptyNote].filter(Boolean).join("; ") || undefined,
          raw: { rows },
        };
      } catch (err) {
        guardOrThrow(err);
        sections.reviews = isNotImplemented(err)
          ? { status: "failed", sourceKind: "report", error: "report_parser_unverified" }
          : failed("report", err);
      }
    }

    try {
      const info = await transport.getProjectInfo(projectId);
      sections.info = { status: "ok", sourceKind: "html", fields: dc.infoFields(info || {}), raw: info };
    } catch (err) {
      guardOrThrow(err);
      sections.info = isNotImplemented(err) ? { status: "failed", sourceKind: "html", error: "info_parser_unverified" } : failed("html", err);
    }

    try {
      const reports = await transport.listReports(projectId);
      sections.reports = { status: "ok", sourceKind: "json", tables: { permit_reports: dc.reportItems(reports) }, raw: reports };
    } catch (err) {
      guardOrThrow(err);
      sections.reports = failed("json", err);
    }

    return { sections };
  }

  return { key: dc.ADAPTER_KEY, discover, fetchPermit };
}

module.exports = { createDcAdapter, pickActiveWorkflow };
