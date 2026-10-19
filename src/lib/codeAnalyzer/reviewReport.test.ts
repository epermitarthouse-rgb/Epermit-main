import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReviewReportView, reviewOutcome, reviewOutcomeLabel, reviewStateLabel } from "./reviewReport.ts";

describe("review outcome", () => {
  it("never presents a stored Clear without an authoritative requirement as verified", () => {
    assert.equal(reviewOutcome({ reviewState: "reviewed_clear", totalIssues: 0 }), "insufficient_evidence");
    assert.equal(reviewOutcomeLabel({ reviewState: "reviewed_clear", totalIssues: 0 }), "No findings · Verification incomplete");
    assert.equal(
      reviewOutcome({ reviewState: "reviewed_clear", totalIssues: 0, codeCoverageVerified: true, overallScore: 100 }),
      "verified_compliant",
    );
    assert.equal(reviewOutcomeLabel({ reviewState: "reviewed_partial", totalIssues: 0 }), "No findings · Verification incomplete");
    assert.equal(reviewOutcome({ reviewState: "reviewed_partial", totalIssues: 2 }), "potential_issue");
    assert.equal(reviewOutcome({ reviewState: "not_reviewed" }), "not_reviewed");
    assert.equal(reviewOutcome({ reviewState: "reviewed_clear", notApplicable: true }), "not_applicable");
    assert.equal(reviewOutcomeLabel({ reviewState: "failed" }), "Failed");
    for (const state of ["reviewed_clear", "reviewed_partial", "reviewed_findings", "not_reviewed"]) {
      assert.doesNotMatch(reviewOutcomeLabel({ reviewState: state, overallScore: null, totalIssues: 0 }), /0%|100%/);
    }
  });

  it("derives limitation reasons for saved rows that predate stored reasons", () => {
    const view = buildReviewReportView(
      [{
        summary: { reviewState: "reviewed_clear", overallScore: null, checklist: ["Door 101: labeled HW-3"], cleanChecks: ["Door 101: labeled HW-3"] },
        legalApplicability: { status: "conflict", reviewScope: "reference_only", selectedEdition: "IBC 2021" },
        codeCoverage: { status: "applicability_only", enforceableProvisionCount: 0 },
        rejectedCandidates: [
          { title: "Equipment grounding", validationReason: "documented_design_provision", validationDetail: "The sheet's own note states this requirement." },
          { title: "Exit path", validationReason: "egress_outside_discipline", validationDetail: "Not on an electrical sheet." },
        ],
      }],
      [],
    );
    const codes = view.limitations.map((item) => item.code);
    assert.ok(codes.includes("reference_only_scope"));
    assert.ok(codes.includes("no_authoritative_requirement"));
    assert.ok(codes.includes("open_check"));
    assert.equal(view.limitations.filter((item) => item.code === "open_check").length, 1);
    assert.ok(view.unreviewable.some((line) => /not proof of compliance/.test(line)));
  });
});

describe("review report hydration", () => {
  it("shows explicit General IBC separately from detected DC and keeps historical states", () => {
    assert.equal(reviewStateLabel("passed", 100), "100%");
    assert.equal(reviewStateLabel("not_reviewed", null), "Not reviewed");
    assert.equal(reviewStateLabel("reviewed_partial", null), "Partial");
    assert.equal(reviewStateLabel("failed", null), "Failed");
    assert.equal(reviewStateLabel("reviewed_clear", null), "Clear");
    assert.notEqual(reviewStateLabel("reviewed_clear", null), "0%");
    assert.equal(reviewStateLabel("reviewed_findings", null), "Findings");
    assert.equal(reviewStateLabel("reviewed_findings", 82), "82%");

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
