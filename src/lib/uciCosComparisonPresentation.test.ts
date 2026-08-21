import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCosApprovalAction,
  deriveCosComparisonRowAction,
  formatCosComparisonCellValue,
  isBlockingCosComparisonRow,
  isRequiredForCosAcceptance,
} from "./uciCosComparisonPresentation.js";

describe("formatCosComparisonCellValue", () => {
  it("renders nullish and empty as em dash", () => {
    assert.equal(formatCosComparisonCellValue(null), "—");
    assert.equal(formatCosComparisonCellValue(undefined), "—");
    assert.equal(formatCosComparisonCellValue(""), "—");
  });

  it("renders plain scalars", () => {
    assert.equal(formatCosComparisonCellValue(800), "800");
    assert.equal(formatCosComparisonCellValue("208Y/120V"), "208Y/120V");
  });

  it("renders value + unit objects (demand / design basis)", () => {
    assert.equal(formatCosComparisonCellValue({ value: 180, unit: "kW" }), "180 kW");
    assert.equal(formatCosComparisonCellValue({ value: 800, unit: "A" }), "800 A");
  });

  it("renders value-only objects without inventing a unit", () => {
    assert.equal(formatCosComparisonCellValue({ value: 180 }), "180");
  });

  it("unwraps nested value objects from calculated load-profile baselines", () => {
    assert.equal(
      formatCosComparisonCellValue({ value: { value: 180, unit: "kW" } }),
      "180 kW",
    );
  });

  it("never stringifies to [object Object]", () => {
    const samples = [
      { value: 180, unit: "kW" },
      { value: { value: 144.5, unit: "kW" }, unit: null },
      800,
    ];
    for (const sample of samples) {
      const rendered = formatCosComparisonCellValue(sample);
      assert.notEqual(rendered, "[object Object]");
    }
  });
});

describe("Stage 6 partial COS comparison predicates", () => {
  it("treats demand basis and meter qty as optional for acceptance", () => {
    assert.equal(isRequiredForCosAcceptance("demand_load_kw"), false);
    assert.equal(isRequiredForCosAcceptance("meter_count"), false);
    assert.equal(isRequiredForCosAcceptance("service_amperage"), true);
  });

  it("does not block on utility_not_provided optional rows", () => {
    assert.equal(
      isBlockingCosComparisonRow({
        field: "demand_load_kw",
        result: "utility_not_provided",
        submitted: 180,
        utility_issued: null,
      }),
      false,
    );
    assert.equal(
      isBlockingCosComparisonRow({
        field: "service_amperage",
        result: "utility_value_missing",
        submitted: 1000,
        utility_issued: null,
      }),
      true,
    );
  });
});

describe("deriveCosApprovalAction", () => {
  it("shows actionable approve when evidence exists and review is open", () => {
    const action = deriveCosApprovalAction({
      reviewStatus: "pending",
      evidenceStatus: "MATCH",
      autoCompleted: false,
      hasMaterial: true,
      busy: false,
      hasEvidence: true,
    });
    assert.equal(action.status, "actionable");
    assert.equal(action.label, "Approve COS");
    assert.equal(action.disabled, false);
  });

  it("shows approved badge after persisted approval", () => {
    const action = deriveCosApprovalAction({
      reviewStatus: "approved",
      evidenceStatus: "MATCH",
      autoCompleted: false,
      hasMaterial: false,
      busy: false,
      hasEvidence: true,
    });
    assert.equal(action.status, "approved");
    assert.match(action.label, /COS matched/);
  });

  it("disables approve for advisory evidence and hides when no evidence", () => {
    const advisory = deriveCosApprovalAction({
      reviewStatus: "pending",
      evidenceStatus: "ADVISORY",
      autoCompleted: false,
      hasMaterial: false,
      busy: false,
      hasEvidence: true,
    });
    assert.equal(advisory.status, "actionable");
    if (advisory.status === "actionable") {
      assert.equal(advisory.disabled, true);
    }

    const hidden = deriveCosApprovalAction({
      reviewStatus: "pending",
      evidenceStatus: "MATCH",
      autoCompleted: false,
      hasMaterial: false,
      busy: false,
      hasEvidence: false,
    });
    assert.equal(hidden.status, "hidden");
  });
});

describe("deriveCosComparisonRowAction", () => {
  it("locks row edits after approval", () => {
    const open = deriveCosComparisonRowAction({
      row: { field: "service_amperage", operator_override: true },
      reviewStatus: "pending",
      evidenceStatus: "DISCREPANCY",
      busy: false,
      hasUpdateHandlers: true,
    });
    assert.equal(open.showEdit, true);
    assert.equal(open.showResetToUtility, true);

    const closed = deriveCosComparisonRowAction({
      row: { field: "service_amperage" },
      reviewStatus: "approved",
      evidenceStatus: "MATCH",
      busy: false,
      hasUpdateHandlers: true,
    });
    assert.equal(closed.readOnly, true);
    assert.equal(closed.showEdit, false);
  });
});
