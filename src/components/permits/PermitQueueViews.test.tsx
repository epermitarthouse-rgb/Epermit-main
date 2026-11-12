import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PermitQueueDetailView } from "./PermitQueueDetailView";
import { PermitQueueGateView } from "./PermitQueueGate";
import { PermitListTable } from "./PermitRepositoryViews";
import {
  FilesSectionView,
  PermitDiagnosticsView,
  ReportContentBody,
  ReportsSectionView,
  ReviewsSectionView,
  StatusSectionView,
  TasksSectionView,
} from "./PermitSectionViews";
import type { PermitDetail, PermitListRow } from "@/lib/centralPermits";

(globalThis as { React?: typeof React }).React = React;

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const render = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

type Row = Record<string, unknown>;
const ok = (section: string): Row => ({ section, status: "ok", source_kind: "json", item_count: 1, last_ok_at: "2026-11-11T03:40:00Z", content_hash: "feedfacefeedface0000" });

const detail = (over: Partial<PermitDetail> = {}): PermitDetail => ({
  permit: { id: "p-1", adapter_key: "dc-projectdox", portal_record_id: "4242", permit_number: "D2500488", jurisdiction: "Washington DC", status_raw: "Resubmit", description: "Tenant fit-out", address: "1 Main St" },
  sections: ["status", "info", "tasks", "workflows", "reviews", "files", "reports"].map(ok),
  comments: [{ id: "c1", portal_comment_key: "k1", ref_number: 1, cycle: 1, department: "Zoning", status: "Unresolved", body: "Provide setbacks" }],
  responses: [{ id: "r1", comment_key: "k1", seq: 1, responder_role: "Applicant", body: "See sheet A-101" }],
  workflows: [{ id: "w1", name: "Plan Review", state: "Active", portal_workflow_id: "WF-555", content_hash: "wfhash00000000000000" }],
  tasks: [{ id: "t1", name: "Resubmit plans", group_name: "Applicant", status: "Open", portal_task_id: "TASK-777" }],
  folders: [{ id: "f1", portal_folder_id: "9", name: "Drawings", download_permitted: true }],
  documents: [{ id: "d1", portal_file_id: "FILE-1", portal_folder_id: "9", file_name: "A-101.pdf", version: 1, download_permitted: true, download_status: "stored", storage_path: "p-1/files/FILE-1_A-101.pdf", sha256: "shashashashashasha00" }],
  reports: [{ id: "rep1", report_key: "14", name: "Plan Review - Review Comments", portal_report_id: "14" }],
  changes: [],
  sources: [{ credential_id: "cred-1234-5678", first_seen_at: null, last_seen_at: null }],
  snapshots: [{ id: "snap-0001-xyz", section: "status", source_kind: "json", run_id: "run-9999-abcd", captured_at: "2026-11-11T03:40:00Z", payload: { ProjectStatus: "Resubmit" } }],
  ...over,
});

const DIAGNOSTICS = /run-9999-abcd|snap-0001-xyz|feedfacefeedface|TASK-777|WF-555|FILE-1<|cred-1234|shashasha|GetWorkflowInstanceStatusData|data-permit-diagnostics/;
const MUTATION_CONTROL = /<button[^>]*>[^<]*(Accept|Complete|Upload|Respond|Reply|Submit|Resubmit|Assign|Approve|Mark as|Delete|Save)[^<]*<\/button>/i;

describe("Permit Queue list", () => {
  const row = (over: Partial<PermitListRow> = {}): PermitListRow => ({
    id: "p-1", adapter_key: "dc-projectdox", jurisdiction: "Washington DC", permit_number: "D2500488", title: "Title", description: "Tenant fit-out",
    address: "1 Main St", status: "resubmit", status_raw: "Resubmit", review_type: null, unresolved_comments: 2, uncompleted_tasks: 3,
    last_synced_at: null, last_changed_at: null, removed_from_portal_at: null, matched_in: null, total_count: 1, ...over,
  });

  it("shows the portal dashboard columns and the project link", () => {
    const html = render(createElement(PermitListTable, { rows: [row(), row({ id: "p-2", permit_number: "B1" })], linkCounts: new Map([["p-1", 2]]) }));
    for (const h of ["Permit number", "Description", "Location", "Status", "Tasks", "Project"]) assert.match(html, new RegExp(`>${h}<`));
    assert.match(html, /Tenant fit-out/);
    assert.match(html, /1 Main St/);
    assert.match(html, />3</);
    assert.match(html, /Linked \(2\)/);
    assert.match(html, /Not linked/);
    assert.match(html, /href="\/permit-queue\/p-1"/);
  });
});

