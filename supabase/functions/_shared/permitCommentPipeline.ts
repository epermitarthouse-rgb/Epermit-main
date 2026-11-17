/**
 * Drives one claimed project through intake-pipeline-agent (D-113): the same round loop as the browser
 * (AgentWorkflowStatus) and the deep worker (scraper-service/permit-sync/deep/pipeline.js), keyed by the
 * comment fingerprint and bounded by a time budget so it fits one edge invocation. Unfinished work is
 * released with its pipeline_run_id and resumes on the next sweep; nothing is re-scraped.
 *
 * Pure: the intake call, clock and sleep are injected.
 */

export type ClaimedProject = {
  project_id: string;
  owner_user_id: string;
  fingerprint: string;
  pipeline_run_id: string | null;
  force_requested: boolean;
  attempts: number;
};

export type IntakeResponse = { status: number; data: Record<string, unknown> | null };
export type IntakeCaller = (actingUserId: string, body: Record<string, unknown>) => Promise<IntakeResponse>;

export type DriveOutcome = {
  outcome: "completed" | "released" | "failed";
  pipelineRunId: string | null;
  rounds: number;
  error?: string;
};

const RETRY_ACTIONS = new Set(["retry_parser", "retry_classifier", "retry_enrichment", "retry_routing"]);
const CONTINUE_ACTIONS = new Set(["poll_again", "continue_enrichment", "continue"]);

export async function driveClaimedProject(input: {
  claim: ClaimedProject;
  callIntake: IntakeCaller;
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  /** Time one intake round may need; a round is not started when less than this is left. */
  reserveMs?: number;
  maxRounds?: number;
}): Promise<DriveOutcome> {
  const { claim, callIntake, deadline } = input;
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollIntervalMs = input.pollIntervalMs ?? 2000;
  const reserveMs = input.reserveMs ?? 30_000;
  const maxRounds = input.maxRounds ?? 60;

  let runId = claim.pipeline_run_id;
  let restartedStale = false;
  let cursor: unknown;

  for (let round = 0; round < maxRounds; round += 1) {
    if (now() + reserveMs >= deadline) return { outcome: "released", pipelineRunId: runId, rounds: round };
    const body: Record<string, unknown> = {
      project_id: claim.project_id,
      is_shadow_mode: false,
      comment_source: "permit_repository",
      comment_fingerprint: claim.fingerprint,
      ...(runId
        ? { pipeline_run_id: runId, resume_pipeline: true }
        : { full_refresh: true, ...(claim.force_requested ? { force_retry: true } : {}) }),
      ...(cursor ? { cursor } : {}),
    };

    let res: IntakeResponse;
    try {
      res = await callIntake(claim.owner_user_id, body);
    } catch (e) {
      return { outcome: "failed", pipelineRunId: runId, rounds: round + 1, error: `intake unreachable: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
    }
    const data = res.data ?? {};
    const action = typeof data.next_action === "string" ? data.next_action : null;
    if (typeof data.pipeline_run_id === "string") runId = data.pipeline_run_id;

    if (action === "stale_run") {
      if (restartedStale) return { outcome: "failed", pipelineRunId: null, rounds: round + 1, error: "stale_run" };
      restartedStale = true;
      runId = null;
      cursor = undefined;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      const msg = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      return { outcome: "failed", pipelineRunId: runId, rounds: round + 1, error: msg.slice(0, 200) };
    }
    if (action === "complete") return { outcome: "completed", pipelineRunId: runId, rounds: round + 1 };
    if (action && RETRY_ACTIONS.has(action)) return { outcome: "failed", pipelineRunId: runId, rounds: round + 1, error: action };
    if (action && !CONTINUE_ACTIONS.has(action)) {
      return { outcome: "failed", pipelineRunId: runId, rounds: round + 1, error: `unknown action ${action.slice(0, 40)}` };
    }
    const cp = (data.comment_parser ?? null) as { next_cursor?: unknown; done?: boolean; error?: string } | null;
    cursor = cp && cp.error !== "timeout" && cp.next_cursor != null && !cp.done ? cp.next_cursor : undefined;
    await sleep(pollIntervalMs);
  }
  return { outcome: "released", pipelineRunId: runId, rounds: maxRounds };
}
