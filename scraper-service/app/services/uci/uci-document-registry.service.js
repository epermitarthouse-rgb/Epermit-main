"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");
const { classifyDocumentRole, inferSignatureStatus } = require("./uci-document-classifier.service.js");
const {
  normalizeDocumentTypeToRole,
  resolveStageConsumersForRole,
  matchProviderSlotsForRole,
  resolveClassificationReview,
  NORMALIZED_ROLES,
} = require("./uci-document-role-stages.js");
const {
  validateProviderContext,
  normalizeUtilityType,
  findApplicationPackageDraft,
} = require("./uci-application-builder.service.js");
const { resolveApplicationTemplateManifest } = require("./uci-provider-application-template.service.js");

const REGISTRY_TABLE = "uci_document_registry_entries";
const PROJECT_DOCUMENTS_SELECT =
  "id, project_id, user_id, document_type, file_name, file_path, file_type, file_size, description, created_at, updated_at";

/**
 * @param {string | null | undefined} manualRole
 * @param {string | null | undefined} detectedRole
 * @returns {string | null}
 */
function resolveEffectiveRole(manualRole, detectedRole) {
  const manual = manualRole ? String(manualRole).trim().toLowerCase() : "";
  if (manual && manual !== "other") return manual;
  const detected = detectedRole ? String(detectedRole).trim().toLowerCase() : "";
  return detected || null;
}

/**
 * @param {Record<string, unknown>} entry
 * @param {Array<Record<string, unknown>>} requiredDocuments
 * @returns {Record<string, unknown>}
 */
