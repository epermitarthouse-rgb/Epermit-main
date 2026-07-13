"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("./uci-load-profile.service.js");

const COS_ANALYSIS_VERSION = "d6-v1";

const COS_TRIGGER_CLASSIFICATIONS = new Set(["class_of_service", "design_review_response"]);

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} params.userId
 */
async function runCosDiscrepancyAnalysis(supabase, params) {
  const { coordinationRecordId, userId } = params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);

  const [appsResult, commsResult] = await Promise.all([
    supabase
      .from("coordination_applications")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId),
    supabase
      .from("coordination_communications")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .in("classification", [...COS_TRIGGER_CLASSIFICATIONS]),
  ]);

  if (appsResult.error || commsResult.error) {
    throw Object.assign(new Error("Failed to load COS analysis inputs"), {
      statusCode: 500,
      code: "COS_FETCH_FAILED",
    });
  }

  const applications = Array.isArray(appsResult.data) ? appsResult.data : [];
  const loadProfile = applications.find(
    (a) =>
      String(a.record_source) === "agent_draft" &&
      String(a.idempotency_key) === LOAD_PROFILE_IDEMPOTENCY_KEY,
  );

  const loadSummary =
    loadProfile?.load_summary &&
    typeof loadProfile.load_summary === "object" &&
    !Array.isArray(loadProfile.load_summary)
      ? /** @type {Record<string, unknown>} */ (loadProfile.load_summary)
      : null;

  const missingInputs = Array.isArray(loadSummary?.missing_inputs)
    ? loadSummary.missing_inputs.map((x) => String(x))
    : [];

  const communications = Array.isArray(commsResult.data) ? commsResult.data : [];

  /** @type {Array<Record<string, unknown>>} */
  const discrepancies = [];

  if (!loadProfile) {
    discrepancies.push({
      code: "LOAD_PROFILE_MISSING",
      severity: "high",
      message: "No D2.1 load profile draft to compare against COS/design communications",
    });
  }

  if (!communications.length) {
    discrepancies.push({
      code: "COS_COMMUNICATION_MISSING",
      severity: "medium",
      message:
        "No classified class_of_service or design_review_response communications found — classify portal messages first",
    });
  }

  if (missingInputs.length) {
    discrepancies.push({
      code: "LOAD_INPUTS_INCOMPLETE",
      severity: "high",
      message: "Load profile still has missing inputs that may conflict with COS/design review",
      missing_inputs: missingInputs,
    });
  }

  const calculated =
    loadSummary?.calculated_values &&
    typeof loadSummary.calculated_values === "object" &&
    !Array.isArray(loadSummary.calculated_values)
      ? loadSummary.calculated_values
      : {};
  if (!Object.keys(/** @type {Record<string, unknown>} */ (calculated)).length) {
    discrepancies.push({
      code: "NO_VERIFIED_LOAD_VALUES",
      severity: "medium",
      message: "No verified engineering values in load profile — COS comparison is structural only",
    });
  }

  const analysisStatus =
    discrepancies.some((d) => d.severity === "high") ? "needs_attention" : "preliminary";

  const generatedAt = new Date().toISOString();
  const analysis = {
    version: COS_ANALYSIS_VERSION,
    analysis_status: analysisStatus,
    discrepancies,
    trigger_communication_count: communications.length,
    load_profile_present: Boolean(loadProfile),
    generated_at: generatedAt,
    generated_by_user_id: userId,
    requires_human_review: true,
    notes: ["D6 foundation — no document parsing; structural discrepancy inventory only"],
  };

  const existingMetadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  const { data: updated, error } = await supabase
    .from("coordination_records")
    .update({
      metadata: {
        ...existingMetadata,
        uci_cos_analysis: analysis,
      },
    })
    .eq("id", coordinationRecordId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to store COS analysis"), {
      cause: error,
      statusCode: 500,
      code: "COS_UPDATE_FAILED",
    });
  }

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    analysis,
    record: updated,
    stage_unchanged: true,
  };
}

module.exports = {
  COS_ANALYSIS_VERSION,
  COS_TRIGGER_CLASSIFICATIONS,
  runCosDiscrepancyAnalysis,
};
