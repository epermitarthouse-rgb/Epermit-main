"use strict";

/**
 * Optional vision extraction of drawing index rows when OCR/text is sparse.
 * Parsed rows are returned for deterministic comparison in the frontend.
 */

function parseJsonContent(content) {
  if (!content || typeof content !== "string") return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildIndexExtractPrompts() {
  return {
    systemPrompt: `You extract rows from an architectural drawing index / sheet list image.

Return ONLY valid JSON:
{
  "entries": [
    { "sheetNumber": "A-101", "title": "First Floor Plan" }
  ]
}

Rules:
- List every sheet number and title visible in the index table.
- Preserve sheet numbers exactly as printed (including prefixes and separators).
- Do not invent sheets that are not listed.
- Ignore cover notes, legends, and revision blocks unless they contain sheet rows.`,
    userPrompt:
      "Extract all sheet number and title pairs from this drawing index. Return JSON only.",
  };
}

/**
 * @param {import("openai").OpenAI} openai
 * @param {{ imageBase64: string; imageType?: string; pageText?: string | null; logError?: (msg: string, extra?: string) => void }} params
 */
async function extractDrawingIndexWithOpenAI(params) {
  const {
    openai,
    imageBase64,
    imageType = "image/png",
    pageText = null,
    logError = console.error,
  } = params;

  const { systemPrompt, userPrompt } = buildIndexExtractPrompts();
  const userContent = [{ type: "text", text: userPrompt }];
  if (pageText && String(pageText).trim()) {
    userContent[0].text += `\n\nOCR/text already extracted (may be incomplete):\n${pageText}`;
  }
  userContent.push({
    type: "image_url",
    image_url: {
      url: `data:${imageType};base64,${imageBase64}`,
      detail: "high",
    },
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: 2048,
    response_format: { type: "json_object" },
  });

  const parsed = parseJsonContent(response.choices?.[0]?.message?.content);
  if (!parsed || !Array.isArray(parsed.entries)) {
    logError("[extract-drawing-index] Missing entries array");
    return { ok: false, status: 502, error: "Index extraction returned an invalid response" };
  }

  const entries = parsed.entries
    .map((row) => ({
      sheetNumber: String(row.sheetNumber ?? row.sheet_number ?? "").trim(),
      title: row.title != null ? String(row.title).trim() : null,
    }))
    .filter((row) => row.sheetNumber);

  return { ok: true, status: 200, entries };
}

module.exports = {
  buildIndexExtractPrompts,
  extractDrawingIndexWithOpenAI,
};
