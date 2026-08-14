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
  classifyDocumentFallbackStatus,
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
  OPENAI_CHAT_COMPLETIONS_ENDPOINT,
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

function recomputeFallbackDocumentCoverage(document) {
  const pageRecords = Array.isArray(document?.page_records) ? document.page_records : [];
  const statuses = pageRecords.map((page) => String(page?.status ?? ""));
  const previous =
    document?.page_coverage && typeof document.page_coverage === "object"
      ? document.page_coverage
      : {};
  const processedStatuses = new Set([
    "text_extracted",
    "table_extracted",
    "vision_processed",
    "ocr_processed",
    "human_required",
  ]);
  return {
    ...previous,
    total_pages: Number(previous.total_pages ?? pageRecords.length),
    pages_discovered: Number(previous.pages_discovered ?? pageRecords.length),
    pages_processed: statuses.filter((status) => processedStatuses.has(status)).length,
    pages_vision_processed: statuses.filter((status) => status === "vision_processed").length,
    pages_ocr_processed: statuses.filter((status) => status === "ocr_processed").length,
    failed_pages: statuses.filter((status) =>
      ["failed", "vision_failed", "ocr_failed"].includes(status),
    ).length,
    fallback_pending: statuses.filter((status) =>
      ["vision_required", "ocr_required", "vision_processing", "ocr_processing"].includes(status),
    ).length,
  };
}

