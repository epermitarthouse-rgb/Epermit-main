import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLIANCE_MAX_BATCH_FILES,
  mergeComplianceFiles,
} from "./complianceUploadLimits.ts";

describe("complianceUploadLimits", () => {
  it("allows sixteen source files per upload drop", () => {
    assert.equal(COMPLIANCE_MAX_BATCH_FILES, 16);
  });

  it("appends up to the remaining batch capacity", () => {
    const files = Array.from({ length: 3 }, (_, i) => ({ name: `a${i}.pdf` } as File));
    const { accepted, rejectedCount } = mergeComplianceFiles(0, files);
    assert.equal(accepted.length, 3);
    assert.equal(rejectedCount, 0);
  });

  it("reports rejected files when batch is full", () => {
    const files = [
      { name: "a.pdf" } as File,
      { name: "b.pdf" } as File,
      { name: "c.pdf" } as File,
    ];
    const { accepted, rejectedCount } = mergeComplianceFiles(15, files);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].name, "a.pdf");
    assert.equal(rejectedCount, 2);
  });

  it("returns empty when no files are provided", () => {
    const { accepted, rejectedCount } = mergeComplianceFiles(0, []);
    assert.deepEqual(accepted, []);
    assert.equal(rejectedCount, 0);
  });
});
