import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import registry from "../../../shared/code-registry/jurisdiction-editions.json" with { type: "json" };
import {
  DC_2017_REGISTRY_SNAPSHOT,
  displayAnalysisMode,
  legacySupabaseAnalyzerPrompt,
  normalizeNewRunAnalysisMode,
  processorReviewPrompt,
  resolveAnalyzerReviewScope,
} from "./analysisMode.ts";
import { displayDisciplineForSheet } from "./disciplineDisplay.ts";
import {
  buildSupabaseAnalyzerJsonExport,
  countSeverity,
  supabaseAnalyzerExportFileName,
} from "./exportDataset.ts";
import type { AnalyzerRunDataset, SupabaseAnalyzerFinding, SupabaseAnalyzerRun, SupabaseAnalyzerSheetJob } from "./client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function finding(partial: Partial<SupabaseAnalyzerFinding> & Pick<SupabaseAnalyzerFinding, "id" | "sheet_job_id" | "severity">): SupabaseAnalyzerFinding {
  return {
    run_id: "run-1",
    finding_index: 0,
    category: "General",
    title: "Observation",
    observation: "Visible note on the sheet.",
    drawing_evidence: "Title block note.",
    drawing_location: "Title block",
    suggested_code_reference: "IBC 1006",
    recommendation: "Confirm with the adopted text.",
    ai_provider: "openai",
    ai_model: "gpt-4o",
    jurisdiction_key: "dc",
    code_edition: "2017",
    provenance_status: "model_generated_from_uploaded_pdf",
    verification_status: "proposed_reference",
    created_at: "2026-10-22T00:00:00.000Z",
    ...partial,
  };
}

function job(partial: Partial<SupabaseAnalyzerSheetJob> & Pick<SupabaseAnalyzerSheetJob, "id" | "ordinal">): SupabaseAnalyzerSheetJob {
  return {
    run_id: "run-1",
    project_id: "project-1",
    original_file_name: "A-101.pdf",
    object_path: "project-1/run-1/secret-token.pdf",
    file_size: 1000,
    discipline: "Architecture",
    detected_sheet_number: "A-101",
    detected_sheet_title: "Floor Plan",
    status: "completed",
    attempt_count: 1,
    max_attempts: 3,
    last_error: null,
    error_code: null,
    input_tokens: 10,
    output_tokens: 20,
    estimated_cost_usd: 1.25,
    analysis_summary: "Floor plan reviewed.",
    created_at: "2026-10-22T00:00:00.000Z",
    updated_at: "2026-10-22T00:00:00.000Z",
    ...partial,
  };
}

function run(partial: Partial<SupabaseAnalyzerRun> = {}): SupabaseAnalyzerRun {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    project_id: "project-1",
    created_by: "user-secret",
    status: "completed",
    jurisdiction_key: "dc",
    jurisdiction_label: "Washington D.C. (12A DCMR)",
    project_type: "Commercial (General)",
    code_edition: "2017",
    code_context: "2017 DC Construction Codes (2015 IBC base)",
    analysis_mode: null,
    analysis_scope: null,
    source_coverage: "adoption_metadata_only",
    ai_provider: "openai",
    ai_model: "gpt-4o",
    total_sheets: 2,
    uploaded_sheets: 2,
    queued_sheets: 0,
    processing_sheets: 0,
    completed_sheets: 2,
    failed_sheets: 0,
    total_input_tokens: 10,
    total_output_tokens: 20,
    estimated_cost_usd: 1.25,
    budget_limit_usd: 20,
    started_at: null,
    completed_at: "2026-10-22T00:00:00.000Z",
    cancelled_at: null,
    created_at: "2026-10-22T00:00:00.000Z",
    updated_at: "2026-10-22T00:00:00.000Z",
    ...partial,
  };
}

