import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  normalizeNewRunAnalysisMode,
  resolveAnalyzerReviewScope,
} from "../_shared/analyzerReviewScope.ts";
import {
  isObjectPathConflict,
  materializeReanalysis,
  planReanalysis,
  rewriteReuseObjectPaths,
  shouldRemoveStoredDrawing,
  splitStorageObjectPath,
  type MaterializedReanalysisJob,
  type ReanalysisSourceSheet,
} from "../_shared/analyzerReanalysis.ts";
import {
  analyzerFileIdentity,
  applyCancellation,
  cleanAnalyzerFileName,
  retryWouldRestart,
  nextSheetOrdinal,
  planSheetUpdate,
  runAllowsSheetUpdate,
  runIsWorkerActive,
  sheetMutations,
  type ExistingAnalyzerSheet,
  type IncomingAnalyzerSheet,
} from "../_shared/analyzerSheetUpdate.ts";

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
  let cleaned = "";
  for (const char of String(value || "drawing.pdf")) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) continue;
    cleaned += char === "\\" || char === "/" ? "_" : char;
  }
  return cleaned.slice(0, 240);
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

async function supersedeAnalyzerSheet(
  admin: ReturnType<typeof createClient>,
  runId: string,
  job: { id: string; object_path?: string | null },
) {
  await admin.from("supabase_analyzer_findings").delete().eq("sheet_job_id", job.id).eq("run_id", runId);
  if (job.object_path) {
    const { count, error: shareError } = await admin
      .from("supabase_analyzer_sheet_jobs")
      .select("id", { count: "exact", head: true })
      .eq("object_path", job.object_path)
      .neq("id", job.id);
    if (shareError) throw shareError;
    if (shouldRemoveStoredDrawing(count || 0)) {
      await admin.storage.from(BUCKET).remove([job.object_path]);
    }
  }
  const { error } = await admin
    .from("supabase_analyzer_sheet_jobs")
    .delete()
    .eq("id", job.id)
    .eq("run_id", runId);
  if (error) throw error;
}

