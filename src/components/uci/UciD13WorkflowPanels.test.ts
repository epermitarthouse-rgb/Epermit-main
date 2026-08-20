import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const panelsSource = readFileSync(join(__dirname, "UciD13WorkflowPanels.tsx"), "utf8");

describe("Stage 6 COS operator copy", () => {
  it("treats re-analyze as recovery and auto-completes clean matches", () => {
    assert.match(panelsSource, /COS matched · Stage 6 completed automatically/);
    assert.match(panelsSource, /Re-analyze selected \(recovery\)/);
    assert.match(panelsSource, /Clean matches complete Stage 6 automatically/);
  });
});

describe("PortfolioSummarySection render safety", () => {
  it("guards stage_summary when portfolio API omits the field", () => {
    assert.match(
      panelsSource,
      /Object\.entries\(portfolio\.stage_summary\s*\?\?\s*\{\}\)/,
      "stage_summary must default to {} so Object.entries does not throw on older portfolio payloads",
    );
  });
});

describe("useSyncRunPolling storm prevention", () => {
  it("serializes in-flight sync-run polls and backs off after failures", () => {
    assert.match(panelsSource, /inFlightRef/);
    assert.match(panelsSource, /failCountRef/);
    assert.match(panelsSource, /Math\.min\(delayMs \* 2, 60000\)/);
    assert.match(panelsSource, /if \(!coordinationId \|\| inFlightRef\.current\) return/);
  });

  it("clears polling state when coordination changes or unmounts", () => {
    assert.match(panelsSource, /cancelled = true/);
    assert.match(panelsSource, /window\.clearTimeout\(timeoutId\)/);
    assert.match(panelsSource, /failCountRef\.current = 0/);
  });
});
