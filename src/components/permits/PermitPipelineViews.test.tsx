import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  LinkedPermitList,
  PermitChoiceList,
  PermitLinkedProjectList,
  PortalCommentMarkerBadge,
  ResponseMatrixPermitStripView,
} from "./PermitPipelineViews";
import { PermitCommentsCell } from "./PermitQueueCommentsCell";
import type { PermitListRow } from "@/lib/centralPermits";
import type { LinkedPermit, PipelineOverviewRow } from "@/lib/projectPermits";

(globalThis as { React?: typeof React }).React = React;

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

const PERMIT = "06fa082e-0000-4000-8000-000000000001";
const PROJECT = "ff193644-0000-4000-8000-000000000001";

const permit: LinkedPermit = {
  permit_id: PERMIT,
  permit_number: "BCIV2500152",
  jurisdiction: "Washington DC",
  address: "1 Main St",
  title: null,
  status_raw: "In Review",
  last_synced_at: null,
  linked_at: "2026-11-01T00:00:00Z",
};

function overview(patch: Partial<PipelineOverviewRow> = {}): PipelineOverviewRow {
  return {
    project_id: PROJECT,
    project_name: "Test project",
    permit_id: PERMIT,
    permit_number: "BCIV2500152",
    jurisdiction: "Washington DC",
    linked_at: "2026-11-01T00:00:00Z",
    processing_state: "processed",
    comments_in_matrix: 6,
    comments_removed: 0,
    comments_changed: 0,
    portal_comments: 6,
    last_completed_at: null,
    next_attempt_at: null,
    can_edit: true,
    last_error: null,
    ...patch,
  };
}

describe("LinkedPermitList", () => {
  it("shows an empty state", () => {
    const html = render(createElement(LinkedPermitList, { permits: [], overview: new Map(), canEdit: true, isAdmin: false }));
    assert.match(html, /No permit is linked/);
  });

  it("shows processing state, counts and a permit link; Unlink only for editors", () => {
    const map = new Map([[PERMIT, overview({ comments_changed: 1 })]]);
    const viewer = render(createElement(LinkedPermitList, { permits: [permit], overview: map, canEdit: false, isAdmin: false, onUnlink: () => {} }));
    assert.match(viewer, /BCIV2500152/);
    assert.match(viewer, /In Response Matrix/);
    assert.match(viewer, /6 of 6 comments in the Response Matrix · 1 updated on the portal/);
    assert.match(viewer, new RegExp(`href="/permit-queue/${PERMIT}"`));
    assert.doesNotMatch(viewer, /Unlink/);
    const editor = render(createElement(LinkedPermitList, { permits: [permit], overview: map, canEdit: true, isAdmin: false, onUnlink: () => {} }));
    assert.match(editor, />Unlink</);
  });

  it("shows the diagnostic to admins only", () => {
    const map = new Map([[PERMIT, overview({ processing_state: "needs_attention", last_error: "classifier timeout" })]]);
    const user = render(createElement(LinkedPermitList, { permits: [permit], overview: map, canEdit: true, isAdmin: false }));
    assert.match(user, /Needs attention/);
    assert.doesNotMatch(user, /classifier timeout/);
    const admin = render(createElement(LinkedPermitList, { permits: [permit], overview: map, canEdit: true, isAdmin: true }));
    assert.match(admin, /Admin diagnostic: classifier timeout/);
  });
});

describe("PermitLinkedProjectList", () => {
  it("offers navigation and Try again for editors, and never mentions projects the caller cannot see", () => {
    const html = render(createElement(PermitLinkedProjectList, {
      rows: [overview({ processing_state: "retrying" })],
      isAdmin: false,
      onOpenMatrix: () => {},
      onOpenProject: () => {},
      onProcess: () => {},
      onUnlink: () => {},
    }));
    assert.match(html, /Test project/);
    assert.match(html, /Response Matrix/);
    assert.match(html, /Portal Harvest/);
    assert.match(html, /Try again/);
    assert.doesNotMatch(html, /do not have access/, "no count of other organizations' projects (D-120)");
  });

  it("hides edit actions for read-only users", () => {
    const html = render(createElement(PermitLinkedProjectList, {
      rows: [overview({ can_edit: false })],
      isAdmin: false,
      onProcess: () => {},
      onUnlink: () => {},
    }));
    assert.doesNotMatch(html, /Process again|Try again|Unlink/);
  });
});

describe("PermitChoiceList", () => {
  const row = { id: PERMIT, permit_number: "BCIV2500152", jurisdiction: "Washington DC", address: null, status_raw: "In Review", status: null } as unknown as PermitListRow;

  it("warns when a permit is already linked elsewhere, ignoring the current project", () => {
    const links = new Map([[PERMIT, [{ project_id: PROJECT, project_name: "This one" }, { project_id: "other", project_name: "Other project" }]]]);
    const html = render(createElement(PermitChoiceList, { rows: [row], selectedIds: new Set([PERMIT]), existingLinks: links, excludeProjectId: PROJECT, onToggle: () => {} }));
    assert.match(html, /Already linked to Other project/);
    assert.doesNotMatch(html, /This one/);
    assert.match(html, /Selected/);
  });
});

describe("PortalCommentMarkerBadge", () => {
  it("renders nothing without a marker", () => {
    assert.equal(render(createElement(PortalCommentMarkerBadge, { marker: undefined })), "");
  });

  it("flags removed and changed comments and shows the new portal text", () => {
    const html = render(createElement(PortalCommentMarkerBadge, {
      marker: { removed_at: "2026-11-02T00:00:00Z", changed_at: "2026-11-02T00:00:00Z", latest_text: "Revised: add fire separation detail", permit_id: PERMIT },
    }));
    assert.match(html, /No longer on portal/);
    assert.match(html, /Updated on portal/);
    assert.match(html, /add fire separation detail/);
  });
});

describe("ResponseMatrixPermitStripView", () => {
  it("is hidden with no linked permits and shows permits plus the action otherwise", () => {
    assert.equal(render(createElement(ResponseMatrixPermitStripView, { rows: [], canProcess: true })), "");
    const html = render(createElement(ResponseMatrixPermitStripView, { rows: [overview({ processing_state: "needs_attention" })], canProcess: true, onProcess: () => {} }));
    assert.match(html, /Comments from/);
    assert.match(html, /BCIV2500152/);
    assert.match(html, /Try again/);
  });
});

describe("PermitCommentsCell", () => {
  it("shows a dash when unlinked and the worst state across projects otherwise", () => {
    assert.match(render(createElement(PermitCommentsCell, { rows: undefined })), /—/);
    const html = render(createElement(PermitCommentsCell, {
      rows: [overview(), overview({ project_id: "p2", processing_state: "processing", comments_in_matrix: 2 })],
    }));
    assert.match(html, /Processing/);
    assert.match(html, /6 comments in matrix/);
  });
});