async function handleSheetUpdate(
  admin: ReturnType<typeof createClient>,
  userId: string,
  projectId: string,
  run: { id: string; status: string },
  body: Record<string, unknown>,
) {
  if (runIsWorkerActive(run.status)) {
    return json({ error: "This analysis is still processing" }, 409);
  }
  if (!runAllowsSheetUpdate(run.status)) {
    return json({ error: "This analysis cannot be updated" }, 409);
  }

  const requested = Array.isArray(body.files) ? body.files as Array<Record<string, unknown>> : [];
  const incoming: IncomingAnalyzerSheet[] = requested.map((input) => ({
    name: String(input?.name || ""),
    size: Number(input?.size),
    type: String(input?.type || "application/pdf"),
    replaceJobId: input?.replaceJobId ? String(input.replaceJobId) : null,
  }));
  const rawNameByIdentity = new Map<string, string>();
  for (const file of incoming) {
    rawNameByIdentity.set(analyzerFileIdentity(file.name, Number(file.size)), file.name);
  }

  const { data: jobRows, error: jobsError } = await admin
    .from("supabase_analyzer_sheet_jobs")
    .select("id, ordinal, original_file_name, file_size, detected_sheet_number, status, object_path")
    .eq("run_id", run.id)
    .eq("project_id", projectId);
  if (jobsError) throw jobsError;

  const jobs = (jobRows || []).map((row) => ({
    id: String(row.id),
    ordinal: Number(row.ordinal),
    original_file_name: String(row.original_file_name),
    file_size: Number(row.file_size),
    detected_sheet_number: row.detected_sheet_number ? String(row.detected_sheet_number) : null,
    status: String(row.status),
    object_path: String(row.object_path || ""),
  }));
  const sheets: ExistingAnalyzerSheet[] = jobs.map((row) => ({
    id: row.id,
    ordinal: row.ordinal,
    original_file_name: row.original_file_name,
    file_size: row.file_size,
    detected_sheet_number: row.detected_sheet_number,
    status: row.status,
  }));
  const plan = planSheetUpdate(sheets, incoming, { confirmed: body.confirmed === true });
  if (plan.error) return json({ error: plan.error }, 400);
  if (!plan.accepted) {
    return json({
      error: "Confirm the drawing update before adding or replacing sheets",
      adds: plan.items.filter((item) => item.action === "add").map((item) => item.fileName),
      replacements: plan.items.flatMap((item) => (
        item.action === "confirm" && item.jobId
          ? [{
            fileName: item.fileName,
            jobId: item.jobId,
            existingLabel: item.existingLabel || item.fileName,
            matchedBy: item.matchedBy || "file_name",
          }]
          : []
      )),
    }, 409);
  }

  const mutations = sheetMutations(plan);
  if (mutations.inserts.length === 0 && mutations.resumes.length === 0) {
    return json({
      runId: run.id,
      uploads: [],
      added: 0,
      replaced: 0,
      resumed: 0,
      skipped: mutations.skipped,
    });
  }

  const jobsById = new Map(jobs.map((row) => [row.id, row]));
  const usedOrdinals = new Set(jobs.map((row) => row.ordinal));
  const uploads: Array<{
    jobId: string;
    ordinal: number;
    fileName: string;
    fileSize: number;
    path: string;
    token: string;
  }> = [];

  const signedUpload = async (
    jobId: string,
    ordinal: number,
    objectPath: string,
    fileName: string,
    fileSize: number,
  ) => {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(objectPath);
    if (error || !data?.token) throw error || new Error("Could not create upload authorization");
    const rawName = rawNameByIdentity.get(analyzerFileIdentity(fileName, fileSize)) || fileName;
    uploads.push({
      jobId,
      ordinal,
      fileName: rawName,
      fileSize,
      path: objectPath,
      token: data.token,
    });
  };

  for (const resume of mutations.resumes) {
    const pending = jobsById.get(resume.jobId);
    if (!pending?.object_path) throw new Error("The drawing upload could not be resumed");
    await signedUpload(pending.id, pending.ordinal, pending.object_path, resume.fileName, resume.fileSize);
    if (resume.supersedeJobId) {
      const target = jobsById.get(resume.supersedeJobId);
      if (target) {
        await supersedeAnalyzerSheet(admin, run.id, target);
        usedOrdinals.delete(target.ordinal);
        jobsById.delete(target.id);
      }
    }
  }

  let replaced = 0;
  for (const insert of mutations.inserts) {
    let ordinal = nextSheetOrdinal(usedOrdinals);
    if (ordinal == null && insert.supersedeJobId) {
      const target = jobsById.get(insert.supersedeJobId);
      if (!target) throw new Error("The drawing being replaced is no longer in this analysis");
      await supersedeAnalyzerSheet(admin, run.id, target);
      usedOrdinals.delete(target.ordinal);
      jobsById.delete(target.id);
      ordinal = target.ordinal;
      replaced += 1;
    }
    if (ordinal == null) throw new Error("This analysis cannot exceed 100 drawings");
    const id = crypto.randomUUID();
    const objectPath = `${projectId}/${run.id}/${id}.pdf`;
    const storedName = cleanAnalyzerFileName(insert.fileName).trim() || "drawing.pdf";
    const { error: insertError } = await admin.from("supabase_analyzer_sheet_jobs").insert({
      id,
      run_id: run.id,
      project_id: projectId,
      ordinal,
      original_file_name: storedName,
      object_path: objectPath,
      file_size: insert.fileSize,
      mime_type: "application/pdf",
    });
    if (insertError) throw insertError;
    usedOrdinals.add(ordinal);
    await signedUpload(id, ordinal, objectPath, storedName, insert.fileSize);
    if (insert.supersedeJobId && jobsById.has(insert.supersedeJobId)) {
      const target = jobsById.get(insert.supersedeJobId)!;
      await supersedeAnalyzerSheet(admin, run.id, target);
      usedOrdinals.delete(target.ordinal);
      jobsById.delete(target.id);
      replaced += 1;
    }
  }

  const { data: latestRows, error: latestError } = await admin
    .from("supabase_analyzer_sheet_jobs")
    .select("status")
    .eq("run_id", run.id);
  if (latestError) throw latestError;
  const latest = latestRows || [];
  const totalSheets = latest.filter((row) => row.status !== "cancelled").length;
  const hasPending = latest.some((row) => row.status === "upload_pending");
  if (hasPending) {
    const { error: runUpdateError } = await admin
      .from("supabase_analyzer_runs")
      .update({
        total_sheets: Math.max(1, Math.min(100, totalSheets)),
        status: "uploading",
        completed_at: null,
        cancelled_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .eq("project_id", projectId);
    if (runUpdateError) throw runUpdateError;
  }

  await admin.from("supabase_analyzer_audit_events").insert({
    run_id: run.id,
    project_id: projectId,
    actor_id: userId,
    event_type: "run_drawings_updated",
    metadata: {
      added: mutations.inserts.filter((item) => !item.supersedeJobId).length,
      replaced,
      resumed: mutations.resumes.length,
      skipped: mutations.skipped.length,
    },
  });

  return json({
    runId: run.id,
    uploads,
    added: mutations.inserts.filter((item) => !item.supersedeJobId).length,
    replaced,
    resumed: mutations.resumes.length,
    skipped: mutations.skipped,
  });
}

const reanalysisFlights = new Map<string, Promise<Response>>();

async function listedObjectNames(
  admin: ReturnType<typeof createClient>,
  prefix: string,
): Promise<Set<string>> {
  const names = new Set<string>();
  for (let offset = 0; offset < 2000; offset += 100) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 100, offset });
    if (error) throw error;
    const page = data || [];
    for (const object of page) {
      if (object?.name) names.add(object.name);
    }
    if (page.length < 100) break;
  }
  return names;
}

