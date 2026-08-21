"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");
const {
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
  findApplicationPackageDraft,
  normalizeUtilityType,
  validateProviderContext,
  evaluateRequiredFields,
  resolvePackageStatus,
  findLoadProfileDraftApplication,
  getApplicationById,
  applyDocumentSignatureRequirements,
  isSyntheticTestTemplate,
} = require("./uci-application-builder.service.js");
const { resolveApplicationTemplateManifest } = require("./uci-provider-application-template.service.js");
const {
  UCI_DOCUMENTS_STORAGE_BUCKET,
  UCI_TENANT_NAMESPACE_UNCONFIGURED,
  sanitizeUciStorageSegment,
  parseUciStoragePathTenant,
} = require("./uci-document-storage.service.js");
const { withPackageReviewSummary } = require("./uci-package-review.service.js");
const {
  findRegistryMatchForSlot,
  loadRegistryDocumentsForPackage,
} = require("./uci-document-registry.service.js");

const PACKAGE_SLOT_KEYS = [
  "site_plan",
  "single_line_diagram",
  "equipment_cut_sheets",
  "letter_of_authorization",
];

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} record
 * @param {object} [options]
 */
async function resolveTemplateForRecord(supabase, record, options = {}) {
  const providerCheck = validateProviderContext(record);
  if (!providerCheck.ok) {
    const err = new Error(providerCheck.message);
    err.statusCode = 400;
    err.code = providerCheck.code;
    throw err;
  }
  const utilityType = normalizeUtilityType(record.utility_type);
  const resolved = await resolveApplicationTemplateManifest(supabase, {
    providerSlug: providerCheck.providerSlug,
    providerId: record.utility_provider_id,
    utilityType,
    checklistMode: options.checklistMode,
    coordinationMetadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? /** @type {Record<string, unknown>} */ (record.metadata)
        : {},
  });
  if (!resolved.template) {
    const err = new Error("Application template not found");
    err.statusCode = 404;
    err.code = "TEMPLATE_NOT_FOUND";
    err.details = {
      template_resolution: resolved.resolution,
      action: "upload_manual_template",
    };
    throw err;
  }
  return resolved.template;
}

/** Patterns that block automatic slot suggestions (filename/metadata only). */
const SUGGESTION_BLOCK_PATTERNS = [
  /\bPANEL[\s-]*SCHEDULE\b/i,
  /\bEQUIPMENT[\s-]*UTILITY[\s-]*SCHEDULE\b/i,
  /\bEQUIPMENT[\s-]*PLAN\b/i,
  /\bELECTRICAL[\s-]*SPEC(?:IFICATION)?S?\b/i,
  /\bPOWER[\s-]*PLAN\b/i,
  /\bLOW[\s-]*VOLTAGE[\s-]*PLAN\b/i,
];

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
 * @param {string} text
 * @returns {string}
 */
function normalizeSearchText(text) {
  return String(text ?? "")
    .trim()
    .toUpperCase()
    .replace(/[_]+/g, " ");
}

/**
 * @param {string} combinedText
 * @returns {boolean}
 */
function isSuggestionBlocked(combinedText) {
  return SUGGESTION_BLOCK_PATTERNS.some((pattern) => pattern.test(combinedText));
}

/**
 * Deterministic filename/metadata suggestions — never auto-approve.
 *
 * @param {{ fileName?: string | null, pepcoDocumentName?: string | null, pepcoDocumentType?: string | null }} input
 * @returns {{ suggested_slot: string | null, confidence: "high" | "medium" | "low" | null, suggestion_reason: string | null }}
 */
function suggestPackageSlotForCandidate(input) {
  const fileName = String(input.fileName ?? "");
  const pepcoDocumentName = String(input.pepcoDocumentName ?? "");
  const pepcoDocumentType = String(input.pepcoDocumentType ?? "");
  const combined = normalizeSearchText(
    [fileName, pepcoDocumentName, pepcoDocumentType].filter(Boolean).join(" "),
  );

  if (!combined) {
    return { suggested_slot: null, confidence: null, suggestion_reason: null };
  }

  if (isSuggestionBlocked(combined)) {
    return {
      suggested_slot: null,
      confidence: null,
      suggestion_reason: "Excluded from automatic suggestions (panel schedule, equipment plan, or electrical specification)",
    };
  }

  /** @type {Array<{ slot: string, confidence: "high" | "medium" | "low", reason: string, test: RegExp }>} */
  const rules = [
    {
      slot: "single_line_diagram",
      confidence: "high",
      reason: "Filename or metadata indicates a one-line / single-line diagram",
      test: /\b(ONE[\s-]*LINE|SINGLE[\s-]*LINE)\b/,
    },
    {
      slot: "site_plan",
      confidence: "high",
      reason: "Filename or metadata indicates a site or civil plan",
      test: /\b(SITE[\s-]*PLAN|CIVIL[\s-]*PLAN|PLOT[\s-]*PLAN)\b/,
    },
    {
      slot: "site_plan",
      confidence: "medium",
      reason: "Filename or metadata references civil plotting",
      test: /\bCIVIL\b/,
    },
    {
      slot: "equipment_cut_sheets",
      confidence: "high",
      reason: "Filename or metadata indicates equipment cut sheets",
      test: /\b(CUT[\s-]*SHEET|CUTSHEET|EQUIPMENT[\s-]*CUT[\s-]*SHEET)\b/,
    },
    {
      slot: "load_calculation_worksheet",
      confidence: "high",
      reason: "Filename or metadata indicates a load calculation worksheet",
      test: /\b(LOAD[\s-]*CALC|LOAD[\s-]*WORKSHEET|LOAD[\s-]*LETTER)\b/,
    },
    {
      slot: "letter_of_authorization",
      confidence: "medium",
      reason: "Filename or metadata contains LOA indicator",
      test: /\bLOA\b/,
    },
  ];

  for (const rule of rules) {
    if (rule.test.test(combined)) {
      return {
        suggested_slot: rule.slot,
        confidence: rule.confidence,
        suggestion_reason: rule.reason,
      };
    }
  }

  return { suggested_slot: null, confidence: null, suggestion_reason: null };
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Array<Record<string, unknown>>}
 */
