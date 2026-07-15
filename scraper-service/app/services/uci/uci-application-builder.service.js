"use strict";

const fs = require("fs");
const path = require("path");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { resolveApplicationPackageAddress } = require("./uci-provider-setup.service.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("./uci-load-profile.service.js");

function getLoadCandidateHelpers() {
  return require("./uci-load-candidate.service.js");
}

const APPLICATION_PACKAGE_VERSION = "d3-v1";
const APPLICATION_PACKAGE_IDEMPOTENCY_KEY = "agent_3_application_package:d3-v1";
const GENERATED_BY = "agent_3_application_builder";

const TEMPLATES_ROOT = path.resolve(__dirname, "../../../../uci/application-templates");

/**
 * @param {string} utilityType
 * @returns {string}
 */
function normalizeUtilityType(utilityType) {
  return String(utilityType ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} providerSlug
 * @returns {string}
 */
function normalizeProviderSlug(providerSlug) {
  return String(providerSlug ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {Record<string, unknown>} record
 * @returns {{ ok: true, providerSlug: string } | { ok: false, code: string, message: string }}
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

  const embedded = record.utility_providers;
  const providerSlug = Array.isArray(embedded)
    ? embedded[0] && typeof embedded[0] === "object"
      ? normalizeProviderSlug(/** @type {{ slug?: unknown }} */ (embedded[0]).slug)
      : ""
    : embedded && typeof embedded === "object"
      ? normalizeProviderSlug(/** @type {{ slug?: unknown }} */ (embedded).slug)
      : "";

  if (!providerSlug) {
    const metadata =
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? /** @type {Record<string, unknown>} */ (record.metadata)
        : {};
    const mappingRaw = metadata.uci_provider_mapping;
    const mapping =
      mappingRaw && typeof mappingRaw === "object" && !Array.isArray(mappingRaw)
        ? /** @type {Record<string, unknown>} */ (mappingRaw)
        : null;
    const slugFromMapping = normalizeProviderSlug(mapping?.provider_slug);
    if (slugFromMapping) {
      return { ok: true, providerSlug: slugFromMapping };
    }
    return {
      ok: false,
      code: "PROVIDER_SLUG_REQUIRED",
      message: "Coordination record has no resolvable provider slug",
    };
  }

  return { ok: true, providerSlug };
}

/**
 * @param {string} providerSlug
 * @param {string} utilityType
 * @returns {Record<string, unknown> | null}
 */
function loadTemplateManifest(providerSlug, utilityType) {
  const slug = normalizeProviderSlug(providerSlug);
  const utility = normalizeUtilityType(utilityType);

  const candidates = [
    path.join(TEMPLATES_ROOT, slug, `${utility}-new-service.json`),
    path.join(TEMPLATES_ROOT, slug, "default.json"),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return /** @type {Record<string, unknown>} */ (parsed);
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * @param {Array<Record<string, unknown>>} applications
 * @returns {Record<string, unknown> | null}
 */
function findLoadProfileDraftApplication(applications) {
  if (!Array.isArray(applications)) return null;
  return (
    applications.find(
      (app) =>
        String(app.record_source) === "agent_draft" &&
        String(app.idempotency_key) === LOAD_PROFILE_IDEMPOTENCY_KEY,
    ) ?? null
  );
}

/**
 * @param {string} documentType
 * @returns {string}
 */
function normalizeDocumentType(documentType) {
  return String(documentType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * @param {Array<Record<string, unknown>>} documents
 * @param {Array<Record<string, unknown>>} requiredDocuments
 */
function matchRequiredDocuments(documents, requiredDocuments) {
  /** @type {Array<Record<string, unknown>>} */
  const packageDocuments = [];
  /** @type {string[]} */
  const missingDocuments = [];

  for (const req of requiredDocuments) {
    const key = String(req.key ?? "");
    const label = String(req.label ?? key);
    const aliases = Array.isArray(req.aliases)
      ? req.aliases.map((a) => normalizeDocumentType(a))
      : [normalizeDocumentType(key)];

    const matched = documents.find((doc) => {
      const docType = normalizeDocumentType(doc.document_type);
      return aliases.includes(docType);
    });

    if (matched) {
      packageDocuments.push({
        key,
        label,
        status: "attached",
        project_document_id: matched.id != null ? String(matched.id) : null,
        document_type: matched.document_type != null ? String(matched.document_type) : null,
        file_name: matched.file_name != null ? String(matched.file_name) : null,
        source: "project_documents",
      });
    } else {
      missingDocuments.push(key);
      packageDocuments.push({
        key,
        label,
        status: "missing",
        source: "template_requirement",
      });
    }
  }

  return { packageDocuments, missingDocuments };
}

/**
 * @param {Record<string, unknown>} project
 * @param {Record<string, unknown> | null} loadSummary
 * @param {Array<Record<string, unknown>>} requiredFields
 * @param {Record<string, unknown> | null | undefined} [coordinationRecord]
 */
function evaluateRequiredFields(project, loadSummary, requiredFields, coordinationRecord, options = {}) {
  /** @type {Array<{ key: string, label: string, status: string, value?: unknown, source?: string, note?: string, address_source?: string }>} */
  const fieldResults = [];
  /** @type {string[]} */
  const missingFields = [];

  const addressResolution = resolveApplicationPackageAddress(project, coordinationRecord, {
    externalApplicationId: options.externalApplicationId,
    utilityApplicationAddress: options.utilityApplicationAddress,
  });
  const address = addressResolution.address;

  for (const field of requiredFields) {
    const key = String(field.key ?? "");
    const label = String(field.label ?? key);
    const source = String(field.source ?? "");
    const required = field.required !== false;
    const note = field.note != null ? String(field.note) : undefined;

    let value;
    let present = false;

    if (source === "project.address") {
      value = address.formatted || null;
      present = Boolean(value);
    } else if (source === "project.project_type") {
      value = project.project_type ?? null;
      present = Boolean(value);
    } else if (source === "project.description") {
      value = project.description ?? null;
      present = Boolean(value);
    } else if (
      source === "load_summary.calculated_values" ||
      source === "load_summary.verified_values"
    ) {
      const { getVerifiedValuesForPackage, isConnectedLoadDataSatisfied } = getLoadCandidateHelpers();
      const verified = getVerifiedValuesForPackage(loadSummary);
      const calculated =
        loadSummary &&
        typeof loadSummary === "object" &&
        !Array.isArray(loadSummary) &&
        loadSummary.calculated_values &&
        typeof loadSummary.calculated_values === "object" &&
        !Array.isArray(loadSummary.calculated_values)
          ? /** @type {Record<string, unknown>} */ (loadSummary.calculated_values)
          : {};
      const calculatedKeys = Object.keys(calculated).filter((k) => {
        const v = calculated[k];
        return v != null && v !== "";
      });

      if (key === "connected_load_data") {
        present = isConnectedLoadDataSatisfied(loadSummary);
        value = present ? verified : null;
      } else {
        const keys = Object.keys(verified).length ? Object.keys(verified) : calculatedKeys;
        value = keys.length ? (Object.keys(verified).length ? verified : calculated) : null;
        present = keys.length > 0;
      }
    } else {
      value = null;
      present = false;
    }

    const status = present ? "present" : required ? "missing" : "optional_missing";
    const fieldEntry = { key, label, status, value, source, note };
    if (source === "project.address") {
      fieldEntry.address_source = addressResolution.address_source_acknowledged
        ? addressResolution.address.source
        : addressResolution.canonical_address_source ?? addressResolution.address.source;
    }
    fieldResults.push(fieldEntry);
    if (required && !present) {
      missingFields.push(key);
    }
  }

  if (addressResolution.address_review_required) {
    missingFields.push("project_address_review");
  }

  return {
    fieldResults,
    missingFields,
    addressResolution,
  };
}

/**
 * @param {object} params
 * @param {string[]} params.missingDocuments
 * @param {string[]} params.missingFields
 * @param {Record<string, unknown> | null} params.loadSummary
 * @param {boolean} params.hasLoadProfileDraft
 * @param {boolean} [params.addressReviewRequired]
 */
function resolvePackageStatus(params) {
  const { missingDocuments, missingFields, loadSummary, hasLoadProfileDraft, addressReviewRequired } =
    params;

  if (!hasLoadProfileDraft) {
    return "blocked";
  }

  if (addressReviewRequired) {
    return "incomplete";
  }

  const loadStatus =
    loadSummary && typeof loadSummary === "object" && !Array.isArray(loadSummary)
      ? String(/** @type {{ analysis_status?: unknown }} */ (loadSummary).analysis_status ?? "")
      : "";

  if (loadStatus === "blocked") {
    return "blocked";
  }

  if (missingDocuments.length > 0 || missingFields.length > 0 || loadStatus === "missing_inputs") {
    return "incomplete";
  }

  return "ready_for_review";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 */
async function findApplicationPackageDraft(supabase, coordinationRecordId, projectId) {
  const { data, error } = await supabase
    .from("coordination_applications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_id", projectId)
    .eq("record_source", "agent_draft")
    .eq("idempotency_key", APPLICATION_PACKAGE_IDEMPOTENCY_KEY)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load application package draft"), {
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
async function runApplicationPackageBuild(supabase, params) {
  const { coordinationRecordId, userId, externalApplicationId } = params;

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

  const providerSlug = providerCheck.providerSlug;
  const utilityType = normalizeUtilityType(record.utility_type);
  const template = loadTemplateManifest(providerSlug, utilityType);
  if (!template) {
    const err = new Error(`No application template available for provider ${providerSlug}`);
    err.statusCode = 404;
    err.code = "TEMPLATE_NOT_FOUND";
    throw err;
  }

  const [projectResult, documentsResult, applicationsResult] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
    supabase
      .from("project_documents")
      .select("id, document_type, file_name, file_type, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("coordination_applications")
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId),
  ]);

  if (projectResult.error) {
    throw Object.assign(new Error(projectResult.error.message || "Failed to load project"), {
      cause: projectResult.error,
      statusCode: 500,
      code: "PROJECT_FETCH_FAILED",
    });
  }
  if (!projectResult.data) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  if (documentsResult.error) {
    throw Object.assign(
      new Error(documentsResult.error.message || "Failed to load project documents"),
      { cause: documentsResult.error, statusCode: 500, code: "DOCUMENTS_FETCH_FAILED" },
    );
  }

  if (applicationsResult.error) {
    throw Object.assign(
      new Error(applicationsResult.error.message || "Failed to load coordination applications"),
      { cause: applicationsResult.error, statusCode: 500, code: "APPLICATIONS_FETCH_FAILED" },
    );
  }

  const project = projectResult.data;
  const documents = Array.isArray(documentsResult.data) ? documentsResult.data : [];
  const applications = Array.isArray(applicationsResult.data) ? applicationsResult.data : [];
  const loadProfileDraft = findLoadProfileDraftApplication(applications);

  const loadSummary =
    loadProfileDraft &&
    loadProfileDraft.load_summary &&
    typeof loadProfileDraft.load_summary === "object" &&
    !Array.isArray(loadProfileDraft.load_summary)
      ? /** @type {Record<string, unknown>} */ (loadProfileDraft.load_summary)
      : null;

  if (!loadProfileDraft) {
    const err = new Error(
      "Load profile analysis is required before preparing an application package",
    );
    err.statusCode = 400;
    err.code = "LOAD_PROFILE_REQUIRED";
    throw err;
  }

  const requiredDocuments = Array.isArray(template.required_documents)
    ? /** @type {Array<Record<string, unknown>>} */ (template.required_documents)
    : [];
  const requiredFields = Array.isArray(template.required_fields)
    ? /** @type {Array<Record<string, unknown>>} */ (template.required_fields)
    : [];

  const existingPackageDraft = await findApplicationPackageDraft(
    supabase,
    coordinationRecordId,
    projectId,
  );
  const existingPackageDocuments = Array.isArray(existingPackageDraft?.package_documents)
    ? /** @type {Array<Record<string, unknown>>} */ (existingPackageDraft.package_documents)
    : [];

  const { resolvePackageDocumentSlots, extractPepcoPortalFiles } = require("./uci-package-document-bridge.service.js");
  const docMatch = resolvePackageDocumentSlots({
    requiredDocuments,
    projectDocuments: documents,
    existingPackageDocuments,
    pepcoPortalFiles: extractPepcoPortalFiles(record),
    accessContext: {
      projectId,
      coordinationRecordId,
      tenantId: record.tenant_id != null ? String(record.tenant_id) : null,
    },
  });
  const fieldEval = evaluateRequiredFields(project, loadSummary, requiredFields, record, {
    externalApplicationId,
  });
  const packageStatus = resolvePackageStatus({
    missingDocuments: docMatch.missingDocuments,
    missingFields: fieldEval.missingFields,
    loadSummary,
    hasLoadProfileDraft: Boolean(loadProfileDraft),
    addressReviewRequired: fieldEval.addressResolution.address_review_required,
  });

  const generatedAt = new Date().toISOString();
  const templateVersion = String(template.version ?? "unknown");

  const addressResolution = fieldEval.addressResolution;
  const agentDraftMetadata = {
    application_package: {
      version: APPLICATION_PACKAGE_VERSION,
      template_id: templateVersion,
      template_provider_slug: providerSlug,
      template_utility_type: utilityType,
      package_status: packageStatus,
      missing_documents: docMatch.missingDocuments,
      missing_fields: fieldEval.missingFields,
      field_results: fieldEval.fieldResults,
      project_address: {
        formatted: addressResolution.address.formatted,
        source: addressResolution.address.source,
        complete: addressResolution.address.complete,
        fallback_used: Boolean(addressResolution.address.fallback_used),
        parts: addressResolution.address.parts ?? null,
        selection_reason: addressResolution.address_selection_reason ?? null,
        external_application_id: externalApplicationId ? String(externalApplicationId) : null,
      },
      address_source_acknowledged: addressResolution.address_source_acknowledged,
      address_mismatch: addressResolution.address_mismatch,
      mismatch_warning: addressResolution.mismatch_warning,
      address_review_required: addressResolution.address_review_required,
      load_profile_application_id: loadProfileDraft.id,
      load_profile_version:
        loadSummary && typeof loadSummary.version === "string" ? loadSummary.version : null,
      load_profile_analysis_status:
        loadSummary && typeof loadSummary.analysis_status === "string"
          ? loadSummary.analysis_status
          : null,
      verified_load_snapshot:
        loadSummary &&
        typeof loadSummary === "object" &&
        loadSummary.verified_values &&
        typeof loadSummary.verified_values === "object" &&
        !Array.isArray(loadSummary.verified_values)
          ? loadSummary.verified_values
          : {},
      connected_load_satisfied: getLoadCandidateHelpers().isConnectedLoadDataSatisfied(loadSummary),
      built_at: generatedAt,
      built_by_user_id: userId,
      generated_by: GENERATED_BY,
      requires_human_review: true,
      notes: [
        "D3 foundation package — structural assembly only",
        "No auto-submit; review required before D4 submission",
      ],
    },
  };

  const applicationRow = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    tenant_id: record.tenant_id ?? null,
    provider_slug: providerSlug,
    application_type: String(template.application_type ?? "new_service"),
    package_documents: docMatch.packageDocuments,
    load_summary: loadSummary ?? {},
    draft_status: "draft",
    record_source: "agent_draft",
    idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
    agent_draft_metadata: agentDraftMetadata,
    metadata: {
      application_package_version: APPLICATION_PACKAGE_VERSION,
      template_version: templateVersion,
    },
  };

  const existing = existingPackageDraft;
  /** @type {Record<string, unknown>} */
  let application;

  if (existing) {
    const { data, error } = await supabase
      .from("coordination_applications")
      .update({
        package_documents: applicationRow.package_documents,
        load_summary: applicationRow.load_summary,
        draft_status: "draft",
        agent_draft_metadata: agentDraftMetadata,
        metadata: applicationRow.metadata,
        provider_slug: applicationRow.provider_slug,
        application_type: applicationRow.application_type,
        reviewed_by: null,
        reviewed_at: null,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw Object.assign(new Error(error.message || "Failed to update application package draft"), {
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
      throw Object.assign(new Error(error.message || "Failed to create application package draft"), {
        cause: error,
        statusCode: 500,
        code: "APPLICATION_INSERT_FAILED",
      });
    }
    application = data;
  }

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    package_status: packageStatus,
    missing_documents: docMatch.missingDocuments,
    missing_fields: fieldEval.missingFields,
    application,
    stage_unchanged: true,
    current_stage: record.current_stage,
    current_stage_state: record.current_stage_state,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} applicationId
 */
async function getApplicationById(supabase, applicationId) {
  const { data, error } = await supabase
    .from("coordination_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load application"), {
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
 * @param {string} params.applicationId
 * @param {string} params.userId
 * @param {{ status: string, notes?: string }} params.review
 */
async function reviewApplicationPackage(supabase, params) {
  const { applicationId, userId, review } = params;
  const status = String(review.status ?? "").trim().toLowerCase();

  if (status !== "reviewed" && status !== "needs_changes") {
    const err = new Error('Review status must be "reviewed" or "needs_changes"');
    err.statusCode = 400;
    err.code = "INVALID_REVIEW_STATUS";
    throw err;
  }

  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  if (String(application.record_source) !== "agent_draft") {
    const err = new Error("Only agent draft applications can be reviewed");
    err.statusCode = 400;
    err.code = "NOT_AGENT_DRAFT";
    throw err;
  }

  if (String(application.idempotency_key) !== APPLICATION_PACKAGE_IDEMPOTENCY_KEY) {
    const err = new Error("Application is not an Agent 3 application package draft");
    err.statusCode = 400;
    err.code = "NOT_APPLICATION_PACKAGE";
    throw err;
  }

  if (String(application.draft_status) === "submitted") {
    const err = new Error("Submitted applications cannot be reviewed");
    err.statusCode = 400;
    err.code = "ALREADY_SUBMITTED";
    throw err;
  }

  const metadata =
    application.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? /** @type {Record<string, unknown>} */ (application.agent_draft_metadata)
      : {};
  const pkg =
    metadata.application_package &&
    typeof metadata.application_package === "object" &&
    !Array.isArray(metadata.application_package)
      ? /** @type {Record<string, unknown>} */ (metadata.application_package)
      : {};
  const packageStatus = String(pkg.package_status ?? "");

  if (status === "reviewed" && packageStatus === "blocked") {
    const err = new Error(
      "Application package is blocked — run load profile analysis before marking reviewed",
    );
    err.statusCode = 400;
    err.code = "PACKAGE_BLOCKED";
    throw err;
  }

  const reviewedAt = new Date().toISOString();
  const notes = review.notes != null ? String(review.notes).trim() : "";

  const updatedMetadata = {
    ...metadata,
    application_package: {
      ...pkg,
      last_review: {
        status,
        notes: notes || null,
        reviewed_by_user_id: userId,
        reviewed_at: reviewedAt,
      },
    },
  };

  const { data, error } = await supabase
    .from("coordination_applications")
    .update({
      draft_status: status,
      reviewed_by: userId,
      reviewed_at: reviewedAt,
      agent_draft_metadata: updatedMetadata,
    })
    .eq("id", applicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update application review"), {
      cause: error,
      statusCode: 500,
      code: "APPLICATION_REVIEW_FAILED",
    });
  }

  return {
    application: data,
    review_status: status,
    reviewed_at: reviewedAt,
    reviewed_by: userId,
  };
}

module.exports = {
  APPLICATION_PACKAGE_VERSION,
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
  GENERATED_BY,
  TEMPLATES_ROOT,
  normalizeUtilityType,
  normalizeProviderSlug,
  validateProviderContext,
  loadTemplateManifest,
  findLoadProfileDraftApplication,
  matchRequiredDocuments,
  evaluateRequiredFields,
  resolvePackageStatus,
  runApplicationPackageBuild,
  getApplicationById,
  reviewApplicationPackage,
  findApplicationPackageDraft,
};