async function storageExistsForPaths(
  admin: ReturnType<typeof createClient>,
  objectPaths: readonly string[],
): Promise<(objectPath: string) => boolean> {
  const prefixes = new Map<string, Set<string>>();
  for (const objectPath of objectPaths) {
    const split = splitStorageObjectPath(objectPath);
    if (!split || prefixes.has(split.prefix)) continue;
    prefixes.set(split.prefix, await listedObjectNames(admin, split.prefix));
  }
  return (objectPath: string) => {
    const split = splitStorageObjectPath(objectPath);
    if (!split) return false;
    return prefixes.get(split.prefix)?.has(split.name) === true;
  };
}

function sheetJobInsert(job: MaterializedReanalysisJob) {
  return {
    id: job.id,
    run_id: job.run_id,
    project_id: job.project_id,
    ordinal: job.ordinal,
    original_file_name: job.original_file_name,
    object_path: job.object_path,
    file_size: job.file_size,
    mime_type: "application/pdf",
    discipline: job.discipline,
    detected_sheet_number: job.detected_sheet_number,
    detected_sheet_title: job.detected_sheet_title,
    status: job.status,
    available_at: new Date().toISOString(),
  };
}

async function discardReanalysisRun(
  admin: ReturnType<typeof createClient>,
  runId: string,
  copiedPaths: readonly string[],
) {
  if (copiedPaths.length > 0) {
    await admin.storage.from(BUCKET).remove([...copiedPaths]);
  }
  await admin.from("supabase_analyzer_runs").delete().eq("id", runId);
}

async function signedReanalysisUploads(
  admin: ReturnType<typeof createClient>,
  jobs: readonly MaterializedReanalysisJob[],
) {
  const uploads = [];
  for (const job of jobs) {
    if (job.status !== "upload_pending") continue;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(job.object_path);
    if (error || !data?.token) throw error || new Error("Could not create upload authorization");
    uploads.push({
      jobId: job.id,
      ordinal: job.ordinal,
      fileName: job.original_file_name,
      fileSize: job.file_size,
      path: job.object_path,
      token: data.token,
    });
  }
  return uploads;
}

