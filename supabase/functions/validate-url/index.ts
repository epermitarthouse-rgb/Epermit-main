import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to fetch the URL with a HEAD request first, then GET if that fails
    let response;
    try {
      response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
    } catch {
      // Some servers don't support HEAD, try GET
      response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });
    }

    const isAccessible = response.ok || response.status === 301 || response.status === 302 || response.status === 308;

    return new Response(
      JSON.stringify({
        url,
        accessible: isAccessible,
        status: response.status,
        statusText: response.statusText,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        url: "",
        accessible: false,
        error: errorMessage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
