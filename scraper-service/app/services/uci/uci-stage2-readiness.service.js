"use strict";

/**
 * Canonical Stage 2 readiness / progress model.
 * Progress % , blocking issues, lifecycle state, and completion eligibility
 * are derived from one result. The six buckets are a stable denominator —
 * extra findings do not add requirements.
 */

const STAGE2_READINESS_BUCKETS = [
  "source_evidence",
  "engineering_inputs",
  "load_schedule",
  "service_sizing",
  "review_queue",
  "package_readiness",
];

const ELECTRIC_STAGE_2_REQUIREMENTS = {
  connected_equipment_or_load_data: [
    "connected_load_kw",
    "connected_load_kva",
    "demand_load_kw",
    "demand_load_kva",
    "connected_equipment_or_load_data",
  ],
  requested_voltage: ["requested_voltage", "service_voltage"],
  phase: ["phase"],
  service_configuration: ["service_configuration", "wire_configuration"],
};

const GAS_STAGE_2_REQUIREMENTS = {
  connected_gas_equipment: ["connected_gas_equipment", "connected_load_btuh"],
  btu_demand: ["btu_demand", "requested_load_btuh"],
  pressure_requirements: ["pressure_requirements"],
  meter_count: ["meter_count"],
};

const WATER_STAGE_2_REQUIREMENTS = {
  fixture_or_demand_data: ["fixture_or_demand_data"],
  gpm_or_dfu: ["gpm_or_dfu"],
  meter_or_service_size: ["meter_or_service_size"],
};

const SEWER_STAGE_2_REQUIREMENTS = {
  fixture_units_or_flow: ["fixture_units_or_flow"],
  connection_requirements: ["connection_requirements"],
};

const TELECOM_STAGE_2_REQUIREMENTS = {
  service_count: ["service_count"],
  service_type: ["service_type"],
  demarcation_location: ["demarcation_location"],
};

const PROJECT_DEMAND_KEYS = new Set(["demand_load_kw", "demand_load_kva"]);

/**
 * @param {unknown} utilityType
 * @returns {string}
 */
