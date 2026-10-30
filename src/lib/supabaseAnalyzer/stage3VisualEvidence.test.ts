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
  formatStage3VisualEvidencePrompt,
  isStage3VisualEvidenceEnabled,
  mergeVisualEvidencePromptBlocks,
  retrieveStage3VisualEvidence,
  stage3CacheKey,
  stage3VisualEvidenceAuditMetadata,
} from "../../../supabase/functions/_shared/analyzerStage3VisualEvidence.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function envMap(values: Record<string, string | undefined>) {
  return {
    get(key: string) {
      return values[key];
    },
  };
}

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

describe("Stage 3 processor wiring (source contract)", () => {
  it("wires processor fail-open Stage 3 retrieval independent of CSR/VE", () => {
    const processor = readFileSync(
      join(__dirname, "../../../supabase/functions/supabase-analyzer-processor/index.ts"),
      "utf8",
    );
    assert.match(processor, /isStage3VisualEvidenceEnabled/);
    assert.match(processor, /retrieveStage3VisualEvidence/);
    assert.match(processor, /mergeVisualEvidencePromptBlocks/);
    assert.match(processor, /stage3VisualEvidenceAuditMetadata/);
    assert.match(processor, /stage3 visual evidence failed open/);
    assert.match(processor, /Never waits for Mac|never waits for Mac/i);
  });
});
