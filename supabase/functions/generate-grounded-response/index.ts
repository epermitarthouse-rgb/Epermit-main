import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.28.0";
import {
  corsHeaders,
  jsonResponse,
  requireAuthProjectAccess,
} from "../_shared/requireAuthProject.ts";
import { embedTexts, vectorToPg } from "../_shared/documentIngestion.ts";
import {
  buildGroundedCommentContext,
  GROUNDED_NO_REVIEW_TEXT_MESSAGE,
  sanitizeGroundedTextField,
} from "../_shared/groundedCommentContext.ts";

interface RetrievedChunk {
  id: string;
  document_id: string;
  file_name: string | null;
  document_type: string | null;
  page_number: number | null;
  sheet_label: string | null;
  sheet_title: string | null;
  chunk_text: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

interface GroundedEvidenceItem {
  document_id: string;
  file_name: string;
  page_number: number | null;
  sheet_label: string | null;
  sheet_title: string | null;
  snippet: string;
  relevance: "high" | "medium" | "low";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const projectId = (body.project_id ?? body.projectId) as string | undefined;
    const commentId = (body.comment_id ?? body.commentId) as string | undefined;
    const discipline = sanitizeGroundedTextField(body.discipline);
    const codeReference = sanitizeGroundedTextField(body.code_reference ?? body.codeReference);
    const reviewerName = sanitizeGroundedTextField(body.reviewer_name ?? body.reviewerName);
    const commentNumber = sanitizeGroundedTextField(body.comment_number ?? body.commentNumber);

    const auth = await requireAuthProjectAccess(req, projectId);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    let dbComment: {
      original_text?: string | null;
      previous_comment_text?: string | null;
      existing_response_text?: string | null;
      discipline?: string | null;
      code_reference?: string | null;
      code_references?: string | null;
      reviewer_name?: string | null;
      comment_number?: string | null;
    } | null = null;

    if (commentId) {
      const { data, error: commentError } = await ctx.supabaseAdmin
        .from("parsed_comments")
        .select(
          "original_text, previous_comment_text, existing_response_text, discipline, code_reference, code_references, reviewer_name, comment_number",
        )
        .eq("id", commentId)
        .eq("project_id", ctx.projectId)
        .maybeSingle();
      if (commentError) {
        return jsonResponse({ error: commentError.message }, 500);
      }
      dbComment = data;
    }

    const bodyCommentText = sanitizeGroundedTextField(body.comment_text ?? body.commentText);
    const bodyPrevious = sanitizeGroundedTextField(body.previous_comment_text ?? body.previousCommentText);
    const bodyExisting = sanitizeGroundedTextField(body.existing_response_text ?? body.existingResponseText);
    const bodyCodeRefs = body.code_references ?? body.codeReferences;

    const commentContext = buildGroundedCommentContext({
      original_text: bodyCommentText || dbComment?.original_text,
      previous_comment_text: bodyPrevious || dbComment?.previous_comment_text,
      existing_response_text: bodyExisting || dbComment?.existing_response_text,
      discipline: discipline || dbComment?.discipline,
      code_reference: codeReference || dbComment?.code_reference,
      code_references: Array.isArray(bodyCodeRefs)
        ? bodyCodeRefs
        : typeof bodyCodeRefs === "string"
          ? bodyCodeRefs
          : dbComment?.code_references,
      reviewer_name: reviewerName || dbComment?.reviewer_name,
      comment_number: commentNumber || dbComment?.comment_number,
    });

    if (!commentContext.has_substantive_content) {
      return jsonResponse({
        error: GROUNDED_NO_REVIEW_TEXT_MESSAGE,
        code: "no_review_text",
      }, 400);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return jsonResponse({ error: "OpenAI API key not configured" }, 500);
    }

    const { count: chunkCount, error: countError } = await ctx.supabaseAdmin
      .from("project_document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", ctx.projectId);

    if (countError) {
      return jsonResponse({ error: countError.message }, 500);
    }

    if (!chunkCount || chunkCount === 0) {
      const { data: queuedDoc } = await ctx.supabaseAdmin
        .from("project_documents")
        .select("ai_ingestion_status")
        .eq("project_id", ctx.projectId)
        .in("ai_ingestion_status", ["queued", "processing"])
        .limit(1);

      const isInProgress = Array.isArray(queuedDoc) && queuedDoc.length > 0;

      return jsonResponse({
        error: isInProgress
          ? "Documents are not prepared for AI yet. Ingestion is still in progress — wait for Prepare for AI to finish."
          : "Documents are not prepared for AI yet. Go to Project Documents and click Prepare for AI on the plan set.",
        code: "no_prepared_documents",
      }, 400);
    }

    const openai = new OpenAI({ apiKey: openaiKey });
    const queryText = commentContext.retrieval_query_text;

    const [queryEmbedding] = await embedTexts(openai, [queryText]);
    const embeddingStr = vectorToPg(queryEmbedding);

    const { data: matches, error: matchError } = await ctx.supabaseAuth.rpc(
      "match_document_chunks",
      {
        p_project_id: ctx.projectId,
        p_query_embedding: embeddingStr,
        p_match_count: 8,
      },
    );

    if (matchError) {
      return jsonResponse({ error: matchError.message }, 500);
    }