function extractPepcoPortalFiles(record, opts = {}) {
  const metadata = parseCoordinationMetadata(record.metadata);
  const discovery = metadata.pepco_application_detail_discovery;
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery)) return [];

  const applications = Array.isArray(/** @type {{ applications?: unknown }} */ (discovery).applications)
    ? /** @type {Array<Record<string, unknown>>} */ (/** @type {{ applications: unknown[] }} */ (discovery).applications)
    : [];

  const scopeExternalApplicationId =
    opts.externalApplicationId != null ? String(opts.externalApplicationId).trim() : "";

  const coordinationRecordId = String(record.id ?? "");
  const projectId = String(record.project_id ?? "");
  const tenantId = record.tenant_id != null ? String(record.tenant_id) : null;

  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (const app of applications) {
    if (!app || typeof app !== "object") continue;
    const externalApplicationId = String(
      app.applicationUuid ?? app.external_application_id ?? app.externalApplicationId ?? "",
    ).trim();
    if (!externalApplicationId) continue;
    if (scopeExternalApplicationId && externalApplicationId !== scopeExternalApplicationId) continue;

    /** @type {Map<string, Record<string, unknown>>} */
    const docMetaByName = new Map();
    const portalDocs = Array.isArray(app.documents) ? app.documents : [];
    for (const doc of portalDocs) {
      if (!doc || typeof doc !== "object") continue;
      const name = String(/** @type {{ documentName?: unknown }} */ (doc).documentName ?? "").trim();
      if (name) docMetaByName.set(name, /** @type {Record<string, unknown>} */ (doc));
    }

    const downloaded = Array.isArray(app.downloadedFiles) ? app.downloadedFiles : [];
    for (const file of downloaded) {
      if (!file || typeof file !== "object") continue;
      const rec = /** @type {Record<string, unknown>} */ (file);
      const storagePath = rec.storagePath != null ? String(rec.storagePath) : "";
      const storageStatus = rec.storageStatus != null ? String(rec.storageStatus) : "";
      if (!storagePath && storageStatus !== "stored") continue;

      const documentName = String(rec.documentName ?? "").trim();
      const fileName = String(rec.fileName ?? documentName).trim();
      const portalDoc = documentName ? docMetaByName.get(documentName) : null;
      const pepcoDocumentType =
        portalDoc && portalDoc.documentType != null ? String(portalDoc.documentType) : null;

      out.push({
        ...rec,
        pepco_document_name: documentName || null,
        pepco_document_type: pepcoDocumentType,
        external_application_id: externalApplicationId,
        coordination_record_id: coordinationRecordId,
        project_id: projectId,
        tenant_id: tenantId,
      });
    }
  }

  return out;
}

/**
 * @param {string} storagePath
 * @param {{ projectId: string, coordinationRecordId: string, tenantId?: string | null }} ctx
 * @returns {boolean}
 */
function validatePepcoStoragePathForRecord(storagePath, ctx) {
  const path = String(storagePath || "").trim();
  if (!path) return false;

  const parsed = parseUciStoragePathTenant(path);
  if (!parsed) return false;
  if (parsed.projectId !== String(ctx.projectId)) return false;

  const parts = path.split("/");
  if (parts.length < 7 || parts[0] !== "uci") return false;
  if (parts[3] !== String(ctx.coordinationRecordId)) return false;

  if (ctx.tenantId) {
    const expectedTenant = sanitizeUciStorageSegment(ctx.tenantId);
    if (
      parts[1] !== expectedTenant &&
      parts[1] !== UCI_TENANT_NAMESPACE_UNCONFIGURED
    ) {
      return false;
    }
  }

  return true;
}

/**
 * @param {Record<string, unknown>} file
 * @param {{ projectId: string, coordinationRecordId: string, tenantId?: string | null }} ctx
 * @returns {boolean}
 */
function isPepcoPortalFileAccessible(file, ctx) {
  const storagePath = file.storagePath != null ? String(file.storagePath) : "";
  const storageStatus = file.storageStatus != null ? String(file.storageStatus) : "";
  if (storageStatus !== "stored" || !storagePath) return false;
  if (String(file.project_id ?? "") !== String(ctx.projectId)) return false;
  if (String(file.coordination_record_id ?? "") !== String(ctx.coordinationRecordId)) return false;
  return validatePepcoStoragePathForRecord(storagePath, ctx);
}

/**
 * @param {unknown} metadata
 * @returns {Record<string, unknown>}
 */
function parseCoordinationMetadata(metadata) {
  if (metadata == null) return {};
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return /** @type {Record<string, unknown>} */ (parsed);
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return /** @type {Record<string, unknown>} */ (metadata);
  }
  return {};
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Array<{ external_application_id: string, project_name: string | null, document_count: number, downloaded_count: number }>}
 */
function listPepcoExternalApplicationsFromRecord(record) {
  const metadata = parseCoordinationMetadata(record.metadata);
  const discovery = metadata.pepco_application_detail_discovery;
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery)) return [];

  const applications = Array.isArray(/** @type {{ applications?: unknown }} */ (discovery).applications)
    ? /** @type {Array<Record<string, unknown>>} */ (/** @type {{ applications: unknown[] }} */ (discovery).applications)
    : [];

  /** @type {Array<{ external_application_id: string, project_name: string | null, document_count: number, downloaded_count: number }>} */
  const out = [];

  for (const app of applications) {
    if (!app || typeof app !== "object") continue;
    const externalApplicationId = String(
      app.applicationUuid ?? app.external_application_id ?? app.externalApplicationId ?? "",
    ).trim();
    if (!externalApplicationId) continue;

    const overview =
      app.overview && typeof app.overview === "object" && !Array.isArray(app.overview)
        ? /** @type {{ projectName?: unknown }} */ (app.overview)
        : null;
    const projectName =
      overview && overview.projectName != null ? String(overview.projectName) : null;
    const documentCount = Array.isArray(app.documents) ? app.documents.length : 0;
    const downloadedCount = Array.isArray(app.downloadedFiles) ? app.downloadedFiles.length : 0;

    out.push({
      external_application_id: externalApplicationId,
      project_name: projectName,
      document_count: documentCount,
      downloaded_count: downloadedCount,
    });
  }

  return out;
}

/**
 * @param {Record<string, unknown>} file
 * @returns {string | null}
 */
