import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export interface ParsedCommentItem {
  original_text: string;
  discipline: string;
  code_reference: string | null;
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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const body = await req.json().catch(() => ({}));
    const imageBase64 = body.imageBase64 as string | undefined;
    const imageType = (body.imageType as string) || "image/png";
    const pageNumber = typeof body.pageNumber === "number" ? body.pageNumber : 1;

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "imageBase64 is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are an expert Permit Expeditor. Your specific task:
1. Read this image of a permit comment letter (from a city or jurisdiction).
2. Extract every individual comment row or bullet point.
3. For each comment, classify the 'Discipline' using exactly one of: Architecture, MEP, Structural, Zoning, Fire. Use "MEP" for mechanical/electrical/plumbing.
4. Extract the 'Code Reference' if visible (e.g. "IBC 1004.3", "NFPA 101", "IRC R302.5"). If not visible, use null.
5. Return a JSON object with a single key "comments" whose value is an array of objects. Each object must have: "original_text" (string, the exact or summarized comment text), "discipline" (string, one of the five above), "code_reference" (string or null).

Return ONLY valid JSON. No markdown, no explanation. Example format:
{"comments":[{"original_text":"Provide 1-hour fire rating for corridor wall","discipline":"Fire","code_reference":"IBC 708.4"},{"original_text":"Show accessible route to entrance","discipline":"Architecture","code_reference":"IBC 1103.2"}]}`;

    const userPrompt = "Extract all permit comments from this image and classify each as specified. Return the JSON object only.";

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
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
    if (!content) {
      return new Response(
        JSON.stringify({ error: "No response from AI model" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let data: { comments?: ParsedCommentItem[] };
    try {
      data = JSON.parse(content);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON from AI model" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const comments = Array.isArray(data.comments) ? data.comments : [];
    const normalized = comments.map((c: Record<string, unknown>) => ({
      original_text: typeof c.original_text === "string" ? c.original_text : String(c.original_text ?? ""),
      discipline: typeof c.discipline === "string" ? c.discipline : "Architecture",
      code_reference: typeof c.code_reference === "string" ? c.code_reference : null,
    }));

    return new Response(
      JSON.stringify({ comments: normalized, page_number: pageNumber }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in parse-permit-comments:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
