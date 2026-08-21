import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripApprovalClaims,
  validateAndGroundFindings,
} from "./grounding.ts";
import type { AllowedEvidenceRef, EvidenceFinding } from "./model.ts";

const allowed: AllowedEvidenceRef[] = [
  { sheetId: "sheet-a", pageNumber: 1, fileName: "A-101.png", sheetLabel: "A-101" },
];

function finding(partial: Partial<EvidenceFinding>): EvidenceFinding {
  return {
    id: "f1",
    measure: "NFPA 13 sprinkler",
    status: "verified",
    ...partial,
  };
}

describe("validateAndGroundFindings", () => {
  it("keeps a supported finding that cites an allowed sheet/page", () => {
    const [grounded] = validateAndGroundFindings(
      [
        finding({
          source: { sheetId: "sheet-a", pageNumber: 1, fileName: "A-101.png" },
        }),
      ],
      allowed,
    );
    assert.equal(grounded.status, "verified");
    assert.equal(grounded.source?.sheetId, "sheet-a");
  });

  it("turns a supported finding without an allowed sheet/page into not_found", () => {
    const [noSource] = validateAndGroundFindings([finding({ source: null })], allowed);
    assert.equal(noSource.status, "not_found");

    const [unknownSheet] = validateAndGroundFindings(
      [
        finding({
          source: { sheetId: "sheet-zzz", pageNumber: 99, sheetLabel: "A-999" },
        }),
      ],
      allowed,
    );
    assert.equal(unknownSheet.status, "not_found");
    assert.equal(unknownSheet.source, null);
  });

  it("turns conflicting without a source into requires_professional_dob_review", () => {
    const [grounded] = validateAndGroundFindings(
      [finding({ status: "conflicting", source: null, note: "Drawings disagree" })],
      allowed,
    );
    assert.equal(grounded.status, "requires_professional_dob_review");
  });

  it("strips approval claims from notes", () => {
    assert.match(stripApprovalClaims("DOB approved this stair"), /requires professional/i);
    assert.doesNotMatch(stripApprovalClaims("DOB approved this stair"), /DOB approved/i);
    const [grounded] = validateAndGroundFindings(
      [
        finding({
          status: "verified",
          source: { sheetId: "sheet-a", pageNumber: 1 },
          note: "This will be officially approved",
        }),
      ],
      allowed,
    );
    assert.doesNotMatch(grounded.note ?? "", /officially approved/i);
  });
});
