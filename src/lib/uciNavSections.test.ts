import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UCI_HUB_TILE_SECTIONS,
  UCI_NAV_SECTIONS,
  UCI_PRIMARY_NAV_SECTIONS,
  getUciNavSection,
  uciSectionHref,
  uciSidebarBadgeLabel,
} from "./uciNavSections.ts";

describe("UCI Lovable-shaped primary nav", () => {
  it("exposes approved cross-project operations and foundations (no stages)", () => {
    const ids = UCI_PRIMARY_NAV_SECTIONS.map((s) => s.id);
    assert.deepEqual(ids, [
      "submissions",
      "communications",
      "needs-attention",
      "portfolio",
      "portal-harvest",
      "provider-directory",
      "class-of-service",
      "ciac",
      "energization",
      "miss-utility",
      "knowledge-graph",
      "provider-map",
      "conflicts",
    ]);
    assert.equal(
      UCI_PRIMARY_NAV_SECTIONS.some((s) => s.id === "overview"),
      false,
    );
  });

  it("uses domain-correct labels for primary children", () => {
    const labels = UCI_PRIMARY_NAV_SECTIONS.map((s) => s.label);
    assert.ok(labels.includes("Submissions"));
    assert.ok(labels.includes("Inbox"));
    assert.ok(labels.includes("Portal Harvest"));
    assert.ok(labels.includes("Class of Service"));
    assert.ok(labels.includes("CIAC & Refunds"));
    assert.ok(labels.includes("Utility Territory Map"));
    assert.ok(!labels.includes("UCI Builder"));
  });

  it("distinguishes active, foundation, and manual destinations", () => {
    assert.equal(uciSidebarBadgeLabel("active"), "Active");
    assert.equal(uciSidebarBadgeLabel("foundation"), "Foundation");
    assert.equal(uciSidebarBadgeLabel("manual"), "Manual");
    assert.equal(uciSidebarBadgeLabel("contextual"), null);
  });

  it("routes Submissions and Inbox to cross-project foundations", () => {
    const submissions = getUciNavSection("submissions");
    const inbox = getUciNavSection("communications");
    assert.equal(submissions?.target.kind === "external" ? submissions.target.href : null, "/uci/submissions");
    assert.equal(inbox?.target.kind === "external" ? inbox.target.href : null, "/uci/inbox");
    assert.equal(uciSectionHref("submissions"), "/uci?section=submissions");
    assert.equal(uciSectionHref("communications"), "/uci?section=communications");
  });

  it("folds UCI Builder into the record application-package workspace", () => {
    const builder = getUciNavSection("application-builder");
    assert.equal(builder?.target.kind, "drawer-tab");
    assert.equal(
      builder?.target.kind === "drawer-tab" ? builder.target.tab : null,
      "application-prep",
    );
  });

  it("keeps only contextual record tools as hub tiles", () => {
    const hubIds = UCI_HUB_TILE_SECTIONS.map((s) => s.id).sort();
    assert.deepEqual(hubIds, [
      "load-profile",
      "meter-set",
    ]);
    for (const id of hubIds) {
      assert.equal(UCI_PRIMARY_NAV_SECTIONS.some((s) => s.id === id), false);
    }
  });
});
