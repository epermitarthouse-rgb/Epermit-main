"use strict";

const fs = require("fs");
const path = require("path");
const {
  TEMPLATES_ROOT,
  normalizeUtilityType,
  normalizeProviderSlug,
  SYNTHETIC_TEST_CHECKLIST_MODE,
} = require("./uci-application-builder.service.js");

/** Coordination metadata key for run-scoped manual template activation. */
const ACTIVE_APPLICATION_TEMPLATE_META_KEY = "active_application_template";

/**
 * @param {string} utilityType
 * @param {string} [applicationType]
 * @returns {string}
 */
function buildTemplateStorageKey(utilityType, applicationType = "new_service") {
  return `${normalizeUtilityType(utilityType)}:${String(applicationType ?? "new_service")
    .trim()
    .toLowerCase()}`;
}

/**
 * @param {unknown} manifest
 * @returns {{ ok: true, manifest: Record<string, unknown> } | { ok: false, message: string }}
 */
function validateApplicationTemplateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, message: "Template manifest must be a JSON object" };
  }
  const record = /** @type {Record<string, unknown>} */ (manifest);
  if (!Array.isArray(record.required_documents)) {
    return { ok: false, message: "Template manifest must include required_documents array" };
  }
  if (!Array.isArray(record.required_fields)) {
    return { ok: false, message: "Template manifest must include required_fields array" };
  }
  for (const entry of record.required_documents) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "Each required_documents entry must be an object" };
    }
    if (!String(/** @type {{ key?: unknown }} */ (entry).key ?? "").trim()) {
      return { ok: false, message: "Each required_documents entry must include key" };
    }
  }
  for (const entry of record.required_fields) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "Each required_fields entry must be an object" };
    }
    if (!String(/** @type {{ key?: unknown }} */ (entry).key ?? "").trim()) {
      return { ok: false, message: "Each required_fields entry must include key" };
    }
  }
  return { ok: true, manifest: record };
}

/**
 * @param {string} providerSlug
 * @param {string} utilityType
 * @param {object} [options]
 * @returns {Record<string, unknown> | null}
 */
