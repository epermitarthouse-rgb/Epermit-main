"use strict";

/**
 * DC JSON sources verified live on 2026-11-06 (DC_DEEP_EXTRACTION_REQUIREMENTS.md §3.5, §3.8, §3.3):
 * GetProjectCorrectionsByCycleInstance (Reviews), GetReportList (Reports), GetActiveWorkflowTaskList (Tasks).
 * Offline only.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const dc = require("../permit-sync/adapters/dc-projectdox/normalize");
const { buildDcUrl } = require("../permit-sync/adapters/dc-projectdox/routes");
const { evaluateRequest } = require("../permit-sync/core/safety");

const FIX = path.join(__dirname, "fixtures", "permit-sync", "dc");
const correctionsJson = require(path.join(FIX, "corrections-json-11975.json"));
const renderedRows = require(path.join(FIX, "corrections-resubmit.json")).rows;
const reportList = require(path.join(FIX, "report-list-11854.json")).items;
const activeTasks = require(path.join(FIX, "active-tasks-9187.json"));

const minute = (s) => (s ? s.slice(0, 16) : s);

test("corrections JSON: one row per correction with the rendered Reviews tab values", () => {
  const rows = dc.correctionRowsFromJson(correctionsJson);
  assert.deepEqual(rows.map((r) => r.ref), [1, 2, 3, 4, 5]);
  for (const want of renderedRows) {
    const got = rows.find((r) => r.ref === want.ref);
    assert.equal(got.department, want.department, `ref ${want.ref} department`);
    assert.equal(got.reviewer, "reviewer", `ref ${want.ref} reviewer role`);
    assert.equal(minute(got.reviewedAt), minute(want.reviewedAt), `ref ${want.ref} reviewedAt`);
    assert.equal(got.cycle, want.cycle, `ref ${want.ref} cycle`);
    assert.equal(got.status, want.status, `ref ${want.ref} status`);
    assert.equal(got.type, want.type, `ref ${want.ref} type`);
    assert.ok(got.text.startsWith(want.text), `ref ${want.ref} text`);
    assert.deepEqual(
      got.responses.map((r) => [r.by, minute(r.at), r.text]),
      want.responses.map((r) => [r.by, minute(r.at), r.text]),
      `ref ${want.ref} responses (oldest first)`,
    );
  }
});

test("corrections JSON: blank cycle, 'None' file name, rich text and response column", () => {
  const rows = dc.correctionRowsFromJson(correctionsJson);
  const byRef = Object.fromEntries(rows.map((r) => [r.ref, r]));
  assert.equal(byRef[1].cycle, null, "refs 1 and 2 have no cycle in the Reviews tab and the report");
  assert.equal(byRef[2].cycle, null);
  assert.ok(rows.every((r) => r.fileName === null), "FileName 'None' is not a file");
  assert.ok(!/[<>]/.test(byRef[3].text), "HTML comment text is reduced to visible text");
  assert.ok(byRef[3].text.includes("contact [email] or apply online"));
  assert.equal(byRef[3].responseColumn, "Type your response here.");
  assert.equal(byRef[5].responseColumn, "No response required.");
  assert.equal(byRef[4].responseColumn, "none");
  assert.equal(byRef[1].responses[0].at, "2025-09-04T12:29:58.843", "seconds kept from DateUpdated");
  assert.equal(dc.correctionRowsFromJson({}), null);
});

test("corrections JSON → repository items: roles only, no names, UTC times", () => {
  const { comments, responses } = dc.reviewItems(dc.correctionRowsFromJson(correctionsJson), { sourceKind: "json" });
  assert.equal(comments.length, 5);
  assert.equal(responses.length, 5);
  assert.ok(comments.every((c) => c.fields.reviewer_name === null && c.fields.source_kind === "json"));
  assert.ok(responses.every((r) => r.fields.responder_name === null));
  assert.deepEqual(responses.filter((r) => r.fields.comment_key === "ref:3").map((r) => r.fields.responder_role), ["applicant", "reviewer"]);
  const ref4 = comments.find((c) => c.key === "ref:4");
  assert.equal(ref4.fields.reviewed_at, "2025-09-15T12:37:14.000Z", "EDT wall clock → UTC (fractional seconds dropped)");
  const ref5 = comments.find((c) => c.key === "ref:5");
  assert.equal(ref5.fields.reviewed_at, "2026-01-08T15:00:45.000Z", "EST wall clock → UTC");
  assert.equal(ref5.fields.response_required, false);
  assert.equal(JSON.stringify({ comments, responses }).includes("[redacted]"), false, "presence marker is not copied");
});

test("report list JSON → listReports items keyed by QueryReportID", () => {
  const items = dc.reportListItems(reportList);
  assert.deepEqual(items.map((r) => r.key), ["4", "12", "14", "15", "16"]);
  assert.deepEqual(items.find((r) => r.key === "14"), {
    key: "14", name: "Plan Review - Review Comments", category: "ProjectFlow", reportId: "14",
    viewer: { reportPath: "/WashingtonDCProd/ProjectDox/Plan Review - Review Comments", dataSourceName: "DataSource1", paramQuery: "&ProjectID=11854&WFlowInstanceID=11975&Timezone=" },
  });
  assert.equal(dc.reportItems(items).length, 5);
  assert.deepEqual(dc.reportItems(items).find((r) => r.key === "14").fields, { name: "Plan Review - Review Comments", category: "ProjectFlow", portal_report_id: "14" }, "viewer metadata is not part of the section content");
});

test("active task list: tasks are under Tasks[]; verified fields map", () => {
  const [t] = dc.taskItems(activeTasks.Tasks);
  assert.equal(t.key, "132768");
  assert.equal(t.fields.name, "Upload and Submit");
  assert.equal(t.fields.group_name, "Applicant");
  assert.equal(t.fields.status, "Accepted");
  assert.equal(t.fields.accepted, true);
  assert.equal(t.fields.due_at, "2025-08-08T18:29:08.000Z");
  assert.equal(t.fields.started_at, null, "DateCreated is not mapped to started_at");
});

test("routes: new JSON routes build the observed URLs and pass the read guard", () => {
  const list = buildDcUrl("report_list", { projectId: 11854 });
  assert.equal(new URL(list).search, "?assignedToProjectOnly=true&reportTypes=1&reportTypes=10&reportTypes=11&projectId=11854");
  const corr = buildDcUrl("project_corrections_json", { wflowInstanceID: 11975 });
  assert.match(corr, /GetProjectCorrectionsByCycleInstance\?wflowTaskID=&wflowActivityID=&groupID=&wflowReviewCycleID=&retrieveFilterOptions=true&wflowInstanceID=11975$/);
  for (const url of [list, corr]) assert.equal(evaluateRequest({ method: "GET", url }).allowed, true, url);
  const report = buildDcUrl("review_comments_report", { ProjectID: 11854, WFlowInstanceID: 11975, Timezone: "" });
  assert.equal(evaluateRequest({ method: "GET", url: report }).allowed, true);
  assert.equal(evaluateRequest({ method: "GET", url: `${report}&rs:Format=PDF` }).allowed, false, "export stays denied");
});

test("htmlToText decodes entities and keeps word boundaries", () => {
  assert.equal(dc.htmlToText("<p><strong>A</strong></p><p>B&nbsp;&amp;&#39;C</p>"), "A B &'C");
  assert.equal(dc.htmlToText("x<br>y"), "x y");
  assert.equal(dc.htmlToText("  "), null);
});