function pepcoCandidateId(file) {
  const idem = file.idempotencyKey != null ? String(file.idempotencyKey).trim() : "";
  if (idem) return `pepco_portal:${idem}`;

  const storagePath = file.storagePath != null ? String(file.storagePath).trim() : "";
  if (storagePath) return `pepco_portal:path:${storagePath}`;

  const externalApplicationId =
    file.external_application_id != null ? String(file.external_application_id).trim() : "";
  const fileName = String(file.fileName ?? file.file_name ?? file.documentName ?? "").trim();
  const contentHash = file.contentHash != null ? String(file.contentHash).trim() : "";
  if (externalApplicationId && fileName) {
    return `pepco_portal:legacy:${externalApplicationId}:${fileName}`;
  }
  if (contentHash) return `pepco_portal:hash:${contentHash}`;
  return null;
}

/**
 * @param {string} projectDocumentId
 * @returns {string}
 */
function projectDocumentCandidateId(projectDocumentId) {
  return `project_document:${projectDocumentId}`;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} projectId
 * @param {string} documentId
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function loadProjectDocumentForPackage(supabase, projectId, documentId) {
  const { data, error } = await supabase
    .from("project_documents")
    .select("id, project_id, document_type, file_name, file_type, created_at")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load project document"), {
      cause: error,
      statusCode: 500,
      code: "DOCUMENT_FETCH_FAILED",
    });
  }

  return data ?? null;
}

/**
 * @param {Array<Record<string, unknown>>} existingPackageDocuments
 * @returns {Map<string, Record<string, unknown>>}
 */
function extractConfirmedMappingsBySlot(existingPackageDocuments) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map();
  if (!Array.isArray(existingPackageDocuments)) return map;

  for (const entry of existingPackageDocuments) {
    if (!entry || typeof entry !== "object") continue;
    const key = String(entry.key ?? "").trim();
    if (!key) continue;
    if (entry.user_confirmed === true || entry.confirmed_at != null) {
      map.set(key, entry);
    }
  }
  return map;
}

/**
 * @param {Record<string, unknown>} confirmed
 * @param {Record<string, unknown>} file
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function buildAttachedPepcoPackageEntry(confirmed, file, label) {
  return {
    key: String(confirmed.key ?? file.key ?? ""),
    label,
    status: "attached",
    source: "pepco_portal",
    user_confirmed: true,
    file_name: file.fileName != null ? String(file.fileName) : String(file.file_name ?? ""),
    pepco_document_name:
      file.pepco_document_name != null
        ? String(file.pepco_document_name)
        : file.documentName != null
          ? String(file.documentName)
          : null,
    storage_bucket:
      file.storageBucket != null ? String(file.storageBucket) : UCI_DOCUMENTS_STORAGE_BUCKET,
    storage_path: file.storagePath != null ? String(file.storagePath) : null,
    content_hash: file.contentHash != null ? String(file.contentHash) : null,
    idempotency_key: file.idempotencyKey != null ? String(file.idempotencyKey) : null,
    external_application_id:
      file.external_application_id != null ? String(file.external_application_id) : null,
    coordination_record_id:
      file.coordination_record_id != null ? String(file.coordination_record_id) : null,
    confirmed_by: confirmed.confirmed_by != null ? String(confirmed.confirmed_by) : null,
    confirmed_at: confirmed.confirmed_at != null ? String(confirmed.confirmed_at) : null,
  };
}

/**
 * @param {object} params
 * @param {Array<Record<string, unknown>>} params.requiredDocuments
 * @param {Array<Record<string, unknown>>} params.projectDocuments
 * @param {Array<Record<string, unknown>>} [params.existingPackageDocuments]
 * @param {Array<Record<string, unknown>>} [params.pepcoPortalFiles]
 * @param {Array<Record<string, unknown>>} [params.registryDocuments]
 * @param {{ projectId: string, coordinationRecordId: string, tenantId?: string | null }} params.accessContext
 */
function resolvePackageDocumentSlots(params) {
  const {
    requiredDocuments,
    projectDocuments,
    existingPackageDocuments = [],
    pepcoPortalFiles = [],
    registryDocuments = [],
    accessContext,
  } = params;

  const confirmedBySlot = extractConfirmedMappingsBySlot(existingPackageDocuments);

  /** @type {Map<string, Record<string, unknown>>} */
  const pepcoByIdempotency = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const pepcoByStoragePath = new Map();
  for (const file of pepcoPortalFiles) {
    const key = file.idempotencyKey != null ? String(file.idempotencyKey) : "";
    if (key) pepcoByIdempotency.set(key, file);
    const storagePath = file.storagePath != null ? String(file.storagePath).trim() : "";
    if (storagePath) pepcoByStoragePath.set(storagePath, file);
  }

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

    const confirmed = confirmedBySlot.get(key);
    if (confirmed) {
      const source = String(confirmed.source ?? "");
      if (source === "pepco_portal") {
        const idem = confirmed.idempotency_key != null ? String(confirmed.idempotency_key) : "";
        const confirmedStoragePath =
          confirmed.storage_path != null ? String(confirmed.storage_path).trim() : "";
        const file =
          (idem ? pepcoByIdempotency.get(idem) : null) ||
          (confirmedStoragePath ? pepcoByStoragePath.get(confirmedStoragePath) : null);
        if (file && isPepcoPortalFileAccessible(file, accessContext)) {
          packageDocuments.push(buildAttachedPepcoPackageEntry(confirmed, file, label));
          continue;
        }
      } else if (source === "generated_worksheet") {
        packageDocuments.push({
          ...confirmed,
          key,
          label,
          status: "attached",
          source: "generated_worksheet",
        });
        continue;
      } else if (source === "project_documents") {
        const docId =
          confirmed.project_document_id != null ? String(confirmed.project_document_id) : "";
        const matched = projectDocuments.find((doc) => String(doc.id) === docId);
        if (matched) {
          packageDocuments.push({
            key,
            label,
            status: "attached",
            source: "project_documents",
            user_confirmed: true,
            project_document_id: String(matched.id),
            document_type:
              matched.document_type != null ? String(matched.document_type) : null,
            file_name: matched.file_name != null ? String(matched.file_name) : null,
            confirmed_by: confirmed.confirmed_by != null ? String(confirmed.confirmed_by) : null,
            confirmed_at: confirmed.confirmed_at != null ? String(confirmed.confirmed_at) : null,
            signature_required: confirmed.signature_required === true,
            signature_status:
              confirmed.signature_status != null ? String(confirmed.signature_status) : undefined,
            signature_verified_by:
              confirmed.signature_verified_by != null
                ? String(confirmed.signature_verified_by)
                : null,
            signature_verified_at:
              confirmed.signature_verified_at != null
                ? String(confirmed.signature_verified_at)
                : null,
            signature_review_note:
              confirmed.signature_review_note != null
                ? String(confirmed.signature_review_note)
                : null,
          });
          continue;
        }
      }
    }

    const registryMatch = findRegistryMatchForSlot(
      registryDocuments,
      key,
      Array.isArray(req.aliases) ? req.aliases.map((a) => String(a)) : [],
    );
    if (registryMatch?.project_document_id) {
      const registryDocId = String(registryMatch.project_document_id);
      const matched =
        projectDocuments.find((doc) => String(doc.id) === registryDocId) ??
        registryMatch.project_document ??
        null;
      if (matched) {
        packageDocuments.push({
          key,
          label,
          status: "attached",
          project_document_id: registryDocId,
          document_type:
            matched.document_type != null
              ? String(matched.document_type)
              : registryMatch.effective_role != null
                ? String(registryMatch.effective_role)
                : null,
          file_name: matched.file_name != null ? String(matched.file_name) : null,
          source: "project_documents",
          registry_role:
            registryMatch.effective_role != null ? String(registryMatch.effective_role) : null,
          registry_confidence:
            registryMatch.role_confidence != null ? String(registryMatch.role_confidence) : null,
          signature_required: req.signature_required === true,
          signature_status:
            registryMatch.signature_status != null
              ? String(registryMatch.signature_status)
              : req.signature_required === true
                ? "unknown"
                : undefined,
        });
        continue;
      }
    }

    const autoMatched = projectDocuments.find((doc) => {
      const docType = normalizeDocumentType(doc.document_type);
      return aliases.includes(docType);
    });

    if (autoMatched) {
      packageDocuments.push({
        key,
        label,
        status: "attached",
        project_document_id: autoMatched.id != null ? String(autoMatched.id) : null,
        document_type:
          autoMatched.document_type != null ? String(autoMatched.document_type) : null,
        file_name: autoMatched.file_name != null ? String(autoMatched.file_name) : null,
        source: "project_documents",
      });
      continue;
    }

    missingDocuments.push(key);
    packageDocuments.push({
      key,
      label,
      status: "missing",
      source: "template_requirement",
    });
  }

  return { packageDocuments, missingDocuments };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ coordinationRecordId: string, projectId: string, externalApplicationId?: string | null }} params
 */
