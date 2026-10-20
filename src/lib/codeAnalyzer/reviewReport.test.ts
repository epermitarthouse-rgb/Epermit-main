import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReviewReportView,
  mergeReviewReportViews,
  reviewAssessment,
  reviewOutcome,
  reviewOutcomeLabel,
  reviewStateLabel,
} from "./reviewReport.ts";

const UNVERIFIED = "No findings identified · Code compliance unverified";
const openCheck = { code: "open_check", detail: "Equipment grounding: restated note. Withholding it is not proof of compliance." };
const referenceOnly = { code: "reference_only_scope", detail: "Reference-only scope." };

describe("review outcome", () => {
  it("never presents a stored Clear without an authoritative requirement as verified", () => {
    assert.equal(reviewOutcome({ reviewState: "reviewed_clear", totalIssues: 0 }), "no_findings_unverified");
    assert.equal(reviewOutcomeLabel({ reviewState: "reviewed_clear", totalIssues: 0 }), UNVERIFIED);
    assert.equal(reviewOutcomeLabel({ reviewState: "passed", overallScore: 100, totalIssues: 0 }), UNVERIFIED);
    assert.equal(
      reviewOutcome({ reviewState: "reviewed_clear", totalIssues: 0, codeCoverageVerified: true, overallScore: 100 }),
      "verified_compliant",
    );
    assert.equal(reviewOutcomeLabel({ reviewState: "reviewed_partial", totalIssues: 0 }), UNVERIFIED);
    assert.equal(reviewOutcome({ reviewState: "reviewed_partial", totalIssues: 2 }), "potential_issue");
    assert.equal(reviewOutcomeLabel({ reviewState: "reviewed_findings", overallScore: 82, totalIssues: 2 }), "Potential issue");
    assert.equal(reviewOutcome({ reviewState: "not_reviewed" }), "not_reviewed");
    assert.equal(reviewOutcome({ reviewState: "reviewed_clear", notApplicable: true }), "not_applicable");
    assert.equal(reviewOutcomeLabel({ reviewState: "failed" }), "Failed");
    for (const state of ["reviewed_clear", "reviewed_partial", "reviewed_findings", "not_reviewed"]) {
      assert.doesNotMatch(reviewOutcomeLabel({ reviewState: state, overallScore: null, totalIssues: 0 }), /0%|100%/);
    }
  });

  it("reference-only scope alone leaves compliance unverified; only a named open check is incomplete", () => {
    assert.equal(reviewOutcomeLabel({ reviewState: "reviewed_clear", totalIssues: 0, limitations: [referenceOnly] }), UNVERIFIED);
    assert.equal(
      reviewOutcomeLabel({ reviewState: "reviewed_partial", totalIssues: 0, limitations: [referenceOnly, openCheck] }),
      "Verification incomplete",
    );
    assert.equal(
      reviewOutcomeLabel({ reviewState: "reviewed_clear", totalIssues: 0, codeCoverageVerified: true, limitations: [openCheck] }),
      "Verification incomplete",
    );
    assert.equal(reviewOutcomeLabel({ reviewState: "reviewed_partial", totalIssues: 1, limitations: [openCheck] }), "Potential issue");
  });

  it("keeps the four review dimensions separate", () => {
    assert.deepEqual(reviewAssessment({ reviewState: "reviewed_clear", totalIssues: 0, limitations: [referenceOnly] }), {
      drawingEvidence: "evidence_backed",
      technicalRequirements: "no_concerns_identified",
      codeVerification: "unverified",
      applicability: "reference_only",
    });
    assert.deepEqual(reviewAssessment({ reviewState: "reviewed_clear", totalIssues: 0, codeCoverageVerified: true, limitations: [] }), {
      drawingEvidence: "evidence_backed",
      technicalRequirements: "no_concerns_identified",
      codeVerification: "verified",
      applicability: "permit_compliance",
    });
    assert.equal(reviewAssessment({ reviewState: "reviewed_partial", limitations: [openCheck] }).technicalRequirements, "checks_unresolved");
    assert.equal(reviewAssessment({ reviewState: "not_reviewed" }).drawingEvidence, "not_assessed");
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
    assert.equal(view.unresolvedChecks.length, 1);
    assert.match(view.unresolvedChecks[0], /Equipment grounding.*not proof of compliance/);
    assert.ok(!view.unreviewable.some((line) => /not proof of compliance/.test(line)));
    assert.ok(view.unreviewable.some((line) => /reference-only/.test(line)));
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

describe("candidate dispositions", () => {
  const candidate = (title: string, outcome: string | null, extra: Record<string, unknown> = {}) => ({
    title,
    validationReason: "requirement_already_on_sheet",
    validationDetail: `${title} detail.`,
    evaluation: outcome ? { verification: { outcome, openReason: outcome === "open_check" ? "fact_not_found" : null }, related: [] } : null,
    ...extra,
  });

  it("lists every open check, not the first five", () => {
    const rejectedCandidates = Array.from({ length: 9 }, (_, index) => candidate(`Check ${index}`, "open_check"));
    const view = buildReviewReportView([{ summary: { reviewState: "reviewed_partial" }, rejectedCandidates }], []);
    assert.equal(view.openChecks.length, 9);
    assert.equal(view.openChecks[0].openReason, "fact_not_found");
    assert.equal(view.dispositions.open_check, 9);
  });

  it("uses the recorded outcome over the stored reason, and names the resolving sheet", () => {
    const view = buildReviewReportView([{
      summary: { reviewState: "reviewed_partial" },
      rejectedCandidates: [
        candidate("Fire rating", "resolved_by_evidence", {
          evaluation: {
            verification: { outcome: "resolved_by_evidence", detail: 'A-1.00-00.pdf states the rating: "1H ONE HOUR FIRE RATED WALLS".' },
            related: [{ sheet: "A-1.00-00.pdf", quote: "1H ONE HOUR FIRE RATED WALLS" }],
          },
        }),
        candidate("Energy code edition", "correctly_rejected"),
        candidate("Legacy restatement", null),
      ],
    }], []);
    assert.deepEqual(view.openChecks.map((item) => item.check), ["Legacy restatement"]);
    assert.equal(view.resolvedChecks.length, 1);
    assert.deepEqual(view.resolvedChecks[0].relatedSheets, ["A-1.00-00.pdf"]);
    assert.deepEqual(view.dispositions, { published: 0, open_check: 1, resolved_by_evidence: 1, correctly_rejected: 1, not_applicable: 0 });
  });

  it("IBC and Local views add their dispositions and keep every open check", () => {
    const ibc = buildReviewReportView([{ summary: { reviewState: "reviewed_partial" }, rejectedCandidates: [candidate("A", "open_check"), candidate("B", "resolved_by_evidence")] }], []);
    const local = buildReviewReportView([{ summary: { reviewState: "reviewed_partial" }, rejectedCandidates: [candidate("C", "open_check")] }], []);
    const merged = mergeReviewReportViews([ibc, local]);
    assert.equal(merged?.openChecks.length, 2);
    assert.equal(merged?.dispositions.resolved_by_evidence, 1);
    assert.equal(merged?.dispositions.open_check, 2);
  });
});