describe("discipline display", () => {
  it("maps Architecture and Architectural to Architectural", () => {
    assert.equal(displayDisciplineForSheet({ discipline: "Architecture", detected_sheet_number: "A-101" }).display, "Architectural");
    assert.equal(displayDisciplineForSheet({ discipline: "Architectural", detected_sheet_number: "A-101" }).display, "Architectural");
    assert.equal(displayDisciplineForSheet({ discipline: "HVAC", detected_sheet_number: "M-201" }).display, "Mechanical");
  });

  it("does not relabel a demolition sheet as Architectural", () => {
    const display = displayDisciplineForSheet({
      discipline: "Architecture",
      detected_sheet_number: "D-101",
      detected_sheet_title: "Demolition Plan",
      original_file_name: "D-101.pdf",
    });
    assert.equal(display.display, "Demolition");
    assert.equal(display.raw, "Architecture");
    assert.equal(display.conflict, true);
  });

  it("stays stable for the same stored fields", () => {
    const input = {
      discipline: "Fire",
      detected_sheet_number: "FP-1",
      detected_sheet_title: "Fire Protection",
      original_file_name: "FP-1.pdf",
    };
    assert.deepEqual(displayDisciplineForSheet(input), displayDisciplineForSheet(input));
    assert.equal(displayDisciplineForSheet(input).display, "Fire Protection");
  });

  it("leaves an unclassified sheet pending", () => {
    assert.equal(displayDisciplineForSheet({ discipline: null }).display, "Pending classification");
  });
});

describe("severity counts", () => {
  it("counts only persisted findings", () => {
    const totals = countSeverity([
      { severity: "critical" },
      { severity: "warning" },
      { severity: "warning" },
      { severity: "advisory" },
    ]);
    assert.deepEqual(totals, { all: 4, critical: 1, warning: 2, advisory: 1 });
  });
});

describe("json export", () => {
  it("builds a secret-free document from the saved dataset", () => {
    const dataset: AnalyzerRunDataset = {
      run: run(),
      jobs: [
        job({ id: "job-1", ordinal: 1 }),
        job({
          id: "job-2",
          ordinal: 2,
          original_file_name: "D-101.pdf",
          object_path: "signed-url-token",
          discipline: "Architecture",
          detected_sheet_number: "D-101",
          detected_sheet_title: "Demolition Plan",
        }),
      ],
      findings: [
        finding({ id: "finding-1", sheet_job_id: "job-1", severity: "critical", finding_index: 0 }),
      ],
    };
    const exported = buildSupabaseAnalyzerJsonExport(dataset, "Highland", "2026-10-22T12:00:00.000Z");
    const serialized = JSON.stringify(exported);
    assert.equal(exported.schemaVersion, "supabase-analyzer-export.v1");
    assert.equal(exported.exportedAt, "2026-10-22T12:00:00.000Z");
    assert.equal(exported.run.analysisMode, null);
    assert.equal(exported.run.analysisModeLabel, "Legacy review");
    assert.equal(exported.sheets[1].discipline.display, "Demolition");
    assert.equal(exported.sheets[1].discipline.raw, "Architecture");
    assert.equal(exported.sheets[0].findings[0].id, "finding-1");
    assert.equal(exported.sheets[0].findings[0].provenanceStatus, "model_generated_from_uploaded_pdf");
    assert.equal(exported.run.severityTotals.critical, 1);
    assert.equal(JSON.parse(serialized).project.name, "Highland");
    assert.equal(serialized.includes("object_path"), false);
    assert.equal(serialized.includes("secret-token"), false);
    assert.equal(serialized.includes("signed-url-token"), false);
    assert.equal(serialized.includes("created_by"), false);
    assert.equal(serialized.includes("user-secret"), false);
    assert.equal(serialized.includes("gpt-4o"), false);
    assert.equal(serialized.includes("estimated_cost"), false);
    assert.equal(supabaseAnalyzerExportFileName(dataset.run.id, "json"), "PermitPilot-Code-Analyzer-abcdef12.json");
  });
});

