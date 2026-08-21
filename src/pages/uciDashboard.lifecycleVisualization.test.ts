import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");
const panelsSource = readFileSync(
  join(__dirname, "..", "components", "uci", "UciD13WorkflowPanels.tsx"),
  "utf8",
);
const railSource = readFileSync(
  join(__dirname, "..", "components", "uci", "RecordLifecycleProgressRail.tsx"),
  "utf8",
);

describe("UciDashboard lifecycle visualization split", () => {
  it("renames the matrix to Current stage distribution with clarifying helper text", () => {
    assert.match(dashboardSource, /title="Current stage distribution"/);
    assert.doesNotMatch(dashboardSource, /title="Stage \+ state matrix"/);
    assert.match(dashboardSource, /CURRENT_STAGE_DISTRIBUTION_HELPER/);
  });

  it("adds a separate Lifecycle progress panel reusing getWorkflowGroupProgress", () => {
    assert.match(dashboardSource, /title="Lifecycle progress"/);
    assert.match(dashboardSource, /RecordLifecycleProgressRail/);
    assert.match(railSource, /getWorkflowGroupProgress\(\[s, s\], stage\)/);
    assert.match(dashboardSource, /id="uci-lifecycle-progress"/);
  });

  it("aligns portfolio stage_summary wording with current-position semantics", () => {
    assert.match(panelsSource, /Current stage distribution/);
    assert.match(panelsSource, /CURRENT_STAGE_DISTRIBUTION_HELPER/);
  });

  it("does not present KPI completion counts as lifecycle history", () => {
    assert.match(dashboardSource, /label="State & risk"/);
    assert.match(dashboardSource, /at COMPLETED state/);
  });
});
