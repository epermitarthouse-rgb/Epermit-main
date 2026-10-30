import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGE3_VISUAL_EVIDENCE_VERSION,
  isStage3VisualEvidenceEnabled,
  mergeVisualEvidencePromptBlocks,
  retrieveStage3VisualEvidence,
} from "../../../supabase/functions/_shared/analyzerStage3VisualEvidence.ts";
import {
  STAGE3_EVIDENCE_BUCKET,
  STAGE3_PACK_MAX_BYTES,
  assertStage3PathTenant,
  buildStage3EvidenceObjectPath,
  createMemoryStage3Storage,
  createStage3StoragePackLoader,
  parseAnalyzerDrawingObjectPath,
  parseStage3PackBytes,
  serializeStage3PackForUpload,
  sha256Hex,
  validateAndNormalizeStage3Pack,
} from "../../../supabase/functions/_shared/analyzerStage3StorageBridge.ts";
import { buildAnalyzerUserPrompt } from "../../../supabase/functions/_shared/analyzerFindingQuality.ts";
import { isVisualEvidenceEnabled } from "../../../supabase/functions/_shared/analyzerVisualEvidence.ts";
import { isCrossSheetRetrievalEnabled } from "../../../supabase/functions/_shared/analyzerCrossSheetRetrieval.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetOut = join(__dirname, "../../../eval/drawing-dataset/out/mcd-649fdaa6");
const workerPacks = join(datasetOut, "stage3-mac-worker/packs");

const PROJECT = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const JOB_A306 = "33333333-3333-4333-8333-333333333333";
const JOB_A600 = "44444444-4444-4444-8444-444444444444";
const JOB_FP200 = "55555555-5555-4555-8555-555555555555";

const SHA = {
  "A-3.06": "c20cc018310747ea435c888f7c1b1d4884ef8d1054b16da9ab770a504a33b6cf",
  "A-6.00": "28369090ce34e1d503f9364bc293f9be51ff37bb521dd50a86968b472411c56d",
  FP200: "983bbfcf38083ff04c7b5c93092f2267f3d5776a01f92ff71411460107127dea",
};

