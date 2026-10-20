import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReviewReportView } from "@/lib/codeAnalyzer/reviewReport";
import { ReviewEvidenceReport } from "./ReviewEvidenceReport";

const view = buildReviewReportView(
  [
    {
      sheet_file_name: "A-1.00.pdf",
      userEmphasis: "Check the servery.",
      disciplines: ["architectural"],
      jurisdictionScope: {
        selectedScope: "general-ibc",
        detectedLocation: "dc",
        amendmentsEnforced: false,
      },
      jurisdictionDiagnostics: {
        message: "Detected location is Washington, DC. Selected code scope is General IBC.",
      },
      summary: { reviewState: "reviewed_partial", overallScore: null, cleanChecks: ["Exit width"] },
      observations: [{ quote: "1 HR", fileName: "A-1.00.pdf", region: { x: 1 } }],
      rejectedCandidates: [{ validationDetail: "Not on the equipment plan." }],
    },
  ],
  [
    { title: "Door width", findingType: "confirmed_violation" },
    { title: "Check the note", findingType: "missing_information" },
  ],
);

describe("ReviewEvidenceReport", () => {
  it("keeps the strip collapsed until the user expands it", () => {
    const collapsed = renderToStaticMarkup(
      createElement(ReviewEvidenceReport, {
        view,
        sourceFileName: "A-1.00.pdf",
        reviewState: "reviewed_partial",
        overallScore: null,
      }),
    );
    assert.match(collapsed, /aria-expanded="false"/);
    assert.match(collapsed, /A-1\.00\.pdf/);
    assert.match(collapsed, /general-ibc/);
    assert.match(collapsed, /Potential issue/);
    assert.match(collapsed, /1 evidence/);
    assert.doesNotMatch(collapsed, /Confirmed findings/);
    assert.doesNotMatch(collapsed, /User emphasis/);

    const expanded = renderToStaticMarkup(
      createElement(ReviewEvidenceReport, {
        view,
        sourceFileName: "A-1.00.pdf",
        reviewState: "reviewed_partial",
        overallScore: null,
        expanded: true,
      }),
    );
    assert.match(expanded, /aria-expanded="true"/);
    assert.match(expanded, /Selected code scope/);
    assert.match(expanded, /Detected location/);
    assert.match(expanded, /Documents reviewed: A-1\.00\.pdf/);
    assert.match(expanded, /Disciplines: architectural/);
    assert.match(expanded, /Confirmed findings/);
    assert.match(expanded, /Door width/);
    assert.match(expanded, /Verification questions/);
    assert.match(expanded, /Check the note/);
    assert.match(expanded, /Evidence-backed checks/);
    assert.match(expanded, /Exit width/);
    assert.match(expanded, /Why code compliance is unverified/);
    assert.match(expanded, /reference-only/);
    assert.match(expanded, /1 HR/);
    assert.match(expanded, /location on sheet/);
    assert.match(expanded, /User emphasis/);
    assert.match(expanded, /Check the servery/);
    assert.match(expanded, /Withheld, not shown as violations/);
    assert.match(expanded, /equipment plan/);
    assert.match(expanded, /Washington, DC/);
  });

  it("explains a zero-finding Partial with the stored limitation reasons", () => {
    const partial = buildReviewReportView(
      [
        {
          sheet_file_name: "A-1.02-00.pdf",
          summary: { reviewState: "reviewed_partial", overallScore: null, checklist: [], cleanChecks: [] },
          legalApplicability: { status: "conflict", reviewScope: "reference_only", selectedEdition: "IBC 2021", adoptedEdition: "2017 DC Construction Codes" },
          codeCoverage: { status: "applicability_only", authoritativeProvisionCount: 2, enforceableProvisionCount: 0 },
        },
      ],
      [],
    );
    const html = renderToStaticMarkup(
      createElement(ReviewEvidenceReport, {
        view: partial,
        sourceFileName: "A-1.02-00.pdf",
        reviewState: "reviewed_partial",
        overallScore: null,
        totalIssues: 0,
        expanded: true,
      }),
    );
    assert.match(html, /No findings identified · Code compliance unverified/);
    assert.match(html, /IBC 2021 is not verified as the adopted permit code/);
    assert.match(html, /No authoritative code requirement/);
    assert.match(html, /returned no completed checks/);
    assert.doesNotMatch(html, /0%|100%/);
  });

  it("lists the specific unresolved checks when verification is incomplete", () => {
    const partial = buildReviewReportView(
      [
        {
          sheet_file_name: "E-1.1.pdf",
          summary: { reviewState: "reviewed_partial", overallScore: null, checklist: ["Panel: 200A"], cleanChecks: ["Panel: 200A"] },
          legalApplicability: { status: "conflict", reviewScope: "reference_only", selectedEdition: "IBC 2021" },
          rejectedCandidates: [
            { title: "Equipment grounding", validationReason: "documented_design_provision", validationDetail: "The sheet note states the requirement." },
          ],
        },
      ],
      [],
    );
    const html = renderToStaticMarkup(
      createElement(ReviewEvidenceReport, {
        view: partial,
        reviewState: "reviewed_partial",
        overallScore: null,
        totalIssues: 0,
        expanded: true,
      }),
    );
    assert.match(html, /Verification incomplete/);
    assert.match(html, /Unresolved checks/);
    assert.match(html, /Unresolved checks \(1\)/);
    assert.match(html, /Equipment grounding.*Missing evidence: The sheet note states the requirement\./s);
    assert.match(html, /Sheets: E-1\.1\.pdf\./);
  });
});
