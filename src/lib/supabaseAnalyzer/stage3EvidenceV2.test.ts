import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGE3_V2_PROMPT_HEADER,
  STAGE3_VISUAL_EVIDENCE_V2_BOUNDS,
  STAGE3_VISUAL_EVIDENCE_V2_VERSION,
  STAGE3_VISUAL_EVIDENCE_VERSION,
  formatStage3VisualEvidencePrompt,
  resolveStage3EvidenceVersion,
  retrieveStage3VisualEvidence,
  stage3VisualEvidenceAuditMetadata,
  type Stage3EvidencePack,
  type Stage3VisualEvidenceResult,
} from "../../../supabase/functions/_shared/analyzerStage3VisualEvidence.ts";
import {
  buildStage3EvidenceObjectPath,
  createMemoryStage3Storage,
  createStage3StoragePackLoader,
  resolveStage3UploadVersion,
  serializeStage3PackForUpload,
  validateAndNormalizeStage3Pack,
} from "../../../supabase/functions/_shared/analyzerStage3StorageBridge.ts";
// @ts-expect-error — plain .mjs harness module without type declarations
import { V2_ANALYZER_HEADER } from "../../../eval/drawing-dataset/lib/stage3EvidenceEval.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHA = "ab".repeat(32);
const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  sheetJobId: "33333333-3333-4333-8333-333333333333",
  contentSha256: SHA,
};

const v1Pack: Stage3EvidencePack = {
  id: "A-3.06.guardrail",
  sheetId: "A-3.06",
  topic: "guardrail",
  status: "evidence_recovered",
  promptBlock: "Stage 3 pack A-3.06 guardrail\nexcerpts: 3'-6\" MIN HEIGHT",
  sourceFileSha256: SHA,
  extractionVersion: STAGE3_VISUAL_EVIDENCE_VERSION,
  provenance: { extractionMethod: "macos-vision" },
};

const v2Pack: Stage3EvidencePack = {
  id: "A-3.06.technical_digest.abc",
  sheetId: "A-3.06",
  topic: "technical_digest",
  status: "evidence_recovered",
  promptBlock: "Stage3 OCR evidence v2 sheet=A-3.06 shown=1\n- 3'-6\"MIN HEIGHT FROM / T.O. ROOF DECK MEMBRANE\nomitted: none",
  sourceFileSha256: SHA,
  extractionVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION,
  provenance: { extractionMethod: "macos-vision", method: "stage3_v2_annotation_digest" },
  digest: { shown: ["a001"], omitted: [], chars: 120, maxChars: 2600 },
  evidenceModel: { scope: "shown", rows: [], annotations: [] },
};

const base = { enabled: true, fileName: "A-3.06-00.pdf", contentSha256: SHA };

describe("Stage 3 v2 version resolution (run-scoped)", () => {
  it("defaults to v1 and accepts only registered versions", () => {
    assert.equal(resolveStage3EvidenceVersion({ analysis_scope: {} }).version, STAGE3_VISUAL_EVIDENCE_VERSION);
    assert.equal(resolveStage3EvidenceVersion(null).version, STAGE3_VISUAL_EVIDENCE_VERSION);
    assert.equal(resolveStage3EvidenceVersion({ analysis_scope: { stage3EvidenceVersion: "v2" } }).version, STAGE3_VISUAL_EVIDENCE_V2_VERSION);
    assert.equal(
      resolveStage3EvidenceVersion({ analysis_scope: { stage3EvidenceVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION } }).version,
      STAGE3_VISUAL_EVIDENCE_V2_VERSION,
    );
    const unknown = resolveStage3EvidenceVersion({ analysis_scope: { stage3EvidenceVersion: "v9" } });
    assert.equal(unknown.version, STAGE3_VISUAL_EVIDENCE_VERSION);
    assert.equal(unknown.invalid, true);
  });
});

