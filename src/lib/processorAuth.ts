/**
 * Node/Vite mirror of supabase/functions/_shared/processorAuth.ts for tests.
 */

export interface ProcessorAuthResult {
  authorized: boolean;
  error?: string;
}

export function verifyProcessorBearerToken(
  authHeader: string | null | undefined,
  serviceRoleKey: string | null | undefined,
): ProcessorAuthResult {
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
