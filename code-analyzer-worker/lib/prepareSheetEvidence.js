"use strict";

const { createDrawingIndex, applyQueryEmbeddings } = require("../../scraper-service/app/services/compliance/rag/drawingIndex.js");
const { retrieveForQuestions } = require("../../scraper-service/app/services/compliance/rag/retrieve.js");
const { prepareSheetReview } = require("../../scraper-service/app/services/compliance/review/orchestrate.js");
const {
  comprehendPdfPage,
  rankRegionsForQuestions,
  questionLineRegions,
  visualFallbackRegions,
  renderCropsFromFile,
} = require("./comprehension.js");
const { createGuardedDrawingStore } = require("./drawingRagStore.js");

/** @type {Map<string, ReturnType<createDrawingIndex>>} */
const indexes = new Map();
/** @type {Set<string>} */
const hydratedRuns = new Set();

function replaceRetrievedEvidence(prompt, evidence) {
  const block = evidence
    ? `RETRIEVED EVIDENCE (quotes from other sheets, code policy, or specs; a hit is not proof the requirement is satisfied):\n${evidence}`
    : "";
  const source = String(prompt || "");
  if (source.includes("RETRIEVED EVIDENCE")) {
    return source
      .replace(
        /RETRIEVED EVIDENCE[\s\S]*?(?=\n\nCODE LIMITATION:|\n\nSTRUCTURED OBSERVATIONS|\n\nCROP LIMITATION:|$)/,
        block ? `${block}\n\n` : "",
      )
      .slice(0, 6000);
  }
  if (!block) return source;
  if (source.includes("CODE LIMITATION:")) {
    return source.replace("CODE LIMITATION:", `${block}\n\nCODE LIMITATION:`).slice(0, 6000);
  }
  return `${source}\n\n${block}`.slice(0, 6000);
}

function drawingEmbedder() {
  if (!process.env.OPENAI_API_KEY) return null;
  const { embedTexts, getOpenAIClient } = require("./embed.js");
  return (texts) => embedTexts(getOpenAIClient(), texts);
}

function evidenceIndexForRun(runId) {
  const key = String(runId || "run");
  if (!indexes.has(key)) indexes.set(key, createDrawingIndex());
  return indexes.get(key);
}

function clearRunEvidenceIndex(runId) {
  const key = String(runId || "run");
  indexes.delete(key);
  for (const mark of hydratedRuns) {
    if (mark.startsWith(`${key}:`)) hydratedRuns.delete(mark);
  }
}

/**
 * Idempotent text seed from sheets already read for this run.
 * @param {string} runId
 * @param {Array<Record<string, unknown>>} sheets
 * @param {(sheetId: string) => { fullText?: string; contentClass?: string } | null} cached
 */
function seedDrawingIndex(runId, sheets, cached) {
  const index = evidenceIndexForRun(runId);
  for (const sheet of sheets || []) {
    const extra = cached(sheet.id) || {};
    if (!extra.fullText) continue;
    index.upsert({
      projectId: sheet.project_id || null,
      documentId: sheet.source_document_id || null,
      sheetId: sheet.id,
      fileName: sheet.file_name || null,
      title: sheet.sheet_label || null,
      discipline: sheet.discipline || null,
      pageNumber: sheet.page_number || 1,
      text: extra.fullText,
      contentClass: extra.contentClass || null,
      extractionMethod: "pdfjs-text-layer",
    });
  }
  return index;
}

