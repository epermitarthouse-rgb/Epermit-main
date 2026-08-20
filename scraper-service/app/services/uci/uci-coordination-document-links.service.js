"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");

const LINKS_TABLE = "uci_coordination_document_links";
const PROJECT_DOCUMENTS_SELECT =
  "id, project_id, document_type, file_name, file_path, file_type, description, created_at, updated_at";

const ELECTRIC_CROSS_UTILITY_PATTERNS = [
  { type: "class_of_service", test: /\b(CLASS[\s-]*OF[\s-]*SERVICE|\bCOS\b|C\.O\.S\.)\b/i },
  { type: "one_line_diagram", test: /\b(ONE[\s-]*LINE|SINGLE[\s-]*LINE)\b/i },
  { type: "panel_schedule", test: /\bPANEL[\s-]*SCHEDULES?\b/i },
  { type: "electric_load_letter", test: /\b(ELECTRIC(?:AL)?[\s-]*LOAD[\s-]*LETTER|LOAD[\s-]*LETTER)\b/i },
  { type: "electric_load_calc", test: /\b(ELECTRIC(?:AL)?[\s-]*LOAD[\s-]*CALC|LOAD[\s-]*CALC(?:ULATION)?)\b/i },
  { type: "electrical_specification", test: /\bELECTRICAL[\s-]*SPEC(?:IFICATION)?S?\b/i },
  { type: "electrical_plan", test: /\b(ELECTRICAL|POWER)[\s-]*PLAN\b/i },
  { type: "comcheck", test: /\bCOM[\s-]*CHECK\b/i },
];

const UTILITY_CLASSIFIERS = [
  {
    utilityType: "gas",
    confidence: "high",
    tests: [
      /\bGAS[\s-]*(LOAD|SERVICE|METER|LETTER|CALC)/i,
      /\b(BTU(?:\/H)?|BTUH|CFH|CFM[\s-]*GAS)\b/i,
      /\b(WASHINGTON[\s-]*GAS|\bWGL\b|COLUMBIA[\s-]*GAS)\b/i,
    ],
  },
  {
    utilityType: "water",
    confidence: "high",
    tests: [/\b(WATER[\s-]*SERVICE|DFU|GPM|PLUMBING[\s-]*LOAD)\b/i],
  },
  {
    utilityType: "sewer",
    confidence: "high",
    tests: [/\b(SEWER|WASTEWATER)[\s-]*(SERVICE|LOAD|LETTER)?\b/i],
  },
  {
    utilityType: "telecom",
    confidence: "high",
    tests: [/\b(TELECOM|FIBER[\s-]*DROP|DEMARC)\b/i],
  },
  {
    utilityType: "electric",
    confidence: "high",
    tests: [
      ...ELECTRIC_CROSS_UTILITY_PATTERNS.map((rule) => rule.test),
      /\b(PEPCO|DOMINION[\s-]*ENERGY|BG[&E]|BGE)\b/i,
      /\b(KW|KVA|AMPERAGE|VOLTAGE)\b/i,
    ],
  },
];

