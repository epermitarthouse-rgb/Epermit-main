"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");
const { resolveProjectAddressForProviderSetup } = require("./uci-provider-setup.service.js");
const { recordSystemTransition } = require("./uci-transitions.service.js");

const LOAD_PROFILE_VERSION = "d2.1-v1";
const LOAD_PROFILE_IDEMPOTENCY_KEY = "agent_2_load_profile:d2.1-v1";
const GENERATED_BY = "agent_2_load_profile";

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

/** Engineering numerics that must never be inferred. */
const FORBIDDEN_INFERRED_KEYS = new Set([
  "kw",
  "kilowatts",
  "amperage",
  "amps",
  "amperes",
  "service_voltage",
  "voltage",
  "phase",
  "meter_count",
  "btu",
  "btu_h",
  "btuh",
  "gpm",
  "dfu",
  "service_size",
]);

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
 * @param {Record<string, unknown>} record
 * @returns {{ ok: true, mapping: Record<string, unknown> | null } | { ok: false, code: string, message: string }}
 */
function validateProviderContext(record) {
  const providerId = record.utility_provider_id;
  if (!providerId) {
    return {
      ok: false,
      code: "PROVIDER_CONTEXT_REQUIRED",
      message: "Coordination record has no utility provider assigned",
    };
  }

  const utilityType = normalizeUtilityType(record.utility_type);
  if (!utilityType) {
    return {
      ok: false,
      code: "UTILITY_TYPE_REQUIRED",
      message: "Coordination record has no utility type",
    };
  }

  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};

  const mappingRaw = metadata.uci_provider_mapping;
  const mapping =
    mappingRaw && typeof mappingRaw === "object" && !Array.isArray(mappingRaw)
      ? /** @type {Record<string, unknown>} */ (mappingRaw)
      : null;

  return { ok: true, mapping };
}

/**
 * @param {Record<string, unknown>} record
 * @param {Record<string, unknown> | null} mapping
 * @returns {string[]}
 */
function collectNeedsVerification(record, mapping) {
  /** @type {string[]} */
  const flags = [];

  if (!mapping) {
    flags.push("provider_mapping_not_human_confirmed");
  } else if (mapping.method !== "human_assisted") {
    flags.push("provider_mapping_method_unverified");
  }

  if (mapping && mapping.territory_matching_available === true) {
    flags.push("territory_matching_claimed");
  } else if (mapping) {
    flags.push("territory_not_auto_verified");
  }

  const unresolved = Array.isArray(mapping?.unresolved_utility_types)
    ? mapping.unresolved_utility_types.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
    : [];
  const recordUtility = normalizeUtilityType(record.utility_type);
  if (unresolved.includes(recordUtility)) {
    flags.push(`utility_type_marked_unresolved:${recordUtility}`);
  }

  return flags;
}

/**
 * @param {string} utilityType
 * @returns {string[]}
 */
function requiredInputsForUtilityType(utilityType) {
  const t = normalizeUtilityType(utilityType);
  if (t === "electric") {
    return [
      "connected_equipment_or_load_data",
      "requested_voltage",
      "phase",
      "meter_count",
      "service_configuration",
    ];
  }
  if (t === "gas") {
    return [
      "connected_gas_equipment",
      "btu_demand",
      "pressure_requirements",
      "meter_count",
    ];
  }
  if (t === "water") {
    return ["fixture_or_demand_data", "gpm_or_dfu", "meter_or_service_size"];
  }
  if (t === "sewer") {
    return ["fixture_units_or_flow", "connection_requirements"];
  }
  if (t === "telecom") {
    return ["service_count", "service_type", "demarcation_location"];
  }
  return ["utility_specific_load_data"];
}

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
 * Stage 2 readiness is intentionally narrower than the historical extraction
 * inventory. Project metadata, documents, meter count, and construction dates
 * may support later package work, but they do not block load/service sizing.
 *
 * @param {Record<string, unknown>} loadSummary
 */
function getStage2MissingInputs(loadSummary) {
  const utilityType = normalizeUtilityType(loadSummary?.utility_type);
  const verified =
    loadSummary?.verified_values &&
    typeof loadSummary.verified_values === "object" &&
    !Array.isArray(loadSummary.verified_values)
      ? /** @type {Record<string, unknown>} */ (loadSummary.verified_values)
      : {};

  if (utilityType === "electric") {
    return Object.entries(ELECTRIC_STAGE_2_REQUIREMENTS)
      .filter(([, keys]) => !keys.some((key) => verifiedEntryHasValue(verified[key])))
      .map(([requirement]) => requirement);
  }

  const historicalMissing = Array.isArray(loadSummary?.missing_inputs)
    ? loadSummary.missing_inputs.map(String)
    : [];
  const required = new Set(requiredInputsForUtilityType(utilityType));
  return historicalMissing.filter((input) => required.has(input));
}

