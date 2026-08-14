"use strict";

const { getCoordinationRecordById } = require("./uci-records.service.js");
const {
  getDocumentProcessingState,
  runDocumentProcessing,
} = require("./uci-document-processing.service.js");
const {
  collectFallbackPages,
  runDocumentFallbackProcessing,
} = require("./uci-document-fallback.service.js");
const {
  importDocumentFindingsToLoadProfile,
} = require("./uci-document-findings-bridge.service.js");

const MAX_FALLBACK_PAGES_PER_REPROCESS = 1;
const activeReprocesses = new Map();

function documentFindings(state, documentId) {
  return (Array.isArray(state?.findings) ? state.findings : []).filter(
    (finding) =>
      String(finding?.document_id ?? "") === String(documentId) &&
      String(finding?.verification_status ?? "raw") !== "stale",
  );
}

function documentSignature(state, documentId) {
  const document = (Array.isArray(state?.documents) ? state.documents : []).find(
    (item) => String(item?.document_id ?? "") === String(documentId),
  );
  if (!document) return "missing";
  const pages = (Array.isArray(document.page_records) ? document.page_records : []).map((page) => [
    Number(page?.page_number ?? 0),
    String(page?.status ?? ""),
    String(page?.failure_reason ?? ""),
  ]);
  const findings = documentFindings(state, documentId)
    .map((finding) => [
      String(finding?.field_key ?? ""),
      String(finding?.normalized_value ?? ""),
      String(finding?.unit ?? ""),
      Number(finding?.page_number ?? 0),
      String(finding?.evidence_fingerprint ?? ""),
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({
    processing_status: String(document.processing_status ?? ""),
    findings_extraction_status: String(document.findings_extraction_status ?? ""),
    failure_reason: String(document.failure_reason ?? ""),
    pages,
    findings,
  });
}

function requiredFallbackMethods(document) {
  const methods = new Set();
  for (const page of Array.isArray(document?.page_records) ? document.page_records : []) {
    const status = String(page?.status ?? "");
    if (["vision_required", "vision_processing", "vision_failed"].includes(status)) {
      methods.add("vision");
    }
    if (["ocr_required", "ocr_processing", "ocr_failed"].includes(status)) {
      methods.add("ocr");
    }
    if (status === "human_required") {
      const recommended = String(page?.page_analysis?.recommended_method ?? "");
      if (recommended === "vision" || recommended === "ocr") methods.add(recommended);
    }
  }
  return methods;
}

function summarizeDocumentState(state, documentId) {
  const document = (Array.isArray(state?.documents) ? state.documents : []).find(
    (item) => String(item?.document_id ?? "") === String(documentId),
  );
  if (!document) return null;

  const pages = Array.isArray(document.page_records) ? document.page_records : [];
  const statuses = pages.map((page) => String(page?.status ?? ""));
  const required = statuses.filter(
    (status) => status === "vision_required" || status === "ocr_required",
  ).length;
  const fallbackFailed = statuses.filter(
    (status) => status === "vision_failed" || status === "ocr_failed",
  ).length;
  const humanRequired = statuses.filter((status) => status === "human_required").length;
  const providerStatus = state?.fallback_provider_status ?? {
    vision_available: false,
    ocr_available: false,
    warnings: [],
  };
  const methods = requiredFallbackMethods(document);
  const unavailableMethods = [...methods].filter(
    (method) =>
      (method === "vision" && !providerStatus.vision_available) ||
      (method === "ocr" && !providerStatus.ocr_available),
  );

  return {
    document_id: String(document.document_id),
    document_name: String(document.original_filename ?? document.document_id),
    processing_status: String(document.processing_status ?? "pending"),
    findings_extraction_status: document.findings_extraction_status ?? null,
    findings_count: documentFindings(state, documentId).length,
    pages_total: pages.length,
    pages_requiring_fallback: required,
    pages_fallback_failed: fallbackFailed,
    pages_manual_review: humanRequired,
    required_fallback_methods: [...methods],
    unavailable_fallback_methods: unavailableMethods,
    fallback_provider_status: providerStatus,
    failure_reason: document.failure_reason ?? null,
  };
}

function resolveOutcome(before, after, fallbackAttempted) {
  if (!after || after.processing_status === "failed") return "failed";
  if (after.pages_manual_review > 0) return "manual_review_required";
  if (after.unavailable_fallback_methods.length > 0) return "fallback_unavailable";
  if (after.pages_fallback_failed > 0) {
    if (fallbackAttempted && after.findings_count > 0) {
      return "parsed_with_fallback_warning";
    }
    return fallbackAttempted ? "fallback_failed" : "still_needs_fallback";
  }
  if (after.pages_requiring_fallback > 0 || after.processing_status === "partial") {
    return "still_needs_fallback";
  }
  return before.signature === after.signature ? "unchanged" : "parsed";
}

async function reprocessDocumentCore(supabase, params) {
  const {
    coordinationRecordId,
    userId,
    externalApplicationId,
    documentId,
    deps = {},
  } = params;
  const extAppId = String(externalApplicationId || "").trim();
  const targetId = String(documentId || "").trim();
  if (!targetId) {
    const err = new Error("document_id is required");
    err.statusCode = 400;
    err.code = "DOCUMENT_ID_REQUIRED";
    throw err;
  }

  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  const beforeState = getDocumentProcessingState(record?.metadata, extAppId);
  const beforeSummary = summarizeDocumentState(beforeState, targetId);
  if (!record || !beforeState || !beforeSummary) {
    const err = new Error("Document was not found in this coordination processing scope");
    err.statusCode = 404;
    err.code = "DOCUMENT_NOT_FOUND";
    throw err;
  }
  beforeSummary.signature = documentSignature(beforeState, targetId);

  await runDocumentProcessing(supabase, {
    coordinationRecordId,
    userId,
    externalApplicationId: extAppId,
    refresh: true,
    documentIds: [targetId],
    deps: deps.processing ?? {},
  });

  let currentRecord = await getCoordinationRecordById(supabase, coordinationRecordId);
  let currentState = getDocumentProcessingState(currentRecord?.metadata, extAppId);
  let currentDocument = (Array.isArray(currentState?.documents) ? currentState.documents : []).find(
    (item) => String(item?.document_id ?? "") === targetId,
  );
  const fallbackPages = currentDocument
    ? collectFallbackPages([currentDocument], { mode: "all" })
    : [];
  const providerStatus = currentState?.fallback_provider_status ?? {};
  const availableFallbackPages = fallbackPages.filter(({ page }) => {
    const status = String(page?.status ?? "");
    return (
      (status.startsWith("vision_") && providerStatus.vision_available) ||
      (status.startsWith("ocr_") && providerStatus.ocr_available)
    );
  });

  let fallbackResult = null;
  if (availableFallbackPages.length > 0) {
    const fallbackPageNumbers = availableFallbackPages
      .slice(0, MAX_FALLBACK_PAGES_PER_REPROCESS)
      .map(({ page }) => Number(page.page_number));
    fallbackResult = await runDocumentFallbackProcessing(supabase, {
      coordinationRecordId,
      userId,
      externalApplicationId: extAppId,
      documentId: targetId,
      mode: "all",
      pageNumbers: fallbackPageNumbers,
      deps: deps.fallback ?? {},
    });
    currentRecord = await getCoordinationRecordById(supabase, coordinationRecordId);
    currentState = getDocumentProcessingState(currentRecord?.metadata, extAppId);
    currentDocument = (Array.isArray(currentState?.documents) ? currentState.documents : []).find(
      (item) => String(item?.document_id ?? "") === targetId,
    );
  }

  const findingsChanged =
    beforeSummary.signature !== documentSignature(currentState, targetId);
  const bridge = await importDocumentFindingsToLoadProfile(supabase, {
    coordinationRecordId,
    userId,
    externalApplicationId: extAppId,
    refresh: findingsChanged,
    documentIds: [targetId],
  });

  currentRecord = await getCoordinationRecordById(supabase, coordinationRecordId);
  currentState = getDocumentProcessingState(currentRecord?.metadata, extAppId);
  const afterSummary = summarizeDocumentState(currentState, targetId);
  afterSummary.signature = documentSignature(currentState, targetId);
  const outcome = resolveOutcome(beforeSummary, afterSummary, fallbackResult != null);
  const { signature: _beforeSignature, ...beforeResponse } = beforeSummary;
  const { signature: _afterSignature, ...afterResponse } = afterSummary;

  return {
    status:
      outcome === "failed" || outcome === "fallback_failed"
        ? "failed"
        : outcome === "parsed" || outcome === "unchanged"
          ? "complete"
          : "partial",
    outcome,
    changed: beforeSummary.signature !== afterSummary.signature,
    document_id: targetId,
    document_name: afterSummary.document_name,
    before: beforeResponse,
    after: afterResponse,
    fallback_attempted: fallbackResult != null,
    fallback: fallbackResult,
    candidates: {
      created: bridge.candidates_created,
      reused: bridge.candidates_reused,
      superseded: bridge.candidates_superseded,
      failed_findings: bridge.failed_findings,
    },
  };
}

async function reprocessDocument(supabase, params) {
  const key = [
    String(params?.coordinationRecordId ?? ""),
    String(params?.externalApplicationId ?? ""),
    String(params?.documentId ?? ""),
  ].join("|");
  if (activeReprocesses.has(key)) {
    const err = new Error("This document is already being reprocessed");
    err.statusCode = 409;
    err.code = "DOCUMENT_REPROCESS_IN_PROGRESS";
    throw err;
  }
  const operation = reprocessDocumentCore(supabase, params);
  activeReprocesses.set(key, operation);
  try {
    return await operation;
  } finally {
    activeReprocesses.delete(key);
  }
}

module.exports = {
  documentSignature,
  requiredFallbackMethods,
  summarizeDocumentState,
  resolveOutcome,
  reprocessDocument,
  reprocessDocumentCore,
  activeReprocesses,
  MAX_FALLBACK_PAGES_PER_REPROCESS,
};
