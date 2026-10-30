import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSupabaseStage3StorageFromEnv,
  createStage3EdgeUploadAdapterFromEnv,
  uploadStage3PackViaEdge,
} from "../lib/stage3StorageUpload.mjs";

const pack = {
  id: "t.pack",
  sheetId: "A-3.06",
  topic: "guardrail_detail_height",
  status: "evidence_recovered",
  promptBlock: "test",
  sourceFileSha256: "c".repeat(64),
  independentlyVerified: false,
};

describe("Stage 3 Mac upload auth fail-closed", () => {
  it("removes service-role env factory", () => {
    assert.throws(
      () => createSupabaseStage3StorageFromEnv(),
      /fail_closed|removed/i,
    );
  });

  it("refuses upload without STAGE3_WORKER_UPLOAD_TOKEN even if service-role present", async () => {
    const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value-not-real";
    delete process.env.STAGE3_WORKER_UPLOAD_TOKEN;
    try {
      await assert.rejects(
        () => uploadStage3PackViaEdge({
          pack,
          projectId: "11111111-1111-4111-8111-111111111111",
          runId: "22222222-2222-4222-8222-222222222222",
          sheetJobId: "33333333-3333-4333-8333-333333333333",
          contentSha256: "c".repeat(64),
          supabaseUrl: "https://example.supabase.co",
          workerToken: "",
          fetchImpl: async () => {
            throw new Error("should not fetch");
          },
        }),
        /fail_closed|STAGE3_WORKER_UPLOAD_TOKEN/,
      );
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
    }
  });

  it("adapter rejects worker token equal to service-role", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "same-secret";
    assert.throws(
      () => createStage3EdgeUploadAdapterFromEnv({
        supabaseUrl: "https://example.supabase.co",
        workerToken: "same-secret",
      }),
      /must not be the service-role/,
    );
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("Edge upload posts to function with worker bearer (mock fetch)", async () => {
    let saw = null;
    const result = await uploadStage3PackViaEdge({
      pack,
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      sheetJobId: "33333333-3333-4333-8333-333333333333",
      contentSha256: "c".repeat(64),
      supabaseUrl: "https://example.supabase.co",
      workerToken: "worker-token-test",
      anonKey: "anon-test",
      fetchImpl: async (url, init) => {
        saw = { url, init };
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              ok: true,
              bucket: "supabase-analyzer-stage3-evidence",
              objectPath: "p/r/j/pack.json",
              bytes: 12,
              authMode: "worker_token",
              publicUrl: null,
            });
          },
        };
      },
    });
    assert.match(saw.url, /\/functions\/v1\/supabase-analyzer-stage3-evidence$/);
    assert.equal(saw.init.headers.Authorization, "Bearer worker-token-test");
    assert.equal(result.publicUrl, null);
    assert.equal(result.independentlyVerified, false);
  });
});
