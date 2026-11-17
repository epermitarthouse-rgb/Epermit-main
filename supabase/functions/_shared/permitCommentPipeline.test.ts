// Run: node --import tsx --test supabase/functions/_shared/permitCommentPipeline.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { driveClaimedProject, type ClaimedProject, type IntakeResponse } from "./permitCommentPipeline.ts";

const claim = (over: Partial<ClaimedProject> = {}): ClaimedProject => ({
  project_id: "p1",
  owner_user_id: "owner",
  fingerprint: "fp1",
  pipeline_run_id: null,
  force_requested: false,
  attempts: 1,
  ...over,
});

function scripted(responses: IntakeResponse[]) {
  const calls: Array<{ actingUserId: string; body: Record<string, unknown> }> = [];
  return {
    calls,
    callIntake: async (actingUserId: string, body: Record<string, unknown>) => {
      calls.push({ actingUserId, body });
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      return next;
    },
  };
}

const ok = (data: Record<string, unknown>): IntakeResponse => ({ status: 200, data });
const noSleep = async () => {};

describe("driveClaimedProject", () => {
  it("starts a fresh run keyed by the fingerprint, then resumes the returned run until complete", async () => {
    const s = scripted([ok({ pipeline_run_id: "run-1", next_action: "poll_again" }), ok({ pipeline_run_id: "run-1", next_action: "complete" })]);
    const r = await driveClaimedProject({ claim: claim(), callIntake: s.callIntake, deadline: Infinity, sleep: noSleep });
    assert.deepEqual(r, { outcome: "completed", pipelineRunId: "run-1", rounds: 2 });
    assert.equal(s.calls[0].actingUserId, "owner");
    assert.deepEqual(s.calls[0].body, { project_id: "p1", is_shadow_mode: false, comment_source: "permit_repository", comment_fingerprint: "fp1", full_refresh: true });
    assert.deepEqual(s.calls[1].body, { project_id: "p1", is_shadow_mode: false, comment_source: "permit_repository", comment_fingerprint: "fp1", pipeline_run_id: "run-1", resume_pipeline: true });
  });

  it("a user request forces a re-run of an already completed fingerprint", async () => {
    const s = scripted([ok({ pipeline_run_id: "run-1", next_action: "complete" })]);
    await driveClaimedProject({ claim: claim({ force_requested: true }), callIntake: s.callIntake, deadline: Infinity, sleep: noSleep });
    assert.equal(s.calls[0].body.force_retry, true);
  });

  it("a claimed run id resumes where the last invocation stopped (no re-scrape, no fresh parse)", async () => {
    const s = scripted([ok({ pipeline_run_id: "run-7", next_action: "complete" })]);
    await driveClaimedProject({ claim: claim({ pipeline_run_id: "run-7" }), callIntake: s.callIntake, deadline: Infinity, sleep: noSleep });
    assert.equal(s.calls[0].body.pipeline_run_id, "run-7");
    assert.equal(s.calls[0].body.full_refresh, undefined);
  });

  it("agent failures are reported with the stage so the state backs off", async () => {
    const s = scripted([ok({ pipeline_run_id: "run-1", next_action: "retry_enrichment" })]);
    const r = await driveClaimedProject({ claim: claim(), callIntake: s.callIntake, deadline: Infinity, sleep: noSleep });
    assert.deepEqual(r, { outcome: "failed", pipelineRunId: "run-1", rounds: 1, error: "retry_enrichment" });
  });

  it("HTTP errors and unreachable intake fail without throwing", async () => {
    const s = scripted([{ status: 403, data: { message: "Project not found or access denied" } }]);
    const r = await driveClaimedProject({ claim: claim(), callIntake: s.callIntake, deadline: Infinity, sleep: noSleep });
    assert.equal(r.outcome, "failed");
    assert.equal(r.error, "Project not found or access denied");
    const t = await driveClaimedProject({ claim: claim(), callIntake: async () => Promise.reject(new Error("ECONNRESET")), deadline: Infinity, sleep: noSleep });
    assert.equal(t.outcome, "failed");
    assert.match(String(t.error), /intake unreachable/);
  });

  it("a stale run is dropped once and restarted from the current fingerprint", async () => {
    const s = scripted([
      { status: 409, data: { next_action: "stale_run", pipeline_run_id: "old" } },
      ok({ pipeline_run_id: "run-2", next_action: "complete" }),
    ]);
    const r = await driveClaimedProject({ claim: claim({ pipeline_run_id: "old" }), callIntake: s.callIntake, deadline: Infinity, sleep: noSleep });
    assert.equal(r.outcome, "completed");
    assert.equal(s.calls[1].body.pipeline_run_id, undefined);
    assert.equal(s.calls[1].body.full_refresh, true);
  });

  it("releases with the run id when the time budget runs out", async () => {
    let t = 0;
    const s = scripted([ok({ pipeline_run_id: "run-1", next_action: "continue_enrichment" }), ok({ pipeline_run_id: "run-1", next_action: "continue_enrichment" })]);
    const r = await driveClaimedProject({
      claim: claim(),
      callIntake: async (a, b) => ((t += 40_000), s.callIntake(a, b)),
      deadline: 100_000,
      now: () => t,
      sleep: noSleep,
      reserveMs: 30_000,
    });
    assert.deepEqual(r, { outcome: "released", pipelineRunId: "run-1", rounds: 2 });
  });

  it("unknown actions fail instead of looping", async () => {
    const s = scripted([ok({ next_action: "dance" })]);
    const r = await driveClaimedProject({ claim: claim(), callIntake: s.callIntake, deadline: Infinity, sleep: noSleep });
    assert.equal(r.outcome, "failed");
  });
});
