import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.28.0";

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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const body = await req.json().catch(() => ({}));
    const comment_text = (body.comment_text as string) || "";
    const code_reference = (body.code_reference as string) || "";
    const discipline = (body.discipline as string) || "General";

    if (!comment_text.trim()) {
      return new Response(
        JSON.stringify({ error: "comment_text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a Senior Architect preparing official responses to city/jurisdiction permit comments.
- If the comment is about a code violation or design requirement, draft a polite, professional, technical response that confirms compliance and cites the relevant code or drawing.
- Keep responses concise (1-3 sentences). Use "we" and passive voice where appropriate (e.g. "The door swing has been revised...").
- When a code is referenced, cite it in the response (e.g. "per IBC 1008.1").
- If a sheet or drawing is relevant, include a placeholder like "See Sheet A2.1" or "Refer to Sheet ___" so the architect can fill in the exact reference.
- Do not invent code sections; if no code is provided, describe the fix in general terms.
- Return ONLY a JSON object with a single key "suggested_response" whose value is the response string. No markdown, no explanation.`;

    const userPrompt = `Comment from city: "${comment_text}"
Discipline: ${discipline}
${code_reference ? `Code reference: ${code_reference}` : "No code reference provided."}

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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let data: { suggested_response?: string };
    try {
      data = JSON.parse(content);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON from AI model" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const suggested_response =
      typeof data.suggested_response === "string" ? data.suggested_response : "";

    return new Response(
      JSON.stringify({ suggested_response }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in generate-response:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
