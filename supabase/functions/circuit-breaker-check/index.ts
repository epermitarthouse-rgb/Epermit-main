import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

interface AgentCircuitStatus {
  agent_name: string;
  status: "active" | "warning" | "disabled";
  predictions_24h: number;
  mismatches_24h: number;
  fail_rate_24h: number;
  consecutive_fails: number;
  reason: string | null;
}

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

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let recentQuery = supabase
      .from("shadow_predictions")
      .select("id, agent_name, match_status, confidence_score, created_at")
      .gte("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false });
    if (projectId) recentQuery = recentQuery.eq("project_id", projectId);

    const { data: recentPredictions, error: rpErr } = await recentQuery;
    if (rpErr) {
      return jsonResponse({ code: 500, message: `Query failed: ${rpErr.message}` }, 500);
    }

    const rows = recentPredictions ?? [];

    const agentRows = new Map<string, typeof rows>();
    for (const r of rows) {
      const name = r.agent_name ?? "Unknown";
      if (!agentRows.has(name)) agentRows.set(name, []);
      agentRows.get(name)!.push(r);
    }

    const MIN_PREDICTIONS_FOR_BREAKER = 10;
    const FAIL_RATE_THRESHOLD = 0.10;
    const CONSECUTIVE_FAIL_WARNING = 3;

    const agentStatuses: AgentCircuitStatus[] = [];

    for (const [agentName, agentPreds] of agentRows.entries()) {
      const total = agentPreds.length;
      const actionable = agentPreds.filter(
        (p) => p.match_status === "match" || p.match_status === "partial" || p.match_status === "mismatch"
      );
      const mismatchCount = actionable.filter((p) => p.match_status === "mismatch").length;
      const failRate = actionable.length > 0 ? mismatchCount / actionable.length : 0;

      let consecutiveFails = 0;
      const sortedActionable = [...agentPreds]
        .filter((p) => p.match_status === "match" || p.match_status === "partial" || p.match_status === "mismatch")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      for (const p of sortedActionable) {
        if (p.match_status === "mismatch") consecutiveFails++;
        else break;
      }

      let status: AgentCircuitStatus["status"] = "active";
      let reason: string | null = null;

      if (actionable.length >= MIN_PREDICTIONS_FOR_BREAKER && failRate > FAIL_RATE_THRESHOLD) {
        status = "disabled";
        reason = `Fail rate ${(failRate * 100).toFixed(1)}% exceeds 10% threshold (${mismatchCount}/${actionable.length} actionable predictions in 24h)`;
      } else if (consecutiveFails >= CONSECUTIVE_FAIL_WARNING) {
        status = "warning";
        reason = `${consecutiveFails} consecutive mismatches detected`;
      }

      agentStatuses.push({
        agent_name: agentName,
        status,
        predictions_24h: total,
        mismatches_24h: mismatchCount,
        fail_rate_24h: Math.round(failRate * 1000) / 10,
        consecutive_fails: consecutiveFails,
        reason,
      });
    }

    return jsonResponse({
      checked_at: new Date().toISOString(),
      window_start: twentyFourHoursAgo,
      min_predictions_required: MIN_PREDICTIONS_FOR_BREAKER,
      fail_rate_threshold_percent: FAIL_RATE_THRESHOLD * 100,
      consecutive_fail_warning: CONSECUTIVE_FAIL_WARNING,
      agents: agentStatuses,
    });
  } catch (error) {
    console.error("circuit-breaker-check: error", error instanceof Error ? error.stack : String(error));
    return jsonResponse({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
