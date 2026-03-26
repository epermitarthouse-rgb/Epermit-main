import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISCIPLINE_ENUM = [
  "Architectural",
  "Structural",
  "Mechanical",
  "Electrical",
  "Plumbing",
  "Fire",
  "Civil",
  "Energy",
  "Zoning",
  "Environmental",
  "Administrative",
  "Other",
] as const;

type Discipline = (typeof DISCIPLINE_ENUM)[number];

function isDiscipline(s: string): s is Discipline {
  return (DISCIPLINE_ENUM as readonly string[]).includes(s);
}

const BATCH_SIZE = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ code: 500, message: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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
    console.log("Authorization header present, validating JWT");

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
    console.log("JWT validated, user.id:", user.id);

    const adminClient = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey)
      : supabase;

    const body = await req.json().catch(() => ({}));
    const projectId = body.project_id as string | undefined;
    const batchLimit = typeof body.batch_limit === "number" && body.batch_limit > 0
      ? Math.min(body.batch_limit, 200)
      : BATCH_SIZE;

    let isShadowMode = false;

    if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("id, user_id, is_shadow_mode")
        .eq("id", projectId)
        .single();
      if (!project || project.user_id !== user.id) {
        return new Response(
          JSON.stringify({ code: 404, message: "Project not found or access denied" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      isShadowMode = project.is_shadow_mode === true;
      console.log("discipline-classifier: shadow_mode =", isShadowMode, "for project", projectId);
    }

    const projectIdsResult = await supabase.from("projects").select("id").eq("user_id", user.id);
    const projectIds = (projectIdsResult.data ?? []).map((p: { id: string }) => p.id);
    if (projectIds.length === 0) {
      return new Response(
        JSON.stringify({ classified_count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const projectFilter = projectId ? [projectId] : projectIds;

    const query = adminClient
      .from("parsed_comments")
      .select("id, original_text, project_id, discipline")
      .in("project_id", projectFilter)
      .or("discipline.is.null,discipline.eq.General,discipline.eq.Unclassified")
      .eq("status", "Pending")
      .limit(batchLimit);

    console.log("[DEBUG] discipline-classifier query (adminClient): filter=(discipline IS NULL OR discipline='General' OR discipline='Unclassified'), status=Pending, project_id in", projectFilter.length, "projects, limit=", batchLimit, "shadow_mode=", isShadowMode);

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      console.error("Fetch parsed_comments error:", fetchError);
      return new Response(
        JSON.stringify({ code: 500, message: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const comments = (rows ?? []) as { id: string; original_text: string; project_id: string; discipline: string | null }[];
    console.log("[DEBUG] discipline-classifier: filtered query returned rows:", comments.length);

    if (comments.length === 0) {
      const { data: allRows, error: allErr } = await adminClient
        .from("parsed_comments")
        .select("id, discipline, status")
        .in("project_id", projectFilter)
        .limit(50);
      const allComments = allRows ?? [];
      console.log("[DEBUG] discipline-classifier: UNFILTERED query returned:", allComments.length, "rows");
      if (allComments.length > 0) {
        const disciplineBreakdown: Record<string, number> = {};
        const statusBreakdown: Record<string, number> = {};
        for (const r of allComments as { discipline: string | null; status: string | null }[]) {
          const d = r.discipline ?? "null";
          const s = r.status ?? "null";
          disciplineBreakdown[d] = (disciplineBreakdown[d] || 0) + 1;
          statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
        }
        console.log("[DEBUG] discipline breakdown:", JSON.stringify(disciplineBreakdown));
        console.log("[DEBUG] status breakdown:", JSON.stringify(statusBreakdown));
      }
      return new Response(
        JSON.stringify({ classified_count: 0, debug_total_comments: allComments.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const systemPrompt = `Classify each building permit review comment into exactly one discipline and provide a confidence score.

Available disciplines and what they cover:

- Structural: Load-bearing elements, foundations, framing, steel, concrete, structural calculations, wind/seismic design, IBC Chapter 16-23

- Architectural: Building envelope, egress, accessibility (ADA), room layouts, finishes, doors/windows, fire-rated assemblies, IBC Chapters 3-12

- Mechanical: Heating, cooling, ventilation, ductwork, IMC code references (use "Mechanical" for HVAC)

- Electrical: Power distribution, lighting, panels, NEC code references, electrical load calculations

- Plumbing: Water supply, drainage, fixtures, IPC code references

- Fire: Sprinklers, fire alarms, smoke detectors, fire suppression, NFPA references

- Civil: Site work, grading, stormwater, surveyor's plat, erosion control, utilities, site plans

- Zoning: Setbacks, lot coverage, FAR, height limits, use permits, zoning code references, variances

- Environmental: Lead abatement, asbestos, hazardous materials, DOEE permits, EPA requirements, environmental surveys, contamination

- Energy: Energy code compliance, IECC, green building requirements, insulation, energy modeling (use "Energy" for green/energy)

- Administrative: Document formatting, missing submissions, permit fees, application completeness, signatures, stamps, certifications

- Other: ONLY use this if the comment truly doesn't fit any category above. Most comments SHOULD fit into one of the specific disciplines.

IMPORTANT: Prefer specific disciplines over 'Other'. For example:
- Lead abatement → Environmental (not Other)
- Asbestos survey → Environmental (not Other)
- Cost estimate upload → Administrative (not Other)
- Surveyor's plat → Civil
- Demo permit → Administrative or Environmental depending on context
- DOEE permit → Environmental

Return a JSON object with a single key "classifications": an array of objects with:
- "index" (0-based position in the list)
- "discipline" (exactly one of: Architectural, Structural, Mechanical, Electrical, Plumbing, Fire, Civil, Energy, Zoning, Environmental, Administrative, Other)
- "confidence_score" (a numeric value between 0.00 and 1.00 indicating your certainty in the classification. Use 0.95+ for clear-cut cases, 0.70-0.94 for likely matches, and below 0.70 for uncertain/ambiguous comments)

One object per comment in the same order as provided.`;

    const userContent = comments.map((c, i) => `[${i}] ${c.original_text}`).join("\n\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 2048,
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(
        JSON.stringify({ code: 500, message: "No response from model", classified_count: 0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let data: { classifications?: { index: number; discipline: string; confidence_score?: number }[] };
    try {
      data = JSON.parse(content);
    } catch {
      return new Response(
        JSON.stringify({ code: 500, message: "Invalid JSON from model", classified_count: 0 }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const classifications = Array.isArray(data.classifications) ? data.classifications : [];
    let classifiedCount = 0;
    let shadowLoggedCount = 0;
    let otherCount = 0;

    for (const c of classifications) {
      const i = c.index;
      if (i < 0 || i >= comments.length) continue;

      const row = comments[i];
      const discipline = isDiscipline(c.discipline) ? c.discipline : "Other";
      const confidenceScore = typeof c.confidence_score === "number"
        ? Math.max(0, Math.min(1, c.confidence_score))
        : 0.5;

      if (discipline === "Other") otherCount++;

      // STEP 1: ALWAYS update parsed_comments with the classified discipline
      const { error: updateError } = await adminClient
        .from("parsed_comments")
        .update({ discipline })
        .eq("id", row.id);

      // STEP 2: Increment count on success
      if (!updateError) {
        classifiedCount++;
      } else {
        console.warn("parsed_comments update failed for comment", row.id, updateError.message);
      }

      // STEP 3: If shadow mode, ADDITIONALLY log to shadow_predictions
      if (isShadowMode) {
        const matchStatus = "match";
        try {
          const { error: shadowErr } = await adminClient
            .from("shadow_predictions")
            .insert({
              project_id: row.project_id,
              comment_id: row.id,
              agent_name: "Discipline Classifier",
              prediction_data: {
                ai_discipline: discipline,
                assigned_discipline: discipline,
              },
              confidence_score: confidenceScore,
              match_status: matchStatus,
            });
          if (shadowErr) {
            console.warn("shadow_predictions insert failed for comment", row.id, shadowErr.message);
          } else {
            shadowLoggedCount++;
          }
        } catch (err) {
          console.warn("shadow_predictions insert exception for comment", row.id, err);
        }
      }

      // STEP 4: Audit trail — record whether this was live or shadow
      try {
        const routingDecision = isShadowMode ? "shadow_logged" : "live_update";
        const auditPayload: Record<string, unknown> = {
          project_id: row.project_id,
          actor_id: "Discipline Classifier",
          action_type: "classification",
          routing_decision: routingDecision,
          input_hash: row.id,
        };
        if (isShadowMode) {
          auditPayload.routing_decision = "shadow_match";
        }
        const { error: auditErr } = await adminClient
          .from("audit_trail")
          .insert(auditPayload);
        if (auditErr) {
          console.warn("audit_trail insert failed for comment", row.id, auditErr.message);
        }
      } catch (err) {
        console.warn("audit_trail insert exception for comment", row.id, err);
      }
    }

    if (classifications.length > 0 && otherCount / classifications.length > 0.5) {
      console.log("[WARN] Over 50% classified as Other — prompt may need tuning");
    }

    const mode = isShadowMode ? "shadow" : "live";
    console.log(`discipline-classifier [${mode}]: classified=${classifiedCount}, shadow_logged=${shadowLoggedCount}`);

    return new Response(
      JSON.stringify({
        classified_count: classifiedCount,
        shadow_logged_count: shadowLoggedCount,
        mode,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in discipline-classifier-agent:", error);
    return new Response(
      JSON.stringify({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
