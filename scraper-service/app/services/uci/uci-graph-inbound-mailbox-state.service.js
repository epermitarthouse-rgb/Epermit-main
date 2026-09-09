"use strict";

/**
 * Failure-safe Graph inbound cursor + database-backed mailbox lease.
 *
 * Watermark advances only through successfully processed messages (including
 * cheap duplicate skips). A mid-batch failure leaves the cursor at the last
 * success so the failed message is retried and later messages are not skipped.
 */

const DEFAULT_LEASE_TTL_SECONDS = 120;
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_SKEW_MS = 2 * 60 * 1000;

/**
 * In-memory claim used by tests and as a last-resort same-process lock.
 * Mirrors claim_uci_graph_inbound_mailbox WHERE semantics.
 *
 * @param {Map<string, Record<string, unknown>>} store
 * @param {object} params
 */
function claimMailboxLeaseInStore(store, params) {
  const userId = String(params.userId || "");
  const owner = String(params.owner || "").trim();
  const ttlSeconds = Math.max(30, Number(params.ttlSeconds) || DEFAULT_LEASE_TTL_SECONDS);
  const now = params.now instanceof Date ? params.now : new Date();
  if (!userId || !owner) return null;

  const existing = store.get(userId) || null;
  const expiresAt = existing?.lease_expires_at ? new Date(String(existing.lease_expires_at)) : null;
  const leaseActive =
    Boolean(existing?.lease_owner) && expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime())
      ? expiresAt.getTime() > now.getTime()
      : false;

  if (leaseActive && String(existing.lease_owner) !== owner) {
    return null;
  }

  const next = {
    ...(existing || { user_id: userId, watermark_received_at: null }),
    user_id: userId,
    lease_owner: owner,
    lease_expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    last_poll_started_at: now.toISOString(),
  };
  store.set(userId, next);
  return { ...next };
}

/**
 * @param {Map<string, Record<string, unknown>>} store
 * @param {object} params
 */
function releaseMailboxLeaseInStore(store, params) {
  const userId = String(params.userId || "");
  const owner = String(params.owner || "").trim();
  const now = params.now instanceof Date ? params.now : new Date();
  const existing = store.get(userId);
  if (!existing) return null;

  const expiresAt = existing.lease_expires_at ? new Date(String(existing.lease_expires_at)) : null;
  const expired =
    !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime();
  if (existing.lease_owner && String(existing.lease_owner) !== owner && !expired) {
    return null;
  }

  const nextWatermark = nextWatermarkIso(existing.watermark_received_at, params.watermarkReceivedAt);
  const next = {
    ...existing,
    lease_owner: null,
    lease_expires_at: null,
    last_poll_finished_at: now.toISOString(),
    watermark_received_at: nextWatermark,
    last_cycle_metrics:
      params.metrics && typeof params.metrics === "object" ? params.metrics : existing.last_cycle_metrics,
  };
  store.set(userId, next);
  return { ...next };
}

/**
 * Never move the watermark backwards. Null candidate leaves the previous value.
 *
 * @param {string | null | undefined} previousIso
 * @param {string | null | undefined} candidateIso
 */
function nextWatermarkIso(previousIso, candidateIso) {
  if (!candidateIso) return previousIso || null;
  if (!previousIso) return candidateIso;
  const prev = new Date(previousIso).getTime();
  const next = new Date(candidateIso).getTime();
  if (!Number.isFinite(next)) return previousIso;
  if (!Number.isFinite(prev)) return candidateIso;
  return next > prev ? candidateIso : previousIso;
}

/**
 * Graph $filter receivedDateTime. Uses watermark minus skew, or initial lookback.
 * Overlap (ge + skew) plus idempotency prevents misses after clock skew / retries.
 *
 * @param {object} params
 */
function computeGraphReceivedAfter(params) {
  const nowMs = Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
  const lookbackHours = Math.min(Math.max(Number(params.lookbackHours) || DEFAULT_LOOKBACK_HOURS, 1), 168);
  const skewMs = Math.max(0, Number(params.skewMs) || DEFAULT_SKEW_MS);
  const watermark = params.watermarkReceivedAt ? new Date(params.watermarkReceivedAt).getTime() : NaN;

  if (Number.isFinite(watermark)) {
    return new Date(watermark - skewMs).toISOString();
  }
  return new Date(nowMs - lookbackHours * 60 * 60 * 1000).toISOString();
}

