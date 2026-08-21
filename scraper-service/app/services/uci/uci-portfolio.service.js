"use strict";

const {
  isActionableNeedsAttentionCommunication,
  LOW_CONFIDENCE_THRESHOLD,
} = require("./uci-needs-attention.util.js");

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} projectId
 */
async function getProjectPortfolioView(supabase, projectId) {
  const [recordsResult, commsResult] = await Promise.all([
    supabase
      .from("coordination_records")
      .select(
        "id, utility_type, current_stage, current_stage_state, utility_provider_id, acknowledgment_received_at, predicted_p50_date, predicted_p90_date, prediction_baseline_source, prediction_reason, metadata, created_at, updated_at",
      )
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("coordination_communications")
      .select(
        "id, coordination_record_id, direction, classification, classification_confidence, needs_human_attention, reviewed_at, reviewed_by, raw_subject, sender, recipient, agent_processed_metadata",
      )
      .eq("project_id", projectId)
      .or(
        `needs_human_attention.eq.true,classification.is.null,classification.eq.unclassified,classification_confidence.lt.${LOW_CONFIDENCE_THRESHOLD}`,
      ),
  ]);

  if (recordsResult.error) {
    throw Object.assign(new Error(recordsResult.error.message || "Failed to load portfolio"), {
      statusCode: 500,
      code: "PORTFOLIO_FETCH_FAILED",
    });
  }

  const records = Array.isArray(recordsResult.data) ? recordsResult.data : [];
  const candidateComms = Array.isArray(commsResult.data) ? commsResult.data : [];
  const recordsById = new Map(records.map((r) => [String(r.id), r]));
  const attentionComms = candidateComms.filter((comm) =>
    isActionableNeedsAttentionCommunication(comm, recordsById.get(String(comm.coordination_record_id))),
  );

  const attentionCountByRecord = new Map();
  for (const comm of attentionComms) {
    const recordId = String(comm.coordination_record_id || "");
    attentionCountByRecord.set(recordId, (attentionCountByRecord.get(recordId) || 0) + 1);
  }

  const stageSummary = {};
  /** Current-position counts only — not lifecycle completion history. */
  for (let stage = 1; stage <= 10; stage += 1) {
    stageSummary[stage] = 0;
  }

  for (const record of records) {
    const stage = Number(record.current_stage);
    if (Number.isInteger(stage) && stage >= 1 && stage <= 10) {
      stageSummary[stage] += 1;
    }
  }

  return {
    project_id: projectId,
    coordination_record_count: records.length,
    needs_attention_communication_count: attentionComms.length,
    stage_summary: stageSummary,
    records: records.map((r) => ({
      id: r.id,
      utility_type: r.utility_type,
      utility_provider_id: r.utility_provider_id ?? null,
      current_stage: r.current_stage,
      current_stage_state: r.current_stage_state,
      needs_attention_count: attentionCountByRecord.get(String(r.id)) || 0,
      has_cos_analysis: Boolean(
        r.metadata &&
          typeof r.metadata === "object" &&
          /** @type {{ uci_cos_analysis?: unknown }} */ (r.metadata).uci_cos_analysis,
      ),
      has_closeout_package: Boolean(
        r.metadata &&
          typeof r.metadata === "object" &&
          /** @type {{ uci_closeout_package?: unknown }} */ (r.metadata).uci_closeout_package,
      ),
      predicted_p50_date: r.predicted_p50_date ?? null,
      predicted_p90_date: r.predicted_p90_date ?? null,
      prediction_baseline_source: r.prediction_baseline_source ?? null,
      typical_label: "Typical (P50)",
      conservative_label: "Conservative (P90)",
      updated_at: r.updated_at,
    })),
    generated_at: new Date().toISOString(),
    version: "d11-v1",
  };
}

module.exports = {
  getProjectPortfolioView,
};
