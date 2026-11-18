import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  CentralProcessingPill,
  LinkedPermitList,
  PermitChoiceList,
  PermitLinkedProjectList,
  PortalCommentMarkerBadge,
  ResponseMatrixPermitStripView,
} from "./PermitPipelineViews";
import { CentralDiagnosticsView, PermitCommentAnalysisSummaryView } from "./PermitCommentAnalysisPanel";
import { PermitCommentsCell } from "./PermitQueueCommentsCell";
import type { PermitListRow } from "@/lib/centralPermits";
import {
  __projectPermitsTestHooks,
  loadPermitCommentProcessing,
  loadPortalCommentMarkers,
  type CentralDiagnosticsRow,
  type LinkedPermit,
  type PermitCommentProcessing,
  type PipelineOverviewRow,
  type ProjectPermitsClient,
} from "@/lib/projectPermits";

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

function analysis(patch: Partial<PermitCommentProcessing> = {}): PermitCommentProcessing {
  return {
    permit_id: PERMIT,
    processing_state: "ready",
    source_comments: 6,
    processed: 6,
    pending: 0,
    failed: 0,
    needs_attention: 0,
    skipped: 0,
    last_completed_at: null,
    ...patch,
  };
}

describe("permit-level analysis (D-121)", () => {
  it("uses the four plain-language states", () => {
    assert.match(render(createElement(CentralProcessingPill, { state: "not_processed" })), /Not yet processed/);
    assert.match(render(createElement(CentralProcessingPill, { state: "processing" })), /Processing/);
    assert.match(render(createElement(CentralProcessingPill, { state: "ready" })), /Ready for project use/);
    assert.match(render(createElement(CentralProcessingPill, { state: "needs_attention" })), /Needs attention/);
  });

  it("the Permit Queue cell shows the analysis state for unlinked permits too", () => {
    const unlinked = render(createElement(PermitCommentsCell, { rows: undefined, central: analysis({ processing_state: "not_processed" }) }));
    assert.match(unlinked, /Not yet processed/);
    assert.doesNotMatch(unlinked, /—/);
    const linked = render(createElement(PermitCommentsCell, { rows: [overview()], central: analysis() }));
    assert.match(linked, /Ready for project use/);
    assert.match(linked, /In Response Matrix/);
    assert.match(render(createElement(PermitCommentsCell, { rows: undefined, central: analysis({ processing_state: "no_comments" }) })), /—/);
  });

  it("the permit summary is plain language; diagnostics stay out of it", () => {
    const html = render(createElement(PermitCommentAnalysisSummaryView, { row: analysis({ processed: 5, skipped: 1, processing_state: "needs_attention", needs_attention: 0 }) }));
    assert.match(html, /5 of 5 comments analysed/);
    assert.match(html, /Preliminary AI analysis, not a verified code review/);
    assert.doesNotMatch(html, /central-v1|gpt-4o|\$|fingerprint/i);
  });

  it("admin diagnostics show the version, reconciliation, failures and cost", () => {
    const row: CentralDiagnosticsRow = {
      permit_id: PERMIT, permit_number: "B1", status: "failed", processing_version: "central-v1|gpt-4o|a|b",
      completed_fingerprint: "old", current_fingerprint: "new", attempts: 2, next_attempt_at: null, last_error: "incomplete: 1 pending",
      last_completed_at: null, source_comments: 6, processed: 4, pending: 1, failed: 0, needs_attention: 1, skipped: 0,
      ai_calls: 3, input_tokens: 1200, output_tokens: 300, cost_usd: 0.006,
    };
    const html = render(createElement(CentralDiagnosticsView, {
      row,
      budgets: [{ scope: "dc-backfill", cap_usd: 5, approved: true, closed: false, used_usd: 0.85, calls: 40, input_tokens: 1, output_tokens: 1 }],
      onRetry: () => {},
    }));
    assert.match(html, /central-v1\|gpt-4o/);
    assert.match(html, /6 = 4 processed \+ 1 pending \+ 0 failed \+ 1 needs attention \+ 0 skipped/);
    assert.match(html, /changed since last completion/);
    assert.match(html, /incomplete: 1 pending/);
    assert.match(html, /\$0\.0060/);
    assert.match(html, /dc-backfill/);
    assert.match(html, /\$0\.8500 of \$5\.0000/);
    assert.match(html, /Analyse comments again/);
  });

  it("the permit picker says when a permit's analysis is ready for project use", () => {
    const row = { id: PERMIT, permit_number: "BCIV2500152", jurisdiction: "Washington DC", address: null, status_raw: "In Review", status: null } as unknown as PermitListRow;
    const html = render(createElement(PermitChoiceList, { rows: [row], selectedIds: new Set<string>(), analysis: new Map([[PERMIT, analysis()]]), onToggle: () => {} }));
    assert.match(html, /Ready for project use/);
  });

  it("Response Matrix marks preliminary AI fields and a newer analysis that was not applied", () => {
    const html = render(createElement(PortalCommentMarkerBadge, {
      marker: { removed_at: null, changed_at: null, latest_text: null, permit_id: PERMIT, preliminary_fields: ["discipline", "response_text"], central_update_at: "2026-11-18T00:00:00Z" },
    }));
    assert.match(html, /Preliminary AI/);
    assert.match(html, /discipline, draft/);
    assert.match(html, /Newer AI analysis/);
    assert.match(html, /Your value was kept/);
  });
});

