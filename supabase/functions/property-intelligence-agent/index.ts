import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

const DC_SCOUT_BASE = "https://scout.dcra.dc.gov";
const MD_SDAT_BASE = "https://sdat.dat.maryland.gov/RealProperty";

const MD_MUNICIPALITIES = [
  "pg_county_md",
  "montgomery_county_md",
  "howard_county_md",
  "baltimore_city_md",
  "anne_arundel_county_md",
];

const VA_MUNICIPALITIES = [
  "fairfax_county_va",
  "arlington_county_va",
  "alexandria_va",
  "loudoun_county_va",
];

const VA_GIS_LABELS: Record<string, string> = {
  fairfax_county_va: "Fairfax County GIS",
  arlington_county_va: "Arlington County GIS",
  alexandria_va: "City of Alexandria GIS",
  loudoun_county_va: "Loudoun County GIS",
};

interface PropertyIntelligence {
  address: string;
  zoning_district: string | null;
  overlay_zones: string[];
  historic_district: boolean;
  flood_hazard_zone: boolean;
  active_permits: Record<string, unknown>[];
  stop_work_orders: Record<string, unknown>[];
  advisory_flags: string[];
  data_source: string;
  raw_data: Record<string, unknown>;
}

interface AgentRunRecord {
  id?: string;
  filing_id: string;
  agent_name: string;
  layer: number;
  status: string;
  input_data: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  error_message?: string;
  started_at: string;
  completed_at?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok || res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < retries - 1) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.log(`[property-intelligence] Retry ${attempt + 1}/${retries} after ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError ?? new Error("fetchWithRetry exhausted");
}

async function lookupPropertyData(address: string, municipalityKey: string): Promise<PropertyIntelligence> {
  if (MD_MUNICIPALITIES.includes(municipalityKey)) {
    return lookupMdSdatProperty(address, municipalityKey);
  }
  if (VA_MUNICIPALITIES.includes(municipalityKey)) {
    return lookupVaProperty(address, municipalityKey);
  }
  if (municipalityKey === "dc_dob") {
    return lookupDcScoutProperty(address);
  }
  return lookupUnknownMunicipality(address, municipalityKey);
}

function createBaseResult(address: string, dataSource: string): PropertyIntelligence {
  return {
    address,
    zoning_district: null,
    overlay_zones: [],
    historic_district: false,
    flood_hazard_zone: false,
    active_permits: [],
    stop_work_orders: [],
    advisory_flags: [],
    data_source: dataSource,
    raw_data: {},
  };
}

function applyAdvisoryFlags(result: PropertyIntelligence): void {
  if (result.historic_district) {
    result.advisory_flags.push("HISTORIC_DISTRICT");
  }
  if (result.flood_hazard_zone) {
    result.advisory_flags.push("FLOOD_HAZARD_ZONE");
  }
  if (result.stop_work_orders.length > 0) {
    result.advisory_flags.push("ACTIVE_STOP_WORK_ORDER");
  }
  const overlayStr = result.overlay_zones.join(" ").toLowerCase();
  if (overlayStr.includes("ncpc") || overlayStr.includes("national capital")) {
    result.advisory_flags.push("NCPC_ZONE");
  }
}

async function lookupDcScoutProperty(address: string): Promise<PropertyIntelligence> {
  const result = createBaseResult(address, "dc_scout");
  const encodedAddress = encodeURIComponent(address.trim());

  try {
    const searchUrl = `${DC_SCOUT_BASE}/api/search?address=${encodedAddress}`;
    console.log(`[property-intelligence] Fetching DC Scout: ${searchUrl}`);
    const searchRes = await fetchWithRetry(searchUrl, {
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "CommunET-PermitWizard/1.0" },
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      result.raw_data.search = searchData;

      if (searchData && typeof searchData === "object") {
        const props = searchData.properties ?? searchData.results?.[0] ?? searchData;

        result.zoning_district = props.zoning_district ?? props.zoning ?? props.zone ?? null;

        if (Array.isArray(props.overlay_zones)) {
          result.overlay_zones = props.overlay_zones;
        } else if (props.overlay_zone) {
          result.overlay_zones = [props.overlay_zone];
        }

        result.historic_district = Boolean(
          props.historic_district ?? props.is_historic ?? props.historicDistrict ?? false
        );

        result.flood_hazard_zone = Boolean(
          props.flood_hazard_zone ?? props.flood_zone ?? props.floodHazardZone ?? false
        );
      }
    } else {
      console.warn(`[property-intelligence] DC Scout search returned ${searchRes.status}`);
      result.raw_data.search_error = `HTTP ${searchRes.status}`;
    }
  } catch (err) {
    console.error("[property-intelligence] DC Scout search error:", err);
    result.raw_data.search_error = err instanceof Error ? err.message : String(err);
  }

  try {
    const permitsUrl = `${DC_SCOUT_BASE}/api/permits?address=${encodedAddress}`;
    console.log(`[property-intelligence] Fetching permits: ${permitsUrl}`);
    const permitsRes = await fetchWithRetry(permitsUrl, {
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "CommunET-PermitWizard/1.0" },
    });

    if (permitsRes.ok) {
      const permitsData = await permitsRes.json();
      result.raw_data.permits = permitsData;

      const permits = Array.isArray(permitsData) ? permitsData : permitsData?.permits ?? [];
      result.active_permits = permits.filter(
        (p: Record<string, unknown>) =>
          p.status === "active" || p.status === "open" || p.status === "issued"
      );

      result.stop_work_orders = permits.filter(
        (p: Record<string, unknown>) =>
          p.type === "stop_work_order" ||
          p.status === "stop_work" ||
          (typeof p.description === "string" &&
            p.description.toLowerCase().includes("stop work"))
      );
    } else {
      result.raw_data.permits_error = `HTTP ${permitsRes.status}`;
    }
  } catch (err) {
    console.error("[property-intelligence] Permits lookup error:", err);
    result.raw_data.permits_error = err instanceof Error ? err.message : String(err);
  }

  applyAdvisoryFlags(result);
  return result;
}

async function lookupMdSdatProperty(address: string, municipalityKey: string): Promise<PropertyIntelligence> {
  const result = createBaseResult(address, "sdat_md");
  const encodedAddress = encodeURIComponent(address.trim());

  try {
    const searchUrl = `${MD_SDAT_BASE}/Pages/default.aspx?search=${encodedAddress}`;
    console.log(`[property-intelligence] Fetching MD SDAT for ${municipalityKey}: ${searchUrl}`);
    const searchRes = await fetchWithRetry(searchUrl, {
      method: "GET",
      headers: { "Accept": "text/html,application/json", "User-Agent": "CommunET-PermitWizard/1.0" },
    });

    if (searchRes.ok) {
      const contentType = searchRes.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const searchData = await searchRes.json();
        result.raw_data.sdat_search = searchData;

        if (searchData && typeof searchData === "object") {
          const props = searchData.properties ?? searchData.results?.[0] ?? searchData;
          result.zoning_district = props.zoning ?? props.zoning_district ?? props.zone ?? null;

          result.historic_district = Boolean(
            props.historic_district ?? props.is_historic ?? false
          );

          result.flood_hazard_zone = Boolean(
            props.flood_zone ?? props.flood_hazard_zone ?? false
          );
        }
      } else {
        result.raw_data.sdat_note = "SDAT returned HTML; structured property data extracted where available";
      }
    } else {
      console.warn(`[property-intelligence] MD SDAT returned ${searchRes.status} for ${municipalityKey}`);
      result.raw_data.sdat_error = `HTTP ${searchRes.status}`;
      result.advisory_flags.push("SDAT_LOOKUP_DEGRADED");
    }
  } catch (err) {
    console.error(`[property-intelligence] MD SDAT error for ${municipalityKey}:`, err);
    result.raw_data.sdat_error = err instanceof Error ? err.message : String(err);
    result.advisory_flags.push("SDAT_LOOKUP_FAILED");
  }

  applyAdvisoryFlags(result);
  return result;
}

async function lookupVaProperty(address: string, municipalityKey: string): Promise<PropertyIntelligence> {
  const gisLabel = VA_GIS_LABELS[municipalityKey] ?? `${municipalityKey} GIS`;
  const result = createBaseResult(address, "none");
  result.raw_data.note = `Property data lookup via ${gisLabel} not yet configured`;
  result.advisory_flags.push("PROPERTY_DATA_NOT_AVAILABLE");
  console.log(`[property-intelligence] VA municipality ${municipalityKey}: property data lookup via ${gisLabel} not yet configured`);
  return result;
}

async function lookupUnknownMunicipality(address: string, municipalityKey: string): Promise<PropertyIntelligence> {
  const result = createBaseResult(address, "unknown");
  result.raw_data.note = `Unknown municipality '${municipalityKey}'; no property data source configured`;
  result.advisory_flags.push("UNKNOWN_MUNICIPALITY");
  console.log(`[property-intelligence] Unknown municipality: ${municipalityKey}`);
  return result;
}

function hasEscalationFlags(flags: string[]): boolean {
  const escalationTriggers = ["HISTORIC_DISTRICT", "FLOOD_HAZARD_ZONE", "NCPC_ZONE"];
  return flags.some((f) => escalationTriggers.includes(f));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  console.log("[property-intelligence] start");

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
    const propertyAddress = body.property_address as string | undefined;
    const municipalityKey = (body.municipality_key as string | undefined) ?? "dc_dob";

    if (!filingId) {
      return new Response(
        JSON.stringify({ code: 400, message: "filing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: filing, error: filingError } = await userSupabase
      .from("permit_filings")
      .select("id, user_id, property_address, filing_status")
      .eq("id", filingId)
      .single();

    if (filingError || !filing) {
      return new Response(
        JSON.stringify({ code: 404, message: "Filing not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const address = propertyAddress ?? filing.property_address;
    if (!address) {
      return new Response(
        JSON.stringify({ code: 400, message: "No property address available on filing or in request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agentRun: AgentRunRecord = {
      filing_id: filingId,
      agent_name: "property_intelligence",
      layer: 1,
      status: "running",
      input_data: { address, filing_id: filingId, municipality_key: municipalityKey },
      started_at: new Date().toISOString(),
    };

    const { data: runRecord, error: runInsertError } = await adminSupabase
      .from("agent_runs")
      .insert(agentRun)
      .select("id")
      .single();

    if (runInsertError) {
      console.error("[property-intelligence] Failed to create agent_run:", runInsertError);
    }
    const runId = runRecord?.id;

    let propertyData: PropertyIntelligence;
    let agentStatus = "completed";
    let errorMessage: string | undefined;

    try {
      propertyData = await lookupPropertyData(address, municipalityKey);

      if (hasEscalationFlags(propertyData.advisory_flags)) {
        agentStatus = "escalated";
        console.log(
          `[property-intelligence] Escalation flags detected: ${propertyData.advisory_flags.join(", ")}`
        );
      }
    } catch (err) {
      agentStatus = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[property-intelligence] Lookup failed:", errorMessage);

      propertyData = {
        address,
        zoning_district: null,
        overlay_zones: [],
        historic_district: false,
        flood_hazard_zone: false,
        active_permits: [],
        stop_work_orders: [],
        advisory_flags: [],
        data_source: "error",
        raw_data: { error: errorMessage },
      };
    }

    const { error: piInsertError } = await adminSupabase
      .from("property_intelligence")
      .insert({
        filing_id: filingId,
        address: propertyData.address,
        zoning_district: propertyData.zoning_district,
        overlay_zones: propertyData.overlay_zones,
        historic_district: propertyData.historic_district,
        flood_hazard_zone: propertyData.flood_hazard_zone,
        active_permits: propertyData.active_permits,
        stop_work_orders: propertyData.stop_work_orders,
        advisory_flags: propertyData.advisory_flags,
        raw_data: propertyData.raw_data,
      });

    if (piInsertError) {
      console.error("[property-intelligence] Failed to insert property_intelligence:", piInsertError);
      if (agentStatus !== "failed") {
        agentStatus = "failed";
        errorMessage = `Database insert failed: ${piInsertError.message}`;
      }
    }

    if (runId) {
      const { error: runUpdateError } = await adminSupabase
        .from("agent_runs")
        .update({
          status: agentStatus,
          output_data: {
            municipality_key: municipalityKey,
            data_source: propertyData.data_source,
            zoning_district: propertyData.zoning_district,
            overlay_zones: propertyData.overlay_zones,
            historic_district: propertyData.historic_district,
            flood_hazard_zone: propertyData.flood_hazard_zone,
            active_permits_count: propertyData.active_permits.length,
            stop_work_orders_count: propertyData.stop_work_orders.length,
            advisory_flags: propertyData.advisory_flags,
          },
          error_message: errorMessage ?? null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);

      if (runUpdateError) {
        console.error("[property-intelligence] Failed to update agent_run:", runUpdateError);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[property-intelligence] completed in ${duration}ms, status=${agentStatus}, municipality=${municipalityKey}`);

    return new Response(
      JSON.stringify({
        status: agentStatus,
        filing_id: filingId,
        municipality_key: municipalityKey,
        agent_run_id: runId ?? null,
        property_intelligence: {
          address: propertyData.address,
          zoning_district: propertyData.zoning_district,
          overlay_zones: propertyData.overlay_zones,
          historic_district: propertyData.historic_district,
          flood_hazard_zone: propertyData.flood_hazard_zone,
          active_permits: propertyData.active_permits,
          stop_work_orders: propertyData.stop_work_orders,
          advisory_flags: propertyData.advisory_flags,
          data_source: propertyData.data_source,
        },
        escalation_required: hasEscalationFlags(propertyData.advisory_flags),
        escalation_reasons: propertyData.advisory_flags.filter((f) =>
          ["HISTORIC_DISTRICT", "FLOOD_HAZARD_ZONE", "NCPC_ZONE"].includes(f)
        ),
        error: errorMessage ?? null,
        duration_ms: duration,
      }),
      {
        status: agentStatus === "failed" ? 500 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[property-intelligence] Unhandled error:", error);
    return new Response(
      JSON.stringify({
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
