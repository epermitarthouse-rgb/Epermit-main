import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Professional {
  professional_name: string;
  license_type: string;
  license_number: string;
  role_on_project: string;
}

interface ValidationResult {
  professional_name: string;
  license_type: string;
  license_number: string;
  role_on_project: string;
  validation_status: "active" | "expired" | "not_found" | "pending";
  expiration_date: string | null;
  scope_of_license: string | null;
  validation_source: string;
  error?: string;
}

type LicenseValidationSource = "dlcp_dc" | "dllr_md" | "dpor_va" | "none";

interface ValidationSourceConfig {
  source: LicenseValidationSource;
  label: string;
  baseUrl: string;
  searchPath: string;
}

const VALIDATION_SOURCES: Record<string, ValidationSourceConfig> = {
  dlcp_dc: {
    source: "dlcp_dc",
    label: "DC DLCP",
    baseUrl: "https://verify.dcra.dc.gov",
    searchPath: "/api/license/search",
  },
  dllr_md: {
    source: "dllr_md",
    label: "MD DLLR",
    baseUrl: "https://www.dllr.state.md.us",
    searchPath: "/api/license/verify",
  },
  dpor_va: {
    source: "dpor_va",
    label: "VA DPOR",
    baseUrl: "https://www.dpor.virginia.gov",
    searchPath: "/api/license/lookup",
  },
};

const MUNICIPALITY_TO_SOURCE: Record<string, LicenseValidationSource> = {
  dc_dob: "dlcp_dc",
  baltimore_city_md: "dllr_md",
  howard_county_md: "dllr_md",
  pg_county_md: "dllr_md",
  montgomery_county_md: "dllr_md",
  anne_arundel_county_md: "dllr_md",
  fairfax_county_va: "dpor_va",
  arlington_county_va: "dpor_va",
  alexandria_va: "dpor_va",
  loudoun_county_va: "dpor_va",
};

const EXPEDITER_ROLES = ["expediter", "permit_expediter", "permit expediter"];

interface HardStopConfig {
  requireExpediterLicense: boolean;
  hardStopRoles: string[];
}

