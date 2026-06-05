import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.28.0";
import { buildGroundedCommentContext } from "../_shared/groundedCommentContext.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const discipline = String(body.discipline ?? "General").trim();
    const codeReference = String(body.code_reference ?? body.codeReference ?? "").trim();
    const codeRefs = body.code_references ?? body.codeReferences;

    const commentContext = buildGroundedCommentContext({
      original_text: body.comment_text ?? body.commentText,
      previous_comment_text: body.previous_comment_text ?? body.previousCommentText,
      existing_response_text: body.existing_response_text ?? body.existingResponseText,
      discipline,
      code_reference: codeReference,
      code_references: Array.isArray(codeRefs) ? codeRefs : typeof codeRefs === "string" ? codeRefs : undefined,
      reviewer_name: body.reviewer_name ?? body.reviewerName,
      comment_number: body.comment_number ?? body.commentNumber,
    });

    if (!commentContext.has_substantive_content) {
      return new Response(
        JSON.stringify({ error: "comment_text or previous_comment_text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const codeRefsDisplay = commentContext.code_references.length > 0
      ? commentContext.code_references.join(", ")
      : "No code reference provided.";

    const systemPrompt = `You are a Senior Architect preparing official responses to city/jurisdiction permit comments.
- If the comment is about a code violation or design requirement, draft a polite, professional, technical response that confirms compliance and cites the relevant code or drawing.
- Keep responses concise (1-3 sentences). Use "we" and passive voice where appropriate (e.g. "The door swing has been revised...").
- When a code is referenced, cite it in the response (e.g. "per IBC 1008.1").
- If a sheet or drawing is relevant, include a placeholder like "See Sheet A2.1" or "Refer to Sheet ___" so the architect can fill in the exact reference.
- Do not invent code sections; if no code is provided, describe the fix in general terms.
- When a short current comment is provided with a Previous comment section, base your response on the full previous reviewer requirement.
- Return ONLY a JSON object with a single key "suggested_response" whose value is the response string. No markdown, no explanation.`;

    const userPrompt = `Reviewer comment:
${commentContext.prompt_comment_block}

Discipline: ${discipline}
Code reference(s): ${codeRefsDisplay}

Draft the architect's official response. Return JSON only: {"suggested_response": "..."}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 512,
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(
        JSON.stringify({ error: "No response from AI model" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let data: { suggested_response?: string };
    try {
      data = JSON.parse(content);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON from AI model" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const suggested_response =
      typeof data.suggested_response === "string" ? data.suggested_response : "";

    return new Response(
      JSON.stringify({ suggested_response }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in generate-response:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
