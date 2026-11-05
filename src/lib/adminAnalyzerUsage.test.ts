import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatUsd, summarizeAnalyzerUsage, type AnalyzerUsageRow } from "./adminAnalyzerUsage.ts";

function row(partial: Partial<AnalyzerUsageRow>): AnalyzerUsageRow {
  return {
    run_id: "r",
    project_id: "p",
    project_name: "McDonald's",
    created_at: "2026-11-05T20:00:00.000Z",
    completed_at: null,
    status: "completed",
    analyzer_version: "v1",
    ai_model: "gpt-4o",
    total_sheets: 82,
    completed_sheets: 82,
    failed_sheets: 0,
    total_input_tokens: 1000,
    total_output_tokens: 200,
    estimated_cost_usd: 1,
    budget_limit_usd: 20,
    ...partial,
  };
}

describe("admin analyzer usage", () => {
  it("formats small run costs without rounding them away", () => {
    assert.equal(formatUsd(0.012), "$0.012");
    assert.equal(formatUsd(1.0182), "$1.0182");
    assert.equal(formatUsd(20), "$20.00");
  });

  it("totals every loaded run and the current UTC month", () => {
    const summary = summarizeAnalyzerUsage([
      row({ estimated_cost_usd: 1.0182, completed_sheets: 57, created_at: "2026-11-05T20:00:00.000Z" }),
      row({ estimated_cost_usd: 0.0225, completed_sheets: 1, created_at: "2026-11-05T20:48:00.000Z", analyzer_version: "v2" }),
      row({ estimated_cost_usd: 4.5, completed_sheets: 82, created_at: "2026-10-30T14:00:00.000Z" }),
    ], new Date("2026-11-06T00:00:00.000Z"));
    assert.equal(summary.runs, 3);
    assert.equal(summary.completedSheets, 140);
    assert.ok(Math.abs(summary.totalCostUsd - 5.5407) < 1e-9);
    assert.ok(Math.abs(summary.monthCostUsd - 1.0407) < 1e-9);
  });
});
