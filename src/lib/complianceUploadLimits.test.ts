import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COMPLIANCE_MAX_DRAWING_FILES, takeComplianceFiles } from "./complianceUploadLimits.ts";

describe("complianceUploadLimits", () => {
  it("allows only one drawing file", () => {
    assert.equal(COMPLIANCE_MAX_DRAWING_FILES, 1);
  });

  it("keeps the first file when multiple are provided", () => {
    const files = [
      { name: "a.pdf" } as File,
      { name: "b.pdf" } as File,
      { name: "c.pdf" } as File,
    ];
    const { accepted, rejectedCount } = takeComplianceFiles(files);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].name, "a.pdf");
    assert.equal(rejectedCount, 2);
  });

  it("returns empty when no files are provided", () => {
    const { accepted, rejectedCount } = takeComplianceFiles([]);
    assert.deepEqual(accepted, []);
    assert.equal(rejectedCount, 0);
  });
});
