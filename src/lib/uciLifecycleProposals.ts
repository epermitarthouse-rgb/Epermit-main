import type { LifecycleState, UciLifecycleProposalRow, UciLifecycleProposalsPayload } from "@/types/uci";

const LIFECYCLE_STATES = new Set<LifecycleState>([
  "NOT_STARTED",
  "IN_PROGRESS",
  "AWAITING_UTILITY",
  "BLOCKED",
  "ESCALATED",
  "COMPLETED",
]);

export function getLifecycleProposalsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): UciLifecycleProposalsPayload | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.uci_lifecycle_proposals;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const payload = raw as Record<string, unknown>;
  const proposalsRaw = Array.isArray(payload.proposals) ? payload.proposals : [];
  /** @type {UciLifecycleProposalRow[]} */
  const proposals = [];

  for (const row of proposalsRaw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const proposedState = String(rec.proposed_state || "").trim();
    if (!LIFECYCLE_STATES.has(proposedState as LifecycleState)) continue;
    proposals.push({
      external_application_id: String(rec.external_application_id || ""),
      provider_slug: String(rec.provider_slug || ""),
      source_status: String(rec.source_status || ""),
      proposed_stage: Number(rec.proposed_stage) || 0,
      proposed_state: proposedState as LifecycleState,
      confidence: String(rec.confidence || ""),
      reason: String(rec.reason || ""),
      automatic_transition_allowed: rec.automatic_transition_allowed === true,
      blocked_reason:
        rec.blocked_reason != null && String(rec.blocked_reason).trim()
          ? String(rec.blocked_reason)
          : null,
      applied: rec.applied === true,
      applied_at: rec.applied_at != null ? String(rec.applied_at) : null,
    });
  }

  return {
    last_evaluated_at: String(payload.last_evaluated_at || ""),
    auto_apply_enabled: payload.auto_apply_enabled === true,
    proposals,
    applied_transition_id:
      payload.applied_transition_id != null ? String(payload.applied_transition_id) : null,
  };
}

export function selectDisplayLifecycleProposal(
  payload: UciLifecycleProposalsPayload | null,
): UciLifecycleProposalRow | null {
  if (!payload?.proposals.length) return null;
  const unblocked = payload.proposals.filter((row) => !row.blocked_reason && !row.applied);
  const pool = unblocked.length ? unblocked : payload.proposals;
  return pool.reduce<UciLifecycleProposalRow | null>((best, row) => {
    if (!best) return row;
    if (row.proposed_stage > best.proposed_stage) return row;
    return best;
  }, null);
}
