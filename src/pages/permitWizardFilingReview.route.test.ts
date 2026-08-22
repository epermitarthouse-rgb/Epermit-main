import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

describe("PermitWizardFiling review route", () => {
  it("registers a durable review route with filingId param", () => {
    const appSource = readFileSync(path.join(root, "App.tsx"), "utf8");
    assert.match(appSource, /permit-wizard-filing\/review\/:filingId/);
    assert.match(appSource, /PermitWizardFilingReview/);
  });

  it("navigates Open Review to the durable review route", () => {
    const filingSource = readFileSync(path.join(root, "pages/PermitWizardFiling.tsx"), "utf8");
    assert.match(filingSource, /openFilingReview/);
    assert.match(filingSource, /\/permit-wizard-filing\/review\/\$\{filingId\}/);
    assert.doesNotMatch(filingSource, /reviewDialogOpen/);
  });

  it("loads filing review by filingId on refresh", () => {
    const reviewSource = readFileSync(path.join(root, "pages/PermitWizardFilingReview.tsx"), "utf8");
    assert.match(reviewSource, /useParams/);
    assert.match(reviewSource, /\.eq\("id", filingId\)/);
    assert.match(reviewSource, /button-back-to-permit-filing/);
  });
});
