import { describe, expect, it } from "vitest";
import { buildJurisdictionDiagnostics } from "./jurisdictionDiagnostics";

describe("buildJurisdictionDiagnostics", () => {
  it("flags general jurisdiction when DC appears in document names", () => {
    const d = buildJurisdictionDiagnostics("general", [
      "24-070 Riverside — Washington DC Spec Division 01.pdf",
    ]);
    expect(d.mismatch).toBe(true);
    expect(d.detectedJurisdictionHints).toContain("dc");
    expect(d.message).toMatch(/Washington, DC/i);
  });

  it("does not flag when DC jurisdiction selected", () => {
    const d = buildJurisdictionDiagnostics("dc", ["Washington DC permit set"]);
    expect(d.mismatch).toBe(false);
  });
});
