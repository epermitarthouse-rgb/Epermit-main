import type {
  ArchitectureMatrixRow,
  CompletionChecks,
  CompletionState,
  ImplementationStatus,
  ReplicationComment,
  ReplicationItemOverlay,
  VerificationStatus,
} from "@/types/architectureReplication";

const REQUIRED_FOR_COMPLETE: Array<keyof CompletionChecks> = [
  "lovableLayoutReviewed",
  "routeDecisionConfirmed",
  "existingFunctionalityIdentified",
  "backendPreservationConfirmed",
  "uiImplemented",
  "desktopVisualCheck",
  "mobileVisualCheck",
  "darkThemeChecked",
  "lightThemeChecked",
  "previewReviewed",
];

export function defaultOverlay(row: ArchitectureMatrixRow): ReplicationItemOverlay {
  return {
    matrix_row_id: row.rowId,
    implementation_status: row.defaults.implementationStatus,
    verification_status: row.defaults.verificationStatus,
    assigned_owner: null,
    is_blocked: false,
    blocker_description: null,
    implementation_commit: null,
    preview_url: null,
    test_evidence: null,
    last_tested_at: null,
    client_approved_at: null,
    client_feedback: null,
    completion_checks: {},
    updated_at: null,
    updated_by: null,
  };
}

export function mergeOverlay(
  row: ArchitectureMatrixRow,
  overlay?: ReplicationItemOverlay | null,
): ReplicationItemOverlay {
  return overlay ? { ...defaultOverlay(row), ...overlay } : defaultOverlay(row);
}

export function computeCompletionState(
  overlay: ReplicationItemOverlay,
): CompletionState {
  if (overlay.is_blocked || overlay.implementation_status === "Blocked") {
    return "Blocked";
  }
  if (overlay.implementation_status === "Do not implement") {
    return "Complete";
  }

  const checks = overlay.completion_checks || {};
  const requiredOk = REQUIRED_FOR_COMPLETE.every((k) => checks[k] === true);
  const verified =
    overlay.verification_status === "E2E checked" ||
    overlay.verification_status === "Client approved";

  if (
    overlay.implementation_status === "Implemented" &&
    verified &&
    requiredOk &&
    !overlay.is_blocked
  ) {
    return "Complete";
  }

  if (overlay.implementation_status === "Implemented") {
    if (
      overlay.verification_status === "Not tested" ||
      overlay.verification_status === "Code inspected"
    ) {
      return "Ready for test";
    }
    return "Testing";
  }

  if (overlay.implementation_status === "In progress") return "Building";
  if (
    overlay.implementation_status === "Ready for implementation" ||
    overlay.implementation_status === "Audited"
  ) {
    return "Planning";
  }
  return "Not started";
}

export function truncate(text: string, max = 80): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function firstOpenableRoute(routeField: string): string | null {
  if (!routeField) return null;
  const candidates = routeField
    .split(/[,;]|\bor\b|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const c of candidates) {
    const m = c.match(/(\/[A-Za-z0-9_/?&=#.:*-]+)/);
    if (!m) continue;
    const path = m[1];
    if (
      path.startsWith("/api") ||
      path.includes("*") ||
      path.includes("(") ||
      path.toLowerCase().includes("none") ||
      path.toLowerCase().includes("lovable")
    ) {
      continue;
    }
    // Prefer concrete app paths
    if (path.startsWith("/")) return path.split(/\s/)[0];
  }
  return null;
}

export function buildImplementationBrief(
  row: ArchitectureMatrixRow,
  overlay: ReplicationItemOverlay,
): string {
  return [
    `# Implementation brief — ${row.rowId}`,
    "",
    `## Lovable`,
    `- **Name:** ${row.lovable.name}`,
    `- **Route:** ${row.lovable.route}`,
    `- **Purpose:** ${row.lovable.purpose}`,
    `- **Functionality:** ${row.lovable.functionality}`,
    "",
    `## PermitPilot today`,
    `- **Match:** ${row.permitPilot.matchStatus}`,
    `- **Feature:** ${row.permitPilot.featureName}`,
    `- **Route:** ${row.permitPilot.route}`,
    `- **Current behavior:** ${row.permitPilot.functionalStatus}`,
    "",
    `## Preserve`,
    row.work.preserve || "—",
    "",
    `## Required UI work`,
    row.work.requiredFrontend || "—",
    "",
    `## Required functional work`,
    row.work.requiredBackend || "—",
    "",
    `## Decisions`,
    `- Route: ${row.decisions.routeDecision}`,
    `- Target: ${row.decisions.targetRoute}`,
    `- Nav: ${row.decisions.navPlacement}`,
    "",
    `## Dependencies / Risk`,
    `- Dependencies: ${row.work.dependencies}`,
    `- Risk: ${row.risk}`,
    `- Fake-backend risk: ${row.work.fakeBackendRisk}`,
    "",
    `## Operational status`,
    `- Implementation: ${overlay.implementation_status}`,
    `- Verification: ${overlay.verification_status}`,
    `- Completion: ${computeCompletionState(overlay)}`,
    "",
    `## Acceptance / verification`,
    row.work.acceptanceCriteria || "—",
    "",
    row.work.verificationHook || "",
  ].join("\n");
}

export function latestComment(
  comments: ReplicationComment[],
  rowId: string,
): ReplicationComment | null {
  const list = comments
    .filter((c) => c.matrix_row_id === rowId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return list[0] || null;
}

export function exportRowsToCsv(
  rows: ArchitectureMatrixRow[],
  overlays: Record<string, ReplicationItemOverlay>,
): string {
  const headers = [
    "rowId",
    "rowKind",
    "priority",
    "risk",
    "lovableName",
    "lovableRoute",
    "matchStatus",
    "ppFeature",
    "ppRoute",
    "uiStatus",
    "backendStatus",
    "preserve",
    "requiredUi",
    "requiredFunctional",
    "routeDecision",
    "implementationStatus",
    "verificationStatus",
    "completionState",
    "assignedOwner",
    "isBlocked",
    "blocker",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const o = mergeOverlay(row, overlays[row.rowId]);
    const vals = [
      row.rowId,
      row.rowKind,
      row.priority,
      row.risk,
      row.lovable.name,
      row.lovable.route,
      row.permitPilot.matchStatus,
      row.permitPilot.featureName,
      row.permitPilot.route,
      row.derived.uiStatus,
      row.derived.backendStatus,
      row.work.preserve,
      row.work.requiredFrontend,
      row.work.requiredBackend,
      row.decisions.routeDecision,
      o.implementation_status,
      o.verification_status,
      computeCompletionState(o),
      o.assigned_owner || "",
      String(o.is_blocked),
      o.blocker_description || "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(vals.join(","));
  }
  return lines.join("\n");
}

export type { ImplementationStatus, VerificationStatus };
