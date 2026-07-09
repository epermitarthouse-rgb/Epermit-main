/** AI Compliance accepts one drawing per analysis run. */
export const COMPLIANCE_MAX_DRAWING_FILES = 1;

/**
 * Keeps at most one file for AI Compliance upload.
 * New selections replace any existing file.
 */
export function takeComplianceFiles(incoming: File[]): {
  accepted: File[];
  rejectedCount: number;
} {
  if (incoming.length === 0) {
    return { accepted: [], rejectedCount: 0 };
  }

  const accepted = [incoming[0]];
  const rejectedCount = Math.max(0, incoming.length - 1);
  return { accepted, rejectedCount };
}
