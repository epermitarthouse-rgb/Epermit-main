"use strict";

/**
 * Permit Queue (JSON pass) and the deep/manual pass share one downstream entry after review comments exist:
 * permit-comment-pipeline central_sweep for every permit, and the project sweep only when a project is linked.
 * Nothing here calls a model or a portal.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createDeepPass, continuePermitDownstream } = require("../permit-sync/deep/runner");
const { createCommentPipelineDispatcher } = require("../permit-sync/deep/commentDispatch");
const policy = require("../permit-sync/deep/policy");

const PERMIT = "11111111-1111-4111-8111-111111111111";
const LINKED_PERMIT = "44444444-4444-4444-8444-444444444444";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

function recordingFetch(calls) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (body.action === "central_sweep") {
      return { ok: true, status: 202, text: async () => JSON.stringify({ accepted: true, action: "central_sweep" }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ claimed: 1 }) };
  };
}

function dispatcher(calls) {
  return createCommentPipelineDispatcher({
    fetch: recordingFetch(calls),
    supabaseUrl: "https://example.invalid",
    serviceRoleKey: "service-key",
    serviceSecret: "secret",
  });
}

function emptyMetrics() {
  return { central_triggers: 0, central_failed: 0, pipeline_runs: 0, pipeline_skipped: 0, pipeline_failed: 0 };
}

test("shared downstream: a permit with no project enters central only; a linked permit also enters the project step", async () => {
  const unlinked = [];
  const m1 = emptyMetrics();
  await continuePermitDownstream({
    pipeline: dispatcher(unlinked),
    permitId: PERMIT,
    links: [],
    metrics: m1,
    record: { portal_record_id: "11105" },
  });
  assert.deepEqual(unlinked.map((c) => c.body), [
    { action: "central_sweep", source: "deep_worker", permit_ids: [PERMIT] },
  ]);
  assert.equal(unlinked[0].url, "https://example.invalid/functions/v1/permit-comment-pipeline");
  assert.equal(m1.central_triggers, 1);
  assert.equal(m1.pipeline_runs, 0);

  const linked = [];
  const m2 = emptyMetrics();
  await continuePermitDownstream({
    pipeline: dispatcher(linked),
    permitId: PERMIT,
    links: [{ projectId: PROJECT, ownerUserId: OWNER, currentHash: null }],
    metrics: m2,
    record: { portal_record_id: "11105" },
  });
  assert.deepEqual(linked.map((c) => c.body), [
    { action: "central_sweep", source: "deep_worker", permit_ids: [PERMIT] },
    { action: "sweep", source: "deep_worker", project_ids: [PROJECT] },
  ]);
  assert.equal(m2.central_triggers, 1);
  assert.equal(m2.pipeline_runs, 1);
});

test("deep pass uses that entry after comments are stored, and does not write portal_data when the link is already current", async () => {
  const section = { info: "abc" };
  const cap = policy.captureHash([], []);
  const syncs = [];
  const calls = [];
  let linked = false;
  const repo = {
    deepState: async () => section,
    links: async () => (linked
      ? [{ projectId: PROJECT, ownerUserId: OWNER, portalDataHash: null, syncedHashes: section, captureHash: cap }]
      : []),
    documents: async () => [],
    reports: async () => [],
    recordDeepPass: async () => {},
    recordReportFailure: async () => {},
    projectHash: async () => { throw new Error("portal_data was read"); },
  };
  const dcDeep = {
    scrapeAll: async () => { throw new Error("deep scrape ran"); },
    syncPortalDataToSupabase: async () => { syncs.push("sync"); return true; },
  };
  const deep = createDeepPass({
    dcDeep, transport: {}, repo, storage: {}, pipeline: dispatcher(calls), username: "acct", trace: () => {}, log: () => {},
  });
  const args = {
    record: { portal_record_id: "11105", fields: { permit_number: "B2407514" } },
    batch: { sections: { info: { hash: "abc", status: "ok" } } },
    result: { permit_id: PERMIT },
    job: { id: "job-1", options: {} },
    event: async () => {},
  };

  const skipped = await deep.afterPermit(args);
  assert.equal(skipped.deep_skipped, 1);
  assert.equal(syncs.length, 0, "no project: no portal_data write");
  assert.deepEqual(calls.map((c) => c.body.action), ["central_sweep"]);
  assert.deepEqual(calls[0].body.permit_ids, [PERMIT]);

  linked = true;
  calls.length = 0;
  const again = await deep.afterPermit(args);
  assert.equal(again.deep_skipped, 1);
  assert.equal(syncs.length, 0, "a current link is not rewritten");
  assert.deepEqual(calls.map((c) => c.body.action), ["central_sweep", "sweep"]);
  assert.deepEqual(calls[1].body.project_ids, [PROJECT]);
});

test("json permit-queue pass calls the same entry and does not start a deep scrape", async () => {
  const prev = process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY;
  process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  try {
    const { encryptPortalPassword } = require("../app/services/portal-credentials/portal-credentials-crypto");
    const entry = require("../permit-sync/worker-entry");
    const password = encryptPortalPassword("s3cret");
    const rows = {
      portal_credentials: { c1: { portal_username: "acct", portal_password: password, login_url: null } },
      permit_sync_sources: { c1: { settings: {} } },
    };
    const supabase = {
      from: (t) => ({ select: () => ({ eq: (_c, id) => ({ single: async () => ({ data: rows[t][id] || null, error: null }) }) }) }),
    };
    const calls = [];
    const repo = {
      links: async (id) => (id === LINKED_PERMIT
        ? [{ projectId: PROJECT, ownerUserId: OWNER, portalDataHash: "hash-1" }]
        : []),
    };
    const touched = [];
    const transport = async () => ({
      close: async () => {},
      scrapeAll: async () => { touched.push("scrape"); },
      syncPortalDataToSupabase: async () => { touched.push("sync"); },
    });
    const open = entry.buildOpenAdapter({
      supabase,
      env: {},
      launchContext: async () => ({}),
      createTransport: transport,
      createMontgomeryTransport: transport,
      lock: async () => {},
      pipeline: dispatcher(calls),
      repo,
    });

    for (const adapterKey of ["dc-projectdox", "montgomery-projectdox"]) {
      calls.length = 0;
      const session = await open({ adapter_key: adapterKey, credential_id: "c1" });
      assert.equal(typeof session.afterPermit, "function", adapterKey);
      const metrics = await session.afterPermit({
        result: { permit_id: PERMIT },
        record: { portal_record_id: "11105" },
        event: async () => {},
      });
      assert.deepEqual(calls.map((c) => c.body), [
        { action: "central_sweep", source: "deep_worker", permit_ids: [PERMIT] },
      ], adapterKey);
      assert.equal(metrics.central_triggers, 1);
      assert.equal(metrics.pipeline_runs, 0);
      assert.deepEqual(touched, [], "json mode does not scrape or write portal_data");
    }

    calls.length = 0;
    const session = await open({ adapter_key: "dc-projectdox", credential_id: "c1" });
    const metrics = await session.afterPermit({
      result: { permit_id: LINKED_PERMIT },
      record: { portal_record_id: "11105" },
      event: async () => {},
    });
    assert.deepEqual(calls.map((c) => c.body.action), ["central_sweep", "sweep"]);
    assert.deepEqual(calls[0].body.permit_ids, [LINKED_PERMIT]);
    assert.deepEqual(calls[1].body.project_ids, [PROJECT]);
    assert.equal(metrics.pipeline_runs, 1);
    assert.deepEqual(touched, []);
  } finally {
    if (prev === undefined) delete process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY = prev;
  }
});
