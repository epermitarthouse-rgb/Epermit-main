import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(join(__dirname, "UciD13WorkflowPanels.tsx"), "utf8");
const dashboardSource = readFileSync(
  join(__dirname, "..", "..", "pages", "UciDashboard.tsx"),
  "utf8",
);

describe("CostsEquipmentWorkflowPanel Stage 7 zero-cost regression", () => {
  it("imports UCI_COST_TYPES as a runtime value for the cost-type Select", () => {
    assert.match(panelSource, /import \{ UCI_COST_TYPES \} from "@\/types\/uci"/);
    assert.doesNotMatch(
      panelSource,
      /import type \{[^}]*\bUCI_COST_TYPES\b[^}]*\} from "@\/types\/uci"/,
    );
    assert.match(panelSource, /UCI_COST_TYPES\.map\(\(type\)/);
  });

  it("keeps the zero-cost render path wired from the Stage 7 workspace tab", () => {
    assert.match(panelSource, /costs\.length === 0 \?/);
    assert.match(panelSource, /No cost rows yet/);
    assert.match(dashboardSource, /<TabsContent value="costs"/);
    assert.match(dashboardSource, /<CostsEquipmentWorkflowPanel/);
    assert.match(dashboardSource, /detail\.costs \?\? \[\]/);
  });

  it("surfaces QuickBooks retry controls and invoice failure context on cost rows", () => {
    assert.match(panelSource, /function canRetryClientInvoice/);
    assert.match(panelSource, /status === "failed" \|\| status === "retry" \|\| status === "uncertain"/);
    assert.match(panelSource, /Retry client invoice/);
    assert.match(panelSource, /cost\.qb_last_error/);
    assert.match(panelSource, /Invoice attempts: \{cost\.qb_attempt_count\}/);
    assert.match(panelSource, /Last invoice attempt \{formatWhen\(cost\.updated_at\)\}/);
    assert.match(panelSource, /QuickBooks invoice \{cost\.quickbooks_invoice_id\}/);
    assert.match(dashboardSource, /onRetryInvoice=\{\(costId\) =>/);
    assert.match(dashboardSource, /retryCoordinationCostInvoice\(detailId!, costId\)/);
  });
});