describe("Permit Queue detail", () => {
  it("shows the tabs in portal order, then History; Diagnostics only for admins", () => {
    const user = render(createElement(PermitQueueDetailView, { detail: detail(), isAdmin: false }));
    const order = [...user.matchAll(/data-permit-tab="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ["tasks", "files", "status", "info", "reports", "reviews", "history"]);
    assert.doesNotMatch(user, DIAGNOSTICS);
    const admin = render(createElement(PermitQueueDetailView, { detail: detail(), isAdmin: true, defaultTab: "diagnostics" }));
    assert.deepEqual([...admin.matchAll(/data-permit-tab="([a-z]+)"/g)].map((m) => m[1]).at(-1), "diagnostics");
    assert.match(admin, /data-permit-diagnostics/);
    assert.match(admin, /run-9999-abcd/);
  });

  it("opens on Tasks and renders each tab's content without diagnostics", () => {
    const html = render(createElement(PermitQueueDetailView, { detail: detail(), isAdmin: false }));
    assert.match(html, /Resubmit plans/);
    for (const tab of ["files", "status", "info", "reports", "reviews"] as const) {
      const t = render(createElement(PermitQueueDetailView, { detail: detail(), isAdmin: false, defaultTab: tab }));
      assert.doesNotMatch(t, DIAGNOSTICS, `diagnostics leaked into ${tab}`);
    }
    assert.match(render(createElement(PermitQueueDetailView, { detail: detail(), isAdmin: false, defaultTab: "reviews" })), /Provide setbacks/);
    assert.match(render(createElement(PermitQueueDetailView, { detail: detail(), isAdmin: false, defaultTab: "files" })), /A-101\.pdf/);
  });

  // Radix renders only the active tab's content, so each render shows one tab.
  it("Tasks shows the active tasks, then the workflows table (as on the portal); Status no longer repeats it", () => {
    const steps = { id: "snap-2", section: "status", source_kind: "json", run_id: "r", captured_at: "2026-11-11T03:41:00Z", payload: { SubWorkflows: [{ SubWorkflow: "Intake review", StatusName: "Done" }] } };
    const noTasks = detail({ tasks: [], workflows: [{ id: "w1", name: "Plan Review", state: "Completed" }], snapshots: [steps] });
    const tasks = render(createElement(PermitQueueDetailView, { detail: noTasks, isAdmin: false }));
    assert.match(tasks, /The portal listed no open tasks/);
    assert.match(tasks, />Workflows</);
    assert.match(tasks, /Plan Review/);
    assert.ok(tasks.indexOf("open tasks") < tasks.indexOf(">Workflows<"), "tasks first, then the workflow table");
    assert.doesNotMatch(tasks, /Review steps/);
    const status = render(createElement(PermitQueueDetailView, { detail: noTasks, isAdmin: false, defaultTab: "status" }));
    assert.doesNotMatch(status, />Workflows</);
    assert.doesNotMatch(status, /Plan Review/);
    assert.match(status, /Review steps/);
    assert.match(status, /Intake review/);
  });

  it("Files and Reports pills count stored content; a failed read keeps the read status", () => {
    const doc = (id: string, over: Row = {}): Row => ({ id, portal_file_id: id, portal_folder_id: "9", file_name: `${id}.pdf`, download_permitted: true, download_status: "pending", ...over });
    const docs = [
      doc("a", { download_status: "stored", storage_path: "p-1/files/a.pdf" }),
      doc("b", { download_status: "stored", storage_path: "p-1/files/b.pdf", download_permitted: false, capture_access_path: "viewer" }),
      doc("c"), doc("d", { download_status: "failed" }), doc("e", { download_status: "deferred_oversize" }),
      doc("gone", { removed_at: "2026-11-01T00:00:00Z" }),
    ];
    const reports = ["4", "12", "14", "15", "16"].map((k, i) => ({ id: `r${k}`, report_key: k, name: `R${k}`, content_status: i < 4 ? "captured" : "failed" }));
    const files = render(createElement(PermitQueueDetailView, { detail: detail({ documents: docs, reports }), isAdmin: false, defaultTab: "files" }));
    assert.match(files, /data-permit-content-pill="files"[^>]*>2 of 5 files stored · 2 pending · 1 too large</);
    const reps = render(createElement(PermitQueueDetailView, { detail: detail({ documents: docs, reports }), isAdmin: false, defaultTab: "reports" }));
    assert.match(reps, /data-permit-content-pill="reports"[^>]*>4 of 5 reports</);
    assert.doesNotMatch(reps, DIAGNOSTICS);
    const failedRead = detail({ documents: docs, sections: detail().sections.map((s) => (s.section === "files" ? { ...s, status: "failed", last_error: "session_ended" } : s)) });
    const blocked = render(createElement(PermitQueueDetailView, { detail: failedRead, isAdmin: false, defaultTab: "files" }));
    assert.doesNotMatch(blocked, /data-permit-content-pill/);
    assert.match(blocked, /Inaccessible \/ blocked/);
  });

  it("renders the linked-projects panel and header actions passed in", () => {
    const html = render(createElement(PermitQueueDetailView, {
      detail: detail(), isAdmin: false,
      linksPanel: createElement("div", { "data-links": true }, "Linked projects"),
      actions: createElement("span", null, "EXPORT"),
    }));
    assert.match(html, /data-links/);
    assert.match(html, /EXPORT/);
  });

  it("has no state-changing portal controls on any tab", () => {
    for (const tab of ["tasks", "files", "status", "info", "reports", "reviews", "history", "diagnostics"] as const) {
      const html = render(createElement(PermitQueueDetailView, { detail: detail(), isAdmin: true, defaultTab: tab, onViewDocument: () => undefined, onViewReport: () => undefined }));
      assert.doesNotMatch(html, MUTATION_CONTROL, `mutation control on ${tab}`);
    }
    const sources = ["PermitSectionViews.tsx", "PermitQueueDetailView.tsx", "../../pages/permits/PermitDetailPage.tsx", "../../pages/permits/PermitsPage.tsx"].map(src).join("\n");
    assert.doesNotMatch(sources, /\b(AcceptTask|ProcessTask|completeTask|uploadFile|saveResponse)\b|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it("diagnostics render nothing for non-admins", () => {
    assert.equal(render(createElement(PermitDiagnosticsView, { isAdmin: false, detail: detail() })), "");
    const html = render(createElement(PermitDiagnosticsView, { isAdmin: true, detail: detail() }));
    for (const needle of ["run-9999-abcd", "snap-0001", "feedfacefeed", "TASK-777", "WF-555", "FILE-1", "p-1/files/FILE-1_A-101.pdf", "GetWorkflowInstanceStatusData"]) {
      assert.ok(html.includes(needle), `diagnostics missing ${needle}`);
    }
  });
});

describe("Permit Queue tabs", () => {
  it("Tasks lists portal tasks", () => {
    const html = render(createElement(TasksSectionView, { tasks: detail().tasks, state: ok("tasks") }));
    assert.match(html, /Resubmit plans/);
    assert.match(html, /Applicant/);
  });

  it("Status shows the portal status", () => {
    const d = detail();
    assert.match(render(createElement(StatusSectionView, { permit: d.permit, state: ok("status"), snapshots: d.snapshots })), /Resubmit/);
  });

  it("Files: a stored file gets a View action; others say why not; earlier versions are listed", () => {
    const html = render(createElement(FilesSectionView, {
      folders: [
        { id: "f1", portal_folder_id: "1", name: "Approved Drawings", download_permitted: true },
        { id: "f2", portal_folder_id: "2", name: "Architectural", parent_portal_folder_id: "1", download_permitted: true },
        { id: "f3", portal_folder_id: "3", name: "Correspondence", download_permitted: false },
      ],
      documents: [
        { id: "d1", portal_folder_id: "2", file_name: "A-101.pdf", version: 2, size_bytes: 1048576, page_count: 3, file_status: "Approved", uploaded_at: "2026-10-01T00:00:00Z", download_status: "stored", storage_path: "p/files/1_A-101.pdf", download_permitted: true },
        { id: "d0", portal_folder_id: "2", file_name: "A-101.pdf", version: 1, download_status: "not_requested", download_permitted: true },
        { id: "d2", portal_folder_id: "3", file_name: "Letter.pdf", version: 1, download_status: "not_permitted", download_permitted: false },
        { id: "d3", portal_folder_id: "2", file_name: "A-102.pdf", version: 1, download_status: "stored", storage_path: null, download_permitted: true },
      ],
      state: ok("files"),
      onViewDocument: () => undefined,
    }));
    assert.equal((html.match(/data-file-view/g) ?? []).length, 1);
    assert.match(html, /1 of 4 files can be opened/);
    assert.match(html, /Earlier versions \(1\)/);
    assert.match(html, /v2/);
    assert.match(html, /1\.0 MB/);
    assert.match(html, /Approved/);
    assert.match(html, /data-file-state="not_downloadable"/);
    assert.match(html, /Not downloadable on portal/);
    assert.match(html, /data-file-state="not_captured"/);
    assert.ok(html.indexOf("Approved Drawings") < html.indexOf("Architectural"), "child folder nested under parent");
    assert.doesNotMatch(html, /href=/);
    assert.doesNotMatch(html, /p\/files\/1_A-101/);
  });

  it("Files: without a view handler a stored file shows no button", () => {
    const html = render(createElement(FilesSectionView, {
      folders: [], documents: [{ id: "d1", file_name: "A.pdf", download_status: "stored", storage_path: "p/x" }], state: ok("files"),
    }));
    assert.doesNotMatch(html, /data-file-view/);
    assert.match(html, /Stored/);
  });

  it("Reports: View only for captured content; pre-migration rows read as not captured", () => {
    const html = render(createElement(ReportsSectionView, {
      reports: [
        { id: "a", report_key: "14", name: "Review Comments", content_status: "captured", latest_content_id: "c1", content_captured_at: "2026-11-11T00:00:00Z" },
        { id: "b", report_key: "4", name: "Project Summary", content_status: "failed", content_error: "viewer postback refused" },
        { id: "c", report_key: "12", name: "Old schema row" },
      ],
      state: ok("reports"),
      onViewReport: () => undefined,
    }));
    assert.equal((html.match(/data-report-view/g) ?? []).length, 1);
    assert.match(html, /data-report-state="captured"/);
    assert.match(html, /Capture failed/);
    assert.match(html, /data-report-state="not_captured"/);
    assert.doesNotMatch(html, /Report contents have not been captured yet/);
    assert.doesNotMatch(html, /viewer postback refused/);
  });

  it("Reports: the content viewer shows rows, text and export buttons only when present", () => {
    const report = { name: "Review Comments" };
    const full = render(createElement(ReportContentBody, {
      report,
      content: { version: 2, captured_at: "2026-11-11T00:00:00Z", text_content: "Comment text body", structured_rows: [{ Discipline: "Zoning", Comment: "Setbacks" }], pdf_storage_path: "p/reports/14/a.pdf", excel_storage_path: null, content_sha256: "hidden-sha" },
      versions: [{ id: "1" }, { id: "2" }],
      onOpenFile: () => undefined,
    }));
    assert.match(full, /Version 2/);
    assert.match(full, /2 versions stored/);
    assert.match(full, /Discipline/);
    assert.match(full, /Setbacks/);
    assert.match(full, /Comment text body/);
    assert.match(full, /Open PDF/);
    assert.doesNotMatch(full, /Open Excel/);
    assert.doesNotMatch(full, /hidden-sha|p\/reports\/14/);
    assert.match(render(createElement(ReportContentBody, { report, content: null })), /not available/);
  });

  it("Reviews: cards grouped by cycle and department with threads", () => {
    const html = render(createElement(ReviewsSectionView, {
      comments: [
        { id: "1", portal_comment_key: "a", cycle: 2, department: "Zoning", ref_number: 1, status: "Unresolved", body: "Zoning comment" },
        { id: "2", portal_comment_key: "b", cycle: 2, department: "Fire", ref_number: 2, status: "Resolved", body: "Fire comment", reviewer_name: "SECRET PERSON" },
        { id: "3", portal_comment_key: "c", cycle: 1, department: "Zoning", ref_number: 1, status: "Resolved", body: "Old comment" },
      ],
      responses: [{ id: "r", comment_key: "a", seq: 1, responder_role: "Applicant", responder_name: "SECRET PERSON", body: "Applicant answer" }],
      state: ok("reviews"),
    }));
    assert.match(html, /data-review-cycle="2"/);
    assert.match(html, /data-review-department="Fire"/);
    assert.ok(html.indexOf('data-review-cycle="2"') < html.indexOf('data-review-cycle="1"'));
    assert.ok(html.indexOf('data-review-department="Fire"') < html.indexOf('data-review-department="Zoning"'));
    assert.match(html, /Applicant answer/);
    assert.match(html, /Discussion \(1\)/);
    assert.doesNotMatch(html, /SECRET PERSON/);
  });
});

describe("Permit Queue flag, nav and routes", () => {
  it("flag OFF shows the placeholder; ON shows the queue", () => {
    const queue = createElement("div", null, "REAL QUEUE");
    const off = render(createElement(PermitQueueGateView, { enabled: false, children: queue }));
    assert.match(off, /Coming soon/);
    assert.doesNotMatch(off, /REAL QUEUE/);
    assert.match(render(createElement(PermitQueueGateView, { enabled: true, children: queue })), /REAL QUEUE/);
  });

  it("nav has a real Permit Queue entry and no Permit Repository entry", () => {
    const nav = src("../layout/hybridNav.ts");
    assert.doesNotMatch(nav, /title: "Permit Repository"/);
    assert.doesNotMatch(nav, /href: "\/permits"/);
    const entry = nav.match(/\{\s*title: "Permit Queue",[\s\S]*?\}/)?.[0] ?? "";
    assert.match(entry, /href: "\/permit-queue"/);
    assert.doesNotMatch(entry, /comingSoon/);
  });

  it("routes: /permit-queue pages are gated; /permits and /permits/:id redirect", () => {
    const app = src("../../App.tsx");
    assert.match(app, /path="\/permit-queue" element=\{<PermitQueueGate><PermitsPage \/><\/PermitQueueGate>\}/);
    assert.match(app, /path="\/permit-queue\/:permitId" element=\{<PermitQueueGate><PermitDetailPage \/><\/PermitQueueGate>\}/);
    assert.match(app, /path="\/permits" element=\{<Navigate to="\/permit-queue" replace \/>\}/);
    assert.match(app, /path="\/permits\/:permitId" element=\{<LegacyPermitRedirect \/>\}/);
    assert.match(src("PermitQueueGate.tsx"), /<Navigate to=\{permitQueuePath\(permitId\)\} replace \/>/);
  });

  it("the queue pages keep the local inspection banner and admin export", () => {
    const list = src("../../pages/permits/PermitsPage.tsx");
    const page = src("../../pages/permits/PermitDetailPage.tsx");
    assert.match(list, /<LocalInspectionBanner \/>/);
    assert.match(list, /<DcZipExportButton \/>/);
    assert.match(page, /<LocalInspectionBanner \/>/);
    assert.match(page, /PermitJsonExportButton/);
    assert.match(page, /useRequireAdmin/);
    assert.doesNotMatch(page + list, /portal_credentials|credentialId/);
  });
});