describe("projectPermits central loaders", () => {
  const fakeClient = (handlers: { rpc?: (fn: string, args?: Record<string, unknown>) => unknown; select?: (cols: string) => { data: unknown; error: unknown } }): ProjectPermitsClient => {
    const builder = (cols: string) => {
      const b = {
        eq: () => b,
        in: () => b,
        not: () => b,
        order: () => b,
        limit: () => b,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(handlers.select!(cols)).then(resolve),
      };
      return b;
    };
    return {
      from: () => ({ select: (cols: string) => builder(cols) as never }),
      rpc: async (fn, args) => handlers.rpc!(fn, args) as never,
    };
  };

  it("loads per-permit states and returns nothing before the migration", async () => {
    __projectPermitsTestHooks.setClient(fakeClient({ rpc: (fn, args) => {
      assert.equal(fn, "get_permit_comment_processing");
      assert.deepEqual(args, { p_permit_ids: [PERMIT] });
      return { data: [{ ...analysis(), processed: "6" }], error: null };
    } }));
    const m = await loadPermitCommentProcessing([PERMIT, PERMIT]);
    assert.equal(m.get(PERMIT)?.processing_state, "ready");
    assert.equal(m.get(PERMIT)?.processed, 6);

    __projectPermitsTestHooks.setClient(fakeClient({ rpc: () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_permit_comment_processing" } }) }));
    assert.equal((await loadPermitCommentProcessing([PERMIT])).size, 0);
    __projectPermitsTestHooks.setClient(null);
  });

  it("portal markers still load when the central columns do not exist yet", async () => {
    const seen: string[] = [];
    __projectPermitsTestHooks.setClient(fakeClient({ select: (cols) => {
      seen.push(cols);
      if (cols.includes("discipline_source")) return { data: null, error: { code: "42703", message: "column parsed_comments.discipline_source does not exist" } };
      return { data: [{ id: "c1", portal_permit_id: PERMIT, portal_removed_at: "2026-11-01T00:00:00Z", portal_changed_at: null, portal_latest_text: null }], error: null };
    } }));
    const m = await loadPortalCommentMarkers(PROJECT);
    assert.equal(seen.length, 2);
    assert.equal(m.get("c1")?.removed_at, "2026-11-01T00:00:00Z");
    assert.deepEqual(m.get("c1")?.preliminary_fields, []);
    __projectPermitsTestHooks.setClient(null);
  });
});
