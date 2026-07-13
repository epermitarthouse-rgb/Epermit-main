"use strict";

const { recordSystemTransition } = require("./uci-transitions.service.js");

/**
 * @returns {boolean}
 */
function isAutoStageTransitionsEnabled() {
  return process.env.UCI_AUTO_STAGE_TRANSITIONS === "true";
}

/**
 * @param {import("./adapters/utility-adapter.types.js").UtilityAdapter} adapter
 * @param {unknown} raw
 * @param {import("./adapters/utility-adapter.types.js").NormalizedApplication | null} normalizedApp
 * @returns {import("./adapters/utility-adapter.types.js").LifecycleProposal | null}
 */
function buildProposalFromAdapter(adapter, raw, normalizedApp) {
  if (typeof adapter.mapPortalStatusToLifecycle !== "function") return null;

  const portalStatus =
    normalizedApp?.portal_status ??
    (raw && typeof raw === "object"
      ? /** @type {{ currentStatus?: unknown }} */ (raw).currentStatus
      : null);

  return adapter.mapPortalStatusToLifecycle(
    typeof portalStatus === "string" ? portalStatus : null,
    {
      action_required: normalizedApp?.action_required === true,
      portal_submitted_at: normalizedApp?.portal_submitted_at ?? null,
      portal_milestone: normalizedApp?.portal_milestone ?? null,
      portal_status: typeof portalStatus === "string" ? portalStatus : null,
      raw,
    },
  );
}

/**
 * @param {number} currentStage
 * @param {import("./adapters/utility-adapter.types.js").LifecycleProposal} proposal
 * @returns {string | null}
 */
function evaluateProposalGuards(currentStage, proposal) {
  if (proposal.proposed_stage === 10) {
    return "Stage 10 requires explicit energization confirmation.";
  }

  if (proposal.proposed_stage === 4 && !proposal.automatic_transition_allowed) {
    return "Stage 4 requires confirmed portal submission.";
  }

  if (proposal.proposed_stage < currentStage) {
    return "Backward lifecycle transitions are not allowed.";
  }

  if (proposal.proposed_stage === currentStage) {
    return "Proposed stage matches current stage; no forward transition needed.";
  }

  return null;
}

/**
 * @param {Array<{
 *   external_application_id: string;
 *   provider_slug: string;
 *   proposal: import("./adapters/utility-adapter.types.js").LifecycleProposal;
 *   blocked_reason: string | null;
 * }>} evaluated
 * @returns {typeof evaluated[0] | null}
 */
