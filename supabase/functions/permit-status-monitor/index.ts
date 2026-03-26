import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCOUT_BASE_URL = "https://scout.dcra.dc.gov";

const PORTAL_STATUS_MAP: Record<string, string> = {
  "under review": "under_review",
  "in review": "under_review",
  "reviewing": "under_review",
  "approved": "approved",
  "permit issued": "approved",
  "issued": "approved",
  "corrections needed": "corrections_needed",
  "corrections required": "corrections_needed",
  "revisions required": "corrections_needed",
  "resubmit": "corrections_needed",
  "denied": "denied",
  "rejected": "denied",
  "cancelled": "cancelled",
  "expired": "expired",
  "upload": "under_review",
  "open": "under_review",
};

interface FilingRecord {
  id: string;
  project_id: string;
  user_id: string;
  filing_status: string;
  application_id: string | null;
  confirmation_number: string | null;
  property_address: string | null;
  permit_type: string | null;
  review_track: string | null;
}

interface StatusCheckResult {
  filing_id: string;
  previous_status: string;
  new_status: string | null;
  portal_status: string;
  projectdox_detected: boolean;
  projectdox_project_id: string | null;
  raw_data: Record<string, unknown> | null;
  error: string | null;
}

function normalizePortalStatus(rawStatus: string): string {
  const lower = rawStatus.toLowerCase().trim();
  for (const [pattern, mapped] of Object.entries(PORTAL_STATUS_MAP)) {
    if (lower.includes(pattern)) {
      return mapped;
    }
  }
  return "unknown";
}

function mapPortalStatusToFilingStatus(portalStatus: string): string | null {
  switch (portalStatus) {
    case "approved":
      return "submitted";
    case "denied":
    case "cancelled":
    case "expired":
      return "failed";
    case "corrections_needed":
      return "submitted";
    case "under_review":
      return "submitted";
    default:
      return null;
  }
}

