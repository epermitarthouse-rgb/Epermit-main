import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  processorUnauthorizedResponse,
  verifyProcessorRequest,
} from "../_shared/processorAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "supabase-analyzer-drawings";
const MODEL = "gpt-4o";
const GLOBAL_CONCURRENCY = 3;
const PER_INVOCATION_CONCURRENCY = 2;
const MAX_JOBS_PER_INVOCATION = 8;
const MAX_BACKGROUND_MS = 125_000;
const OPENAI_TIMEOUT_MS = 110_000;
const INPUT_PRICE_PER_MILLION = 2.5;
const OUTPUT_PRICE_PER_MILLION = 10;

type ClaimedJob = {
  id: string;
  run_id: string;
  project_id: string;
  original_file_name: string;
  object_path: string;
  attempt_count: number;
  max_attempts: number;
};

type AnalyzerRun = {
  id: string;
  project_id: string;
  jurisdiction_key: string;
  jurisdiction_label: string;
  project_type: string;
  code_edition: string;
  code_context: string;
  source_coverage: string;
  ai_provider: string;
  ai_model: string;
  status: string;
  budget_limit_usd: number;
  estimated_cost_usd: number;
};

type Finding = {
  category: string;
  severity: "critical" | "warning" | "advisory";
  title: string;
  observation: string;
  drawing_evidence: string;
  drawing_location: string;
  suggested_code_reference: string;
  recommendation: string;
};

type AnalysisPayload = {
  detected_sheet_number: string;
  detected_sheet_title: string;
  discipline: string;
  summary: string;
  findings: Finding[];
};

class ProcessorError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clip(value: unknown, length: number): string {
  return String(value || "").trim().slice(0, length);
}

function normalizeSeverity(value: unknown): Finding["severity"] {
  if (value === "critical" || value === "warning" || value === "advisory") return value;
  return "advisory";
}

function parseAnalysis(value: unknown): AnalysisPayload {
  if (!value || typeof value !== "object") {
    throw new ProcessorError("Model returned an invalid analysis object", "invalid_model_output", true);
  }
  const raw = value as Record<string, unknown>;
  const rawFindings = Array.isArray(raw.findings) ? raw.findings.slice(0, 20) : [];
  const findings = rawFindings.map((item) => {
    const finding = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      category: clip(finding.category, 120) || "General",
      severity: normalizeSeverity(finding.severity),
      title: clip(finding.title, 240) || "Review observation",
      observation: clip(finding.observation, 2000),
      drawing_evidence: clip(finding.drawing_evidence, 1500),
      drawing_location: clip(finding.drawing_location, 500),
      suggested_code_reference: clip(finding.suggested_code_reference, 500),
      recommendation: clip(finding.recommendation, 1500),
    };
  }).filter((finding) => finding.observation && finding.drawing_evidence && finding.recommendation);

  return {
    detected_sheet_number: clip(raw.detected_sheet_number, 120),
    detected_sheet_title: clip(raw.detected_sheet_title, 240),
    discipline: clip(raw.discipline, 120) || "General",
    summary: clip(raw.summary, 1500),
    findings,
  };
}

function outputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];
    for (const part of content) {
      if (typeof part.text === "string") return part.text;
    }
  }
  return "";
}

async function completeJob(
  admin: SupabaseClient,
  job: ClaimedJob,
  workerId: string,
  outcome: "completed" | "retry" | "failed",
  error?: ProcessorError,
) {
  const retryDelaySeconds = Math.min(300, 30 * Math.max(1, 2 ** (job.attempt_count - 1)));
  const retryAt = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
  const { error: completionError } = await admin.rpc(
    "complete_supabase_analyzer_sheet_job",
    {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_outcome: outcome,
      p_error: error?.message || null,
      p_error_code: error?.code || null,
      p_retry_at: outcome === "retry" ? retryAt : null,
    },
  );
  if (completionError) {
    console.error("[supabase-analyzer] could not complete job", job.id, completionError);
  }
}

