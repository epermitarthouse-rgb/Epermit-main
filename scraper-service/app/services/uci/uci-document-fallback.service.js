"use strict";

const crypto = require("crypto");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const {
  getDocumentProcessingState,
  persistDocumentProcessingState,
  candidateRecordToFinding,
  filterFindingsForUciStage,
  computeCoverageSummary,
  evaluateRunCompletion,
  safeProcessingErrorMessage,
} = require("./uci-document-processing.service.js");
const { validatePepcoStoragePathForRecord } = require("./uci-package-document-bridge.service.js");
const { downloadFromSupabaseStorage } = require("../../../shared/supabase-storage-upload.js");
const { UCI_DOCUMENTS_STORAGE_BUCKET } = require("./uci-document-storage.service.js");
const { renderPdfPageToPng } = require("./uci-pdf-page-render.service.js");
const {
  getDocumentFallbackConfig,
  isFallbackMethodAvailable,
  fallbackProviderStatus,
} = require("./uci-document-fallback-config.service.js");
const {
  createVisionPageProcessor,
  createOcrPageProcessor,
} = require("./uci-document-fallback-processors.service.js");
const {
  extractCandidatesFromPdfText,
  extractCandidatesFromTables,
  buildCandidateRecord,
} = require("./uci-load-candidate.service.js");
const {
  mergeDocumentFindingsHybrid,
  isOcrApprovalBlocked,
} = require("./uci-document-findings-merge.service.js");

/**
 * @param {Record<string, unknown>} visionFinding
 * @param {object} source
 * @param {string} documentId
 * @param {string[]} documentRoles
 */
function visionFindingToRecord(visionFinding, source, documentId, documentRoles) {
  const candidate = buildCandidateRecord({
    field_key: String(visionFinding.field_key ?? ""),
    raw_value: String(visionFinding.raw_value ?? ""),
    normalized_value: visionFinding.normalized_value ?? null,
    unit: visionFinding.unit != null ? String(visionFinding.unit) : null,
    source_type: source.source_type,
    source_document_name: source.source_document_name,
    source_document_id: source.source_document_id,
    source_storage_path: source.source_storage_path,
    source_content_hash: source.source_content_hash,
    page_number: visionFinding.page_number != null ? Number(visionFinding.page_number) : null,
    evidence_text: String(visionFinding.evidence_text ?? ""),
    extraction_method: "vision",
    confidence: visionFinding.confidence != null ? Number(visionFinding.confidence) : null,
    external_application_id: source.external_application_id,
    entity_type: visionFinding.entity_type != null ? String(visionFinding.entity_type) : "project_service",
    entity_name: visionFinding.entity_name != null ? String(visionFinding.entity_name) : null,
  });
  const finding = candidateRecordToFinding(candidate, documentId, documentRoles);
  if (visionFinding.bounding_region) finding.bounding_region = visionFinding.bounding_region;
  finding.contributing_methods = ["vision"];
  return finding;
}

/**
 * @param {Array<Record<string, unknown>>} documents
 * @param {object} filter
 */
