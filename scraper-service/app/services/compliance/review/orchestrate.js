"use strict";

const { buildObservations } = require("./observations.js");
const { applicableDisciplines, questionsForDisciplines, disciplinePrompt } = require("./disciplines.js");
const { evaluateRules } = require("./rules.js");
const { createDrawingIndex } = require("../rag/drawingIndex.js");
const { retrieveForQuestions } = require("../rag/retrieve.js");
const { sheetNumberFromName } = require("../rag/identifiers.js");

/**
 * Shared package for one sheet. One model call consumes the capped prompt block.
 * Retrieval uses the evidence index, not a second service.
 * @param {{
 *   projectId?: string | null;
 *   sheet?: Record<string, unknown>;
 *   pageText?: string | null;
 *   contentClass?: string | null;
 *   regions?: Array<Record<string, unknown>>;
 *   items?: Array<{ str?: string; region?: Record<string, unknown> | null }>;
 *   index?: ReturnType<createDrawingIndex>;
 *   specChunks?: Array<Record<string, unknown>>;
 *   jurisdictionScope?: Record<string, unknown> | null;
 *   analysisInstructions?: string | null;
 *   revision?: string | null;
 * }} input
 */
function prepareSheetReview(input) {
  const sheet = input.sheet || {};
  const fileName = sheet.fileName || sheet.file_name || sheet.sheetTitle || null;
  const observations = buildObservations({
    sheetId: sheet.id || sheet.sheetId || null,
    fileName,
    page: sheet.pageNumber || sheet.page_number || null,
    title: sheet.title || sheet.sheet_label || null,
    discipline: sheet.discipline || null,
    pageText: input.pageText,
    items: input.items,
  });
  const index = input.index || createDrawingIndex();
  const record = {
    projectId: input.projectId || null,
    documentId: sheet.documentId || sheet.source_document_id || null,
    sheetId: sheet.id || sheet.sheetId || null,
    fileName,
    sheetNumber: sheetNumberFromName(fileName),
    title: sheet.title || sheet.sheet_label || null,
    discipline: sheet.discipline || null,
    revision: input.revision || null,
    pageNumber: sheet.pageNumber || sheet.page_number || 1,
    text: input.pageText || "",
    contentClass: input.contentClass || null,
    regions: input.regions || [],
    observations,
    extractionMethod: input.items?.length ? "pdfjs-text-layer" : "pdf-text",
  };
  index.upsert(record);

  const disciplines = applicableDisciplines({
    fileName,
    title: record.title,
    contentClass: input.contentClass,
    discipline: sheet.discipline,
  });
  const questions = questionsForDisciplines(disciplines, { fileName, contentClass: input.contentClass });
  const retrieval = retrieveForQuestions({
    index,
    questions,
    specChunks: input.specChunks,
    jurisdiction: input.jurisdictionScope?.enforcedJurisdiction || null,
    currentSheetId: record.sheetId,
  });
  const rules = evaluateRules({
    pageText: input.pageText,
    fileName,
    contentClass: input.contentClass,
    drawingRecords: index.list(),
  });

  const emphasis = String(input.analysisInstructions || "").trim();
  const scope = input.jurisdictionScope;
  const contextLines = [
    emphasis
      ? `USER EMPHASIS (adds focus, does not narrow this review, and is not evidence):\n${emphasis.slice(0, 1200)}`
      : "",
    scope
      ? `CODE SCOPE: selected ${scope.selectedScope || "unselected"}; enforced ${scope.enforcedJurisdiction}; detected location ${scope.detectedLocation || "none"}; amendments enforced ${scope.amendmentsEnforced ? "yes" : "no"}.`
      : "",
    `DISCIPLINE PROFILES (a sheet may inform several; review the whole sheet):\n${disciplinePrompt(disciplines)}`,
    retrieval.promptEvidence
      ? `RETRIEVED EVIDENCE (quotes from other sheets, code policy, or specs; a hit is not proof the requirement is satisfied):\n${retrieval.promptEvidence}`
      : "",
    observations.length
      ? `STRUCTURED OBSERVATIONS FROM THIS SHEET:\n${observations
          .slice(0, 24)
          .map((item) => `- ${item.element}: ${item.quote}`)
          .join("\n")}`
      : "",
  ].filter(Boolean);

  return {
    observations,
    disciplines: disciplines.map((discipline) => discipline.id),
    questions: questions.map((question) => question.id),
    retrieval,
    rules,
    record,
    promptBlock: contextLines.join("\n\n").slice(0, 6000),
  };
}

module.exports = {
  prepareSheetReview,
};
