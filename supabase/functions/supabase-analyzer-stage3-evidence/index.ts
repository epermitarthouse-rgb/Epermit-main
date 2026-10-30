/**
 * Stage 3 evidence upload bridge (Mac worker → private Storage).
 *
 * Auth (least privilege):
 * - Preferred: Bearer STAGE3_WORKER_UPLOAD_TOKEN (dedicated secret ≠ service role)
 * - Alternate: project-editor user JWT (has_project_editor_access)
 *
 * Service-role is used only inside this Edge function to write Storage.
 * Mac never receives service-role or public Storage URLs.
 *
 * verify_jwt is false so the worker token can authenticate; in-code auth is mandatory.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  STAGE3_EVIDENCE_BUCKET,
  STAGE3_PACK_MAX_BYTES,
  buildStage3EvidenceObjectPath,
  parseStage3PackBytes,
  serializeStage3PackForUpload,
  sha256Hex,
  type Stage3EvidencePack,
} from "../_shared/analyzerStage3StorageBridge.ts";
import { STAGE3_VISUAL_EVIDENCE_VERSION } from "../_shared/analyzerStage3VisualEvidence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-stage3-worker-token",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function extractBearer(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  const headerToken = req.headers.get("x-stage3-worker-token")?.trim();
  return headerToken || null;
}

async function authorizeCaller(req: Request, projectId: string): Promise<
  | { ok: true; mode: "worker_token" | "project_editor"; admin: ReturnType<typeof createClient> }
  | { ok: false; response: Response }
> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerToken = Deno.env.get("STAGE3_WORKER_UPLOAD_TOKEN")?.trim();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return { ok: false, response: json({ error: "Stage 3 evidence bridge not configured" }, 500) };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const presented = extractBearer(req);
  if (!presented) {
    return { ok: false, response: json({ error: "Authentication required" }, 401) };
  }

  // Dedicated worker token — must not equal service role.
  if (workerToken) {
    if (timingSafeEqual(presented, serviceRoleKey)) {
      return {
        ok: false,
        response: json({
          error: "Service-role credentials are not accepted for Stage 3 Mac uploads",
        }, 403),
      };
    }
    if (timingSafeEqual(presented, workerToken)) {
      return { ok: true, mode: "worker_token", admin };
    }
  }

  // Project editor JWT path (interactive / operator uploads).
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${presented}` } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return { ok: false, response: json({ error: "Invalid credentials" }, 401) };
  }
  const { data: allowed, error: accessError } = await userClient.rpc(
    "has_project_editor_access",
    { _user_id: user.id, _project_id: projectId },
  );
  if (accessError || allowed !== true) {
    return { ok: false, response: json({ error: "Project write access required" }, 403) };
  }
  return { ok: true, mode: "project_editor", admin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      // Health / config probe — no secrets.
      return json({
        ok: true,
        bucket: STAGE3_EVIDENCE_BUCKET,
        extractionVersion: STAGE3_VISUAL_EVIDENCE_VERSION,
        maxBytes: STAGE3_PACK_MAX_BYTES,
        workerTokenConfigured: Boolean(Deno.env.get("STAGE3_WORKER_UPLOAD_TOKEN")?.trim()),
        acceptsServiceRoleUpload: false,
      });
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > STAGE3_PACK_MAX_BYTES + 4096) {
      return json({ error: "Payload too large" }, 413);
    }

    const body = await req.json() as {
      action?: string;
      projectId?: string;
      runId?: string;
      sheetJobId?: string;
      contentSha256?: string;
      pack?: Stage3EvidencePack;
      preprocess?: Record<string, unknown>;
      /** Ignored — path is always server-derived. */
      objectPath?: string;
    };

    const projectId = String(body.projectId || "").trim();
    const runId = String(body.runId || "").trim();
    const action = String(body.action || "upload_pack").trim();

    const auth = await authorizeCaller(req, projectId);
    if (!auth.ok) return auth.response;
    const { admin, mode } = auth;

    if (action === "sync_run_preprocess") {
      if (!runId) return json({ error: "runId is required" }, 400);
      const { data: run, error: runError } = await admin
        .from("supabase_analyzer_runs")
        .select("id, project_id, analysis_scope")
        .eq("id", runId)
        .maybeSingle();
      if (runError || !run || String(run.project_id) !== projectId) {
        return json({ error: "Run not found for project" }, 404);
      }
      const scope = (run.analysis_scope && typeof run.analysis_scope === "object" && !Array.isArray(run.analysis_scope))
        ? { ...(run.analysis_scope as Record<string, unknown>) }
        : {};
      scope.stage3FullCoverageOcr = true;
      scope.stage3VisualEvidence = true;
      scope.stage3OcrPreprocess = {
        ...(body.preprocess || {}),
        updatedAt: new Date().toISOString(),
      };
      const { error: updateError } = await admin
        .from("supabase_analyzer_runs")
        .update({ analysis_scope: scope, updated_at: new Date().toISOString() })
        .eq("id", runId);
      if (updateError) {
        return json({ error: updateError.message || "Run update failed" }, 500);
      }
      return json({ ok: true, action, runId, authMode: mode });
    }

    if (action === "list_sheet_jobs") {
      if (!runId) return json({ error: "runId is required" }, 400);
      const { data: jobs, error: jobsError } = await admin
        .from("supabase_analyzer_sheet_jobs")
        .select("id, original_file_name, object_path, detected_sheet_number, discipline, status")
        .eq("run_id", runId)
        .eq("project_id", projectId)
        .order("ordinal", { ascending: true });
      if (jobsError) return json({ error: jobsError.message }, 500);
      return json({ ok: true, jobs: jobs || [], authMode: mode });
    }

    if (action === "download_drawing") {
      const sheetJobId = String(body.sheetJobId || "").trim();
      const contentSha256 = String(body.contentSha256 || "").trim().toLowerCase();
      if (!sheetJobId) return json({ error: "sheetJobId is required" }, 400);
      const { data: job, error: jobError } = await admin
        .from("supabase_analyzer_sheet_jobs")
        .select("id, project_id, run_id, object_path")
        .eq("id", sheetJobId)
        .maybeSingle();
      if (jobError || !job) return json({ error: "Sheet job not found" }, 404);
      if (String(job.project_id) !== projectId || String(job.run_id) !== runId) {
        return json({ error: "Sheet job does not match project/run" }, 403);
      }
      const { data: drawingBlob, error: drawingError } = await admin.storage
        .from("supabase-analyzer-drawings")
        .download(String(job.object_path));
      if (drawingError || !drawingBlob) {
        return json({ error: drawingError?.message || "Drawing download failed" }, 500);
      }
      const drawingBytes = new Uint8Array(await drawingBlob.arrayBuffer());
      const actualSha = await sha256Hex(drawingBytes);
      if (contentSha256 && actualSha !== contentSha256) {
        return json({ error: "contentSha256 does not match stored drawing" }, 409);
      }
      const base64 = encodeBase64(drawingBytes);
      return json({
        ok: true,
        bytes: drawingBytes.byteLength,
        sha256: actualSha,
        base64,
        authMode: mode,
      });
    }

    if (action === "verify_pack") {
      const sheetJobId = String(body.sheetJobId || "").trim();
      const contentSha256 = String(body.contentSha256 || "").trim().toLowerCase();
      if (!runId || !sheetJobId || !contentSha256 || !/^[a-f0-9]{64}$/.test(contentSha256)) {
        return json({ error: "runId, sheetJobId, and contentSha256 are required" }, 400);
      }
      const { data: job, error: jobError } = await admin
        .from("supabase_analyzer_sheet_jobs")
        .select("id, project_id, run_id")
        .eq("id", sheetJobId)
        .maybeSingle();
      if (jobError || !job) return json({ error: "Sheet job not found" }, 404);
      if (String(job.project_id) !== projectId || String(job.run_id) !== runId) {
        return json({ error: "Sheet job does not match project/run" }, 403);
      }
      const objectPath = buildStage3EvidenceObjectPath({
        projectId,
        runId,
        sheetJobId,
        contentSha256,
      });
      const { data: packBlob, error: packError } = await admin.storage
        .from(STAGE3_EVIDENCE_BUCKET)
        .download(objectPath);
      if (packError || !packBlob) {
        return json({
          ok: false,
          found: false,
          objectPath,
          error: packError?.message || "Pack not found in Storage",
          authMode: mode,
        }, 404);
      }
      const packBytes = new Uint8Array(await packBlob.arrayBuffer());
      const validated = parseStage3PackBytes(packBytes, {
        contentSha256,
        extractionVersion: STAGE3_VISUAL_EVIDENCE_VERSION,
      });
      if (!validated.ok) {
        return json({
          ok: false,
          found: true,
          objectPath,
          bytes: packBytes.byteLength,
          issue: validated.issue,
          detail: validated.detail,
          authMode: mode,
        }, 409);
      }
      const promptReady = Boolean(String(validated.pack.promptBlock || "").trim());
      return json({
        ok: true,
        found: true,
        objectPath,
        bytes: packBytes.byteLength,
        packStatus: validated.pack.status,
        sheetId: validated.pack.sheetId,
        topic: validated.pack.topic,
        independentlyVerified: false,
        promptReady,
        extractionVersion: validated.pack.extractionVersion || STAGE3_VISUAL_EVIDENCE_VERSION,
        authMode: mode,
      });
    }

    const sheetJobId = String(body.sheetJobId || "").trim();
    const contentSha256 = String(body.contentSha256 || "").trim().toLowerCase();
    if (!projectId || !runId || !sheetJobId || !contentSha256 || !/^[a-f0-9]{64}$/.test(contentSha256)) {
      return json({ error: "projectId, runId, sheetJobId, and contentSha256 are required" }, 400);
    }
    if (!body.pack || typeof body.pack !== "object") {
      return json({ error: "pack object is required" }, 400);
    }

    // Ownership: sheet job must belong to project + run.
    const { data: job, error: jobError } = await admin
      .from("supabase_analyzer_sheet_jobs")
      .select("id, project_id, run_id, object_path, original_file_name, status")
      .eq("id", sheetJobId)
      .maybeSingle();
    if (jobError || !job) {
      return json({ error: "Sheet job not found" }, 404);
    }
    if (String(job.project_id) !== projectId || String(job.run_id) !== runId) {
      return json({ error: "Sheet job does not match project/run" }, 403);
    }

    const { data: run, error: runError } = await admin
      .from("supabase_analyzer_runs")
      .select("id, project_id, status")
      .eq("id", runId)
      .maybeSingle();
    if (runError || !run || String(run.project_id) !== projectId) {
      return json({ error: "Run not found for project" }, 404);
    }

    // Verify drawing bytes SHA when object is available (strong ownership).
    if (job.object_path) {
      const { data: drawingBlob, error: drawingError } = await admin.storage
        .from("supabase-analyzer-drawings")
        .download(String(job.object_path));
      if (!drawingError && drawingBlob) {
        const drawingBytes = new Uint8Array(await drawingBlob.arrayBuffer());
        const actualSha = await sha256Hex(drawingBytes);
        if (actualSha !== contentSha256) {
          return json({
            error: "contentSha256 does not match stored drawing",
            expectedPrefix: actualSha.slice(0, 12),
          }, 409);
        }
      }
    }

    const validated = parseStage3PackBytes(
      serializeStage3PackForUpload({
        ...body.pack,
        sourceFileSha256: contentSha256,
        independentlyVerified: false,
      }),
      {
        contentSha256,
        extractionVersion: STAGE3_VISUAL_EVIDENCE_VERSION,
      },
    );
    if (!validated.ok) {
      return json({ error: "Invalid evidence pack", issue: validated.issue, detail: validated.detail }, 400);
    }

    // Server-derived path only — ignore any client objectPath.
    const objectPath = buildStage3EvidenceObjectPath({
      projectId,
      runId,
      sheetJobId,
      contentSha256,
    });
    const bytes = serializeStage3PackForUpload(validated.pack);
    if (bytes.byteLength > STAGE3_PACK_MAX_BYTES) {
      return json({ error: "Pack exceeds size limit" }, 413);
    }

    const { error: uploadError } = await admin.storage
      .from(STAGE3_EVIDENCE_BUCKET)
      .upload(objectPath, bytes, {
        contentType: "application/json",
        upsert: true,
      });
    if (uploadError) {
      return json({ error: uploadError.message || "Storage upload failed" }, 500);
    }

    await admin.from("supabase_analyzer_audit_events").insert({
      run_id: runId,
      sheet_job_id: sheetJobId,
      project_id: projectId,
      event_type: "stage3_evidence_uploaded",
      metadata: {
        object_path: objectPath,
        bucket: STAGE3_EVIDENCE_BUCKET,
        content_sha256: contentSha256,
        extraction_version: STAGE3_VISUAL_EVIDENCE_VERSION,
        auth_mode: mode,
        pack_id: validated.pack.id,
        pack_status: validated.pack.status,
        independently_verified: false,
        bytes: bytes.byteLength,
        public_url: null,
      },
    });

    return json({
      ok: true,
      bucket: STAGE3_EVIDENCE_BUCKET,
      objectPath,
      bytes: bytes.byteLength,
      authMode: mode,
      publicUrl: null,
      independentlyVerified: false,
    });
  } catch (error) {
    console.error("[stage3-evidence]", error instanceof Error ? error.message : error);
    return json({
      error: error instanceof Error ? error.message.slice(0, 240) : "Unexpected error",
    }, 500);
  }
});
