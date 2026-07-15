import { describe, expect, it } from "vitest";
import type { UciLoadExtractionMeta, UciLoadProfileSummary } from "@/lib/uciLoadProfile";

function reviewQueueRefreshKey(summary: UciLoadProfileSummary): string {
  return `${summary.load_extraction?.last_extracted_at ?? ""}-${summary.load_extraction?.document_findings_bridge?.last_imported_at ?? ""}-${summary.candidate_values?.length ?? 0}`;
}

describe("document findings bridge UI metadata", () => {
  it("parses bridge import stats from load_extraction", () => {
    const meta: UciLoadExtractionMeta = {
      document_findings_bridge: {
        bridge_schema_version: "row-bridge-v1",
        last_imported_at: "2026-07-15T12:00:00.000Z",
        findings_considered: 10,
        findings_imported: 6,
        findings_skipped: 4,
        candidates_created: 6,
        candidates_reused: 2,
        candidates_superseded: 1,
        status: "partial",
        failed_findings: [{ finding_id: "f1", message: "conversion_failed" }],
      },
    };
    expect(meta.document_findings_bridge?.candidates_created).toBe(6);
    expect(meta.document_findings_bridge?.status).toBe("partial");
    expect(meta.document_findings_bridge?.failed_findings).toHaveLength(1);
  });

  it("changes Review Queue key after document findings import", () => {
    const before: UciLoadProfileSummary = {
      candidate_values: [],
      verified_values: {},
      load_extraction: {},
    };
    const after: UciLoadProfileSummary = {
      candidate_values: [{ candidate_id: "c1" } as UciLoadProfileSummary["candidate_values"][number]],
      verified_values: {},
      load_extraction: {
        document_findings_bridge: {
          last_imported_at: "2026-07-15T12:05:00.000Z",
          candidates_created: 1,
        },
      },
    };
    expect(reviewQueueRefreshKey(before)).not.toBe(reviewQueueRefreshKey(after));
  });
});