/**
 * Recompute status from current verified values instead of preserving a stale
 * historical analysis result.
 *
 * @param {Record<string, unknown>} loadSummary
 */
function reconcileLoadProfileReadiness(loadSummary) {
  const missingInputs = getStage2MissingInputs(loadSummary);
  return {
    ...loadSummary,
    analysis_status:
      loadSummary?.analysis_status === "blocked"
        ? "blocked"
        : resolveAnalysisStatus({
            missingInputs,
            needsVerification: Array.isArray(loadSummary?.needs_verification)
              ? loadSummary.needs_verification
              : [],
          }),
    missing_inputs: missingInputs,
  };
}

/**
 * @param {object} params
 * @param {Record<string, unknown>} params.project
 * @param {Array<Record<string, unknown>>} params.documents
 * @param {Array<Record<string, unknown>>} params.equipment
 * @param {Record<string, unknown> | null} params.mapping
 * @param {string} params.utilityType
 */
function buildInputInventory(params) {
  const { project, documents, equipment, mapping, utilityType } = params;

  /** @type {Array<{ key: string, source: string, value?: unknown }>} */
  const inputsUsed = [];
  /** @type {string[]} */
  const missingInputs = [];
  /** @type {Array<{ id?: string, document_type?: string, file_name?: string }>} */
  const sourceDocuments = [];

  const addUsed = (key, source, value) => {
    inputsUsed.push({ key, source, value });
  };

  if (project.project_type) {
    addUsed("project_type", "projects.project_type", project.project_type);
  } else {
    missingInputs.push("project_type");
  }

  if (project.square_footage != null && project.square_footage !== "") {
    addUsed("square_footage", "projects.square_footage", project.square_footage);
  }

  if (project.description) {
    addUsed("description", "projects.description", project.description);
  }

  const address = resolveProjectAddressForProviderSetup(project);
  if (address.formatted) {
    addUsed("address", `projects.address/${address.source}`, address.formatted);
  }

  if (project.deadline) {
    addUsed("deadline", "projects.deadline", project.deadline);
  } else {
    missingInputs.push("construction_schedule");
  }

  if (mapping) {
    addUsed(
      "provider_mapping",
      "coordination_records.metadata.uci_provider_mapping",
      {
        method: mapping.method,
        address_source: mapping.address_source,
        selected_provider_slugs: mapping.selected_provider_slugs,
      },
    );
  }

  if (Array.isArray(mapping?.unresolved_utility_types) && mapping.unresolved_utility_types.length) {
    addUsed(
      "unresolved_utility_types",
      "coordination_records.metadata.uci_provider_mapping.unresolved_utility_types",
      mapping.unresolved_utility_types,
    );
  }

  for (const doc of documents) {
    const entry = {
      id: doc.id != null ? String(doc.id) : undefined,
      document_type: doc.document_type != null ? String(doc.document_type) : undefined,
      file_name: doc.file_name != null ? String(doc.file_name) : undefined,
    };
    sourceDocuments.push(entry);
    addUsed(
      `document:${entry.document_type || "other"}`,
      "project_documents",
      entry,
    );
  }

  if (!documents.length) {
    missingInputs.push("uploaded_specifications_or_plans");
  }

  if (equipment.length) {
    for (const row of equipment) {
      addUsed("equipment_record", "coordination_equipment", {
        equipment_type: row.equipment_type,
        equipment_size: row.equipment_size,
      });
    }
  } else {
    missingInputs.push("equipment_schedule");
  }

  for (const required of requiredInputsForUtilityType(utilityType)) {
    if (!missingInputs.includes(required)) {
      missingInputs.push(required);
    }
  }

  return {
    inputsUsed,
    missingInputs: [...new Set(missingInputs)],
    sourceDocuments,
  };
}

/**
 * @param {object} params
 * @param {string[]} params.missingInputs
 * @param {string[]} params.needsVerification
 */
function resolveAnalysisStatus(params) {
  const { missingInputs, needsVerification } = params;
  if (missingInputs.length > 0) {
    return "missing_inputs";
  }
  if (needsVerification.length > 0) {
    return "preliminary";
  }
  return "preliminary";
}

/**
 * @param {unknown} calculatedValues
 */
