import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applicantPagesFrom,
  classifyPageRole,
  heuristicExtractModificationRequest,
  mergeExtractedRequests,
  normalizeProposedMeasures,
  pagesAreSparse,
  reconcileExtractionWarnings,
  splitMeasureDescription,
  stripReviewerSections,
  HEURISTIC_FIELD_WARNINGS,
} from "./extractForm.ts";
import { emptyExtractedRequest } from "./model.ts";
import { SAMPLE_DC_CODE_MODIFICATION_PAGES } from "./sampleForm.ts";

describe("classifyPageRole / stripReviewerSections", () => {
  it("treats applicant request and proposed measures as applicant pages", () => {
    assert.equal(classifyPageRole(SAMPLE_DC_CODE_MODIFICATION_PAGES[0]), "applicant");
    assert.equal(classifyPageRole(SAMPLE_DC_CODE_MODIFICATION_PAGES[1]), "applicant");
  });

  it("classifies the official-use page as reviewer", () => {
    assert.equal(classifyPageRole(SAMPLE_DC_CODE_MODIFICATION_PAGES[2]), "reviewer");
  });

  it("strips official-use blocks from mixed pages", () => {
    const mixed = `${SAMPLE_DC_CODE_MODIFICATION_PAGES[0].text}\nFOR OFFICIAL USE ONLY\nDOB Reviewer Name: ________________`;
    const stripped = stripReviewerSections(mixed);
    assert.match(stripped, /IBC 1021\.2/);
    assert.doesNotMatch(stripped, /FOR OFFICIAL USE ONLY/i);
    assert.doesNotMatch(stripped, /DOB Reviewer Name/);
  });
});

describe("applicantPagesFrom", () => {
  it("drops the blank reviewer page", () => {
    const applicant = applicantPagesFrom(SAMPLE_DC_CODE_MODIFICATION_PAGES);
    assert.equal(applicant.length, 2);
    assert.deepEqual(applicant.map((p) => p.pageNumber), [1, 2]);
  });
});

describe("heuristicExtractModificationRequest", () => {
  it("extracts the sample IBC / 12A DCMR egress request and proposed measures", () => {
    const extracted = heuristicExtractModificationRequest(SAMPLE_DC_CODE_MODIFICATION_PAGES);
    assert.match(extracted.requestedModification, /IBC 1021\.2/i);
    assert.match(extracted.requestedModification, /egress|number of exits/i);
    assert.equal(
      extracted.citedSections.some((s) => s.citation.includes("IBC 1021.2") && s.year === "2021"),
      true,
    );
    assert.equal(
      extracted.citedSections.some((s) => s.citation.includes("12A DCMR 1021.2")),
      true,
    );
    assert.equal(extracted.citedSections.every((s) => s.label === "Applicant-cited code"), true);
    assert.match(extracted.impracticalReason ?? "", /historic stair/i);
    assert.equal(extracted.compliesWithIntent, true);
    assert.equal(extracted.floodHazardApplicable, false);

    const joined = extracted.proposedMeasures.map((m) => m.description).join(" | ");
    assert.match(joined, /NFPA 13/i);
    assert.match(joined, /2-hour fire-rated stair/i);
    assert.match(joined, /fire alarm/i);
    assert.match(joined, /occupant load signage/i);
    assert.match(joined, /egress lighting/i);
  });

  it("does not treat blank reviewer fields as applicant answers", () => {
    const extracted = heuristicExtractModificationRequest(SAMPLE_DC_CODE_MODIFICATION_PAGES);
    const blob = JSON.stringify(extracted);
    assert.doesNotMatch(blob, /DOB Reviewer Name/);
    assert.doesNotMatch(blob, /Conditions of Approval/);
    assert.equal(extracted.requestedModification.includes("________________"), false);
  });

  it("extracts numbered measures from PDF-flattened single-line page text", () => {
    const pdfFlattenedPage2 = {
      pageNumber: 2,
      text:
        "PROPOSED ALTERNATIVE / COMPENSATING MEASURES: 1. Automatic sprinkler system designed and installed in accordance with NFPA 13 2. 2-hour fire-rated stair enclosure 3. Fire alarm system throughout the building 4. Occupant load signage at assembly spaces 5. Egress lighting and exit signage Flood Hazard Applicable: No",
    };
    const extracted = heuristicExtractModificationRequest([
      SAMPLE_DC_CODE_MODIFICATION_PAGES[0],
      pdfFlattenedPage2,
      SAMPLE_DC_CODE_MODIFICATION_PAGES[2],
    ]);
    assert.equal(extracted.proposedMeasures.length, 5);
    const joined = extracted.proposedMeasures.map((m) => m.description).join(" | ");
    assert.match(joined, /NFPA 13/i);
    assert.match(joined, /2-hour fire-rated stair/i);
    assert.match(joined, /fire alarm/i);
    assert.equal(extracted.floodHazardApplicable, false);
    assert.equal(
      extracted.extractionWarnings.some((w) => /No proposed alternative measures/i.test(w)),
      false,
    );
  });

  it("extracts numbered measures when pdf.js splits list markers", () => {
    const splitMarkersPage2 = {
      pageNumber: 2,
      text:
        "PROPOSED ALTERNATIVE / COMPENSATING MEASURES: 1 . Automatic sprinkler system designed and installed in accordance with NFPA 13 2 . 2-hour fire-rated stair enclosure 3 . Fire alarm system throughout the building 4 . Occupant load signage at assembly spaces 5 . Egress lighting and exit signage Flood Hazard Applicable: No",
    };
    const extracted = heuristicExtractModificationRequest([
      SAMPLE_DC_CODE_MODIFICATION_PAGES[0],
      splitMarkersPage2,
      SAMPLE_DC_CODE_MODIFICATION_PAGES[2],
    ]);
    assert.equal(extracted.proposedMeasures.length, 5);
  });
});

