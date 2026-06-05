import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.28.0";
import {
  buildFullTextWithPageMarkers,
  buildParserSummary,
  normalizeManualParsedComments,
  parseManualCommentLetterDeterministic,
  type DocumentPageText,
  type ManualParsedComment,
} from "../_shared/manualCommentLetterParse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LLM_TEXT_MAX = 100_000;

function toClientComments(
  items: ManualParsedComment[],
  sourceFileName?: string,
) {
  return items.map((c) => ({
    original_text: c.original_comment,
    discipline: c.discipline,
    code_reference: c.code_reference,
    reviewer_name: c.reviewer_name,
    comment_number: c.comment_number,
    previous_comment_text: c.previous_comment_text,
    code_references: c.code_references,
    existing_response_text: c.existing_response_text,
    source_page: c.source_page,
    source_file: sourceFileName ?? null,
    confidence: c.confidence,
  }));
}

async function parseImageComments(
  openai: OpenAI,
  imageBase64: string,
  imageType: string,
  pageNumber: number,
): Promise<ManualParsedComment[]> {
  const systemPrompt = `You are an expert Permit Expeditor. Read this image of a permit comment letter.
Extract every reviewer comment (not blank applicant response fields).
Copy reviewer text verbatim. Never summarize or use placeholders like "See previous comment."
For each comment return: original_comment, discipline (Architecture|MEP|Structural|Zoning|Fire|DOEE|Energy), code_reference (or null),
reviewer_name, comment_number, previous_comment_text (verbatim [PREVIOUS COMMENT] block if present), existing_response_text (only if non-blank), source_page, confidence (0-1).
Return JSON: {"comments":[...]} only.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all permit comments from this image." },
          {
            type: "image_url",
            image_url: {
              url: `data:${imageType};base64,${imageBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) return [];
  const data = JSON.parse(content) as { comments?: unknown[] };
  const normalized = normalizeManualParsedComments(Array.isArray(data.comments) ? data.comments : []);
  return normalized.map((c) => ({
    ...c,
    source_page: c.source_page ?? pageNumber,
  }));
}

async function llmParseFullText(
  openai: OpenAI,
  fullText: string,
  sourceFileName?: string,
): Promise<ManualParsedComment[]> {
  const truncated = fullText.length > LLM_TEXT_MAX
    ? fullText.slice(0, LLM_TEXT_MAX) + "\n\n[TRUNCATED]"
    : fullText;

  const systemPrompt = `You parse jurisdiction permit comment letters into structured reviewer comments.

Rules:
- Split by reviewer/discipline sections and Comment N blocks.
- "Response N:" sections are applicant responses, NOT reviewer comments. Include non-blank response text in existing_response_text only.
- Preserve [PREVIOUS COMMENT] text verbatim in previous_comment_text. Never summarize or compress it.
- Never replace reviewer text with placeholders like "See previous comment."
- Copy original_comment and previous_comment_text verbatim from the document. Do not rewrite, summarize, or shorten.
- Skip cover letter, signatures, and metadata.
- Extract code references (DCBC, IBC, NFPA, section numbers like 903.2.1.2).
- discipline must be one of: Architecture, MEP, Structural, Zoning, Fire, DOEE, Energy.

Return JSON only:
{"comments":[{"reviewer_name":"...","discipline":"...","comment_number":"1","original_comment":"...","previous_comment_text":null,"code_references":[],"code_reference":null,"existing_response_text":null,"source_page":null,"confidence":0.9}]}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Source file: ${sourceFileName ?? "unknown"}\n\nDocument text:\n${truncated}`,
      },
    ],
    max_tokens: 8192,
    response_format: { type: "json_object" },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) return [];
  const data = JSON.parse(content) as { comments?: unknown[] };
  return normalizeManualParsedComments(Array.isArray(data.comments) ? data.comments : []);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const body = await req.json().catch(() => ({}));

    const sourceFileName = typeof body.sourceFileName === "string" ? body.sourceFileName : undefined;
    const sourceDocumentId = typeof body.sourceDocumentId === "string" ? body.sourceDocumentId : null;
    const imageBase64 = body.imageBase64 as string | undefined;
    const imageType = (body.imageType as string) || "image/png";
    const pageNumber = typeof body.pageNumber === "number" ? body.pageNumber : 1;

    const pages = Array.isArray(body.pages)
      ? (body.pages as DocumentPageText[]).filter(
        (p) => p && typeof p.pageNumber === "number" && typeof p.text === "string",
      )
      : undefined;

    let fullText = typeof body.fullText === "string" ? body.fullText : "";
    if (!fullText && pages && pages.length > 0) {
      fullText = buildFullTextWithPageMarkers(pages);
    }

    let parseMethod = "deterministic";
    let comments: ManualParsedComment[] = [];

    if (fullText.trim().length > 0) {
      comments = parseManualCommentLetterDeterministic(fullText, pages);
      parseMethod = "deterministic";

      // LLM fallback only when deterministic finds nothing — never override section context.
      if (comments.length === 0) {
        const llmComments = await llmParseFullText(openai, fullText, sourceFileName);
        if (llmComments.length > 0) {
          comments = llmComments;
          parseMethod = "llm_text";
        } else {
          parseMethod = "llm_text_empty";
        }
      }
    } else if (imageBase64) {
      comments = await parseImageComments(openai, imageBase64, imageType, pageNumber);
      parseMethod = "image_vision";
    } else {
      return new Response(
        JSON.stringify({ error: "fullText, pages, or imageBase64 is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parserSummary = buildParserSummary(comments);

    return new Response(
      JSON.stringify({
        comments: toClientComments(comments, sourceFileName),
        parse_method: parseMethod,
        comment_count: comments.length,
        parser_summary: parserSummary,
        source_document_id: sourceDocumentId,
        source_file: sourceFileName ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in parse-manual-comment-letter:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
