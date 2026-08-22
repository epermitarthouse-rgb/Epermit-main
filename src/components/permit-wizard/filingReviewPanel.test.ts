import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const componentDir = path.dirname(fileURLToPath(import.meta.url));

describe("FilingReviewPanel render safety", () => {
  it("normalizes approval_package before rendering cards", () => {
    const source = readFileSync(path.join(componentDir, "FilingReviewPanel.tsx"), "utf8");
    assert.match(source, /normalizeApprovalPackage/);
    assert.match(source, /getPropertyIntelligenceError/);
  });

  it("formats license warnings instead of rendering raw objects", () => {
    const source = readFileSync(path.join(componentDir, "LicenseValidationCard.tsx"), "utf8");
    assert.match(source, /formatLicenseWarning/);
  });
});
