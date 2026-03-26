import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ code: 500, message: "Missing Supabase config" }),
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

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const projectId = (body.project_id ?? body.projectId) as string | undefined;
    if (!projectId) {
      return new Response(
        JSON.stringify({ code: 400, message: "project_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: project } = await supabaseAuth
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single();
    if (!project || project.user_id !== user.id) {
      return new Response(
        JSON.stringify({ code: 404, message: "Project not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: comments, error: fetchError } = await supabase
      .from("parsed_comments")
      .select("id, response_text, status")
      .eq("project_id", projectId);

    if (fetchError) {
      console.error("validate-completeness-agent: fetch error", fetchError);
      return new Response(
        JSON.stringify({ code: 500, message: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rows = (comments ?? []) as { id: string; response_text: string | null; status: string | null }[];
    const total = rows.length;

    const missing: string[] = [];
    let responded = 0;
    for (const row of rows) {
      const hasResponse = row.response_text != null && String(row.response_text).trim() !== "";
      const statusOk =
        (row.status ?? "").toLowerCase() === "ready for review" ||
        (row.status ?? "").toLowerCase() === "approved";
      if (hasResponse && statusOk) {
        responded++;
      } else {
        missing.push(row.id);
      }
    }
    const pending = total - responded;

    const complete = pending === 0;

    return new Response(
      JSON.stringify({
        complete,
        stats: { total, responded, pending },
        missing,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("validate-completeness-agent:", error);
    return new Response(
      JSON.stringify({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
