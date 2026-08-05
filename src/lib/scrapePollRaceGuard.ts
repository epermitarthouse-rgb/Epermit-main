/**
 * Generation / abort helpers so an older poll cannot overwrite newer state.
 */

export type PollGenerationGate = {
  /** Current generation for the active jobId. */
  generation: number;
  /** AbortController for the in-flight request, if any. */
  controller: AbortController | null;
};

export function createPollGenerationGate(): PollGenerationGate {
  return { generation: 0, controller: null };
}

/** Bump generation and abort any in-flight request. Returns the new generation. */
export function bumpPollGeneration(gate: PollGenerationGate): number {
  gate.generation += 1;
  if (gate.controller) {
    try {
      gate.controller.abort();
    } catch {
      /* ignore */
    }
    gate.controller = null;
  }
  return gate.generation;
}

/** Start a tracked request for `generation`. Returns false if generation is stale. */
export function beginPollRequest(
  gate: PollGenerationGate,
  generation: number,
): AbortController | null {
  if (gate.generation !== generation) return null;
  if (gate.controller) {
    try {
      gate.controller.abort();
    } catch {
      /* ignore */
    }
  }
  const controller = new AbortController();
  gate.controller = controller;
  return controller;
}

/** True when this response may safely apply to React state. */
export function canApplyPollResult(
  gate: PollGenerationGate,
  generation: number,
  jobId: string | null | undefined,
  expectedJobId: string | null | undefined,
): boolean {
  if (gate.generation !== generation) return false;
  const a = `${jobId || ""}`.trim();
  const b = `${expectedJobId || ""}`.trim();
  if (!a || !b || a !== b) return false;
  return true;
}

export function finishPollRequest(
  gate: PollGenerationGate,
  controller: AbortController,
): void {
  if (gate.controller === controller) {
    gate.controller = null;
  }
}
