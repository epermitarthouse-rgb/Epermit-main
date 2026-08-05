/**
 * User-scoped persistence for the active scrape progress widget.
 * Legacy unscoped key is migrated/cleared on read.
 */

export const LEGACY_SCRAPE_ACTIVE_SESSION_KEY = "scrape_active_session";
export const ACCELA_BROWSER_SESSION_KEY = "accela_browser_session";

export type PersistedScrapeSession = {
  userId: string;
  tenantId: string | null;
  sessionId: string;
  jobId: string | null;
  projectId: string;
  projectNum: string;
  startedAt: number;
};

export type AccelaBrowserSessionPersisted = {
  sessionId: string;
  projectId: string;
  portalType: "accela";
  permitNumber: string;
  savedAt: number;
};

export function scrapeActiveSessionStorageKey(userId: string): string {
  return `scrape_active_session:${`${userId}`.trim()}`;
}

function normalizePersisted(
  raw: Partial<PersistedScrapeSession> & Record<string, unknown>,
  fallbackUserId?: string | null,
): PersistedScrapeSession | null {
  const sessionId = `${raw.sessionId || ""}`.trim();
  const projectId = `${raw.projectId || ""}`.trim();
  if (!sessionId || !projectId) return null;

  const userId = `${raw.userId || fallbackUserId || ""}`.trim();
  if (!userId) return null;

  const tenantRaw = raw.tenantId;
  const tenantId =
    tenantRaw == null || `${tenantRaw}`.trim() === ""
      ? null
      : `${tenantRaw}`.trim();

  return {
    userId,
    tenantId,
    sessionId,
    jobId: raw.jobId ? `${raw.jobId}`.trim() : null,
    projectId,
    projectNum: `${raw.projectNum || ""}`.trim(),
    startedAt: Number(raw.startedAt) || Date.now(),
  };
}

/** Remove legacy unscoped key. Optionally migrate into user-scoped key. */
export function migrateOrClearLegacyScrapeSession(
  userId: string | null | undefined,
  storage: Storage = localStorage,
): PersistedScrapeSession | null {
  let legacyRaw: string | null = null;
  try {
    legacyRaw = storage.getItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
  if (!legacyRaw) return null;

  try {
    storage.removeItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY);
  } catch {
    /* ignore */
  }

  const uid = `${userId || ""}`.trim();
  if (!uid) return null;

  try {
    const parsed = JSON.parse(legacyRaw) as Partial<PersistedScrapeSession>;
    const normalized = normalizePersisted(parsed, uid);
    if (!normalized) return null;
    // Only keep if legacy had no conflicting userId, or matches current user.
    if (parsed.userId && `${parsed.userId}`.trim() !== uid) return null;
    persistScrapeSession(normalized, storage);
    return normalized;
  } catch {
    return null;
  }
}

export function getPersistedScrapeSession(
  userId: string | null | undefined,
  storage: Storage = localStorage,
): PersistedScrapeSession | null {
  const uid = `${userId || ""}`.trim();
  if (!uid) {
    migrateOrClearLegacyScrapeSession(null, storage);
    return null;
  }

  try {
    const raw = storage.getItem(scrapeActiveSessionStorageKey(uid));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedScrapeSession>;
      const normalized = normalizePersisted(parsed, uid);
      if (normalized && normalized.userId === uid) return normalized;
      clearPersistedScrapeSession(uid, storage);
      return null;
    }
  } catch {
    /* fall through to legacy migrate */
  }

  return migrateOrClearLegacyScrapeSession(uid, storage);
}

export function persistScrapeSession(
  payload: PersistedScrapeSession,
  storage: Storage = localStorage,
): void {
  const uid = `${payload.userId || ""}`.trim();
  if (!uid) return;
  try {
    storage.removeItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY);
    storage.setItem(
      scrapeActiveSessionStorageKey(uid),
      JSON.stringify({
        ...payload,
        userId: uid,
        tenantId: payload.tenantId ? `${payload.tenantId}`.trim() : null,
        sessionId: `${payload.sessionId}`.trim(),
        jobId: payload.jobId ? `${payload.jobId}`.trim() : null,
        projectId: `${payload.projectId}`.trim(),
        projectNum: `${payload.projectNum || ""}`.trim(),
        startedAt: Number(payload.startedAt) || Date.now(),
      }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearPersistedScrapeSession(
  userId?: string | null,
  storage: Storage = localStorage,
): void {
  try {
    storage.removeItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY);
  } catch {
    /* ignore */
  }
  const uid = `${userId || ""}`.trim();
  if (!uid) return;
  try {
    storage.removeItem(scrapeActiveSessionStorageKey(uid));
  } catch {
    /* ignore */
  }
}

/** Clear every scrape_active_session* key (sign-out / full reset). */
export function clearAllPersistedScrapeSessions(
  storage: Storage = localStorage,
): void {
  try {
    storage.removeItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY);
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith("scrape_active_session")) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearPersistedScrapeSessionForProject(
  projectId: string,
  userId?: string | null,
  storage: Storage = localStorage,
): void {
  const p = getPersistedScrapeSession(userId, storage);
  if (!p?.projectId) return;
  if (`${p.projectId}`.trim() !== `${projectId}`.trim()) return;
  clearPersistedScrapeSession(userId ?? p.userId, storage);
}

export function getPersistedScrapeSessionForProject(
  projectId: string,
  userId?: string | null,
  storage: Storage = localStorage,
): PersistedScrapeSession | null {
  const p = getPersistedScrapeSession(userId, storage);
  if (!p?.sessionId || !p.projectId) return null;
  if (`${p.projectId}`.trim() !== `${projectId}`.trim()) return null;
  return p;
}

export function persistAccelaBrowserSession(
  payload: AccelaBrowserSessionPersisted,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(ACCELA_BROWSER_SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readAccelaBrowserSessionRaw(
  storage: Storage = localStorage,
): AccelaBrowserSessionPersisted | null {
  try {
    const raw = storage.getItem(ACCELA_BROWSER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccelaBrowserSessionPersisted;
    if (!parsed?.sessionId || !parsed?.projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAccelaBrowserSessionStorage(
  storage: Storage = localStorage,
): void {
  try {
    storage.removeItem(ACCELA_BROWSER_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function getPersistedAccelaSessionForProject(
  projectId: string,
  storage: Storage = localStorage,
): AccelaBrowserSessionPersisted | null {
  const p = readAccelaBrowserSessionRaw(storage);
  if (!p?.sessionId || !p.projectId) return null;
  if (`${p.projectId}`.trim() !== `${projectId}`.trim()) return null;
  return {
    sessionId: `${p.sessionId}`.trim(),
    projectId: `${p.projectId}`.trim(),
    portalType: "accela",
    permitNumber: `${p.permitNumber || ""}`.trim(),
    savedAt: Number(p.savedAt) || 0,
  };
}
