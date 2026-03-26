import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCRAPER_SERVICE_URL = Deno.env.get("SCRAPER_SERVICE_URL") || "http://localhost:3001";
const AGENT_TIMEOUT_MS = 120_000;
const MAX_REAUTH_ATTEMPTS = 2;

interface FilingRecord {
  id: string;
  project_id: string;
  user_id: string;
  filing_status: string;
  permit_type: string | null;
  permit_subtype: string | null;
  review_track: string | null;
  property_address: string | null;
  scope_of_work: string | null;
  construction_value: number | null;
  property_type: string | null;
  estimated_fee: number | null;
  application_id: string | null;
  confirmation_number: string | null;
  approval_package: Record<string, unknown> | null;
  municipality: string | null;
  credential_id: string | null;
}

interface MunicipalityConfig {
  id: string;
  municipality_key: string;
  display_name: string;
  short_name: string;
  state: string;
  county: string | null;
  portal_type: string;
  portal_base_url: string;
  login_url: string | null;
  property_data_source: string | null;
  license_validation_source: string | null;
  permit_types: unknown;
  agent_config: Record<string, unknown>;
  is_active: boolean;
}

interface PortalConfig {
  portal_type: string;
  portal_base_url: string;
  login_url: string | null;
  municipality_key: string;
  display_name: string;
  agent_config: Record<string, unknown>;
}