describe("analysis mode scope", () => {
  it("defaults new runs to Both and keeps a missing historical mode legacy", () => {
    assert.equal(normalizeNewRunAnalysisMode(undefined), "both");
    assert.equal(displayAnalysisMode(null), "Legacy review");
    assert.equal(displayAnalysisMode("both"), "Both — Base Code + Local Amendments");
    assert.deepEqual(normalizeNewRunAnalysisMode("custom"), {
      error: "analysisMode must be both, ibc_only, or local_only",
    });
  });

  it("matches the verified DC 2017 registry and constrains MEP under IBC only", () => {
    const record = (registry as Array<{
      id: string;
      jurisdictionCodeEdition: string;
      baseCodes: Array<{ family: string; edition: string; discipline: string }>;
      localAmendments?: Array<{ codeBook: string }>;
      coverage?: { enforceableProvisionText?: string };
    }>).find((item) => item.id === DC_2017_REGISTRY_SNAPSHOT.id);
    assert.ok(record);
    assert.equal(record.jurisdictionCodeEdition, DC_2017_REGISTRY_SNAPSHOT.edition);
    assert.equal(record.coverage?.enforceableProvisionText, DC_2017_REGISTRY_SNAPSHOT.enforceableProvisionText);
    assert.equal(record.localAmendments?.[0]?.codeBook, DC_2017_REGISTRY_SNAPSHOT.localAmendmentRecord);
    for (const code of DC_2017_REGISTRY_SNAPSHOT.baseCodes) {
      const match = record.baseCodes.find((item) => item.family === code.family && item.discipline === code.discipline);
      assert.equal(match?.edition, code.edition);
    }

    const both = resolveAnalyzerReviewScope({
      mode: "both",
      jurisdictionKey: "dc",
      jurisdictionLabel: "Washington D.C. (12A DCMR)",
      codeEdition: "2017",
      codeContext: "2017 DC Construction Codes (2015 IBC base)",
    });
    assert.equal(both.baseIbcEdition, "2015");
    assert.match(both.promptScope, /2015 IBC/);
    assert.match(both.promptScope, /NEC 2014/);
    assert.match(both.promptScope, /not reviewed as IBC/);
    assert.match(both.promptScope, /Do not invent local amendment text/);

    const ibc = resolveAnalyzerReviewScope({
      mode: "ibc_only",
      jurisdictionKey: "dc",
      jurisdictionLabel: "Washington D.C. (12A DCMR)",
      codeEdition: "2017",
      codeContext: "2017 DC Construction Codes (2015 IBC base)",
    });
    assert.match(ibc.promptScope, /2015 IBC only/);
    assert.match(ibc.promptScope, /electrical, plumbing, mechanical, or fire-protection/i);
    assert.match(ibc.promptScope, /comprehensive MEP review/);

    const local = resolveAnalyzerReviewScope({
      mode: "local_only",
      jurisdictionKey: "dc",
      jurisdictionLabel: "Washington D.C. (12A DCMR)",
      codeEdition: "2017",
      codeContext: "2017 DC Construction Codes (2015 IBC base)",
    });
    assert.match(local.promptScope, /DCMR Title 12/);
    assert.match(local.promptScope, /Do not invent missing amendment text/);

    const gap = resolveAnalyzerReviewScope({
      mode: "local_only",
      jurisdictionKey: "maryland-msbc",
      jurisdictionLabel: "Maryland (MSBC)",
      codeEdition: "2021",
      codeContext: "Maryland (MSBC) — selected 2021 reference context",
    });
    assert.equal(gap.registryRecordId, null);
    assert.match(gap.promptScope, /Return no local-amendment findings/);
  });

  it("does not reinterpret a historical run as the selected mode", () => {
    const context = {
      jurisdiction_label: "Washington D.C. (12A DCMR)",
      code_context: "2017 DC Construction Codes (2015 IBC base)",
      project_type: "Commercial (General)",
    };
    const legacy = processorReviewPrompt({ ...context, analysis_mode: null });
    assert.equal(legacy, legacySupabaseAnalyzerPrompt(context));
    assert.equal(legacy.includes("Analysis mode scope"), false);
    const scoped = processorReviewPrompt({
      ...context,
      analysis_mode: "ibc_only",
      jurisdiction_key: "dc",
      code_edition: "2017",
    });
    assert.match(scoped, /Analysis mode scope/);
    assert.match(scoped, /IBC Only/);
  });

  it("wires the mode into the run create and processor without a paid call", () => {
    const runs = readFileSync(join(__dirname, "../../../supabase/functions/supabase-analyzer-runs/index.ts"), "utf8");
    const processor = readFileSync(join(__dirname, "../../../supabase/functions/supabase-analyzer-processor/index.ts"), "utf8");
    assert.match(runs, /normalizeNewRunAnalysisMode\(body\.analysisMode\)/);
    assert.match(runs, /analysis_mode: requestedMode/);
    assert.match(processor, /processorReviewPrompt\(run\)/);
    assert.equal(processor.includes("https://api.openai.com/v1/responses"), true);
    assert.equal(/analysis_mode\s*=\s*"both"/.test(processor), false);
  });
});
