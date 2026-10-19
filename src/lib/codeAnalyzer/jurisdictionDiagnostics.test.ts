import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildJurisdictionDiagnostics } from "./jurisdictionDiagnostics.ts";

describe("buildJurisdictionDiagnostics", () => {
  it("flags general jurisdiction when DC appears in document names", () => {
    const d = buildJurisdictionDiagnostics("general", [
      "24-070 Riverside — Washington DC Spec Division 01.pdf",
    ]);
    assert.equal(d.mismatch, true);
    assert.ok(d.detectedJurisdictionHints.includes("dc"));
    assert.match(d.message ?? "", /Washington, DC/i);
  });

  it("does not flag when DC jurisdiction selected", () => {
    const d = buildJurisdictionDiagnostics("dc", ["Washington DC permit set"]);
    assert.equal(d.mismatch, false);
  });
});