async function checkFilingStatusViaScout(
  filing: FilingRecord,
  supabase: ReturnType<typeof createClient>,
): Promise<StatusCheckResult> {
  const result: StatusCheckResult = {
    filing_id: filing.id,
    previous_status: filing.filing_status,
    new_status: null,
    portal_status: "unknown",
    projectdox_detected: false,
    projectdox_project_id: null,
    raw_data: null,
    error: null,
  };

  const lookupId = filing.application_id || filing.confirmation_number;
  if (!lookupId) {
    result.error = "No application_id or confirmation_number available for lookup";
    return result;
  }

  try {
    const searchUrl = `${SCOUT_BASE_URL}/api/permits/search?q=${encodeURIComponent(lookupId)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch(searchUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "CommunET-PermitMonitor/1.0",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 404) {
        result.portal_status = "not_found";
        result.error = `Permit ${lookupId} not found in DC Scout`;
        return result;
      }
      result.error = `DC Scout returned status ${response.status}: ${response.statusText}`;
      return result;
    }

    const data = await response.json();
    result.raw_data = data;

    let permitRecord: Record<string, unknown> | null = null;

    if (Array.isArray(data)) {
      permitRecord = data.find(
        (r: Record<string, unknown>) =>
          r.permit_number === lookupId ||
          r.application_id === lookupId ||
          r.tracking_number === lookupId
      ) || data[0] || null;
    } else if (data && typeof data === "object") {
      permitRecord = data;
    }

    if (permitRecord) {
      const rawStatus = String(
        permitRecord.status || permitRecord.permit_status || permitRecord.application_status || ""
      );
      result.portal_status = normalizePortalStatus(rawStatus);

      const newFilingStatus = mapPortalStatusToFilingStatus(result.portal_status);
      if (newFilingStatus && newFilingStatus !== filing.filing_status) {
        result.new_status = newFilingStatus;
      }

      const projectdoxUrl = String(permitRecord.projectdox_url || permitRecord.project_url || "");
      const projectdoxId = String(permitRecord.projectdox_id || permitRecord.projectdox_project_id || "");
      const reviewTrack = String(permitRecord.review_track || permitRecord.review_type || "");

      if (
        projectdoxUrl.includes("avolvecloud.com") ||
        projectdoxUrl.includes("ProjectDox") ||
        projectdoxId ||
        reviewTrack.toLowerCase().includes("projectdox")
      ) {
        result.projectdox_detected = true;
        const idMatch = projectdoxUrl.match(/ProjectID=(\d+)/i);
        result.projectdox_project_id = idMatch ? idMatch[1] : projectdoxId || null;
      }
    } else {
      result.portal_status = "not_found";
      result.error = `No matching permit record found for ${lookupId}`;
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      result.error = "DC Scout request timed out after 30s";
    } else {
      result.error = err instanceof Error ? err.message : "Unknown error during status check";
    }
  }

  return result;
}

async function createAgentRun(
  supabase: ReturnType<typeof createClient>,
  filingId: string,
  status: string,
  inputData: Record<string, unknown>,
  outputData: Record<string, unknown> | null,
  errorMessage: string | null,
  startedAt: string,
) {
  const { error } = await supabase.from("agent_runs").insert({
    filing_id: filingId,
    agent_name: "status_monitor",
    layer: 3,
    status,
    input_data: inputData,
    output_data: outputData,
    error_message: errorMessage,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  });
  if (error) {
    console.warn(`[permit-status-monitor] Failed to create agent_run for filing ${filingId}:`, error.message);
  }
}

async function sendStatusChangeNotification(
  supabase: ReturnType<typeof createClient>,
  filing: FilingRecord,
  checkResult: StatusCheckResult,
) {
  const notificationMessage = buildNotificationMessage(filing, checkResult);

  const { error } = await supabase.from("notifications").insert({
    user_id: filing.user_id,
    title: "Permit Status Update",
    message: notificationMessage,
    type: "permit_status_change",
    metadata: {
      filing_id: filing.id,
      project_id: filing.project_id,
      portal_status: checkResult.portal_status,
      projectdox_detected: checkResult.projectdox_detected,
      projectdox_project_id: checkResult.projectdox_project_id,
    },
  }).select().maybeSingle();

  if (error) {
    console.warn(`[permit-status-monitor] Notification insert failed (table may not exist):`, error.message);
  }
}

function buildNotificationMessage(
  filing: FilingRecord,
  checkResult: StatusCheckResult,
): string {
  const permitRef = filing.application_id || filing.confirmation_number || filing.id.slice(0, 8);
  const address = filing.property_address || "your property";

  switch (checkResult.portal_status) {
    case "under_review":
      return `Permit ${permitRef} for ${address} is now under review by DC DOB.`;
    case "approved":
      return `Permit ${permitRef} for ${address} has been approved by DC DOB.`;
    case "corrections_needed":
      return `Permit ${permitRef} for ${address} requires corrections. Please review the comments and resubmit.`;
    case "denied":
      return `Permit ${permitRef} for ${address} has been denied by DC DOB. Review the denial reasons for next steps.`;
    default:
      return `Permit ${permitRef} for ${address} status changed to: ${checkResult.portal_status}.`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  console.log("[permit-status-monitor] start");

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

    const supabase = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : userSupabase;

    const body = await req.json().catch(() => ({}));
    const filingId = body.filing_id as string | undefined;
    const projectId = body.project_id as string | undefined;

    console.log("[permit-status-monitor] filing_id:", filingId ?? "(all)", "project_id:", projectId ?? "(all)", "user:", user.id);

    let query = supabase
      .from("permit_filings")
      .select("id, project_id, user_id, filing_status, application_id, confirmation_number, property_address, permit_type, review_track")
      .eq("user_id", user.id)
      .eq("filing_status", "submitted");

    if (filingId) {
      query = query.eq("id", filingId);
    }
    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { data: filings, error: filingsError } = await query;

    if (filingsError) {
      console.error("[permit-status-monitor] Query error:", filingsError.message);
      return new Response(
        JSON.stringify({ code: 500, message: `Database query failed: ${filingsError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!filings || filings.length === 0) {
      return new Response(
        JSON.stringify({
          code: 200,
          message: "No submitted filings found to monitor",
          results: [],
          checked_count: 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[permit-status-monitor] Found ${filings.length} submitted filing(s) to check`);

    const results: StatusCheckResult[] = [];

    for (const filing of filings as FilingRecord[]) {
      const agentStartTime = new Date().toISOString();
      console.log(`[permit-status-monitor] Checking filing ${filing.id} (app: ${filing.application_id})`);

      const checkResult = await checkFilingStatusViaScout(filing, supabase);
      results.push(checkResult);

      if (checkResult.portal_status !== "unknown" && !checkResult.error) {
        const updatePayload: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };

        if (checkResult.new_status) {
          updatePayload.filing_status = checkResult.new_status;
        }

        if (checkResult.projectdox_detected && filing.review_track !== "projectdox") {
          updatePayload.review_track = "projectdox";
        }

        if (Object.keys(updatePayload).length > 1) {
          const { error: updateError } = await supabase
            .from("permit_filings")
            .update(updatePayload)
            .eq("id", filing.id);

          if (updateError) {
            console.warn(`[permit-status-monitor] Failed to update filing ${filing.id}:`, updateError.message);
          }
        }

        if (checkResult.new_status || checkResult.projectdox_detected) {
          await sendStatusChangeNotification(supabase, filing, checkResult);
        }

        await createAgentRun(
          supabase,
          filing.id,
          "completed",
          { application_id: filing.application_id, confirmation_number: filing.confirmation_number },
          {
            portal_status: checkResult.portal_status,
            new_filing_status: checkResult.new_status,
            projectdox_detected: checkResult.projectdox_detected,
            projectdox_project_id: checkResult.projectdox_project_id,
          },
          null,
          agentStartTime,
        );
      } else {
        await createAgentRun(
          supabase,
          filing.id,
          checkResult.error ? "failed" : "completed",
          { application_id: filing.application_id, confirmation_number: filing.confirmation_number },
          { portal_status: checkResult.portal_status },
          checkResult.error,
          agentStartTime,
        );
      }

      if (filings.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    const statusChanges = results.filter((r) => r.new_status !== null);
    const projectdoxDetections = results.filter((r) => r.projectdox_detected);
    const errors = results.filter((r) => r.error !== null);

    console.log(
      `[permit-status-monitor] Complete. Checked: ${results.length}, Changes: ${statusChanges.length}, ProjectDox: ${projectdoxDetections.length}, Errors: ${errors.length}, Duration: ${Date.now() - startTime}ms`
    );

    return new Response(
      JSON.stringify({
        checked_count: results.length,
        status_changes: statusChanges.length,
        projectdox_detections: projectdoxDetections.length,
        error_count: errors.length,
        results: results.map((r) => ({
          filing_id: r.filing_id,
          portal_status: r.portal_status,
          status_changed: r.new_status !== null,
          new_status: r.new_status,
          projectdox_detected: r.projectdox_detected,
          projectdox_project_id: r.projectdox_project_id,
          error: r.error,
        })),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[permit-status-monitor] error:", error);
    return new Response(
      JSON.stringify({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
