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

/** Field labels on the ProjectDox Status tab. Longer labels are matched first so "Status" does not swallow "Project Status". */
const STATUS_TAB_LABELS = Object.freeze([
  "prescreen review comments (unresolved)",
  "current non-completed tasks",
  "current noncompleted tasks",
  "total number of files",
  "time with jurisdiction",
  "time with applicant",
  "days calculated as business days",
  "calendar type",
  "time elapsed",
  "project status",
  "review type",
  "status",
  "owner",
]);

function addStatusPair(map, key, value) {
  const label = String(key || "").replace(/:\s*$/, "").trim();
  const text = str(value);
  if (!label || text == null) return;
  const id = label.toLowerCase();
  if (!map.has(id)) map.set(id, text);
}

/**
 * A status value followed by its own duration row ("Applicant Re-upload 1019 days…")
 * collapses into one string once the page text loses line breaks. Keep the status phrase.
 */
function statusPhrase(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  for (let n = 1; n <= Math.floor(words.length / 2); n += 1) {
    const head = words.slice(0, n).join(" ");
    const again = words.slice(n, n * 2).join(" ");
    if (head.toLowerCase() === again.toLowerCase()) return head;
  }
  const beforeDuration = String(value || "").split(/\s+\d[\d.]*\s+days\b/i)[0];
  return beforeDuration.trim();
}

function pairsFromStatusText(text) {
  const src = String(text || "").replace(/\s+/g, " ").trim();
  if (!src) return [];
  const lower = src.toLowerCase();
  const labels = [...STATUS_TAB_LABELS].sort((a, b) => b.length - a.length);
  const hits = [];
  for (const label of labels) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(label, from);
      if (at < 0) break;
      const beforeOk = at === 0 || /[\s:(]/.test(lower[at - 1]);
      const after = at + label.length;
      const afterOk = after >= lower.length || /[\s:]/.test(lower[after]);
      if (beforeOk && afterOk) hits.push({ at, label, end: after });
      from = at + Math.max(label.length, 1);
    }
  }
  hits.sort((a, b) => a.at - b.at || b.label.length - a.label.length);
  const kept = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.at < cursor) continue;
    kept.push(hit);
    cursor = hit.end;
  }
  const pairs = [];
  for (let i = 0; i < kept.length; i += 1) {
    const next = kept[i + 1];
    let value = src.slice(kept[i].end, next ? next.at : src.length).replace(/^:\s*/, "").trim();
    if (kept[i].label === "status" || kept[i].label === "project status") value = statusPhrase(value);
    if (value) pairs.push([kept[i].label, value]);
  }
  return pairs;
}

function pairsFromStatusTable(table) {
  const headers = Array.isArray(table && table.headers) ? table.headers : [];
  const rows = Array.isArray(table && table.rows) ? table.rows : [];
  const cells = Array.isArray(table && table.rowCells) ? table.rowCells : [];
  const pairs = [];
  const twoHeaders = headers.length === 2;
  const synthetic = twoHeaders && headers.every((h) => /^column \d+$/i.test(String(h || "")));
  if (twoHeaders && !synthetic) pairs.push([headers[0], headers[1]]);
  if (cells.length) {
    for (const row of cells) {
      if (!Array.isArray(row) || row.length < 2) continue;
      pairs.push([row[0] && row[0].text, row[1] && row[1].text]);
    }
    return pairs;
  }
  if (!twoHeaders) return pairs;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    pairs.push([row[headers[0]], row[headers[1]]]);
  }
  return pairs;
}

function statusPairMap(extracted) {
  const map = new Map();
  for (const kv of (extracted && extracted.keyValues) || []) addStatusPair(map, kv && kv.key, kv && kv.value);
  for (const table of (extracted && extracted.tables) || []) {
    for (const [key, value] of pairsFromStatusTable(table)) addStatusPair(map, key, value);
  }
  const textParts = [];
  for (const section of (extracted && extracted.sections) || []) {
    if (!section || section.type !== "text_block") continue;
    if (section.title) textParts.push(section.title);
    for (const seg of section.segments || []) textParts.push((seg && (seg.value || seg.text)) || "");
  }
  if (extracted && extracted.meta && extracted.meta.bodySnippet) textParts.push(extracted.meta.bodySnippet);
  for (const [key, value] of pairsFromStatusText(textParts.join(" "))) addStatusPair(map, key, value);
  return map;
}

