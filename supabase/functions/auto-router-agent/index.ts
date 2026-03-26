import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISCIPLINE_ROUTING: Record<string, string> = {
  Structural: "Structural Engineer",
  Architectural: "Project Architect",
  "Mechanical/HVAC": "MEP Engineer",
  Mechanical: "MEP Engineer",
  Electrical: "MEP Engineer",
  Plumbing: "MEP Engineer",
  "Fire Protection": "Fire Protection Engineer",
  Fire: "Fire Protection Engineer",
  Civil: "Civil Engineer",
  Zoning: "Zoning Specialist",
  Environmental: "Environmental Consultant",
  "Green/Energy": "Energy Consultant",
  Energy: "Energy Consultant",
  Administrative: "Project Manager",
  Other: "Project Manager",
};

const DEFAULT_ASSIGNEE = "Project Manager";

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

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
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

    const { data: rows, error: fetchError } = await supabase
      .from("parsed_comments")
      .select("id, discipline")
      .eq("project_id", projectId)
      .or("assigned_to.is.null,assigned_to.eq.")
      .limit(500);

    if (fetchError) {
      console.error("auto-router-agent: fetch error", fetchError);
      return new Response(
        JSON.stringify({ code: 500, message: fetchError.message, routed_count: 0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const comments = (rows ?? []) as { id: string; discipline: string | null }[];
    if (comments.length === 0) {
      return new Response(
        JSON.stringify({ routed_count: 0, routing_summary: {} }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const routing_summary: Record<string, number> = {};
    let routedCount = 0;

    for (const row of comments) {
      const discipline = (row.discipline ?? "").trim();
      const assignee = discipline ? (DISCIPLINE_ROUTING[discipline] ?? DEFAULT_ASSIGNEE) : DEFAULT_ASSIGNEE;
      routing_summary[assignee] = (routing_summary[assignee] ?? 0) + 1;

      const { error: updateError } = await supabase
        .from("parsed_comments")
        .update({ assigned_to: assignee })
        .eq("id", row.id);

      if (!updateError) routedCount++;
    }

    return new Response(
      JSON.stringify({ routed_count: routedCount, routing_summary }),
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