async function listPackageDocumentCandidates(supabase, params) {
  const coordinationRecordId = String(params.coordinationRecordId || "").trim();
  const projectId = String(params.projectId || "").trim();
  const requestedExternalApplicationId =
    params.externalApplicationId != null ? String(params.externalApplicationId).trim() : "";

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  if (String(record.project_id) !== projectId) {
    const err = new Error("Coordination record does not belong to this project");
    err.statusCode = 403;
    err.code = "COORDINATION_PROJECT_MISMATCH";
    throw err;
  }

  const providerCheck = validateProviderContext(record);
  if (!providerCheck.ok) {
    const err = new Error(providerCheck.message);
    err.statusCode = 400;
    err.code = providerCheck.code;
    throw err;
  }

  const utilityType = normalizeUtilityType(record.utility_type);
  const packageDraft = await findApplicationPackageDraft(supabase, coordinationRecordId, projectId);
  const checklistMode =
    packageDraft?.agent_draft_metadata?.application_package?.checklist_mode != null
      ? String(packageDraft.agent_draft_metadata.application_package.checklist_mode)
      : undefined;
  const template = await resolveTemplateForRecord(supabase, record, { checklistMode });
  const requiredDocuments = Array.isArray(template.required_documents)
    ? /** @type {Array<Record<string, unknown>>} */ (template.required_documents)
    : [];

  const { data: projectDocs, error: docsErr } = await supabase
    .from("project_documents")
    .select("id, project_id, document_type, file_name, file_type, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (docsErr) {
    throw Object.assign(new Error(docsErr.message || "Failed to load project documents"), {
      cause: docsErr,
      statusCode: 500,
      code: "DOCUMENTS_FETCH_FAILED",
    });
  }

  const availableApplications = listPepcoExternalApplicationsFromRecord(record).filter(
    (app) => app.downloaded_count > 0 || app.document_count > 0,
  );

  let scopedExternalApplicationId = requestedExternalApplicationId;
  if (!scopedExternalApplicationId && availableApplications.length === 1) {
    scopedExternalApplicationId = availableApplications[0].external_application_id;
  }

  if (availableApplications.length > 1 && !scopedExternalApplicationId) {
    const err = new Error(
      "Select a PEPCO portal application before mapping package documents. Multiple scraped applications exist on this coordination record.",
    );
    err.statusCode = 400;
    err.code = "PEPCO_APPLICATION_SCOPE_REQUIRED";
    err.available_applications = availableApplications;
    throw err;
  }

  if (scopedExternalApplicationId) {
    const known = availableApplications.some(
      (app) => app.external_application_id === scopedExternalApplicationId,
    );
    if (!known && availableApplications.length > 0) {
      const err = new Error("Requested PEPCO application was not found on this coordination record");
      err.statusCode = 404;
      err.code = "PEPCO_APPLICATION_NOT_FOUND";
      err.available_applications = availableApplications;
      throw err;
    }
  }

  const accessContext = {
    projectId,
    coordinationRecordId,
    tenantId: record.tenant_id != null ? String(record.tenant_id) : null,
  };

  const pepcoFiles = extractPepcoPortalFiles(record, {
    externalApplicationId: scopedExternalApplicationId || undefined,
  }).filter((file) => isPepcoPortalFileAccessible(file, accessContext));

  /** @type {Array<Record<string, unknown>>} */
  const candidates = [];

  for (const doc of Array.isArray(projectDocs) ? projectDocs : []) {
    const docId = String(doc.id ?? "");
    const suggestion = suggestPackageSlotForCandidate({
      fileName: doc.file_name,
      pepcoDocumentName: null,
      pepcoDocumentType: doc.document_type,
    });

    candidates.push({
      candidate_id: projectDocumentCandidateId(docId),
      source_type: "project_document",
      project_id: projectId,
      tenant_id: record.tenant_id ?? null,
      coordination_record_id: coordinationRecordId,
      external_application_id: null,
      file_name: doc.file_name != null ? String(doc.file_name) : null,
      pepco_document_name: null,
      pepco_document_type: null,
      project_document_id: docId,
      document_type: doc.document_type != null ? String(doc.document_type) : null,
      storage_bucket: null,
      storage_path: null,
      content_hash: null,
      idempotency_key: null,
      timestamp: doc.created_at != null ? String(doc.created_at) : null,
      suggested_package_slot: suggestion.suggested_slot,
      confidence: suggestion.confidence,
      suggestion_reason: suggestion.suggestion_reason,
    });
  }

  for (const file of pepcoFiles) {
    const candidateId = pepcoCandidateId(file);
    if (!candidateId) continue;

    const suggestion = suggestPackageSlotForCandidate({
      fileName: file.fileName,
      pepcoDocumentName: file.pepco_document_name ?? file.documentName,
      pepcoDocumentType: file.pepco_document_type,
    });

    candidates.push({
      candidate_id: candidateId,
      source_type: "pepco_portal",
      project_id: projectId,
      tenant_id: record.tenant_id ?? null,
      coordination_record_id: coordinationRecordId,
      external_application_id:
        file.external_application_id != null ? String(file.external_application_id) : null,
      file_name: file.fileName != null ? String(file.fileName) : null,
      pepco_document_name:
        file.pepco_document_name != null
          ? String(file.pepco_document_name)
          : file.documentName != null
            ? String(file.documentName)
            : null,
      pepco_document_type:
        file.pepco_document_type != null ? String(file.pepco_document_type) : null,
      project_document_id: null,
      document_type: null,
      storage_bucket:
        file.storageBucket != null ? String(file.storageBucket) : UCI_DOCUMENTS_STORAGE_BUCKET,
      storage_path: file.storagePath != null ? String(file.storagePath) : null,
      content_hash: file.contentHash != null ? String(file.contentHash) : null,
      idempotency_key: file.idempotencyKey != null ? String(file.idempotencyKey) : null,
      timestamp:
        file.downloadedAt != null
          ? String(file.downloadedAt)
          : file.storageUploadedAt != null
            ? String(file.storageUploadedAt)
            : null,
      suggested_package_slot: suggestion.suggested_slot,
      confidence: suggestion.confidence,
      suggestion_reason: suggestion.suggestion_reason,
    });
  }

  /** @type {Record<string, Array<Record<string, unknown>>>} */
  const suggestions_by_slot = {};
  const suggestionSlotKeys = [
    ...new Set([
      ...PACKAGE_SLOT_KEYS,
      ...requiredDocuments.map((req) => String(req.key ?? "")).filter(Boolean),
    ]),
  ];
  for (const slot of suggestionSlotKeys) {
    suggestions_by_slot[slot] = candidates.filter((c) => c.suggested_package_slot === slot);
  }

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    tenant_id: record.tenant_id ?? null,
    external_application_id: scopedExternalApplicationId || null,
    available_applications: availableApplications,
    required_slots: requiredDocuments.map((req) => ({
      key: String(req.key ?? ""),
      label: String(req.label ?? req.key ?? ""),
    })),
    candidates,
    suggestions_by_slot,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 * @param {string} candidateId
 */
async function resolveCandidateForMapping(
  supabase,
  coordinationRecordId,
  projectId,
  candidateId,
  externalApplicationId,
) {
  const projectDocumentPrefix = "project_document:";
  if (String(candidateId).startsWith(projectDocumentPrefix)) {
    const projectDocumentId = String(candidateId).slice(projectDocumentPrefix.length).trim();
    const doc = await loadProjectDocumentForPackage(supabase, projectId, projectDocumentId);
    if (!doc) {
      const err = new Error("Project document not found");
      err.statusCode = 404;
      err.code = "PROJECT_DOCUMENT_NOT_FOUND";
      throw err;
    }
    return {
      candidate_id: candidateId,
      source_type: "project_document",
      project_id: projectId,
      coordination_record_id: coordinationRecordId,
      project_document_id: String(doc.id),
      document_type: doc.document_type != null ? String(doc.document_type) : null,
      file_name: doc.file_name != null ? String(doc.file_name) : null,
    };
  }
  const listed = await listPackageDocumentCandidates(supabase, {
    coordinationRecordId,
    projectId,
    externalApplicationId: externalApplicationId || undefined,
  });
  const found = listed.candidates.find((c) => String(c.candidate_id) === String(candidateId));
  if (!found) {
    const err = new Error("Document candidate not found for this coordination record");
    err.statusCode = 404;
    err.code = "CANDIDATE_NOT_FOUND";
    throw err;
  }
  return found;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.applicationId
 * @param {string} params.userId
 * @param {string} params.slotKey
 * @param {string} params.candidateId
 */
async function confirmPackageDocumentMapping(supabase, params) {
  const applicationId = String(params.applicationId || "").trim();
  const userId = String(params.userId || "").trim();
  const slotKey = String(params.slotKey || "").trim();
  const candidateId = String(params.candidateId || "").trim();

  if (!slotKey || !candidateId) {
    const err = new Error("slot_key and candidate_id are required");
    err.statusCode = 400;
    err.code = "INVALID_PARAMS";
    throw err;
  }

  const application =
    params.application ?? (await getApplicationById(supabase, applicationId));
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  if (String(application.record_source) !== "agent_draft") {
    const err = new Error("Only agent draft application packages support document mapping");
    err.statusCode = 400;
    err.code = "INVALID_APPLICATION_TYPE";
    throw err;
  }

  if (String(application.idempotency_key) !== APPLICATION_PACKAGE_IDEMPOTENCY_KEY) {
    const err = new Error("Application is not an application package draft");
    err.statusCode = 400;
    err.code = "INVALID_APPLICATION_TYPE";
    throw err;
  }

  const coordinationRecordId = String(application.coordination_record_id ?? "");
  const projectId = String(application.project_id ?? "");

  const candidate = await resolveCandidateForMapping(
    supabase,
    coordinationRecordId,
    projectId,
    candidateId,
    params.externalApplicationId,
  );

  const existingDocs = Array.isArray(application.package_documents)
    ? /** @type {Array<Record<string, unknown>>} */ (application.package_documents)
    : [];
  const existingMapping = existingDocs.find((entry) => String(entry.key) === slotKey);
  const candidateAlreadyMapped =
    candidate.source_type === "project_document"
      ? String(existingMapping?.project_document_id ?? "") ===
        String(candidate.project_document_id ?? "")
      : String(existingMapping?.storage_path ?? "") === String(candidate.storage_path ?? "") &&
        String(existingMapping?.external_application_id ?? "") ===
          String(candidate.external_application_id ?? "");
  if (candidateAlreadyMapped) {
    return {
      application: withPackageReviewSummary(application),
      package_status:
        application.agent_draft_metadata?.application_package?.package_status ?? "incomplete",
      missing_documents:
        application.agent_draft_metadata?.application_package?.missing_documents ?? [],
      missing_fields: application.agent_draft_metadata?.application_package?.missing_fields ?? [],
      package_documents: existingDocs,
      no_change: true,
      message: "Already mapped",
    };
  }
  if (String(application.draft_status) === "reviewed") {
    throw Object.assign(new Error("Reopen review before changing package documents"), {
      statusCode: 409,
      code: "PACKAGE_REVIEW_LOCKED",
    });
  }

  const packageMetadata = application.agent_draft_metadata?.application_package;
  const storedSignatureRequirements = Array.isArray(packageMetadata?.signature_requirements)
    ? packageMetadata.signature_requirements
    : [];
  /** @type {Array<Record<string, unknown>>} */
  let required = existingMapping
    ? existingDocs.map((document) => {
        const signature = storedSignatureRequirements.find(
          (entry) => String(entry.document_key) === String(document.key),
        );
        return {
          key: document.key,
          label: document.label,
          signature_required: document.signature_required === true,
          signature_requirement_key: signature?.requirement_key,
        };
      })
    : [];
  let slotDef = required.find((entry) => String(entry.key) === slotKey);
  if (!slotDef) {
    const record = await getCoordinationRecordById(supabase, coordinationRecordId);
    if (!record) {
      const err = new Error("Coordination record not found");
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
    const providerCheck = validateProviderContext(record);
    if (!providerCheck.ok) {
      const err = new Error(providerCheck.message);
      err.statusCode = 400;
      err.code = providerCheck.code;
      throw err;
    }
    const template = await resolveTemplateForRecord(supabase, record, {
      checklistMode:
        packageMetadata?.checklist_mode != null
          ? String(packageMetadata.checklist_mode)
          : undefined,
    });
    required = Array.isArray(template.required_documents)
      ? /** @type {Array<Record<string, unknown>>} */ (template.required_documents)
      : [];
    slotDef = required.find((entry) => String(entry.key) === slotKey);
  }
  if (!slotDef) {
    const err = new Error(`Unknown package document slot: ${slotKey}`);
    err.statusCode = 400;
    err.code = "INVALID_SLOT";
    throw err;
  }

  const confirmedAt = new Date().toISOString();
  /** @type {Record<string, unknown>} */
  let mappingEntry;

  if (candidate.source_type === "pepco_portal") {
    mappingEntry = {
      key: slotKey,
      label: String(slotDef.label ?? slotKey),
      status: "attached",
      source: "pepco_portal",
      user_confirmed: true,
      file_name: candidate.file_name,
      pepco_document_name: candidate.pepco_document_name,
      storage_bucket: candidate.storage_bucket,
      storage_path: candidate.storage_path,
      content_hash: candidate.content_hash,
      idempotency_key: candidate.idempotency_key,
      external_application_id: candidate.external_application_id,
      coordination_record_id: coordinationRecordId,
      confirmed_by: userId,
      confirmed_at: confirmedAt,
      signature_required: slotDef.signature_required === true,
      signature_status:
        slotDef.signature_required === true &&
        /(^|[^A-Z0-9])UNSIGNED([^A-Z0-9]|$)/i.test(String(candidate.file_name ?? ""))
          ? "unsigned"
          : slotDef.signature_required === true
            ? "unknown"
            : undefined,
    };
  } else {
    mappingEntry = {
      key: slotKey,
      label: String(slotDef.label ?? slotKey),
      status: "attached",
      source: "project_documents",
      user_confirmed: true,
      project_document_id: String(candidate.project_document_id),
      document_type:
        candidate.document_type != null ? String(candidate.document_type) : null,
      file_name: candidate.file_name != null ? String(candidate.file_name) : null,
      confirmed_by: userId,
      confirmed_at: confirmedAt,
    };
  }

  const nextDocs = existingDocs.filter((d) => String(d.key) !== slotKey);
  nextDocs.push(mappingEntry);

  const legacyPackageMetadata =
    application.agent_draft_metadata?.application_package &&
    typeof application.agent_draft_metadata.application_package === "object" &&
    !Array.isArray(application.agent_draft_metadata.application_package)
      ? application.agent_draft_metadata.application_package
      : null;
  if (!legacyPackageMetadata || !Array.isArray(legacyPackageMetadata.missing_fields)) {
    return refreshApplicationPackageDocumentSlots(supabase, {
      applicationId,
      userId,
      packageDocumentsSeed: nextDocs,
    });
  }

  const signatureEval = applyDocumentSignatureRequirements(nextDocs, required);
  const missingDocuments = required
    .map((entry) => String(entry.key ?? ""))
    .filter(
      (key) =>
        key &&
        !signatureEval.packageDocuments.some(
          (entry) => String(entry.key) === key && String(entry.status) === "attached",
        ),
    );
  const previousMetadata =
    application.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? application.agent_draft_metadata
      : {};
  const previousPackage =
    previousMetadata.application_package &&
    typeof previousMetadata.application_package === "object" &&
    !Array.isArray(previousMetadata.application_package)
      ? previousMetadata.application_package
      : {};
  const signatureRequirementKeys = new Set(
    required
      .filter((entry) => entry.signature_required === true)
      .map((entry) => String(entry.signature_requirement_key ?? `${entry.key}_signature`)),
  );
  const missingFields = [
    ...(Array.isArray(previousPackage.missing_fields)
      ? previousPackage.missing_fields.filter(
          (key) => !signatureRequirementKeys.has(String(key)),
        )
      : []),
    ...signatureEval.missingSignatureFields,
  ];
  const packageStatus =
    String(previousPackage.package_status) === "blocked"
      ? "blocked"
      : missingDocuments.length > 0 || missingFields.length > 0
        ? "incomplete"
        : "ready_for_review";
  const now = new Date().toISOString();
  const packageReview =
    previousPackage.package_review &&
    typeof previousPackage.package_review === "object" &&
    !Array.isArray(previousPackage.package_review)
      ? previousPackage.package_review
      : {};
  const mappingHistory = Array.isArray(packageReview.mapping_history)
    ? packageReview.mapping_history
    : [];
  const nextMetadata = {
    ...previousMetadata,
    application_package: {
      ...previousPackage,
      package_status: packageStatus,
      missing_documents: missingDocuments,
      missing_fields: missingFields,
      signature_requirements: signatureEval.signatureRequirements,
      package_review: {
        ...packageReview,
        mapping_history: [
          ...mappingHistory,
          {
            action: "change_document_mapping",
            item_key: slotKey,
            actor_user_id: userId,
            at: now,
            prior_mapping: existingMapping ?? null,
            next_mapping: mappingEntry,
          },
        ],
        updated_at: now,
        updated_by_user_id: userId,
      },
      document_mapping_refreshed_at: now,
      document_mapping_refreshed_by: userId,
    },
  };
  const patch = {
    package_documents: signatureEval.packageDocuments,
    agent_draft_metadata: nextMetadata,
    ...(String(application.draft_status) === "reviewed"
      ? { draft_status: "needs_changes", reviewed_by: null, reviewed_at: null }
      : {}),
  };
  const { error } = await supabase
    .from("coordination_applications")
    .update(patch)
    .eq("id", applicationId)
    .select("id")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update package document"), {
      cause: error,
      statusCode: 500,
      code: "APPLICATION_UPDATE_FAILED",
    });
  }
  return {
    application: withPackageReviewSummary({ ...application, ...patch }),
    package_status: packageStatus,
    missing_documents: missingDocuments,
    missing_fields: missingFields,
    package_documents: signatureEval.packageDocuments,
    no_change: false,
  };
}