function enrichRegistryEntry(entry, requiredDocuments = []) {
  const effectiveRole = resolveEffectiveRole(
    entry.manual_role != null ? String(entry.manual_role) : null,
    entry.detected_role != null ? String(entry.detected_role) : null,
  );
  const stageConsumers = resolveStageConsumersForRole(effectiveRole);
  const providerSlotKeys = matchProviderSlotsForRole(effectiveRole, requiredDocuments);
  const confidence = String(entry.role_confidence ?? "low");
  const classificationReview =
    entry.manual_role != null
      ? "auto_accepted"
      : resolveClassificationReview(confidence, effectiveRole);

  return {
    ...entry,
    effective_role: effectiveRole,
    stage_consumers: stageConsumers,
    provider_slot_keys: providerSlotKeys,
    classification_review: classificationReview,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function resolveTemplateRequiredDocuments(supabase, record) {
  const providerCheck = validateProviderContext(record);
  if (!providerCheck.ok) return [];
  const packageDraft = await findApplicationPackageDraft(
    supabase,
    String(record.id),
    String(record.project_id),
  );
  const checklistMode =
    packageDraft?.agent_draft_metadata?.application_package?.checklist_mode != null
      ? String(packageDraft.agent_draft_metadata.application_package.checklist_mode)
      : undefined;
  const resolved = await resolveApplicationTemplateManifest(supabase, {
    providerSlug: providerCheck.providerSlug,
    providerId: record.utility_provider_id,
    utilityType: normalizeUtilityType(record.utility_type),
    checklistMode,
    coordinationMetadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? /** @type {Record<string, unknown>} */ (record.metadata)
        : {},
  });
  return Array.isArray(resolved.template?.required_documents)
    ? resolved.template.required_documents
    : [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function classifyAndUpsertRegistryEntry(supabase, params) {
  const {
    record,
    projectDocument,
    provenance = "unknown",
    hintRole = null,
    userId = null,
    preserveManualRole = true,
  } = params;

  const coordinationRecordId = String(record.id);
  const projectId = String(record.project_id);
  const projectDocumentId = String(projectDocument.id);

  const { data: existing, error: existingError } = await supabase
    .from(REGISTRY_TABLE)
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_document_id", projectDocumentId)
    .maybeSingle();

  if (existingError) {
    throw Object.assign(new Error(existingError.message || "Failed to load registry entry"), {
      cause: existingError,
      statusCode: 500,
      code: "REGISTRY_LOOKUP_FAILED",
    });
  }

  const classification = classifyDocumentRole(projectDocument, { hintRole, provenance });
  const manualRole =
    preserveManualRole && existing?.manual_role ? String(existing.manual_role) : null;
  const effectiveRole = resolveEffectiveRole(manualRole, classification.detected_role);
  const stageConsumers = resolveStageConsumersForRole(effectiveRole);
  const requiredDocuments = await resolveTemplateRequiredDocuments(supabase, record);
  const providerSlotKeys = matchProviderSlotsForRole(effectiveRole, requiredDocuments);
  const signatureStatus =
    existing?.signature_status ??
    inferSignatureStatus(effectiveRole, projectDocument);

  const now = new Date().toISOString();
  const row = {
    project_id: projectId,
    tenant_id: record.tenant_id ?? null,
    coordination_record_id: coordinationRecordId,
    project_document_id: projectDocumentId,
    detected_role: classification.detected_role,
    role_confidence: classification.role_confidence,
    manual_role: manualRole,
    effective_role: effectiveRole,
    provenance: existing?.provenance && provenance === "unknown" ? existing.provenance : provenance,
    signature_status: signatureStatus,
    signed_project_document_id: existing?.signed_project_document_id ?? null,
    stage_consumers: stageConsumers,
    provider_slot_keys: providerSlotKeys,
    classification_review:
      manualRole != null
        ? "auto_accepted"
        : classification.classification_review,
    metadata: {
      ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
      classification_reason: classification.classification_reason,
      last_classified_at: now,
    },
    classified_at: now,
    role_overridden_at: existing?.role_overridden_at ?? null,
    role_overridden_by: existing?.role_overridden_by ?? null,
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from(REGISTRY_TABLE)
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) {
      throw Object.assign(new Error(error.message || "Failed to update registry entry"), {
        cause: error,
        statusCode: 500,
        code: "REGISTRY_UPDATE_FAILED",
      });
    }
    return enrichRegistryEntry(data, requiredDocuments);
  }

  const { data, error } = await supabase
    .from(REGISTRY_TABLE)
    .insert({ ...row, role_overridden_by: userId })
    .select("*")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to create registry entry"), {
      cause: error,
      statusCode: 500,
      code: "REGISTRY_INSERT_FAILED",
    });
  }
  return enrichRegistryEntry(data, requiredDocuments);
}

