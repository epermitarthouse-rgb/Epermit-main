import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface FetchPermitDataRequest {
  address: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("SHOVEL_API_KEY");
  if (!apiKey) {
    console.error("SHOVEL_API_KEY not configured in Supabase Secrets");
    return new Response(
      JSON.stringify({ error: "Server configuration error: API key not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = (await req.json()) as FetchPermitDataRequest;
    const { address } = body;

    if (!address || typeof address !== "string") {
      return new Response(
        JSON.stringify({ error: "Request body must include { address: string }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const query = encodeURIComponent(address.trim());
    const url = `https://api.shovels.ai/v2/addresses/search?q=${query}&size=50`;

    console.log(`Fetching permit data for address: ${address}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Shovels API error: ${response.status}`, errorText);

      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: "Invalid API key" }),
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
        JSON.stringify({ error: `Shovels API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    console.log(`Shovels API returned ${data.items?.length ?? 0} address results`);

    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in fetch-permit-data:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
