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
    assert.match(collapsed, /Partial/);
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
    assert.match(expanded, /Not fully reviewable/);
    assert.match(expanded, /1 HR/);
    assert.match(expanded, /location on sheet/);
    assert.match(expanded, /User emphasis/);
    assert.match(expanded, /Check the servery/);
    assert.match(expanded, /Withheld, not shown as violations/);
    assert.match(expanded, /equipment plan/);
    assert.match(expanded, /Washington, DC/);
  });
});