/**
 * Sync registry for all project documents on a coordination record.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function syncRegistryForCoordination(supabase, params) {
  const coordinationRecordId = String(params.coordinationRecordId || "").trim();
  const record =
    params.record ?? (await getCoordinationRecordById(supabase, coordinationRecordId));
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);
  const { data: docs, error: docsError } = await supabase
    .from("project_documents")
    .select(PROJECT_DOCUMENTS_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (docsError) {
    throw Object.assign(new Error(docsError.message || "Failed to load project documents"), {
      cause: docsError,
      statusCode: 500,
      code: "DOCUMENTS_FETCH_FAILED",
    });
  }

  /** @type {Array<Record<string, unknown>>} */
  const entries = [];
  for (const doc of Array.isArray(docs) ? docs : []) {
    const entry = await classifyAndUpsertRegistryEntry(supabase, {
      record,
      projectDocument: doc,
      provenance: "unknown",
      userId: params.userId ?? null,
    });
    entries.push(entry);
  }

  return entries;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function registerProjectDocument(supabase, params) {
  const {
    coordinationRecordId,
    projectDocumentId,
    provenance = "manual_upload",
    hintRole = null,
    userId = null,
  } = params;

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const { data: doc, error: docError } = await supabase
    .from("project_documents")
    .select(PROJECT_DOCUMENTS_SELECT)
    .eq("id", projectDocumentId)
    .eq("project_id", String(record.project_id))
    .maybeSingle();

  if (docError || !doc) {
    const err = new Error("Project document not found");
    err.statusCode = docError ? 500 : 404;
    err.code = docError ? "DOCUMENT_FETCH_FAILED" : "NOT_FOUND";
    if (docError) err.cause = docError;
    throw err;
  }

  return classifyAndUpsertRegistryEntry(supabase, {
    record,
    projectDocument: doc,
    provenance,
    hintRole,
    userId,
    preserveManualRole: true,
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function listDocumentRegistry(supabase, params) {
  const coordinationRecordId = String(params.coordinationRecordId || "").trim();
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id);
  const requiredDocuments = await resolveTemplateRequiredDocuments(supabase, record);

  const { data: registryRows, error: registryError } = await supabase
    .from(REGISTRY_TABLE)
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .order("created_at", { ascending: false });

  if (registryError) {
    throw Object.assign(new Error(registryError.message || "Failed to load registry"), {
      cause: registryError,
      statusCode: 500,
      code: "REGISTRY_FETCH_FAILED",
    });
  }

  const { data: projectDocs, error: docsError } = await supabase
    .from("project_documents")
    .select(PROJECT_DOCUMENTS_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (docsError) {
    throw Object.assign(new Error(docsError.message || "Failed to load project documents"), {
      cause: docsError,
      statusCode: 500,
      code: "DOCUMENTS_FETCH_FAILED",
    });
  }

  const registryByDocId = new Map(
    (Array.isArray(registryRows) ? registryRows : []).map((row) => [
      String(row.project_document_id),
      row,
    ]),
  );

  /** @type {Array<Record<string, unknown>>} */
  const documents = [];
  for (const doc of Array.isArray(projectDocs) ? projectDocs : []) {
    const docId = String(doc.id);
    let registry = registryByDocId.get(docId);
    if (!registry) {
      registry = await classifyAndUpsertRegistryEntry(supabase, {
        record,
        projectDocument: doc,
        provenance: "unknown",
        userId: params.userId ?? null,
      });
    }
    documents.push(
      enrichRegistryEntry(
        {
          ...registry,
          project_document: doc,
        },
        requiredDocuments,
      ),
    );
  }

  const needsReview = documents.filter(
    (d) =>
      d.classification_review === "review_recommended" ||
      d.classification_review === "needs_classification",
  );

  return {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    documents,
    needs_review: needsReview,
    total_count: documents.length,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function overrideDocumentRole(supabase, params) {
  const coordinationRecordId = String(params.coordinationRecordId || "").trim();
  const projectDocumentId = String(params.projectDocumentId || "").trim();
  const manualRole = normalizeDocumentTypeToRole(params.manualRole);

  if (!NORMALIZED_ROLES.has(manualRole)) {
    const err = new Error(`Invalid document role: ${manualRole}`);
    err.statusCode = 400;
    err.code = "INVALID_ROLE";
    throw err;
  }

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const requiredDocuments = await resolveTemplateRequiredDocuments(supabase, record);
  const stageConsumers = resolveStageConsumersForRole(manualRole);
  const providerSlotKeys = matchProviderSlotsForRole(manualRole, requiredDocuments);
  const now = new Date().toISOString();

  const { data: existing, error: existingError } = await supabase
    .from(REGISTRY_TABLE)
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_document_id", projectDocumentId)
    .maybeSingle();

  if (existingError) {
    throw Object.assign(new Error(existingError.message || "Failed to load registry entry"), {
      cause: existingError,
      statusCode: 500,
      code: "REGISTRY_LOOKUP_FAILED",
    });
  }

  const patch = {
    manual_role: manualRole,
    effective_role: manualRole,
    stage_consumers: stageConsumers,
    provider_slot_keys: providerSlotKeys,
    classification_review: "auto_accepted",
    role_overridden_at: now,
    role_overridden_by: params.userId ?? null,
    metadata: {
      ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
      override_note: params.note ? String(params.note) : null,
    },
  };

  let updated;
  if (existing?.id) {
    const { data, error } = await supabase
      .from(REGISTRY_TABLE)
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) {
      throw Object.assign(new Error(error.message || "Failed to override role"), {
        cause: error,
        statusCode: 500,
        code: "REGISTRY_UPDATE_FAILED",
      });
    }
    updated = data;
  } else {
    const { data: doc } = await supabase
      .from("project_documents")
      .select(PROJECT_DOCUMENTS_SELECT)
      .eq("id", projectDocumentId)
      .eq("project_id", String(record.project_id))
      .maybeSingle();
    if (!doc) {
      const err = new Error("Project document not found");
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
    const classification = classifyDocumentRole(doc);
    const { data, error } = await supabase
      .from(REGISTRY_TABLE)
      .insert({
        project_id: String(record.project_id),
        tenant_id: record.tenant_id ?? null,
        coordination_record_id: coordinationRecordId,
        project_document_id: projectDocumentId,
        detected_role: classification.detected_role,
        role_confidence: classification.role_confidence,
        provenance: "reclassified",
        classified_at: now,
        ...patch,
      })
      .select("*")
      .single();
    if (error) {
      throw Object.assign(new Error(error.message || "Failed to create registry entry"), {
        cause: error,
        statusCode: 500,
        code: "REGISTRY_INSERT_FAILED",
      });
    }
    updated = data;
  }

  const { data: doc } = await supabase
    .from("project_documents")
    .select(PROJECT_DOCUMENTS_SELECT)
    .eq("id", projectDocumentId)
    .maybeSingle();

  return enrichRegistryEntry({ ...updated, project_document: doc ?? null }, requiredDocuments);
}

/**
 * Provider requirements readiness from registry + template.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function getProviderRequirementsStatus(supabase, params) {
  const coordinationRecordId = String(params.coordinationRecordId || "").trim();
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const providerCheck = validateProviderContext(record);
  const requiredDocuments = await resolveTemplateRequiredDocuments(supabase, record);
  const registry = await listDocumentRegistry(supabase, {
    coordinationRecordId,
    userId: params.userId ?? null,
  });

  /** @type {Map<string, Record<string, unknown>>} */
  const roleToDoc = new Map();
  for (const entry of registry.documents) {
    const role = String(entry.effective_role ?? "");
    if (!role || role === "other") continue;
    if (!roleToDoc.has(role)) {
      roleToDoc.set(role, entry);
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const slots = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const signatureRequired = [];

  for (const req of requiredDocuments) {
    const slotKey = String(req.key ?? "");
    const label = String(req.label ?? slotKey);
    const aliases = [
      slotKey,
      ...(Array.isArray(req.aliases) ? req.aliases.map((a) => String(a)) : []),
    ].map((a) =>
      String(a)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_"),
    );

    let matchedEntry = null;
    for (const entry of registry.documents) {
      const entrySlots = Array.isArray(entry.provider_slot_keys) ? entry.provider_slot_keys : [];
      if (entrySlots.includes(slotKey)) {
        matchedEntry = entry;
        break;
      }
      const effectiveRole = String(entry.effective_role ?? "");
      const roleSlots = aliases.filter((a) =>
        (entrySlots.length ? entrySlots : [effectiveRole]).some(
          (s) => String(s).toLowerCase().replace(/[\s-]+/g, "_") === a,
        ),
      );
      if (roleSlots.length) {
        matchedEntry = entry;
        break;
      }
    }

    const signatureRequiredSlot = req.signature_required === true;
    const signatureStatus =
      matchedEntry?.signature_status != null ? String(matchedEntry.signature_status) : null;
    const ready =
      matchedEntry != null &&
      (!signatureRequiredSlot || signatureStatus === "signed" || signatureStatus === "signed_manual_verified");

    if (!matchedEntry) missing.push(slotKey);
    if (signatureRequiredSlot && signatureStatus !== "signed" && signatureStatus !== "signed_manual_verified") {
      signatureRequired.push(slotKey);
    }

    slots.push({
      key: slotKey,
      label,
      aliases,
      signature_required: signatureRequiredSlot,
      signature_status: signatureStatus,
      ready,
      matched_project_document_id:
        matchedEntry?.project_document_id != null ? String(matchedEntry.project_document_id) : null,
      matched_file_name:
        matchedEntry?.project_document?.file_name != null
          ? String(matchedEntry.project_document.file_name)
          : null,
      matched_effective_role:
        matchedEntry?.effective_role != null ? String(matchedEntry.effective_role) : null,
      matched_confidence:
        matchedEntry?.role_confidence != null ? String(matchedEntry.role_confidence) : null,
    });
  }

  const readyCount = slots.filter((s) => s.ready).length;
  const totalCount = slots.length;

  return {
    coordination_record_id: coordinationRecordId,
    provider_slug: providerCheck.ok ? providerCheck.providerSlug : null,
    template_version: requiredDocuments.length ? "provider-template" : null,
    readiness: {
      ready_count: readyCount,
      total_count: totalCount,
      label: totalCount ? `${readyCount}/${totalCount}` : "0/0",
      complete: totalCount > 0 && readyCount === totalCount,
    },
    missing_slots: missing,
    signature_required_slots: signatureRequired,
    slots,
  };
}

/**
 * Find best registry match for a provider slot key.
 *
 * @param {Array<Record<string, unknown>>} registryDocuments
 * @param {string} slotKey
 * @param {string[]} aliases
 * @returns {Record<string, unknown> | null}
 */
function findRegistryMatchForSlot(registryDocuments, slotKey, aliases = []) {
  const normalizedAliases = [
    slotKey,
    ...aliases,
  ].map((a) =>
    String(a)
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );

  for (const entry of registryDocuments) {
    const entrySlots = Array.isArray(entry.provider_slot_keys) ? entry.provider_slot_keys : [];
    if (entrySlots.includes(slotKey)) return entry;
    const effectiveRole = String(entry.effective_role ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (normalizedAliases.includes(effectiveRole)) return entry;
  }
  return null;
}

/**
 * Load registry documents indexed for package slot resolution.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} coordinationRecordId
 * @param {string} projectId
 */
async function loadRegistryDocumentsForPackage(supabase, coordinationRecordId, projectId) {
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record || String(record.project_id) !== projectId) return [];

  const { data: registryRows } = await supabase
    .from(REGISTRY_TABLE)
    .select("*, project_document:project_documents(id, document_type, file_name, file_type, created_at)")
    .eq("coordination_record_id", coordinationRecordId);

  if (!Array.isArray(registryRows) || !registryRows.length) {
    await syncRegistryForCoordination(supabase, { coordinationRecordId, record });
    const { data: refreshed } = await supabase
      .from(REGISTRY_TABLE)
      .select("*, project_document:project_documents(id, document_type, file_name, file_type, created_at)")
      .eq("coordination_record_id", coordinationRecordId);
    const requiredDocuments = await resolveTemplateRequiredDocuments(supabase, record);
    return (Array.isArray(refreshed) ? refreshed : []).map((row) =>
      enrichRegistryEntry(row, requiredDocuments),
    );
  }

  const requiredDocuments = await resolveTemplateRequiredDocuments(supabase, record);
  return registryRows.map((row) => enrichRegistryEntry(row, requiredDocuments));
}

module.exports = {
  REGISTRY_TABLE,
  resolveEffectiveRole,
  enrichRegistryEntry,
  classifyAndUpsertRegistryEntry,
  syncRegistryForCoordination,
  registerProjectDocument,
  listDocumentRegistry,
  overrideDocumentRole,
  getProviderRequirementsStatus,
  findRegistryMatchForSlot,
  loadRegistryDocumentsForPackage,
};
