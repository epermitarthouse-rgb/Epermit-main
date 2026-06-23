export const RESPONSE_APPROVAL_STATUSES = [
  "AI Generated",
  "Draft",
  "Awaiting Approval",
  "Approved",
  "Changes Requested",
] as const;

export type ResponseApprovalStatus = (typeof RESPONSE_APPROVAL_STATUSES)[number];

export interface ResponseApprovalFields {
  response_text: string | null;
  response_status: ResponseApprovalStatus | null;
  ai_generated_response_text?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  last_edited_at?: string | null;
  last_edited_by?: string | null;
  change_request_note?: string | null;
  grounded_generated_at?: string | null;
}

export function isResponseApprovalStatus(value: string | null | undefined): value is ResponseApprovalStatus {
  return RESPONSE_APPROVAL_STATUSES.includes(value as ResponseApprovalStatus);
}

/** Resolve display status when legacy rows have text but no response_status yet. */
export function effectiveResponseStatus(row: ResponseApprovalFields): ResponseApprovalStatus | null {
  if (row.response_status && isResponseApprovalStatus(row.response_status)) {
    return row.response_status;
  }
  const text = row.response_text?.trim() ?? "";
  if (!text) return null;
  if (row.grounded_generated_at || row.ai_generated_response_text?.trim()) {
    return "AI Generated";
  }
  return "Draft";
}

export function responseStatusBadgeClass(status: ResponseApprovalStatus | null): string {
  switch (status) {
    case "Approved":
      return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-600/35";
    case "Changes Requested":
      return "bg-amber-500/15 text-amber-900 dark:text-amber-300 border-amber-600/35";
    case "Awaiting Approval":
      return "bg-sky-500/15 text-sky-900 dark:text-sky-300 border-sky-600/35";
    case "AI Generated":
      return "bg-violet-500/15 text-violet-800 dark:text-violet-300 border-violet-600/35";
    case "Draft":
    default:
      return "bg-cream-sunken/90 text-ink-secondary-light border-cream-sunken dark:bg-obsidian-raised/60 dark:text-ink-secondary-dark";
  }
}

export function nextStatusAfterDraftSave(
  row: ResponseApprovalFields,
  savedText: string,
): ResponseApprovalStatus {
  const trimmed = savedText.trim();
  if (row.change_request_note?.trim()) {
    return "Awaiting Approval";
  }
  const aiBaseline = row.ai_generated_response_text?.trim() ?? "";
  if (aiBaseline && trimmed === aiBaseline) {
    return "AI Generated";
  }
  return "Draft";
}

export function exportResponseApprovalLabel(row: ResponseApprovalFields): string {
  const status = effectiveResponseStatus(row);
  if (!status) return "No response";
  if (status === "Approved") return "Approved";
  return `${status} (not approved for submission)`;
}

export interface ResponseApprovalRow extends ResponseApprovalFields {
  id: string;
  project_id: string;
}

export function formatResponseForExport(row: ResponseApprovalFields): string {
  const text = row.response_text?.trim() ?? "";
  if (!text) return "";
  const status = effectiveResponseStatus(row);
  if (status === "Approved") return text;
  const label = status ?? "Unapproved";
  return `${text}\n\n[Response approval: ${label}]`;
}