function loadProviderSpecificFilesystemTemplate(providerSlug, utilityType, options = {}) {
  const slug = normalizeProviderSlug(providerSlug);
  const utility = normalizeUtilityType(utilityType);
  const checklistMode = String(options.checklistMode ?? "").trim().toLowerCase();

  const candidates = [
    ...(checklistMode === SYNTHETIC_TEST_CHECKLIST_MODE
      ? [path.join(TEMPLATES_ROOT, slug, `${utility}-new-service.synthetic-test.json`)]
      : []),
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
 * @param {string} utilityType
 * @returns {Record<string, unknown> | null}
 */
function loadGenericFilesystemTemplate(utilityType) {
  const utility = normalizeUtilityType(utilityType);
  const candidates = [
    path.join(TEMPLATES_ROOT, "_generic", `${utility}-new-service.json`),
    path.join(TEMPLATES_ROOT, "_generic", "default.json"),
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
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} providerId
 */
async function loadProviderTemplateStore(supabase, providerId) {
  const { data, error } = await supabase
    .from("utility_providers")
    .select("id, slug, uci_application_templates")
    .eq("id", providerId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load utility provider"), {
      cause: error,
      statusCode: 500,
      code: "PROVIDER_FETCH_FAILED",
    });
  }
  if (!data) {
    const err = new Error("Utility provider not found");
    err.statusCode = 404;
    err.code = "PROVIDER_NOT_FOUND";
    throw err;
  }

  const store =
    data.uci_application_templates &&
    typeof data.uci_application_templates === "object" &&
    !Array.isArray(data.uci_application_templates)
      ? /** @type {Record<string, unknown>} */ (data.uci_application_templates)
      : {};

  return {
    providerId: String(data.id),
    providerSlug: normalizeProviderSlug(data.slug),
    store,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function getStoredProviderApplicationTemplate(supabase, params) {
  const utilityType = normalizeUtilityType(params.utilityType);
  const applicationType = String(params.applicationType ?? "new_service").trim().toLowerCase();
  const key = buildTemplateStorageKey(utilityType, applicationType);
  const loaded = await loadProviderTemplateStore(supabase, String(params.providerId));
  const entry = loaded.store[key];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const record = /** @type {Record<string, unknown>} */ (entry);
  const manifestRaw = record.manifest;
  const validated = validateApplicationTemplateManifest(manifestRaw);
  if (!validated.ok) {
    return null;
  }
  return {
    manifest: validated.manifest,
    uploaded_at: record.uploaded_at != null ? String(record.uploaded_at) : null,
    uploaded_by_user_id:
      record.uploaded_by_user_id != null ? String(record.uploaded_by_user_id) : null,
    stored_version: record.stored_version != null ? String(record.stored_version) : null,
  };
}

/**
 * @param {object} params
 * @returns {{ template: Record<string, unknown> | null, resolution: Record<string, unknown> }}
 */
function buildResolutionResult(params) {
  const {
    template,
    source,
    providerSlug,
    utilityType,
    applicationType,
    extra = {},
  } = params;

  if (!template) {
    const generic = loadGenericFilesystemTemplate(utilityType);
    return {
      template: null,
      resolution: {
        source: "missing",
        status: "missing",
        provider_slug: normalizeProviderSlug(providerSlug),
        utility_type: normalizeUtilityType(utilityType),
        application_type: String(applicationType ?? "new_service").trim().toLowerCase(),
        is_manual: false,
        template_gap: true,
        generic_fallback_available: Boolean(generic),
        active_template: null,
        ...extra,
      },
    };
  }

  const isManual = source === "manual_upload" || source === "coordination_manual";
  const isSynthetic = String(template.checklist_mode ?? "") === SYNTHETIC_TEST_CHECKLIST_MODE;
  const version = String(template.version ?? extra.version ?? "").trim() || null;

  return {
    template,
    resolution: {
      source,
      status: "ready",
      provider_slug: normalizeProviderSlug(String(template.provider_slug ?? providerSlug)),
      utility_type: normalizeUtilityType(String(template.utility_type ?? utilityType)),
      application_type: String(template.application_type ?? applicationType ?? "new_service")
        .trim()
        .toLowerCase(),
      is_manual: isManual,
      template_gap: false,
      version,
      active_template: {
        source,
        version,
        label:
          template.label != null
            ? String(template.label)
            : isManual
              ? "Manual application template"
              : isSynthetic
                ? "Built-in synthetic checklist"
                : "Built-in provider template",
        provider_slug: normalizeProviderSlug(String(template.provider_slug ?? providerSlug)),
        uploaded_at: extra.uploaded_at ?? null,
        uploaded_by_user_id: extra.uploaded_by_user_id ?? null,
      },
      ...extra,
    },
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} metadata
 * @param {string} utilityType
 * @param {string} [applicationType]
 * @returns {{ manifest: Record<string, unknown>, uploaded_at: string | null, uploaded_by_user_id: string | null, stored_version: string | null } | null}
 */
function readCoordinationActiveTemplate(metadata, utilityType, applicationType = "new_service") {
  const meta =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? /** @type {Record<string, unknown>} */ (metadata)
      : {};
  const block = meta[ACTIVE_APPLICATION_TEMPLATE_META_KEY];
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return null;
  }
  const record = /** @type {Record<string, unknown>} */ (block);
  const key = buildTemplateStorageKey(utilityType, applicationType);
  const entryRaw =
    record[key] && typeof record[key] === "object" && !Array.isArray(record[key])
      ? record[key]
      : record.manifest && typeof record.manifest === "object"
        ? record
        : null;
  if (!entryRaw || typeof entryRaw !== "object" || Array.isArray(entryRaw)) {
    return null;
  }
  const entry = /** @type {Record<string, unknown>} */ (entryRaw);
  const validated = validateApplicationTemplateManifest(entry.manifest ?? entry);
  if (!validated.ok) {
    return null;
  }
  return {
    manifest: validated.manifest,
    uploaded_at: entry.uploaded_at != null ? String(entry.uploaded_at) : null,
    uploaded_by_user_id:
      entry.uploaded_by_user_id != null ? String(entry.uploaded_by_user_id) : null,
    stored_version: entry.stored_version != null ? String(entry.stored_version) : null,
  };
}

/**
 * Resolve the application template for a provider/workflow.
 * Priority: built-in provider-specific filesystem → coordination-scoped activation (when metadata
 * provided) → global manual provider store (only without coordination context) → missing.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function resolveApplicationTemplateManifest(supabase, params) {
  const providerSlug = normalizeProviderSlug(params.providerSlug);
  const utilityType = normalizeUtilityType(params.utilityType);
  const applicationType = String(params.applicationType ?? "new_service").trim().toLowerCase();
  const checklistMode = String(params.checklistMode ?? "").trim().toLowerCase();
  const providerId = params.providerId != null ? String(params.providerId).trim() : "";
  const coordinationMetadata =
    params.coordinationMetadata &&
    typeof params.coordinationMetadata === "object" &&
    !Array.isArray(params.coordinationMetadata)
      ? /** @type {Record<string, unknown>} */ (params.coordinationMetadata)
      : null;
  const hasCoordinationContext = coordinationMetadata !== null;

  const builtin = loadProviderSpecificFilesystemTemplate(providerSlug, utilityType, {
    checklistMode,
  });
  if (builtin) {
    return buildResolutionResult({
      template: builtin,
      source:
        String(builtin.checklist_mode ?? "") === SYNTHETIC_TEST_CHECKLIST_MODE
          ? "builtin_synthetic"
          : "builtin",
      providerSlug,
      utilityType,
      applicationType,
    });
  }

  if (hasCoordinationContext) {
    const coordinationManual = readCoordinationActiveTemplate(
      coordinationMetadata,
      utilityType,
      applicationType,
    );
    if (coordinationManual) {
      const manifest = {
        ...coordinationManual.manifest,
        provider_slug: normalizeProviderSlug(
          String(coordinationManual.manifest.provider_slug ?? providerSlug),
        ),
        utility_type: utilityType,
        application_type: applicationType,
        source: "coordination_manual",
      };
      return buildResolutionResult({
        template: manifest,
        source: "coordination_manual",
        providerSlug,
        utilityType,
        applicationType,
        extra: {
          uploaded_at: coordinationManual.uploaded_at,
          uploaded_by_user_id: coordinationManual.uploaded_by_user_id,
          version:
            coordinationManual.stored_version || String(manifest.version ?? ""),
        },
      });
    }
    return buildResolutionResult({
      template: null,
      source: "missing",
      providerSlug,
      utilityType,
      applicationType,
      extra: {
        coordination_scoped: true,
        global_template_ignored: Boolean(providerId),
      },
    });
  }

  if (providerId) {
    const manual = await getStoredProviderApplicationTemplate(supabase, {
      providerId,
      utilityType,
      applicationType,
    });
    if (manual) {
      const manifest = {
        ...manual.manifest,
        provider_slug: normalizeProviderSlug(String(manual.manifest.provider_slug ?? providerSlug)),
        utility_type: utilityType,
        application_type: applicationType,
        source: "manual_upload",
      };
      return buildResolutionResult({
        template: manifest,
        source: "manual_upload",
        providerSlug,
        utilityType,
        applicationType,
        extra: {
          uploaded_at: manual.uploaded_at,
          uploaded_by_user_id: manual.uploaded_by_user_id,
          version: manual.stored_version || String(manifest.version ?? ""),
        },
      });
    }
  }

  return buildResolutionResult({
    template: null,
    source: "missing",
    providerSlug,
    utilityType,
    applicationType,
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function saveProviderApplicationTemplate(supabase, params) {
  const providerId = String(params.providerId || "").trim();
  const userId = String(params.userId || "").trim();
  const utilityType = normalizeUtilityType(params.utilityType);
  const applicationType = String(params.applicationType ?? "new_service").trim().toLowerCase();
  const validated = validateApplicationTemplateManifest(params.manifest);
  if (!validated.ok) {
    const err = new Error(validated.message);
    err.statusCode = 400;
    err.code = "INVALID_TEMPLATE_MANIFEST";
    throw err;
  }

  const loaded = await loadProviderTemplateStore(supabase, providerId);
  const key = buildTemplateStorageKey(utilityType, applicationType);
  const manifest = {
    ...validated.manifest,
    provider_slug: normalizeProviderSlug(
      String(validated.manifest.provider_slug ?? loaded.providerSlug),
    ),
    utility_type: utilityType,
    application_type: applicationType,
    source: "manual_upload",
  };
  const storedVersion = String(manifest.version ?? `manual-${Date.now()}`);
  const uploadedAt = new Date().toISOString();

  const nextStore = {
    ...loaded.store,
    [key]: {
      manifest,
      stored_version: storedVersion,
      uploaded_at: uploadedAt,
      uploaded_by_user_id: userId || null,
    },
  };

  const { data, error } = await supabase
    .from("utility_providers")
    .update({ uci_application_templates: nextStore })
    .eq("id", providerId)
    .select("id, slug, uci_application_templates")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to save application template"), {
      cause: error,
      statusCode: 500,
      code: "TEMPLATE_SAVE_FAILED",
    });
  }

  const resolution = buildResolutionResult({
    template: manifest,
    source: "manual_upload",
    providerSlug: loaded.providerSlug,
    utilityType,
    applicationType,
    extra: {
      uploaded_at: uploadedAt,
      uploaded_by_user_id: userId || null,
      version: storedVersion,
    },
  });

  return {
    provider: data,
    manifest,
    resolution: resolution.resolution,
  };
}

/**
 * Activate a manual application template for a single coordination run (not global provider library).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function saveCoordinationApplicationTemplate(supabase, params) {
  const coordinationId = String(params.coordinationId || "").trim();
  const record = params.record;
  const userId = String(params.userId || "").trim();
  const utilityType = normalizeUtilityType(params.utilityType ?? record?.utility_type);
  const applicationType = String(params.applicationType ?? "new_service").trim().toLowerCase();
  const validated = validateApplicationTemplateManifest(params.manifest);
  if (!validated.ok) {
    const err = new Error(validated.message);
    err.statusCode = 400;
    err.code = "INVALID_TEMPLATE_MANIFEST";
    throw err;
  }

  const embedded = record?.utility_providers;
  const providerSlugFromJoin = Array.isArray(embedded)
    ? embedded[0] && typeof embedded[0] === "object"
      ? normalizeProviderSlug(/** @type {{ slug?: unknown }} */ (embedded[0]).slug)
      : ""
    : embedded && typeof embedded === "object"
      ? normalizeProviderSlug(/** @type {{ slug?: unknown }} */ (embedded).slug)
      : "";

  const metadata =
    record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? /** @type {Record<string, unknown>} */ (record.metadata)
      : {};
  const mappingRaw = metadata.uci_provider_mapping;
  const mapping =
    mappingRaw && typeof mappingRaw === "object" && !Array.isArray(mappingRaw)
      ? /** @type {Record<string, unknown>} */ (mappingRaw)
      : null;
  const providerSlug = providerSlugFromJoin || normalizeProviderSlug(mapping?.provider_slug);
  const manifestProviderSlug = normalizeProviderSlug(
    String(validated.manifest.provider_slug ?? providerSlug),
  );

  if (providerSlug && manifestProviderSlug && providerSlug !== manifestProviderSlug) {
    const err = new Error(
      `Template provider_slug "${manifestProviderSlug}" does not match coordination provider "${providerSlug}"`,
    );
    err.statusCode = 409;
    err.code = "TEMPLATE_PROVIDER_MISMATCH";
    throw err;
  }

  const manifest = {
    ...validated.manifest,
    provider_slug: manifestProviderSlug || providerSlug,
    utility_type: utilityType,
    application_type: applicationType,
    source: "coordination_manual",
  };
  const storedVersion = String(manifest.version ?? `manual-${Date.now()}`);
  const uploadedAt = new Date().toISOString();
  const key = buildTemplateStorageKey(utilityType, applicationType);

  const existingBlock =
    metadata[ACTIVE_APPLICATION_TEMPLATE_META_KEY] &&
    typeof metadata[ACTIVE_APPLICATION_TEMPLATE_META_KEY] === "object" &&
    !Array.isArray(metadata[ACTIVE_APPLICATION_TEMPLATE_META_KEY])
      ? /** @type {Record<string, unknown>} */ (metadata[ACTIVE_APPLICATION_TEMPLATE_META_KEY])
      : {};

  const nextMeta = {
    ...metadata,
    [ACTIVE_APPLICATION_TEMPLATE_META_KEY]: {
      ...existingBlock,
      [key]: {
        manifest,
        stored_version: storedVersion,
        uploaded_at: uploadedAt,
        uploaded_by_user_id: userId || null,
      },
    },
  };

  const { data, error } = await supabase
    .from("coordination_records")
    .update({ metadata: nextMeta, updated_at: uploadedAt })
    .eq("id", coordinationId)
    .select("id, metadata, utility_type, utility_provider_id")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to save coordination application template"), {
      cause: error,
      statusCode: 500,
      code: "TEMPLATE_SAVE_FAILED",
    });
  }

  const resolution = buildResolutionResult({
    template: manifest,
    source: "coordination_manual",
    providerSlug: manifestProviderSlug || providerSlug,
    utilityType,
    applicationType,
    extra: {
      uploaded_at: uploadedAt,
      uploaded_by_user_id: userId || null,
      version: storedVersion,
    },
  });

  return {
    coordination: data,
    manifest,
    resolution: resolution.resolution,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function getCoordinationApplicationTemplateStatus(supabase, params) {
  const record = params.record;
  const providerId = String(record.utility_provider_id ?? "").trim();
  const utilityType = normalizeUtilityType(record.utility_type);
  const applicationType = String(params.applicationType ?? "new_service").trim().toLowerCase();
  const checklistMode = String(params.checklistMode ?? "").trim().toLowerCase();

  const embedded = record.utility_providers;
  const providerSlug = Array.isArray(embedded)
    ? embedded[0] && typeof embedded[0] === "object"
      ? normalizeProviderSlug(/** @type {{ slug?: unknown }} */ (embedded[0]).slug)
      : ""
    : embedded && typeof embedded === "object"
      ? normalizeProviderSlug(/** @type {{ slug?: unknown }} */ (embedded).slug)
      : "";

  let slug = providerSlug;
  if (!slug) {
    const metadata =
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? /** @type {Record<string, unknown>} */ (record.metadata)
        : {};
    const mappingRaw = metadata.uci_provider_mapping;
    const mapping =
      mappingRaw && typeof mappingRaw === "object" && !Array.isArray(mappingRaw)
        ? /** @type {Record<string, unknown>} */ (mappingRaw)
        : null;
    slug = normalizeProviderSlug(mapping?.provider_slug);
  }

  const resolved = await resolveApplicationTemplateManifest(supabase, {
    providerSlug: slug,
    providerId,
    utilityType,
    applicationType,
    checklistMode,
    coordinationMetadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? /** @type {Record<string, unknown>} */ (record.metadata)
        : {},
  });

  return {
    provider_id: providerId || null,
    provider_slug: slug || null,
    utility_type: utilityType,
    application_type: applicationType,
    ...resolved.resolution,
    template_available: Boolean(resolved.template),
  };
}

module.exports = {
  ACTIVE_APPLICATION_TEMPLATE_META_KEY,
  buildTemplateStorageKey,
  validateApplicationTemplateManifest,
  loadProviderSpecificFilesystemTemplate,
  loadGenericFilesystemTemplate,
  getStoredProviderApplicationTemplate,
  readCoordinationActiveTemplate,
  resolveApplicationTemplateManifest,
  saveProviderApplicationTemplate,
  saveCoordinationApplicationTemplate,
  getCoordinationApplicationTemplateStatus,
};