function verifierRecords(index) {
  const bySheet = new Map();
  for (const record of index.list()) {
    const key = [
      record.projectId || "",
      record.sheetId || record.fileName || "",
      record.pageNumber || 1,
    ].join(":");
    const text = String(record.text || "");
    const current = bySheet.get(key);
    if (!current) {
      bySheet.set(key, { ...record, text });
      continue;
    }
    current.text = `${current.text}\n${text}`;
    current.identifiers = [...new Set([...(current.identifiers || []), ...(record.identifiers || [])])];
    current.references = [...new Set([...(current.references || []), ...(record.references || [])])];
  }
  return [...bySheet.values()].map((record) => ({
    projectId: record.projectId || null,
    documentId: record.documentId || null,
    sheetId: record.sheetId || null,
    fileName: record.fileName || null,
    sheetNumber: record.sheetNumber || null,
    pageNumber: record.pageNumber || null,
    discipline: record.discipline || null,
    revision: record.revision || null,
    contentClass: record.contentClass || null,
    // OCR lines follow the text layer, so a short cap would drop graphic evidence from related sheets.
    text: String(record.text || "").slice(0, 12000),
    observations: (record.observations || []).slice(0, 12),
    regions: record.regions || [],
    identifiers: record.identifiers || [],
    references: record.references || [],
    extractionMethod: record.extractionMethod || null,
    embeddingStatus: record.embeddingStatus || (record.embedding ? "present" : "unavailable"),
  }));
}

/**
 * @param {{
 *   runId: string;
 *   projectId?: string | null;
 *   sheet: Record<string, unknown>;
 *   pageText?: string | null;
 *   contentClass?: string | null;
 *   pdfPath?: string | null;
 *   specChunks?: Array<Record<string, unknown>>;
 *   jurisdictionScope?: Record<string, unknown> | null;
 *   analysisInstructions?: string | null;
 *   projectType?: string | null;
 *   codeYear?: string | null;
 *   renderRegions?: boolean;
 * }} input
 */