function selectPrimaryProposal(evaluated) {
  const eligible = evaluated.filter((row) => !row.blocked_reason);
  if (!eligible.length) return null;

  return eligible.reduce((best, row) => {
    if (!best) return row;
    if (row.proposal.proposed_stage > best.proposal.proposed_stage) return row;
    if (row.proposal.proposed_stage < best.proposal.proposed_stage) return best;
    const rank = { high: 3, medium: 2, low: 1 };
    return (rank[row.proposal.confidence] || 0) >= (rank[best.proposal.confidence] || 0)
      ? row
      : best;
  }, /** @type {typeof evaluated[0] | null} */ (null));
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.coordinationRecordId
 * @param {string} opts.projectId
 * @param {string} opts.providerSlug
 * @param {import("./adapters/utility-adapter.types.js").UtilityAdapter} opts.adapter
 * @param {Array<Record<string, unknown>>} opts.rawApplications
 * @param {Array<import("./adapters/utility-adapter.types.js").NormalizedApplication>} opts.normalizedApplications
 * @param {Record<string, unknown>} opts.coordinationRecord
 * @returns {Promise<Record<string, unknown>>}
 */
async function processLifecycleMappingAfterSync(supabase, opts) {
  const evaluatedAt = new Date().toISOString();
  const currentStage = Number(opts.coordinationRecord.current_stage) || 1;
  const autoApplyEnabled = isAutoStageTransitionsEnabled();

  /** @type {Map<string, import("./adapters/utility-adapter.types.js").NormalizedApplication>} */
  const normalizedByExternalId = new Map();
  for (const app of opts.normalizedApplications) {
    if (app?.external_application_id) {
      normalizedByExternalId.set(String(app.external_application_id), app);
    }
  }

  /** @type {Array<{
   *   external_application_id: string;
   *   provider_slug: string;
   *   source_status: string;
   *   proposed_stage: number;
   *   proposed_state: string;
   *   confidence: string;
   *   reason: string;
   *   automatic_transition_allowed: boolean;
   *   blocked_reason: string | null;
   *   applied: boolean;
   *   applied_at: string | null;
   * }>} */
  const proposalRows = [];

  for (const raw of opts.rawApplications) {
    const externalId =
      typeof opts.adapter.getExternalApplicationId === "function"
        ? opts.adapter.getExternalApplicationId(raw)
        : null;
    if (!externalId) continue;

    const normalizedApp = normalizedByExternalId.get(externalId) ?? null;
    const proposal = buildProposalFromAdapter(opts.adapter, raw, normalizedApp);
    if (!proposal) continue;

    const blockedReason = evaluateProposalGuards(currentStage, proposal);

    proposalRows.push({
      external_application_id: externalId,
      provider_slug: opts.providerSlug,
      source_status: proposal.source_status,
      proposed_stage: proposal.proposed_stage,
      proposed_state: proposal.proposed_state,
      confidence: proposal.confidence,
      reason: proposal.reason,
      automatic_transition_allowed: proposal.automatic_transition_allowed,
      blocked_reason: blockedReason,
      applied: false,
      applied_at: null,
    });
  }

  let appliedCount = 0;
  let appliedTransition = null;
  const primary = selectPrimaryProposal(
    proposalRows.map((row) => ({
      external_application_id: row.external_application_id,
      provider_slug: row.provider_slug,
      proposal: {
        proposed_stage: row.proposed_stage,
        proposed_state: row.proposed_state,
        confidence: /** @type {"high" | "medium" | "low"} */ (row.confidence),
        reason: row.reason,
        source_status: row.source_status,
        automatic_transition_allowed: row.automatic_transition_allowed,
      },
      blocked_reason: row.blocked_reason,
    })),
  );

  if (autoApplyEnabled && primary && !primary.blocked_reason) {
    try {
      const result = await recordSystemTransition(supabase, {
        coordinationRecordId: opts.coordinationRecordId,
        toStage: primary.proposal.proposed_stage,
        toState: primary.proposal.proposed_state,
        reason: `Portal lifecycle mapping: ${primary.proposal.reason}`,
        triggeredByType: "system",
        triggeredById: null,
        metadata: {
          source: "uci_lifecycle_mapping",
          provider_slug: opts.providerSlug,
          external_application_id: primary.external_application_id,
          source_status: primary.proposal.source_status,
          confidence: primary.proposal.confidence,
          auto_applied: true,
        },
      });
      appliedTransition = result.transition;
      appliedCount = 1;

      for (const row of proposalRows) {
        if (row.external_application_id === primary.external_application_id) {
          row.applied = true;
          row.applied_at = evaluatedAt;
          row.blocked_reason = null;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
      for (const row of proposalRows) {
        if (row.external_application_id === primary.external_application_id) {
          row.blocked_reason = `Auto-apply failed: ${message}`;
        }
      }
    }
  }

  const lifecyclePayload = {
    last_evaluated_at: evaluatedAt,
    auto_apply_enabled: autoApplyEnabled,
    proposals: proposalRows,
    applied_transition_id: appliedTransition ? String(appliedTransition.id) : null,
  };

  try {
    const prevMeta =
      opts.coordinationRecord.metadata &&
      typeof opts.coordinationRecord.metadata === "object" &&
      !Array.isArray(opts.coordinationRecord.metadata)
        ? /** @type {Record<string, unknown>} */ (opts.coordinationRecord.metadata)
        : {};

    await supabase
      .from("coordination_records")
      .update({
        metadata: {
          ...prevMeta,
          uci_lifecycle_proposals: lifecyclePayload,
        },
      })
      .eq("id", opts.coordinationRecordId)
      .eq("project_id", opts.projectId);
  } catch (metaErr) {
    return {
      status: proposalRows.length ? "partial" : "not_run",
      evaluated_count: proposalRows.length,
      applied_count: appliedCount,
      blocked_count: proposalRows.filter((row) => row.blocked_reason).length,
      auto_apply_enabled: autoApplyEnabled,
      proposals: proposalRows,
      errors: [
        metaErr instanceof Error
          ? metaErr.message.slice(0, 500)
          : "Failed to persist lifecycle proposals",
      ],
    };
  }

  return {
    status:
      appliedCount > 0
        ? "applied"
        : proposalRows.length
          ? proposalRows.some((row) => row.blocked_reason)
            ? "proposed"
            : "proposed"
          : "not_run",
    evaluated_count: proposalRows.length,
    applied_count: appliedCount,
    blocked_count: proposalRows.filter((row) => row.blocked_reason).length,
    auto_apply_enabled: autoApplyEnabled,
    proposals: proposalRows,
    errors: [],
  };
}

module.exports = {
  isAutoStageTransitionsEnabled,
  buildProposalFromAdapter,
  evaluateProposalGuards,
  selectPrimaryProposal,
  processLifecycleMappingAfterSync,
};