describe("mergeExtractedRequests / pagesAreSparse", () => {
  it("merges citations and measures without duplicating", () => {
    const a = heuristicExtractModificationRequest(SAMPLE_DC_CODE_MODIFICATION_PAGES);
    const b = emptyExtractedRequest();
    b.proposedMeasures = [{ id: "measure-99", description: "Standpipe at stair" }];
    b.citedSections = [
      { citation: "IBC 1021.2 (2021)", year: "2021", source: "applicant", label: "Applicant-cited code" },
    ];
    const merged = mergeExtractedRequests(a, b);
    assert.equal(merged.proposedMeasures.some((m) => /Standpipe/i.test(m.description)), true);
    assert.equal(
      merged.citedSections.filter((s) => s.citation.includes("IBC 1021.2")).length,
      1,
    );
  });

  it("treats short scanned pages as sparse and the sample as not sparse", () => {
    assert.equal(pagesAreSparse([{ pageNumber: 1, text: "scan" }]), true);
    assert.equal(pagesAreSparse(SAMPLE_DC_CODE_MODIFICATION_PAGES), false);
  });

  it("drops stale heuristic warnings after vision merge on scanned sparse pages", () => {
    const scannedPages = [
      { pageNumber: 1, text: "" },
      { pageNumber: 2, text: "" },
      { pageNumber: 3, text: "Michelle Davis" },
    ];
    const heuristic = heuristicExtractModificationRequest(scannedPages);
    const combinedParagraph =
      "Provide a two-hour fire rated enclosed stairway serving all occupied levels, provide a fully automatic sprinkler system throughout the building, provide a fully monitored fire alarm and emergency notification system, maintain an occupant load below 49 people per floor. Incorporate DOB recommendations from June 9, 2026 PDRM include a standpipe, maintain a common path of travel distance of less than 75'-0\", provide permanent signage identifying and limiting the maximum occupant load of the rooftop amenity area.";
    const vision = emptyExtractedRequest();
    vision.requestedModification =
      "Targeted equivalency strategy in lieu of a second egress stair per 2017 DCMR 12A Chapter 10 Section 1006.";
    vision.citedSections = [
      {
        citation: "2017 DCMR 12A Chapter 10 Section 1006",
        year: null,
        source: "applicant",
        label: "Applicant-cited code",
      },
    ];
    vision.proposedMeasures = [
      {
        id: "measure-1",
        description: combinedParagraph,
        sourcePageNumber: 2,
        sourceContext: "Proposed alternative / compensating measures",
      },
    ];
    const merged = mergeExtractedRequests(heuristic, vision);
    assert.equal(
      merged.extractionWarnings.includes(HEURISTIC_FIELD_WARNINGS.requestedModification),
      false,
    );
    assert.equal(
      merged.extractionWarnings.includes(HEURISTIC_FIELD_WARNINGS.citedSections),
      false,
    );
    assert.equal(
      merged.extractionWarnings.includes(HEURISTIC_FIELD_WARNINGS.proposedMeasures),
      false,
    );
    assert.equal(merged.proposedMeasures.length >= 5, true);
    assert.equal(reconcileExtractionWarnings(merged).length, 0);
  });

  it("splits combined compensating-measure paragraphs into separate rows", () => {
    const combinedParagraph =
      "Provide a two-hour fire rated enclosed stairway serving all occupied levels, provide a fully automatic sprinkler system throughout the building, provide a fully monitored fire alarm and emergency notification system, maintain an occupant load below 49 people per floor. Incorporate DOB recommendations from June 9, 2026 PDRM include a standpipe, maintain a common path of travel distance of less than 75'-0\", provide permanent signage identifying and limiting the maximum occupant load of the rooftop amenity area.";
    const split = splitMeasureDescription(combinedParagraph);
    assert.equal(split.length >= 5, true);
    const normalized = normalizeProposedMeasures([
      {
        id: "measure-1",
        description: combinedParagraph,
        sourcePageNumber: 2,
        sourceContext: "Proposed alternative / compensating measures",
      },
    ]);
    assert.equal(normalized.length, split.length);
    assert.equal(normalized.every((m) => m.sourcePageNumber === 2), true);
  });
});
