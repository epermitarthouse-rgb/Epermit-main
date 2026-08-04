import { effectiveResponseStatus, type ResponseApprovalFields } from "@/lib/responseApproval";

/** URL / chip keys for Response Matrix lifecycle filters (`?metric=`). */
export type ResponseMatrixMetric =
  | "needs-response"
  | "in-draft"
  | "accepted";

export const RESPONSE_MATRIX_METRICS: readonly ResponseMatrixMetric[] = [
  "needs-response",
  "in-draft",
  "accepted",
] as const;

export type LifecycleBucket = ResponseMatrixMetric | "other";

/** Loose row shape — matches parsed_comments / ParsedCommentRow without narrowing response_status. */
export type LifecycleRow = {
  response_text?: string | null;
  response_status?: string | null;
  ai_generated_response_text?: string | null;
  grounded_generated_at?: string | null;
};

/**
 * Mutually exclusive lifecycle on the response-approval axis.
 * Needs response + In draft + Accepted (+ Other) === comment count.
 */
export function classifyResponseLifecycle(row: LifecycleRow): LifecycleBucket {
  if (!row.response_text?.trim()) return "needs-response";
  const rs = effectiveResponseStatus(row as ResponseApprovalFields);
  if (rs === "Approved") return "accepted";
  if (rs === "AI Generated" || rs === "Draft" || rs === "Awaiting Approval" || rs === "Changes Requested") {
    return "in-draft";
  }
  return "other";
}

export function parseResponseMatrixMetric(
  value: string | null | undefined,
): ResponseMatrixMetric | null {
  if (!value) return null;
  return RESPONSE_MATRIX_METRICS.includes(value as ResponseMatrixMetric)
    ? (value as ResponseMatrixMetric)
    : null;
}

export function countLifecycleMetrics(rows: LifecycleRow[]): {
  needsResponse: number;
  inDraft: number;
  accepted: number;
  other: number;
} {
  let needsResponse = 0;
  let inDraft = 0;
  let accepted = 0;
  let other = 0;
  for (const row of rows) {
    switch (classifyResponseLifecycle(row)) {
      case "needs-response":
        needsResponse += 1;
        break;
      case "in-draft":
        inDraft += 1;
        break;
      case "accepted":
        accepted += 1;
        break;
      default:
        other += 1;
    }
  }
  return { needsResponse, inDraft, accepted, other };
}