async function prepareEvidenceForSheet(input) {
  const index = evidenceIndexForRun(input.runId);
  let items = [];
  let regions = [];
  let regionImages = [];
  let pageText = input.pageText || "";
  let pageMeta = { pageWidth: 0, pageHeight: 0, graphicalReadStatus: null, sourcePdf: false, ocrLineCount: 0, indexRowCount: 0, words: [], evidenceItems: [] };
  if (input.pdfPath) {
    try {
      const page = await comprehendPdfPage(input.pdfPath, input.sheet.page_number || input.sheet.pageNumber || 1, {
        render: false,
        ocr: input.ocr,
        discoverGraphics: input.discoverGraphics,
        graphicRegions: input.targetGraphicRegions,
      });
      items = page.items || [];
      regions = page.regions || [];
      regionImages = page.regionImages || [];
      if (page.text && page.text.length > pageText.length) pageText = page.text;
      pageMeta = {
        pageWidth: page.pageWidth,
        pageHeight: page.pageHeight,
        graphicalReadStatus: page.graphicalReadStatus || null,
        sourcePdf: true,
        ocrLineCount: page.ocrLineCount || 0,
        indexRowCount: (page.indexRows || []).length,
        words: page.words || [],
        evidenceItems: items,
      };
    } catch (err) {
      console.warn(
        "[code-analyzer-worker] page comprehension failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const prepared = prepareSheetReview({
    projectId: input.projectId || null,
    sheet: input.sheet,
    pageText,
    contentClass: input.contentClass,
    regions,
    items,
    index,
    specChunks: input.specChunks,
    jurisdictionScope: input.jurisdictionScope,
    analysisInstructions: input.analysisInstructions,
    projectType: input.projectType || null,
    codeYear: input.codeYear || null,
    revision: input.sheet?.revision || null,
  });

  let selection = rankRegionsForQuestions(regions, { questions: prepared.questions });
  if (!selection.regions.length && prepared.questions?.length) {
    const lines = questionLineRegions(items, prepared.questions);
    if (lines.length) {
      selection = { regions: lines, limitation: null };
    } else if (pageMeta.pageWidth > 0 && pageMeta.pageHeight > 0) {
      selection = {
        regions: visualFallbackRegions(pageMeta.pageWidth, pageMeta.pageHeight, prepared.questions),
        limitation: "question_visual_fallback_unreadable",
      };
    }
  }
  const pageNumber = input.sheet?.page_number || input.sheet?.pageNumber || 1;
  if (input.renderRegions && input.pdfPath && selection.regions.length) {
    try {
      regionImages = await renderCropsFromFile(input.pdfPath, pageNumber, selection.regions);
    } catch (err) {
      console.warn(
        "[code-analyzer-worker] crop render failed:",
        err instanceof Error ? err.message : err,
      );
    }
  } else {
    regionImages = [];
  }
  if (selection.limitation && prepared.promptBlock) {
    const note = selection.limitation === "question_visual_fallback_unreadable"
      ? "CROP LIMITATION: question_visual_fallback_unreadable. An interior crop was attached with no invented quote. The full sheet is still attached."
      : `CROP LIMITATION: ${selection.limitation}. The full sheet is still attached. No crop was confident enough for the active questions.`;
    prepared.promptBlock = `${prepared.promptBlock}\n\n${note}`.slice(0, 6000);
  }

  const embedding = await applyQueryEmbeddings(index, prepared.questionRecords, input.embedTexts);
  if (embedding.embeddingStatus !== "unavailable") {
    prepared.retrieval = retrieveForQuestions({
      index,
      questions: prepared.questionRecords,
      specChunks: input.specChunks,
      jurisdiction: input.jurisdictionScope?.enforcedJurisdiction || null,
      currentSheetId: prepared.record?.sheetId || null,
      queryEmbeddings: embedding.queryEmbeddings,
    });
    prepared.promptBlock = replaceRetrievedEvidence(prepared.promptBlock, prepared.retrieval.promptEvidence);
  }
  prepared.embeddingStatus = embedding.embeddingStatus;

  return {
    ...prepared,
    pageText,
    ...pageMeta,
    regionImages: regionImages.slice(0, 2),
    cropLimitation: selection.limitation,
    drawingRecords: verifierRecords(index),
  };
}

async function rehydrateDrawingIndex(runId, projectId, store) {
  if (!store || store.available === false || !projectId) return { rehydrated: 0 };
  const mark = `${runId}:${projectId}`;
  if (hydratedRuns.has(mark)) return { rehydrated: 0, cached: true };
  let rows = [];
  try {
    rows = await store.listActive(projectId);
  } catch {
    return { rehydrated: 0, error: true, reason: "read_failed" };
  }
  if (store.lastFailure) {
    return { rehydrated: 0, error: true, reason: store.lastFailure.reason || "read_failed" };
  }
  const index = evidenceIndexForRun(runId);
  for (const row of rows || []) index.upsert(store.rowToRecord ? store.rowToRecord(row) : row);
  hydratedRuns.add(mark);
  return { rehydrated: (rows || []).length };
}

async function persistDrawingRecord(store, record) {
  const records = (Array.isArray(record) ? record : [record]).filter((item) => item?.projectId);
  if (!store || store.kind === "disabled" || store.available === false || !records.length) {
    return {
      persisted: false,
      reason: store?.kind === "disabled" || store?.available === false ? "disabled" : "no_project",
      embeddingStatus: "unavailable",
    };
  }
  try {
    return await store.upsertRecords(records);
  } catch (err) {
    const result = {
      persisted: false,
      reason: "write_failed",
      reported: true,
      code: err?.code || null,
      message: err instanceof Error ? err.message : String(err),
    };
    console.error("[code-analyzer-worker] drawing RAG persistence failed", {
      reason: result.reason,
      code: result.code,
      message: result.message ? String(result.message).slice(0, 300) : null,
    });
    return result;
  }
}

function drawingStoreFor(supabase) {
  return createGuardedDrawingStore(supabase, { embedTexts: drawingEmbedder() });
}

module.exports = {
  evidenceIndexForRun,
  clearRunEvidenceIndex,
  seedDrawingIndex,
  prepareEvidenceForSheet,
  verifierRecords,
  rehydrateDrawingIndex,
  persistDrawingRecord,
  drawingStoreFor,
  drawingEmbedder,
  replaceRetrievedEvidence,
};
