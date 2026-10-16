/**
 * Analyzer jurisdiction key from a stored project or run value.
 * Washington, D.C. is "dc". Washington State stays "washington".
 */
export function canonicalAnalyzerJurisdiction(value: string | null | undefined): string {
  const original = String(value || "").trim();
  if (!original) return "general";
  const lowered = original.toLowerCase().replace(/[._,]/g, " ").replace(/\s+/g, " ").trim();
  if (lowered === "general" || lowered === "general ibc" || lowered === "ibc") return "general";
  const compact = lowered.replace(/[^a-z0-9]+/g, "");
  if (
    compact === "dc" ||
    compact === "washingtondc" ||
    compact === "districtofcolumbia" ||
    compact === "12adcmr" ||
    (compact.includes("washington") && compact.includes("dc") && !compact.includes("state"))
  ) {
    return "dc";
  }
  return lowered.replace(/\s+/g, "-");
}

/**
 * The Code Analyzer selector defaults to "general". A project that already stores
 * a jurisdiction (or a DC city/state) should seed that value so the run is not general.
 */
export function jurisdictionForAnalyzerProject(project: {
  jurisdiction?: string | null;
  city?: string | null;
  state?: string | null;
} | null | undefined): string {
  if (!project) return "general";
  const fromField = canonicalAnalyzerJurisdiction(project.jurisdiction);
  if (fromField !== "general") return fromField;
  const city = String(project.city || "").trim().toLowerCase();
  const state = String(project.state || "").trim().toLowerCase().replace(/\./g, "");
  const stateIsDc = state === "dc" || state === "district of columbia";
  const cityIsWashington = !city || city === "washington" || city === "washington dc";
  if (stateIsDc && cityIsWashington) return "dc";
  return "general";
}