interface AgentRunRecord {
  filing_id: string;
  agent_name: string;
  layer: number;
  status: string;
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface ExecutionCheckpoint {
  current_step: string;
  session_token: string | null;
  auth_completed: boolean;
  form_filing_completed: boolean;
  submission_completed: boolean;
  monitor_started: boolean;
  last_error: string | null;
  reauth_attempts: number;
}

const DEFAULT_PORTAL_CONFIG: PortalConfig = {
  portal_type: "accela",
  portal_base_url: "https://permitwizard.dcra.dc.gov",
  login_url: "https://login.dc.gov",
  municipality_key: "dc_dob",
  display_name: "DC Department of Buildings",
  agent_config: {
    sso_type: "access_dc",
    agency_short: "DC DOB",
  },
};

function getLoginEndpoint(portalConfig: PortalConfig): string {
  return "/api/filing/login";
}

function getFileEndpoint(portalConfig: PortalConfig): string {
  return "/api/filing/file";
}

function getSubmitEndpoint(portalConfig: PortalConfig): string {
  return "/api/filing/submit";
}

function getLogoutEndpoint(portalConfig: PortalConfig): string {
  return "/api/filing/logout";
}

function getReauthEndpoint(portalConfig: PortalConfig): string {
  return "/api/filing/reauth";
}

function useLegacyEndpoints(portalConfig: PortalConfig): boolean {
  return portalConfig.municipality_key === "dc_dob" &&
    portalConfig.portal_type === "accela";
}

async function createAgentRun(
  supabase: ReturnType<typeof createClient>,
  run: AgentRunRecord,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("agent_runs")
    .insert(run)
    .select("id")
    .single();

  if (error) {
    console.warn(`[permitwizard-execute] Failed to create agent_run: ${error.message}`);
    return null;
  }
  return data?.id || null;
}

async function updateAgentRun(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  updates: Partial<AgentRunRecord>,
) {
  const { error } = await supabase
    .from("agent_runs")
    .update(updates)
    .eq("id", runId);

  if (error) {
    console.warn(`[permitwizard-execute] Failed to update agent_run ${runId}: ${error.message}`);
  }
}

async function updateFilingStatus(
  supabase: ReturnType<typeof createClient>,
  filingId: string,
  status: string,
  extraFields?: Record<string, unknown>,
) {
  const payload: Record<string, unknown> = {
    filing_status: status,
    updated_at: new Date().toISOString(),
    ...extraFields,
  };

  const { error } = await supabase
    .from("permit_filings")
    .update(payload)
    .eq("id", filingId);

  if (error) {
    console.error(`[permitwizard-execute] Failed to update filing ${filingId}: ${error.message}`);
  }
}

async function callScraperService(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs?: number,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = timeoutMs || AGENT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${SCRAPER_SERVICE_URL}${endpoint}`;
    console.log(`[permitwizard-execute] Calling scraper: ${endpoint}`);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw_response: text.slice(0, 500) };
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: 0,
      data: {
        error: isTimeout
          ? `Scraper service call timed out after ${timeout}ms`
          : (err instanceof Error ? err.message : String(err)),
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callEdgeFunction(
  supabaseUrl: string,
  functionName: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  try {
    const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw_response: text.slice(0, 500) };
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: 0,
      data: {
        error: isTimeout ? "Edge function call timed out" : (err instanceof Error ? err.message : String(err)),
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadMunicipalityConfig(
  supabase: ReturnType<typeof createClient>,
  municipalityKey: string,
): Promise<MunicipalityConfig | null> {
  const { data, error } = await supabase
    .from("municipality_configs")
    .select("*")
    .eq("municipality_key", municipalityKey)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    console.warn(`[permitwizard-execute] Municipality config not found for key: ${municipalityKey}`);
    return null;
  }

  return data as MunicipalityConfig;
}

function buildPortalConfig(municipalityConfig: MunicipalityConfig): PortalConfig {
  return {
    portal_type: municipalityConfig.portal_type,
    portal_base_url: municipalityConfig.portal_base_url,
    login_url: municipalityConfig.login_url,
    municipality_key: municipalityConfig.municipality_key,
    display_name: municipalityConfig.display_name,
    agent_config: municipalityConfig.agent_config || {},
  };
}

async function executeAuthentication(
  supabase: ReturnType<typeof createClient>,
  filing: FilingRecord,
  checkpoint: ExecutionCheckpoint,
  portalConfig: PortalConfig,
): Promise<{ success: boolean; sessionToken: string | null; error: string | null; requiresHuman: boolean }> {
  const startedAt = new Date().toISOString();

  let credentialQuery = supabase
    .from("portal_credentials")
    .select("id, portal_username, portal_password");

  if (filing.credential_id) {
    credentialQuery = credentialQuery.eq("id", filing.credential_id);
  } else {
    credentialQuery = credentialQuery.eq("user_id", filing.user_id).limit(1);
  }

  const { data: credentials } = await credentialQuery.maybeSingle();

  const inputData: Record<string, unknown> = {
    filing_id: filing.id,
    has_credentials: !!credentials,
    credential_id: credentials?.id || null,
    municipality_key: portalConfig.municipality_key,
    portal_type: portalConfig.portal_type,
  };

  const runId = await createAgentRun(supabase, {
    filing_id: filing.id,
    agent_name: "authentication",
    layer: 2,
    status: "running",
    input_data: inputData,
    output_data: null,
    error_message: null,
    started_at: startedAt,
    completed_at: null,
  });

  if (!credentials) {
    const errorMsg = "No portal credentials found for user. Please configure credentials in Settings.";
    if (runId) {
      await updateAgentRun(supabase, runId, {
        status: "failed",
        error_message: errorMsg,
        completed_at: new Date().toISOString(),
      });
    }
    return { success: false, sessionToken: null, error: errorMsg, requiresHuman: false };
  }

  const loginBody: Record<string, unknown> = {
    credentialId: credentials.id,
    username: credentials.portal_username,
    password: credentials.portal_password,
    userId: filing.user_id,
    portal_type: portalConfig.portal_type,
    portal_config: {
      baseUrl: portalConfig.portal_base_url,
      loginUrl: portalConfig.login_url,
      ssoType: portalConfig.agent_config.sso_type || null,
      municipalityKey: portalConfig.municipality_key,
    },
  };

  const isLegacy = useLegacyEndpoints(portalConfig);
  const loginEndpoint = isLegacy ? "/api/permitwizard/login" : getLoginEndpoint(portalConfig);
  const loginRes = await callScraperService(loginEndpoint, loginBody);

  if (!loginRes.ok) {
    const isCaptcha = loginRes.data.error === "captcha_detected";
    const errorMsg = String(loginRes.data.message || loginRes.data.error || "Authentication failed");

    if (runId) {
      await updateAgentRun(supabase, runId, {
        status: isCaptcha ? "waiting_human" : "failed",
        output_data: loginRes.data,
        error_message: errorMsg,
        completed_at: new Date().toISOString(),
      });
    }

    return {
      success: false,
      sessionToken: null,
      error: errorMsg,
      requiresHuman: isCaptcha || (loginRes.data.doNotRetry as boolean) === true,
    };
  }

  const sessionToken = loginRes.data.sessionToken as string;

  if (runId) {
    await updateAgentRun(supabase, runId, {
      status: "completed",
      output_data: {
        session_token_prefix: sessionToken ? sessionToken.substring(0, 8) + "..." : null,
        expires_at: loginRes.data.expiresAt,
        portal_url: loginRes.data.portalUrl,
        portal_type: portalConfig.portal_type,
        municipality_key: portalConfig.municipality_key,
      },
      completed_at: new Date().toISOString(),
    });
  }

  return { success: true, sessionToken, error: null, requiresHuman: false };
}

async function executeFormFiling(
  supabase: ReturnType<typeof createClient>,
  filing: FilingRecord,
  sessionToken: string,
  portalConfig: PortalConfig,
): Promise<{ success: boolean; error: string | null; requiresReauth: boolean; data: Record<string, unknown> | null }> {
  const startedAt = new Date().toISOString();

  const { data: professionals } = await supabase
    .from("filing_professionals")
    .select("professional_name, license_type, license_number, role_on_project")
    .eq("filing_id", filing.id);

  const { data: documents } = await supabase
    .from("filing_documents")
    .select("document_name, document_type, file_url, file_size_bytes, file_format, upload_order")
    .eq("filing_id", filing.id)
    .order("upload_order", { ascending: true });

  const filingData: Record<string, unknown> = {
    filing_id: filing.id,
    property_address: filing.property_address,
    permit_type: filing.permit_type,
    permit_subtype: filing.permit_subtype,
    review_track: filing.review_track,
    scope_of_work: filing.scope_of_work,
    construction_value: filing.construction_value,
    property_type: filing.property_type,
    estimated_fee: filing.estimated_fee,
    professionals: professionals || [],
    documents: (documents || []).map((d: Record<string, unknown>) => ({
      document_name: d.document_name,
      document_type: d.document_type,
      file_url: d.file_url,
      upload_order: d.upload_order,
    })),
  };

  const inputData: Record<string, unknown> = {
    filing_id: filing.id,
    property_address: filing.property_address,
    permit_type: filing.permit_type,
    professionals_count: (professionals || []).length,
    documents_count: (documents || []).length,
    portal_type: portalConfig.portal_type,
    municipality_key: portalConfig.municipality_key,
  };

  const runId = await createAgentRun(supabase, {
    filing_id: filing.id,
    agent_name: "form_filing",
    layer: 2,
    status: "running",
    input_data: inputData,
    output_data: null,
    error_message: null,
    started_at: startedAt,
    completed_at: null,
  });

  const isLegacy = useLegacyEndpoints(portalConfig);
  const fileEndpoint = isLegacy ? "/api/permitwizard/file" : getFileEndpoint(portalConfig);
  const fileRes = await callScraperService(fileEndpoint, {
    sessionToken,
    filingId: filing.id,
    filingData,
    portal_type: portalConfig.portal_type,
    portal_config: {
      baseUrl: portalConfig.portal_base_url,
      municipalityKey: portalConfig.municipality_key,
      agentConfig: portalConfig.agent_config,
    },
  }, 180_000);

  if (!fileRes.ok || !(fileRes.data.success as boolean)) {
    const requiresReauth =
      (fileRes.data.requiresReauth as boolean) === true ||
      fileRes.data.error === "session_expired" ||
      fileRes.data.error === "session_not_found";

    const errorMsg = String(fileRes.data.message || fileRes.data.error || "Form filing failed");

    if (runId) {
      await updateAgentRun(supabase, runId, {
        status: "failed",
        output_data: fileRes.data,
        error_message: errorMsg,
        completed_at: new Date().toISOString(),
      });
    }

    return { success: false, error: errorMsg, requiresReauth, data: fileRes.data };
  }

  if (runId) {
    await updateAgentRun(supabase, runId, {
      status: "completed",
      output_data: {
        steps_completed: fileRes.data.steps_completed,
        total_steps: fileRes.data.total_steps,
        screenshots_count: Array.isArray(fileRes.data.screenshots)
          ? (fileRes.data.screenshots as unknown[]).length
          : 0,
        stopped_before_submit: fileRes.data.stopped_before_submit,
        portal_type: portalConfig.portal_type,
      },
      completed_at: new Date().toISOString(),
    });
  }

  return { success: true, error: null, requiresReauth: false, data: fileRes.data };
}

async function executeSubmission(
  supabase: ReturnType<typeof createClient>,
  filing: FilingRecord,
  sessionToken: string,
  portalConfig: PortalConfig,
): Promise<{ success: boolean; error: string | null; requiresReauth: boolean; data: Record<string, unknown> | null }> {
  const startedAt = new Date().toISOString();

  const filingData: Record<string, unknown> = {
    filing_id: filing.id,
    property_address: filing.property_address,
    permit_type: filing.permit_type,
    scope_of_work: filing.scope_of_work,
    construction_value: filing.construction_value,
  };

  const runId = await createAgentRun(supabase, {
    filing_id: filing.id,
    agent_name: "submission_finalization",
    layer: 2,
    status: "running",
    input_data: {
      filing_id: filing.id,
      portal_type: portalConfig.portal_type,
      municipality_key: portalConfig.municipality_key,
    },
    output_data: null,
    error_message: null,
    started_at: startedAt,
    completed_at: null,
  });

  const isLegacy = useLegacyEndpoints(portalConfig);
  const submitEndpoint = isLegacy ? "/api/permitwizard/submit" : getSubmitEndpoint(portalConfig);
  const submitRes = await callScraperService(submitEndpoint, {
    sessionToken,
    filingId: filing.id,
    filingData,
    portal_type: portalConfig.portal_type,
    portal_config: {
      baseUrl: portalConfig.portal_base_url,
      municipalityKey: portalConfig.municipality_key,
      agentConfig: portalConfig.agent_config,
    },
  }, 120_000);

  if (!submitRes.ok || !(submitRes.data.success as boolean)) {
    const requiresReauth =
      (submitRes.data.requiresReauth as boolean) === true ||
      submitRes.data.error === "session_expired" ||
      submitRes.data.error === "session_not_found";

    const errorMsg = String(submitRes.data.message || submitRes.data.error || "Submission finalization failed");

    if (runId) {
      await updateAgentRun(supabase, runId, {
        status: "failed",
        output_data: submitRes.data,
        error_message: errorMsg,
        completed_at: new Date().toISOString(),
      });
    }

    return { success: false, error: errorMsg, requiresReauth, data: submitRes.data };
  }

  if (runId) {
    await updateAgentRun(supabase, runId, {
      status: "completed",
      output_data: {
        application_id: submitRes.data.application_id,
        confirmation_number: submitRes.data.confirmation_number,
        confirmation_message: submitRes.data.confirmation_message,
        submitted_at: submitRes.data.submitted_at,
        portal_type: portalConfig.portal_type,
      },
      completed_at: new Date().toISOString(),
    });
  }

  return { success: true, error: null, requiresReauth: false, data: submitRes.data };
}

async function executeStatusMonitor(
  supabaseUrl: string,
  agentHeaders: Record<string, string>,
  supabase: ReturnType<typeof createClient>,
  filing: FilingRecord,
  portalConfig: PortalConfig,
): Promise<{ success: boolean; error: string | null; data: Record<string, unknown> | null }> {
  const startedAt = new Date().toISOString();

  const runId = await createAgentRun(supabase, {
    filing_id: filing.id,
    agent_name: "status_monitor",
    layer: 3,
    status: "running",
    input_data: {
      filing_id: filing.id,
      application_id: filing.application_id,
      confirmation_number: filing.confirmation_number,
      municipality_key: portalConfig.municipality_key,
      portal_type: portalConfig.portal_type,
    },
    output_data: null,
    error_message: null,
    started_at: startedAt,
    completed_at: null,
  });

  const monitorRes = await callEdgeFunction(supabaseUrl, "permit-status-monitor", agentHeaders, {
    filing_id: filing.id,
    project_id: filing.project_id,
    municipality_key: portalConfig.municipality_key,
  });

  if (!monitorRes.ok) {
    const errorMsg = String(monitorRes.data.message || monitorRes.data.error || "Status monitor failed");
    if (runId) {
      await updateAgentRun(supabase, runId, {
        status: "failed",
        output_data: monitorRes.data,
        error_message: errorMsg,
        completed_at: new Date().toISOString(),
      });
    }
    return { success: false, error: errorMsg, data: monitorRes.data };
  }

  if (runId) {
    await updateAgentRun(supabase, runId, {
      status: "completed",
      output_data: monitorRes.data,
      completed_at: new Date().toISOString(),
    });
  }

  return { success: true, error: null, data: monitorRes.data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  console.log("[permitwizard-execute] start");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !anonKey) {
      return new Response(
        JSON.stringify({ code: 500, message: "SUPABASE_URL or SUPABASE_ANON_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ code: 401, message: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminSupabase = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : userSupabase;

    const body = await req.json().catch(() => ({}));
    const filingId = body.filing_id as string | undefined;
    const resumeFromStep = body.resume_from as string | undefined;

    if (!filingId) {
      return new Response(
        JSON.stringify({ code: 400, message: "filing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: filing, error: filingError } = await userSupabase
      .from("permit_filings")
      .select("*")
      .eq("id", filingId)
      .single();

    if (filingError || !filing) {
      return new Response(
        JSON.stringify({ code: 404, message: "Filing not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const allowedStatuses = ["approved", "filing", "failed"];
    if (!allowedStatuses.includes(filing.filing_status)) {
      return new Response(
        JSON.stringify({
          code: 400,
          message: `Filing status must be 'approved', 'filing', or 'failed' to execute. Current: '${filing.filing_status}'`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let portalConfig: PortalConfig = DEFAULT_PORTAL_CONFIG;

    if (filing.municipality) {
      console.log(`[permitwizard-execute] Loading municipality config for: ${filing.municipality}`);
      const muniConfig = await loadMunicipalityConfig(adminSupabase, filing.municipality);

      if (muniConfig) {
        portalConfig = buildPortalConfig(muniConfig);
        console.log(`[permitwizard-execute] Using portal_type=${portalConfig.portal_type} for ${portalConfig.display_name}`);
      } else {
        console.warn(`[permitwizard-execute] Municipality config not found for '${filing.municipality}', falling back to DC defaults`);
      }
    } else {
      console.log("[permitwizard-execute] No municipality set on filing, using DC defaults");
    }

    await updateFilingStatus(adminSupabase, filingId, "filing");

    const agentHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": authHeader,
      "apikey": anonKey,
    };

    const checkpoint: ExecutionCheckpoint = {
      current_step: resumeFromStep || "authentication",
      session_token: null,
      auth_completed: false,
      form_filing_completed: false,
      submission_completed: false,
      monitor_started: false,
      last_error: null,
      reauth_attempts: 0,
    };

    const executionLog: Record<string, unknown>[] = [];

    const shouldRunStep = (step: string): boolean => {
      const stepOrder = ["authentication", "form_filing", "submission", "status_monitor"];
      const resumeIdx = resumeFromStep ? stepOrder.indexOf(resumeFromStep) : 0;
      const currentIdx = stepOrder.indexOf(step);
      return currentIdx >= resumeIdx;
    };

    if (shouldRunStep("authentication")) {
      console.log(`[permitwizard-execute] Step 1: Authentication (Agent 06) — portal_type=${portalConfig.portal_type}`);
      checkpoint.current_step = "authentication";

      const authResult = await executeAuthentication(adminSupabase, filing as FilingRecord, checkpoint, portalConfig);
      executionLog.push({
        step: "authentication",
        success: authResult.success,
        error: authResult.error,
        requires_human: authResult.requiresHuman,
        portal_type: portalConfig.portal_type,
        municipality_key: portalConfig.municipality_key,
      });

      if (!authResult.success) {
        if (authResult.requiresHuman) {
          await updateFilingStatus(adminSupabase, filingId, "failed", {
            approval_package: {
              ...(filing.approval_package as Record<string, unknown> || {}),
              execution_checkpoint: checkpoint,
              execution_error: authResult.error,
              execution_log: executionLog,
            },
          });

          return new Response(
            JSON.stringify({
              filing_id: filingId,
              status: "failed",
              current_step: "authentication",
              error: authResult.error,
              requires_human_intervention: true,
              portal_type: portalConfig.portal_type,
              municipality_key: portalConfig.municipality_key,
              execution_log: executionLog,
              duration_ms: Date.now() - startTime,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        await updateFilingStatus(adminSupabase, filingId, "failed");

        return new Response(
          JSON.stringify({
            filing_id: filingId,
            status: "failed",
            current_step: "authentication",
            error: authResult.error,
            portal_type: portalConfig.portal_type,
            municipality_key: portalConfig.municipality_key,
            execution_log: executionLog,
            duration_ms: Date.now() - startTime,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      checkpoint.session_token = authResult.sessionToken;
      checkpoint.auth_completed = true;
      console.log("[permitwizard-execute] Authentication successful");
    }

    if (shouldRunStep("form_filing") && checkpoint.session_token) {
      console.log(`[permitwizard-execute] Step 2: Form Filing (Agent 07) — portal_type=${portalConfig.portal_type}`);
      checkpoint.current_step = "form_filing";

      let formResult = await executeFormFiling(adminSupabase, filing as FilingRecord, checkpoint.session_token, portalConfig);

      if (!formResult.success && formResult.requiresReauth && checkpoint.reauth_attempts < MAX_REAUTH_ATTEMPTS) {
        console.log("[permitwizard-execute] Session expired during form filing — attempting re-auth");
        checkpoint.reauth_attempts++;

        const isLegacy = useLegacyEndpoints(portalConfig);
        const reauthEndpoint = isLegacy ? "/api/permitwizard/reauth" : getReauthEndpoint(portalConfig);
        const reauthRes = await callScraperService(reauthEndpoint, {
          sessionToken: checkpoint.session_token,
          portal_type: portalConfig.portal_type,
          portal_config: {
            baseUrl: portalConfig.portal_base_url,
            loginUrl: portalConfig.login_url,
            municipalityKey: portalConfig.municipality_key,
          },
        });

        if (reauthRes.ok && reauthRes.data.success) {
          checkpoint.session_token = reauthRes.data.sessionToken as string;
          console.log("[permitwizard-execute] Re-authentication successful — retrying form filing");
          formResult = await executeFormFiling(adminSupabase, filing as FilingRecord, checkpoint.session_token!, portalConfig);
        } else {
          console.log("[permitwizard-execute] Re-authentication failed");
          formResult = {
            success: false,
            error: "Re-authentication failed after session expiration",
            requiresReauth: false,
            data: reauthRes.data,
          };
        }
      }

      executionLog.push({
        step: "form_filing",
        success: formResult.success,
        error: formResult.error,
        reauth_attempts: checkpoint.reauth_attempts,
        portal_type: portalConfig.portal_type,
      });

      if (!formResult.success) {
        checkpoint.last_error = formResult.error;

        await updateFilingStatus(adminSupabase, filingId, "failed", {
          approval_package: {
            ...(filing.approval_package as Record<string, unknown> || {}),
            execution_checkpoint: checkpoint,
            execution_error: formResult.error,
            execution_log: executionLog,
          },
        });

        return new Response(
          JSON.stringify({
            filing_id: filingId,
            status: "failed",
            current_step: "form_filing",
            error: formResult.error,
            can_retry: true,
            resume_from: "form_filing",
            portal_type: portalConfig.portal_type,
            municipality_key: portalConfig.municipality_key,
            execution_log: executionLog,
            duration_ms: Date.now() - startTime,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      checkpoint.form_filing_completed = true;
      console.log("[permitwizard-execute] Form filing successful");
    }

    if (shouldRunStep("submission") && checkpoint.session_token) {
      console.log(`[permitwizard-execute] Step 3: Submission Finalization (Agent 08) — portal_type=${portalConfig.portal_type}`);
      checkpoint.current_step = "submission";

      let submitResult = await executeSubmission(adminSupabase, filing as FilingRecord, checkpoint.session_token, portalConfig);

      if (!submitResult.success && submitResult.requiresReauth && checkpoint.reauth_attempts < MAX_REAUTH_ATTEMPTS) {
        console.log("[permitwizard-execute] Session expired during submission — attempting re-auth");
        checkpoint.reauth_attempts++;

        const isLegacy = useLegacyEndpoints(portalConfig);
        const reauthEndpoint = isLegacy ? "/api/permitwizard/reauth" : getReauthEndpoint(portalConfig);
        const reauthRes = await callScraperService(reauthEndpoint, {
          sessionToken: checkpoint.session_token,
          portal_type: portalConfig.portal_type,
          portal_config: {
            baseUrl: portalConfig.portal_base_url,
            loginUrl: portalConfig.login_url,
            municipalityKey: portalConfig.municipality_key,
          },
        });

        if (reauthRes.ok && reauthRes.data.success) {
          checkpoint.session_token = reauthRes.data.sessionToken as string;
          console.log("[permitwizard-execute] Re-authentication successful — retrying submission");
          submitResult = await executeSubmission(adminSupabase, filing as FilingRecord, checkpoint.session_token!, portalConfig);
        } else {
          submitResult = {
            success: false,
            error: "Re-authentication failed during submission recovery",
            requiresReauth: false,
            data: reauthRes.data,
          };
        }
      }

      executionLog.push({
        step: "submission",
        success: submitResult.success,
        error: submitResult.error,
        application_id: submitResult.data?.application_id,
        confirmation_number: submitResult.data?.confirmation_number,
        portal_type: portalConfig.portal_type,
      });

      if (!submitResult.success) {
        checkpoint.last_error = submitResult.error;

        await updateFilingStatus(adminSupabase, filingId, "failed", {
          approval_package: {
            ...(filing.approval_package as Record<string, unknown> || {}),
            execution_checkpoint: checkpoint,
            execution_error: submitResult.error,
            execution_log: executionLog,
          },
        });

        return new Response(
          JSON.stringify({
            filing_id: filingId,
            status: "failed",
            current_step: "submission",
            error: submitResult.error,
            can_retry: true,
            resume_from: "submission",
            portal_type: portalConfig.portal_type,
            municipality_key: portalConfig.municipality_key,
            execution_log: executionLog,
            duration_ms: Date.now() - startTime,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      checkpoint.submission_completed = true;

      const { data: updatedFiling } = await adminSupabase
        .from("permit_filings")
        .select("application_id, confirmation_number")
        .eq("id", filingId)
        .single();

      if (updatedFiling) {
        (filing as Record<string, unknown>).application_id = updatedFiling.application_id;
        (filing as Record<string, unknown>).confirmation_number = updatedFiling.confirmation_number;
      }

      console.log("[permitwizard-execute] Submission finalization successful");
    }

    if (checkpoint.session_token) {
      console.log("[permitwizard-execute] Cleaning up session...");
      const isLegacy = useLegacyEndpoints(portalConfig);
      const logoutEndpoint = isLegacy ? "/api/permitwizard/logout" : getLogoutEndpoint(portalConfig);
      await callScraperService(logoutEndpoint, {
        sessionToken: checkpoint.session_token,
        portal_type: portalConfig.portal_type,
      }).catch(() => {});
    }

    if (shouldRunStep("status_monitor") && checkpoint.submission_completed) {
      console.log("[permitwizard-execute] Step 4: Status Monitor (Agent 09)");
      checkpoint.current_step = "status_monitor";
      checkpoint.monitor_started = true;

      const monitorResult = await executeStatusMonitor(
        supabaseUrl,
        agentHeaders,
        adminSupabase,
        filing as FilingRecord,
        portalConfig,
      );

      executionLog.push({
        step: "status_monitor",
        success: monitorResult.success,
        error: monitorResult.error,
        portal_type: portalConfig.portal_type,
      });

      if (!monitorResult.success) {
        console.warn(`[permitwizard-execute] Status monitor initial check failed: ${monitorResult.error}`);
      }
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[permitwizard-execute] Pipeline complete. Duration: ${totalDuration}ms`);

    const finalStatus = checkpoint.submission_completed ? "submitted" : "filing";

    return new Response(
      JSON.stringify({
        filing_id: filingId,
        status: finalStatus,
        auth_completed: checkpoint.auth_completed,
        form_filing_completed: checkpoint.form_filing_completed,
        submission_completed: checkpoint.submission_completed,
        monitor_started: checkpoint.monitor_started,
        application_id: (filing as FilingRecord).application_id,
        confirmation_number: (filing as FilingRecord).confirmation_number,
        portal_type: portalConfig.portal_type,
        municipality_key: portalConfig.municipality_key,
        execution_log: executionLog,
        duration_ms: totalDuration,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[permitwizard-execute] Unhandled error:", error);
    return new Response(
      JSON.stringify({
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
