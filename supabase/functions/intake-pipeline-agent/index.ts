import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PARSER_TIMEOUT_MS = 60_000;
const CLASSIFIER_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(
  url: string,
  options: Omit<RequestInit, "signal"> & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = PARSER_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  console.log("[intake-pipeline] start");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return new Response(
        JSON.stringify({ code: 500, message: "SUPABASE_URL or SUPABASE_ANON_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ code: 401, message: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn("JWT validation failed:", userError?.message ?? "No user");
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const body = await req.json().catch(() => ({}));
    const projectId = body.project_id as string | undefined;
    const cursor = body.cursor as { pdfIndex?: number } | undefined;
    const parserTimeout = (body.parser_timeout_ms as number | undefined) ?? PARSER_TIMEOUT_MS;
    const classifierTimeout = (body.classifier_timeout_ms as number | undefined) ?? CLASSIFIER_TIMEOUT_MS;
    console.log("[intake-pipeline] project_id:", projectId ?? "(missing)", "user.id:", user.id, "cursor:", cursor ?? "none");

    if (!projectId) {
      return new Response(
        JSON.stringify({ code: 400, message: "project_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": authHeader,
      "apikey": anonKey,
    };

    type ParserResult = {
      parsed_count?: number;
      skipped_count?: number;
      insert_error_count?: number;
      error?: string;
      code?: number;
      next_cursor?: { pdfIndex: number };
      done?: boolean;
      total_pdfs?: number;
    };

    let commentParserResult: ParserResult = {};
    const parserStart = Date.now();
    console.log("[intake-pipeline] comment-parser start");
    try {
      const commentParserRes = await fetchWithTimeout(`${baseUrl}/comment-parser-agent`, {
        method: "POST",
        headers,
        body: JSON.stringify({ project_id: projectId, cursor, max_pdfs: 2 }),
        timeoutMs: parserTimeout,
      });
      const commentParserText = await commentParserRes.text();
      const bodyPreview = commentParserText.slice(0, 200);
      console.log("[intake-pipeline] comment-parser end status=" + commentParserRes.status + " bodyPreview=" + bodyPreview);

      let commentParserJson: Record<string, unknown> = {};
      try {
        commentParserJson = commentParserText ? JSON.parse(commentParserText) : {};
      } catch (parseErr) {
        console.warn("comment-parser response not JSON:", parseErr);
      }
      if (!commentParserRes.ok) {
        commentParserResult = {
          error: (commentParserJson.message ?? commentParserJson.error ?? commentParserRes.statusText) as string,
          code: (commentParserJson.code as number) ?? commentParserRes.status,
        };
      } else {
        commentParserResult = {
          parsed_count: (commentParserJson.parsed_count as number) ?? 0,
          skipped_count: (commentParserJson.skipped_count as number) ?? 0,
          insert_error_count: (commentParserJson.insert_error_count as number) ?? 0,
          next_cursor: commentParserJson.next_cursor as { pdfIndex: number } | undefined,
          done: commentParserJson.done === true,
          total_pdfs: commentParserJson.total_pdfs as number | undefined,
        };
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      commentParserResult = { error: isTimeout ? "timeout" : (err instanceof Error ? err.message : "Unknown error"), done: false };
      console.log("[intake-pipeline] comment-parser timeout or error:", isTimeout ? "timeout" : err);
    }
    console.log("[intake-pipeline] comment-parser duration ms:", Date.now() - parserStart);

    let disciplineClassifierResult: { classified_count?: number; error?: string; code?: number } = {};
    const parserDone = commentParserResult.done === true && !commentParserResult.error;

    if (parserDone) {
      const classifierStart = Date.now();
      console.log("[intake-pipeline] discipline-classifier start");
      try {
        const disciplineClassifierRes = await fetchWithTimeout(`${baseUrl}/discipline-classifier-agent`, {
          method: "POST",
          headers,
          body: JSON.stringify({ project_id: projectId }),
          timeoutMs: classifierTimeout,
        });
        const disciplineClassifierText = await disciplineClassifierRes.text();
        const bodyPreview = disciplineClassifierText.slice(0, 200);
        console.log("[intake-pipeline] discipline-classifier end status=" + disciplineClassifierRes.status + " bodyPreview=" + bodyPreview);

        let disciplineClassifierJson: Record<string, unknown> = {};
        try {
          disciplineClassifierJson = disciplineClassifierText ? JSON.parse(disciplineClassifierText) : {};
        } catch (parseErr) {
          console.warn("discipline-classifier response not JSON:", parseErr);
        }
        if (!disciplineClassifierRes.ok) {
          disciplineClassifierResult = {
            error: (disciplineClassifierJson.message ?? disciplineClassifierJson.error ?? disciplineClassifierRes.statusText) as string,
            code: (disciplineClassifierJson.code as number) ?? disciplineClassifierRes.status,
          };
        } else {
          disciplineClassifierResult = { classified_count: (disciplineClassifierJson.classified_count as number) ?? 0 };
        }
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        disciplineClassifierResult = { error: isTimeout ? "timeout" : (err instanceof Error ? err.message : "Unknown error") };
        console.warn("[intake-pipeline] discipline-classifier failed:", isTimeout ? "timeout" : err);
      }
      console.log("[intake-pipeline] discipline-classifier duration ms:", Date.now() - classifierStart);
    }

    console.log("[intake-pipeline] total duration ms:", Date.now() - startTime);

    const classifierOk = !disciplineClassifierResult.error;
    const next_action =
      !parserDone || commentParserResult.error
        ? "poll_again"
        : classifierOk
          ? "complete"
          : "retry_classifier";

    return new Response(
      JSON.stringify({
        project_id: projectId,
        comment_parser: commentParserResult,
        discipline_classifier: disciplineClassifierResult,
        next_action,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[intake-pipeline] error:", error);
    return new Response(
      JSON.stringify({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
