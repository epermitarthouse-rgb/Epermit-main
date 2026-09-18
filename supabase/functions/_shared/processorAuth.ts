/**
 * Auth for scheduled processor edge functions (pg_cron / internal) and admin manual triggers.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ProcessorAuthResult {
  authorized: boolean;
  error?: string;
}

/** Accept auto-injected and manually-set service role env vars (hosted may differ). */
function configuredServiceRoleKeys(): string[] {
  const keys = new Set<string>();
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"] as const) {
    const value = Deno.env.get(name)?.trim();
    if (value) keys.add(value);
  }
  return [...keys];
}

export function verifyProcessorRequest(req: Request): ProcessorAuthResult {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKeys = configuredServiceRoleKeys();

  if (!serviceRoleKeys.length) {
    return { authorized: false, error: "Processor not configured" };
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return { authorized: false, error: "Unauthorized" };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!serviceRoleKeys.includes(token)) {
    return { authorized: false, error: "Unauthorized" };
  }

  return { authorized: true };
}

/** Service-role (cron) OR platform admin JWT (Process Now from admin UI). */
export async function verifyDripProcessorRequest(req: Request): Promise<ProcessorAuthResult> {
  const serviceAuth = verifyProcessorRequest(req);
  if (serviceAuth.authorized) {
    return serviceAuth;
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { authorized: false, error: "Unauthorized" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return { authorized: false, error: "Processor not configured" };
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return { authorized: false, error: "Unauthorized" };
  }

  const { data: roleRows, error: roleError } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["admin", "super_admin"]);

  if (roleError || !roleRows?.length) {
    return { authorized: false, error: "Admin access required" };
  }

  return { authorized: true };
}

export function processorUnauthorizedResponse(
  result: ProcessorAuthResult,
  corsHeaders: Record<string, string>,
): Response {
  const status = result.error === "Admin access required" ? 403 : 401;
  return new Response(
    JSON.stringify({ error: result.error ?? "Unauthorized" }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
