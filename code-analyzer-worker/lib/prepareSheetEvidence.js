"use strict";

const { createDrawingIndex } = require("../../scraper-service/app/services/compliance/rag/drawingIndex.js");
const { prepareSheetReview } = require("../../scraper-service/app/services/compliance/review/orchestrate.js");
const { comprehendPdfPage } = require("./comprehension.js");

/** @type {Map<string, ReturnType<createDrawingIndex>>} */
const indexes = new Map();

function evidenceIndexForRun(runId) {
  const key = String(runId || "run");
  if (!indexes.has(key)) indexes.set(key, createDrawingIndex());
  return indexes.get(key);
}

function clearRunEvidenceIndex(runId) {
  indexes.delete(String(runId || "run"));
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
  return index.list().map((record) => ({
    projectId: record.projectId || null,
    documentId: record.documentId || null,
    sheetId: record.sheetId || null,
    fileName: record.fileName || null,
    sheetNumber: record.sheetNumber || null,
    pageNumber: record.pageNumber || null,
    discipline: record.discipline || null,
    revision: record.revision || null,
    contentClass: record.contentClass || null,
    text: String(record.text || "").slice(0, 4000),
    observations: (record.observations || []).slice(0, 12),
    regions: record.regions || [],
    extractionMethod: record.extractionMethod || null,
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
 *   renderRegions?: boolean;
 * }} input
 */
async function prepareEvidenceForSheet(input) {
  const index = evidenceIndexForRun(input.runId);
  let items = [];
  let regions = [];
  let regionImages = [];
  let pageText = input.pageText || "";
  if (input.pdfPath) {
    try {
      const page = await comprehendPdfPage(input.pdfPath, input.sheet.page_number || input.sheet.pageNumber || 1, {
        render: Boolean(input.renderRegions),
      });
      items = page.items || [];
      regions = page.regions || [];
      regionImages = page.regionImages || [];
      if (page.text && page.text.length > pageText.length) pageText = page.text;
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
  });

  return {
    ...prepared,
    pageText,
    regionImages: regionImages.slice(0, 2),
    drawingRecords: verifierRecords(index),
  };
}

module.exports = {
  evidenceIndexForRun,
  clearRunEvidenceIndex,
  seedDrawingIndex,
  prepareEvidenceForSheet,
  verifierRecords,
};