/**
 * Advance only through messages that fully succeeded (ingest or cheap skip).
 * If the batch failed, do not include the failed message or anything after it.
 *
 * @param {object} params
 */
function computeNextWatermark(params) {
  const successful = Array.isArray(params.successfulReceivedAts)
    ? params.successfulReceivedAts
        .map((value) => new Date(String(value)).getTime())
        .filter((ms) => Number.isFinite(ms))
    : [];
  const maxSuccess = successful.length ? Math.max(...successful) : NaN;
  const candidate = Number.isFinite(maxSuccess) ? new Date(maxSuccess).toISOString() : null;
  return nextWatermarkIso(params.previousWatermark || null, candidate);
}

function isMissingRelationError(error) {
  const message = String(error?.message || error || "");
  const code = String(error?.code || "");
  return (
    code === "PGRST202" ||
    code === "42P01" ||
    /could not find the function|does not exist|schema cache/i.test(message)
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function claimMailboxLease(supabase, params) {
  const userId = String(params.userId || "");
  const owner = String(params.owner || "").trim();
  const ttlSeconds = Math.max(30, Number(params.ttlSeconds) || DEFAULT_LEASE_TTL_SECONDS);
  if (!userId || !owner) return { claimed: false, reason: "invalid_args", row: null, fallback: false };

  const { data, error } = await supabase.rpc("claim_uci_graph_inbound_mailbox", {
    p_user_id: userId,
    p_owner: owner,
    p_lease_ttl_seconds: ttlSeconds,
  });

  if (error) {
    if (isMissingRelationError(error)) {
      return { claimed: true, reason: "rpc_missing_fallback", row: null, fallback: true };
    }
    return { claimed: false, reason: "claim_failed", row: null, fallback: false, error };
  }

  if (!data) {
    return { claimed: false, reason: "lease_held", row: null, fallback: false };
  }
  return { claimed: true, reason: "claimed", row: data, fallback: false };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function releaseMailboxLease(supabase, params) {
  const userId = String(params.userId || "");
  const owner = String(params.owner || "").trim();
  if (!userId || !owner) return { released: false, row: null };

  const { data, error } = await supabase.rpc("release_uci_graph_inbound_mailbox", {
    p_user_id: userId,
    p_owner: owner,
    p_watermark_received_at: params.watermarkReceivedAt || null,
    p_metrics: params.metrics || null,
  });

  if (error) {
    if (isMissingRelationError(error)) {
      return { released: true, row: null, fallback: true };
    }
    return { released: false, row: null, error };
  }
  return { released: Boolean(data), row: data || null };
}

function emptyInboundMetrics() {
  return {
    messages_fetched: 0,
    messages_new: 0,
    messages_skipped_duplicate: 0,
    messages_rematched: 0,
    query_duration_ms: 0,
    cycle_duration_ms: 0,
    graph_duration_ms: 0,
    lease_skipped: 0,
  };
}

/**
 * @param {Record<string, number>} metrics
 */
function formatInboundMetricsLog(metrics) {
  return (
    `fetched=${metrics.messages_fetched || 0} ` +
    `new=${metrics.messages_new || 0} ` +
    `skipped_duplicate=${metrics.messages_skipped_duplicate || 0} ` +
    `rematched=${metrics.messages_rematched || 0} ` +
    `query_ms=${metrics.query_duration_ms || 0} ` +
    `graph_ms=${metrics.graph_duration_ms || 0} ` +
    `cycle_ms=${metrics.cycle_duration_ms || 0}`
  );
}

module.exports = {
  DEFAULT_LEASE_TTL_SECONDS,
  DEFAULT_LOOKBACK_HOURS,
  DEFAULT_SKEW_MS,
  claimMailboxLeaseInStore,
  releaseMailboxLeaseInStore,
  nextWatermarkIso,
  computeGraphReceivedAfter,
  computeNextWatermark,
  claimMailboxLease,
  releaseMailboxLease,
  emptyInboundMetrics,
  formatInboundMetricsLog,
};
