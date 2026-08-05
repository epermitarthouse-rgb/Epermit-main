/**
 * User-facing error helpers for Permit Wizard filing flows.
 * Keeps raw PostgREST / Postgres schema-cache messages out of toasts.
 */

export function isMissingRelationError(err: unknown): boolean {
  const code = String((err as { code?: string })?.code || "");
  const msg = String((err as { message?: string })?.message || err || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
  );
}

function missingTableName(err: unknown): string | null {
  const msg = String((err as { message?: string })?.message || err || "");
  const match = msg.match(/['"]public\.([^'"]+)['"]/i) || msg.match(/table ['"]([^'"]+)['"]/i);
  return match?.[1] ?? null;
}

/** Map Supabase/PostgREST failures to safe filing UI copy. */
export function formatPermitFilingError(
  err: unknown,
  fallback = "Failed to create filing"
): string {
  if (isMissingRelationError(err)) {
    const table = missingTableName(err);
    if (table === "permit_filings" || !table) {
      return (
        "Permit filing storage is not set up in this environment yet. " +
        "Ask an admin to apply the Permit Wizard migrations, then try again."
      );
    }
    return (
      `Required filing table "${table}" is not available in this environment. ` +
      "Ask an admin to apply the Permit Wizard migrations, then try again."
    );
  }

  const msg = String((err as { message?: string })?.message || "").trim();
  if (!msg) return fallback;

  // Never surface PostgREST internals / schema-cache wording.
  if (
    msg.toLowerCase().includes("schema cache") ||
    msg.toLowerCase().includes("pgrst") ||
    msg.toLowerCase().includes("could not find the")
  ) {
    return fallback;
  }

  return msg;
}

/**
 * Decide whether create-mode should insert a new project or reuse one
 * already created in this dialog session (avoids duplicate projects on retry).
 */
export function resolveProjectIdForFiling(params: {
  createMode: boolean;
  existingProjectId?: string | null;
  sessionCreatedProjectId?: string | null;
}): { projectId: string | null; shouldCreateProject: boolean } {
  // Prefer session-created id even if createMode was flipped after success.
  if (params.sessionCreatedProjectId) {
    return {
      projectId: params.sessionCreatedProjectId,
      shouldCreateProject: false,
    };
  }

  if (!params.createMode) {
    return {
      projectId: params.existingProjectId ?? null,
      shouldCreateProject: false,
    };
  }

  return { projectId: null, shouldCreateProject: true };
}
