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
  it("shows a single lifecycle panel instead of the legacy stage distribution views", () => {
    assert.doesNotMatch(dashboardSource, /title="Current stage distribution"/);
    assert.doesNotMatch(dashboardSource, /title="Stage \+ state matrix"/);
    assert.doesNotMatch(dashboardSource, /id="uci-stage-rail"/);
    assert.equal(dashboardSource.match(/title="Lifecycle progress"/g)?.length, 1);
  });

  it("shows current position without inferring that every earlier stage completed", () => {
    assert.match(dashboardSource, /title="Lifecycle progress"/);
    assert.match(dashboardSource, /RecordLifecycleProgressRail/);
    assert.match(railSource, /const isPast = s < stage/);
    assert.match(railSource, /"past"/);
    assert.doesNotMatch(railSource, /getWorkflowGroupProgress/);
    assert.match(dashboardSource, /Earlier stages are not assumed complete/);
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
