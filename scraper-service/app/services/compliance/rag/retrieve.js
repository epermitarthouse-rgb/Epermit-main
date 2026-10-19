"use strict";

const { hybridRetrieveDrawings } = require("./drawingIndex.js");
const { retrieveCodeProvisions } = require("./codeCorpus.js");
const { retrieveSpecEvidence } = require("./specEvidence.js");

const MAX_PROMPT_HITS = 8;
const MAX_PROMPT_CHARS = 4000;

/**
 * Question-driven hybrid retrieval. Does not concatenate the drawing set.
 * @param {{
 *   index: { list: () => Array<Record<string, unknown>> };
 *   questions: Array<{ id: string; topics?: string[]; identifiers?: string[]; discipline?: string | null; disciplines?: string[] }>;
 *   specChunks?: Array<Record<string, unknown>>;
 *   jurisdiction?: string | null;
 *   edition?: string | null;
 *   registryRecordId?: string | null;
 *   effectiveOn?: string | null;
 *   codeProvisions?: Array<Record<string, unknown>>;
 *   currentSheetId?: string | null;
 *   queryEmbedding?: number[] | null;
 *   queryEmbeddings?: Record<string, number[]>;
 * }} input
 */
function retrieveForQuestions(input) {
  const packages = [];
  for (const question of input.questions || []) {
    const drawing = hybridRetrieveDrawings(input.index, {
      topics: question.topics,
      identifiers: question.identifiers,
      discipline: question.discipline,
      disciplines: question.disciplines,
      currentSheetId: input.currentSheetId,
      queryEmbedding: input.queryEmbeddings?.[question.id] || input.queryEmbedding || null,
      limit: 4,
    });
    const code = retrieveCodeProvisions({
      topics: question.topics,
      jurisdiction: input.jurisdiction,
      edition: input.edition,
      registryRecordId: input.registryRecordId,
      effectiveOn: input.effectiveOn,
      provisions: input.codeProvisions,
      authoritativeOnly: false,
    });
    const spec = retrieveSpecEvidence(input.specChunks, {
      topics: question.topics,
      identifiers: question.identifiers,
      limit: 2,
    });
    packages.push({
      questionId: question.id,
      drawing,
      code: code.filter((hit) => hit.authoritative),
      codeContext: code.filter((hit) => !hit.authoritative),
      spec,
    });
  }
  return {
    packages,
    promptEvidence: capPromptEvidence(packages),
  };
}

/**
 * @param {Array<{ questionId: string; drawing: unknown[]; code: unknown[]; spec: unknown[] }>} packages
 */
function capPromptEvidence(packages) {
  const lines = [];
  let chars = 0;
  let hits = 0;
  for (const pack of packages) {
    const groups = [
      ["drawing", pack.drawing],
      ["code", pack.code],
      ["specification", pack.spec],
    ];
    for (const [kind, entries] of groups) {
      for (const entry of entries || []) {
        if (hits >= MAX_PROMPT_HITS) return lines.join("\n");
        const quote = String(entry.quote || "").slice(0, 280);
        if (!quote) continue;
        const where = [entry.fileName || entry.sheetNumber || entry.sectionNumber || kind, entry.pageNumber ? `p.${entry.pageNumber}` : ""]
          .filter(Boolean)
          .join(" ");
        const line = `- [${pack.questionId}] ${where}: ${quote}`;
        if (chars + line.length > MAX_PROMPT_CHARS) return lines.join("\n");
        lines.push(line);
        chars += line.length;
        hits += 1;
      }
    }
  }
  return lines.join("\n");
}

module.exports = {
  retrieveForQuestions,
  capPromptEvidence,
  MAX_PROMPT_HITS,
};