function safeFallbackErrorDiagnostics(error, context = {}) {
  return {
    document_id: context.document_id ?? null,
    document_name: context.document_name ?? null,
    page_number: context.page_number ?? null,
    method: context.method ?? null,
    stage: String(error?.stage ?? context.stage ?? "fallback_processing"),
    code: String(error?.code ?? "FALLBACK_PAGE_FAILED"),
    message: safeProcessingErrorMessage(error),
    http_status: error?.http_status ?? error?.status ?? null,
    provider_code: error?.provider_code ?? null,
    provider_type: error?.provider_type ?? null,
    provider_message: error?.provider_message ?? null,
    request_id: error?.request_id ?? null,
    endpoint: error?.endpoint ?? context.endpoint ?? null,
    model: error?.model ?? context.model ?? null,
    attempts: error?.attempts ?? null,
    image_mime_type: context.image_mime_type ?? null,
    image_bytes: context.image_bytes ?? null,
    image_width: context.image_width ?? null,
    image_height: context.image_height ?? null,
    occurred_at: new Date().toISOString(),
  };
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
  if (
    record.tenant_id != null &&
    state.tenant_id != null &&
    String(state.tenant_id) !== String(record.tenant_id)
  ) {
    const err = new Error("Cross-tenant document processing state rejected");
    err.statusCode = 400;
    err.code = "CROSS_TENANT_REJECTED";
    throw err;
  }

  const config = deps.config || getDocumentFallbackConfig(deps.env);
  const providerStatus = fallbackProviderStatus(config);
  const visionProcessor = createVisionPageProcessor(config, deps);
  const ocrProcessor = createOcrPageProcessor(config, deps);
  const renderFn = deps.renderPdfPageToPng || renderPdfPageToPng;
  const downloadFn = deps.downloadFromSupabaseStorage || downloadFromSupabaseStorage;
  console.info(
    "[uci-document-fallback] run started",
    JSON.stringify({
      coordination_record_id: String(coordinationRecordId),
      external_application_id: extAppId,
      document_id: documentId != null ? String(documentId) : null,
      mode,
      vision_enabled: config.vision_enabled,
      ocr_enabled: config.ocr_enabled,
      openai_configured: config.openai_configured,
      vision_model: config.vision_model,
      ocr_model: config.ocr_model,
      endpoint: OPENAI_CHAT_COMPLETIONS_ENDPOINT,
      timeout_ms: config.ai_timeout_ms,
      max_retries: config.ai_max_retries,
    }),
  );

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
  const candidateDocumentIds = new Set(candidates.map(({ doc }) => String(doc.document_id ?? "")));
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
    const renderDiagnostics = {
      image_mime_type: null,
      image_bytes: null,
      image_width: null,
      image_height: null,
    };
    let currentStage = "storage_download";

    try {
      let rendered = null;
      const buffer = await getPdfBuffer(doc);
      currentStage = "pdf_page_render";
      rendered = await renderFn(buffer, pageNum, deps);
      if (!rendered || !rendered.pngBuffer) {
        const error = new Error("Page image rendering unavailable");
        error.code = "PDF_PAGE_RENDER_UNAVAILABLE";
        error.stage = "pdf_page_render";
        throw error;
      }
      const imageBytes = rendered.pngBuffer.length;
      const imageMimeType = String(rendered.mimeType ?? "");
      renderDiagnostics.image_mime_type = imageMimeType;
      renderDiagnostics.image_bytes = imageBytes;
      renderDiagnostics.image_width = Math.round(Number(rendered.width ?? 0));
      renderDiagnostics.image_height = Math.round(Number(rendered.height ?? 0));
      const hasPngSignature =
        imageMimeType === "image/png" &&
        rendered.pngBuffer.length >= 8 &&
        rendered.pngBuffer.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
      if (!hasPngSignature) {
        const error = new Error("Rendered fallback page is not a valid PNG image");
        error.code = "PDF_PAGE_RENDER_INVALID_IMAGE";
        error.stage = "image_validation";
        throw error;
      }

      const imageBase64 = rendered.pngBuffer.toString("base64");
      currentStage = "openai_request";
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
          endpoint: result.endpoint ?? OPENAI_CHAT_COMPLETIONS_ENDPOINT,
          image_bytes: imageBytes,
          image_mime_type: imageMimeType,
          image_width: Math.round(Number(rendered.width ?? 0)),
          image_height: Math.round(Number(rendered.height ?? 0)),
        });
        for (const vf of result.findings ?? []) {
          currentStage = "finding_normalization";
          pageFindings.push(visionFindingToRecord(vf, source, documentIdStr, roles));
        }
        page.status = "vision_processed";
        page.failure_reason = null;
        page.vision_result = {
          processed_at: new Date().toISOString(),
          provider: result.provider,
          model: result.model,
          findings_count: pageFindings.length,
          sheet_title: result.sheet_title ?? null,
          sheet_number: result.sheet_number ?? null,
        };
        page.fallback_diagnostics = {
          stage: "complete",
          method,
          endpoint: result.endpoint ?? OPENAI_CHAT_COMPLETIONS_ENDPOINT,
          model: result.model,
          image_bytes: imageBytes,
          image_base64_chars: imageBase64.length,
          image_mime_type: imageMimeType,
          image_width: Math.round(Number(rendered.width ?? 0)),
          image_height: Math.round(Number(rendered.height ?? 0)),
          duration_ms: result.duration_ms,
          completed_at: new Date().toISOString(),
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
          endpoint: result.endpoint ?? OPENAI_CHAT_COMPLETIONS_ENDPOINT,
          image_bytes: imageBytes,
          image_mime_type: imageMimeType,
          image_width: Math.round(Number(rendered.width ?? 0)),
          image_height: Math.round(Number(rendered.height ?? 0)),
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
        currentStage = "finding_normalization";
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
        page.status = page.ocr_result.approval_blocked ? "human_required" : "ocr_processed";
        page.failure_reason = page.ocr_result.approval_blocked
          ? "OCR confidence below configured threshold"
          : null;
        page.fallback_diagnostics = {
          stage: "complete",
          method,
          endpoint: result.endpoint ?? OPENAI_CHAT_COMPLETIONS_ENDPOINT,
          model: result.model,
          image_bytes: imageBytes,
          image_base64_chars: imageBase64.length,
          image_mime_type: imageMimeType,
          image_width: Math.round(Number(rendered.width ?? 0)),
          image_height: Math.round(Number(rendered.height ?? 0)),
          duration_ms: result.duration_ms,
          completed_at: new Date().toISOString(),
        };
      }

      const before = findings.length;
      currentStage = "finding_normalization";
      findings = mergeDocumentFindingsHybrid(findings, pageFindings);
      findingsCreated += findings.length - before;
      pagesProcessed += 1;

      doc.findings_count = Number(doc.findings_count ?? 0) + pageFindings.length;
      if (!Array.isArray(doc.extraction_methods_used)) doc.extraction_methods_used = [];
      if (!doc.extraction_methods_used.includes(method)) doc.extraction_methods_used.push(method);

      currentStage = "manifest_update";
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
      const diagnostics = safeFallbackErrorDiagnostics(err, {
        document_id: String(doc.document_id ?? ""),
        document_name: String(doc.original_filename ?? doc.document_id ?? "unknown"),
        page_number: pageNum,
        method,
        endpoint: OPENAI_CHAT_COMPLETIONS_ENDPOINT,
        model: method === "vision" ? config.vision_model : config.ocr_model,
        stage: currentStage,
        ...renderDiagnostics,
      });
      page.status = method === "vision" ? "vision_failed" : "ocr_failed";
      page.failure_reason = message;
      page.fallback_diagnostics = diagnostics;
      console.warn("[uci-document-fallback] page failed", JSON.stringify(diagnostics));
      failedPages.push({
        document_name: String(doc.original_filename ?? doc.document_id ?? "unknown"),
        page_number: pageNum,
        method,
        stage: "fallback_processing",
        message,
        code: diagnostics.code,
        stage: diagnostics.stage,
        http_status: diagnostics.http_status,
        request_id: diagnostics.request_id,
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
    doc.page_coverage = recomputeFallbackDocumentCoverage(doc);
    const pendingFallback = pageRecords.filter((p) =>
      ["vision_required", "ocr_required", "vision_processing", "ocr_processing"].includes(
        String(p.status),
      ),
    ).length;
    const anyFailed = pageRecords.some((p) =>
      ["vision_failed", "ocr_failed", "failed"].includes(String(p.status)),
    );
    const anyManualReview = pageRecords.some(
      (p) => String(p.status) === "human_required",
    );
    if (pendingFallback > 0) {
      doc.processing_status = "partial";
      doc.failure_reason = "Vision/OCR fallback pages remain unprocessed";
    } else if (anyFailed) {
      doc.processing_status = "partial";
      doc.failure_reason =
        Number(doc.findings_count ?? 0) > 0
          ? "Parsed with fallback warning: one or more fallback pages failed"
          : "One or more fallback pages failed";
    } else if (anyManualReview) {
      doc.processing_status = "partial";
      doc.failure_reason = "OCR completed with confidence too low for automated use";
    } else if (pageRecords.length > 0) {
      doc.processing_status = "complete";
      doc.failure_reason = null;
    }
    doc.fallback_status = classifyDocumentFallbackStatus(doc, providerStatus);
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
  const targetHasDeterministicFindings = findings.some(
    (finding) =>
      candidateDocumentIds.has(String(finding.document_id ?? "")) &&
      !["vision", "ocr"].includes(String(finding.extraction_method ?? "")) &&
      String(finding.verification_status ?? "raw") !== "stale",
  );
  if (
    pagesProcessed === 0 &&
    pagesFailed > 0 &&
    pagesRequested === pagesFailed &&
    !targetHasDeterministicFindings
  ) {
    status = "failed";
  }

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
        ai_timeout_ms: config.ai_timeout_ms,
        ai_max_retries: config.ai_max_retries,
        vision_model: config.vision_model,
        ocr_model: config.ocr_model,
        endpoint: OPENAI_CHAT_COMPLETIONS_ENDPOINT,
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
  recomputeFallbackDocumentCoverage,
  safeFallbackErrorDiagnostics,
};
