export function readPortalCheckpointVersion(
  portalData: Record<string, unknown> | null | undefined,
): number {
  if (!portalData) return 0;
  const v = Number(portalData.checkpointVersion);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function mergePortalDataIfNewer<T extends Record<string, unknown>>(
  current: T | null,
  incoming: T | null,
): T | null {
  if (!incoming) return current;
  if (!current) return incoming;
  const currentV = readPortalCheckpointVersion(current);
  const incomingV = readPortalCheckpointVersion(incoming);
  // Version 0 must never replace an established checkpoint (>= 1).
  if (currentV > 0) {
    if (incomingV === 0 || (incomingV > 0 && incomingV < currentV)) {
      return current;
    }
  }
  return incoming;
}
