import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "supabase-analyzer-drawings";
const MAX_SHEETS = 100;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

type FileInput = {
  name: string;
  size: number;
  type?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanFileName(value: unknown): string {
  return String(value || "drawing.pdf")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .slice(0, 240);
}

async function authorizeEditor(req: Request, projectId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return { error: json({ error: "Analyzer is not configured" }, 500) };
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: json({ error: "Authentication required" }, 401) };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return { error: json({ error: "Invalid session" }, 401) };
  }

  const { data: allowed, error: accessError } = await userClient.rpc(
    "has_project_editor_access",
    { _user_id: user.id, _project_id: projectId },
  );
  if (accessError || allowed !== true) {
    return { error: json({ error: "Project write access required" }, 403) };
  }

  return {
    user,
    admin: createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    }),
    supabaseUrl,
    serviceRoleKey,
  };
}

async function triggerProcessor(supabaseUrl: string, serviceRoleKey: string) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/supabase-analyzer-processor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ source: "run_action" }),
    });
  } catch (error) {
    console.error("[supabase-analyzer] processor trigger failed", error);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action || "");
  const projectId = String(body.projectId || "");
  if (!projectId) return json({ error: "projectId is required" }, 400);

  const authorization = await authorizeEditor(req, projectId);
  if ("error" in authorization) return authorization.error;
  const { user, admin, supabaseUrl, serviceRoleKey } = authorization;

  try {
    if (action === "create") {
      if (Deno.env.get("SUPABASE_ANALYZER_ENABLED")?.toLowerCase() === "false") {
        return json({ error: "Code Analyzer is temporarily unavailable" }, 503);
      }
      const files = Array.isArray(body.files) ? body.files as FileInput[] : [];
      if (files.length < 1 || files.length > MAX_SHEETS) {
        return json({ error: `Select between 1 and ${MAX_SHEETS} PDF sheets` }, 400);
      }

      let totalBytes = 0;
      const seen = new Set<string>();
      for (const input of files) {
        const name = cleanFileName(input?.name);
        const size = Number(input?.size);
        const type = String(input?.type || "application/pdf");
        if (!name.toLowerCase().endsWith(".pdf") || type !== "application/pdf") {
          return json({ error: `${name}: only individual PDF sheets are accepted` }, 400);
        }
        if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
          return json({ error: `${name}: file must be 15 MB or smaller` }, 400);
        }
        const duplicateKey = `${name.toLowerCase()}:${size}`;
        if (seen.has(duplicateKey)) {
          return json({ error: `${name}: duplicate file in this run` }, 400);
        }
        seen.add(duplicateKey);
        totalBytes += size;
      }
      if (totalBytes > MAX_TOTAL_BYTES) {
        return json({ error: "Drawing set exceeds the 250 MB run limit" }, 400);
      }

      const { count: activeRuns, error: activeError } = await admin
        .from("supabase_analyzer_runs")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .in("status", ["uploading", "queued", "processing"]);
      if (activeError) throw activeError;
      if ((activeRuns || 0) >= 2) {
        return json({ error: "This project already has two active analyzer runs" }, 409);
      }

      const runId = crypto.randomUUID();
      const jurisdictionKey = String(body.jurisdictionKey || "dc").slice(0, 120);
      const jurisdictionLabel = String(body.jurisdictionLabel || "Washington, DC").slice(0, 200);
      const projectType = String(body.projectType || "Commercial (General)").slice(0, 200);
      const codeEdition = String(body.codeEdition || "2017").slice(0, 100);
      const codeContext = String(
        body.codeContext || "2017 District of Columbia Construction Codes (2015 IBC base)",
      ).slice(0, 500);
      const budget = Math.max(1, Math.min(Number(body.budgetLimitUsd) || 20, 100));

      const { error: runError } = await admin.from("supabase_analyzer_runs").insert({
        id: runId,
        project_id: projectId,
        created_by: user.id,
        jurisdiction_key: jurisdictionKey,
        jurisdiction_label: jurisdictionLabel,
        project_type: projectType,
        code_edition: codeEdition,
        code_context: codeContext,
        source_coverage: "adoption_metadata_only",
        ai_provider: "openai",
        ai_model: "gpt-4o",
        total_sheets: files.length,
        budget_limit_usd: budget,
      });
      if (runError) throw runError;

      const jobs = files.map((input, index) => {
        const id = crypto.randomUUID();
        return {
          id,
          run_id: runId,
          project_id: projectId,
          ordinal: index + 1,
          original_file_name: cleanFileName(input.name),
          object_path: `${projectId}/${runId}/${id}.pdf`,
          file_size: Number(input.size),
          mime_type: "application/pdf",
        };
      });
      const { error: jobsError } = await admin
        .from("supabase_analyzer_sheet_jobs")
        .insert(jobs);
      if (jobsError) {
        await admin.from("supabase_analyzer_runs").delete().eq("id", runId);
        throw jobsError;
      }

      const uploads = [];
      try {
        for (const job of jobs) {
          const { data, error } = await admin.storage
            .from(BUCKET)
            .createSignedUploadUrl(job.object_path);
          if (error || !data?.token) {
            throw error || new Error("Could not create upload authorization");
          }
          uploads.push({
            jobId: job.id,
            ordinal: job.ordinal,
            fileName: job.original_file_name,
            fileSize: job.file_size,
            path: job.object_path,
            token: data.token,
          });
        }
      } catch (error) {
        await admin.from("supabase_analyzer_runs").delete().eq("id", runId);
        throw error;
      }

      await admin.from("supabase_analyzer_audit_events").insert({
        run_id: runId,
        project_id: projectId,
        actor_id: user.id,
        event_type: "run_created",
        metadata: { sheet_count: files.length, total_bytes: totalBytes },
      });

      return json({ runId, uploads }, 201);
    }

    const runId = String(body.runId || "");
    if (!runId) return json({ error: "runId is required" }, 400);

    const { data: run, error: runError } = await admin
      .from("supabase_analyzer_runs")
      .select("*")
      .eq("id", runId)
      .eq("project_id", projectId)
      .single();
    if (runError || !run) return json({ error: "Analyzer run not found" }, 404);

    if (action === "finalize") {
      if (run.status === "cancelled") return json({ error: "Run is cancelled" }, 409);

      const { data: jobs, error: jobsError } = await admin
        .from("supabase_analyzer_sheet_jobs")
        .select("id, original_file_name, object_path, status")
        .eq("run_id", runId)
        .order("ordinal");
      if (jobsError) throw jobsError;

      const prefix = `${projectId}/${runId}`;
      const { data: objects, error: listError } = await admin.storage
        .from(BUCKET)
        .list(prefix, { limit: MAX_SHEETS + 5 });
      if (listError) throw listError;
      const storedNames = new Set((objects || []).map((object) => object.name));
      const uploadedIds = (jobs || [])
        .filter((job) => storedNames.has(job.object_path.split("/").pop() || ""))
        .map((job) => job.id);
      const missing = (jobs || [])
        .filter((job) => !storedNames.has(job.object_path.split("/").pop() || ""))
        .map((job) => ({ jobId: job.id, fileName: job.original_file_name }));

      if (uploadedIds.length > 0) {
        const { error: queueError } = await admin
          .from("supabase_analyzer_sheet_jobs")
          .update({
            status: "queued",
            available_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .in("id", uploadedIds)
          .eq("status", "upload_pending");
        if (queueError) throw queueError;
      }
      await admin.rpc("refresh_supabase_analyzer_run", { p_run_id: runId });
      await admin.from("supabase_analyzer_audit_events").insert({
        run_id: runId,
        project_id: projectId,
        actor_id: user.id,
        event_type: "uploads_finalized",
        metadata: { uploaded: uploadedIds.length, missing: missing.length },
      });

      if (uploadedIds.length > 0) {
        await triggerProcessor(supabaseUrl, serviceRoleKey);
      }
      return json({ runId, queued: uploadedIds.length, missing });
    }

    if (action === "retry") {
      if (run.status === "cancelled") return json({ error: "Run is cancelled" }, 409);
      const requestedIds = Array.isArray(body.jobIds)
        ? body.jobIds.map(String).filter(Boolean).slice(0, MAX_SHEETS)
        : [];
      let query = admin
        .from("supabase_analyzer_sheet_jobs")
        .update({
          status: "queued",
          attempt_count: 0,
          available_at: new Date().toISOString(),
          completed_at: null,
          last_error: null,
          error_code: null,
          lease_owner: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("run_id", runId)
        .eq("project_id", projectId)
        .eq("status", "failed");
      if (requestedIds.length) query = query.in("id", requestedIds);
      const { data: retried, error: retryError } = await query.select("id");
      if (retryError) throw retryError;

      await admin
        .from("supabase_analyzer_findings")
        .update({ is_published: false, updated_at: new Date().toISOString() })
        .eq("run_id", runId)
        .in("sheet_job_id", (retried || []).map((row) => row.id));
      await admin
        .from("supabase_analyzer_runs")
        .update({ status: "queued", completed_at: null, updated_at: new Date().toISOString() })
        .eq("id", runId);
      await admin.rpc("refresh_supabase_analyzer_run", { p_run_id: runId });
      await admin.from("supabase_analyzer_audit_events").insert({
        run_id: runId,
        project_id: projectId,
        actor_id: user.id,
        event_type: "failed_jobs_retried",
        metadata: { count: retried?.length || 0 },
      });
      if (retried?.length) await triggerProcessor(supabaseUrl, serviceRoleKey);
      return json({ retried: retried?.length || 0 });
    }

    if (action === "cancel") {
      const now = new Date().toISOString();
      await admin
        .from("supabase_analyzer_runs")
        .update({ status: "cancelled", cancelled_at: now, updated_at: now })
        .eq("id", runId);
      await admin
        .from("supabase_analyzer_sheet_jobs")
        .update({
          status: "cancelled",
          lease_owner: null,
          lease_expires_at: null,
          completed_at: now,
          updated_at: now,
        })
        .eq("run_id", runId)
        .in("status", ["upload_pending", "queued", "processing"]);
      await admin
        .from("supabase_analyzer_findings")
        .update({ is_published: false, updated_at: now })
        .eq("run_id", runId);
      await admin.from("supabase_analyzer_audit_events").insert({
        run_id: runId,
        project_id: projectId,
        actor_id: user.id,
        event_type: "run_cancelled",
      });
      return json({ cancelled: true });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("[supabase-analyzer] run action failed", error);
    return json(
      { error: error instanceof Error ? error.message : "Analyzer request failed" },
      500,
    );
  }
});