function loadLocalPack(sheetId: string) {
  const path = join(workerPacks, `${sheetId}.${SHA[sheetId as keyof typeof SHA]}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Stage 3 Storage bridge pathing & isolation", () => {
  it("parses drawing object paths and builds tenant-scoped pack paths", () => {
    const parsed = parseAnalyzerDrawingObjectPath(`${PROJECT}/${RUN}/${JOB_A306}.pdf`);
    assert.deepEqual(parsed, { projectId: PROJECT, runId: RUN, sheetJobId: JOB_A306 });
    const objectPath = buildStage3EvidenceObjectPath({
      projectId: PROJECT,
      runId: RUN,
      sheetJobId: JOB_A306,
      contentSha256: SHA["A-3.06"],
    });
    assert.match(objectPath, new RegExp(`^${PROJECT}/${RUN}/${JOB_A306}/`));
    assert.ok(objectPath.endsWith(".json"));
    assert.ok(assertStage3PathTenant(objectPath, { projectId: PROJECT, runId: RUN, sheetJobId: JOB_A306 }));
    assert.equal(
      assertStage3PathTenant(objectPath, { projectId: PROJECT, runId: RUN, sheetJobId: JOB_A600 }),
      false,
    );
  });

  it("rejects cross-tenant path retrieval", async () => {
    const memory = createMemoryStage3Storage();
    const pack = loadLocalPack("A-3.06");
    assert.ok(pack, "local A-3.06 pack required from Mac worker pilot");
    const goodPath = buildStage3EvidenceObjectPath({
      projectId: PROJECT,
      runId: RUN,
      sheetJobId: JOB_A306,
      contentSha256: SHA["A-3.06"],
    });
    memory.upload(goodPath, serializeStage3PackForUpload(pack));

    const wrongTenantLoader = createStage3StoragePackLoader({
      identity: {
        projectId: "99999999-9999-4999-8999-999999999999",
        runId: RUN,
        sheetJobId: JOB_A306,
        contentSha256: SHA["A-3.06"],
      },
      storage: memory,
    });
    const packs = await wrongTenantLoader({ fileName: "A-3.06-00.pdf" });
    assert.deepEqual(packs, []);
  });
});

describe("Stage 3 pack validation", () => {
  it("accepts pilot packs and forces independentlyVerified=false", () => {
    for (const sheetId of ["A-3.06", "A-6.00", "FP200"] as const) {
      const raw = loadLocalPack(sheetId);
      assert.ok(raw, `missing pack ${sheetId}`);
      const validated = validateAndNormalizeStage3Pack(raw, {
        contentSha256: SHA[sheetId],
      });
      assert.equal(validated.ok, true, sheetId);
      if (validated.ok) {
        assert.equal(validated.pack.independentlyVerified, false);
        assert.equal(validated.pack.provenance?.independentlyVerified, false);
      }
    }
  });

  it("rejects sha mismatch, version mismatch, verified claim, malformed, oversized", () => {
    const base = loadLocalPack("A-3.06");
    assert.ok(base);

    const sha = validateAndNormalizeStage3Pack({ ...base, sourceFileSha256: "deadbeef" }, {
      contentSha256: SHA["A-3.06"],
    });
    assert.equal(sha.ok, false);
    if (!sha.ok) assert.equal(sha.issue, "sha_mismatch");

    const version = validateAndNormalizeStage3Pack({
      ...base,
      extractionVersion: "old.version",
    }, { contentSha256: SHA["A-3.06"] });
    assert.equal(version.ok, false);
    if (!version.ok) assert.equal(version.issue, "version_mismatch");

    const verified = validateAndNormalizeStage3Pack({
      ...base,
      independentlyVerified: true,
    }, { contentSha256: SHA["A-3.06"] });
    assert.equal(verified.ok, false);
    if (!verified.ok) assert.equal(verified.issue, "verified_claim");

    const malformed = parseStage3PackBytes(new TextEncoder().encode("{not-json"), {
      contentSha256: SHA["A-3.06"],
    });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.issue, "malformed_json");

    const oversized = parseStage3PackBytes(new Uint8Array(STAGE3_PACK_MAX_BYTES + 10), {
      contentSha256: SHA["A-3.06"],
    });
    assert.equal(oversized.ok, false);
    if (!oversized.ok) assert.equal(oversized.issue, "oversized");
  });
});

describe("Stage 3 Storage upload → processor retrieve (mock)", () => {
  it("A-3.06 / A-6.00 / FP200: upload, retrieve, inject; isolation & fail-open", async () => {
    const memory = createMemoryStage3Storage();
    assert.equal(memory.bucket, STAGE3_EVIDENCE_BUCKET);

    const jobs = [
      { sheetId: "A-3.06" as const, jobId: JOB_A306, fileName: "A-3.06-00.pdf" },
      { sheetId: "A-6.00" as const, jobId: JOB_A600, fileName: "A-6.00-00.pdf" },
      { sheetId: "FP200" as const, jobId: JOB_FP200, fileName: "FP200 .pdf" },
    ];

    for (const job of jobs) {
      const pack = loadLocalPack(job.sheetId);
      assert.ok(pack, job.sheetId);
      const objectPath = buildStage3EvidenceObjectPath({
        projectId: PROJECT,
        runId: RUN,
        sheetJobId: job.jobId,
        contentSha256: SHA[job.sheetId],
      });
      memory.upload(objectPath, serializeStage3PackForUpload(pack));
    }

    // Duplicate upload overwrites same key (cache behavior)
    const a306 = loadLocalPack("A-3.06")!;
    const a306Path = buildStage3EvidenceObjectPath({
      projectId: PROJECT,
      runId: RUN,
      sheetJobId: JOB_A306,
      contentSha256: SHA["A-3.06"],
    });
    memory.upload(a306Path, serializeStage3PackForUpload(a306));
    assert.equal(memory.objects.size, 3);

    // A-3.06 retrieve + inject
    const resultA306 = await retrieveStage3VisualEvidence({
      enabled: true,
      fileName: "A-3.06-00.pdf",
      contentSha256: SHA["A-3.06"],
      projectId: PROJECT,
      runId: RUN,
      sheetJobId: JOB_A306,
      deps: {
        loadCompletedPacks: createStage3StoragePackLoader({
          identity: {
            projectId: PROJECT,
            runId: RUN,
            sheetJobId: JOB_A306,
            contentSha256: SHA["A-3.06"],
          },
          storage: memory,
        }),
      },
    });
    assert.equal(resultA306.status, "recovered");
    assert.match(resultA306.promptBlock, /3\s*['′]\s*-?\s*6/);
    assert.match(resultA306.promptBlock, /GUARD\s*RAIL/i);
    assert.equal(resultA306.packs[0]?.independentlyVerified, false);
    assert.match(String(resultA306.packs[0]?.detailIdentifier || ""), /GUARD\s*RAIL/i);
    assert.equal(resultA306.packs[0]?.assessment?.status, "associated_to_guardrail_detail");

    const userPrompt = buildAnalyzerUserPrompt("A-3.06-00.pdf", [{
      fileName: "A-3.06-00.pdf",
      detectedSheetNumber: "A-3.06",
    }], {
      visualEvidence: mergeVisualEvidencePromptBlocks(null, resultA306.promptBlock),
    });
    assert.match(userPrompt, /independentlyVerified=false/);
    assert.match(userPrompt, /GUARD RAIL/);

    // A-6.00 schedule rows
    const resultA600 = await retrieveStage3VisualEvidence({
      enabled: true,
      fileName: "A-6.00-00.pdf",
      contentSha256: SHA["A-6.00"],
      deps: {
        loadCompletedPacks: createStage3StoragePackLoader({
          identity: {
            projectId: PROJECT,
            runId: RUN,
            sheetJobId: JOB_A600,
            contentSha256: SHA["A-6.00"],
          },
          storage: memory,
        }),
      },
    });
    assert.equal(resultA600.status, "recovered");
    assert.match(resultA600.promptBlock, /DOOR\s+SCHEDULE/i);
    assert.ok((resultA600.packs[0]?.assessment as { present?: { lockingHardware?: boolean } })
      ?.present?.lockingHardware !== undefined
      || /hardware|panic|lock/i.test(resultA600.promptBlock));

    // FP200 hydraulic regression
    const resultFp = await retrieveStage3VisualEvidence({
      enabled: true,
      fileName: "FP200 .pdf",
      contentSha256: SHA.FP200,
      deps: {
        loadCompletedPacks: createStage3StoragePackLoader({
          identity: {
            projectId: PROJECT,
            runId: RUN,
            sheetJobId: JOB_FP200,
            contentSha256: SHA.FP200,
          },
          storage: memory,
        }),
      },
    });
    assert.equal(resultFp.status, "recovered");
    assert.match(resultFp.promptBlock, /HYDRAULIC|density|flowDemand/i);
    assert.equal(resultFp.packs[0]?.independentlyVerified, false);

    // SHA mismatch → stale / not injected
    const stale = await retrieveStage3VisualEvidence({
      enabled: true,
      fileName: "A-3.06-00.pdf",
      contentSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      deps: {
        loadCompletedPacks: createStage3StoragePackLoader({
          identity: {
            projectId: PROJECT,
            runId: RUN,
            sheetJobId: JOB_A306,
            contentSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
          storage: memory,
        }),
      },
    });
    assert.equal(stale.promptBlock, "");
    assert.ok(stale.status === "missing" || stale.status === "stale");

    // Missing pack fail-open
    const missing = await retrieveStage3VisualEvidence({
      enabled: true,
      fileName: "missing.pdf",
      contentSha256: SHA["A-3.06"],
      deps: {
        loadCompletedPacks: createStage3StoragePackLoader({
          identity: {
            projectId: PROJECT,
            runId: RUN,
            sheetJobId: "66666666-6666-4666-8666-666666666666",
            contentSha256: SHA["A-3.06"],
          },
          storage: memory,
        }),
      },
    });
    assert.equal(missing.status, "missing");
    assert.equal(missing.promptBlock, "");

    // Flag OFF identical baseline
    assert.equal(isStage3VisualEvidenceEnabled({ get: () => undefined }), false);
    const off = await retrieveStage3VisualEvidence({
      enabled: false,
      fileName: "A-3.06-00.pdf",
      deps: {
        loadCompletedPacks: async () => {
          throw new Error("should not load when disabled");
        },
      },
    });
    assert.equal(off.status, "disabled");
    assert.equal(off.promptBlock, "");
    assert.equal(isVisualEvidenceEnabled({ get: () => undefined }), false);
    assert.equal(isCrossSheetRetrievalEnabled({ get: () => undefined }), false);

    // Wrong bucket name rejected by processor-style download guard (loader only uses STAGE3 bucket)
    const wrongBucket = await memory.download("supabase-analyzer-drawings", a306Path);
    assert.equal(wrongBucket, null);
  });

  it("sha256Hex is stable for known bytes", async () => {
    const hex = await sha256Hex(new TextEncoder().encode("permitpilot"));
    assert.equal(hex.length, 64);
  });

  it("processor wires Storage bridge loader (source contract)", () => {
    const processor = readFileSync(
      join(__dirname, "../../../supabase/functions/supabase-analyzer-processor/index.ts"),
      "utf8",
    );
    assert.match(processor, /createStage3StoragePackLoader/);
    assert.match(processor, /STAGE3_EVIDENCE_BUCKET/);
    assert.match(processor, /sha256Hex\(bytes\)/);
    assert.match(processor, /bucket !== STAGE3_EVIDENCE_BUCKET/);
    assert.match(processor, /isStage3VisualEvidenceEnabledForRun/);
  });

  it("documents bucket migration path (apply only after security gate)", () => {
    const proposed = readFileSync(
      join(__dirname, "../../../eval/drawing-dataset/PROPOSED_stage3_evidence_storage_bucket.sql"),
      "utf8",
    );
    const migration = readFileSync(
      join(__dirname, "../../../supabase/migrations/20261031040000_supabase_analyzer_stage3_evidence_bucket.sql"),
      "utf8",
    );
    assert.match(proposed, /SUPERSEDED by migration|20261031040000_supabase_analyzer_stage3_evidence_bucket/);
    assert.match(migration, /supabase-analyzer-stage3-evidence/);
    assert.match(migration, /application\/json/);
    assert.match(migration, /public = false/);
    assert.equal(STAGE3_VISUAL_EVIDENCE_VERSION.includes("stage3"), true);
  });
});
