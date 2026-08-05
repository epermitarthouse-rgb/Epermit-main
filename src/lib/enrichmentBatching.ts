/** Mirrors supabase/functions/context-reference-engine batch size. */
export const ENRICHMENT_BATCH_SIZE = 20;

/** Safety cap for pipeline→engine continuation rounds. */
export const ENRICHMENT_MAX_PIPELINE_ROUNDS = 50;

export type EnrichmentBatchProgress = {
  eligibleBefore: number;
  fetched: number;
  enriched: number;
  remainingAfter: number;
  hasMore: boolean;
};

/**
 * Pure progress math for one enrichment batch.
 * Eligible rows are those missing a non-empty code_reference.
 */
export function computeEnrichmentBatchProgress(input: {
  eligibleBefore: number;
  fetched: number;
  enriched: number;
  batchSize?: number;
}): EnrichmentBatchProgress {
  const batchSize = input.batchSize ?? ENRICHMENT_BATCH_SIZE;
  const eligibleBefore = Math.max(0, input.eligibleBefore);
  const fetched = Math.max(0, Math.min(input.fetched, batchSize, eligibleBefore));
  const enriched = Math.max(0, Math.min(input.enriched, fetched));
  // Rows that received a usable code_reference leave the eligible set.
  // Conservatively assume enriched rows become ineligible when counting remaining.
  const remainingAfter = Math.max(0, eligibleBefore - enriched);
  const hasMore = remainingAfter > 0 && enriched > 0;
  return { eligibleBefore, fetched, enriched, remainingAfter, hasMore };
}

/** How many controlled batches are required to drain `eligibleCount` rows. */
export function requiredEnrichmentBatches(
  eligibleCount: number,
  batchSize: number = ENRICHMENT_BATCH_SIZE,
): number {
  if (eligibleCount <= 0) return 0;
  return Math.ceil(eligibleCount / batchSize);
}

/**
 * Simulate pipeline continuation: one engine batch per round until drained or capped.
 * Used as regression coverage for projects larger than BATCH_SIZE (e.g. 62 comments).
 */
export function simulateEnrichmentContinuation(input: {
  eligibleCount: number;
  batchSize?: number;
  maxRounds?: number;
  /** Enriched per fetched row (1 = full success). */
  successRate?: number;
}): {
  rounds: number;
  totalEnriched: number;
  remaining: number;
  stoppedReason: "drained" | "no_progress" | "max_rounds";
} {
  const batchSize = input.batchSize ?? ENRICHMENT_BATCH_SIZE;
  const maxRounds = input.maxRounds ?? ENRICHMENT_MAX_PIPELINE_ROUNDS;
  const successRate = input.successRate ?? 1;
  let remaining = Math.max(0, input.eligibleCount);
  let totalEnriched = 0;
  let rounds = 0;

  while (remaining > 0 && rounds < maxRounds) {
    rounds++;
    const fetched = Math.min(batchSize, remaining);
    const enriched = Math.floor(fetched * successRate);
    const progress = computeEnrichmentBatchProgress({
      eligibleBefore: remaining,
      fetched,
      enriched,
      batchSize,
    });
    totalEnriched += progress.enriched;
    remaining = progress.remainingAfter;
    if (!progress.hasMore) {
      return {
        rounds,
        totalEnriched,
        remaining,
        stoppedReason: progress.enriched === 0 ? "no_progress" : "drained",
      };
    }
  }

  return {
    rounds,
    totalEnriched,
    remaining,
    stoppedReason: remaining > 0 ? "max_rounds" : "drained",
  };
}
