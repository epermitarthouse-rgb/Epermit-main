"use strict";

const crypto = require("crypto");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { recordUserTransition } = require("./uci-transitions.service.js");
const { evaluateProposalGuards } = require("./uci-lifecycle-mapping.service.js");
const { emitUciEvent } = require("./uci-events.service.js");

/**
 * @param {Record<string, unknown>} proposal
 * @param {string} lastEvaluatedAt
 */
function computeLifecycleProposalChecksum(proposal, lastEvaluatedAt) {
  const raw = [
    String(lastEvaluatedAt || ""),
    String(proposal.external_application_id || ""),
    String(proposal.proposed_stage || ""),
    String(proposal.proposed_state || ""),
    String(proposal.source_status || ""),
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * @param {Record<string, unknown>} metadata
 */
function getLifecycleProposalsPayload(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = metadata.uci_lifecycle_proposals;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return /** @type {Record<string, unknown>} */ (raw);
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} externalApplicationId
 */
function findProposalRow(payload, externalApplicationId) {
  const proposals = Array.isArray(payload.proposals) ? payload.proposals : [];
  return (
    proposals.find(
      (row) =>
        row &&
        typeof row === "object" &&
        String(/** @type {Record<string, unknown>} */ (row).external_application_id || "") ===
          externalApplicationId,
    ) ?? null
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function persistLifecycleProposalsPayload(supabase, params) {
  const { coordinationRecordId, projectId, record, payload } = params;
  const prevMeta =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  const { error } = await supabase
    .from("coordination_records")
    .update({
      metadata: {
        ...prevMeta,
        uci_lifecycle_proposals: payload,
      },
    })
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to persist lifecycle proposals"), {
      statusCode: 500,
      code: "LIFECYCLE_PROPOSAL_PERSIST_FAILED",
    });
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function applyLifecycleProposal(supabase, params) {
  const { coordinationRecordId, projectId, userId, externalApplicationId, proposalChecksum } =
    params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record || String(record.project_id) !== projectId) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const payload = getLifecycleProposalsPayload(record.metadata);
  if (!payload) {
    const err = new Error("No lifecycle proposals available");
    err.statusCode = 404;
    err.code = "NO_PROPOSALS";
    throw err;
  }

  const proposal = findProposalRow(payload, externalApplicationId);
  if (!proposal || typeof proposal !== "object") {
    const err = new Error("Lifecycle proposal not found");
    err.statusCode = 404;
    err.code = "PROPOSAL_NOT_FOUND";
    throw err;
  }

  const proposalRec = /** @type {Record<string, unknown>} */ (proposal);

  if (proposalRec.applied === true) {
    const err = new Error("Lifecycle proposal already applied");
    err.statusCode = 409;
    err.code = "PROPOSAL_ALREADY_APPLIED";
    throw err;
  }

  if (proposalRec.rejected === true) {
    const err = new Error("Lifecycle proposal was rejected");
    err.statusCode = 409;
    err.code = "PROPOSAL_REJECTED";
    throw err;
  }

  const lastEvaluatedAt = String(payload.last_evaluated_at || "");
  const expectedChecksum = computeLifecycleProposalChecksum(proposalRec, lastEvaluatedAt);
  if (String(proposalChecksum || "") !== expectedChecksum) {
    const err = new Error("Lifecycle proposal is stale; refresh and try again");
    err.statusCode = 409;
    err.code = "PROPOSAL_STALE";
    throw err;
  }

  const blockedReason = evaluateProposalGuards(Number(record.current_stage) || 1, {
    proposed_stage: Number(proposalRec.proposed_stage) || 0,
    proposed_state: String(proposalRec.proposed_state || ""),
    confidence: /** @type {"high" | "medium" | "low"} */ (
      String(proposalRec.confidence || "medium")
    ),
    reason: String(proposalRec.reason || ""),
    source_status: String(proposalRec.source_status || ""),
    automatic_transition_allowed: proposalRec.automatic_transition_allowed === true,
  });

  if (blockedReason) {
    const err = new Error(blockedReason);
    err.statusCode = 409;
    err.code = "PROPOSAL_BLOCKED";
    throw err;
  }

  const transitionResult = await recordUserTransition(supabase, {
    coordinationRecordId,
    userId,
    toStage: Number(proposalRec.proposed_stage),
    toState: String(proposalRec.proposed_state),
    reason: `Accepted portal lifecycle proposal: ${String(proposalRec.reason || proposalRec.source_status || "")}`,
  });

  const appliedAt = new Date().toISOString();
  const proposals = Array.isArray(payload.proposals) ? [...payload.proposals] : [];
  for (let i = 0; i < proposals.length; i += 1) {
    const row = proposals[i];
    if (
      row &&
      typeof row === "object" &&
      String(/** @type {Record<string, unknown>} */ (row).external_application_id || "") ===
        externalApplicationId
    ) {
      proposals[i] = {
        .../** @type {Record<string, unknown>} */ (row),
        applied: true,
        applied_at: appliedAt,
        applied_by: userId,
        blocked_reason: null,
      };
    }
  }

  const nextPayload = {
    ...payload,
    proposals,
    applied_transition_id: String(transitionResult.transition.id),
    last_manual_action_at: appliedAt,
    last_manual_action: "apply",
  };

  await persistLifecycleProposalsPayload(supabase, {
    coordinationRecordId,
    projectId,
    record,
    payload: nextPayload,
  });

  emitUciEvent(
    "uci.lifecycle.proposal_applied",
    {
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      external_application_id: externalApplicationId,
      transition_id: transitionResult.transition.id,
      user_id: userId,
    },
    { supabase },
  );

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    external_application_id: externalApplicationId,
    proposal_checksum: expectedChecksum,
    transition: transitionResult.transition,
    coordination: transitionResult.record,
    lifecycle_proposals: nextPayload,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function rejectLifecycleProposal(supabase, params) {
  const {
    coordinationRecordId,
    projectId,
    userId,
    externalApplicationId,
    proposalChecksum,
    reason,
  } = params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record || String(record.project_id) !== projectId) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const payload = getLifecycleProposalsPayload(record.metadata);
  if (!payload) {
    const err = new Error("No lifecycle proposals available");
    err.statusCode = 404;
    err.code = "NO_PROPOSALS";
    throw err;
  }

  const proposal = findProposalRow(payload, externalApplicationId);
  if (!proposal || typeof proposal !== "object") {
    const err = new Error("Lifecycle proposal not found");
    err.statusCode = 404;
    err.code = "PROPOSAL_NOT_FOUND";
    throw err;
  }

  const proposalRec = /** @type {Record<string, unknown>} */ (proposal);

  if (proposalRec.applied === true) {
    const err = new Error("Lifecycle proposal already applied");
    err.statusCode = 409;
    err.code = "PROPOSAL_ALREADY_APPLIED";
    throw err;
  }

  const lastEvaluatedAt = String(payload.last_evaluated_at || "");
  const expectedChecksum = computeLifecycleProposalChecksum(proposalRec, lastEvaluatedAt);
  if (String(proposalChecksum || "") !== expectedChecksum) {
    const err = new Error("Lifecycle proposal is stale; refresh and try again");
    err.statusCode = 409;
    err.code = "PROPOSAL_STALE";
    throw err;
  }

  const rejectedAt = new Date().toISOString();
  const proposals = Array.isArray(payload.proposals) ? [...payload.proposals] : [];
  for (let i = 0; i < proposals.length; i += 1) {
    const row = proposals[i];
    if (
      row &&
      typeof row === "object" &&
      String(/** @type {Record<string, unknown>} */ (row).external_application_id || "") ===
        externalApplicationId
    ) {
      proposals[i] = {
        .../** @type {Record<string, unknown>} */ (row),
        rejected: true,
        rejected_at: rejectedAt,
        rejected_by: userId,
        rejection_reason: reason ? String(reason).slice(0, 500) : null,
      };
    }
  }

  const nextPayload = {
    ...payload,
    proposals,
    last_manual_action_at: rejectedAt,
    last_manual_action: "reject",
  };

  await persistLifecycleProposalsPayload(supabase, {
    coordinationRecordId,
    projectId,
    record,
    payload: nextPayload,
  });

  emitUciEvent(
    "uci.lifecycle.proposal_rejected",
    {
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      external_application_id: externalApplicationId,
      user_id: userId,
    },
    { supabase },
  );

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    external_application_id: externalApplicationId,
    proposal_checksum: expectedChecksum,
    lifecycle_proposals: nextPayload,
  };
}

module.exports = {
  computeLifecycleProposalChecksum,
  applyLifecycleProposal,
  rejectLifecycleProposal,
};
