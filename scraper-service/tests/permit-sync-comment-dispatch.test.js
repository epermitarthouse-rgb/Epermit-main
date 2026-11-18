"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCommentPipelineDispatcher } = require("../permit-sync/deep/commentDispatch");

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

test("hands the project to permit-comment-pipeline with the service bearer only", async () => {
  const calls = [];
  const d = createCommentPipelineDispatcher({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 202, text: async () => JSON.stringify({ claimed: 1, project_ids: ["p1"] }) };
    },
    supabaseUrl: "https://x.invalid/",
    serviceRoleKey: "svc",
    serviceSecret: "s",
  });
  const t = await d.trigger({ projectId: "p1", ownerUserId: "o1", portalDataHash: "h" });
  assert.deepEqual(t, { outcome: "complete", rounds: 1, queued: true });
  assert.equal(calls[0].url, "https://x.invalid/functions/v1/permit-comment-pipeline");
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: "sweep", source: "deep_worker", project_ids: ["p1"] });
  assert.equal(calls[0].init.headers.Authorization, "Bearer svc");
  assert.equal(calls[0].init.headers["x-permitpilot-service-secret"], undefined, "the pipeline secret never leaves the worker");
  assert.ok(!JSON.stringify(calls[0].init.body).includes("h"), "the portal_data hash plays no part");
});

test("nothing new to process reads as a duplicate; refusals and network errors as failures", async () => {
  const base = { supabaseUrl: "u", serviceRoleKey: "k", serviceSecret: "s" };
  assert.equal((await createCommentPipelineDispatcher({ ...base, fetch: reply(200, { claimed: 0 }) }).trigger({ projectId: "p" })).outcome, "skipped_duplicate");
  const refused = await createCommentPipelineDispatcher({ ...base, fetch: reply(503, { error: "Comment processing is not enabled yet." }) }).trigger({ projectId: "p" });
  assert.equal(refused.outcome, "failed");
  assert.match(refused.error, /not enabled/);
  const down = await createCommentPipelineDispatcher({ ...base, fetch: async () => { throw new Error("ECONNREFUSED"); } }).trigger({ projectId: "p" });
  assert.equal(down.outcome, "failed");
});

test("without the service secret the trigger is off and makes no call", async () => {
  let called = false;
  const d = createCommentPipelineDispatcher({ fetch: async () => { called = true; }, supabaseUrl: "u", serviceRoleKey: "k", serviceSecret: "" });
  assert.deepEqual(await d.trigger({ projectId: "p" }), { outcome: "disabled", rounds: 0 });
  assert.deepEqual(await d.triggerCentral({ permitId: "x" }), { outcome: "disabled" });
  assert.equal(called, false);
});

test("central trigger asks for the permit-level pass of one permit; central off reads as disabled", async () => {
  const calls = [];
  const d = createCommentPipelineDispatcher({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 202, text: async () => JSON.stringify({ accepted: true, action: "central_sweep" }) };
    },
    supabaseUrl: "https://x.invalid",
    serviceRoleKey: "svc",
    serviceSecret: "s",
  });
  assert.deepEqual(await d.triggerCentral({ permitId: "perm-1" }), { outcome: "complete" });
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: "central_sweep", source: "deep_worker", permit_ids: ["perm-1"] });
  assert.equal(calls[0].init.headers["x-permitpilot-service-secret"], undefined);

  const base = { supabaseUrl: "u", serviceRoleKey: "k", serviceSecret: "s" };
  for (const status of [403, 503]) {
    const off = await createCommentPipelineDispatcher({ ...base, fetch: reply(status, { error: "Central processing is disabled" }) }).triggerCentral({ permitId: "p" });
    assert.equal(off.outcome, "disabled");
  }
  const broken = await createCommentPipelineDispatcher({ ...base, fetch: reply(500, { error: "boom" }) }).triggerCentral({ permitId: "p" });
  assert.equal(broken.outcome, "failed");
});
