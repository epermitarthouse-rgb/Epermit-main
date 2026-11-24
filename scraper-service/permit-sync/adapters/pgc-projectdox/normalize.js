"use strict";

/**
 * Prince George's County MD ePlan normalizer. Section payloads use the shared ProjectDox shapes
 * (corrections JSON, folders, reports). Discovery comes from the manual dashboard grid
 * (collectAllProjects), whose project numbers look like 62227-2024-CIEU.
 */

const shared = require("../dc-projectdox/normalize");
const { PGC } = require("../projectdox-tenants");

const ADAPTER_KEY = PGC.key;
const JURISDICTION = PGC.jurisdiction;

/**
 * Statuses on the My Projects grid, 2026-11-23. Anything else stays "other" and the portal text is kept in status_raw.
 * "Applicant Re-upload" / "Applicant Upload" are the upload step. Fee and expired are not a review state.
 */
const STATUS_MAP = Object.freeze({
  "applicant upload": "upload",
  "applicant re-upload": "upload",
  "pending upload": "upload",
  "in review": "in_review",
  prescreen: "in_review",
  "pre-screen": "in_review",
  corrections: "resubmit",
  resubmit: "resubmit",
  "applicant resubmit": "resubmit",
  approved: "approved",
  complete: "approved",
  completed: "approved",
});

/**
 * Project numbers on the live My Projects grid (2026-11-23), 50 rows, 10 per page:
 *   15385-2022-0, 2102-2023-0, 60581-2024-S, 61766-2024-CI, 10788-2023-CG, 62227-2024-CIEU, COM-00954-2024.
 * The suffix is one or more letters or a single 0. COM- permits lead with the type code.
 */
const PERMIT_NUMBER = /^(?:COM-\d{3,8}-\d{4}|\d{3,8}-\d{4}-[A-Z0-9]{1,12})$/;

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function mapStatus(raw) {
  const s = str(raw);
  if (!s) return null;
  return STATUS_MAP[s.toLowerCase()] || "other";
}

function statusFields(data) {
  return { ...shared.statusFields(data), status: mapStatus(data && data.ProjectStatus) };
}

function kvValue(keyValues, ...names) {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const kv of keyValues || []) {
    const key = String(kv && kv.key || "").replace(/:\s*$/, "").trim().toLowerCase();
    if (wanted.has(key)) return str(kv.value);
  }
  return null;
}

/**
 * Status tab key/value rows from extractStatusTabData → the payload statusFields already understands.
 * Observed on project 80172 (2026-11-24): Status, Review Type, Total Number of Files,
 * Current Non-Completed Tasks, Prescreen Review Comments (Unresolved).
 */
function statusPayloadFromTab(extracted) {
  const keyValues = extracted && extracted.keyValues;
  const unresolvedText = kvValue(keyValues, "Prescreen Review Comments (Unresolved)")
    || str((keyValues || []).find((kv) => /unresolved/i.test(String(kv && kv.key || "")))?.value);
  const unresolved = unresolvedText == null ? null : Number(String(unresolvedText).replace(/[^\d.-]/g, ""));
  return {
    ProjectStatus: kvValue(keyValues, "Status"),
    ReviewType: kvValue(keyValues, "Review Type"),
    TotalNumberOfFiles: kvValue(keyValues, "Total Number of Files"),
    UncompleteTaskCount: kvValue(keyValues, "Current Non-Completed Tasks"),
    SubWorkflows: Number.isFinite(unresolved) ? [{ UnresolvedComments: unresolved }] : [],
  };
}

/**
 * Tasks-tab rows from extractTasksTabData → objects taskItems can store.
 * The grid has no WFlowTaskID. The key is the visible row, so a later API read can replace it.
 */
function taskRecordsFromTab(extracted) {
  const rows = Array.isArray(extracted && extracted.tasks) ? extracted.tasks : [];
  const seen = new Map();
  return rows.map((row) => {
    const name = str(row && row.taskName) || "task";
    const group = str(row && row.assignee) || "";
    const status = str(row && row.state) || "";
    const base = `dom:${name}:${group}:${status}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    const accepted = /\[?\baccepted\b\]?/i.test(`${status} ${row && row.rawText || ""}`);
    return {
      WFlowTaskID: n === 0 ? base : `${base}:${n}`,
      TaskName: name,
      GroupName: group || null,
      TaskStatus: status || null,
      Accepted: accepted,
      DueDate: str(row && row.dueDate),
    };
  });
}

/**
 * A Report Viewer that is still showing View Report has not rendered, so exportReport cannot run.
 * `fields` are { label, empty, disabled } for the visible parameter inputs.
 */
function reportParameterReason(snapshot) {
  if (!snapshot || snapshot.viewReport !== true) return null;
  const fields = Array.isArray(snapshot.fields) ? snapshot.fields : [];
  const names = fields
    .filter((f) => f && f.empty && f.label)
    .map((f) => String(f.label).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const unique = [...new Set(names)].slice(0, 6);
  return unique.length ? `parameters_required:${unique.join(",")}` : "parameters_required";
}

/** Dashboard rows from collectAllProjects → listing rows the shared adapter discovers. */
function rowsFromDashboard(projects) {
  const list = Array.isArray(projects) ? projects : [];
  return list.map((p) => ({
    permit: str(p && (p.projectNumber || p.permit)),
    projectId: str(p && (p.projectID || p.projectId)),
    status: str(p && p.status),
    description: str(p && p.description),
    address: str(p && (p.location || p.address)),
  }));
}

function discoveryRecord(row) {
  const portalId = str(row.projectId ?? row.ProjectID);
  if (!portalId || !/^\d{1,12}$/.test(portalId)) throw new Error(`project row ${row.permit || "?"} has no ProjectID`);
  const permit = str(row.permit);
  if (!permit || !PERMIT_NUMBER.test(permit.toUpperCase())) throw new Error(`project row ${portalId} has no portal permit number`);
  return {
    portal_record_id: portalId,
    fields: {
      jurisdiction: JURISDICTION,
      permit_number: permit.toUpperCase(),
      permit_number_normalized: shared.normalizePermitNumber(permit),
      status: mapStatus(row.status),
      status_raw: str(row.status),
      title: str(row.title),
      description: str(row.description),
      address: str(row.address),
    },
  };
}

module.exports = {
  ...shared,
  ADAPTER_KEY,
  JURISDICTION,
  STATUS_MAP,
  PERMIT_NUMBER,
  mapStatus,
  statusFields,
  statusPayloadFromTab,
  taskRecordsFromTab,
  reportParameterReason,
  rowsFromDashboard,
  discoveryRecord,
};
