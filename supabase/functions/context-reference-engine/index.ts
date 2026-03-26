import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 20;

const SYSTEM_PROMPT = `You are a building code expert. For each permit review comment, extract:
1. code_reference: The specific code section referenced or most relevant 
   (e.g., 'IBC 1605.2', 'DCMR 12-A 3201', 'NEC 210.12', 'NFPA 13'). 
   If no code is explicitly mentioned, infer the most likely applicable code.
2. suggested_response: A professional draft response that an architect/engineer 
   would give to address this comment (2-3 sentences max).

Return ONLY a JSON array with objects matching the input order:
[{ "code_reference": "...", "suggested_response": "..." }, ...]`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ code: 500, message: "OpenAI API key not configured", enriched_count: 0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return new Response(
        JSON.stringify({ code: 500, message: "SUPABASE_URL or SUPABASE_ANON_KEY not configured", enriched_count: 0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ code: 401, message: "Missing or invalid Authorization header", enriched_count: 0 }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT", enriched_count: 0 }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT", enriched_count: 0 }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const projectId = (body.projectId ?? body.project_id) as string | undefined;
    if (!projectId) {
      return new Response(
        JSON.stringify({ code: 400, message: "projectId is required", enriched_count: 0 }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single();
    if (!project || project.user_id !== user.id) {
      return new Response(
        JSON.stringify({ code: 404, message: "Project not found or access denied", enriched_count: 0 }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: rows, error: fetchError } = await supabase
      .from("parsed_comments")
      .select("id, original_text, discipline, code_reference, response_text")
      .eq("project_id", projectId)
      .or("code_reference.is.null,code_reference.eq.")
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("context-reference-engine: fetch error", fetchError);
      return new Response(
        JSON.stringify({ code: 500, message: fetchError.message, enriched_count: 0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const comments = (rows ?? []) as { id: string; original_text: string; discipline: string | null; code_reference: string | null; response_text: string | null }[];
    if (comments.length === 0) {
      return new Response(
        JSON.stringify({ enriched_count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userMessage = JSON.stringify(
      comments.map((c) => ({ id: c.id, original_text: c.original_text, discipline: c.discipline ?? "" }))
    );

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 4096,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return new Response(
        JSON.stringify({ enriched_count: 0, error: "No response from model" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let parsed: { code_reference?: string; suggested_response?: string }[];
    try {
      const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
      parsed = JSON.parse(trimmed) as { code_reference?: string; suggested_response?: string }[];
      if (!Array.isArray(parsed)) parsed = [];
    } catch (e) {
      console.error("context-reference-engine: bad JSON from LLM", e);
      return new Response(
        JSON.stringify({ enriched_count: 0, error: "Invalid JSON from model" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let enrichedCount = 0;
    for (let i = 0; i < comments.length && i < parsed.length; i++) {
      const row = comments[i];
      const out = parsed[i];
      const codeRef = typeof out?.code_reference === "string" ? out.code_reference.trim() : null;
      const suggested = typeof out?.suggested_response === "string" ? out.suggested_response.trim() : null;
      const setResponse = suggested && (!row.response_text || !row.response_text.trim());

      const updates: { code_reference: string | null; response_text?: string | null } = {
        code_reference: codeRef || null,
      };
      if (setResponse) updates.response_text = suggested;

      const { error: updateError } = await supabase
        .from("parsed_comments")
        .update(updates)
        .eq("id", row.id);

      if (!updateError) enrichedCount++;
    }

    return new Response(
      JSON.stringify({ enriched_count: enrichedCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("context-reference-engine:", error);
    return new Response(
      JSON.stringify({
        enriched_count: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
