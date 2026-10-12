/**
 * Deterministic jurisdiction hint vs selected run jurisdiction (no silent auto-change).
 */
export interface JurisdictionDiagnostics {
  runJurisdiction: string;
  detectedJurisdictionHints: string[];
  mismatch: boolean;
  message: string | null;
}

const DC_HINT_RE =
  /\bwashington,?\s*d\.?c\.?\b|\bdistrict of columbia\b|\b12a dcmr\b|\b4th street sw\b/i;

export function detectJurisdictionHintsFromDocumentNames(documentNames: string[]): string[] {
  const hints = documentNames.join(" ");
  const detected: string[] = [];
  if (DC_HINT_RE.test(hints)) detected.push("dc");
  return detected;
}

export function buildJurisdictionDiagnostics(
  runJurisdiction: string,
  documentNames: string[],
): JurisdictionDiagnostics {
  const detected = detectJurisdictionHintsFromDocumentNames(documentNames);
  const runKey = String(runJurisdiction || "general")
    .toLowerCase()
    .replace(/\s+/g, "-");
  const mismatch =
    detected.length > 0 && runKey === "general" && !detected.includes(runKey);
  return {
    runJurisdiction: runJurisdiction || "general",
    detectedJurisdictionHints: detected,
    mismatch,
    message: mismatch
      ? "Project documents reference Washington, DC, but jurisdiction is set to General IBC. Local amendment analysis will not run until you select DC."
      : null,
  };
}
