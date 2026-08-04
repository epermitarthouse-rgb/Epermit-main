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
  it("exposes Lovable UCI children under Utility Coordination (no Hub/Overview)", () => {
    const ids = UCI_PRIMARY_NAV_SECTIONS.map((s) => s.id);
    assert.deepEqual(ids, [
      "submissions",
      "communications",
      "class-of-service",
      "ciac",
      "energization",
      "miss-utility",
      "knowledge-graph",
      "application-builder",
    ]);
    assert.equal(
      UCI_PRIMARY_NAV_SECTIONS.some((s) => s.id === "overview"),
      false,
    );
  });

  it("uses Lovable labels for primary children", () => {
    const labels = UCI_PRIMARY_NAV_SECTIONS.map((s) => s.label);
    assert.ok(labels.includes("UCI · Submissions"));
    assert.ok(labels.includes("UCI · Inbox"));
    assert.ok(labels.includes("UCI · Class of Service"));
    assert.ok(labels.includes("UCI · CIAC & Refunds"));
    assert.ok(labels.includes("UCI · Energization"));
    assert.ok(labels.includes("UCI · Miss Utility 811"));
    assert.ok(labels.includes("UCI · Knowledge Graph"));
    assert.ok(labels.includes("UCI Builder"));
  });

  it("never surfaces Partial as a sidebar badge", () => {
    for (const section of UCI_NAV_SECTIONS) {
      assert.equal(uciSidebarBadgeLabel(section.support), "Soon");
      assert.notEqual(section.support, "partial");
    }
  });

  it("keeps Submissions / Inbox deep-links as preferred drawer tabs", () => {
    const submissions = getUciNavSection("submissions");
    const inbox = getUciNavSection("communications");
    assert.equal(submissions?.target.kind, "drawer-tab");
    assert.equal(
      submissions?.target.kind === "drawer-tab" ? submissions.target.tab : null,
      "application-prep",
    );
    assert.equal(inbox?.target.kind, "drawer-tab");
    assert.equal(
      inbox?.target.kind === "drawer-tab" ? inbox.target.tab : null,
      "communications",
    );
    assert.equal(uciSectionHref("submissions"), "/uci?section=submissions");
    assert.equal(uciSectionHref("communications"), "/uci?section=communications");
  });

  it("points UCI Builder at the dedicated route", () => {
    const builder = getUciNavSection("application-builder");
    assert.equal(builder?.target.kind, "external");
    assert.equal(
      builder?.target.kind === "external" ? builder.target.href : null,
      "/uci/application-builder",
    );
  });

  it("demotes Load Profile / Meter Set / Conflict / Easement / Portfolio / Provider Map to hub tiles", () => {
    const hubIds = UCI_HUB_TILE_SECTIONS.map((s) => s.id).sort();
    assert.deepEqual(hubIds, [
      "conflict-hunter",
      "easement",
      "load-profile",
      "meter-set",
      "portfolio",
      "provider-map",
    ]);
    for (const id of hubIds) {
      assert.equal(UCI_PRIMARY_NAV_SECTIONS.some((s) => s.id === id), false);
    }
  });
});