function collectFallbackPages(documents, filter = {}) {
  const mode = String(filter.mode ?? "all");
  /** @type {Array<{ doc: Record<string, unknown>, page: Record<string, unknown> }>} */
  const pages = [];

  for (const doc of documents) {
    const pageRecords = Array.isArray(doc.page_records) ? doc.page_records : [];
    for (const page of pageRecords) {
      const status = String(page.status ?? "");
      const method = String(page.page_analysis?.recommended_method ?? "");
      const isVision = status === "vision_required" || status === "vision_failed";
      const isOcr = status === "ocr_required" || status === "ocr_failed";
      if (mode === "vision" && !isVision) continue;
      if (mode === "ocr" && !isOcr) continue;
      if (mode === "all" && !isVision && !isOcr) continue;
      if (mode === "vision" && method !== "vision" && status !== "vision_failed") continue;
      if (mode === "ocr" && method !== "ocr" && status !== "ocr_failed") continue;
      pages.push({ doc, page });
    }
  }
  return pages;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function runDocumentFallbackProcessing(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    externalApplicationId,
    mode = "all",
    documentId = null,
    pageNumbers = null,
    deps = {},
  } = params;

  const extAppId = String(externalApplicationId || "").trim();
  if (!extAppId) {
    const err = new Error("external_application_id is required");
    err.statusCode = 400;
    err.code = "EXTERNAL_APPLICATION_REQUIRED";
    throw err;
  }

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const projectId = String(record.project_id ?? "");
  const state = getDocumentProcessingState(record.metadata, extAppId);
  if (!state) {
    const err = new Error("Document processing has not been run for this application");
    err.statusCode = 400;
    err.code = "DOCUMENT_PROCESSING_REQUIRED";
    throw err;
  }

  if (String(state.external_application_id ?? "") !== extAppId) {
    const err = new Error("External application scope mismatch");
    err.statusCode = 400;
    err.code = "SCOPE_MISMATCH";
    throw err;
  }
  if (String(state.project_id ?? "") !== projectId) {
    const err = new Error("Cross-project document processing state rejected");
    err.statusCode = 400;
    err.code = "CROSS_PROJECT_REJECTED";
    throw err;
  }

  const config = deps.config || getDocumentFallbackConfig(deps.env);
  const providerStatus = fallbackProviderStatus(config);
  const visionProcessor = createVisionPageProcessor(config, deps);
  const ocrProcessor = createOcrPageProcessor(config, deps);
  const renderFn = deps.renderPdfPageToPng || renderPdfPageToPng;
  const downloadFn = deps.downloadFromSupabaseStorage || downloadFromSupabaseStorage;

  const documents = Array.isArray(state.documents) ? [...state.documents] : [];
  let findings = Array.isArray(state.findings) ? [...state.findings] : [];

  let candidates = collectFallbackPages(documents, { mode });
  if (documentId) {
    candidates = candidates.filter((c) => String(c.doc.document_id) === String(documentId));
  }
  if (Array.isArray(pageNumbers) && pageNumbers.length > 0) {
    const set = new Set(pageNumbers.map((n) => Number(n)));
    candidates = candidates.filter((c) => set.has(Number(c.page.page_number)));
  }

  const visionLimit =
    mode === "ocr" ? 0 : config.vision_max_pages_per_run;
  const ocrLimit = mode === "vision" ? 0 : config.ocr_max_pages_per_run;

  let pagesRequested = candidates.length;
  let pagesProcessed = 0;
  let pagesFailed = 0;
  let findingsCreated = 0;
  /** @type {Array<Record<string, unknown>>} */
  const failedPages = [];
  /** @type {Array<Record<string, unknown>>} */
  const usageLog = [];

  /** @type {Map<string, Buffer>} */
  const pdfCache = new Map();

  const getPdfBuffer = async (doc) => {
    const key = String(doc.document_id ?? doc.content_hash ?? "");
    if (pdfCache.has(key)) return pdfCache.get(key);
    const storagePath = String(doc.storage_path ?? "");
    const bucket = String(doc.storage_bucket ?? UCI_DOCUMENTS_STORAGE_BUCKET);
    if (!storagePath) throw new Error("Storage path missing");
    if (doc.source_type === "pepco_portal_document") {
      const ok = validatePepcoStoragePathForRecord(storagePath, {
        projectId,
        coordinationRecordId: String(coordinationRecordId),
        tenantId: record.tenant_id != null ? String(record.tenant_id) : null,
      });
      if (!ok || String(doc.external_application_id ?? "") !== extAppId) {
        throw new Error("Storage namespace validation failed");
      }
    }
    const download = await downloadFn({ supabase, bucket, storagePath });
    if (!download.ok || !download.data) throw new Error("Storage download failed");
    const buffer = Buffer.from(await download.data.arrayBuffer());
    pdfCache.set(key, buffer);
    return buffer;
  };

  const hasInjectedVision = Boolean(deps.visionProcessor);
  const hasInjectedOcr = Boolean(deps.ocrProcessor);

  let visionUsed = 0;
  let ocrUsed = 0;

  for (const { doc, page } of candidates) {
    const pageNum = Number(page.page_number);
    const recommended = String(page.page_analysis?.recommended_method ?? "");
    const wantsVision =
      recommended === "vision" ||
      String(page.status) === "vision_required" ||
      String(page.status) === "vision_failed";
    const wantsOcr =
      recommended === "ocr" ||
      String(page.status) === "ocr_required" ||
      String(page.status) === "ocr_failed";

    if (wantsVision && visionUsed >= visionLimit) continue;
    if (wantsOcr && ocrUsed >= ocrLimit) continue;

    const method = wantsOcr && !wantsVision ? "ocr" : wantsVision ? "vision" : null;
    if (!method) continue;

    if (
      !(
        (method === "vision" && hasInjectedVision) ||
        (method === "ocr" && hasInjectedOcr) ||
        isFallbackMethodAvailable(method, config)
      )
    ) {
      continue;
    }

    page.status = method === "vision" ? "vision_processing" : "ocr_processing";

    try {
      let rendered = null;
      const buffer = await getPdfBuffer(doc);
      rendered = await renderFn(buffer, pageNum, deps);
      if (!rendered || !rendered.pngBuffer) {
        throw new Error("Page image rendering unavailable");
      }

      const imageBase64 = rendered.pngBuffer.toString("base64");
      const source = {
        source_type: String(doc.source_type ?? "unknown"),
        source_document_name: String(doc.original_filename ?? "unknown"),
        source_document_id: doc.document_id ?? null,
        source_storage_path: String(doc.storage_path ?? ""),
        source_content_hash: String(doc.content_hash ?? ""),
        external_application_id: extAppId,
      };
      const roles = Array.isArray(doc.document_roles) ? doc.document_roles.map(String) : [];
      const documentIdStr = String(doc.document_id ?? "");

      /** @type {Array<Record<string, unknown>>} */
      let pageFindings = [];

      if (method === "vision") {
        const result = await visionProcessor.processPage({
          page_number: pageNum,
          image_base64: imageBase64,
          image_mime_type: rendered.mimeType,
          document_roles: roles,
          content_hash: source.source_content_hash,
          document_id: documentIdStr,
        });
        visionUsed += 1;
        usageLog.push({
          method: "vision",
          page_number: pageNum,
          document_id: documentIdStr,
          provider: result.provider,
          model: result.model,
          duration_ms: result.duration_ms,
          usage: result.usage ?? null,
        });
        for (const vf of result.findings ?? []) {
          pageFindings.push(visionFindingToRecord(vf, source, documentIdStr, roles));
        }
        page.status = "vision_processed";
        page.vision_result = {
          processed_at: new Date().toISOString(),
          provider: result.provider,
          model: result.model,
          findings_count: pageFindings.length,
          sheet_title: result.sheet_title ?? null,
          sheet_number: result.sheet_number ?? null,
        };
      } else {
        const result = await ocrProcessor.processPage({
          page_number: pageNum,
          image_base64: imageBase64,
          image_mime_type: rendered.mimeType,
          content_hash: source.source_content_hash,
          document_id: documentIdStr,
        });
        ocrUsed += 1;
        usageLog.push({
          method: "ocr",
          page_number: pageNum,
          document_id: documentIdStr,
          provider: result.provider,
          model: result.model,
          duration_ms: result.duration_ms,
          usage: result.usage ?? null,
          average_confidence: result.average_confidence,
        });

        page.ocr_result = {
          processed_at: new Date().toISOString(),
          provider: result.provider,
          model: result.model,
          average_confidence: result.average_confidence,
          low_confidence_regions: result.low_confidence_regions ?? [],
          word_count: Array.isArray(result.words) ? result.words.length : 0,
          approval_blocked: isOcrApprovalBlocked(
            result.average_confidence,
            config.ocr_min_confidence,
          ),
        };

        const ocrText = String(result.page_text ?? "");
        const pdfCandidates = extractCandidatesFromPdfText(ocrText, pageNum, {
          ...source,
          extraction_method: "ocr",
        });
        const tableCandidates = extractCandidatesFromTables(ocrText, pageNum, {
          ...source,
          extraction_method: "ocr",
        });
        for (const candidate of [...pdfCandidates, ...tableCandidates]) {
          const finding = candidateRecordToFinding(candidate, documentIdStr, roles);
          finding.contributing_methods = ["ocr"];
          if (page.ocr_result.approval_blocked) {
            finding.approval_blocked_reason = "OCR confidence below configured threshold";
            finding.requires_human_review = true;
          }
          pageFindings.push(finding);
        }
        page.status = "ocr_processed";
      }

      const before = findings.length;
      findings = mergeDocumentFindingsHybrid(findings, pageFindings);
      findingsCreated += findings.length - before;
      pagesProcessed += 1;

      doc.findings_count = Number(doc.findings_count ?? 0) + pageFindings.length;
      if (!Array.isArray(doc.extraction_methods_used)) doc.extraction_methods_used = [];
      if (!doc.extraction_methods_used.includes(method)) doc.extraction_methods_used.push(method);

      await persistDocumentProcessingState(supabase, {
        coordinationRecordId: String(coordinationRecordId),
        projectId,
        externalApplicationId: extAppId,
        state: {
          ...state,
          documents,
          findings,
          findings_by_stage: {
            agent_2_load_profile: filterFindingsForUciStage(findings, "agent_2_load_profile"),
            agent_3_application_package: filterFindingsForUciStage(
              findings,
              "agent_3_application_package",
            ),
            agent_4_submission: filterFindingsForUciStage(findings, "agent_4_submission"),
          },
          fallback_processing: {
            last_run_at: new Date().toISOString(),
            last_run_by: userId,
            mode,
            pages_processed: pagesProcessed,
            pages_failed: pagesFailed,
            usage_log: usageLog.slice(-50),
            provider_status: providerStatus,
          },
        },
      });
    } catch (err) {
      pagesFailed += 1;
      const message = safeProcessingErrorMessage(err);
      page.status = method === "vision" ? "vision_failed" : "ocr_failed";
      page.failure_reason = message;
      failedPages.push({
        document_name: String(doc.original_filename ?? doc.document_id ?? "unknown"),
        page_number: pageNum,
        method,
        stage: "fallback_processing",
        message,
      });
      await persistDocumentProcessingState(supabase, {
        coordinationRecordId: String(coordinationRecordId),
        projectId,
        externalApplicationId: extAppId,
        state: {
          ...state,
          documents,
          findings,
          fallback_processing: {
            last_run_at: new Date().toISOString(),
            last_run_by: userId,
            mode,
            pages_processed: pagesProcessed,
            pages_failed: pagesFailed,
            failed_pages: failedPages,
            provider_status: providerStatus,
          },
        },
      });
    } finally {
      // release page-image buffer reference
    }
  }

  // Recompute document statuses
  for (const doc of documents) {
    const pageRecords = Array.isArray(doc.page_records) ? doc.page_records : [];
    const pendingFallback = pageRecords.filter((p) =>
      ["vision_required", "ocr_required", "vision_processing", "ocr_processing"].includes(
        String(p.status),
      ),
    ).length;
    const anyFailed = pageRecords.some((p) =>
      ["vision_failed", "ocr_failed", "failed"].includes(String(p.status)),
    );
    if (pendingFallback > 0) {
      doc.processing_status = "partial";
      doc.failure_reason = "Vision/OCR fallback pages remain unprocessed";
    } else if (anyFailed) {
      doc.processing_status = "partial";
      doc.failure_reason = "One or more fallback pages failed";
    } else if (pageRecords.length > 0) {
      doc.processing_status = "complete";
      doc.failure_reason = null;
    }
  }

  const coverage = computeCoverageSummary(documents, findings);
  const completion = evaluateRunCompletion({
    external_application_id: extAppId,
    documents,
    coverage,
  });

  let status = "complete";
  if (pagesFailed > 0 || pagesProcessed < pagesRequested) status = "partial";
  if (pagesProcessed === 0 && pagesRequested > 0 && !providerStatus.vision_available && !providerStatus.ocr_available) {
    status = "partial";
  }
  if (pagesProcessed === 0 && pagesFailed > 0 && pagesRequested === pagesFailed) status = "failed";

  const finalState = {
    ...state,
    documents,
    findings,
    findings_by_stage: {
      agent_2_load_profile: filterFindingsForUciStage(findings, "agent_2_load_profile"),
      agent_3_application_package: filterFindingsForUciStage(findings, "agent_3_application_package"),
      agent_4_submission: filterFindingsForUciStage(findings, "agent_4_submission"),
    },
    coverage,
    run_status: completion.run_status,
    completion_blockers: completion.blockers,
    fallback_processing: {
      last_run_at: new Date().toISOString(),
      last_run_by: userId,
      mode,
      pages_requested: pagesRequested,
      pages_processed: pagesProcessed,
      pages_failed: pagesFailed,
      findings_created: findingsCreated,
      failed_pages: failedPages,
      usage_log: usageLog,
      provider_status: providerStatus,
      config: {
        vision_enabled: config.vision_enabled,
        ocr_enabled: config.ocr_enabled,
        vision_max_pages_per_run: config.vision_max_pages_per_run,
        ocr_max_pages_per_run: config.ocr_max_pages_per_run,
      },
    },
  };

  await persistDocumentProcessingState(supabase, {
    coordinationRecordId: String(coordinationRecordId),
    projectId,
    externalApplicationId: extAppId,
    state: finalState,
  });

  return {
    status,
    pages_requested: pagesRequested,
    pages_processed: pagesProcessed,
    pages_failed: pagesFailed,
    findings_created: findingsCreated,
    failed_pages: failedPages,
    provider_status: providerStatus,
    pages_remaining: Math.max(0, pagesRequested - pagesProcessed - pagesFailed),
  };
}

/**
 * @param {Array<Record<string, unknown>>} documents
 */
function estimateFallbackPages(documents, mode = "all") {
  const pages = collectFallbackPages(documents, { mode });
  const vision = pages.filter(
    (p) =>
      String(p.page.page_analysis?.recommended_method) === "vision" ||
      String(p.page.status).startsWith("vision"),
  ).length;
  const ocr = pages.filter(
    (p) =>
      String(p.page.page_analysis?.recommended_method) === "ocr" ||
      String(p.page.status).startsWith("ocr"),
  ).length;
  return { total: pages.length, vision, ocr };
}

module.exports = {
  visionFindingToRecord,
  collectFallbackPages,
  runDocumentFallbackProcessing,
  estimateFallbackPages,
};
