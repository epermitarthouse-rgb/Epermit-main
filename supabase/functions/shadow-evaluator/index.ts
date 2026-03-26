import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") {
      return jsonResponse({ code: 405, message: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("shadow-evaluator: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
      return jsonResponse(
        { code: 500, message: "Missing Supabase environment config" },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      console.error("shadow-evaluator: failed to parse request body");
      return jsonResponse(
        { code: 400, message: "Invalid or missing JSON body" },
        400,
      );
    }

    const action = body.action as string | undefined;

    if (action === "evaluate_new_prediction") {
      const predictionId = body.prediction_id as string | undefined;
      const pid = body.project_id as string | undefined;
      const agentName = body.agent_name as string | undefined;

      if (!predictionId || !pid) {
        return jsonResponse(
          { code: 400, message: "evaluate_new_prediction requires prediction_id and project_id" },
          400,
        );
      }

      const { data: prediction, error: predErr } = await supabase
        .from("shadow_predictions")
        .select("id, comment_id, prediction_data, match_status")
        .eq("id", predictionId)
        .single();

      if (predErr || !prediction) {
        return jsonResponse({ code: 404, message: "Prediction not found" }, 404);
      }

      if (prediction.match_status !== "pending") {
        return jsonResponse({ success: true, skipped: true, reason: "already_evaluated" });
      }

      const commentId = prediction.comment_id as string | undefined;
      let autoMatchStatus = "pending";

      if (commentId) {
        const { data: baseline } = await supabase
          .from("baseline_actions")
          .select("action_type")
          .eq("comment_id", commentId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (baseline) {
          const normalise = (v: unknown): string => {
            if (v === null || v === undefined) return "";
            if (typeof v === "string") return v.trim().toLowerCase();
            return JSON.stringify(v);
          };

          autoMatchStatus =
            normalise(prediction.prediction_data) === normalise(baseline.action_type)
              ? "match"
              : "mismatch";

          await supabase
            .from("shadow_predictions")
            .update({ match_status: autoMatchStatus })
            .eq("id", predictionId);
        }
      }

      const auditAction = autoMatchStatus === "pending"
        ? "auto_evaluate_no_baseline"
        : "auto_evaluate_prediction";

      const { error: auditErr } = await supabase.from("audit_trail").insert({
        project_id: pid,
        actor_id: "system",
        action_type: auditAction,
        routing_decision: autoMatchStatus,
        input_hash: predictionId,
      });

      if (auditErr) {
        console.error("shadow-evaluator: auto-evaluate audit insert error", JSON.stringify(auditErr));
      }

      return jsonResponse({
        success: true,
        prediction_id: predictionId,
        auto_match_status: autoMatchStatus,
        has_baseline: autoMatchStatus !== "pending",
        audit_logged: !auditErr,
      });
    }

    if (action === "log_failure") {
      const pid = body.project_id as string | undefined;
      const agentName = body.agent_name as string | undefined;
      const errorMessage = body.error_message as string | undefined;

      if (!pid || !agentName) {
        return jsonResponse(
          { code: 400, message: "log_failure requires project_id and agent_name" },
          400,
        );
      }

      const { error: spError } = await supabase
        .from("shadow_predictions")
        .insert({
          project_id: pid,
          agent_name: agentName,
          prediction_data: { status: "fail", error: errorMessage ?? "Unknown error" },
          match_status: "fail",
          confidence_score: 0,
        });

      if (spError) {
        console.error("shadow-evaluator: shadow_predictions fail insert error", JSON.stringify(spError));
      }

      const { error: auditErr } = await supabase.from("audit_trail").insert({
        project_id: pid,
        actor_id: "system",
        action_type: "chain_agent_failure",
        routing_decision: agentName,
        input_hash: errorMessage ?? "Unknown error",
      });

      if (auditErr) {
        console.error("shadow-evaluator: audit_trail fail insert error", JSON.stringify(auditErr));
      }

      return jsonResponse({
        success: true,
        action: "log_failure",
        agent_name: agentName,
        shadow_logged: !spError,
        audit_logged: !auditErr,
      });
    }

    const projectId = body.projectId as string | undefined;
    const commentId = body.commentId as string | undefined;
    const expeditorId = body.expeditorId as string | undefined;
    const actionType = body.actionType as string | undefined;
    const humanValue = body.humanValue;
    const durationMinutes = body.durationMinutes as number | undefined;

    if (
      !projectId ||
      !commentId ||
      !expeditorId ||
      !actionType ||
      humanValue === undefined
    ) {
      return jsonResponse(
        {
          code: 400,
          message:
            "Missing required fields: projectId, commentId, expeditorId, actionType, humanValue",
        },
        400,
      );
    }

    const { error: baselineError } = await supabase
      .from("baseline_actions")
      .insert({
        project_id: projectId,
        comment_id: commentId,
        expeditor_id: expeditorId,
        action_type: actionType,
        duration_minutes: durationMinutes ?? 0,
      });

    if (baselineError) {
      console.error("shadow-evaluator: baseline insert error", JSON.stringify(baselineError));
      return jsonResponse(
        { code: 500, message: `Baseline insert failed: ${baselineError.message}` },
        500,
      );
    }

    const { data: pendingPredictions, error: fetchError } = await supabase
      .from("shadow_predictions")
      .select("id, prediction_data")
      .eq("comment_id", commentId)
      .eq("match_status", "pending");

    if (fetchError) {
      console.error("shadow-evaluator: predictions fetch error", JSON.stringify(fetchError));
      return jsonResponse(
        { code: 500, message: `Predictions fetch failed: ${fetchError.message}` },
        500,
      );
    }

    const evaluationResults: Array<{
      prediction_id: string;
      match_status: string;
    }> = [];

    for (const prediction of pendingPredictions ?? []) {
      const predictionValue = prediction.prediction_data;

      const normalise = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        if (typeof v === "string") return v.trim().toLowerCase();
        return JSON.stringify(v);
      };

      const match_status =
        normalise(predictionValue) === normalise(humanValue)
          ? "match"
          : "mismatch";

      const { error: updateError } = await supabase
        .from("shadow_predictions")
        .update({ match_status })
        .eq("id", prediction.id);

      if (updateError) {
        console.error(
          `shadow-evaluator: update prediction ${prediction.id} error`,
          JSON.stringify(updateError),
        );
      }

      evaluationResults.push({
        prediction_id: prediction.id,
        match_status,
      });
    }

    const matchSummary =
      evaluationResults.length === 0
        ? "no_pending_predictions"
        : evaluationResults.every((r) => r.match_status === "match")
          ? "all_match"
          : evaluationResults.every((r) => r.match_status === "mismatch")
            ? "all_mismatch"
            : "mixed";

    const { error: auditError } = await supabase.from("audit_trail").insert({
      project_id: projectId,
      actor_id: expeditorId,
      action_type: "human_evaluation",
      routing_decision: matchSummary,
      input_hash: commentId,
    });

    if (auditError) {
      console.error("shadow-evaluator: audit insert error", JSON.stringify(auditError));
    }

    return jsonResponse({
      success: true,
      baseline_recorded: true,
      predictions_evaluated: evaluationResults.length,
      evaluation_results: evaluationResults,
      audit_logged: !auditError,
      match_summary: matchSummary,
    });
  } catch (error) {
    console.error("shadow-evaluator: unhandled error", error instanceof Error ? error.stack : String(error));
    return jsonResponse(
      {
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});