function getHardStopConfig(municipalityKey: string): HardStopConfig {
  if (municipalityKey === "dc_dob") {
    return {
      requireExpediterLicense: true,
      hardStopRoles: EXPEDITER_ROLES,
    };
  }
  return {
    requireExpediterLicense: false,
    hardStopRoles: [],
  };
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getValidationSource(municipalityKey: string): ValidationSourceConfig | null {
  const sourceKey = MUNICIPALITY_TO_SOURCE[municipalityKey];
  if (!sourceKey || sourceKey === "none") return null;
  return VALIDATION_SOURCES[sourceKey] || null;
}

function parseValidationStatus(
  data: Record<string, unknown>
): { status: ValidationResult["validation_status"]; expirationDate: string | null; scope: string | null } {
  const rawStatus = (data.status as string || "").toLowerCase();
  const expirationDate = data.expiration_date as string | null;
  const scope = data.scope as string | null;

  let status: ValidationResult["validation_status"] = "not_found";

  if (rawStatus === "active" || rawStatus === "valid" || rawStatus === "current") {
    if (expirationDate) {
      const expDate = new Date(expirationDate);
      if (expDate < new Date()) {
        status = "expired";
      } else {
        status = "active";
      }
    } else {
      status = "active";
    }
  } else if (rawStatus === "expired" || rawStatus === "inactive" || rawStatus === "lapsed") {
    status = "expired";
  }

  return { status, expirationDate, scope };
}

async function validateLicenseWithSource(
  professional: Professional,
  sourceConfig: ValidationSourceConfig
): Promise<ValidationResult> {
  const result: ValidationResult = {
    professional_name: professional.professional_name,
    license_type: professional.license_type,
    license_number: professional.license_number,
    role_on_project: professional.role_on_project,
    validation_status: "pending",
    expiration_date: null,
    scope_of_license: null,
    validation_source: sourceConfig.label,
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const searchUrl = `${sourceConfig.baseUrl}${sourceConfig.searchPath}?number=${encodeURIComponent(professional.license_number)}&type=${encodeURIComponent(professional.license_type)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      let response: Response;
      try {
        response = await fetch(searchUrl, {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.status === 404) {
        result.validation_status = "not_found";
        console.log(
          `[license-validation] [${sourceConfig.label}] License not found: ${professional.license_number} (${professional.license_type})`
        );
        return result;
      }

      if (!response.ok) {
        const statusText = response.statusText;
        console.warn(
          `[license-validation] [${sourceConfig.label}] returned ${response.status} ${statusText} for ${professional.license_number}, attempt ${attempt + 1}/${MAX_RETRIES}`
        );
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        result.validation_status = "not_found";
        result.error = `${sourceConfig.label} unavailable after ${MAX_RETRIES} attempts: ${response.status} ${statusText}`;
        return result;
      }

      let data: Record<string, unknown>;
      try {
        data = await response.json();
      } catch {
        console.warn(`[license-validation] [${sourceConfig.label}] Non-JSON response for ${professional.license_number}`);
        result.validation_status = "not_found";
        result.error = `${sourceConfig.label} returned non-JSON response`;
        return result;
      }

      const parsed = parseValidationStatus(data);
      result.validation_status = parsed.status;
      result.expiration_date = parsed.expirationDate || null;
      result.scope_of_license = parsed.scope || null;

      console.log(
        `[license-validation] [${sourceConfig.label}] ${professional.license_number} (${professional.license_type}): ${result.validation_status}`
      );
      return result;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      console.warn(
        `[license-validation] [${sourceConfig.label}] Error validating ${professional.license_number}, attempt ${attempt + 1}/${MAX_RETRIES}:`,
        isAbort ? "timeout" : err
      );
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      result.validation_status = "not_found";
      result.error = isAbort
        ? `${sourceConfig.label} request timed out`
        : err instanceof Error
          ? err.message
          : "Unknown error";
      return result;
    }
  }

  return result;
}

function createFallbackResult(
  professional: Professional,
  municipalityKey: string
): ValidationResult {
  return {
    professional_name: professional.professional_name,
    license_type: professional.license_type,
    license_number: professional.license_number,
    role_on_project: professional.role_on_project,
    validation_status: "pending",
    expiration_date: null,
    scope_of_license: null,
    validation_source: "none",
    error: `License validation not yet configured for municipality: ${municipalityKey}. Manual verification required.`,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[license-validation] start");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.warn("[license-validation] JWT validation failed:", userError?.message ?? "No user");
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const filingId = body.filing_id as string | undefined;
    const professionals = body.professionals as Professional[] | undefined;
    const municipalityKey = (body.municipality_key as string) || "dc_dob";

    console.log("[license-validation] filing_id:", filingId ?? "(missing)", "municipality:", municipalityKey, "user.id:", user.id);

    if (!filingId) {
      return new Response(
        JSON.stringify({ code: 400, message: "filing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!professionals || !Array.isArray(professionals) || professionals.length === 0) {
      return new Response(
        JSON.stringify({ code: 400, message: "professionals array is required and must not be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dbClient = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : userClient;

    const { data: filing, error: filingError } = await dbClient
      .from("permit_filings")
      .select("id, user_id, filing_status")
      .eq("id", filingId)
      .single();

    if (filingError || !filing) {
      return new Response(
        JSON.stringify({ code: 404, message: "Filing not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sourceConfig = getValidationSource(municipalityKey);
    const hardStopConfig = getHardStopConfig(municipalityKey);
    const validationSourceLabel = sourceConfig?.label || "none";

    console.log(
      `[license-validation] Using source: ${validationSourceLabel}, hardStop expediter: ${hardStopConfig.requireExpediterLicense}`
    );

    const agentRunPayload = {
      filing_id: filingId,
      agent_name: "license_validation",
      layer: 1,
      status: "running",
      input_data: { professionals, municipality_key: municipalityKey, validation_source: validationSourceLabel },
      started_at: new Date().toISOString(),
    };

    const { data: agentRun, error: agentRunError } = await dbClient
      .from("agent_runs")
      .insert(agentRunPayload)
      .select("id")
      .single();

    if (agentRunError) {
      console.error("[license-validation] Failed to create agent_run:", agentRunError.message);
    }

    const agentRunId = agentRun?.id;

    const validationResults: ValidationResult[] = [];
    let hasHardStop = false;
    let hardStopError = "";

    for (const professional of professionals) {
      let result: ValidationResult;

      if (sourceConfig) {
        result = await validateLicenseWithSource(professional, sourceConfig);
      } else {
        result = createFallbackResult(professional, municipalityKey);
        console.log(
          `[license-validation] No validation source for ${municipalityKey}, returning fallback for ${professional.license_number}`
        );
      }

      validationResults.push(result);

      const insertPayload = {
        filing_id: filingId,
        professional_name: result.professional_name,
        license_type: result.license_type,
        license_number: result.license_number,
        role_on_project: result.role_on_project,
        validation_status: result.validation_status,
        expiration_date: result.expiration_date,
        scope_of_license: result.scope_of_license,
      };

      const { error: insertError } = await dbClient
        .from("license_validations")
        .insert(insertPayload);

      if (insertError) {
        console.error(
          `[license-validation] Failed to insert validation for ${result.professional_name}:`,
          insertError.message
        );
      }

      if (
        hardStopConfig.requireExpediterLicense &&
        hardStopConfig.hardStopRoles.includes(result.role_on_project?.toLowerCase() || "") &&
        result.validation_status !== "active"
      ) {
        hasHardStop = true;
        hardStopError = `Commun-ET expediter license ${result.license_number} is ${result.validation_status}. Filing cannot proceed without an active expediter registration.`;
        console.error("[license-validation] HARD STOP:", hardStopError);
      }
    }

    const allActive = validationResults.every((r) => r.validation_status === "active");
    const pendingManualVerification = validationResults.some((r) => r.validation_source === "none");

    const hardStopRolesSet = new Set(hardStopConfig.hardStopRoles);
    const warnings = validationResults.filter(
      (r) => r.validation_status !== "active" && !hardStopRolesSet.has(r.role_on_project?.toLowerCase() || "")
    );

    const outputData = {
      municipality_key: municipalityKey,
      validation_source: validationSourceLabel,
      total_checked: validationResults.length,
      all_active: allActive,
      pending_manual_verification: pendingManualVerification,
      hard_stop: hasHardStop,
      hard_stop_reason: hasHardStop ? hardStopError : null,
      warnings: warnings.map((w) => ({
        professional_name: w.professional_name,
        license_type: w.license_type,
        license_number: w.license_number,
        role_on_project: w.role_on_project,
        status: w.validation_status,
        issue: w.error || `License is ${w.validation_status}`,
      })),
      results: validationResults,
    };

    const agentStatus = hasHardStop ? "escalated" : "completed";

    if (agentRunId) {
      const { error: updateError } = await dbClient
        .from("agent_runs")
        .update({
          status: agentStatus,
          output_data: outputData,
          error_message: hasHardStop ? hardStopError : null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", agentRunId);

      if (updateError) {
        console.error("[license-validation] Failed to update agent_run:", updateError.message);
      }
    }

    console.log(
      `[license-validation] complete. municipality=${municipalityKey} source=${validationSourceLabel} checked=${validationResults.length} allActive=${allActive} hardStop=${hasHardStop} duration=${Date.now() - startTime}ms`
    );

    const responseStatus = hasHardStop ? 422 : 200;

    return new Response(
      JSON.stringify({
        filing_id: filingId,
        agent_run_id: agentRunId,
        status: agentStatus,
        ...outputData,
      }),
      {
        status: responseStatus,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[license-validation] error:", error);
    return new Response(
      JSON.stringify({
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
