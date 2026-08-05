import { supabase } from "@/integrations/supabase/client";

export type AccessAuditEvent =
  | "sign_in"
  | "sign_in_failed"
  | "sign_out"
  | "access_denied";

type LogInput = {
  event: AccessAuditEvent;
  email?: string | null;
  userId?: string | null;
  roleAtEvent?: string | null;
  path?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Append a row to the access audit log. Fire-and-forget: failures are swallowed
 * so an audit error never blocks the user's auth flow. Admins can read the log
 * at /admin/audit.
 */
export async function logAccessEvent(input: LogInput): Promise<void> {
  try {
    await supabase.from("access_audit_log").insert({
      event_type: input.event,
      email: input.email ?? null,
      user_id: input.userId ?? null,
      role_at_event: input.roleAtEvent ?? null,
      path: input.path ?? (typeof window !== "undefined" ? window.location.pathname : null),
      reason: input.reason ?? null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      metadata: (input.metadata ?? {}) as never,
    });
  } catch {
    // best-effort logging
  }
}