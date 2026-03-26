import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("shadow-metrics: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
      return jsonResponse({ code: 500, message: "Missing Supabase environment config" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    let projectId: string | undefined;
    try {
      const body = await req.json();
      projectId = (body?.project_id ?? body?.projectId) as string | undefined;
    } catch {
      console.error("shadow-metrics: failed to parse request body, continuing without projectId filter");
    }

    let predictionsQuery = supabase
      .from("shadow_predictions")
      .select("id, agent_name, match_status, confidence_score, project_id, created_at, prediction_data");
    if (projectId) predictionsQuery = predictionsQuery.eq("project_id", projectId);

    const { data: predictions, error: predErr } = await predictionsQuery;
    if (predErr) {
      console.error("shadow-metrics: predictions fetch error", JSON.stringify(predErr));
      return jsonResponse({ code: 500, message: `Predictions query failed: ${predErr.message}` }, 500);
    }

    const allPredictions = predictions ?? [];
    const totalPredictions = allPredictions.length;
    const matchCount = allPredictions.filter((p) => p.match_status === "match").length;
    const partialCount = allPredictions.filter((p) => p.match_status === "partial").length;
    const mismatchCount = allPredictions.filter((p) => p.match_status === "mismatch").length;
    const pendingCount = allPredictions.filter((p) => p.match_status === "pending").length;

    const actionableCount = matchCount + partialCount + mismatchCount;
    const overallAccuracy = actionableCount > 0
      ? Math.round(((matchCount + partialCount * 0.5) / actionableCount) * 1000) / 10
      : 0;

    const avgConfidence = totalPredictions > 0
      ? Math.round(
          (allPredictions.reduce((sum, p) => sum + (Number(p.confidence_score) || 0), 0) / totalPredictions) * 1000
        ) / 1000
      : 0;

    const agentMap = new Map<
      string,
      { predictions: number; matches: number; partials: number; mismatches: number; pending: number; totalConfidence: number }
    >();
    for (const p of allPredictions) {
      const name = p.agent_name ?? "Unknown";
      const entry = agentMap.get(name) ?? {
        predictions: 0, matches: 0, partials: 0, mismatches: 0, pending: 0, totalConfidence: 0,
      };
      entry.predictions++;
      if (p.match_status === "match") entry.matches++;
      else if (p.match_status === "partial") entry.partials++;
      else if (p.match_status === "mismatch") entry.mismatches++;
      else entry.pending++;
      entry.totalConfidence += Number(p.confidence_score) || 0;
      agentMap.set(name, entry);
    }

    const agentPerformance = Array.from(agentMap.entries()).map(([agent_name, stats]) => ({
      agent_name,
      predictions: stats.predictions,
      matches: stats.matches,
      partials: stats.partials,
      mismatches: stats.mismatches,
      pending: stats.pending,
      accuracy: (stats.matches + stats.partials + stats.mismatches) > 0
        ? Math.round(((stats.matches + stats.partials * 0.5) / (stats.matches + stats.partials + stats.mismatches)) * 1000) / 10
        : 0,
      avg_confidence: stats.predictions > 0
        ? Math.round((stats.totalConfidence / stats.predictions) * 1000) / 1000
        : 0,
    }));

    const totalBaselines = allPredictions.filter((p) => {
      const pd = (p.prediction_data as Record<string, unknown>)?.portal_discipline;
      return typeof pd === "string" && pd.trim() !== "";
    }).length;

    const uniqueDisciplines = new Set(
      allPredictions
        .map((p) => (p.prediction_data as Record<string, unknown>)?.portal_discipline)
        .filter((d): d is string => typeof d === "string" && d.trim() !== "")
        .map((d) => d.trim())
    ).size;

    const baselineCoverage = totalPredictions > 0
      ? Math.round((totalBaselines / totalPredictions) * 1000) / 10
      : 0;

    let auditQuery = supabase
      .from("audit_trail")
      .select("id, action_type, routing_decision, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (projectId) auditQuery = auditQuery.eq("project_id", projectId);

    const { data: recentAudit, error: auditErr } = await auditQuery;
    if (auditErr) {
      console.error("shadow-metrics: audit trail fetch error", JSON.stringify(auditErr));
    }

    let globalTotalComments = totalPredictions;
    let globalTotalProjects = new Set(allPredictions.map((p) => p.project_id)).size;

    if (projectId) {
      const { count: globalCount, error: gcErr } = await supabase
        .from("shadow_predictions")
        .select("id", { count: "exact", head: true });
      if (!gcErr && globalCount !== null) globalTotalComments = globalCount;

      const { data: globalProjectRows, error: gpErr } = await supabase
        .from("shadow_predictions")
        .select("project_id");
      if (!gpErr && globalProjectRows) {
        globalTotalProjects = new Set(globalProjectRows.map((r) => r.project_id)).size;
      }
    }

    const { data: baselineTimingRows, error: btErr } = await supabase
      .from("baseline_actions")
      .select("duration_minutes")
      .gt("duration_minutes", 0);
    if (btErr) {
      console.error("shadow-metrics: baseline timing fetch error", JSON.stringify(btErr));
    }
    const timingRows = baselineTimingRows ?? [];
    const totalTimedReviews = timingRows.length;
    const totalDurationMinutes = timingRows.reduce((sum, r) => sum + (Number(r.duration_minutes) || 0), 0);
    const avgTimePerComment = totalTimedReviews > 0
      ? Math.round((totalDurationMinutes / totalTimedReviews) * 100) / 100
      : 0;

    return jsonResponse({
      overall: {
        total_predictions: totalPredictions,
        matches: matchCount,
        partials: partialCount,
        mismatches: mismatchCount,
        pending: pendingCount,
        accuracy_percent: overallAccuracy,
        avg_confidence: avgConfidence,
      },
      agent_performance: agentPerformance,
      baseline: {
        total_baselines: totalBaselines,
        unique_disciplines: uniqueDisciplines,
        baseline_coverage_percent: baselineCoverage,
        total_timed_reviews: totalTimedReviews,
        avg_time_per_comment: avgTimePerComment,
      },
      validation_gate: {
        total_comments: globalTotalComments,
        total_projects: globalTotalProjects,
        comments_goal: 300,
        projects_goal: 30,
      },
      recent_audit: recentAudit ?? [],
    });
  } catch (error) {
    console.error("shadow-metrics: unhandled error", error instanceof Error ? error.stack : String(error));
    return jsonResponse(
      { code: 500, message: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