describe("Stage 3 v1 behaviour unchanged when v2 is not requested", () => {
  it("produces the same result, prompt and audit metadata as before", async () => {
    const deps = { loadCompletedPacks: async () => [v1Pack], loadCompletedV2Packs: async () => [v2Pack], now: () => 0 };
    const plain = await retrieveStage3VisualEvidence({ ...base, deps });
    const explicitV1 = await retrieveStage3VisualEvidence({ ...base, deps, evidenceVersion: STAGE3_VISUAL_EVIDENCE_VERSION });
    assert.deepEqual(explicitV1, plain);
    assert.equal(plain.version, STAGE3_VISUAL_EVIDENCE_VERSION);
    assert.equal("requestedVersion" in plain, false);
    assert.match(plain.promptBlock, /^Stage 3 Apple Vision OCR evidence \(machine-extracted/);
    assert.doesNotMatch(plain.promptBlock, /Reading rules/);
    const audit = stage3VisualEvidenceAuditMetadata(plain);
    assert.equal(Object.keys(audit).some((key) => key.startsWith("stage3_evidence_")), false);
  });
});

describe("Stage 3 v2 retrieval and fallback", () => {
  it("delivers the v2 block when the v2 pack is available", async () => {
    const result = await retrieveStage3VisualEvidence({
      ...base,
      evidenceVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION,
      deps: { loadCompletedPacks: async () => [v1Pack], loadCompletedV2Packs: async () => [v2Pack], now: () => 0 },
    });
    assert.equal(result.version, STAGE3_VISUAL_EVIDENCE_V2_VERSION);
    assert.equal(result.fallbackReason, null);
    assert.ok(result.promptBlock.startsWith(STAGE3_V2_PROMPT_HEADER.join("\n")));
    assert.match(result.promptBlock, /T\.O\. ROOF DECK MEMBRANE/);
    assert.doesNotMatch(result.promptBlock, /excerpts:/);
    assert.equal(result.packs[0].independentlyVerified, false);
    const audit = stage3VisualEvidenceAuditMetadata(result);
    assert.equal(audit.stage3_evidence_requested_version, STAGE3_VISUAL_EVIDENCE_V2_VERSION);
    assert.equal(audit.stage3_evidence_fallback_reason, null);
    assert.deepEqual(audit.stage3_evidence_digest, [{ shown: 1, omitted: 0, chars: 120, max_chars: 2600 }]);
  });

  const cases: Array<[string, Record<string, unknown>, RegExp, string]> = [
    ["missing v2 pack → v1", { loadCompletedPacks: async () => [v1Pack], loadCompletedV2Packs: async () => [] }, /^v2_pack_missing->v1$/, STAGE3_VISUAL_EVIDENCE_VERSION],
    ["no v2 loader → v1", { loadCompletedPacks: async () => [v1Pack] }, /^v2_loader_missing->v1$/, STAGE3_VISUAL_EVIDENCE_VERSION],
    ["v2 loader throws → v1", { loadCompletedPacks: async () => [v1Pack], loadCompletedV2Packs: async () => { throw new Error("boom"); } }, /^v2_load_failed:boom->v1$/, STAGE3_VISUAL_EVIDENCE_VERSION],
    ["stale v2 pack → v1", { loadCompletedPacks: async () => [v1Pack], loadCompletedV2Packs: async () => [{ ...v2Pack, status: "stale" }] }, /^v2_pack_stale->v1$/, STAGE3_VISUAL_EVIDENCE_VERSION],
    ["v1-versioned pack from v2 loader → v1", { loadCompletedPacks: async () => [v1Pack], loadCompletedV2Packs: async () => [v1Pack] }, /^v2_pack_recovered->v1$/, STAGE3_VISUAL_EVIDENCE_VERSION],
    ["nothing → PDF only", { loadCompletedPacks: async () => [], loadCompletedV2Packs: async () => [] }, /^v2_pack_missing->pdf_only$/, STAGE3_VISUAL_EVIDENCE_VERSION],
  ];
  for (const [name, deps, reason, version] of cases) {
    it(name, async () => {
      const result = await retrieveStage3VisualEvidence({
        ...base,
        evidenceVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION,
        deps: { ...deps, now: () => 0 },
      });
      assert.equal(result.version, version);
      assert.equal(result.requestedVersion, STAGE3_VISUAL_EVIDENCE_V2_VERSION);
      assert.match(String(result.fallbackReason), reason);
      assert.match(result.notes[0], /Stage 3 v2 evidence unavailable/);
      if (result.packs.length) {
        assert.match(result.promptBlock, /stage3_notes: Stage 3 v2 evidence unavailable/);
        assert.doesNotMatch(result.promptBlock, /Reading rules/);
      } else {
        assert.equal(result.promptBlock, "");
      }
      const audit = stage3VisualEvidenceAuditMetadata(result);
      assert.match(String(audit.stage3_evidence_fallback_reason), reason);
    });
  }
});

describe("Stage 3 v2 block format parity with the harness", () => {
  it("uses the same header as the mjs mirror", () => {
    assert.deepEqual([...STAGE3_V2_PROMPT_HEADER], V2_ANALYZER_HEADER);
  });

  it("reproduces every fixture block exactly", () => {
    const fixture = JSON.parse(readFileSync(
      join(__dirname, "../../../eval/drawing-dataset/tests/fixtures/stage3-v2-block.fixture.json"),
      "utf8",
    ));
    for (const c of fixture.cases) {
      const result: Stage3VisualEvidenceResult = {
        version: STAGE3_VISUAL_EVIDENCE_V2_VERSION,
        enabled: true,
        status: c.status,
        latencyMs: 0,
        sheetFileName: "T-1.pdf",
        packs: c.packs,
        promptBlock: "",
        notes: c.notes,
        cacheKey: null,
        workerOfflineOrMissing: false,
      };
      const block = formatStage3VisualEvidencePrompt(result);
      assert.equal(block, c.expected, c.name);
      assert.ok(block.length <= STAGE3_VISUAL_EVIDENCE_V2_BOUNDS.maxTotalChars, c.name);
    }
  });
});

describe("Stage 3 v2 storage bridge", () => {
  it("allowlists upload versions and paths v2 separately from v1", () => {
    assert.equal(resolveStage3UploadVersion(STAGE3_VISUAL_EVIDENCE_V2_VERSION), STAGE3_VISUAL_EVIDENCE_V2_VERSION);
    assert.equal(resolveStage3UploadVersion("phase3.stage3-visual-evidence.v9"), STAGE3_VISUAL_EVIDENCE_VERSION);
    assert.equal(resolveStage3UploadVersion(undefined), STAGE3_VISUAL_EVIDENCE_VERSION);
    const v1Path = buildStage3EvidenceObjectPath(identity);
    const v2Path = buildStage3EvidenceObjectPath({ ...identity, extractionVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION });
    assert.notEqual(v1Path, v2Path);
    assert.match(v2Path, /\.v2\.json$/);
  });

  it("keeps digest and evidence model for v2 packs only", () => {
    const v2 = validateAndNormalizeStage3Pack(v2Pack, { contentSha256: SHA, extractionVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION });
    assert.ok(v2.ok);
    if (v2.ok) {
      assert.deepEqual(v2.pack.digest, v2Pack.digest);
      assert.deepEqual(v2.pack.evidenceModel, v2Pack.evidenceModel);
    }
    const v1 = validateAndNormalizeStage3Pack({ ...v1Pack, digest: { shown: [] } }, { contentSha256: SHA });
    assert.ok(v1.ok);
    if (v1.ok) {
      assert.equal("digest" in v1.pack, false);
      assert.equal("evidenceModel" in v1.pack, false);
    }
    const wrong = validateAndNormalizeStage3Pack(v2Pack, { contentSha256: SHA });
    assert.equal(wrong.ok, false);
  });

  it("round-trips a v2 pack through storage to the v2 loader", async () => {
    const storage = createMemoryStage3Storage();
    const v2Identity = { ...identity, extractionVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION };
    storage.upload(buildStage3EvidenceObjectPath(v2Identity), serializeStage3PackForUpload(v2Pack));
    storage.upload(buildStage3EvidenceObjectPath(identity), serializeStage3PackForUpload(v1Pack));
    const result = await retrieveStage3VisualEvidence({
      ...base,
      evidenceVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION,
      deps: {
        loadCompletedPacks: createStage3StoragePackLoader({ identity, storage }),
        loadCompletedV2Packs: createStage3StoragePackLoader({ identity: v2Identity, storage }),
        now: () => 0,
      },
    });
    assert.equal(result.version, STAGE3_VISUAL_EVIDENCE_V2_VERSION);
    assert.equal(result.packs[0].id, v2Pack.id);
    assert.deepEqual(result.packs[0].digest, v2Pack.digest);
  });
});

describe("Stage 3 v2 processor and Edge wiring (source contract)", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../../../supabase/functions", p), "utf8");
  it("processor resolves the run version and only builds a v2 loader for v2 runs", () => {
    const processor = read("supabase-analyzer-processor/index.ts");
    assert.match(processor, /resolveStage3EvidenceVersion\(\{ analysis_scope: run\.analysis_scope \}\)/);
    assert.match(processor, /stage3V2\s*\?\s*\{\s*loadCompletedV2Packs/);
    assert.match(processor, /\.\.\.\(stage3V2 \? \{ evidenceVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION \} : \{\}\)/);
  });
  it("Edge upload derives the version from an allowlist for upload and verify", () => {
    const edge = read("supabase-analyzer-stage3-evidence/index.ts");
    assert.match(edge, /resolveStage3UploadVersion\(body\.pack\.extractionVersion\)/);
    assert.match(edge, /resolveStage3UploadVersion\(body\.extractionVersion\)/);
    assert.match(edge, /extraction_version: uploadVersion/);
    assert.doesNotMatch(edge, /extractionVersion: STAGE3_VISUAL_EVIDENCE_VERSION,\n\s*\}\);/);
  });
});