function normalizeUtilityType(utilityType) {
  return String(utilityType ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {unknown} entry
 */
function verifiedEntryHasValue(entry) {
  return Boolean(
    entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      entry.value != null &&
      entry.value !== "",
  );
}

/**
 * @param {unknown} loadSummary
 * @returns {Record<string, unknown>}
 */
function verifiedMap(loadSummary) {
  const verified =
    loadSummary?.verified_values &&
    typeof loadSummary.verified_values === "object" &&
    !Array.isArray(loadSummary.verified_values)
      ? /** @type {Record<string, unknown>} */ (loadSummary.verified_values)
      : {};
  return verified;
}

/**
 * Stable Stage 2 requirement catalog per utility type.
 * @param {unknown} utilityType
 * @returns {Record<string, string[]>}
 */
function stage2RequirementCatalog(utilityType) {
  const t = normalizeUtilityType(utilityType);
  if (t === "electric") return ELECTRIC_STAGE_2_REQUIREMENTS;
  if (t === "gas") return GAS_STAGE_2_REQUIREMENTS;
  if (t === "water") return WATER_STAGE_2_REQUIREMENTS;
  if (t === "sewer") return SEWER_STAGE_2_REQUIREMENTS;
  if (t === "telecom") return TELECOM_STAGE_2_REQUIREMENTS;
  return { utility_specific_load_data: ["utility_specific_load_data"] };
}

/**
 * Keys that can satisfy a catalog requirement.
 * @param {string} requirement
 * @param {string[]} catalogKeys
 */
function keysForRequirement(requirement, catalogKeys) {
  return catalogKeys.length ? catalogKeys : [requirement];
}

/**
 * @param {unknown} loadSummary
 * @returns {string[]}
 */
function getStage2MissingInputs(loadSummary) {
  const catalog = stage2RequirementCatalog(loadSummary?.utility_type);
  const verified = verifiedMap(loadSummary);
  return Object.entries(catalog)
    .filter(([, keys]) => !keys.some((key) => verifiedEntryHasValue(verified[key])))
    .map(([requirement]) => requirement);
}

/**
 * @param {unknown} loadSummary
 */
function hasSourceEvidence(loadSummary) {
  if (!loadSummary || typeof loadSummary !== "object") return false;
  const summary = /** @type {Record<string, unknown>} */ (loadSummary);
  if (Array.isArray(summary.source_documents) && summary.source_documents.length > 0) return true;
  const extraction =
    summary.load_extraction && typeof summary.load_extraction === "object"
      ? /** @type {Record<string, unknown>} */ (summary.load_extraction)
      : null;
  if (extraction?.last_extracted_at) return true;
  if (Array.isArray(extraction?.source_document_ranking) && extraction.source_document_ranking.length > 0) {
    return true;
  }
  const candidates = Array.isArray(summary.candidate_values) ? summary.candidate_values : [];
  if (
    candidates.some(
      (candidate) =>
        candidate &&
        candidate.status !== "stale" &&
        candidate.status !== "rejected",
    )
  ) {
    return true;
  }
  const verified = verifiedMap(summary);
  if (Object.values(verified).some((entry) => verifiedEntryHasValue(entry))) return true;
  const inputs = Array.isArray(summary.inputs_used) ? summary.inputs_used : [];
  if (inputs.some((input) => String(input?.key ?? "").startsWith("document:"))) return true;
  return false;
}

/**
 * @param {unknown} loadSummary
 */
function hasVerifiedProjectDemand(loadSummary) {
  const verified = verifiedMap(loadSummary);
  return [...PROJECT_DEMAND_KEYS].some((key) => verifiedEntryHasValue(verified[key]));
}

/**
 * @param {unknown} loadSummary
 * @param {string[]} missingInputs
 */
function isLoadScheduleComplete(loadSummary, missingInputs) {
  const utilityType = normalizeUtilityType(loadSummary?.utility_type);
  const verified = verifiedMap(loadSummary);
  if (utilityType === "gas") {
    return (
      verifiedEntryHasValue(verified.connected_load_btuh) ||
      verifiedEntryHasValue(verified.btu_demand) ||
      verifiedEntryHasValue(verified.requested_load_btuh) ||
      verifiedEntryHasValue(verified.connected_gas_equipment)
    );
  }
  if (utilityType !== "electric") {
    return missingInputs.length === 0;
  }
  return hasVerifiedProjectDemand(loadSummary);
}

/**
 * @param {unknown} loadSummary
 * @param {string[]} missingInputs
 */
function isServiceSizingComplete(loadSummary, missingInputs) {
  const utilityType = normalizeUtilityType(loadSummary?.utility_type);
  const calculated =
    loadSummary?.calculated_values &&
    typeof loadSummary.calculated_values === "object" &&
    !Array.isArray(loadSummary.calculated_values)
      ? /** @type {Record<string, unknown>} */ (loadSummary.calculated_values)
      : {};
  if (calculated.service_size) return true;

  const verified = verifiedMap(loadSummary);
  if (utilityType === "gas") {
    return (
      verifiedEntryHasValue(verified.pressure_requirements) &&
      (verifiedEntryHasValue(verified.requested_service_line) ||
        verifiedEntryHasValue(verified.gas_regulator) ||
        verifiedEntryHasValue(verified.connected_load_btuh) ||
        verifiedEntryHasValue(verified.btu_demand))
    );
  }
  if (utilityType !== "electric") {
    return missingInputs.length === 0;
  }
  const hasDemand = hasVerifiedProjectDemand(loadSummary);
  const hasVoltage =
    verifiedEntryHasValue(verified.requested_voltage) ||
    verifiedEntryHasValue(verified.service_voltage);
  const hasPhase = verifiedEntryHasValue(verified.phase);
  if (verifiedEntryHasValue(verified.service_amperage) && hasDemand && hasVoltage && hasPhase) {
    return true;
  }
  return false;
}

/**
 * Review queue is complete only when required inputs are resolved and no
 * blocking candidates remain. An empty candidate list is not vacuously complete.
 *
 * @param {unknown} loadSummary
 * @param {string[]} missingInputs
 */
function isReviewQueueResolved(loadSummary, missingInputs) {
  const catalog = stage2RequirementCatalog(loadSummary?.utility_type);
  const candidates = Array.isArray(loadSummary?.candidate_values)
    ? loadSummary.candidate_values
    : [];
  const pending = candidates.filter((candidate) => candidate && candidate.status === "candidate");
  const blocking = pending.filter((candidate) =>
    missingInputs.some((input) =>
      keysForRequirement(input, catalog[input] || []).includes(String(candidate.field_key ?? "")),
    ),
  );
  if (blocking.length > 0) return false;
  if (missingInputs.length > 0) return false;
  return true;
}

/**
 * @param {string} key
 * @param {boolean} complete
 * @param {string} detail
 */
function bucket(key, complete, detail) {
  return { key, complete: Boolean(complete), detail };
}

/**
 * @param {unknown} loadSummary
 * @param {{ stageCompleted?: boolean }} [options]
 */
function computeStage2Readiness(loadSummary, options = {}) {
  const previous =
    loadSummary?.stage2_readiness &&
    typeof loadSummary.stage2_readiness === "object" &&
    !Array.isArray(loadSummary.stage2_readiness)
      ? /** @type {Record<string, unknown>} */ (loadSummary.stage2_readiness)
      : null;

  if (!loadSummary || typeof loadSummary !== "object") {
    return {
      version: "stage2-readiness-v1",
      progress_percent: 0,
      completion_eligible: false,
      complete: false,
      lifecycle_state: "not_analyzed",
      lifecycle_state_label: "Not analyzed",
      missing_required_inputs: [],
      newly_discovered_required_inputs: [],
      progress_decrease_reason: null,
      blocking_issues: ["Run load profile analysis to begin"],
      buckets: STAGE2_READINESS_BUCKETS.map((key) =>
        bucket(key, false, "Load profile has not been analyzed"),
      ),
    };
  }

  if (loadSummary.analysis_status === "blocked") {
    return {
      version: "stage2-readiness-v1",
      progress_percent: 0,
      completion_eligible: false,
      complete: false,
      lifecycle_state: "blocked",
      lifecycle_state_label: "Blocked",
      missing_required_inputs: getStage2MissingInputs(loadSummary),
      newly_discovered_required_inputs: [],
      progress_decrease_reason: null,
      blocking_issues: ["Load profile analysis is blocked"],
      buckets: STAGE2_READINESS_BUCKETS.map((key) => bucket(key, false, "Analysis is blocked")),
    };
  }

  const missingRequired = getStage2MissingInputs(loadSummary);
  const sourceComplete = hasSourceEvidence(loadSummary);
  const engineeringComplete = missingRequired.length === 0;
  const catalog = stage2RequirementCatalog(loadSummary.utility_type);
  const requiredCount = Object.keys(catalog).length;
  const resolvedCount = requiredCount - missingRequired.length;
  const loadScheduleComplete = isLoadScheduleComplete(loadSummary, missingRequired);
  const serviceSizingComplete = isServiceSizingComplete(loadSummary, missingRequired);
  const reviewComplete = isReviewQueueResolved(loadSummary, missingRequired);
  const packageComplete =
    sourceComplete &&
    engineeringComplete &&
    loadScheduleComplete &&
    serviceSizingComplete &&
    reviewComplete;

  const buckets = [
    bucket(
      "source_evidence",
      sourceComplete,
      sourceComplete
        ? "Source evidence is available for this coordination"
        : "No source documents or extracted evidence yet",
    ),
    bucket(
      "engineering_inputs",
      engineeringComplete,
      engineeringComplete
        ? "Required engineering inputs are resolved"
        : `${missingRequired.length} required engineering input${
            missingRequired.length === 1 ? "" : "s"
          } still missing`,
    ),
    bucket(
      "load_schedule",
      loadScheduleComplete,
      loadScheduleComplete
        ? "Load schedule inputs are complete"
        : "Verified load / demand values are still required",
    ),
    bucket(
      "service_sizing",
      serviceSizingComplete,
      serviceSizingComplete
        ? "Service sizing inputs are complete"
        : "Service sizing still needs verified inputs",
    ),
    bucket(
      "review_queue",
      reviewComplete,
      reviewComplete
        ? "No blocking review items remain"
        : missingRequired.length > 0
          ? "Required inputs still need verification or evidence"
          : "Blocking candidates remain in the review queue",
    ),
    bucket(
      "package_readiness",
      packageComplete,
      packageComplete
        ? "Stage 2 package readiness is complete"
        : "Package readiness is incomplete until the other Stage 2 buckets are resolved",
    ),
  ];

  const earned =
    (sourceComplete ? 1 : 0) +
    (requiredCount > 0 ? resolvedCount / requiredCount : 0) +
    (loadScheduleComplete ? 1 : 0) +
    (serviceSizingComplete ? 1 : 0) +
    (reviewComplete ? 1 : 0) +
    (packageComplete ? 1 : 0);
  let progressPercent = Math.round((earned / STAGE2_READINESS_BUCKETS.length) * 100);

  const previousMissing = new Set(
    Array.isArray(previous?.missing_required_inputs)
      ? previous.missing_required_inputs.map(String)
      : [],
  );
  const newlyDiscovered =
    previous == null
      ? []
      : missingRequired.filter((input) => !previousMissing.has(input));

  let progressDecreaseReason = null;
  const previousPercent =
    previous && Number.isFinite(Number(previous.progress_percent))
      ? Number(previous.progress_percent)
      : null;

  if (previousPercent != null && progressPercent < previousPercent) {
    if (newlyDiscovered.length > 0) {
      progressDecreaseReason = `${newlyDiscovered.length} additional required input${
        newlyDiscovered.length === 1 ? "" : "s"
      } discovered from document analysis.`;
    } else {
      progressPercent = previousPercent;
    }
  }

  const blockingIssues = [];
  if (!sourceComplete) blockingIssues.push("Source evidence is not available yet");
  for (const input of missingRequired) {
    blockingIssues.push(`Missing required input: ${input.replace(/_/g, " ")}`);
  }
  if (sourceComplete && engineeringComplete && !loadScheduleComplete) {
    blockingIssues.push("Load schedule is incomplete");
  }
  if (sourceComplete && engineeringComplete && !serviceSizingComplete) {
    blockingIssues.push("Service sizing is incomplete");
  }
  if (!reviewComplete && missingRequired.length === 0) {
    blockingIssues.push("Review queue still has blocking candidates");
  }
  if (progressDecreaseReason) blockingIssues.unshift(progressDecreaseReason);

  const completionEligible = packageComplete && blockingIssues.filter((issue) => issue !== progressDecreaseReason).length === 0;
  const stageCompleted = options.stageCompleted === true;
  const complete = stageCompleted && completionEligible;

  let lifecycleState = "extraction_available";
  let lifecycleLabel = "Extraction available";
  if (complete) {
    lifecycleState = "ready_for_application_package";
    lifecycleLabel = "Stage 2 complete";
  } else if (!sourceComplete) {
    lifecycleState = "not_analyzed";
    lifecycleLabel = "Not analyzed";
  } else if (!reviewComplete && Array.isArray(loadSummary.candidate_values) && loadSummary.candidate_values.some((c) => c.status === "candidate" && missingRequired.some((input) => keysForRequirement(input, catalog[input] || []).includes(String(c.field_key ?? ""))))) {
    lifecycleState = "needs_review";
    lifecycleLabel = "Needs review";
  } else if (!engineeringComplete) {
    lifecycleState = "missing_engineering_inputs";
    lifecycleLabel = "Missing engineering inputs";
  } else if (!serviceSizingComplete) {
    lifecycleState = "ready_for_service_sizing";
    lifecycleLabel = "Ready for service sizing";
  } else if (completionEligible) {
    lifecycleState = "ready_for_application_package";
    lifecycleLabel = "Ready for application package";
  }

  return {
    version: "stage2-readiness-v1",
    progress_percent: complete ? 100 : progressPercent,
    completion_eligible: completionEligible,
    complete,
    lifecycle_state: lifecycleState,
    lifecycle_state_label: complete ? "Stage 2 complete" : lifecycleLabel,
    missing_required_inputs: missingRequired,
    newly_discovered_required_inputs: newlyDiscovered,
    progress_decrease_reason: progressDecreaseReason,
    blocking_issues: complete ? [] : blockingIssues,
    buckets,
  };
}

module.exports = {
  STAGE2_READINESS_BUCKETS,
  ELECTRIC_STAGE_2_REQUIREMENTS,
  GAS_STAGE_2_REQUIREMENTS,
  normalizeUtilityType,
  verifiedEntryHasValue,
  stage2RequirementCatalog,
  getStage2MissingInputs,
  computeStage2Readiness,
};
