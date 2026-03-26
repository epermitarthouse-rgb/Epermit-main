import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONFIDENCE_THRESHOLD = 0.85;

const DEFAULT_PERMIT_TYPES = [
  "residential",
  "trade",
  "solar",
  "demolition",
  "raze",
] as const;

const DEFAULT_REVIEW_TRACKS = ["walk_through", "projectdox"] as const;

const DEFAULT_SISTER_AGENCIES = [
  "Historic Preservation Office (HPO)",
  "Department of Energy & Environment (DOEE)",
  "DC Water",
  "District Department of Transportation (DDOT)",
  "National Capital Planning Commission (NCPC)",
  "Office of Zoning (OZ)",
  "Public Space Committee",
] as const;

interface MunicipalityConfig {
  municipality_key: string;
  display_name: string;
  short_name: string;
  state: string;
  county: string | null;
  portal_type: string;
  portal_base_url: string;
  permit_types: Array<{ code: string; label: string }>;
  agent_config: {
    agency_name?: string;
    agency_short?: string;
    fee_schedule_ref?: string;
    sister_agencies?: string[];
    gpt_prompt_context?: string;
    review_tracks?: string[];
    [key: string]: unknown;
  };
}

interface ClassificationResult {
  permit_type: string;
  permit_subtype: string | null;
  confidence: number;
  alternatives: Array<{ permit_type: string; confidence: number }>;
  review_track: string;
  review_track_reasoning: string;
  sister_agency_reviews: string[];
  estimated_fee: number;
  fee_breakdown: Record<string, number>;
  recommended_description: string;
  reasoning: string;
}

interface PropertyIntelligenceData {
  address?: string;
  zoning_district?: string | null;
  overlay_zones?: string[];
  historic_district?: boolean;
  flood_hazard_zone?: boolean;
  active_permits?: Record<string, unknown>[];
  stop_work_orders?: Record<string, unknown>[];
  advisory_flags?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  console.log("[permit-classifier] start");

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ code: 500, message: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
    const scopeOfWork = body.scope_of_work as string | undefined;
    const propertyType = body.property_type as string | undefined;
    const constructionValue = body.construction_value as number | undefined;
    const propertyIntelligence = body.property_intelligence as PropertyIntelligenceData | undefined;
    const municipalityKey = (body.municipality_key as string | undefined) ?? "dc_dob";

