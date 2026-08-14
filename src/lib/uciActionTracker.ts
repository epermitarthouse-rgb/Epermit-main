import type {
  UciActionItem,
  UciActionItemOverlay,
  UciActionTrackerPayload,
  UciTrackerStatus,
} from "@/types/uciActionTracker";
import { UCI_TRACKER_STATUSES } from "@/types/uciActionTracker";

export type MergedUciActionItem = UciActionItem & {
  overlayApplied: boolean;
  effectiveStatus: UciTrackerStatus;
  effectiveBlockerGap: string;
  effectiveNextAction: string;
  effectiveNotes: string;
  effectiveLastVerified: string;
};

export function mergeUciActionItem(
  item: UciActionItem,
  overlay?: UciActionItemOverlay | null,
): MergedUciActionItem {
  const hasOverlay = Boolean(
    overlay &&
      (overlay.status != null ||
        overlay.blockerGap != null ||
        overlay.nextAction != null ||
        overlay.notes != null ||
        overlay.lastVerified != null),
  );

  return {
    ...item,
    overlayApplied: hasOverlay,
    effectiveStatus: overlay?.status ?? item.status,
    effectiveBlockerGap: overlay?.blockerGap ?? item.blockerGap,
    effectiveNextAction: overlay?.nextAction ?? item.nextAction,
    effectiveNotes: overlay?.notes ?? item.notes ?? "",
    effectiveLastVerified: overlay?.lastVerified ?? item.lastVerified,
  };
}

export function countByStatus(items: MergedUciActionItem[]): Record<UciTrackerStatus, number> {
  const counts = Object.fromEntries(UCI_TRACKER_STATUSES.map((s) => [s, 0])) as Record<
    UciTrackerStatus,
    number
  >;
  for (const item of items) {
    counts[item.effectiveStatus] += 1;
  }
  return counts;
}

export function pilotItems(items: MergedUciActionItem[]): MergedUciActionItem[] {
  return items.filter((i) => i.scope === "pilot");
}

export function completionRatio(items: MergedUciActionItem[]): {
  complete: number;
  total: number;
  pct: number;
} {
  const total = items.length;
  const complete = items.filter((i) => i.effectiveStatus === "Complete").length;
  return { complete, total, pct: total === 0 ? 0 : Math.round((complete / total) * 100) };
}

export function bucketItems(
  items: MergedUciActionItem[],
  bucket: UciActionItem["bucket"],
): MergedUciActionItem[] {
  return items.filter((i) => i.bucket === bucket);
}

export type UciTrackerFilters = {
  search: string;
  status: UciTrackerStatus | "all";
  phaseWeek: string | "all";
  scope: "all" | "pilot" | "deferred";
  agent: string | "all";
  criticalOnly: boolean;
};

export const defaultUciTrackerFilters: UciTrackerFilters = {
  search: "",
  status: "all",
  phaseWeek: "all",
  scope: "all",
  agent: "all",
  criticalOnly: false,
};

export function matchesUciTrackerFilters(
  item: MergedUciActionItem,
  filters: UciTrackerFilters,
): boolean {
  if (filters.status !== "all" && item.effectiveStatus !== filters.status) return false;
  if (filters.phaseWeek !== "all" && item.phaseWeek !== filters.phaseWeek) return false;
  if (filters.scope !== "all" && item.scope !== filters.scope) return false;
  if (filters.agent !== "all") {
    const agent = item.agent ?? "None";
    if (agent !== filters.agent) return false;
  }
  if (filters.criticalOnly && !item.criticalPath) return false;

  const q = filters.search.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    String(item.sequence),
    item.phaseWeek,
    item.actionItem,
    item.clientRequirement,
    item.statusExplanation,
    item.effectiveBlockerGap,
    item.effectiveNextAction,
    item.effectiveNotes,
    item.agent ?? "",
    item.lifecycleStage ?? "",
    item.subStatus ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

export function sortBySequence(
  items: MergedUciActionItem[],
  direction: "asc" | "desc",
): MergedUciActionItem[] {
  const sorted = [...items].sort((a, b) => a.sequence - b.sequence);
  return direction === "asc" ? sorted : sorted.reverse();
}

export function assertTrackerPayload(payload: UciActionTrackerPayload): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!payload.items || payload.items.length !== 42) {
    errors.push(`Expected 42 items, found ${payload.items?.length ?? 0}`);
  }
  const seen = new Set<number>();
  for (const item of payload.items ?? []) {
    if (seen.has(item.sequence)) errors.push(`Duplicate sequence ${item.sequence}`);
    seen.add(item.sequence);
    if (!UCI_TRACKER_STATUSES.includes(item.status)) {
      errors.push(`Invalid status on #${item.sequence}: ${item.status}`);
    }
  }
  for (let i = 1; i <= 42; i += 1) {
    if (!seen.has(i)) errors.push(`Missing sequence ${i}`);
  }
  return { ok: errors.length === 0, errors };
}

export function statusBadgeClass(status: UciTrackerStatus): string {
  switch (status) {
    case "Complete":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "Partial":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "Scaffolded":
      return "bg-orange-100 text-orange-900 border-orange-200";
    case "Not Started":
      return "bg-slate-100 text-slate-800 border-slate-200";
    case "Blocked":
      return "bg-red-100 text-red-900 border-red-200";
    case "Production Verification Required":
      return "bg-violet-100 text-violet-900 border-violet-200";
    case "Deferred":
      return "bg-sky-100 text-sky-900 border-sky-200";
    default:
      return "bg-muted text-foreground";
  }
}
