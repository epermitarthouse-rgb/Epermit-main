import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { serviceUserResponse } from "../_shared/serviceExecution.ts";
import { resolveServiceExecution } from "../_shared/serviceExecutionDeno.ts";
import { planRouting, type RouterRow } from "../_shared/commentProcessingStatus.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return new Response(
        JSON.stringify({ code: 500, message: "SUPABASE_URL or SUPABASE_ANON_KEY not configured", routed_count: 0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ code: 401, message: "Missing or invalid Authorization header", routed_count: 0 }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT", routed_count: 0 }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceAuth = await resolveServiceExecution(
      req,
      "auto-router-agent",
      (b) => b.projectId ?? b.project_id,
    );
    if ("error" in serviceAuth) {
      return new Response(
        JSON.stringify({ code: serviceAuth.status, message: serviceAuth.error, routed_count: 0 }),
        { status: serviceAuth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = serviceAuth.mode === "service"
      ? serviceUserResponse(serviceAuth.actingUserId)
      : await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT", routed_count: 0 }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const projectId = (body.projectId ?? body.project_id) as string | undefined;
    if (!projectId) {
      return new Response(
        JSON.stringify({ code: 400, message: "projectId is required", routed_count: 0 }),
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
        JSON.stringify({ code: 404, message: "Project not found or access denied", routed_count: 0 }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Writes go through the service client: a write under a signed-in user would be recorded as a human edit
    // (trg_parsed_comments_field_source, D-122). Ownership was checked above.
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const writer = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }) : supabase;

    const PAGE = 1000;
    const rows: RouterRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error: fetchError } = await writer
        .from("parsed_comments")
        .select("id, discipline, assigned_to, assigned_to_source, processing_status")
        .eq("project_id", projectId)
        .or("assigned_to.is.null,assigned_to.eq.,assigned_to_source.eq.project_ai")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (fetchError) {
        console.error("auto-router-agent: fetch error", fetchError);
        return new Response(
          JSON.stringify({ code: 500, message: fetchError.message, routed_count: 0 }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      rows.push(...((data ?? []) as RouterRow[]));
      if (!data || data.length < PAGE) break;
    }

    // Only classified rows are routed; unclassified ones stay pending and are reported (D-130).
    const plan = planRouting(rows);
    let routedCount = 0;
    let writeFailures = 0;
    for (const u of plan.updates) {
      const { error: updateError } = await writer.from("parsed_comments").update(u.patch).eq("id", u.id);
      if (updateError) writeFailures++;
      else if (u.patch.assigned_to) routedCount++;
    }

    return new Response(
      JSON.stringify({
        routed_count: routedCount,
        routing_summary: plan.summary,
        unrouted_unclassified: plan.unclassified,
        needs_attention: plan.needs_attention,
        write_failures: writeFailures,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("auto-router-agent:", error);
    return new Response(
      JSON.stringify({
        routed_count: 0,
        routing_summary: {},
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
