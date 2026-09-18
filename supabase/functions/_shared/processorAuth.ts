/**
 * Service-role-only auth for scheduled processor edge functions (pg_cron / internal).
 */

export interface ProcessorAuthResult {
  authorized: boolean;
  error?: string;
}

export function verifyProcessorRequest(req: Request): ProcessorAuthResult {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceRoleKey) {
    return { authorized: false, error: "Processor not configured" };
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return { authorized: false, error: "Unauthorized" };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (token !== serviceRoleKey) {
    return { authorized: false, error: "Unauthorized" };
  }

  return { authorized: true };
}

export function processorUnauthorizedResponse(
  result: ProcessorAuthResult,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ error: result.error ?? "Unauthorized" }),
    {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
