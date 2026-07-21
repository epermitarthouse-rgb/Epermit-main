import type { StatusTone } from "@/components/design/ProductPrimitives";

/** Presentation-only: map project status strings → StatusPill tones. Does not invent statuses. */
export function projectStatusTone(status: string | null | undefined): StatusTone {
  const s = (status || "").toLowerCase();
  if (["completed", "approved", "active", "issued"].some((k) => s.includes(k))) return "good";
  if (["pending", "in_review", "in-review", "submitted", "draft"].some((k) => s.includes(k))) return "warn";
  if (["rejected", "failed", "cancelled", "canceled", "on_hold", "on-hold"].some((k) => s.includes(k))) return "bad";
  return "default";
}

export type ProjectCardViewModel = {
  id: string;
  name: string;
  status: string | null;
  statusTone: StatusTone;
  jurisdiction: string | null;
  permitNumber: string | null;
  address: string | null;
};

export function toProjectCardViewModel(project: {
  id: string;
  name: string;
  status?: string | null;
  jurisdiction?: string | null;
  permit_number?: string | null;
  address?: string | null;
}): ProjectCardViewModel {
  return {
    id: project.id,
    name: project.name,
    status: project.status ?? null,
    statusTone: projectStatusTone(project.status),
    jurisdiction: project.jurisdiction ?? null,
    permitNumber: project.permit_number ?? null,
    address: project.address ?? null,
  };
}
