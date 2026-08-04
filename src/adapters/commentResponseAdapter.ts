import type { StatusTone } from "@/components/design/ProductPrimitives";

/** Map response_status / comment status → tone without changing strings sent to APIs. */
export function commentResponseTone(status: string | null | undefined): StatusTone {
  const s = (status || "").toLowerCase();
  if (["approved", "accepted", "complete", "completed"].some((k) => s.includes(k))) return "good";
  if (["pending", "draft", "generated", "suggested", "in_review"].some((k) => s.includes(k))) return "warn";
  if (["rejected", "failed", "error"].some((k) => s.includes(k))) return "bad";
  return "default";
}
