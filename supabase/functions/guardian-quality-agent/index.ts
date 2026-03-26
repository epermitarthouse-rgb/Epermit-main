import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHUNK_SIZE = 25;
const MAX_TOKENS = 8192;

const SYSTEM_INSTRUCTION = `You are a permit plan review response QA reviewer. Score each response for adequacy and compliance. Flag vague, incomplete, off-topic, or contradictory responses.

For each item you receive, return an object with:
- id: the exact comment id from the input
- score: number 1-10 (10 = fully adequate, addresses comment, cites code if needed)
- flags: array of zero or more of: "vague", "incomplete", "not_addressed", "code_missing", "inconsistent", "needs_sheet_ref", "wrong_discipline", "other"
- notes: short explanation (1-2 sentences)
- suggested_improvement: 1-3 sentence improved response, or empty string if no change needed

Return ONLY valid JSON in this exact shape (no markdown):
{
  "results": [ { "id": "...", "score": number, "flags": [], "notes": "...", "suggested_improvement": "..." } ],
  "summary": { "avg_score": number, "flagged_count": number, "top_issues": ["..."] }
}`;

interface CommentRow {
  id: string;
  discipline: string | null;
  original_text: string;
  response_text: string;
  code_reference: string | null;
  sheet_reference: string | null;
  status: string | null;
  assigned_to: string | null;
}

interface LLMResultItem {
  id: string;
  score: number;
  flags: string[];
  notes: string;
  suggested_improvement: string;
}

interface LLMChunkResponse {
  results?: LLMResultItem[];
  summary?: { avg_score?: number; flagged_count?: number; top_issues?: string[] };
}

function parseLLMResponse(text: string): LLMChunkResponse | null {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed) as LLMChunkResponse;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!OPENAI_API_KEY || !supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ code: 500, message: "Missing config", project_id: null, results: [], summary: { avg_score: 0, flagged_count: 0, top_issues: [] } });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ code: 401, message: "Missing or invalid Authorization" }, 401);
    }
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ code: 401, message: "Invalid JWT" }, 401);

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ code: 401, message: "Invalid JWT" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const projectId = (body.project_id ?? body.projectId) as string | undefined;
    if (!projectId) {
      return jsonResponse({ code: 400, message: "project_id is required" }, 400);
    }

    const { data: project } = await supabaseAuth
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single();
    if (!project || project.user_id !== user.id) {
      return jsonResponse({ code: 404, message: "Project not found or access denied" }, 404);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: comments, error: fetchError } = await supabase
      .from("parsed_comments")
      .select("id, discipline, original_text, response_text, code_reference, sheet_reference, status, assigned_to")
      .eq("project_id", projectId)
      .not("response_text", "is", null);

    if (fetchError) {
      console.error("guardian-quality-agent: fetch error", fetchError);
      return jsonResponse({
        code: 500,
        message: fetchError.message,
        project_id: projectId,
        results: [],
        summary: { avg_score: 0, flagged_count: 0, top_issues: [] },
      });
    }

    const rows = (comments ?? []) as CommentRow[];
    const withResponse = rows.filter((r) => r.response_text != null && String(r.response_text).trim() !== "");
    if (withResponse.length === 0) {
      const payload = {
        project_id: projectId,
        results: [],
        summary: { avg_score: 0, flagged_count: 0, top_issues: ["No comments with responses to review."] },
      };
      await supabase.from("comment_quality_checks").insert({
        project_id: projectId,
        created_by: user.id,
        avg_score: 0,
        flagged_count: 0,
        results: payload.results,
      });
      return jsonResponse({ ...payload, complete: true });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const allResults: LLMResultItem[] = [];
    const allTopIssues: string[] = [];

    for (let i = 0; i < withResponse.length; i += CHUNK_SIZE) {
      const chunk = withResponse.slice(i, i + CHUNK_SIZE);
      const userPayload = chunk.map((c) => ({
        id: c.id,
        discipline: c.discipline ?? "",
        comment: c.original_text,
        code_reference: c.code_reference ?? "",
        response_text: c.response_text,
        sheet_ref: c.sheet_reference ?? "",
      }));

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        max_tokens: MAX_TOKENS,
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        allResults.push(...chunk.map((c) => ({ id: c.id, score: 5, flags: ["other"], notes: "No LLM output", suggested_improvement: "" })));
        continue;
      }

      const parsed = parseLLMResponse(content);
      if (parsed?.results && Array.isArray(parsed.results)) {
        allResults.push(...parsed.results);
        if (parsed.summary?.top_issues?.length) {
          allTopIssues.push(...parsed.summary.top_issues);
        }
      } else {
        allResults.push(...chunk.map((c) => ({ id: c.id, score: 5, flags: ["other"], notes: "Parse error", suggested_improvement: "" })));
      }
    }

    const total = allResults.length;
    const sumScore = allResults.reduce((s, r) => s + (typeof r.score === "number" ? r.score : 0), 0);
    const avgScore = total > 0 ? Math.round((sumScore / total) * 10) / 10 : 0;
    const flaggedCount = allResults.filter((r) => r.flags && r.flags.length > 0).length;
    const topIssues = [...new Set(allTopIssues)].slice(0, 5);

    const payload = {
      project_id: projectId,
      results: allResults,
      summary: { avg_score: avgScore, flagged_count: flaggedCount, top_issues: topIssues },
    };

    const { error: insertErr } = await supabase.from("comment_quality_checks").insert({
      project_id: projectId,
      created_by: user.id,
      avg_score: avgScore,
      flagged_count: flaggedCount,
      results: payload.results,
    });
    if (insertErr) console.warn("guardian-quality-agent: insert check row failed", insertErr);

    return jsonResponse({ ...payload, complete: true });
  } catch (error) {
    console.error("guardian-quality-agent:", error);
    return jsonResponse({
      code: 500,
      message: error instanceof Error ? error.message : "Unknown error",
      project_id: null,
      results: [],
      summary: { avg_score: 0, flagged_count: 0, top_issues: [] },
    });
  }
});
