/**
 * Stable benchmark identities for Phase 2A.6.
 * Prefer wording hash + source file hash over report-specific client IDs.
 */
import { createHash } from "node:crypto";

export const BENCHMARK_ID_VERSION = "phase2a6.benchmark-id.v1";

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/**
 * Deterministic UUIDv5-style hex UUID from namespace + name (no extra deps).
 */
export function uuidFromParts(...parts) {
  const digest = sha256Hex(`${BENCHMARK_ID_VERSION}|${parts.join("|")}`);
  const bytes = digest.slice(0, 32).split("");
  // RFC-like version/variant nibbles for stable UUID formatting.
  bytes[12] = "5";
  bytes[16] = ((parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16);
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function benchmarkFindingId(finding) {
  const wording = finding.wordingSha256
    || sha256Hex(JSON.stringify(finding.original || finding));
  const source = finding.sha256 || finding.sourceFileSha256 || "no-source-hash";
  const sheet = finding.sheetNumber || finding.original?.sheetNumber || "";
  return uuidFromParts("finding", wording, source, sheet);
}

export function benchmarkMissedIssueId({ relativePath, sourceFileSha256, title, observation }) {
  return uuidFromParts(
    "missed-issue",
    sourceFileSha256 || "no-source-hash",
    relativePath || "",
    sha256Hex(`${title || ""}\n${observation || ""}`),
  );
}

export function attachBenchmarkIds(findings) {
  return (findings || []).map((finding) => ({
    ...finding,
    benchmarkId: benchmarkFindingId(finding),
    benchmarkIdVersion: BENCHMARK_ID_VERSION,
    clientReportId: finding.clientReportId,
    reportSpecificIdNote: "clientReportId is report-local; benchmarkId is the stable evaluation identity.",
  }));
}
