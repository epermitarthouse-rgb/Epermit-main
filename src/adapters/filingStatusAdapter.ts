import type { StatusTone } from "@/components/design/ProductPrimitives";

/** Preserve filing_status enum strings; map tone only. */
export function filingStatusTone(status: string | null | undefined): StatusTone {
  const s = (status || "").toLowerCase();
  if (["submitted", "approved", "completed", "success"].some((k) => s.includes(k))) return "good";
  if (["preflight", "draft", "ready", "queued", "in_progress", "running"].some((k) => s.includes(k))) return "info";
  if (["failed", "error", "cancelled", "canceled", "rejected"].some((k) => s.includes(k))) return "bad";
  if (["partial", "needs_review", "warning"].some((k) => s.includes(k))) return "warn";
  return "default";
}
