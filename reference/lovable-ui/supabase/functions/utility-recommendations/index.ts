// Utility load-profile → AI-generated coordinator recommendations.
// Grounded in the caller-supplied jurisdiction + utility + load context.
// Uses Lovable AI Gateway (google/gemini-2.5-flash) with JSON response format.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Category = "sizing" | "storage" | "timing" | "rate" | "code" | "other";

interface Recommendation {
  category: Category;
  title: string;
  detail: string;
  citation?: string;
}

interface ResponseShape {
  recommendations: Recommendation[];
  assumptions: string[];
  jurisdictionNotes: string;
  utilityNotes: string;
}

interface Payload {
  prototype: string;             // e.g. "Double DT + Kiosk"
  jurisdiction: string;          // e.g. "Miami-Dade, FL (HVHZ)"
  utility: string;               // e.g. "FPL", "Pepco"
  peakDemandKw: number;
  loadFactor: number;
  coincidentPeakKw: number;
  serviceEntrance: string;       // e.g. "1,600 A · 480 V"
  breakdown: { name: string; kw: number }[];
  scenarios?: { name: string; demand: string; energy: string; risk: string }[];
}

const SYSTEM_PROMPT = `You are the Utility Coordination Intelligence (UCI) agent for PermitPilot,
advising an AEC permit-expediting team on a commercial electrical service application.

Ground every recommendation in three overlapping bodies of knowledge:
1. Model codes: ICC I-Codes (IBC, IECC, IFC) and NFPA 70 (NEC) — service sizing (Art. 220/230),
   demand factors (Art. 220.87), EVSE (Art. 625), energy storage (Art. 706), on-site generation (Art. 705).
2. Local jurisdiction: state/county amendments implied by the jurisdiction field
   (e.g. Florida Building Code + HVHZ wind provisions, DCMR Title 12, Chapter 27, county-specific
   amendments). Reference the jurisdiction by name in a "citation" field where it materially matters.
3. Utility process: the named utility's commercial service application workflow — CIAC,
   transformer lead time bands, load letter/CSA requirements, applicable GS/GS-T/LGS tariff class
   and load-factor break-even, interconnection queue for storage/solar.

Return concise, actionable items — no fluff. If a field is unknown, state the assumption instead
of inventing a number. Use plain business English; the reader is a permit strategist, not an engineer.

Output must be a JSON object with this exact shape:
{
  "recommendations": [
    { "category": "sizing"|"storage"|"timing"|"rate"|"code"|"other",
      "title": "short bold headline (max 6 words)",
      "detail": "1–2 sentence recommendation with the specific number/action",
      "citation": "optional short source, e.g. 'NEC 220.87' or 'FPL GSD-1 tariff'" }
  ],
  "assumptions": ["short assumption strings, max 3"],
  "jurisdictionNotes": "1 sentence on the jurisdiction-specific angle",
  "utilityNotes": "1 sentence on the utility-process angle"
}

Return 4–6 recommendations. Do not wrap in markdown. Do not include commentary outside the JSON.`;

function buildUserPrompt(p: Payload): string {
  const bd = p.breakdown.map((b) => `  - ${b.name}: ${b.kw} kW`).join("\n");
  const sc = (p.scenarios ?? []).map((s) => `  - ${s.name}: ${s.demand}, ${s.energy}, risk=${s.risk}`).join("\n");
  return `Project context:
- Prototype: ${p.prototype}
- Jurisdiction: ${p.jurisdiction}
- Utility: ${p.utility}
- Peak demand: ${p.peakDemandKw} kW
- Load factor: ${p.loadFactor}
- Coincident peak: ${p.coincidentPeakKw} kW
- Service entrance: ${p.serviceEntrance}

Connected load breakdown:
${bd}

Growth scenarios${sc ? ":" : ": (none provided)"}
${sc}

Generate the coordinator recommendations JSON now.`;
}

function fallback(p: Payload): ResponseShape {
  return {
    recommendations: [
      { category: "sizing", title: "Verify service sizing", detail: `Confirm ${p.serviceEntrance} against NEC 220.87 max-demand method using the connected load breakdown.`, citation: "NEC 220.87" },
      { category: "timing", title: "Submit early", detail: `${p.utility} transformer lead time for this class typically exceeds 20 weeks — file the commercial service application before permit issuance.` },
      { category: "rate", title: "Rate class review", detail: `At load factor ${p.loadFactor}, compare general-service vs demand-metered tariff — the crossover usually sits near 0.55.` },
      { category: "code", title: "Jurisdiction check", detail: `Confirm ${p.jurisdiction}-specific amendments (wind, HVHZ, or DCMR chapter 27 as applicable) for service equipment location and clearances.` },
    ],
    assumptions: ["AI fallback: gateway unreachable — using deterministic template."],
    jurisdictionNotes: `Baseline check for ${p.jurisdiction}.`,
    utilityNotes: `Baseline check for ${p.utility} process.`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "missing_lovable_api_key" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json_body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Minimal validation — reject obviously wrong shapes; leave semantic judgment to the model.
  if (!payload.prototype || !payload.jurisdiction || !payload.utility || !Array.isArray(payload.breakdown)) {
    return new Response(JSON.stringify({ error: "invalid_payload", required: ["prototype", "jurisdiction", "utility", "breakdown"] }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const gwRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "custom-fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(payload) },
        ],
      }),
    });

    if (gwRes.status === 402) {
      return new Response(JSON.stringify({ error: "credits_exhausted", message: "Lovable AI credits exhausted — add credits in Workspace settings." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (gwRes.status === 429) {
      // Return 200 with fallback so the UI doesn't blank-screen; surface the flag for a soft notice.
      return new Response(JSON.stringify({ ok: true, rateLimited: true, data: fallback(payload), message: "AI gateway rate-limited — showing baseline recommendations." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!gwRes.ok) {
      const body = await gwRes.text();
      console.error("gateway error", gwRes.status, body);
      return new Response(JSON.stringify({ error: "gateway_error", status: gwRes.status, details: body, fallback: fallback(payload) }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await gwRes.json();
    const content: string = raw?.choices?.[0]?.message?.content ?? "";
    let parsed: ResponseShape;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("failed to parse model JSON", e, content?.slice(0, 400));
      parsed = fallback(payload);
    }

    return new Response(JSON.stringify({ ok: true, data: parsed, model: "google/gemini-2.5-flash" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("unexpected error", e);
    return new Response(JSON.stringify({ ok: false, error: "unexpected", data: fallback(payload) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});