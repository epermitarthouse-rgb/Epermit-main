import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  authorizeServiceExecution,
  isServiceModeEnabled,
  serviceForwardHeaders,
  type ServiceAdminClient,
  type ServiceExecutionEnv,
  type ServiceExecutionResult,
} from "./serviceExecution.ts";

function readServiceEnv(): ServiceExecutionEnv & { supabaseUrl?: string } {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  return {
    supabaseUrl,
    serviceSecret: Deno.env.get("PERMITPILOT_SERVICE_PIPELINE_SECRET"),
    // Without a URL there is no admin client, so the mode is treated as disabled.
    serviceRoleKey: supabaseUrl ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") : undefined,
  };
}

/**
 * D-063 service execution check for edge functions. `pickProjectId` must read
 * the same body field the function itself uses for the project id.
 */
export function resolveServiceExecution(
  req: Request,
  functionName: string,
  pickProjectId: (body: Record<string, unknown>) => unknown,
): Promise<ServiceExecutionResult> {
  const env = readServiceEnv();
  return authorizeServiceExecution({
    headers: req.headers,
    env,
    admin: () =>
      createClient(env.supabaseUrl!, env.serviceRoleKey!, {
        auth: { persistSession: false },
      }) as unknown as ServiceAdminClient,
    projectId: async () => {
      const body = await req.clone().json().catch(() => ({}));
      return body && typeof body === "object" ? pickProjectId(body as Record<string, unknown>) : undefined;
    },
    functionName,
  });
}

export function serviceForwardHeadersFromEnv(actingUserId: string): Record<string, string> {
  const env = readServiceEnv();
  if (!isServiceModeEnabled(env)) throw new Error("Service execution disabled");
  return serviceForwardHeaders({
    serviceSecret: env.serviceSecret!,
    serviceRoleKey: env.serviceRoleKey!,
    actingUserId,
  });
}