function durationValue(text) {
  const value = str(text);
  return value ? { FormattedText: value } : null;
}

/** "Waiting ApplicantReUpload: 1019 days 20 hrs [Accepted]" is the status page's current step. */
function waitingStep(text) {
  const match = /waiting\s+([^:]+):\s*([^[\]]+)(?:\s*\[([^\]]+)\])?/i.exec(String(text || ""));
  if (!match) return null;
  return {
    name: str(match[1]),
    duration: str(match[2]),
    state: str(match[3]),
  };
}

function statusPick(map, ...names) {
  for (const name of names) {
    const value = map.get(String(name).toLowerCase());
    if (value) return value;
  }
  for (const [key, value] of map) {
    if (names.some((name) => key === String(name).toLowerCase())) return value;
  }
  return null;
}

/**
 * Status tab from extractStatusTabData → the payload statusFields already understands.
 * The tab is a label/value grid. The first row is often stored as table headers, and a slow
 * panel can also arrive as plain text. There is no default status when the label is absent.
 */
function statusPayloadFromTab(extracted) {
  const map = statusPairMap(extracted || {});
  let unresolvedText = statusPick(map, "Prescreen Review Comments (Unresolved)");
  if (!unresolvedText) {
    for (const [key, value] of map) {
      if (/unresolved/i.test(key)) {
        unresolvedText = value;
        break;
      }
    }
  }
  const unresolved = unresolvedText == null ? null : Number(String(unresolvedText).replace(/[^\d.-]/g, ""));
  const text = [];
  for (const section of (extracted && extracted.sections) || []) {
    if (!section || section.type !== "text_block") continue;
    if (section.title) text.push(section.title);
    for (const seg of section.segments || []) text.push((seg && (seg.value || seg.text)) || "");
  }
  if (extracted && extracted.meta && extracted.meta.bodySnippet) text.push(extracted.meta.bodySnippet);
  const step = waitingStep(text.join(" "));
  const sub = {};
  if (step && step.name) {
    sub.SubWorkflow = step.name;
    if (step.state) sub.StatusName = step.state;
    const duration = durationValue(step.duration);
    if (duration) sub.TotalDuration = duration;
  }
  const applicant = durationValue(statusPick(map, "Time with Applicant"));
  const jurisdiction = durationValue(statusPick(map, "Time with Jurisdiction"));
  if (applicant) sub.ApplicationDuration = applicant;
  if (jurisdiction) sub.JurisdictionDuration = jurisdiction;
  if (Number.isFinite(unresolved)) sub.UnresolvedComments = unresolved;
  const calendarLabel = map.has("days calculated as business days") || /days calculated as business days/i.test(text.join(" "));
  return {
    ProjectStatus: statusPick(map, "Status", "Project Status"),
    ReviewType: statusPick(map, "Review Type"),
    Owner: statusPick(map, "Owner"),
    CalendarType: statusPick(map, "Calendar Type") || (calendarLabel ? "Business Days" : null),
    // Display only. statusFields does not copy TimeElapsed, so an hourly tick does not change the section hash.
    TimeElapsed: durationValue(statusPick(map, "Time Elapsed")),
    TotalNumberOfFiles: statusPick(map, "Total Number of Files"),
    UncompleteTaskCount: statusPick(map, "Current Non-Completed Tasks", "Current Noncompleted Tasks"),
    SubWorkflows: Object.keys(sub).length ? [sub] : [],
  };
}

/**
 * Tasks-tab rows from extractTasksTabData → objects taskItems can store.
 * The grid has no WFlowTaskID. The key is the visible row, so a later API read can replace it.
 */
function taskRecordsFromTab(extracted) {
  const rows = Array.isArray(extracted && extracted.tasks) ? extracted.tasks : [];
  const seen = new Map();
  return rows.filter((row) => str(row && row.taskName)).map((row) => {
    const name = str(row.taskName);
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
