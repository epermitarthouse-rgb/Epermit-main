"use strict";

const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("./uci-load-profile.service.js");
const { APPLICATION_PACKAGE_IDEMPOTENCY_KEY } = require("./uci-application-builder.service.js");
const { COS_COMPARE_FIELDS } = require("./uci-cos-constants.js");

/**
 * @param {unknown} entry
 */
function unwrapVerified(entry) {
  if (entry == null) return null;
  if (typeof entry === "object" && !Array.isArray(entry)) {
    const obj = /** @type {Record<string, unknown>} */ (entry);
    if (obj.value != null && obj.value !== "") {
      return {
        value: obj.value,
        unit: obj.unit ?? null,
        source: "verified_load_profile",
        provenance: "verified_project_input",
      };
    }
  }
  if (entry !== "") {
    return {
      value: entry,
      unit: null,
      source: "calculated_or_scalar",
      provenance: "verified_project_input",
    };
  }
  return null;
}

/**
 * Pick first present alias from verified_values then calculated_values then package summary.
 * @param {Record<string, unknown>} verified
 * @param {Record<string, unknown>} calculated
 * @param {Record<string, unknown>} packageFields
 * @param {string[]} aliases
 */
function pickBaseline(verified, calculated, packageFields, aliases) {
  for (const key of aliases) {
    const v = unwrapVerified(verified[key]);
    if (v) return { ...v, field_key: key, baseline_source: "verified_values" };
  }
  for (const key of aliases) {
    if (calculated[key] != null && calculated[key] !== "") {
      return {
        value: calculated[key],
        unit: null,
        source: "calculated_values",
        provenance: "verified_project_input",
        field_key: key,
        baseline_source: "calculated_values",
      };
    }
  }
  for (const key of aliases) {
    if (packageFields[key] != null && packageFields[key] !== "") {
      return {
        value: packageFields[key],
        unit: null,
        source: "application_package",
        provenance: "verified_project_input",
        field_key: key,
        baseline_source: "application_package",
      };
    }
  }
  return null;
}

/**
 * Load compare baseline from verified Load Profile + Application Builder package only.
 * Does not invent engineering values.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} params.projectId
 */
async function loadCosComparisonBaseline(supabase, params) {
  const { coordinationRecordId, projectId } = params;

  const { data: applications, error } = await supabase
    .from("coordination_applications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load applications for COS baseline"), {
      cause: error,
      statusCode: 500,
      code: "COS_BASELINE_FETCH_FAILED",
    });
  }

  const apps = Array.isArray(applications) ? applications : [];
  const loadProfile = apps.find(
    (a) =>
      String(a.record_source) === "agent_draft" &&
      String(a.idempotency_key) === LOAD_PROFILE_IDEMPOTENCY_KEY,
  );
  const packageApp = apps.find(
    (a) =>
      String(a.record_source) === "agent_draft" &&
      String(a.idempotency_key) === APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
  );

  const loadSummary =
    loadProfile?.load_summary &&
    typeof loadProfile.load_summary === "object" &&
    !Array.isArray(loadProfile.load_summary)
      ? /** @type {Record<string, unknown>} */ (loadProfile.load_summary)
      : {};

  const verified =
    loadSummary.verified_values &&
    typeof loadSummary.verified_values === "object" &&
    !Array.isArray(loadSummary.verified_values)
      ? /** @type {Record<string, unknown>} */ (loadSummary.verified_values)
      : {};

  const calculated =
    loadSummary.calculated_values &&
    typeof loadSummary.calculated_values === "object" &&
    !Array.isArray(loadSummary.calculated_values)
      ? /** @type {Record<string, unknown>} */ (loadSummary.calculated_values)
      : {};

  const packageMeta =
    packageApp?.agent_draft_metadata &&
    typeof packageApp.agent_draft_metadata === "object" &&
    !Array.isArray(packageApp.agent_draft_metadata)
      ? /** @type {Record<string, unknown>} */ (packageApp.agent_draft_metadata)
      : {};

  const packageSummary =
    (packageMeta.application_package &&
    typeof packageMeta.application_package === "object" &&
    !Array.isArray(packageMeta.application_package)
      ? /** @type {Record<string, unknown>} */ (packageMeta.application_package)
      : {}) || {};

  const packageLoad =
    (packageSummary.load_summary &&
    typeof packageSummary.load_summary === "object" &&
    !Array.isArray(packageSummary.load_summary)
      ? /** @type {Record<string, unknown>} */ (packageSummary.load_summary)
      : packageApp?.load_summary &&
          typeof packageApp.load_summary === "object" &&
          !Array.isArray(packageApp.load_summary)
        ? /** @type {Record<string, unknown>} */ (packageApp.load_summary)
        : {}) || {};

  const packageFields = {
    ...((packageLoad.calculated_values &&
    typeof packageLoad.calculated_values === "object" &&
    !Array.isArray(packageLoad.calculated_values)
      ? packageLoad.calculated_values
      : {})),
    ...((packageLoad.verified_values &&
    typeof packageLoad.verified_values === "object" &&
    !Array.isArray(packageLoad.verified_values)
      ? Object.fromEntries(
          Object.entries(packageLoad.verified_values).map(([k, v]) => [
            k,
            v && typeof v === "object" && "value" in /** @type {any} */ (v)
              ? /** @type {any} */ (v).value
              : v,
          ]),
        )
      : {})),
    ...(packageSummary.requested_service && typeof packageSummary.requested_service === "object"
      ? /** @type {Record<string, unknown>} */ (packageSummary.requested_service)
      : {}),
  };

  /** @type {Record<string, unknown>} */
  const baseline = {};
  for (const def of COS_COMPARE_FIELDS) {
    const picked = pickBaseline(verified, calculated, packageFields, def.aliases);
    if (picked) baseline[def.key] = picked;
  }

  const missingInputs = Array.isArray(loadSummary.missing_inputs)
    ? loadSummary.missing_inputs.map((x) => String(x))
    : [];

  return {
    baseline_fields: baseline,
    load_profile_present: Boolean(loadProfile),
    application_package_present: Boolean(packageApp),
    missing_inputs: missingInputs,
    has_verified_or_calculated: Object.keys(baseline).length > 0,
    load_profile_id: loadProfile?.id ?? null,
    application_package_id: packageApp?.id ?? null,
  };
}

module.exports = {
  loadCosComparisonBaseline,
  pickBaseline,
  unwrapVerified,
};
