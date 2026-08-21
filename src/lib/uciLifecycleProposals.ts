import type { LifecycleState, UciLifecycleProposalRow, UciLifecycleProposalsPayload, UciProviderMappingMetadata, UciProviderResolutionResult, UciProviderSetupAddressSource, UciProviderSetupResponse, UtilityProvider } from "@/types/uci";
import { isResolutionConfirmed, resolveProviderFromResolution } from "@/lib/uciProviderResolution";
import { deriveAddressPresentation } from "@/lib/uciSetupWorkflow";

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
  const unblocked = payload.proposals.filter(
    (row) => !row.blocked_reason && !row.applied && !(row as { rejected?: boolean }).rejected,
  );
  const pool = unblocked.length ? unblocked : payload.proposals;
  return pool.reduce<UciLifecycleProposalRow | null>((best, row) => {
    if (!best) return row;
    if (row.proposed_stage > best.proposed_stage) return row;
    return best;
  }, null);
}

/** Mirrors backend checksum for stale-proposal protection (D13). */
export async function computeLifecycleProposalChecksum(
  proposal: UciLifecycleProposalRow,
  lastEvaluatedAt: string,
): Promise<string> {
  const raw = [
    String(lastEvaluatedAt || ""),
    String(proposal.external_application_id || ""),
    String(proposal.proposed_stage || ""),
    String(proposal.proposed_state || ""),
    String(proposal.source_status || ""),
  ].join("|");
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}

export function getProviderMappingFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): UciProviderMappingMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.uci_provider_mapping;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  return {
    method: "human_assisted",
    confirmed_by_user_id: String(rec.confirmed_by_user_id || ""),
    confirmed_at: String(rec.confirmed_at || ""),
    address_source: (rec.address_source as UciProviderMappingMetadata["address_source"]) || "none",
    address_snapshot:
      rec.address_snapshot && typeof rec.address_snapshot === "object"
        ? (rec.address_snapshot as UciProviderMappingMetadata["address_snapshot"])
        : null,
    selected_provider_slugs: Array.isArray(rec.selected_provider_slugs)
      ? rec.selected_provider_slugs.map(String)
      : [],
    unresolved_utility_types: Array.isArray(rec.unresolved_utility_types)
      ? rec.unresolved_utility_types.map(String)
      : [],
    territory_matching_available: false,
    provider_slug: rec.provider_slug != null ? String(rec.provider_slug) : undefined,
  };
}

/** Merge persisted record mapping with project-level Step 2b confirmations. */
export function buildCanonicalProviderMappingSummary(params: {
  recordMetadata: Record<string, unknown> | null | undefined;
  resolutions: Record<string, UciProviderResolutionResult> | null | undefined;
  providers: UtilityProvider[];
  addressSourceAcknowledged?: UciProviderSetupAddressSource | null;
  providerSetup?: UciProviderSetupResponse | null;
}): UciProviderMappingMetadata | null {
  const fromRecord = getProviderMappingFromMetadata(params.recordMetadata);
  if (fromRecord?.confirmed_at && fromRecord.selected_provider_slugs.length > 0) {
    return fromRecord;
  }

  const confirmedSlugs = new Set<string>(fromRecord?.selected_provider_slugs ?? []);
  let latestConfirmedAt = fromRecord?.confirmed_at?.trim() || "";
  let confirmedBy = fromRecord?.confirmed_by_user_id?.trim() || "";

  for (const resolution of Object.values(params.resolutions ?? {})) {
    if (!isResolutionConfirmed(resolution)) continue;
    const provider = resolveProviderFromResolution(params.providers, resolution);
    if (provider?.slug) confirmedSlugs.add(provider.slug);
    if (resolution.confirmed_at && resolution.confirmed_at > latestConfirmedAt) {
      latestConfirmedAt = resolution.confirmed_at;
    }
    if (resolution.confirmed_by) confirmedBy = resolution.confirmed_by;
  }

  if (confirmedSlugs.size === 0) return fromRecord;

  const addressPresentation = params.providerSetup
    ? deriveAddressPresentation(
        params.providerSetup,
        false,
        params.addressSourceAcknowledged ?? null,
      )
    : null;
  const addressSource =
    params.addressSourceAcknowledged ??
    fromRecord?.address_source ??
    params.providerSetup?.recommended_address_source ??
    "none";

  return {
    method: "human_assisted",
    confirmed_by_user_id: confirmedBy,
    confirmed_at: latestConfirmedAt,
    address_source: addressSource,
    address_snapshot:
      fromRecord?.address_snapshot ??
      (addressPresentation?.activeFormatted
        ? {
            formatted: addressPresentation.activeFormatted,
            complete: true,
            fallback_used: false,
            parts: null,
          }
        : null),
    selected_provider_slugs: [...confirmedSlugs],
    unresolved_utility_types: fromRecord?.unresolved_utility_types ?? [],
    territory_matching_available: false,
  };
}