function assertNoInferredEngineeringValues(calculatedValues) {
  if (!calculatedValues || typeof calculatedValues !== "object" || Array.isArray(calculatedValues)) {
    return;
  }
  for (const key of Object.keys(/** @type {Record<string, unknown>} */ (calculatedValues))) {
    if (FORBIDDEN_INFERRED_KEYS.has(key.toLowerCase())) {
      const err = new Error("Internal load profile invariant violated: inferred engineering value");
      err.statusCode = 500;
      err.code = "LOAD_PROFILE_INVARIANT";
      throw err;
    }
  }
}

/**
 * @param {object} params
 * @param {string} params.utilityType
 * @param {string} params.generatedAt
 * @param {Array<{ key: string, source: string, value?: unknown }>} params.inputsUsed
 * @param {string[]} params.missingInputs
 * @param {string[]} params.needsVerification
 * @param {Array<{ id?: string, document_type?: string, file_name?: string }>} params.sourceDocuments
 * @param {string} params.userId
 */
function buildLoadSummary(params) {
  const {
    utilityType,
    generatedAt,
    inputsUsed,
    missingInputs,
    needsVerification,
    sourceDocuments,
    userId,
  } = params;

  const analysisStatus = resolveAnalysisStatus({ missingInputs, needsVerification });
  const calculatedValues = {};

  assertNoInferredEngineeringValues(calculatedValues);

  return reconcileLoadProfileReadiness({
    version: LOAD_PROFILE_VERSION,
    utility_type: normalizeUtilityType(utilityType),
    analysis_status: analysisStatus,
    inputs_used: inputsUsed,
    missing_inputs: missingInputs,
    needs_verification: needsVerification,
    assumptions: {
      template_id: null,
      template_version: null,
      notes: [
        "No verified in-repo load template applied in D2.1",
        "Square footage alone does not produce engineering load numbers",
      ],
    },
    calculated_values: calculatedValues,
    source_documents: sourceDocuments,
    generated_at: generatedAt,
    generated_by: GENERATED_BY,
    generated_by_user_id: userId,
    requires_human_review: true,
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 */
async function findAgentDraftApplication(supabase, coordinationRecordId, projectId) {
  const { data, error } = await supabase
    .from("coordination_applications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .eq("record_source", "agent_draft")
    .eq("idempotency_key", LOAD_PROFILE_IDEMPOTENCY_KEY)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load agent draft application"), {
      cause: error,
      statusCode: 500,
      code: "APPLICATION_FETCH_FAILED",
    });
  }

  return data ?? null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.coordinationRecordId
 * @param {string} params.userId
 */
async function runLoadProfileAnalysis(supabase, params) {
  const { coordinationRecordId, userId } = params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);
  const providerCheck = validateProviderContext(record);
  if (!providerCheck.ok) {
    const err = new Error(providerCheck.message);
    err.statusCode = 400;
    err.code = providerCheck.code;
    throw err;
  }

  const mapping = providerCheck.mapping;
  const utilityType = normalizeUtilityType(record.utility_type);

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (projectErr) {
    throw Object.assign(new Error(projectErr.message || "Failed to load project"), {
      cause: projectErr,
      statusCode: 500,
      code: "PROJECT_FETCH_FAILED",
    });
  }

  if (!project) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const [documentsResult, equipmentResult] = await Promise.all([
    supabase
      .from("project_documents")
      .select("id, document_type, file_name, file_type, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("coordination_equipment")
      .select("id, equipment_type, equipment_size, status, created_at")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
  ]);

  if (documentsResult.error) {
    throw Object.assign(
      new Error(documentsResult.error.message || "Failed to load project documents"),
      { cause: documentsResult.error, statusCode: 500, code: "DOCUMENTS_FETCH_FAILED" },
    );
  }

  if (equipmentResult.error) {
    throw Object.assign(
      new Error(equipmentResult.error.message || "Failed to load coordination equipment"),
      { cause: equipmentResult.error, statusCode: 500, code: "EQUIPMENT_FETCH_FAILED" },
    );
  }

  const documents = Array.isArray(documentsResult.data) ? documentsResult.data : [];
  const equipment = Array.isArray(equipmentResult.data) ? equipmentResult.data : [];
  const needsVerification = collectNeedsVerification(record, mapping);

  const inventory = buildInputInventory({
    project,
    documents,
    equipment,
    mapping,
    utilityType,
  });

  const generatedAt = new Date().toISOString();
  const existing = await findAgentDraftApplication(supabase, coordinationRecordId, projectId);
  const prevSummary =
    existing?.load_summary &&
    typeof existing.load_summary === "object" &&
    !Array.isArray(existing.load_summary)
      ? /** @type {Record<string, unknown>} */ (existing.load_summary)
      : {};

  const loadSummary = reconcileLoadProfileReadiness({
    ...buildLoadSummary({
      utilityType,
      generatedAt,
      inputsUsed: inventory.inputsUsed,
      missingInputs: inventory.missingInputs,
      needsVerification,
      sourceDocuments: inventory.sourceDocuments,
      userId,
    }),
    candidate_values: Array.isArray(prevSummary.candidate_values) ? prevSummary.candidate_values : [],
    verified_values:
      prevSummary.verified_values &&
      typeof prevSummary.verified_values === "object" &&
      !Array.isArray(prevSummary.verified_values)
        ? prevSummary.verified_values
        : {},
    verified_values_history: Array.isArray(prevSummary.verified_values_history)
      ? prevSummary.verified_values_history
      : [],
    load_extraction:
      prevSummary.load_extraction &&
      typeof prevSummary.load_extraction === "object" &&
      !Array.isArray(prevSummary.load_extraction)
        ? prevSummary.load_extraction
        : null,
  });

  const embedded = record.utility_providers;
  const providerSlug = Array.isArray(embedded)
    ? embedded[0] && typeof embedded[0] === "object"
      ? String(/** @type {{ slug?: unknown }} */ (embedded[0]).slug ?? "").toLowerCase()
      : ""
    : embedded && typeof embedded === "object"
      ? String(/** @type {{ slug?: unknown }} */ (embedded).slug ?? "").toLowerCase()
      : "";

  const agentDraftMetadata = {
    load_profile_analysis: {
      last_analyzed_at: generatedAt,
      analyzed_by_user_id: userId,
      analysis_status: loadSummary.analysis_status,
      version: LOAD_PROFILE_VERSION,
    },
  };

  const applicationRow = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    tenant_id: record.tenant_id ?? null,
    provider_slug: providerSlug || null,
    application_type: "load_profile",
    load_summary: loadSummary,
    draft_status: "draft",
    record_source: "agent_draft",
    idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
    agent_draft_metadata: agentDraftMetadata,
    metadata: {
      load_profile_version: LOAD_PROFILE_VERSION,
    },
  };

  /** @type {Record<string, unknown>} */
  let application;

  if (existing) {
    const { data, error } = await supabase
      .from("coordination_applications")
      .update({
        load_summary: loadSummary,
        draft_status: "draft",
        agent_draft_metadata: agentDraftMetadata,
        metadata: applicationRow.metadata,
        provider_slug: applicationRow.provider_slug,
        application_type: applicationRow.application_type,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw Object.assign(new Error(error.message || "Failed to update load profile draft"), {
        cause: error,
        statusCode: 500,
        code: "APPLICATION_UPDATE_FAILED",
      });
    }
    application = data;
  } else {
    const { data, error } = await supabase
      .from("coordination_applications")
      .insert(applicationRow)
      .select("*")
      .single();

    if (error) {
      throw Object.assign(new Error(error.message || "Failed to create load profile draft"), {
        cause: error,
        statusCode: 500,
        code: "APPLICATION_INSERT_FAILED",
      });
    }
    application = data;
  }

  let lifecycleRecord = record;
  let stageUnchanged = true;
  const currentStage = Number(record.current_stage) || 1;
  const currentState = String(record.current_stage_state ?? "NOT_STARTED");
  if (currentStage < 2 || (currentStage === 2 && currentState === "NOT_STARTED")) {
    const lifecycle = await recordSystemTransition(supabase, {
      coordinationRecordId,
      toStage: 2,
      toState: "IN_PROGRESS",
      reason: "Agent 2 load profile analysis started",
      triggeredByType: "system",
      triggeredById: userId,
      metadata: {
        source: GENERATED_BY,
        load_profile_version: LOAD_PROFILE_VERSION,
      },
    });
    lifecycleRecord = lifecycle.record;
    stageUnchanged = false;
  }

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    analysis_status: loadSummary.analysis_status,
    load_summary: loadSummary,
    application,
    stage_unchanged: stageUnchanged,
    current_stage: lifecycleRecord.current_stage,
    current_stage_state: lifecycleRecord.current_stage_state,
  };
}

module.exports = {
  LOAD_PROFILE_VERSION,
  LOAD_PROFILE_IDEMPOTENCY_KEY,
  GENERATED_BY,
  FORBIDDEN_INFERRED_KEYS,
  normalizeUtilityType,
  validateProviderContext,
  requiredInputsForUtilityType,
  getStage2MissingInputs,
  reconcileLoadProfileReadiness,
  buildInputInventory,
  buildLoadSummary,
  resolveAnalysisStatus,
  assertNoInferredEngineeringValues,
  runLoadProfileAnalysis,
  findAgentDraftApplication,
};