async function replayReanalysis(
  admin: ReturnType<typeof createClient>,
  runId: string,
  projectId: string,
  createdAt: string,
) {
  const { data: jobs, error } = await admin
    .from("supabase_analyzer_sheet_jobs")
    .select("id, ordinal, original_file_name, object_path, file_size, status, detected_sheet_number, detected_sheet_title, discipline")
    .eq("run_id", runId)
    .eq("project_id", projectId);
  if (error) throw error;
  const rows = jobs || [];
  if (rows.length === 0) {
    const age = Date.now() - new Date(createdAt).getTime();
    if (Number.isFinite(age) && age < 120_000) {
      return json({ error: "This reanalysis is already in progress" }, 409);
    }
    await admin.from("supabase_analyzer_runs").delete().eq("id", runId).eq("project_id", projectId);
    return null;
  }
  const materialized: MaterializedReanalysisJob[] = rows.map((row) => ({
    id: String(row.id),
    run_id: runId,
    project_id: projectId,
    ordinal: Number(row.ordinal),
    original_file_name: String(row.original_file_name),
    object_path: String(row.object_path),
    source_object_path: null,
    source_job_id: null,
    file_size: Number(row.file_size),
    status: row.status === "upload_pending" ? "upload_pending" : "queued",
    detected_sheet_number: row.detected_sheet_number ? String(row.detected_sheet_number) : null,
    detected_sheet_title: row.detected_sheet_title ? String(row.detected_sheet_title) : null,
    discipline: row.discipline ? String(row.discipline) : null,
  }));
  const uploads = await signedReanalysisUploads(admin, materialized);
  return json({
    runId,
    created: false,
    uploads,
    reused: materialized.filter((job) => job.status === "queued").length,
    added: 0,
    replaced: 0,
  });
}

