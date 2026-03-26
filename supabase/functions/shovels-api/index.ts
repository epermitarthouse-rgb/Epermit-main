import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ShovelsSearchParams {
  endpoint: "permits" | "contractors" | "jurisdictions";
  params: Record<string, string | number | boolean>;
}

/** Default date range: last 12 months (Shovels v2 requires permit_from and permit_to) */
function getDefaultDateRange(): { permit_from: string; permit_to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  return { permit_from: from, permit_to: to };
}

/** Map frontend params to Shovels v2 API params (permits & contractors require permit_from, permit_to, geo_id) */
function mapToShovelsV2Params(endpoint: string, params: Record<string, string | number | boolean>): URLSearchParams {
  const q = new URLSearchParams();
  const { permit_from, permit_to } = getDefaultDateRange();

  if (endpoint === "permits" || endpoint === "contractors") {
    // Required: permit_from, permit_to, geo_id
    q.set("permit_from", (params.permit_from as string) || permit_from);
    q.set("permit_to", (params.permit_to as string) || permit_to);

    const geoId = (params.geo_id as string) || (params.jurisdiction as string) || (params.state as string) || (params.zip_code as string);
    if (!geoId) {
      throw new Error("Shovels API requires a location: provide jurisdiction, state, or zip code");
    }
    q.set("geo_id", String(geoId).trim());

    // Size (1-100)
    const size = params.size ?? 50;
    q.set("size", String(Math.min(100, Math.max(1, Number(size) || 50))));

    // Map frontend param names to Shovels v2
    const minVal = params.permit_min_job_value ?? params.minJobValue;
    if (minVal != null && minVal !== "" && !isNaN(Number(minVal))) {
      q.set("permit_min_job_value", String(minVal));
    }
    const maxVal = params.permit_max_job_value ?? params.maxJobValue;
    if (maxVal != null && maxVal !== "" && !isNaN(Number(maxVal))) {
      q.set("permit_max_job_value", String(maxVal));
    }
    if (params.property_type != null || (params.type && params.type !== "all")) {
      const pt = (params.property_type ?? params.type) as string;
      if (pt) q.set("property_type", pt);
    }
    if (params.contractor_name != null || params.name != null) {
      const n = (params.contractor_name ?? params.name) as string;
      if (n) q.set("contractor_name", n);
    }
    if (params.contractor_license != null || params.licenseNumber != null) {
      const lic = (params.contractor_license ?? params.licenseNumber) as string;
      if (lic) q.set("contractor_license", lic);
    }
    if (params.permit_status != null) {
      const status = params.permit_status as string | string[];
      if (Array.isArray(status)) status.forEach((s) => q.append("permit_status", s));
      else if (status) q.set("permit_status", status);
    }
  } else {
    // Jurisdictions: pass through as-is
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        q.append(key, String(value));
      }
    }
  }

  return q;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const shovelsApiKey = Deno.env.get("SHOVELS_API_KEY");

  if (!shovelsApiKey) {
    console.error("SHOVELS_API_KEY not configured");
    return new Response(
      JSON.stringify({ error: "Shovels API key not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { endpoint, params }: ShovelsSearchParams = await req.json();

    console.log(`Shovels API request: ${endpoint}`, params);

    const queryParams = mapToShovelsV2Params(endpoint, params || {});

    const endpointPaths: Record<string, string> = {
      permits: "/v2/permits/search",
      contractors: "/v2/contractors/search",
      jurisdictions: "/v2/geo/jurisdictions",
    };

    const apiPath = endpointPaths[endpoint] || "/v2/permits/search";
    const url = `https://api.shovels.ai${apiPath}?${queryParams.toString()}`;

    console.log(`Calling Shovels API: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": shovelsApiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Shovels API error: ${response.status}`, errorText);
      
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: "Invalid Shovels API key" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: `Shovels API error: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    console.log(`Shovels API returned ${(data.items && data.items.length) || 0} items`);

    // Map Shovels v2 response format to frontend expectations (permits: flatten address)
    if (endpoint === "permits" && Array.isArray(data.items)) {
      data.items = data.items.map((item) => {
        const addr = item.address;
        const street = addr ? [addr.street_no, addr.street].filter(Boolean).join(" ").trim() : "";
        return {
          ...item,
          property_address: street || item.property_address || "",
          property_city: (addr && addr.city) || item.property_city || "",
          property_state: (addr && addr.state) || item.property_state || "",
          property_zip: (addr && addr.zip_code) || item.property_zip || "",
        };
      });
    }

    // Map Shovels v2 contractor response (license -> license_number, flatten address)
    if (endpoint === "contractors" && Array.isArray(data.items)) {
      data.items = data.items.map((item) => {
        const addr = item.address;
        return {
          ...item,
          license_number: item.license_number || item.license || "",
          city: item.city || (addr && addr.city) || "",
          state: item.state || (addr && addr.state) || "",
        };
      });
    }

    // Ensure total is set for pagination display
    if (data.items && data.total == null) {
      data.total = data.items.length;
    }

    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in shovels-api:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("requires a location") ? 400 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