/**
 * True when any row exists for the application in an optional audit table.
 * Missing tables (pre-migration) are treated as empty.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} table
 * @param {string} applicationId
 */
async function applicationHasAuditRows(supabase, table, applicationId) {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("application_id", applicationId)
    .limit(1);

  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      msg.includes("does not exist") ||
      msg.includes("schema cache")
    ) {
      return false;
    }
    throw Object.assign(new Error(error.message || `Failed to read ${table}`), {
      cause: error,
      statusCode: 500,
      code: "AUDIT_LOOKUP_FAILED",
    });
  }

  return Array.isArray(data) && data.length > 0;
}

/**
 * Block destructive package mapping removal after review / prepare / transmit / submit.
 * Source documents remain on the project; operators must supersede with a new package.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} application
 */
async function assertPackageDocumentRemovalAllowed(supabase, application) {
  const draftStatus = String(application.draft_status || "");
  if (draftStatus === "reviewed") {
    throw Object.assign(
      new Error(
        "Package is reviewed — reopen / request changes and use a new package if correction is needed. Source documents are preserved.",
      ),
      { statusCode: 409, code: "PACKAGE_REVIEW_LOCKED" },
    );
  }
  if (draftStatus === "submitted" || application.submitted_at) {
    throw Object.assign(
      new Error(
        "Package is submitted — destructive Remove is blocked. Source documents and historical package snapshots are preserved.",
      ),
      { statusCode: 409, code: "PACKAGE_SUBMITTED_LOCKED" },
    );
  }

  const applicationId = String(application.id || "");
  const [hasPrep, hasTransmission, hasValidation] = await Promise.all([
    applicationHasAuditRows(supabase, "submission_preparations", applicationId),
    applicationHasAuditRows(supabase, "submission_transmission_attempts", applicationId),
    applicationHasAuditRows(supabase, "submission_validation_attempts", applicationId),
  ]);

  if (hasTransmission) {
    throw Object.assign(
      new Error(
        "Package has transmission history — destructive Remove is blocked. Prepare a new / superseded package instead.",
      ),
      { statusCode: 409, code: "PACKAGE_TRANSMISSION_LOCKED" },
    );
  }
  if (hasPrep) {
    throw Object.assign(
      new Error(
        "Package has a submission preparation — destructive Remove is blocked. Prepare a new / superseded package instead.",
      ),
      { statusCode: 409, code: "PACKAGE_PREPARATION_LOCKED" },
    );
  }
  if (hasValidation) {
    throw Object.assign(
      new Error(
        "Package has validation history — destructive Remove is blocked. Prepare a new / superseded package instead.",
      ),
      { statusCode: 409, code: "PACKAGE_SUBMISSION_HISTORY_LOCKED" },
    );
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.applicationId
 * @param {string} params.userId
 * @param {string} params.slotKey
 */
async function removePackageDocumentMapping(supabase, params) {
  const applicationId = String(params.applicationId || "").trim();
  const slotKey = String(params.slotKey || "").trim();

  if (!slotKey) {
    const err = new Error("slot_key is required");
    err.statusCode = 400;
    err.code = "INVALID_PARAMS";
    throw err;
  }

  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  await assertPackageDocumentRemovalAllowed(supabase, application);

  const existingDocs = Array.isArray(application.package_documents)
    ? /** @type {Array<Record<string, unknown>>} */ (application.package_documents)
    : [];
  const nextDocs = existingDocs.filter((d) => String(d.key) !== slotKey);

  return refreshApplicationPackageDocumentSlots(supabase, {
    applicationId,
    userId: params.userId,
    packageDocumentsSeed: nextDocs,
  });
}

/**
 * Re-resolve package document slots and metadata without resetting review state.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.applicationId
 * @param {string} [params.userId]
 * @param {Array<Record<string, unknown>>} [params.packageDocumentsSeed]
 */
async function refreshApplicationPackageDocumentSlots(supabase, params) {
  const applicationId = String(params.applicationId || "").trim();
  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const coordinationRecordId = String(application.coordination_record_id ?? "");
  const projectId = String(application.project_id ?? "");
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record || String(record.project_id) !== projectId) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const providerCheck = validateProviderContext(record);
  if (!providerCheck.ok) {
    const err = new Error(providerCheck.message);
    err.statusCode = 400;
    err.code = providerCheck.code;
    throw err;
  }

  const checklistMode =
    application.agent_draft_metadata?.application_package?.checklist_mode != null
      ? String(application.agent_draft_metadata.application_package.checklist_mode)
      : undefined;
  const template = await resolveTemplateForRecord(supabase, record, { checklistMode });

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

  if (projectResult.error || !projectResult.data) {
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

  const applications = Array.isArray(applicationsResult.data) ? applicationsResult.data : [];
  const loadProfileDraft = findLoadProfileDraftApplication(applications);
  const loadSummary =
    loadProfileDraft &&
    loadProfileDraft.load_summary &&
    typeof loadProfileDraft.load_summary === "object" &&
    !Array.isArray(loadProfileDraft.load_summary)
      ? /** @type {Record<string, unknown>} */ (loadProfileDraft.load_summary)
      : null;

  const requiredDocuments = Array.isArray(template.required_documents)
    ? /** @type {Array<Record<string, unknown>>} */ (template.required_documents)
    : [];
  const requiredFields = Array.isArray(template.required_fields)
    ? /** @type {Array<Record<string, unknown>>} */ (template.required_fields)
    : [];

  const accessContext = {
    projectId,
    coordinationRecordId,
    tenantId: record.tenant_id != null ? String(record.tenant_id) : null,
  };

  const seed =
    params.packageDocumentsSeed ??
    (Array.isArray(application.package_documents) ? application.package_documents : []);

  const prevMeta =
    application.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? /** @type {Record<string, unknown>} */ (application.agent_draft_metadata)
      : {};
  const prevPkg =
    prevMeta.application_package &&
    typeof prevMeta.application_package === "object" &&
    !Array.isArray(prevMeta.application_package)
      ? /** @type {Record<string, unknown>} */ (prevMeta.application_package)
      : {};
  const snapshotAddress =
    prevPkg.project_address &&
    typeof prevPkg.project_address === "object" &&
    !Array.isArray(prevPkg.project_address)
      ? /** @type {Record<string, unknown>} */ (prevPkg.project_address)
      : null;
  const mappedDoc = seed.find((entry) => entry?.external_application_id != null);
  const externalApplicationId =
    snapshotAddress?.external_application_id != null
      ? String(snapshotAddress.external_application_id)
      : mappedDoc?.external_application_id != null
        ? String(mappedDoc.external_application_id)
        : undefined;

  const registryDocuments = await loadRegistryDocumentsForPackage(
    supabase,
    coordinationRecordId,
    projectId,
  );

  const docMatch = resolvePackageDocumentSlots({
    requiredDocuments,
    projectDocuments: Array.isArray(documentsResult.data) ? documentsResult.data : [],
    existingPackageDocuments: /** @type {Array<Record<string, unknown>>} */ (seed),
    pepcoPortalFiles: extractPepcoPortalFiles(record),
    registryDocuments,
    accessContext,
  });
  const signatureEval = applyDocumentSignatureRequirements(
    docMatch.packageDocuments,
    requiredDocuments,
  );

  const fieldEval = evaluateRequiredFields(
    projectResult.data,
    loadSummary,
    requiredFields,
    record,
    { externalApplicationId },
  );
  const syntheticChecklist =
    prevPkg.synthetic_checklist &&
    typeof prevPkg.synthetic_checklist === "object" &&
    !Array.isArray(prevPkg.synthetic_checklist)
      ? /** @type {Record<string, unknown>} */ (prevPkg.synthetic_checklist)
      : {};
  const checklistApproved =
    isSyntheticTestTemplate(template) && String(syntheticChecklist.status ?? "") === "approved";
  const missingFields = [
    ...fieldEval.missingFields,
    ...signatureEval.missingSignatureFields,
    ...(isSyntheticTestTemplate(template) && !checklistApproved
      ? ["synthetic_checklist_approval"]
      : []),
  ];

  const packageStatus = resolvePackageStatus({
    missingDocuments: docMatch.missingDocuments,
    missingFields,
    loadSummary,
    hasLoadProfileDraft: Boolean(loadProfileDraft),
    addressReviewRequired: fieldEval.addressResolution.address_review_required,
  });

  const addressResolution = fieldEval.addressResolution;
  const agentDraftMetadata = {
    ...prevMeta,
    application_package: {
      ...prevPkg,
      package_status: packageStatus,
      missing_documents: docMatch.missingDocuments,
      missing_fields: missingFields,
      field_results: fieldEval.fieldResults,
      signature_requirements: signatureEval.signatureRequirements,
      project_address: {
        formatted: addressResolution.address.formatted,
        source: addressResolution.address.source,
        complete: addressResolution.address.complete,
        fallback_used: Boolean(addressResolution.address.fallback_used),
        parts: addressResolution.address.parts ?? null,
        selection_reason: addressResolution.address_selection_reason ?? null,
        external_application_id: externalApplicationId ?? null,
      },
      address_source_acknowledged: addressResolution.address_source_acknowledged,
      address_mismatch: addressResolution.address_mismatch,
      mismatch_warning: addressResolution.mismatch_warning,
      address_review_required: addressResolution.address_review_required,
      document_mapping_refreshed_at: new Date().toISOString(),
      document_mapping_refreshed_by: params.userId ?? null,
    },
  };

  const { data, error } = await supabase
    .from("coordination_applications")
    .update({
      package_documents: signatureEval.packageDocuments,
      agent_draft_metadata: agentDraftMetadata,
      ...(String(application.draft_status) === "reviewed"
        ? { draft_status: "needs_changes", reviewed_by: null, reviewed_at: null }
        : {}),
    })
    .eq("id", applicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to refresh package documents"), {
      cause: error,
      statusCode: 500,
      code: "APPLICATION_UPDATE_FAILED",
    });
  }

  return {
    application: data,
    package_status: packageStatus,
    missing_documents: docMatch.missingDocuments,
    missing_fields: missingFields,
    package_documents: signatureEval.packageDocuments,
  };
}

module.exports = {
  PACKAGE_SLOT_KEYS,
  normalizeDocumentType,
  parseCoordinationMetadata,
  listPepcoExternalApplicationsFromRecord,
  suggestPackageSlotForCandidate,
  extractPepcoPortalFiles,
  validatePepcoStoragePathForRecord,
  isPepcoPortalFileAccessible,
  pepcoCandidateId,
  projectDocumentCandidateId,
  resolvePackageDocumentSlots,
  listPackageDocumentCandidates,
  confirmPackageDocumentMapping,
  removePackageDocumentMapping,
  assertPackageDocumentRemovalAllowed,
  refreshApplicationPackageDocumentSlots,
};
