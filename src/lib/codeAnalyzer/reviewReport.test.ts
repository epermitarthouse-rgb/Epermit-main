import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReviewReportView, reviewStateLabel } from "./reviewReport.ts";

describe("review report hydration", () => {
  it("shows explicit General IBC separately from detected DC and keeps historical states", () => {
    assert.equal(reviewStateLabel("passed", 100), "100%");
    assert.equal(reviewStateLabel("not_reviewed", null), "Not reviewed");
    assert.equal(reviewStateLabel("reviewed_partial", null), "Partial");
    assert.equal(reviewStateLabel("failed", null), "Failed");

    const view = buildReviewReportView(
      [
        {
          sheet_file_name: "A-1.00-00.pdf",
          userEmphasis: "Check the servery.",
          disciplines: ["architectural", "fire_protection"],
          jurisdictionScope: {
            selectedScope: "general-ibc",
            detectedLocation: "dc",
            amendmentsEnforced: false,
            selectionSource: "explicit",
          },
          jurisdictionDiagnostics: {
            message: "Detected location is Washington, DC. Selected code scope is General IBC. DC amendments are not enforced.",
          },
          summary: { reviewState: "reviewed_partial", overallScore: null, cleanChecks: [] },
          observations: [{ quote: "1 HR", fileName: "A-6.01.00.pdf", region: { x: 1 } }],
          rejectedCandidates: [{ validationReason: "corridor_width_not_on_equipment_plan", validationDetail: "Not on the equipment plan." }],
        },
      ],
      [
        { title: "Door width", findingType: "confirmed_violation" },
        { title: "Check the note", findingType: "missing_information", validationDisposition: "downgrade" },
      ],
    );

    assert.equal(view.selectedScope, "general-ibc");
    assert.equal(view.detectedLocation, "dc");
    assert.equal(view.amendmentsEnforced, false);
    assert.equal(view.userEmphasis, "Check the servery.");
    assert.deepEqual(view.documentsReviewed, ["A-1.00-00.pdf"]);
    assert.equal(view.confirmedFindings.length, 1);
    assert.equal(view.verificationQuestions.length, 1);
    assert.equal(view.evidence[0].hasRegion, true);
    assert.match(view.withheldReasons[0], /equipment plan/i);
    assert.match(view.disclosure || "", /not enforced/i);
  });
});
