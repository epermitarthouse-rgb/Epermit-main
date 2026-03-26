import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AGENT_TIMEOUT_MS = 90_000;

interface AgentResult {
  agent_name: string;
  status: string;
  data: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number;
}

async function callAgent(
  baseUrl: string,
  agentPath: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/${agentPath}`, {
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
        error: isTimeout ? "Agent call timed out" : (err instanceof Error ? err.message : String(err)),
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  console.log("[permitwizard-preflight] start");

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

    const userSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminSupabase = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : userSupabase;

    const body = await req.json().catch(() => ({}));
    const filingId = body.filing_id as string | undefined;
    const municipalityKeyParam = body.municipality_key as string | undefined;
    const credentialIdParam = body.credential_id as string | undefined;

    if (!filingId) {
      return new Response(
        JSON.stringify({ code: 400, message: "filing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const municipalityKey = municipalityKeyParam ?? (filing.municipality as string | undefined) ?? "dc_dob";
    const credentialId = credentialIdParam ?? (filing.credential_id as string | undefined) ?? undefined;

    console.log(`[permitwizard-preflight] municipality_key=${municipalityKey} credential_id=${credentialId ?? "none"}`);

    let municipalityConfig: Record<string, unknown> | null = null;
    const { data: muniData, error: muniError } = await adminSupabase
      .from("municipality_configs")
      .select("*")
      .eq("municipality_key", municipalityKey)
      .single();

    if (muniError || !muniData) {
      console.warn(`[permitwizard-preflight] Municipality config not found for key=${municipalityKey}, using defaults`);
    } else {
      municipalityConfig = muniData as Record<string, unknown>;
      console.log(`[permitwizard-preflight] Loaded municipality config: ${municipalityConfig.display_name} (${municipalityConfig.portal_type})`);
    }

    const filingUpdateFields: Record<string, unknown> = {};
    if (municipalityKey && filing.municipality !== municipalityKey) {
      filingUpdateFields.municipality = municipalityKey;
    }
    if (credentialId && filing.credential_id !== credentialId) {
      filingUpdateFields.credential_id = credentialId;
    }
    if (Object.keys(filingUpdateFields).length > 0) {
      const { error: earlyUpdateError } = await adminSupabase
        .from("permit_filings")
        .update(filingUpdateFields)
        .eq("id", filingId);
      if (earlyUpdateError) {
        console.error("[permitwizard-preflight] Failed to set municipality/credential_id on filing:", earlyUpdateError);
      }
    }

    const baseUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;
    const agentHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": authHeader,
      "apikey": anonKey,
    };

    const agentResults: AgentResult[] = [];

    console.log("[permitwizard-preflight] Step 1: Property Intelligence Agent (01)");
    const agent01Start = Date.now();
    const agent01Res = await callAgent(baseUrl, "property-intelligence-agent", agentHeaders, {
      filing_id: filingId,
      property_address: filing.property_address,
      municipality_key: municipalityKey,
    });
    const agent01Result: AgentResult = {
      agent_name: "property_intelligence",
      status: agent01Res.ok ? (agent01Res.data.status as string ?? "completed") : "failed",
      data: agent01Res.ok ? agent01Res.data : null,
      error: agent01Res.ok ? null : (agent01Res.data.error as string ?? agent01Res.data.message as string ?? "Agent 01 failed"),
      duration_ms: Date.now() - agent01Start,
    };
    agentResults.push(agent01Result);
    console.log(`[permitwizard-preflight] Agent 01 done: status=${agent01Result.status} duration=${agent01Result.duration_ms}ms`);

    const propertyIntelligence = agent01Res.ok
      ? (agent01Res.data.property_intelligence as Record<string, unknown> ?? null)
      : null;

    const { data: professionals } = await adminSupabase
      .from("filing_professionals")
      .select("professional_name, license_type, license_number, role_on_project")
      .eq("filing_id", filingId);

    const { data: filingDocs } = await adminSupabase
      .from("filing_documents")
      .select("document_name, file_url, file_size_bytes, file_format, document_type")
      .eq("filing_id", filingId);

    console.log("[permitwizard-preflight] Step 2: License Validation (02) + Document Preparation (03) in parallel");

    const agent02Body: Record<string, unknown> = {
      filing_id: filingId,
      municipality_key: municipalityKey,
      professionals: professionals && professionals.length > 0
        ? professionals
        : body.professionals ?? [],
    };

    const documentsForAgent03 = (filingDocs ?? []).map((d: Record<string, unknown>) => ({
      name: d.document_name as string,
      url: d.file_url as string,
      size_bytes: d.file_size_bytes as number | undefined,
      type: d.document_type as string | undefined,
    }));

    const agent03Body: Record<string, unknown> = {
      filing_id: filingId,
      municipality_key: municipalityKey,
      documents: documentsForAgent03.length > 0 ? documentsForAgent03 : (body.documents ?? []),
      scope_of_work: filing.scope_of_work ?? body.scope_of_work,
      property_type: filing.property_type ?? body.property_type,
      review_track: filing.review_track,
    };

    const agent02Start = Date.now();
    const agent03Start = Date.now();

    const [agent02Res, agent03Res] = await Promise.all([
      callAgent(baseUrl, "license-validation-agent", agentHeaders, agent02Body),
      callAgent(baseUrl, "document-preparation-agent", agentHeaders, agent03Body),
    ]);

    const agent02Result: AgentResult = {
      agent_name: "license_validation",
      status: agent02Res.ok ? (agent02Res.data.status as string ?? "completed") : "failed",
      data: agent02Res.ok ? agent02Res.data : null,
      error: agent02Res.ok ? null : (agent02Res.data.error as string ?? agent02Res.data.message as string ?? "Agent 02 failed"),
      duration_ms: Date.now() - agent02Start,
    };
    agentResults.push(agent02Result);

    const agent03Result: AgentResult = {
      agent_name: "document_preparation",
      status: agent03Res.ok ? (agent03Res.data.status as string ?? "completed") : "failed",
      data: agent03Res.ok ? agent03Res.data : null,
      error: agent03Res.ok ? null : (agent03Res.data.error as string ?? agent03Res.data.message as string ?? "Agent 03 failed"),
      duration_ms: Date.now() - agent03Start,
    };
    agentResults.push(agent03Result);

    console.log(`[permitwizard-preflight] Agent 02 done: status=${agent02Result.status} duration=${agent02Result.duration_ms}ms`);
    console.log(`[permitwizard-preflight] Agent 03 done: status=${agent03Result.status} duration=${agent03Result.duration_ms}ms`);

    console.log("[permitwizard-preflight] Step 3: Permit Classifier Agent (04)");
    const agent04Start = Date.now();
    const agent04Res = await callAgent(baseUrl, "permit-classifier-agent", agentHeaders, {
      filing_id: filingId,
      municipality_key: municipalityKey,
      scope_of_work: filing.scope_of_work ?? body.scope_of_work,
      property_type: filing.property_type ?? body.property_type,
      construction_value: filing.construction_value ?? body.construction_value,
      property_intelligence: propertyIntelligence,
    });
    const agent04Result: AgentResult = {
      agent_name: "permit_classifier",
      status: agent04Res.ok ? (agent04Res.data.status as string ?? "completed") : "failed",
      data: agent04Res.ok ? agent04Res.data : null,
      error: agent04Res.ok ? null : (agent04Res.data.error as string ?? agent04Res.data.message as string ?? "Agent 04 failed"),
      duration_ms: Date.now() - agent04Start,
    };
    agentResults.push(agent04Result);
    console.log(`[permitwizard-preflight] Agent 04 done: status=${agent04Result.status} duration=${agent04Result.duration_ms}ms`);

    const allSucceeded = agentResults.every(
      (r) => r.status === "completed" || r.status === "escalated"
    );
    const anyFailed = agentResults.some((r) => r.status === "failed");
    const hasEscalation = agentResults.some((r) => r.status === "escalated");
    const hasHardStop = agent02Res.data?.hard_stop === true;

    const approvalPackage: Record<string, unknown> = {
      assembled_at: new Date().toISOString(),
      municipality_key: municipalityKey,
      municipality_display_name: municipalityConfig?.display_name ?? municipalityKey,
      portal_type: municipalityConfig?.portal_type ?? "unknown",
      property_intelligence: propertyIntelligence,
      license_validation: agent02Res.ok ? {
        all_active: agent02Res.data.all_active,
        hard_stop: agent02Res.data.hard_stop,
        hard_stop_reason: agent02Res.data.hard_stop_reason,
        warnings: agent02Res.data.warnings,
        results: agent02Res.data.results,
      } : { error: agent02Result.error },
      document_preparation: agent03Res.ok ? {
        total_documents: agent03Res.data.total_documents,
        valid_count: agent03Res.data.valid_count,
        invalid_count: agent03Res.data.invalid_count,
        missing_count: agent03Res.data.missing_count,
        deficiencies: agent03Res.data.deficiencies,
        checklist_results: agent03Res.data.checklist_results,
        eif_status: agent03Res.data.eif_status,
        documents: agent03Res.data.documents,
      } : { error: agent03Result.error },
      permit_classification: agent04Res.ok ? agent04Res.data.classification : { error: agent04Result.error },
      agent_summary: agentResults.map((r) => ({
        agent_name: r.agent_name,
        status: r.status,
        error: r.error,
        duration_ms: r.duration_ms,
      })),
      escalation_required: hasEscalation,
      hard_stop: hasHardStop,
      all_agents_succeeded: allSucceeded,
    };

    let newFilingStatus: string;
    if (hasHardStop) {
      newFilingStatus = "failed";
    } else if (allSucceeded) {
      newFilingStatus = "awaiting_approval";
    } else if (anyFailed) {
      newFilingStatus = "preflight";
    } else {
      newFilingStatus = "awaiting_approval";
    }

    const finalUpdateFields: Record<string, unknown> = {
      approval_package: approvalPackage,
      filing_status: newFilingStatus,
      updated_at: new Date().toISOString(),
    };
    if (municipalityKey) {
      finalUpdateFields.municipality = municipalityKey;
    }
    if (credentialId) {
      finalUpdateFields.credential_id = credentialId;
    }

    const { error: updateError } = await adminSupabase
      .from("permit_filings")
      .update(finalUpdateFields)
      .eq("id", filingId);

    if (updateError) {
      console.error("[permitwizard-preflight] Failed to update filing:", updateError);
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[permitwizard-preflight] complete. municipality=${municipalityKey} status=${newFilingStatus} allSucceeded=${allSucceeded} anyFailed=${anyFailed} escalation=${hasEscalation} hardStop=${hasHardStop} duration=${totalDuration}ms`);

    return new Response(
      JSON.stringify({
        filing_id: filingId,
        municipality_key: municipalityKey,
        municipality_display_name: municipalityConfig?.display_name ?? municipalityKey,
        filing_status: newFilingStatus,
        all_agents_succeeded: allSucceeded,
        has_escalation: hasEscalation,
        has_hard_stop: hasHardStop,
        agents: agentResults.map((r) => ({
          agent_name: r.agent_name,
          status: r.status,
          error: r.error,
          duration_ms: r.duration_ms,
        })),
        approval_package: approvalPackage,
        duration_ms: totalDuration,
      }),
      {
        status: anyFailed && !allSucceeded ? 207 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[permitwizard-preflight] Unhandled error:", error);
    return new Response(
      JSON.stringify({
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