    const chunks = (matches ?? []) as RetrievedChunk[];
    const topSimilarity = chunks[0]?.similarity ?? 0;
    const evidenceWeak = chunks.length === 0 || topSimilarity < 0.25;

    const evidenceContext = chunks.map((c, i) => ({
      index: i + 1,
      document_id: c.document_id,
      file_name: c.file_name ?? "unknown",
      page_number: c.page_number,
      sheet_label: c.sheet_label,
      sheet_title: c.sheet_title,
      similarity: c.similarity,
      text: c.chunk_text.slice(0, 1200),
      low_text: (c.metadata as Record<string, unknown>)?.low_text === true,
    }));

    const systemPrompt = `You are assisting a licensed architect/engineer drafting a permit comment response.
Use ONLY the reviewer comment and the retrieved project document evidence below.

Output rules — keep each field concise and scannable (not essay paragraphs):
- suggested_response: 1–3 short sentences the applicant can submit. Lead with the action taken or clarification. No filler.
- required_action: Bullet-style plan revision(s) needed, one per line if multiple. Empty string if none.
- missing_info_or_risk: What was NOT found in evidence or still needs human confirmation. Be explicit (e.g. "No egress plan sheet found for 1st floor seating layout."). Empty if fully supported.
- confidence: high|medium|low based on evidence strength.
- evidence: Only items from retrieved chunks; empty array if none apply.

Hard rules:
- Do NOT invent sheet references, page numbers, or compliance claims unsupported by evidence.
- Do NOT claim compliance unless evidence supports it.
- Do NOT use placeholder refs like "See Sheet ___".
- When current comment is short ("See previous comment.", "Please cloud corrections."), the full requirement is in Previous reviewer comment/context — base ALL fields on that text.
- suggested_response must NOT repeat the entire comment back; address it directly.

Return JSON only with this schema:
{
  "suggested_response": "string",
  "required_action": "string",
  "missing_info_or_risk": "string",
  "confidence": "high|medium|low",
  "evidence": [
    {
      "document_id": "uuid",
      "file_name": "string",
      "page_number": 12,
      "sheet_label": "A-1.04",
      "sheet_title": "string or null",
      "snippet": "short quoted or paraphrased evidence",
      "relevance": "high|medium|low"
    }
  ]
}`;

    const resolvedDiscipline = discipline || dbComment?.discipline || "unknown";
    const resolvedReviewer = reviewerName || dbComment?.reviewer_name || "";
    const resolvedCommentNumber = commentNumber || dbComment?.comment_number || "";
    const codeRefsDisplay = commentContext.code_references.length > 0
      ? commentContext.code_references.join(", ")
      : "none";

    const userPrompt = `Reviewer comment${resolvedCommentNumber ? ` #${resolvedCommentNumber}` : ""}:
${commentContext.prompt_comment_block}

Discipline: ${resolvedDiscipline}
Code reference(s): ${codeRefsDisplay}
${resolvedReviewer ? `Reviewer: ${resolvedReviewer}` : ""}

Important: If the current comment is short (e.g. "Please cloud corrections.") the full requirement is in the Previous comment section above. Base your response on ALL reviewer text provided, not only the short current line.

Retrieved project document evidence (${chunks.length} chunks, top similarity ${topSimilarity.toFixed(3)}):
${JSON.stringify(evidenceContext, null, 2)}

${evidenceWeak ? "NOTE: Retrieved evidence appears weak or sparse. Do not invent details; explain gaps clearly." : ""}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2048,
      response_format: { type: "json_object" },
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return jsonResponse({ error: "No response from AI" }, 500);
    }

    const parsed = JSON.parse(content) as {
      suggested_response?: string;
      required_action?: string;
      missing_info_or_risk?: string;
      confidence?: string;
      evidence?: GroundedEvidenceItem[];
    };

    let confidence = parsed.confidence ?? "medium";
    if (evidenceWeak && confidence === "high") confidence = "low";
    if (chunks.length === 0) confidence = "low";

    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((e) => e && typeof e === "object")
      : [];

    const result = {
      suggested_response: parsed.suggested_response ?? "",
      required_action: parsed.required_action ?? "",
      missing_info_or_risk: parsed.missing_info_or_risk ?? "",
      confidence,
      evidence,
      comment_id: commentId ?? null,
      project_id: ctx.projectId,
      retrieval: {
        chunk_count: chunks.length,
        top_similarity: topSimilarity,
        weak_evidence: evidenceWeak,
      },
    };

    if (commentId) {
      const sheetRef = evidence.find((e) => e.relevance === "high" && e.sheet_label)?.sheet_label
        ?? evidence.find((e) => e.sheet_label)?.sheet_label
        ?? null;

      await ctx.supabaseAdmin
        .from("parsed_comments")
        .update({
          response_text: result.suggested_response || null,
          sheet_reference: sheetRef,
          grounded_evidence: evidence,
          required_action: result.required_action || null,
          missing_info_or_risk: result.missing_info_or_risk || null,
          grounded_confidence: confidence,
          grounded_generated_at: new Date().toISOString(),
        })
        .eq("id", commentId)
        .eq("project_id", ctx.projectId);
    }

    return jsonResponse(result);
  } catch (error) {
    console.error("generate-grounded-response error:", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