const PROJECT_LEVEL_PATTERNS = [
  { type: "site_plan", test: /\bSITE[\s-]*PLAN\b/i },
  { type: "civil_plan", test: /\bCIVIL[\s-]*PLAN\b/i },
  { type: "letter_of_authorization", test: /\b(LETTER[\s-]*OF[\s-]*AUTHORIZATION|\bLOA\b)\b/i },
];

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUtilityType(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {unknown} text
 * @returns {string}
 */
function normalizeHaystack(text) {
  return String(text ?? "")
    .replace(/[_]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string | null}
 */
function resolveProviderSlug(record) {
  const provider = record.utility_providers;
  if (provider && typeof provider === "object" && !Array.isArray(provider) && provider.slug) {
    return String(provider.slug);
  }
  const mapping = record.metadata?.uci_provider_mapping;
  if (mapping && typeof mapping === "object" && mapping.provider_slug) {
    return String(mapping.provider_slug);
  }
  return record.utility_provider_id != null ? null : null;
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string | null}
 */
function resolveProviderName(record) {
  const provider = record.utility_providers;
  if (provider && typeof provider === "object" && !Array.isArray(provider)) {
    return String(provider.display_name || provider.name || provider.slug || "") || null;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {string}
 */
function documentHaystack(doc) {
  return normalizeHaystack(
    [
      doc.file_name,
      doc.document_type,
      doc.description,
      doc.portal_document_type,
      doc.pepco_document_type,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {{
 *   utilityType: string,
 *   confidence: "high" | "medium" | "low",
 *   documentType: string,
 *   electricCrossUtilityType: string | null,
 *   projectLevel: boolean,
 * }}
 */
function classifyDocumentUtilityScope(doc) {
  const haystack = documentHaystack(doc);
  let electricCrossUtilityType = null;
  for (const rule of ELECTRIC_CROSS_UTILITY_PATTERNS) {
    if (rule.test.test(haystack)) {
      electricCrossUtilityType = rule.type;
      break;
    }
  }

  let projectLevel = false;
  let projectLevelType = null;
  for (const rule of PROJECT_LEVEL_PATTERNS) {
    if (rule.test.test(haystack)) {
      projectLevel = true;
      projectLevelType = rule.type;
      break;
    }
  }

  for (const classifier of UTILITY_CLASSIFIERS) {
    if (classifier.tests.some((test) => test.test(haystack))) {
      return {
        utilityType: classifier.utilityType,
        confidence: classifier.confidence,
        documentType: electricCrossUtilityType || projectLevelType || classifier.utilityType,
        electricCrossUtilityType,
        projectLevel,
      };
    }
  }

  if (projectLevel) {
    return {
      utilityType: "project_level",
      confidence: "high",
      documentType: projectLevelType || "project_level",
      electricCrossUtilityType,
      projectLevel: true,
    };
  }

  return {
    utilityType: "unknown",
    confidence: "low",
    documentType: String(doc.document_type || "other"),
    electricCrossUtilityType,
    projectLevel: false,
  };
}

/**
 * Electric COS / one-line / panel / load letter must never auto-join a non-electric analysis.
 *
 * @param {ReturnType<typeof classifyDocumentUtilityScope>} classification
 * @param {string} recordUtilityType
 */
function isBlockedCrossUtilityAutoInclude(classification, recordUtilityType) {
  const recordType = normalizeUtilityType(recordUtilityType);
  if (recordType === "electric") return false;
  if (classification.utilityType !== "electric") return false;
  return Boolean(classification.electricCrossUtilityType);
}

/**
 * @param {Record<string, unknown>} doc
 * @param {string} coordinationRecordId
 */
function isUploadedToCoordination(doc, coordinationRecordId) {
  const description = String(doc.description ?? "");
  const id = String(coordinationRecordId || "").trim();
  if (!id) return false;
  return description.includes(`coordination ${id}`);
}

/**
 * @param {ReturnType<typeof classifyDocumentUtilityScope>} classification
 * @param {string} recordUtilityType
 * @returns {"same_utility" | "cross_utility" | "project_level" | "unknown"}
 */
function resolveRelevance(classification, recordUtilityType) {
  if (classification.projectLevel && classification.utilityType === "project_level") {
    return "project_level";
  }
  const recordType = normalizeUtilityType(recordUtilityType);
  if (!classification.utilityType || classification.utilityType === "unknown") return "unknown";
  if (classification.utilityType === recordType) return "same_utility";
  return "cross_utility";
}

/**
 * High-confidence auto-include: same utility, or uploaded/inbound to this record
 * and not a blocked electric-specific document on a non-electric record.
 *
 * @param {object} params
 */
function shouldAutoIncludeDocument(params) {
  const { classification, recordUtilityType, uploadedToRecord, inboundMatched } = params;
  if (isBlockedCrossUtilityAutoInclude(classification, recordUtilityType)) return false;
  if (uploadedToRecord || inboundMatched) return true;
  const recordType = normalizeUtilityType(recordUtilityType);
  return (
    classification.confidence === "high" &&
    classification.utilityType === recordType &&
    !classification.projectLevel
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function listLinkRows(supabase, params) {
  const { coordinationRecordId, projectId } = params;
  try {
    const { data, error } = await supabase
      .from(LINKS_TABLE)
      .select("*")
      .eq("coordination_record_id", coordinationRecordId)
      .eq("project_id", projectId);
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
function activeLinks(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !row.unlinked_at);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} row
 */
async function insertLinkRow(supabase, row) {
  const query = supabase.from(LINKS_TABLE);
  if (typeof query.insert !== "function") {
    throw new Error("insert_unavailable");
  }
  const inserted = query.insert(row);
  if (inserted && typeof inserted.select === "function" && typeof inserted.single === "function") {
    const { data, error } = await inserted.select("*").single();
    if (error) throw error;
    return data || row;
  }
  const { data, error } = await inserted;
  if (error) throw error;
  if (Array.isArray(data) && data[0]) return data[0];
  return row;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function updateLinkRow(supabase, params) {
  const { coordinationRecordId, projectDocumentId, patch } = params;
  const query = supabase.from(LINKS_TABLE);
  if (typeof query.update !== "function") {
    throw new Error("update_unavailable");
  }
  const { data, error } = await query
    .update(patch)
    .eq("coordination_record_id", coordinationRecordId)
    .eq("project_document_id", projectDocumentId);
  if (error) throw error;
  return data;
}

/**
 * @param {Record<string, unknown>} record
 * @param {Record<string, unknown>} doc
 * @param {object} opts
 */
function buildLinkRow(record, doc, opts) {
  const classification = opts.classification || classifyDocumentUtilityScope(doc);
  const recordUtilityType = normalizeUtilityType(record.utility_type);
  const relevance = resolveRelevance(classification, recordUtilityType);
  const sourceUtilityType =
    classification.utilityType === "project_level" || classification.utilityType === "unknown"
      ? recordUtilityType || null
      : classification.utilityType;
  const now = new Date().toISOString();
  return {
    project_id: String(record.project_id),
    tenant_id: record.tenant_id != null ? String(record.tenant_id) : null,
    coordination_record_id: String(record.id),
    project_document_id: String(doc.id),
    source_utility_type: opts.sourceUtilityType || sourceUtilityType,
    source_provider_id:
      opts.sourceProviderId ||
      (relevance === "same_utility" && record.utility_provider_id
        ? String(record.utility_provider_id)
        : null),
    source_provider_slug: opts.sourceProviderSlug || (relevance === "same_utility" ? resolveProviderSlug(record) : null),
    source_provider_name: opts.sourceProviderName || (relevance === "same_utility" ? resolveProviderName(record) : null),
    link_role: opts.linkRole || "load_analysis_source",
    relevance,
    included_in_analysis: opts.includedInAnalysis !== false,
    link_origin: opts.linkOrigin || "manual",
    linked_by: opts.userId || null,
    linked_at: now,
    unlinked_at: null,
    unlinked_by: null,
    unlink_reason: null,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function ensureAutomaticDocumentLinks(supabase, params) {
  const { record, projectDocuments, userId, inboundDocumentIds = [] } = params;
  const inbound = new Set((inboundDocumentIds || []).map(String));
  const existing = await listLinkRows(supabase, {
    coordinationRecordId: String(record.id),
    projectId: String(record.project_id),
  });
  const byDocumentId = new Map(existing.map((row) => [String(row.project_document_id), row]));
  const created = [];
  const recordUtilityType = normalizeUtilityType(record.utility_type);

  for (const doc of projectDocuments || []) {
    if (!doc?.id) continue;
    const existingRow = byDocumentId.get(String(doc.id));
    if (existingRow && !existingRow.unlinked_at) continue;
    if (existingRow?.unlinked_at) continue;

    const classification = classifyDocumentUtilityScope(doc);
    const uploadedToRecord = isUploadedToCoordination(doc, record.id);
    const inboundMatched = inbound.has(String(doc.id));
    const autoInclude = shouldAutoIncludeDocument({
      classification,
      recordUtilityType,
      uploadedToRecord,
      inboundMatched,
    });
    const shouldLink = autoInclude || uploadedToRecord || inboundMatched;
    if (!shouldLink) continue;

    const row = buildLinkRow(record, doc, {
      classification,
      userId,
      linkOrigin: inboundMatched ? "inbound" : uploadedToRecord ? "manual" : "automatic",
      includedInAnalysis: autoInclude,
    });
    try {
      const saved = await insertLinkRow(supabase, row);
      const persisted = saved && typeof saved === "object" ? { ...row, ...saved } : row;
      existing.push(persisted);
      byDocumentId.set(String(doc.id), persisted);
      created.push(persisted);
    } catch {
      existing.push(row);
      byDocumentId.set(String(doc.id), row);
      created.push(row);
    }
  }

  return { links: existing, created };
}

/**
 * @param {Array<Record<string, unknown>>} links
 * @returns {Set<string>}
 */
function includedProjectDocumentIds(links) {
  return new Set(
    activeLinks(links)
      .filter((row) => row.included_in_analysis !== false)
      .map((row) => String(row.project_document_id)),
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function loadProjectDocuments(supabase, projectId) {
  const { data, error } = await supabase
    .from("project_documents")
    .select(PROJECT_DOCUMENTS_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load project documents"), {
      cause: error,
      statusCode: 500,
      code: "DOCUMENTS_FETCH_FAILED",
    });
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Resolve the document set that Load Profile analysis/extraction/import may use.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function resolveScopedProjectDocuments(supabase, params) {
  const { record, userId, inboundDocumentIds } = params;
  const projectDocuments = Array.isArray(params.projectDocuments)
    ? params.projectDocuments
    : await loadProjectDocuments(supabase, String(record.project_id));
  const { links } = await ensureAutomaticDocumentLinks(supabase, {
    record,
    projectDocuments,
    userId,
    inboundDocumentIds,
  });
  const includedIds = includedProjectDocumentIds(links);
  const scopedDocuments = projectDocuments.filter((doc) => includedIds.has(String(doc.id)));
  return {
    projectDocuments,
    scopedDocuments,
    links,
    includedIds,
  };
}

/**
 * @param {Record<string, unknown>} record
 * @param {Record<string, unknown>} doc
 * @param {Record<string, unknown> | null} link
 */
function formatProvenanceLabel(record, doc, link) {
  const classification = classifyDocumentUtilityScope(doc);
  const relevance = link?.relevance || resolveRelevance(classification, record.utility_type);
  const recordType = normalizeUtilityType(record.utility_type);
  const sourceType = String(link?.source_utility_type || classification.utilityType || "unknown");
  const providerName = String(
    link?.source_provider_name ||
      (relevance === "same_utility" ? resolveProviderName(record) || "" : "") ||
      link?.source_provider_slug ||
      "",
  ).trim();
  const utilityLabel =
    sourceType === "project_level"
      ? "Project-level"
      : sourceType.charAt(0).toUpperCase() + sourceType.slice(1);

  if (relevance === "project_level" || sourceType === "project_level") {
    return providerName ? `Project-level · ${providerName}` : "Project-level";
  }
  if (relevance === "same_utility" && sourceType === recordType) {
    const current = resolveProviderName(record);
    return current ? `${utilityLabel} · current coordination` : `${utilityLabel} · current coordination`;
  }
  return providerName ? `${utilityLabel} · ${providerName}` : utilityLabel;
}

/**
 * @param {unknown} status
 */
function processingStatusLabel(status) {
  switch (String(status || "pending")) {
    case "complete":
      return "Processed";
    case "partial":
      return "Partial";
    case "failed":
      return "Failed";
    case "processing":
      return "Processing";
    case "unsupported":
      return "Unsupported";
    default:
      return "Pending";
  }
}

/**
 * @param {Array<Record<string, unknown>>} manifestDocuments
 * @param {Record<string, unknown>} doc
 */
function findManifestEntry(manifestDocuments, doc) {
  const id = String(doc.id);
  const name = String(doc.file_name || "").toLowerCase();
  return (
    (manifestDocuments || []).find(
      (entry) =>
        String(entry.source_document_id || "") === id ||
        String(entry.project_document_id || "") === id ||
        String(entry.original_filename || "").toLowerCase() === name,
    ) || null
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function getLoadProfileDocumentScope(supabase, params) {
  const { coordinationRecordId, userId, externalApplicationId } = params;
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const scoped = await resolveScopedProjectDocuments(supabase, { record, userId });
  const extAppId = String(externalApplicationId || "").trim();
  const { getDocumentProcessingState } = require("./uci-document-processing.service.js");
  const processingState = getDocumentProcessingState(record.metadata, extAppId);
  const manifestDocuments = Array.isArray(processingState?.documents) ? processingState.documents : [];
  const linksByDoc = new Map(scoped.links.map((row) => [String(row.project_document_id), row]));
  const recordUtilityType = normalizeUtilityType(record.utility_type);
  const providerName = resolveProviderName(record);
  const providerSlug = resolveProviderSlug(record);

  const toUsedRow = (doc, link) => {
    const classification = classifyDocumentUtilityScope(doc);
    const manifest = findManifestEntry(manifestDocuments, doc);
    return {
      project_document_id: String(doc.id),
      file_name: String(doc.file_name || "unknown"),
      document_type: String(doc.document_type || classification.documentType || "other"),
      classified_document_type: classification.documentType,
      source_utility_type: link?.source_utility_type || classification.utilityType,
      source_provider_slug: link?.source_provider_slug || null,
      source_provider_name: link?.source_provider_name || null,
      provenance_label: formatProvenanceLabel(record, doc, link),
      relevance: link?.relevance || resolveRelevance(classification, recordUtilityType),
      included_in_analysis: link?.included_in_analysis !== false,
      link_origin: link?.link_origin || "automatic",
      link_role: link?.link_role || "load_analysis_source",
      linked_by: link?.linked_by || null,
      linked_at: link?.linked_at || null,
      processing_status: manifest?.processing_status || "pending",
      processing_status_label: processingStatusLabel(manifest?.processing_status),
      findings_count: Number(manifest?.findings_count || 0),
      linked: Boolean(link && !link.unlinked_at),
      unlinked_at: link?.unlinked_at || null,
    };
  };

  const used = [];
  const other = [];
  for (const doc of scoped.projectDocuments) {
    const link = linksByDoc.get(String(doc.id));
    const active = link && !link.unlinked_at;
    if (active) used.push(toUsedRow(doc, link));
    else other.push(toUsedRow(doc, link || null));
  }

  used.sort((a, b) => String(b.linked_at || "").localeCompare(String(a.linked_at || "")));

  const usedProjectIds = new Set(used.map((row) => String(row.project_document_id)));
  for (const manifest of manifestDocuments) {
    const sourceType = String(manifest.source_type || "");
    if (sourceType !== "pepco_portal_document") continue;
    const projectIdFromManifest = String(manifest.source_document_id || manifest.project_document_id || "");
    if (projectIdFromManifest && usedProjectIds.has(projectIdFromManifest)) continue;
    used.push({
      project_document_id: projectIdFromManifest || String(manifest.document_id || ""),
      file_name: String(manifest.original_filename || "unknown"),
      document_type: String(manifest.portal_document_type || "utility_application"),
      classified_document_type: String(manifest.document_roles?.[0] || "utility_application"),
      source_utility_type: recordUtilityType,
      source_provider_slug: providerSlug,
      source_provider_name: providerName,
      provenance_label: providerName
        ? `${recordUtilityType.charAt(0).toUpperCase() + recordUtilityType.slice(1)} · current coordination`
        : "Current coordination",
      relevance: "same_utility",
      included_in_analysis: true,
      link_origin: "automatic",
      link_role: "load_analysis_source",
      linked_by: null,
      linked_at: manifest.processed_at || null,
      processing_status: manifest.processing_status || "pending",
      processing_status_label: processingStatusLabel(manifest.processing_status),
      findings_count: Number(manifest.findings_count || 0),
      linked: true,
      unlinked_at: null,
      portal_document: true,
    });
  }

  const selectedCount = used.filter((row) => row.included_in_analysis).length;
  const utilityLabel = recordUtilityType || "utility";

  return {
    coordination_record_id: String(record.id),
    project_id: String(record.project_id),
    utility_type: recordUtilityType,
    provider_name: providerName,
    provider_slug: providerSlug,
    selected_for_analysis_count: selectedCount,
    selected_for_analysis_label: `${selectedCount} document${selectedCount === 1 ? "" : "s"} selected for ${utilityLabel} analysis`,
    used,
    other_project_documents: other,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function markUnlinkedDocumentFindingsStale(supabase, params) {
  const { record, projectDocumentId, userId } = params;
  const projectId = String(record.project_id);
  const documentId = String(projectDocumentId);
  const now = new Date().toISOString();

  const { persistDocumentProcessingState } = require("./uci-document-processing.service.js");
  const { findAgentDraftApplication, reconcileLoadProfileReadiness } = require("./uci-load-profile.service.js");
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? { ...record.metadata }
      : {};
  const processingRoot =
    metadata.uci_document_processing &&
    typeof metadata.uci_document_processing === "object" &&
    !Array.isArray(metadata.uci_document_processing)
      ? metadata.uci_document_processing
      : null;
  const applications =
    processingRoot?.applications &&
    typeof processingRoot.applications === "object" &&
    !Array.isArray(processingRoot.applications)
      ? processingRoot.applications
      : null;

  if (applications) {
    for (const [scopeKey, state] of Object.entries(applications)) {
      if (!state || typeof state !== "object" || Array.isArray(state)) continue;
      const docs = Array.isArray(state.documents) ? state.documents : [];
      const matchingDocIds = new Set(
        docs
          .filter(
            (doc) =>
              String(doc.source_document_id || doc.project_document_id || "") === documentId,
          )
          .map((doc) => String(doc.document_id || "")),
      );
      const findings = Array.isArray(state.findings) ? state.findings : [];
      let changed = false;
      for (const finding of findings) {
        const findingDocId = String(finding.document_id || finding.source_document_id || "");
        const findingProjectId = String(finding.project_document_id || finding.source_document_id || "");
        if (
          matchingDocIds.has(findingDocId) ||
          findingProjectId === documentId ||
          String(finding.source_document_id || "") === documentId
        ) {
          if (finding.verification_status !== "stale") {
            finding.verification_status = "stale";
            finding.stale_reason = "unlinked_from_coordination";
            finding.stale_at = now;
            changed = true;
          }
        }
      }
      if (changed) {
        await persistDocumentProcessingState(supabase, {
          coordinationRecordId: String(record.id),
          projectId,
          externalApplicationId: scopeKey === "__manual__" ? "" : scopeKey,
          state,
        });
      }
    }
  }

  const draft = await findAgentDraftApplication(supabase, String(record.id), projectId);
  if (!draft?.load_summary || typeof draft.load_summary !== "object") return { stale_candidates: 0 };

  const summary = { ...draft.load_summary };
  const candidates = Array.isArray(summary.candidate_values) ? summary.candidate_values : [];
  let staleCount = 0;
  for (const candidate of candidates) {
    if (String(candidate.source_document_id || "") !== documentId) continue;
    if (candidate.status === "stale" || candidate.status === "rejected") continue;
    candidate.status = "stale";
    candidate.stale_reason = "unlinked_from_coordination";
    candidate.requires_human_review = true;
    candidate.can_satisfy_package = false;
    staleCount += 1;
  }
  if (staleCount === 0) return { stale_candidates: 0 };

  const nextSummary = reconcileLoadProfileReadiness({
    ...summary,
    candidate_values: candidates,
  });
  await supabase
    .from("coordination_applications")
    .update({ load_summary: nextSummary, updated_at: now })
    .eq("id", draft.id);
  return { stale_candidates: staleCount, updated_by: userId || null };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function linkProjectDocumentsToCoordination(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    projectDocumentIds,
    includedInAnalysis = true,
    linkOrigin = "manual",
    inbound = false,
  } = params;
  const ids = [...new Set((projectDocumentIds || []).map(String).filter(Boolean))];
  if (ids.length === 0) {
    const err = new Error("Select at least one project document");
    err.statusCode = 400;
    err.code = "DOCUMENT_IDS_REQUIRED";
    throw err;
  }

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectDocuments = await loadProjectDocuments(supabase, String(record.project_id));
  const byId = new Map(projectDocuments.map((doc) => [String(doc.id), doc]));
  const existing = await listLinkRows(supabase, {
    coordinationRecordId: String(record.id),
    projectId: String(record.project_id),
  });
  const byDoc = new Map(existing.map((row) => [String(row.project_document_id), row]));
  const linked = [];

  for (const id of ids) {
    const doc = byId.get(id);
    if (!doc) {
      const err = new Error(`Project document not found: ${id}`);
      err.statusCode = 404;
      err.code = "DOCUMENT_NOT_FOUND";
      throw err;
    }
    const classification = classifyDocumentUtilityScope(doc);
    const existingRow = byDoc.get(id);
    if (existingRow && !existingRow.unlinked_at) {
      if (existingRow.included_in_analysis !== includedInAnalysis) {
        const patch = {
          included_in_analysis: includedInAnalysis,
          link_origin: existingRow.link_origin || linkOrigin,
        };
        try {
          await updateLinkRow(supabase, {
            coordinationRecordId: String(record.id),
            projectDocumentId: id,
            patch,
          });
        } catch {
          Object.assign(existingRow, patch);
        }
        Object.assign(existingRow, patch);
      }
      linked.push(existingRow);
      continue;
    }

    if (existingRow?.unlinked_at) {
      const patch = {
        unlinked_at: null,
        unlinked_by: null,
        unlink_reason: null,
        included_in_analysis: includedInAnalysis,
        link_origin: linkOrigin,
        linked_by: userId || existingRow.linked_by,
        linked_at: new Date().toISOString(),
        relevance: resolveRelevance(classification, record.utility_type),
      };
      try {
        await updateLinkRow(supabase, {
          coordinationRecordId: String(record.id),
          projectDocumentId: id,
          patch,
        });
      } catch {
        Object.assign(existingRow, patch);
      }
      Object.assign(existingRow, patch);
      linked.push(existingRow);
      continue;
    }

    const row = buildLinkRow(record, doc, {
      classification,
      userId,
      linkOrigin: inbound ? "inbound" : linkOrigin,
      includedInAnalysis,
    });
    try {
      const saved = await insertLinkRow(supabase, row);
      linked.push(saved && typeof saved === "object" ? { ...row, ...saved } : row);
    } catch (err) {
      if (/duplicate|unique/i.test(String(err?.message || err?.code || ""))) {
        linked.push(row);
        continue;
      }
      linked.push(row);
    }
  }

  return getLoadProfileDocumentScope(supabase, {
    coordinationRecordId,
    userId,
    externalApplicationId: params.externalApplicationId,
  }).then((scope) => ({ ...scope, linked_document_ids: linked.map((row) => String(row.project_document_id)) }));
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function unlinkProjectDocumentFromCoordination(supabase, params) {
  const { coordinationRecordId, projectDocumentId, userId, removeFromAnalysisOnly = false } = params;
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const existing = await listLinkRows(supabase, {
    coordinationRecordId: String(record.id),
    projectId: String(record.project_id),
  });
  const row = existing.find((item) => String(item.project_document_id) === String(projectDocumentId));
  if (!row || row.unlinked_at) {
    const err = new Error("Document is not linked to this coordination record");
    err.statusCode = 404;
    err.code = "LINK_NOT_FOUND";
    throw err;
  }

  const now = new Date().toISOString();
  const patch = removeFromAnalysisOnly
    ? { included_in_analysis: false }
    : {
        included_in_analysis: false,
        unlinked_at: now,
        unlinked_by: userId || null,
        unlink_reason: "operator_unlinked",
      };
  try {
    await updateLinkRow(supabase, {
      coordinationRecordId: String(record.id),
      projectDocumentId: String(projectDocumentId),
      patch,
    });
  } catch {
    Object.assign(row, patch);
  }

  const stale = await markUnlinkedDocumentFindingsStale(supabase, {
    record,
    projectDocumentId,
    userId,
  });

  const projectDocuments = await loadProjectDocuments(supabase, String(record.project_id));
  const projectDocument = projectDocuments.find((doc) => String(doc.id) === String(projectDocumentId)) || null;

  const scope = await getLoadProfileDocumentScope(supabase, {
    coordinationRecordId,
    userId,
    externalApplicationId: params.externalApplicationId,
  });
  return {
    ...scope,
    project_document_deleted: false,
    project_document_id: String(projectDocumentId),
    project_document_present: Boolean(projectDocument),
    stale_candidates: stale.stale_candidates || 0,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function setDocumentIncludedInAnalysis(supabase, params) {
  const { coordinationRecordId, projectDocumentId, includedInAnalysis, userId } = params;
  if (includedInAnalysis === false) {
    return unlinkProjectDocumentFromCoordination(supabase, {
      ...params,
      removeFromAnalysisOnly: true,
    });
  }
  return linkProjectDocumentsToCoordination(supabase, {
    coordinationRecordId,
    userId,
    projectDocumentIds: [projectDocumentId],
    includedInAnalysis: true,
    linkOrigin: "manual",
    externalApplicationId: params.externalApplicationId,
  });
}

module.exports = {
  LINKS_TABLE,
  PROJECT_DOCUMENTS_SELECT,
  classifyDocumentUtilityScope,
  isBlockedCrossUtilityAutoInclude,
  isUploadedToCoordination,
  shouldAutoIncludeDocument,
  resolveRelevance,
  formatProvenanceLabel,
  includedProjectDocumentIds,
  listLinkRows,
  ensureAutomaticDocumentLinks,
  resolveScopedProjectDocuments,
  getLoadProfileDocumentScope,
  linkProjectDocumentsToCoordination,
  unlinkProjectDocumentFromCoordination,
  setDocumentIncludedInAnalysis,
  markUnlinkedDocumentFindingsStale,
  loadProjectDocuments,
};
