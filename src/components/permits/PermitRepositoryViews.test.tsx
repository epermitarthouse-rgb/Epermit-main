import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  DocumentsView,
  HistoryView,
  PermitListTable,
  ReviewsView,
  SectionHealth,
} from "./PermitRepositoryViews";
import type { PermitListRow } from "@/lib/centralPermits";

// Shared design primitives rely on the app's automatic JSX runtime; tsx compiles tests with the classic one.
(globalThis as { React?: typeof React }).React = React;

const __dirname = dirname(fileURLToPath(import.meta.url));
const render = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

const row = (over: Partial<PermitListRow> = {}): PermitListRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  adapter_key: "dc-projectdox",
  jurisdiction: "Washington DC",
  permit_number: "D2500488",
  title: null,
  description: null,
  address: "1 Main St",
  status: "resubmit",
  status_raw: "Resubmit",
  review_type: "BIC Building",
  unresolved_comments: 1,
  uncompleted_tasks: 1,
  last_synced_at: null,
  last_changed_at: "2026-11-05T15:00:00Z",
  removed_from_portal_at: null,
  matched_in: "comments",
  total_count: 1,
  ...over,
});

describe("permit repository views", () => {
  it("list links to the Permit Queue detail page and flags removed permits and match source", () => {
    const html = render(createElement(PermitListTable, { rows: [row(), row({ id: "2", permit_number: "B1", removed_from_portal_at: "2026-11-01T00:00:00Z", matched_in: null })] }));
    assert.match(html, /href="\/permit-queue\/11111111-1111-4111-8111-111111111111"/);
    assert.doesNotMatch(html, /href="\/permits\//);
    assert.match(html, /Matched in Comments/);
    assert.match(html, /No longer on portal/);
    assert.match(html, /Never synced/);
  });

  it("empty list explains access scoping", () => {
    assert.match(render(createElement(PermitListTable, { rows: [] })), /granted access/);
  });

  it("reviews hide soft-removed comments and attach responses by comment key", () => {
    const html = render(createElement(ReviewsView, {
      comments: [
        { id: "c1", portal_comment_key: "ref:3", ref_number: 3, department: "DOEE EV", status: "Unresolved", body: "Lead abatement notice" },
        { id: "c2", portal_comment_key: "ref:9", ref_number: 9, body: "Old removed comment", removed_at: "2026-10-01T00:00:00Z" },
      ],
      responses: [{ id: "r1", comment_key: "ref:3", responder_role: "Applicant", body: "Plan attached" }],
    }));
    assert.match(html, /Lead abatement notice/);
    assert.match(html, /Plan attached/);
    assert.match(html, /Applicant/);
    assert.doesNotMatch(html, /Old removed comment/);
  });

  it("documents say metadata only unless a copy is stored", () => {
    const html = render(createElement(DocumentsView, {
      documents: [
        { id: "d1", file_name: "A-101.pdf", version: 2, download_status: "not_permitted" },
        { id: "d2", file_name: "A-102.pdf", version: 1, download_status: "stored" },
      ],
    }));
    assert.match(html, /Metadata only/);
    assert.match(html, /Stored/);
  });

  it("section health and history render statuses and changed field names", () => {
    assert.match(render(createElement(SectionHealth, { sections: [{ section: "reviews", status: "failed", item_count: null }] })), /Reviews[\s\S]*failed/);
    const html = render(createElement(HistoryView, {
      changes: [{ id: "x", section: "status", change_type: "updated", entity_key: "permit", field_changes: { unresolved_comments: {}, status: {} } }],
    }));
    assert.match(html, /status, unresolved_comments/);
  });

  it("views never render reviewer or responder personal names", () => {
    const source = readFileSync(join(__dirname, "PermitRepositoryViews.tsx"), "utf8");
    assert.doesNotMatch(source, /reviewer_name|responder_name/);
  });
});
