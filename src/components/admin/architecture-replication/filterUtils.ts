import type { ReplicationComment } from "@/types/architectureReplication";
import type { MergedRow } from "./ArchitectureReplicationDetailSheet";

export const ALL = "all";

export type RowKindFilter = "all" | "lovable" | "permitpilot_only";

export interface FilterState {
  search: string;
  area: string;
  matchStatus: string;
  priority: string;
  uiStatus: string;
  backendStatus: string;
  routeDecision: string;
  risk: string;
  implementationStatus: string;
  verificationStatus: string;
  blockedOnly: boolean;
  hasComments: boolean;
  hasPreserve: boolean;
  rowKind: RowKindFilter;
}

export const defaultFilters: FilterState = {
  search: "",
  area: ALL,
  matchStatus: ALL,
  priority: ALL,
  uiStatus: ALL,
  backendStatus: ALL,
  routeDecision: ALL,
  risk: ALL,
  implementationStatus: ALL,
  verificationStatus: ALL,
  blockedOnly: false,
  hasComments: false,
  hasPreserve: false,
  rowKind: "all",
};

export type ChipKey =
  | "p0"
  | "p1"
  | "missing"
  | "uiOnly"
  | "backendConnected"
  | "inProgress"
  | "blocked"
  | "readyForTest"
  | "verified"
  | "clientApproved";

export const CHIP_DEFS: Array<{ key: ChipKey; label: string; test: (m: MergedRow) => boolean }> = [
  { key: "p0", label: "P0", test: (m) => m.row.priority === "P0" },
  { key: "p1", label: "P1", test: (m) => m.row.priority === "P1" },
  { key: "missing", label: "Missing", test: (m) => m.row.derived.isMissing },
  { key: "uiOnly", label: "UI only", test: (m) => m.row.derived.isUiOnly },
  { key: "backendConnected", label: "Backend connected", test: (m) => m.row.derived.isBackendConnected },
  { key: "inProgress", label: "In progress", test: (m) => m.overlay.implementation_status === "In progress" },
  {
    key: "blocked",
    label: "Blocked",
    test: (m) => m.overlay.is_blocked || m.overlay.implementation_status === "Blocked",
  },
  { key: "readyForTest", label: "Ready for test", test: (m) => m.completion === "Ready for test" },
  {
    key: "verified",
    label: "Verified",
    test: (m) =>
      m.overlay.verification_status === "E2E checked" || m.overlay.verification_status === "Client approved",
  },
  {
    key: "clientApproved",
    label: "Client approved",
    test: (m) => m.overlay.verification_status === "Client approved",
  },
];

function haystack(m: MergedRow, comments: ReplicationComment[]): string {
  const { row, overlay } = m;
  return [
    row.rowId,
    row.legacyId,
    row.lovable.name,
    row.lovable.route,
    row.lovable.functionality,
    row.lovable.sourceFile,
    row.lovable.notes,
    row.permitPilot.featureName,
    row.permitPilot.route,
    row.permitPilot.sourceFiles,
    row.permitPilot.matchStatus,
    row.work.preserve,
    row.work.requiredFrontend,
    row.work.requiredBackend,
    overlay.blocker_description,
    overlay.client_feedback,
    overlay.assigned_owner,
    ...comments.map((c) => c.comment_text),
  ]
    .filter(Boolean)
    .join(" \u241F ")
    .toLowerCase();
}

export function matchesFilters(
  m: MergedRow,
  filters: FilterState,
  activeChips: Set<ChipKey>,
  commentsByRow: Record<string, ReplicationComment[]>,
): boolean {
  const { row, overlay } = m;

  if (filters.rowKind !== "all" && row.rowKind !== filters.rowKind) return false;
  if (filters.area !== ALL && row.lovable.area !== filters.area) return false;
  if (filters.matchStatus !== ALL && row.permitPilot.matchStatus !== filters.matchStatus) return false;
  if (filters.priority !== ALL && row.priority !== filters.priority) return false;
  if (filters.uiStatus !== ALL && row.derived.uiStatus !== filters.uiStatus) return false;
  if (filters.backendStatus !== ALL && row.derived.backendStatus !== filters.backendStatus) return false;
  if (filters.routeDecision !== ALL && row.decisions.routeDecision !== filters.routeDecision) return false;
  if (filters.risk !== ALL && row.risk !== filters.risk) return false;
  if (filters.implementationStatus !== ALL && overlay.implementation_status !== filters.implementationStatus) {
    return false;
  }
  if (filters.verificationStatus !== ALL && overlay.verification_status !== filters.verificationStatus) {
    return false;
  }
  if (filters.blockedOnly && !(overlay.is_blocked || overlay.implementation_status === "Blocked")) return false;
  if (filters.hasComments && (commentsByRow[row.rowId]?.length ?? 0) === 0) return false;
  if (filters.hasPreserve && !row.derived.hasPreserve) return false;

  for (const chip of CHIP_DEFS) {
    if (activeChips.has(chip.key) && !chip.test(m)) return false;
  }

  if (filters.search.trim()) {
    const needle = filters.search.trim().toLowerCase();
    if (!haystack(m, commentsByRow[row.rowId] ?? []).includes(needle)) return false;
  }

  return true;
}

export function countActiveFilters(filters: FilterState, activeChips: Set<ChipKey>): number {
  let count = 0;
  if (filters.search.trim()) count++;
  if (filters.rowKind !== "all") count++;
  if (filters.area !== ALL) count++;
  if (filters.matchStatus !== ALL) count++;
  if (filters.priority !== ALL) count++;
  if (filters.uiStatus !== ALL) count++;
  if (filters.backendStatus !== ALL) count++;
  if (filters.routeDecision !== ALL) count++;
  if (filters.risk !== ALL) count++;
  if (filters.implementationStatus !== ALL) count++;
  if (filters.verificationStatus !== ALL) count++;
  if (filters.blockedOnly) count++;
  if (filters.hasComments) count++;
  if (filters.hasPreserve) count++;
  count += activeChips.size;
  return count;
}
