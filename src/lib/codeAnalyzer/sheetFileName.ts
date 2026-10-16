/**
 * Permit-set sheet filenames (A-1.03-00.pdf, A-1.04.00.pdf, M-1.1.pdf).
 * Keep in sync with code-analyzer-worker/lib/classify.js.
 */
const SPEC_FILENAME_RE =
  /\b(spec|specification|manual|project manual|division|div[\s_-]?\d|technical spec|procurement)\b/i;

const ARCHITECTURAL_SHEET_FILE_RE = /^[A-Z]{1,4}(?:[-.]?\d+){1,6}$/i;

export function architecturalSheetFileStem(fileName: string | null | undefined): string {
  const base = String(fileName || "").split(/[/\\]/).pop() || "";
  return base.replace(/\.[^.]+$/, "").replace(/-page\d+$/i, "").trim();
}

/** True when the file name is only a discipline sheet number, not a spec manual. */
export function isArchitecturalSheetFileName(fileName: string | null | undefined): boolean {
  const stem = architecturalSheetFileStem(fileName);
  if (!stem || SPEC_FILENAME_RE.test(stem)) return false;
  return ARCHITECTURAL_SHEET_FILE_RE.test(stem);
}
