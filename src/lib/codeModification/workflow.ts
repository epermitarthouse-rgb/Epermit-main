/**
 * Analysis-mode routing. Standard compliance and DC modification stay separate.
 */

export type AnalyzerWorkflowKind = "standard" | "dc_code_modification";

export type AnalyzerWorkflow =
  | { ok: true; endpoint: "/api/analyze-drawing" | "/api/analyze-code-modification" }
  | { ok: false; reason: "dc_only" };

const DC_KEYS = new Set([
  "dc",
  "d.c.",
  "d-c",
  "washington-dc",
  "washington-d.c.",
  "district-of-columbia",
]);

export function isDcJurisdiction(jurisdiction: string | null | undefined): boolean {
  const raw = String(jurisdiction ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
  return DC_KEYS.has(raw);
}

export function analyzerWorkflowFor(
  kind: AnalyzerWorkflowKind,
  jurisdiction?: string | null,
): AnalyzerWorkflow {
  if (kind === "standard") {
    return { ok: true, endpoint: "/api/analyze-drawing" };
  }
  if (!isDcJurisdiction(jurisdiction)) {
    return { ok: false, reason: "dc_only" };
  }
  return { ok: true, endpoint: "/api/analyze-code-modification" };
}
