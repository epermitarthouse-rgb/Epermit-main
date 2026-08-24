"use strict";

const { vectorToPg } = require("./chunk");
const { embedTexts, getOpenAIClient } = require("./embed");
const { buildSpecSections, chunkSectionText, extractSpecHeadingsFromPage } = require("./specExtract");

async function indexSpecificationDocument(supabase, openai, params) {
  const {
    projectId,
    documentId,
    userId,
    fileName,
    contentFingerprint,
    pageTexts,
  } = params;

  const allEvents = [];
  for (const [pageNumStr, text] of Object.entries(pageTexts)) {
    const pageNum = Number(pageNumStr);
    const events = extractSpecHeadingsFromPage(text, pageNum);
    allEvents.push(...events);
  }

  const sections = buildSpecSections(allEvents);

  await supabase
    .from("code_analyzer_spec_sections")
    .delete()
    .eq("document_id", documentId)
    .eq("content_fingerprint", contentFingerprint);

  await supabase
    .from("project_document_chunks")
    .delete()
    .eq("document_id", documentId)
    .eq("content_fingerprint", contentFingerprint)
    .eq("source_class", "specification");

  const sectionRows = [];
  const chunkRows = [];

  for (const section of sections) {
    const bodyChunks = chunkSectionText(section, pageTexts);
    const bodyText = bodyChunks.map((c) => c.chunkText).join("\n");

    sectionRows.push({
      project_id: projectId,
      document_id: documentId,
      content_fingerprint: contentFingerprint,
      division: section.division,
      section_number: section.section_number,
      section_title: section.section_title,
      page_start: section.page_start,
      page_end: section.page_end,
      body_text: bodyText.slice(0, 50000),
      metadata: { parts: section.parts },
    });
  }

  if (sectionRows.length > 0) {
    const { data: insertedSections, error: secError } = await supabase
      .from("code_analyzer_spec_sections")
      .insert(sectionRows)
      .select("id, section_number, section_title, page_start, page_end, division");

    if (secError) throw new Error(secError.message);

    for (const sec of insertedSections || []) {
      const section = sections.find((s) => s.section_number === sec.section_number);
      if (!section) continue;
      const bodyChunks = chunkSectionText(section, pageTexts);
      for (const chunk of bodyChunks) {
        chunkRows.push({
          section: sec,
          chunk,
        });
      }
    }
  }

  if (chunkRows.length === 0) return { sections: 0, chunks: 0 };

  const embeddings = await embedTexts(
    openai,
    chunkRows.map((r) => r.chunk.chunkText),
  );

  const inserts = chunkRows.map((row, i) => ({
    project_id: projectId,
    document_id: documentId,
    user_id: userId,
    file_name: fileName,
    document_type: "specification",
    page_number: row.section.page_start,
    page_start: row.section.page_start,
    page_end: row.section.page_end,
    chunk_index: row.chunk.chunkIndex,
    chunk_text: row.chunk.chunkText,
    embedding: vectorToPg(embeddings[i]),
    source_class: "specification",
    content_fingerprint: contentFingerprint,
    division: row.section.division,
    section_number: row.section.section_number,
    section_title: row.section.section_title,
    spec_section_id: row.section.id,
    metadata: { analyzer_v2: true },
  }));

  const { error: chunkError } = await supabase.from("project_document_chunks").insert(inserts);
  if (chunkError) throw new Error(chunkError.message);

  return { sections: sectionRows.length, chunks: inserts.length };
}

module.exports = { indexSpecificationDocument };
