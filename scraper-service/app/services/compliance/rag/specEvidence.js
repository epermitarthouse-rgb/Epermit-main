"use strict";

/**
 * Specification chunks can establish a project requirement.
 * They cannot prove that a condition is drawn.
 * @param {Array<Record<string, unknown>> | null | undefined} chunks
 * @param {{ topics?: string[]; identifiers?: string[]; limit?: number }} query
 */
function retrieveSpecEvidence(chunks, query) {
  const topics = (query.topics || []).map((topic) => topic.toLowerCase()).filter(Boolean);
  const identifiers = (query.identifiers || []).map((id) => String(id).toLowerCase()).filter(Boolean);
  const hits = [];
  for (const chunk of chunks || []) {
    const text = String(chunk.text || chunk.chunk_text || "");
    const section = String(chunk.sectionNumber || chunk.section_number || "");
    const title = String(chunk.sectionTitle || chunk.section_title || "");
    const haystack = `${section} ${title} ${text}`.toLowerCase();
    const topicHit = topics.some((topic) => haystack.includes(topic));
    const idHit = identifiers.some((id) => haystack.includes(id));
    if (topics.length && !topicHit && !idHit) continue;
    const quote = text.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!quote) continue;
    hits.push({
      sourceType: "specification",
      documentId: chunk.documentId || chunk.document_id || null,
      fileName: chunk.fileName || chunk.file_name || null,
      sectionNumber: section || null,
      sectionTitle: title || null,
      pageStart: chunk.pageStart || chunk.page_start || null,
      pageEnd: chunk.pageEnd || chunk.page_end || null,
      quote,
      provesDrawing: false,
      provesRequirementSatisfied: false,
      extractionMethod: "match_analyzer_spec_chunks",
      embeddingModel: "text-embedding-3-small",
      provenance: {
        method: idHit ? "spec-identifier" : "spec-topic",
        embeddingModel: "text-embedding-3-small",
        note: "A specification can establish a project requirement. It does not prove the condition is drawn.",
      },
    });
  }
  return hits.slice(0, query.limit || 3);
}

module.exports = {
  retrieveSpecEvidence,
};
