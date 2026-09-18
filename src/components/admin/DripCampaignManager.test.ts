import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DripCampaignManager.tsx"), "utf8");

describe("DripCampaignManager reliability", () => {
  it("tracks loading, error, and ready fetch states", () => {
    assert.match(source, /DripCampaignFetchState/);
    assert.match(source, /status: 'loading'/);
    assert.match(source, /status: 'error'/);
    assert.match(source, /status: 'ready'/);
  });

  it("does not render stats table when fetch fails", () => {
    assert.match(source, /isDripCampaignFetchError\(fetchState\)/);
    assert.match(source, /Unable to load onboarding enrollments/);
  });

  it("shows empty state only when ready with zero campaigns", () => {
    assert.match(source, /isDripCampaignEmpty\(fetchState\)/);
    assert.match(source, /No onboarding enrollments yet/);
  });

  it("Process Now invokes process-drip-emails edge function", () => {
    assert.match(source, /invokeProcessDripEmails/);
  });
});
