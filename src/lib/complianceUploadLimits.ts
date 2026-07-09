/** Per-file size limit is enforced separately via MAX_FILE_SIZE_BYTES. */

/**
 * Maximum drawings per AI Compliance batch run.
 * Eight files keeps sequential runs under typical session timeouts while matching
 * the prior multi-PDF workflow; each file still gets one analyze-drawing request.
 */
export const COMPLIANCE_MAX_BATCH_FILES = 8;

/** @deprecated Use COMPLIANCE_MAX_BATCH_FILES */
export const COMPLIANCE_MAX_DRAWING_FILES = COMPLIANCE_MAX_BATCH_FILES;

export interface MergeComplianceFilesResult {
  /** New files that fit within the batch cap (caller merges with existing). */
  accepted: File[];
  /** Incoming files not added because the batch is full. */
  rejectedCount: number;
  /** Remaining slots before this merge. */
  remainingSlots: number;
}

/**
 * Accepts as many incoming files as fit under the batch cap.
 * Does not replace existing selections — caller appends `accepted` to current list.
 */
export function mergeComplianceFiles(
  existingCount: number,
  incoming: File[],
  maxFiles: number = COMPLIANCE_MAX_BATCH_FILES,
): MergeComplianceFilesResult {
  if (incoming.length === 0) {
    return { accepted: [], rejectedCount: 0, remainingSlots: Math.max(0, maxFiles - existingCount) };
  }

  const remainingSlots = Math.max(0, maxFiles - existingCount);
  const accepted = incoming.slice(0, remainingSlots);
  const rejectedCount = Math.max(0, incoming.length - accepted.length);

  return { accepted, rejectedCount, remainingSlots };
}

/**
 * @deprecated Use mergeComplianceFiles — batch mode appends files instead of replacing.
 */
export function takeComplianceFiles(incoming: File[]): {
  accepted: File[];
  rejectedCount: number;
} {
  const { accepted, rejectedCount } = mergeComplianceFiles(0, incoming);
  return { accepted, rejectedCount };
}
