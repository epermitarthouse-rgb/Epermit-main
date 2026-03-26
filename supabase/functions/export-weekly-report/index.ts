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
      // no body
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from("shadow_predictions")
      .select("id, agent_name, match_status, confidence_score, project_id, created_at, prediction_data, comment_id, parsed_comments(original_text)")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);

    const { data: predictions, error: predErr } = await query;
    if (predErr) {
      return jsonResponse({ code: 500, message: `Query failed: ${predErr.message}` }, 500);
    }

    const rows = predictions ?? [];
    const totalPredictions = rows.length;
    const matchCount = rows.filter((p) => p.match_status === "match").length;
    const partialCount = rows.filter((p) => p.match_status === "partial").length;
    const mismatchCount = rows.filter((p) => p.match_status === "mismatch").length;
    const pendingCount = rows.filter((p) => p.match_status === "pending" || !p.match_status).length;
    const actionableCount = matchCount + partialCount + mismatchCount;
    const overallAccuracy = actionableCount > 0
      ? Math.round(((matchCount + partialCount * 0.5) / actionableCount) * 1000) / 10
      : 0;
    const avgConfidence = totalPredictions > 0
      ? Math.round((rows.reduce((s, p) => s + (Number(p.confidence_score) || 0), 0) / totalPredictions) * 1000) / 10
      : 0;

    const agentMap = new Map<string, {
      predictions: number; matches: number; partials: number; mismatches: number; pending: number; totalConf: number;
    }>();
    for (const p of rows) {
      const name = p.agent_name ?? "Unknown";
      const e = agentMap.get(name) ?? { predictions: 0, matches: 0, partials: 0, mismatches: 0, pending: 0, totalConf: 0 };
      e.predictions++;
      if (p.match_status === "match") e.matches++;
      else if (p.match_status === "partial") e.partials++;
      else if (p.match_status === "mismatch") e.mismatches++;
      else e.pending++;
      e.totalConf += Number(p.confidence_score) || 0;
      agentMap.set(name, e);
    }

    const agentBreakdowns = Array.from(agentMap.entries()).map(([name, s]) => {
      const actionable = s.matches + s.partials + s.mismatches;
      return {
        agent_name: name,
        predictions: s.predictions,
        matches: s.matches,
        partials: s.partials,
        mismatches: s.mismatches,
        pending: s.pending,
        accuracy: actionable > 0 ? Math.round(((s.matches + s.partials * 0.5) / actionable) * 1000) / 10 : 0,
        avg_confidence: s.predictions > 0 ? Math.round((s.totalConf / s.predictions) * 1000) / 10 : 0,
      };
    });

    const totalBaselines = rows.filter((p) => {
      const pd = (p.prediction_data as Record<string, unknown>)?.portal_discipline;
      return typeof pd === "string" && pd.trim() !== "";
    }).length;
    const uniqueDisciplines = new Set(
      rows.map((p) => (p.prediction_data as Record<string, unknown>)?.portal_discipline)
        .filter((d): d is string => typeof d === "string" && d.trim() !== "")
    ).size;
    const baselineCoverage = totalPredictions > 0 ? Math.round((totalBaselines / totalPredictions) * 1000) / 10 : 0;

    const highRiskErrors = rows.filter((p) => p.match_status === "mismatch" && Number(p.confidence_score) >= 0.8);

    const { data: timingRows } = await supabase
      .from("baseline_actions")
      .select("duration_minutes")
      .gte("created_at", sevenDaysAgo)
      .gt("duration_minutes", 0);
    const tRows = timingRows ?? [];
    const totalTimedReviews = tRows.length;
    const avgTime = totalTimedReviews > 0
      ? Math.round((tRows.reduce((s, r) => s + (Number(r.duration_minutes) || 0), 0) / totalTimedReviews) * 100) / 100
      : 0;

    const reportDate = new Date().toISOString().split("T")[0];
    const periodStart = sevenDaysAgo.split("T")[0];

    return jsonResponse({
      report_metadata: {
        generated_at: new Date().toISOString(),
        period_start: periodStart,
        period_end: reportDate,
        project_filter: projectId ?? "all",
      },
      executive_summary: {
        total_predictions: totalPredictions,
        actionable_comments: actionableCount,
        pending_review: pendingCount,
        overall_accuracy_percent: overallAccuracy,
        avg_confidence_percent: avgConfidence,
        matches: matchCount,
        partials: partialCount,
        mismatches: mismatchCount,
      },
      agent_performance: agentBreakdowns,
      baseline_metrics: {
        total_baselines: totalBaselines,
        unique_disciplines: uniqueDisciplines,
        baseline_coverage_percent: baselineCoverage,
        timed_reviews: totalTimedReviews,
        avg_time_per_comment_minutes: avgTime,
      },
      confidence_calibration: {
        high_risk_count: highRiskErrors.length,
        high_risk_predictions: highRiskErrors.map((p) => ({
          id: p.id,
          agent_name: p.agent_name,
          confidence: Math.round(Number(p.confidence_score) * 100),
          ai_prediction: (p.prediction_data as Record<string, unknown>)?.ai_discipline ?? "—",
          human_baseline: (p.prediction_data as Record<string, unknown>)?.portal_discipline ?? "—",
          comment_snippet: ((p as Record<string, unknown>).parsed_comments as { original_text?: string })?.original_text?.slice(0, 120) ?? "—",
          created_at: p.created_at,
        })),
      },
      raw_predictions: rows.map((p) => ({
        id: p.id,
        agent_name: p.agent_name,
        match_status: p.match_status,
        confidence: Math.round(Number(p.confidence_score) * 100),
        ai_prediction: (p.prediction_data as Record<string, unknown>)?.ai_discipline ?? "—",
        human_baseline: (p.prediction_data as Record<string, unknown>)?.portal_discipline ?? "—",
        comment_snippet: ((p as Record<string, unknown>).parsed_comments as { original_text?: string })?.original_text?.slice(0, 120) ?? "—",
        project_id: p.project_id,
        created_at: p.created_at,
      })),
    });
  } catch (error) {
    console.error("export-weekly-report: error", error instanceof Error ? error.stack : String(error));
    return jsonResponse({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
