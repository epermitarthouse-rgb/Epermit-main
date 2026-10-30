import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnalyzerUserPrompt } from "../../../supabase/functions/_shared/analyzerFindingQuality.ts";
import { isVisualEvidenceEnabled } from "../../../supabase/functions/_shared/analyzerVisualEvidence.ts";
import { isCrossSheetRetrievalEnabled } from "../../../supabase/functions/_shared/analyzerCrossSheetRetrieval.ts";
import {
  STAGE3_VISUAL_EVIDENCE_VERSION,
  assertStage3RunJobAuthorization,
  formatStage3VisualEvidencePrompt,
  isStage3VisualEvidenceEnabled,
  isStage3VisualEvidenceEnabledForRun,
  isStage3VisualEvidenceGloballyBlocked,
  isStage3VisualEvidenceRunAuthorized,
  mergeVisualEvidencePromptBlocks,
  retrieveStage3VisualEvidence,
  stage3CacheKey,
  stage3VisualEvidenceAuditMetadata,
  withStage3VisualEvidenceRunOptIn,
} from "../../../supabase/functions/_shared/analyzerStage3VisualEvidence.ts";
import {
  evaluateStage3OcrRunGate,
  mergeStage3FullCoverageRunOptIn,
} from "../../../supabase/functions/_shared/analyzerStage3OcrReadiness.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function envMap(values: Record<string, string | undefined>) {
  return {
    get(key: string) {
      return values[key];
    },
  };
}

const optedInRun = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  project_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  analysis_scope: { stage3VisualEvidence: true, promptScope: "keep-me" },
};

describe("Stage 3 visual evidence flag independence", () => {
  it("defaults off and ignores Stage 1–2 / CSR flags", () => {
    assert.equal(isStage3VisualEvidenceEnabled(envMap({})), false);
    assert.equal(isStage3VisualEvidenceEnabled(envMap({ ANALYZER_STAGE3_VISUAL_EVIDENCE: "false" })), false);
    assert.equal(isStage3VisualEvidenceEnabled(envMap({ ANALYZER_STAGE3_VISUAL_EVIDENCE: "true" })), true);
    assert.equal(isStage3VisualEvidenceEnabled(envMap({ ANALYZER_VISUAL_EVIDENCE: "true" })), false);
    assert.equal(isStage3VisualEvidenceEnabled(envMap({ ANALYZER_CROSS_SHEET_RETRIEVAL: "true" })), false);
    assert.equal(isVisualEvidenceEnabled(envMap({ ANALYZER_STAGE3_VISUAL_EVIDENCE: "true" })), false);
    assert.equal(isCrossSheetRetrievalEnabled(envMap({ ANALYZER_STAGE3_VISUAL_EVIDENCE: "true" })), false);
  });
});

describe("Stage 3 run-scoped activation", () => {
  it("requires run opt-in; global env=true alone does not enable", () => {
    assert.equal(isStage3VisualEvidenceEnabledForRun({
      run: { id: "r1", project_id: "p1", analysis_scope: {} },
      env: envMap({ ANALYZER_STAGE3_VISUAL_EVIDENCE: "true" }),
    }), false);
    assert.equal(isStage3VisualEvidenceEnabledForRun({
      run: optedInRun,
      env: envMap({}),
    }), true);
    assert.equal(isStage3VisualEvidenceEnabledForRun({
      run: optedInRun,
      env: envMap({ ANALYZER_STAGE3_VISUAL_EVIDENCE: "true" }),
    }), true);
  });

  it("honors emergency kill-switch even when the run opted in", () => {
    assert.equal(isStage3VisualEvidenceGloballyBlocked(envMap({ ANALYZER_STAGE3_VISUAL_EVIDENCE: "false" })), true);
    assert.equal(isStage3VisualEvidenceEnabledForRun({
      run: optedInRun,
      env: envMap({ ANALYZER_STAGE3_VISUAL_EVIDENCE: "false" }),
    }), false);
  });

  it("rejects mismatched job/run authorization", () => {
    assert.equal(isStage3VisualEvidenceRunAuthorized(optedInRun), true);
    assert.equal(assertStage3RunJobAuthorization({
      run: optedInRun,
      job: { run_id: optedInRun.id, project_id: optedInRun.project_id },
    }), true);
    assert.equal(isStage3VisualEvidenceEnabledForRun({
      run: optedInRun,
      job: { run_id: "cccccccc-cccc-cccc-cccc-cccccccccccc", project_id: optedInRun.project_id },
    }), false);
    assert.equal(isStage3VisualEvidenceEnabledForRun({
      run: optedInRun,
      job: { run_id: optedInRun.id, project_id: "dddddddd-dddd-dddd-dddd-dddddddddddd" },
    }), false);
  });

  it("merges run opt-in without dropping analysis_scope fields", () => {
    const merged = withStage3VisualEvidenceRunOptIn({ promptScope: "x", mode: "both" }, true);
    assert.equal(merged.stage3VisualEvidence, true);
    assert.equal(merged.promptScope, "x");
    const cleared = withStage3VisualEvidenceRunOptIn(merged, false);
    assert.equal("stage3VisualEvidence" in cleared, false);
    assert.equal(cleared.promptScope, "x");
  });
});