    if (!filingId) {
      return new Response(
        JSON.stringify({ code: 400, message: "filing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: filing, error: filingError } = await userSupabase
      .from("permit_filings")
      .select("id, user_id, property_address, scope_of_work, construction_value, property_type, filing_status")
      .eq("id", filingId)
      .single();

    if (filingError || !filing) {
      return new Response(
        JSON.stringify({ code: 404, message: "Filing not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let muniConfig: MunicipalityConfig | null = null;
    const { data: muniData } = await adminSupabase
      .from("municipality_configs")
      .select("*")
      .eq("municipality_key", municipalityKey)
      .eq("is_active", true)
      .single();

    if (muniData) {
      muniConfig = muniData as MunicipalityConfig;
      console.log(`[permit-classifier] Loaded municipality config for ${municipalityKey}: ${muniConfig.display_name}`);
    } else {
      console.log(`[permit-classifier] No municipality config found for ${municipalityKey}, using DC defaults`);
    }

    const finalScope = scopeOfWork ?? filing.scope_of_work;
    const finalPropertyType = propertyType ?? filing.property_type;
    const finalConstructionValue = constructionValue ?? filing.construction_value;

    if (!finalScope) {
      return new Response(
        JSON.stringify({ code: 400, message: "scope_of_work is required either in request body or on the filing record" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let propIntel: PropertyIntelligenceData = propertyIntelligence ?? {};
    if (!propertyIntelligence) {
      const { data: piData } = await adminSupabase
        .from("property_intelligence")
        .select("*")
        .eq("filing_id", filingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (piData) {
        propIntel = piData as PropertyIntelligenceData;
      }
    }

    const agentRun = {
      filing_id: filingId,
      agent_name: "permit_classifier",
      layer: 1,
      status: "running",
      input_data: {
        filing_id: filingId,
        municipality_key: municipalityKey,
        scope_of_work: finalScope,
        property_type: finalPropertyType,
        construction_value: finalConstructionValue,
        property_address: filing.property_address,
        property_intelligence: propIntel,
      },
      started_at: new Date().toISOString(),
    };

    const { data: runRecord, error: runInsertError } = await adminSupabase
      .from("agent_runs")
      .insert(agentRun)
      .select("id")
      .single();

    if (runInsertError) {
      console.error("[permit-classifier] Failed to create agent_run:", runInsertError);
    }
    const runId = runRecord?.id;

    let classificationResult: ClassificationResult;
    let agentStatus = "completed";
    let errorMessage: string | undefined;

    try {
      classificationResult = await classifyPermit({
        openaiKey: OPENAI_API_KEY,
        scopeOfWork: finalScope,
        propertyType: finalPropertyType,
        constructionValue: finalConstructionValue,
        propertyAddress: filing.property_address,
        propertyIntelligence: propIntel,
        municipalityConfig: muniConfig,
      });

      if (classificationResult.confidence < CONFIDENCE_THRESHOLD) {
        console.log(
          `[permit-classifier] Low confidence (${classificationResult.confidence}), surfacing alternatives`
        );
      }
    } catch (err) {
      agentStatus = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[permit-classifier] Classification failed:", errorMessage);

      classificationResult = {
        permit_type: "residential",
        permit_subtype: null,
        confidence: 0,
        alternatives: [],
        review_track: "walk_through",
        review_track_reasoning: "Classification failed - defaulting to walk-through",
        sister_agency_reviews: [],
        estimated_fee: 0,
        fee_breakdown: {},
        recommended_description: "",
        reasoning: `Classification failed: ${errorMessage}`,
      };
    }

    if (agentStatus !== "failed") {
      const updateData: Record<string, unknown> = {
        permit_type: classificationResult.permit_type,
        review_track: classificationResult.review_track,
        estimated_fee: classificationResult.estimated_fee,
        updated_at: new Date().toISOString(),
      };

      if (classificationResult.permit_subtype) {
        updateData.permit_subtype = classificationResult.permit_subtype;
      }

      const { error: filingUpdateError } = await adminSupabase
        .from("permit_filings")
        .update(updateData)
        .eq("id", filingId);

      if (filingUpdateError) {
        console.error("[permit-classifier] Failed to update permit_filings:", filingUpdateError);
        if (agentStatus !== "failed") {
          agentStatus = "failed";
          errorMessage = `Failed to update filing: ${filingUpdateError.message}`;
        }
      }
    }

    if (runId) {
      const { error: runUpdateError } = await adminSupabase
        .from("agent_runs")
        .update({
          status: agentStatus,
          output_data: {
            permit_type: classificationResult.permit_type,
            permit_subtype: classificationResult.permit_subtype,
            confidence: classificationResult.confidence,
            alternatives: classificationResult.alternatives,
            review_track: classificationResult.review_track,
            review_track_reasoning: classificationResult.review_track_reasoning,
            sister_agency_reviews: classificationResult.sister_agency_reviews,
            estimated_fee: classificationResult.estimated_fee,
            fee_breakdown: classificationResult.fee_breakdown,
            recommended_description: classificationResult.recommended_description,
            low_confidence: classificationResult.confidence < CONFIDENCE_THRESHOLD,
          },
          error_message: errorMessage ?? null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);

      if (runUpdateError) {
        console.error("[permit-classifier] Failed to update agent_run:", runUpdateError);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[permit-classifier] completed in ${duration}ms, status=${agentStatus}, confidence=${classificationResult.confidence}`);

    return new Response(
      JSON.stringify({
        status: agentStatus,
        filing_id: filingId,
        municipality_key: municipalityKey,
        agent_run_id: runId ?? null,
        classification: {
          permit_type: classificationResult.permit_type,
          permit_subtype: classificationResult.permit_subtype,
          confidence: classificationResult.confidence,
          low_confidence: classificationResult.confidence < CONFIDENCE_THRESHOLD,
          alternatives: classificationResult.confidence < CONFIDENCE_THRESHOLD
            ? classificationResult.alternatives
            : [],
          review_track: classificationResult.review_track,
          review_track_reasoning: classificationResult.review_track_reasoning,
          sister_agency_reviews: classificationResult.sister_agency_reviews,
          estimated_fee: classificationResult.estimated_fee,
          fee_breakdown: classificationResult.fee_breakdown,
          recommended_description: classificationResult.recommended_description,
          reasoning: classificationResult.reasoning,
        },
        error: errorMessage ?? null,
        duration_ms: duration,
      }),
      {
        status: agentStatus === "failed" ? 500 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[permit-classifier] Unhandled error:", error);
    return new Response(
      JSON.stringify({
        code: 500,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

interface ClassifyInput {
  openaiKey: string;
  scopeOfWork: string;
  propertyType?: string | null;
  constructionValue?: number | null;
  propertyAddress?: string | null;
  propertyIntelligence: PropertyIntelligenceData;
  municipalityConfig?: MunicipalityConfig | null;
}

function buildSystemPrompt(muniConfig: MunicipalityConfig | null): string {
  if (!muniConfig) {
    return buildDcDefaultSystemPrompt();
  }

  const agentCfg = muniConfig.agent_config;
  const agencyName = agentCfg.agency_name ?? muniConfig.display_name;
  const agencyShort = agentCfg.agency_short ?? muniConfig.short_name;
  const feeScheduleRef = agentCfg.fee_schedule_ref ?? "the local permit fee schedule";
  const sisterAgencies = agentCfg.sister_agencies ?? [];
  const reviewTracks = agentCfg.review_tracks ?? ["standard"];
  const gptContext = agentCfg.gpt_prompt_context ?? `You are a ${agencyName} permit classification expert.`;
  const permitTypes = muniConfig.permit_types ?? [];

  const permitTypeList = permitTypes.length > 0
    ? permitTypes.map((pt) => `- ${pt.code}: ${pt.label}`).join("\n")
    : "- BUILDING: Building Permit\n- ELECTRICAL: Electrical Permit\n- MECHANICAL: Mechanical Permit\n- PLUMBING: Plumbing Permit\n- DEMOLITION: Demolition Permit";

  const reviewTrackList = reviewTracks.map((rt) => `"${rt}"`).join(", ");

  const sisterAgencyList = sisterAgencies.length > 0
    ? sisterAgencies.map((a) => `   - ${a}`).join("\n")
    : "   - None configured for this jurisdiction";

  return `${gptContext}

Your job is to analyze a scope of work and property details for ${agencyName} (${agencyShort}) in ${muniConfig.state}${muniConfig.county ? `, ${muniConfig.county} County` : ""} to determine:

1. **Permit Type**: One of the following permit type codes for this jurisdiction:
${permitTypeList}

2. **Permit Subtype**: More specific classification within the permit type (e.g., "interior_alteration", "addition", "new_construction", "residential_electrical", etc.)

3. **Review Track**: One of: ${reviewTrackList}
   Determine the appropriate review track based on project complexity, construction value, and jurisdiction rules.

4. **Sister Agency Reviews**: Identify which agencies in this jurisdiction must also review the application:
${sisterAgencyList}
   Only include agencies that are relevant based on the scope of work and property characteristics.

5. **Fee Estimate**: Estimate the permit fee based on ${feeScheduleRef}.
   Provide your best estimate based on the scope of work, construction value, and permit type. Include a breakdown by fee category.

6. **Recommended Project Description**: Generate professional language suitable for the permit application that accurately describes the scope of work for ${agencyShort}.

Return a JSON object with these exact keys:
{
  "permit_type": "one of the permit type codes listed above",
  "permit_subtype": "specific subtype string",
  "confidence": 0.0 to 1.0,
  "alternatives": [{"permit_type": "type", "confidence": 0.0 to 1.0}],
  "review_track": "one of the review tracks listed above",
  "review_track_reasoning": "explanation",
  "sister_agency_reviews": ["agency names from the list above"],
  "estimated_fee": total_number,
  "fee_breakdown": {"category": amount},
  "recommended_description": "professional description text",
  "reasoning": "explanation of classification decision"
}

Always provide at least one alternative classification if your confidence is below 0.95.`;
}

function buildDcDefaultSystemPrompt(): string {
  return `You are a DC Department of Buildings (DOB) permit classification expert. Your job is to analyze a scope of work and property details to determine:

1. **Permit Type**: One of: residential, trade, solar, demolition, raze
   - residential: New construction, additions, alterations, interior renovations for residential properties
   - trade: Electrical, plumbing, mechanical, or HVAC work (trade-specific permits)
   - solar: Solar panel installation permits
   - demolition: Partial demolition or interior demolition
   - raze: Complete building demolition (raze permit)

2. **Permit Subtype**: More specific classification (e.g., "interior_alteration", "addition", "new_construction", "electrical", "plumbing", "mechanical", "hvac", "rooftop_solar", "ground_mount_solar", "interior_demo", "full_raze")

3. **Review Track**: Either "walk_through" or "projectdox"
   - walk_through: Simple projects that qualify for Digital Walk-Through review (typically residential alterations under $1M, trade permits, solar installations)
   - projectdox: Complex projects requiring plan review through ProjectDox (new construction, large additions, commercial projects, projects over $1M, projects requiring structural review)

4. **Sister Agency Reviews**: Identify which DC agencies must also review:
   - Historic Preservation Office (HPO): Required if property is in a historic district
   - Department of Energy & Environment (DOEE): Required for environmental concerns, stormwater, green building
   - DC Water: Required if project affects water/sewer connections
   - District Department of Transportation (DDOT): Required if project affects public space, sidewalks, curb cuts
   - National Capital Planning Commission (NCPC): Required if property is in NCPC overlay zone
   - Office of Zoning (OZ): Required if project needs zoning relief or variance
   - Public Space Committee: Required if project encroaches on public space

5. **Fee Estimate**: Estimate the permit fee based on the DOB Building Permit Fee Schedule:
   - Base building permit fee: $50 minimum
   - Construction value-based fee: $10 per $1,000 of construction value (for projects over $5,000)
   - Plan review fee: 65% of building permit fee (for ProjectDox track)
   - Technology surcharge: $25
   - Trade permit fees: Electrical $75, Plumbing $75, Mechanical $75, HVAC $100
   - Solar permit: $50 flat fee for residential
   - Demolition permit: $200 base + $0.10/sq ft
   - Raze permit: $500 base
   Provide a breakdown of fees by category.

6. **Recommended Project Description**: Generate professional language suitable for the permit application that accurately describes the scope of work.

Return a JSON object with these exact keys:
{
  "permit_type": "residential|trade|solar|demolition|raze",
  "permit_subtype": "specific subtype string",
  "confidence": 0.0 to 1.0,
  "alternatives": [{"permit_type": "type", "confidence": 0.0 to 1.0}],
  "review_track": "walk_through|projectdox",
  "review_track_reasoning": "explanation",
  "sister_agency_reviews": ["agency names"],
  "estimated_fee": total_number,
  "fee_breakdown": {"category": amount},
  "recommended_description": "professional description text",
  "reasoning": "explanation of classification decision"
}

Always provide at least one alternative classification if your confidence is below 0.95.`;
}

async function classifyPermit(input: ClassifyInput): Promise<ClassificationResult> {
  const openai = new OpenAI({ apiKey: input.openaiKey });

  const systemPrompt = buildSystemPrompt(input.municipalityConfig ?? null);

  const jurisdictionLabel = input.municipalityConfig
    ? `${input.municipalityConfig.display_name} (${input.municipalityConfig.state})`
    : "DC";

  const propertyContext = buildPropertyContext(input);

  const userContent = `Please classify this ${jurisdictionLabel} permit application:

**Scope of Work:** ${input.scopeOfWork}

**Property Type:** ${input.propertyType ?? "Not specified"}

**Construction Value:** ${input.constructionValue ? `$${input.constructionValue.toLocaleString()}` : "Not specified"}

**Property Address:** ${input.propertyAddress ?? "Not specified"}

${propertyContext}

Classify the permit type, predict the review track, identify required sister agency reviews, estimate fees, and generate a recommended project description.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: 2048,
    response_format: { type: "json_object" },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI model");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON response from OpenAI model");
  }

  const muniCfg = input.municipalityConfig ?? null;
  const validPermitTypes = muniCfg?.permit_types?.map((pt) => pt.code.toLowerCase()) ?? [...DEFAULT_PERMIT_TYPES];
  const validReviewTracks = muniCfg?.agent_config?.review_tracks ?? [...DEFAULT_REVIEW_TRACKS];
  const validSisterAgencies = muniCfg?.agent_config?.sister_agencies ?? [...DEFAULT_SISTER_AGENCIES];

  const permitType = validatePermitType(parsed.permit_type as string, validPermitTypes);
  const reviewTrack = validateReviewTrack(parsed.review_track as string, validReviewTracks);

  const result: ClassificationResult = {
    permit_type: permitType,
    permit_subtype: (parsed.permit_subtype as string) ?? null,
    confidence: typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5,
    alternatives: parseAlternatives(parsed.alternatives, validPermitTypes),
    review_track: reviewTrack,
    review_track_reasoning: (parsed.review_track_reasoning as string) ?? "",
    sister_agency_reviews: parseSisterAgencies(parsed.sister_agency_reviews, validSisterAgencies),
    estimated_fee: typeof parsed.estimated_fee === "number" ? parsed.estimated_fee : 0,
    fee_breakdown: (parsed.fee_breakdown as Record<string, number>) ?? {},
    recommended_description: (parsed.recommended_description as string) ?? "",
    reasoning: (parsed.reasoning as string) ?? "",
  };

  return result;
}

function buildPropertyContext(input: ClassifyInput): string {
  const pi = input.propertyIntelligence;
  if (!pi || (!pi.zoning_district && !pi.historic_district && !pi.flood_hazard_zone)) {
    return "**Property Intelligence:** Not available";
  }

  const lines: string[] = ["**Property Intelligence:**"];

  if (pi.zoning_district) {
    lines.push(`- Zoning District: ${pi.zoning_district}`);
  }
  if (pi.overlay_zones && pi.overlay_zones.length > 0) {
    lines.push(`- Overlay Zones: ${pi.overlay_zones.join(", ")}`);
  }
  if (pi.historic_district) {
    lines.push("- Historic District: YES (HPO review required)");
  }
  if (pi.flood_hazard_zone) {
    lines.push("- Flood Hazard Zone: YES (DOEE review likely required)");
  }
  if (pi.active_permits && pi.active_permits.length > 0) {
    lines.push(`- Active Permits: ${pi.active_permits.length} found`);
  }
  if (pi.stop_work_orders && pi.stop_work_orders.length > 0) {
    lines.push(`- Stop Work Orders: ${pi.stop_work_orders.length} ACTIVE`);
  }
  if (pi.advisory_flags && pi.advisory_flags.length > 0) {
    lines.push(`- Advisory Flags: ${pi.advisory_flags.join(", ")}`);
  }

  return lines.join("\n");
}

function validatePermitType(value: string | undefined, validTypes: string[]): string {
  if (value && validTypes.some((vt) => vt.toLowerCase() === value.toLowerCase())) {
    return value;
  }
  return validTypes[0] ?? "residential";
}

function validateReviewTrack(value: string | undefined, validTracks: string[]): string {
  if (value && validTracks.some((vt) => vt.toLowerCase() === value.toLowerCase())) {
    return value;
  }
  return validTracks[0] ?? "standard";
}

function parseAlternatives(
  raw: unknown,
  validTypes: string[]
): Array<{ permit_type: string; confidence: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { permit_type: string; confidence: number } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).permit_type === "string" &&
        typeof (item as Record<string, unknown>).confidence === "number"
    )
    .map((item) => ({
      permit_type: validatePermitType(item.permit_type, validTypes),
      confidence: Math.max(0, Math.min(1, item.confidence)),
    }))
    .slice(0, 3);
}

function parseSisterAgencies(raw: unknown, validAgencies: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is string =>
      typeof item === "string" && validAgencies.includes(item)
  );
}
