"use strict";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} projectId
 */
async function getProjectPortfolioView(supabase, projectId) {
  const [recordsResult, commsResult] = await Promise.all([
    supabase
      .from("coordination_records")
      .select(
        "id, utility_type, current_stage, current_stage_state, utility_provider_id, metadata, created_at, updated_at",
      )
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("coordination_communications")
      .select("id, coordination_record_id, needs_human_attention, classification")
      .eq("project_id", projectId)
      .or(
        "needs_human_attention.eq.true,classification.is.null,classification.eq.unclassified,classification_confidence.lt.0.75",
      ),
  ]);

  if (recordsResult.error) {
    throw Object.assign(new Error(recordsResult.error.message || "Failed to load portfolio"), {
      statusCode: 500,
      code: "PORTFOLIO_FETCH_FAILED",
    });
  }

  const records = Array.isArray(recordsResult.data) ? recordsResult.data : [];
  const attentionComms = Array.isArray(commsResult.data) ? commsResult.data : [];

  const stageSummary = {};
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
      current_stage: r.current_stage,
      current_stage_state: r.current_stage_state,
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
    })),
    generated_at: new Date().toISOString(),
    version: "d11-v1",
  };
}

module.exports = {
  getProjectPortfolioView,
};