async function handleReanalysis(
  admin: ReturnType<typeof createClient>,
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  if (Deno.env.get("SUPABASE_ANALYZER_ENABLED")?.toLowerCase() === "false") {
    return json({ error: "Code Analyzer is temporarily unavailable" }, 503);
  }
  const sourceRunId = String(body.sourceRunId || "");
  const requestedRunId = String(body.runId || "");
  if (!sourceRunId) return json({ error: "sourceRunId is required" }, 400);
  if (!requestedRunId) return json({ error: "runId is required" }, 400);
  if (requestedRunId === sourceRunId) return json({ error: "Reanalysis needs a new run" }, 400);
  if (body.confirmed !== true) {
    return json({ error: "Confirm reanalysis before queueing drawings" }, 409);
  }

  const requestedMode = normalizeNewRunAnalysisMode(body.analysisMode);
  if (typeof requestedMode !== "string") return json({ error: requestedMode.error }, 400);

  const { data: existingRows, error: existingError } = await admin
    .from("supabase_analyzer_runs")
    .select("id, project_id, created_at")
    .eq("id", requestedRunId)
    .limit(1);
  if (existingError) throw existingError;
  const existing = existingRows?.[0];
  if (existing) {
    if (String(existing.project_id) !== projectId) return json({ error: "Analyzer run not found" }, 404);
    const replay = await replayReanalysis(
      admin,
      requestedRunId,
      projectId,
      String(existing.created_at || ""),
    );
    if (replay) return replay;
  }

  const { data: sourceRows, error: sourceError } = await admin
    .from("supabase_analyzer_runs")
    .select("id, status, budget_limit_usd, jurisdiction_key, jurisdiction_label, project_type, code_edition, code_context")
    .eq("id", sourceRunId)
    .eq("project_id", projectId)
    .limit(1);
  if (sourceError) throw sourceError;
  const source = sourceRows?.[0];
  if (!source) return json({ error: "Analyzer run not found" }, 404);
  if (runIsWorkerActive(String(source.status))) {
    return json({ error: "This analysis is still processing" }, 409);
  }

  const requested = Array.isArray(body.files) ? body.files as Array<Record<string, unknown>> : [];
  const incoming: IncomingAnalyzerSheet[] = requested.map((input) => ({
    name: String(input?.name || ""),
    size: Number(input?.size),
    type: String(input?.type || "application/pdf"),
    replaceJobId: input?.replaceJobId ? String(input.replaceJobId) : null,
  }));
  const scope = body.scope === "all" ? "all" : "selected";
  const jobIds = Array.isArray(body.jobIds)
    ? body.jobIds.map(String).filter(Boolean).slice(0, MAX_SHEETS)
    : [];

  const { data: jobRows, error: jobsError } = await admin
    .from("supabase_analyzer_sheet_jobs")
    .select("id, ordinal, original_file_name, file_size, detected_sheet_number, detected_sheet_title, discipline, status, object_path")
    .eq("run_id", sourceRunId)
    .eq("project_id", projectId);
  if (jobsError) throw jobsError;
  const sourceSheets: ReanalysisSourceSheet[] = (jobRows || []).map((row) => ({
    id: String(row.id),
    ordinal: Number(row.ordinal),
    original_file_name: String(row.original_file_name),
    file_size: Number(row.file_size),
    detected_sheet_number: row.detected_sheet_number ? String(row.detected_sheet_number) : null,
    detected_sheet_title: row.detected_sheet_title ? String(row.detected_sheet_title) : null,
    discipline: row.discipline ? String(row.discipline) : null,
    status: String(row.status),
    object_path: String(row.object_path || ""),
  }));

  const draft = planReanalysis({
    sourceRunId,
    jobs: sourceSheets,
    selectedJobIds: scope === "all" ? "all" : jobIds,
    incoming,
    confirmed: true,
  });
  if (!draft.accepted) {
    return json({ error: draft.error || "Confirm reanalysis before queueing drawings" }, draft.needsConfirmation ? 409 : 400);
  }

  const storageExists = await storageExistsForPaths(
    admin,
    draft.items.flatMap((item) => item.action === "reuse" && item.objectPath ? [item.objectPath] : []),
  );
  const plan = planReanalysis({
    sourceRunId,
    jobs: sourceSheets,
    selectedJobIds: scope === "all" ? "all" : jobIds,
    incoming,
    confirmed: true,
    storageExists,
  });
  if (!plan.accepted) return json({ error: plan.error || "Saved drawings could not be queued" }, 400);

  const materialized = materializeReanalysis(plan, {
    runId: requestedRunId,
    projectId,
    analysisMode: requestedMode,
    createJobId: () => crypto.randomUUID(),
    reuseSourceKey: true,
  });
  if (materialized.ok === false) return json({ error: materialized.error }, 400);

  const { count: activeRuns, error: activeError } = await admin
    .from("supabase_analyzer_runs")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .in("status", ["uploading", "queued", "processing"]);
  if (activeError) throw activeError;
  if ((activeRuns || 0) >= 2) {
    return json({ error: "This project already has two active analyzer runs" }, 409);
  }

  const jurisdictionKey = String(body.jurisdictionKey || source.jurisdiction_key || "dc").slice(0, 120);
  const jurisdictionLabel = String(body.jurisdictionLabel || source.jurisdiction_label || "Washington, DC").slice(0, 200);
  const projectType = String(body.projectType || source.project_type || "Commercial (General)").slice(0, 200);
  const codeEdition = String(body.codeEdition || source.code_edition || "2017").slice(0, 100);
  const codeContext = String(body.codeContext || source.code_context || "").slice(0, 500);
  const analysisScope = resolveAnalyzerReviewScope({
    mode: requestedMode,
    jurisdictionKey,
    jurisdictionLabel,
    codeEdition,
    codeContext,
  });
  const budget = Math.max(1, Math.min(Number(body.budgetLimitUsd) || Number(source.budget_limit_usd) || 20, 100));

  const { error: runError } = await admin.from("supabase_analyzer_runs").insert({
    id: requestedRunId,
    project_id: projectId,
    created_by: userId,
    status: materialized.value.status,
    jurisdiction_key: jurisdictionKey,
    jurisdiction_label: jurisdictionLabel,
    project_type: projectType,
    code_edition: codeEdition,
    code_context: codeContext,
    analysis_mode: requestedMode,
    analysis_scope: analysisScope,
    source_coverage: "adoption_metadata_only",
    ai_provider: "openai",
    ai_model: "gpt-4o",
    total_sheets: materialized.value.totalSheets,
    budget_limit_usd: budget,
  });
  if (runError) {
    if (isObjectPathConflict({ code: String(runError.code || ""), message: runError.message, details: String(runError.details || "") })) {
      const replay = await replayReanalysis(admin, requestedRunId, projectId, new Date().toISOString());
      if (replay) return replay;
    }
    const duplicate = String(runError.code || "") === "23505" || String(runError.message || "").toLowerCase().includes("duplicate");
    if (duplicate) {
      const replay = await replayReanalysis(admin, requestedRunId, projectId, new Date().toISOString());
      if (replay) return replay;
    }
    throw runError;
  }

  let finalJobs = materialized.value.jobs;
  const copied: string[] = [];
  try {
    const firstInsert = await admin.from("supabase_analyzer_sheet_jobs").insert(finalJobs.map(sheetJobInsert));
    if (firstInsert.error) {
      if (!isObjectPathConflict({
        code: String(firstInsert.error.code || ""),
        message: firstInsert.error.message,
        details: String(firstInsert.error.details || ""),
      })) {
        throw firstInsert.error;
      }
      const rewritten = rewriteReuseObjectPaths(finalJobs, projectId, requestedRunId);
      for (const copy of rewritten.copies) {
        const { error: copyError } = await admin.storage.from(BUCKET).copy(copy.from, copy.to);
        if (copyError) {
          throw new Error(`${copy.fileName} is saved but could not be prepared for reanalysis`);
        }
        copied.push(copy.to);
      }
      finalJobs = rewritten.jobs;
      const secondInsert = await admin.from("supabase_analyzer_sheet_jobs").insert(finalJobs.map(sheetJobInsert));
      if (secondInsert.error) throw secondInsert.error;
    }
    const uploads = await signedReanalysisUploads(admin, finalJobs);
    await admin.rpc("refresh_supabase_analyzer_run", { p_run_id: requestedRunId });
    await admin.from("supabase_analyzer_audit_events").insert({
      run_id: requestedRunId,
      project_id: projectId,
      actor_id: userId,
      event_type: "run_reanalyzed",
      metadata: {
        source_run_id: sourceRunId,
        request_id: requestedRunId,
        analysis_mode: requestedMode,
        reused: plan.reuseCount,
        added: plan.added,
        replaced: plan.replaced,
        uploads: uploads.length,
      },
    });
    if (finalJobs.some((job) => job.status === "queued")) {
      await triggerProcessor(supabaseUrl, serviceRoleKey);
    }
    return json({
      runId: requestedRunId,
      created: true,
      uploads,
      reused: plan.reuseCount,
      added: plan.added,
      replaced: plan.replaced,
    }, 201);
  } catch (error) {
    await discardReanalysisRun(admin, requestedRunId, copied);
    throw error;
  }
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
      const requestedMode = normalizeNewRunAnalysisMode(body.analysisMode);
      if (typeof requestedMode !== "string") {
        return json({ error: requestedMode.error }, 400);
      }
      const analysisScope = resolveAnalyzerReviewScope({
        mode: requestedMode,
        jurisdictionKey,
        jurisdictionLabel,
        codeEdition,
        codeContext,
      });
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
        analysis_mode: requestedMode,
        analysis_scope: analysisScope,
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
        metadata: { sheet_count: files.length, total_bytes: totalBytes, analysis_mode: requestedMode },
      });

      return json({ runId, uploads }, 201);
    }

    if (action === "reanalyze") {
      const flightKey = `${projectId}:${String(body.runId || "")}`;
      if (body.runId) {
        const pending = reanalysisFlights.get(flightKey);
        if (pending) return pending;
      }
      const promise = handleReanalysis(
        admin,
        user.id,
        projectId,
        body,
        supabaseUrl,
        serviceRoleKey,
      );
      if (!body.runId) return promise;
      const tracked = promise.finally(() => {
        reanalysisFlights.delete(flightKey);
      });
      reanalysisFlights.set(flightKey, tracked);
      return tracked;
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

    if (action === "update") {
      return await handleSheetUpdate(admin, user.id, projectId, run, body);
    }

    if (action === "retry") {
      if (run.status === "cancelled") return json({ error: "Run is cancelled" }, 409);
      const requestedIds = Array.isArray(body.jobIds)
        ? body.jobIds.map(String).filter(Boolean).slice(0, MAX_SHEETS)
        : [];
      const { data: failedJobs, error: failedError } = await admin
        .from("supabase_analyzer_sheet_jobs")
        .select("id, status, error_code")
        .eq("run_id", runId)
        .eq("project_id", projectId)
        .eq("status", "failed");
      if (failedError) throw failedError;
      const retryIds = (failedJobs || [])
        .filter((job) => retryWouldRestart({
          status: String(job.status),
          error_code: job.error_code ? String(job.error_code) : null,
        }))
        .map((job) => String(job.id))
        .filter((id) => requestedIds.length === 0 || requestedIds.includes(id));
      if (retryIds.length === 0) return json({ retried: 0 });

      const { data: retried, error: retryError } = await admin
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
        .eq("status", "failed")
        .in("id", retryIds)
        .select("id");
      if (retryError) throw retryError;

      const retriedIds = (retried || []).map((row) => row.id);
      if (retriedIds.length > 0) {
        await admin
          .from("supabase_analyzer_findings")
          .update({ is_published: false, updated_at: new Date().toISOString() })
          .eq("run_id", runId)
          .in("sheet_job_id", retriedIds);
      }
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
        metadata: { count: retriedIds.length },
      });
      if (retriedIds.length) await triggerProcessor(supabaseUrl, serviceRoleKey);
      return json({ retried: retriedIds.length });
    }

    if (action === "cancel") {
      if (run.status === "cancelled") return json({ cancelled: true, alreadyCancelled: true });
      if (!["uploading", "queued", "processing"].includes(run.status)) {
        return json({ error: "Analysis is not running" }, 409);
      }
      const { data: cancelJobs, error: cancelJobsError } = await admin
        .from("supabase_analyzer_sheet_jobs")
        .select("id, status")
        .eq("run_id", runId)
        .eq("project_id", projectId);
      if (cancelJobsError) throw cancelJobsError;
      const effect = applyCancellation(
        (cancelJobs || []).map((row) => ({ id: String(row.id), status: String(row.status) })),
        [],
      );
      const now = new Date().toISOString();
      const { error: cancelRunError } = await admin
        .from("supabase_analyzer_runs")
        .update({
          status: "cancelled",
          cancelled_at: run.cancelled_at || now,
          updated_at: now,
        })
        .eq("id", runId)
        .eq("project_id", projectId);
      if (cancelRunError) throw cancelRunError;

      let cancelledJobIds: string[] = [];
      if (effect.cancelledJobIds.length > 0) {
        const { data: cancelledRows, error: cancelJobError } = await admin
          .from("supabase_analyzer_sheet_jobs")
          .update({
            status: "cancelled",
            error_code: "run_cancelled",
            last_error: "Analysis cancelled",
            lease_owner: null,
            lease_expires_at: null,
            completed_at: now,
            updated_at: now,
          })
          .eq("run_id", runId)
          .in("id", effect.cancelledJobIds)
          .in("status", ["upload_pending", "queued", "processing"])
          .select("id");
        if (cancelJobError) throw cancelJobError;
        cancelledJobIds = (cancelledRows || []).map((row) => String(row.id));
        if (cancelledJobIds.length > 0) {
          await admin
            .from("supabase_analyzer_findings")
            .update({ is_published: false, updated_at: now })
            .eq("run_id", runId)
            .in("sheet_job_id", cancelledJobIds);
        }
      }
      await admin.rpc("refresh_supabase_analyzer_run", { p_run_id: runId });
      await admin.from("supabase_analyzer_audit_events").insert({
        run_id: runId,
        project_id: projectId,
        actor_id: user.id,
        event_type: "run_cancelled",
        metadata: { cancelled_jobs: cancelledJobIds.length },
      });
      return json({ cancelled: true, cancelledJobs: cancelledJobIds.length });
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
