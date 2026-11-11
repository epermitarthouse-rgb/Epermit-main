import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  ExtractionOverview,
  FilesSectionView,
  InfoSectionView,
  ReportsSectionView,
  ReviewsSectionView,
  SectionProvenance,
  StatusSectionView,
  TasksSectionView,
  WorkflowsSectionView,
} from "./PermitSectionViews";
import { AdminExportButton } from "./PermitExportButtons";
import { LocalInspectionBanner } from "./LocalInspectionBanner";

(globalThis as { React?: typeof React }).React = React;

const __dirname = dirname(fileURLToPath(import.meta.url));
const render = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

type Row = Record<string, unknown>;
const ok = (section: string, extra: Row = {}): Row => ({ section, status: "ok", source_kind: "json", item_count: 2, last_attempt_at: "2026-11-11T03:40:00Z", last_ok_at: "2026-11-11T03:40:00Z", content_hash: "abcdef0123456789abcdef", ...extra });
const snap = (section: string, payload: unknown, extra: Row = {}): Row => ({
  id: `snap-${section}-0000-0000`, section, source_kind: "json", run_id: "run-aaaa-bbbb", captured_at: "2026-11-11T03:40:00Z", payload_bytes: 1234, payload, ...extra,
});
const DIAGNOSTIC = /run-aaaa-bbbb|snap-[a-z]+-0000|GetWorkflowInstanceStatusData|ProjectInfo \(HTML|abcdef0123456789|data-section-provenance/;

describe("permit section views", () => {
  it("overview lists all seven sections with their extraction status", () => {
    const html = render(createElement(ExtractionOverview, {
      states: [ok("status"), { section: "reviews", status: "absent" }, { section: "files", status: "failed", last_error: "safety_violation: refused" }],
      snapshots: [snap("status", {})],
    }));
    for (const label of ["Status", "Info", "Tasks", "Workflows", "Reviews", "Files", "Reports"]) assert.match(html, new RegExp(`>${label}<`));
    assert.match(html, /Captured/);
    assert.match(html, /Absent on portal/);
    assert.match(html, /Inaccessible \/ blocked/);
    assert.match(html, /Not captured/);
  });

  it("status shows portal fields and its capture status, but no provenance", () => {
    const html = render(createElement(StatusSectionView, {
      permit: { status: "resubmit", summary: { unresolved_by_group: [{ group: "Zoning", unresolved: 2 }] } },
      state: ok("status"),
      snapshots: [snap("status", { ProjectStatus: "Resubmit", ReviewType: "Building", TimeElapsed: { Days: 3, Hours: 1, FormattedText: "3 days  1 hrs" }, SubWorkflows: [{ SubWorkflow: "A" }] })],
    }));
    assert.match(html, /Resubmit/);
    assert.match(html, /3 days 1 hrs/);
    assert.match(html, /Zoning/);
    assert.match(html, /Captured/);
    assert.match(html, /Last captured/);
    assert.doesNotMatch(html, DIAGNOSTIC);
  });

  it("section provenance (diagnostics) keeps the route, job id, snapshot id, size and hash", () => {
    const html = render(createElement(SectionProvenance, { section: "status", state: ok("status"), snapshots: [snap("status", {})] }));
    assert.match(html, /GetWorkflowInstanceStatusData/);
    assert.match(html, /run-aaaa-bbbb/);
    assert.match(html, /snap-status-0000-0000/);
    assert.match(html, /1,234 bytes/);
    assert.match(html, /abcdef0123456789/);
  });

  it("an absent section says so and shows no data (TL2600008 case)", () => {
    const html = render(createElement(StatusSectionView, { permit: {}, state: { section: "status", status: "absent" }, snapshots: [] }));
    assert.match(html, /Absent on portal/);
    assert.match(html, /portal does not offer status data/);
    const reviews = render(createElement(ReviewsSectionView, { comments: [], responses: [], state: { section: "reviews", status: "absent" } }));
    assert.match(reviews, /portal does not offer review comments/);
  });

  it("an inaccessible section names the refusal; a missing one says not captured", () => {
    const blocked = render(createElement(TasksSectionView, { tasks: [], state: { section: "tasks", status: "failed", last_error: "session_ended: portal API answered 401" } }));
    assert.match(blocked, /Inaccessible \/ blocked/);
    assert.match(blocked, /could not be read from the portal/);
    const missing = render(createElement(TasksSectionView, { tasks: [], state: null }));
    assert.match(missing, /were not captured/);
  });

  it("info renders every captured portal field without the source route", () => {
    const html = render(createElement(InfoSectionView, {
      permit: { permit_number: "X1", portal_record_id: "100" },
      state: ok("info", { source_kind: "html" }),
      snapshots: [snap("info", { jobClass: "Alteration", ownerOrg: "Owner Org LLC", startDate: "2025-01-02", extraField: "kept" }, { source_kind: "html" })],
    }));
    assert.match(html, /Alteration/);
    assert.match(html, /Owner Org LLC/);
    assert.match(html, /extraField/);
    assert.match(html, /X1/);
    assert.doesNotMatch(html, DIAGNOSTIC);
  });

  it("tasks and workflows render rows and the review steps, without portal ids", () => {
    const tasks = render(createElement(TasksSectionView, { tasks: [{ id: "t", name: "Resubmit plans", group_name: "Applicant", accepted: false, portal_task_id: "777" }], state: ok("tasks") }));
    assert.match(tasks, /Resubmit plans/);
    assert.doesNotMatch(tasks, />777</);
    const wf = render(createElement(WorkflowsSectionView, {
      workflows: [{ id: "w", name: "Plan Review", state: "Active", current_activity: "Review", portal_workflow_id: "555" }],
      state: ok("workflows"),
      snapshots: [snap("status", { SubWorkflows: [{ SubWorkflow: "Fire Review", StatusName: "In Progress", UnresolvedComments: 3, UnresolvedByGroup: [{ GroupName: "Fire", UnresolvedComments: 3 }], UncompletedTasks: [{ TaskName: "Review", GroupName: "Fire" }], TotalDuration: { FormattedText: "5 days" } }] })],
    }));
    assert.match(wf, /Plan Review/);
    assert.match(wf, /Fire Review/);
    assert.match(wf, /Fire: 3/);
    assert.match(wf, /5 days/);
    assert.doesNotMatch(wf, />555</);
  });

  it("reviews group comments by cycle and show every discussion entry in order", () => {
    const html = render(createElement(ReviewsSectionView, {
      comments: [
        { id: "c1", portal_comment_key: "k1", ref_number: 1, cycle: 1, status: "Resolved", body: "First cycle comment" },
        { id: "c2", portal_comment_key: "k2", ref_number: 2, cycle: 2, status: "Unresolved", department: "Zoning", body: "Second cycle comment" },
      ],
      responses: [
        { id: "r2", comment_key: "k2", seq: 2, responder_role: "Reviewer", body: "Reviewer reply" },
        { id: "r1", comment_key: "k2", seq: 1, responder_role: "Applicant", body: "Applicant reply" },
      ],
      state: ok("reviews"),
    }));
    assert.match(html, /Review cycle 2 · 1 comment · 1 unresolved/);
    assert.match(html, /Review cycle 1/);
    assert.ok(html.indexOf("Review cycle 2") < html.indexOf("Review cycle 1"));
    assert.ok(html.indexOf("Applicant reply") < html.indexOf("Reviewer reply"));
    assert.match(html, /Discussion \(2\)/);
  });

  it("files without a stored copy show portal metadata, no link and no viewer", () => {
    const html = render(createElement(FilesSectionView, {
      folders: [{ id: "f", name: "Drawings", portal_folder_id: "9", files_count: 1, download_permitted: false }],
      documents: [{ id: "d", file_name: "A-101.pdf", portal_folder_id: "9", version: 2, size_bytes: 2048, download_permitted: false, download_status: "not_permitted" }],
      state: ok("files"),
      onViewDocument: () => undefined,
    }));
    assert.match(html, /No file copies are stored yet/);
    assert.match(html, /A-101\.pdf/);
    assert.match(html, /2\.0 KB/);
    assert.match(html, /Not downloadable on portal/);
    assert.doesNotMatch(html, /<a\s/);
    assert.doesNotMatch(html, /download=|href=/);
    assert.doesNotMatch(html, /data-file-view/);
    assert.doesNotMatch(html, /lucide-file/);
  });

  it("reports without captured content say so and offer no viewer", () => {
    const html = render(createElement(ReportsSectionView, {
      reports: [{ id: "r", report_key: "14", name: "Plan Review - Review Comments", category: "ProjectFlow", portal_report_id: "14" }],
      state: ok("reports"),
      onViewReport: () => undefined,
    }));
    assert.match(html, /Report contents have not been captured yet/);
    assert.match(html, /Not captured/);
    assert.doesNotMatch(html, /data-report-view/);
  });

  it("section views never reference personal-name columns", () => {
    const source = readFileSync(join(__dirname, "PermitSectionViews.tsx"), "utf8");
    assert.doesNotMatch(source, /reviewer_name|responder_name|TaskUserFullName|UserName/);
  });
});

describe("admin gating of export and inspection banner", () => {
  it("the export button renders only for platform admins", () => {
    const props = { label: "Export JSON", busy: false, onClick: () => undefined };
    assert.equal(render(createElement(AdminExportButton, { ...props, isAdmin: false })), "");
    assert.match(render(createElement(AdminExportButton, { ...props, isAdmin: true })), /Export JSON/);
  });

  it("the inspection banner shows only when local inspection is active", () => {
    assert.equal(render(createElement(LocalInspectionBanner, { active: false })), "");
    assert.match(render(createElement(LocalInspectionBanner, { active: true })), /read-only inspection/);
  });
});
