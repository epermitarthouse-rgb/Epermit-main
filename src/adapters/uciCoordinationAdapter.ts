import type { StatusTone } from "@/components/design/ProductPrimitives";

/** UCI stage state enum → StatusPill tone. Labels stay enum-preserving. */
export function uciStageStateTone(state: string | null | undefined): StatusTone {
  const s = (state || "").toUpperCase();
  if (["COMPLETED", "APPROVED", "SUBMITTED"].includes(s)) return "good";
  if (["IN_PROGRESS", "READY", "PENDING_REVIEW", "NOT_STARTED"].includes(s)) return "info";
  if (["BLOCKED", "FAILED", "REJECTED", "ACCESS_DENIED"].includes(s)) return "bad";
  if (["PARTIAL", "NEEDS_INPUT", "WARNING"].includes(s)) return "warn";
  return "default";
}
