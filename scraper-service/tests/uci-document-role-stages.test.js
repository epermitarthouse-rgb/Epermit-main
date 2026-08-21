"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDocumentTypeToRole,
  resolveStageConsumersForRole,
  resolveProviderSlotKeysForRole,
  matchProviderSlotsForRole,
  resolveClassificationReview,
} = require("../app/services/uci/uci-document-role-stages.js");

describe("uci-document-role-stages", () => {
  it("normalizes document types to registry roles", () => {
    assert.equal(normalizeDocumentTypeToRole("one_line_diagram"), "single_line_diagram");
    assert.equal(normalizeDocumentTypeToRole("cut_sheet"), "equipment_cut_sheet");
    assert.equal(normalizeDocumentTypeToRole("load_profile"), "load_letter");
    assert.equal(normalizeDocumentTypeToRole("load_calculation_worksheet"), "load_calculation_worksheet");
  });

  it("resolves stage consumers authoritatively from role", () => {
    assert.deepEqual(resolveStageConsumersForRole("load_letter"), [2]);
    assert.deepEqual(resolveStageConsumersForRole("letter_of_authorization"), [3, 4]);
    assert.deepEqual(resolveStageConsumersForRole("class_of_service"), [6]);
    assert.deepEqual(resolveStageConsumersForRole("closeout"), [9, 10]);
  });

  it("maps roles to provider slot key aliases", () => {
    const keys = resolveProviderSlotKeysForRole("single_line_diagram");
    assert.ok(keys.includes("single_line_diagram"));
    assert.ok(keys.includes("one_line"));
  });

  it("matches provider template slots from registry role", () => {
    const required = [
      {
        key: "single_line_diagram",
        aliases: ["single_line", "one_line_diagram"],
      },
      { key: "site_plan", aliases: ["site_plan"] },
    ];
    const matched = matchProviderSlotsForRole("single_line_diagram", required);
    assert.deepEqual(matched, ["single_line_diagram"]);
  });

  it("derives classification review tiers from confidence", () => {
    assert.equal(resolveClassificationReview("high", "site_plan"), "auto_accepted");
    assert.equal(resolveClassificationReview("medium", "site_plan"), "review_recommended");
    assert.equal(resolveClassificationReview("high", "other"), "needs_classification");
    assert.equal(resolveClassificationReview("low", "equipment_schedule"), "needs_classification");
  });
});
