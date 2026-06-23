/** Permanent Supabase Storage object URL (public or signed). */
export function isSupabaseStorageUrl(url: string | null | undefined): boolean {
  return /supabase\.co\/storage\//i.test(String(url ?? "").trim());
}

/** PGC / Brava / session viewer URLs that require an active portal login. */
export function isPgcEphemeralPortalFileUrl(
  url: string | null | undefined,
): boolean {
  const s = String(url ?? "").trim();
  if (!s || isSupabaseStorageUrl(s)) return false;
  if (/^blob:|^data:/i.test(s)) return false;
  if (
    /princegeorgescountymd\.gov|eplans\.princegeorges/i.test(s) &&
    /(ActiveXViewer|FileViewer|BravaServer|viewfile|sessionended|\/login\b)/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/ProjectDox/i.test(s) && !isSupabaseStorageUrl(s)) return true;
  return false;
}

export function isFileDownloadFailed(
  downloadStatus: string | null | undefined,
): boolean {
  const ds = String(downloadStatus ?? "")
    .trim()
    .toLowerCase();
  if (!ds) return false;
  return ds === "failed" || ds === "failed_non_retryable" || ds.startsWith("failed_");
}

/**
 * Link priority for PGC portal_data file rows:
 * publicUrl (Supabase) → viewUrl (Supabase) → downloadUrl (Supabase)
 * → first non-ephemeral permanent URL among those fields.
 */
export function resolvePgcPortalFileOpenUrl(file: {
  publicUrl?: string | null;
  viewUrl?: string | null;
  downloadUrl?: string | null;
  downloadStatus?: string | null;
}): string | null {
  if (isFileDownloadFailed(file.downloadStatus)) return null;

  const candidates = [file.publicUrl, file.viewUrl, file.downloadUrl];
  for (const raw of candidates) {
    const u = String(raw ?? "").trim();
    if (u && isSupabaseStorageUrl(u)) return u;
  }
  for (const raw of candidates) {
    const u = String(raw ?? "").trim();
    if (u && !isPgcEphemeralPortalFileUrl(u)) return u;
  }
  return null;
}