describe("Stage 3 retrieveStage3VisualEvidence fail-open", () => {
  it("returns disabled without loading when flag off", async () => {
    let called = false;
    const result = await retrieveStage3VisualEvidence({
      enabled: false,
      fileName: "A-3.06-00.pdf",
      deps: {
        loadCompletedPacks: async () => {
          called = true;
          return [];
        },
      },
    });
    assert.equal(result.status, "disabled");
    assert.equal(result.promptBlock, "");
    assert.equal(called, false);
  });

  it("fail-opens when loader missing (Mac offline / Edge without bridge)", async () => {
    const result = await retrieveStage3VisualEvidence({
      enabled: true,
      fileName: "A-3.06-00.pdf",
      contentSha256: "abc",
      deps: {},
    });
    assert.equal(result.status, "missing");
    assert.equal(result.workerOfflineOrMissing, true);
    assert.equal(result.promptBlock, "");
    assert.match(result.notes.join(" "), /no pack loader|fail-open/i);
  });

  it("fail-opens when loader throws", async () => {
    const result = await retrieveStage3VisualEvidence({
      enabled: true,
      fileName: "A-6.00-00.pdf",
      deps: {
        loadCompletedPacks: async () => {
          throw new Error("disk unavailable");
        },
      },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.promptBlock, "");
    assert.match(result.notes.join(" "), /failed open/i);
  });

  it("ignores stale packs and continues without prompt injection", async () => {
    const result = await retrieveStage3VisualEvidence({
      enabled: true,
      fileName: "A-3.06-00.pdf",
      contentSha256: "c20",
      deps: {
        loadCompletedPacks: async () => [{
          id: "stale.pack",
          sheetId: "A-3.06",
          topic: "guardrail_detail_height",
          status: "stale",
          promptBlock: "should not inject",
          independentlyVerified: false,
        }],
      },
    });
    assert.equal(result.status, "stale");
    assert.equal(result.promptBlock, "");
  });

  it("injects recovered pack into merged user prompt with IV=false", async () => {
    const packPrompt = [
      "Stage 3 targeted visual evidence pack (machine-extracted; independentlyVerified=false):",
      "detailIdentifier: GUARD RAIL ELEVATION DETAIL @ HIGH ROOF",
      "excerpts: 3'-6\" MIN HEIGHT",
    ].join("\n");
    const result = await retrieveStage3VisualEvidence({
      enabled: true,
      fileName: "A-3.06-00.pdf",
      contentSha256: "c20cc018310747ea435c888f7c1b1d4884ef8d1054b16da9ab770a504a33b6cf",
      deps: {
        loadCompletedPacks: async () => [{
          id: "A-3.06.guardrail",
          sheetId: "A-3.06",
          topic: "guardrail_detail_height",
          status: "evidence_recovered",
          promptBlock: packPrompt,
          detailIdentifier: "GUARD RAIL ELEVATION DETAIL @ HIGH ROOF",
          sourceFileSha256: "c20cc018310747ea435c888f7c1b1d4884ef8d1054b16da9ab770a504a33b6cf",
          independentlyVerified: false,
          provenance: {
            method: "stage3_guardrail_detail_association",
            independentlyVerified: false,
            extractionMethod: "macos-vision",
          },
        }],
      },
    });
    assert.equal(result.status, "recovered");
    assert.match(result.promptBlock, /independentlyVerified=false/);
    assert.match(result.promptBlock, /3'-6" MIN HEIGHT/);
    assert.equal(result.packs[0]?.independentlyVerified, false);

    const merged = mergeVisualEvidencePromptBlocks("Stage 1–2 text pack", result.promptBlock);
    const userPrompt = buildAnalyzerUserPrompt("A-3.06-00.pdf", [{
      fileName: "A-3.06-00.pdf",
      detectedSheetNumber: "A-3.06",
    }], {
      visualEvidence: merged,
    });
    assert.match(userPrompt, /Stage 1–2 text pack/);
    assert.match(userPrompt, /GUARD RAIL ELEVATION DETAIL/);
    assert.match(userPrompt, /independentlyVerified=false/);

    const meta = stage3VisualEvidenceAuditMetadata(result);
    assert.equal(meta.stage3_visual_evidence_enabled, true);
    assert.equal(meta.stage3_visual_evidence_status, "recovered");
    assert.equal((meta.stage3_visual_evidence_packs as Array<{ independently_verified: boolean }>)[0]
      .independently_verified, false);
  });

  it("builds stable cache keys from sha + method + version", () => {
    const key = stage3CacheKey({
      contentSha256: "abc",
      extractionMethod: "macos-vision",
      extractionVersion: STAGE3_VISUAL_EVIDENCE_VERSION,
    });
    assert.equal(key, `abc.macos-vision.${STAGE3_VISUAL_EVIDENCE_VERSION}`);
  });

  it("format helper returns empty for disabled/empty results", () => {
    assert.equal(formatStage3VisualEvidencePrompt({
      version: STAGE3_VISUAL_EVIDENCE_VERSION,
      enabled: false,
      status: "disabled",
      latencyMs: 0,
      sheetFileName: "x.pdf",
      packs: [],
      promptBlock: "",
      notes: [],
      cacheKey: null,
      workerOfflineOrMissing: false,
    }), "");
  });
});

describe("Stage 3 full-coverage OCR gate", () => {
  it("blocks GPT for incomplete full-coverage runs and fail-opens ordinary runs", () => {
    assert.equal(evaluateStage3OcrRunGate({ analysisScope: {} }).blockGpt, false);
    const blocking = evaluateStage3OcrRunGate({
      analysisScope: mergeStage3FullCoverageRunOptIn({}, true),
      now: Date.now(),
    });
    assert.equal(blocking.blockGpt, true);
    assert.equal(blocking.code, "blocking_incomplete");

    const approved = evaluateStage3OcrRunGate({
      analysisScope: {
        stage3FullCoverageOcr: true,
        stage3OcrPreprocess: { gateMode: "approved_partial", terminal: false },
      },
    });
    assert.equal(approved.blockGpt, false);
    assert.equal(approved.code, "approved_partial");
  });
});

describe("Stage 3 processor wiring (source contract)", () => {
  it("wires processor fail-open Stage 3 retrieval independent of CSR/VE", () => {
    const processor = readFileSync(
      join(__dirname, "../../../supabase/functions/supabase-analyzer-processor/index.ts"),
      "utf8",
    );
    assert.match(processor, /isStage3VisualEvidenceEnabledForRun/);
    assert.match(processor, /analysis_scope/);
    assert.match(processor, /retrieveStage3VisualEvidence/);
    assert.match(processor, /mergeVisualEvidencePromptBlocks/);
    assert.match(processor, /stage3VisualEvidenceAuditMetadata/);
    assert.match(processor, /evaluateStage3OcrRunGate/);
    assert.match(processor, /stage3 visual evidence failed open/);
    assert.match(processor, /Never waits for Mac|never waits for Mac/i);
  });
});