async function processJob(
  admin: SupabaseClient,
  job: ClaimedJob,
  workerId: string,
  openAiKey: string,
) {
  try {
    const { data: run, error: runError } = await admin
      .from("supabase_analyzer_runs")
      .select("*")
      .eq("id", job.run_id)
      .single<AnalyzerRun>();
    if (runError || !run) {
      throw new ProcessorError("Analyzer run not found", "run_not_found", false);
    }
    if (run.status === "cancelled") {
      throw new ProcessorError("Analyzer run was cancelled", "run_cancelled", false);
    }
    if (Number(run.estimated_cost_usd) >= Number(run.budget_limit_usd)) {
      throw new ProcessorError("Run budget limit reached", "budget_limit_reached", false);
    }

    const { data: fileBlob, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(job.object_path);
    if (downloadError || !fileBlob) {
      throw new ProcessorError(
        downloadError?.message || "Drawing file could not be downloaded",
        "drawing_download_failed",
        true,
      );
    }

    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    const fileData = `data:application/pdf;base64,${encodeBase64(bytes)}`;
    const systemPrompt = `You are performing a preliminary professional review of one commercial permit drawing sheet.

Review context:
- Jurisdiction: ${run.jurisdiction_label}
- Selected adopted-code context: ${run.code_context}
- Project type: ${run.project_type}
- Source coverage: adoption metadata is recorded, but complete authoritative technical code text is not supplied.

Rules:
1. Analyze only content actually visible in the attached drawing. Never infer a condition from the filename.
2. Every observation must quote or precisely describe its visible drawing evidence and location.
3. Do not call an observation a confirmed violation. Use conservative professional review language.
4. A code section is a proposed reference unless its authoritative text is present in the drawing itself.
5. Do not invent numeric thresholds, local amendments, dimensions, labels, or code sections.
6. If the drawing is illegible or lacks enough evidence, return no finding for that topic.
7. Identify the printed sheet number, printed sheet title, and discipline from the drawing title block when visible.
8. Return no more than 12 high-value observations.`;

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        detected_sheet_number: { type: "string" },
        detected_sheet_title: { type: "string" },
        discipline: { type: "string" },
        summary: { type: "string" },
        findings: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              category: { type: "string" },
              severity: { type: "string", enum: ["critical", "warning", "advisory"] },
              title: { type: "string" },
              observation: { type: "string" },
              drawing_evidence: { type: "string" },
              drawing_location: { type: "string" },
              suggested_code_reference: { type: "string" },
              recommendation: { type: "string" },
            },
            required: [
              "category",
              "severity",
              "title",
              "observation",
              "drawing_evidence",
              "drawing_location",
              "suggested_code_reference",
              "recommendation",
            ],
          },
        },
      },
      required: [
        "detected_sheet_number",
        "detected_sheet_title",
        "discipline",
        "summary",
        "findings",
      ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: systemPrompt }],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_file",
                  filename: job.original_file_name,
                  file_data: fileData,
                  detail: "high",
                },
                {
                  type: "input_text",
                  text: "Review this permit drawing sheet and return the structured preliminary observations.",
                },
              ],
            },
          ],
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: "permit_drawing_review",
              strict: true,
              schema,
            },
          },
          max_output_tokens: 3500,
        }),
      });
    } catch (error) {
      const timeoutError = error instanceof DOMException && error.name === "AbortError";
      throw new ProcessorError(
        timeoutError ? "OpenAI request timed out" : "OpenAI request could not be completed",
        timeoutError ? "openai_timeout" : "openai_network_error",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    const requestId = response.headers.get("x-request-id");
    let responsePayload: Record<string, unknown>;
    try {
      responsePayload = await response.json();
    } catch {
      responsePayload = {};
    }
    if (!response.ok) {
      const errorObject = responsePayload.error as Record<string, unknown> | undefined;
      const message = clip(errorObject?.message, 1000) || `OpenAI returned HTTP ${response.status}`;
      const transient = response.status === 408 || response.status === 409
        || response.status === 429 || response.status >= 500;
      throw new ProcessorError(message, `openai_http_${response.status}`, transient);
    }

    const rawText = outputText(responsePayload);
    if (!rawText) {
      throw new ProcessorError("OpenAI returned no analysis text", "empty_model_output", true);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      throw new ProcessorError("OpenAI returned invalid JSON", "invalid_model_json", true);
    }
    const analysis = parseAnalysis(parsedJson);
    const usage = (responsePayload.usage || {}) as Record<string, unknown>;
    const inputTokens = Math.max(0, Number(usage.input_tokens) || 0);
    const outputTokens = Math.max(0, Number(usage.output_tokens) || 0);
    const estimatedCost = (
      inputTokens * INPUT_PRICE_PER_MILLION / 1_000_000
      + outputTokens * OUTPUT_PRICE_PER_MILLION / 1_000_000
    );
    const responseModel = clip(responsePayload.model, 120) || MODEL;

    const { error: usageError } = await admin.rpc("record_supabase_analyzer_usage", {
      p_run_id: job.run_id,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_estimated_cost_usd: estimatedCost,
    });
    if (usageError) {
      throw new ProcessorError(usageError.message, "usage_accounting_failed", true);
    }

    const { error: hideError } = await admin
      .from("supabase_analyzer_findings")
      .update({ is_published: false, updated_at: new Date().toISOString() })
      .eq("sheet_job_id", job.id);
    if (hideError) throw new ProcessorError(hideError.message, "finding_prepare_failed", true);

    const { error: deleteError } = await admin
      .from("supabase_analyzer_findings")
      .delete()
      .eq("sheet_job_id", job.id);
    if (deleteError) throw new ProcessorError(deleteError.message, "finding_replace_failed", true);

    if (analysis.findings.length > 0) {
      const findingRows = analysis.findings.map((finding, index) => ({
        run_id: job.run_id,
        sheet_job_id: job.id,
        project_id: job.project_id,
        finding_index: index,
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        observation: finding.observation,
        drawing_evidence: finding.drawing_evidence,
        drawing_location: finding.drawing_location || null,
        suggested_code_reference: finding.suggested_code_reference || null,
        recommendation: finding.recommendation,
        ai_provider: "openai",
        ai_model: responseModel,
        jurisdiction_key: run.jurisdiction_key,
        code_edition: run.code_edition,
        provenance_status: "model_generated_from_uploaded_pdf",
        verification_status: "proposed_reference",
        is_published: false,
        raw_metadata: {
          source_object_path: job.object_path,
          source_file_name: job.original_file_name,
          detected_sheet_number: analysis.detected_sheet_number,
          detected_sheet_title: analysis.detected_sheet_title,
          discipline: analysis.discipline,
          openai_response_id: responsePayload.id || null,
          openai_request_id: requestId,
        },
      }));
      const { error: findingsError } = await admin
        .from("supabase_analyzer_findings")
        .insert(findingRows);
      if (findingsError) {
        throw new ProcessorError(findingsError.message, "finding_persist_failed", true);
      }
    }

    const { error: jobUpdateError } = await admin
      .from("supabase_analyzer_sheet_jobs")
      .update({
        discipline: analysis.discipline,
        detected_sheet_number: analysis.detected_sheet_number || null,
        detected_sheet_title: analysis.detected_sheet_title || null,
        analysis_summary: analysis.summary,
        ai_model: responseModel,
        openai_response_id: clip(responsePayload.id, 200) || null,
        openai_request_id: requestId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: estimatedCost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("lease_owner", workerId);
    if (jobUpdateError) {
      throw new ProcessorError(jobUpdateError.message, "job_metadata_failed", true);
    }

    await admin.from("supabase_analyzer_audit_events").insert({
      run_id: job.run_id,
      sheet_job_id: job.id,
      project_id: job.project_id,
      event_type: "sheet_analysis_completed",
      metadata: {
        finding_count: analysis.findings.length,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: estimatedCost,
        model: responseModel,
        response_id: responsePayload.id || null,
        request_id: requestId,
      },
    });
    await completeJob(admin, job, workerId, "completed");
  } catch (error) {
    const processorError = error instanceof ProcessorError
      ? error
      : new ProcessorError(
        error instanceof Error ? error.message : "Unexpected processing error",
        "unexpected_processor_error",
        true,
      );
    const shouldRetry = processorError.transient && job.attempt_count < job.max_attempts;
    console.error(
      "[supabase-analyzer] sheet failed",
      job.id,
      processorError.code,
      processorError.message,
    );
    await admin.from("supabase_analyzer_audit_events").insert({
      run_id: job.run_id,
      sheet_job_id: job.id,
      project_id: job.project_id,
      event_type: shouldRetry ? "sheet_analysis_retry_scheduled" : "sheet_analysis_failed",
      metadata: {
        attempt: job.attempt_count,
        max_attempts: job.max_attempts,
        error_code: processorError.code,
        error: processorError.message.slice(0, 1000),
      },
    });
    await completeJob(admin, job, workerId, shouldRetry ? "retry" : "failed", processorError);
  }
}

async function processQueue(admin: SupabaseClient, openAiKey: string, invocationId: string) {
  const started = Date.now();
  let claimedTotal = 0;

  while (
    claimedTotal < MAX_JOBS_PER_INVOCATION
    && Date.now() - started < MAX_BACKGROUND_MS
  ) {
    const batch: ClaimedJob[] = [];
    for (let index = 0; index < PER_INVOCATION_CONCURRENCY; index++) {
      const workerId = `${invocationId}:${claimedTotal + index}`;
      const { data, error } = await admin.rpc("claim_supabase_analyzer_sheet_job", {
        p_worker_id: workerId,
        p_lease_ttl_seconds: 240,
        p_global_concurrency: GLOBAL_CONCURRENCY,
      });
      if (error) {
        console.error("[supabase-analyzer] claim failed", error);
        break;
      }
      if (!data?.id) break;
      batch.push(data as ClaimedJob);
    }

    if (batch.length === 0) break;
    await Promise.all(
      batch.map((job, index) =>
        processJob(admin, job, `${invocationId}:${claimedTotal + index}`, openAiKey)
      ),
    );
    claimedTotal += batch.length;
  }

  console.log("[supabase-analyzer] invocation complete", {
    invocationId,
    claimedTotal,
    durationMs: Date.now() - started,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = verifyProcessorRequest(req);
  if (!auth.authorized) return processorUnauthorizedResponse(auth, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
    return json({ error: "Processor is not configured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const invocationId = crypto.randomUUID();
  const task = processQueue(admin, openAiKey, invocationId);
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(task);
  } else {
    await task;
  }

  return json({ accepted: true, invocationId }, 202);
});
