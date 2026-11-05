import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzerV2Unavailable,
  reopenAnalyzerV2Gate,
  withAnalyzerVersion,
} from "../../../supabase/functions/_shared/analyzerVersion.ts";
import { evaluateStage3OcrRunGate } from "../../../supabase/functions/_shared/analyzerStage3OcrReadiness.ts";
import { reanalysisRequestKey } from "../../../supabase/functions/_shared/analyzerReanalysis.ts";
import {
  ANALYZER_V2_OCR_GRID,
  DEFAULT_ANALYZER_VERSION,
  analyzerVersionOf,
  analyzerVersionOptions,
  analyzerVersionShortLabel,
  isAnalyzerVersion,
  parseAnalyzerVersion,
} from "./analyzerVersion.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = (values: Record<string, string>) => ({ get: (key: string) => values[key] });

describe("Supabase Analyzer version", () => {
  it("defaults new UI runs to V2, reads a missing server value as V1, and accepts only v1 or v2", () => {
    assert.equal(DEFAULT_ANALYZER_VERSION, "v2");
    assert.equal(parseAnalyzerVersion(undefined), "v1");
    assert.equal(parseAnalyzerVersion(""), "v1");
    assert.equal(parseAnalyzerVersion("v1"), "v1");
    assert.equal(parseAnalyzerVersion("v2"), "v2");
    assert.deepEqual(parseAnalyzerVersion("v3"), { error: "analyzerVersion must be v1 or v2" });
    assert.deepEqual(parseAnalyzerVersion("V2"), { error: "analyzerVersion must be v1 or v2" });
    assert.equal(isAnalyzerVersion("v2"), true);
    assert.equal(isAnalyzerVersion("12x9"), false);
    assert.deepEqual(analyzerVersionOptions.map((o) => o.value), ["v1", "v2"]);
    assert.match(analyzerVersionOptions[1].label, /4×3 OCR/);
  });

  it("reads runs created before the toggle as V1", () => {
    assert.equal(analyzerVersionOf(null), "v1");
    assert.equal(analyzerVersionOf({ analysisMode: "both" }), "v1");
    assert.equal(analyzerVersionOf({ stage3EvidenceVersion: "v2" }), "v1");
    assert.equal(analyzerVersionOf({ analyzerVersion: "v2" }), "v2");
    assert.equal(analyzerVersionShortLabel({}), "V1");
    assert.equal(analyzerVersionShortLabel({ analyzerVersion: "v2" }), "V2 (4×3 OCR)");
  });

  it("keeps a V1 scope as given, adding only the version", () => {
    const base = { analysisMode: "both", stage3VisualEvidence: true };
    assert.deepEqual(withAnalyzerVersion(base, "v1", { requiredSheetCount: 3 }), { ...base, analyzerVersion: "v1" });
    const optIn = { analysisMode: "both", stage3FullCoverageOcr: true, stage3OcrPreprocess: { gateMode: "blocking" } };
    assert.deepEqual(withAnalyzerVersion(optIn, "v1", { requiredSheetCount: 3 }), { ...optIn, analyzerVersion: "v1" });
  });

  it("gives a V2 run v2 evidence on 4x3 OCR behind the full-coverage gate, never 12x9", () => {
    const scope = withAnalyzerVersion({ analysisMode: "both", stage3OcrGrid: "12x9" }, "v2", { requiredSheetCount: 2 });
    assert.equal(scope.analyzerVersion, "v2");
    assert.equal(scope.stage3EvidenceVersion, "v2");
    assert.equal(scope.stage3OcrGrid, ANALYZER_V2_OCR_GRID);
    assert.equal(scope.stage3OcrGrid, "4x3");
    assert.equal(scope.stage3V2ModelRevision, "model.r6-downstream");
    assert.equal(scope.stage3FullCoverageOcr, true);
    assert.equal(scope.stage3VisualEvidence, true);
    const preprocess = scope.stage3OcrPreprocess as Record<string, unknown>;
    assert.equal(preprocess.gateMode, "blocking");
    assert.equal(preprocess.requiredSheetCount, 2);
    assert.equal(evaluateStage3OcrRunGate({ analysisScope: scope }).blockGpt, true);
    const ready = {
      ...scope,
      stage3OcrPreprocess: { ...preprocess, terminal: true, counts: { completed: 2, failed: 0, skipped: 0 }, missingEvidence: 0 },
    };
    assert.equal(evaluateStage3OcrRunGate({ analysisScope: ready }).blockGpt, false);
    const workerReleased = { ...scope, stage3OcrPreprocess: { ...preprocess, terminal: true, gateMode: "approved_partial" } };
    assert.equal(evaluateStage3OcrRunGate({ analysisScope: workerReleased }).code, "approved_partial");
  });

  it("reopens the OCR gate only for V2 runs when drawings are added", () => {
    assert.equal(reopenAnalyzerV2Gate({ analysisMode: "both" }, 4), null);
    assert.equal(reopenAnalyzerV2Gate(null, 4), null);
    const released = {
      analyzerVersion: "v2",
      stage3OcrPreprocess: { gateMode: "approved_partial", terminal: true, requiredSheetCount: 2, counts: { completed: 2 } },
    };
    const reopened = reopenAnalyzerV2Gate(released, 4, "2026-11-06T00:00:00.000Z")!;
    assert.deepEqual(reopened.stage3OcrPreprocess, {
      gateMode: "blocking",
      terminal: false,
      requiredSheetCount: 4,
      counts: { completed: 2 },
      fullCoverage: true,
      macWorkerLastHeartbeat: "2026-11-06T00:00:00.000Z",
      updatedAt: "2026-11-06T00:00:00.000Z",
    });
    assert.equal(reopened.stage3FullCoverageOcr, true);
    assert.equal(reopened.analyzerVersion, "v2");
  });

  it("has a rollback switch that disables V2 without touching V1", () => {
    assert.equal(analyzerV2Unavailable(env({})), null);
    assert.match(analyzerV2Unavailable(env({ SUPABASE_ANALYZER_V2_ENABLED: "false" })) || "", /Use V1/);
    assert.match(analyzerV2Unavailable(env({ ANALYZER_STAGE3_VISUAL_EVIDENCE: "false" })) || "", /Use V1/);
    assert.equal(analyzerV2Unavailable(env({ SUPABASE_ANALYZER_V2_ENABLED: "true" })), null);
  });

  it("gives a reanalysis a different request key per version, leaving V1 keys unchanged", () => {
    const input = { sourceRunId: "r", scope: "all" as const, jobIds: [], files: [], analysisMode: "both" };
    assert.equal(reanalysisRequestKey(input), "r#all#both#all#");
    assert.equal(reanalysisRequestKey({ ...input, analyzerVersion: "v1" }), "r#all#both#all#");
    assert.equal(reanalysisRequestKey({ ...input, analyzerVersion: "v2" }), "r#all#both#all##v2");
  });

  it("is applied by the runs function on create and reanalysis and recorded in the audit", () => {
    const runs = readFileSync(join(__dirname, "../../../supabase/functions/supabase-analyzer-runs/index.ts"), "utf8");
    assert.equal([...runs.matchAll(/parseAnalyzerVersion\(body\.analyzerVersion\)/g)].length, 2);
    assert.equal([...runs.matchAll(/withAnalyzerVersion\(/g)].length, 2);
    assert.equal([...runs.matchAll(/analyzer_version: analyzerVersion/g)].length, 2);
    assert.match(runs, /analyzerV2Unavailable\(Deno\.env\)/);
    const client = readFileSync(join(__dirname, "client.ts"), "utf8");
    assert.equal([...client.matchAll(/analyzerVersion: input\.analyzerVersion === "v1" \? "v1" : "v2"/g)].length, 2);
  });
});
