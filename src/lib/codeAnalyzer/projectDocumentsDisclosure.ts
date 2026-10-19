/**
 * Collapse preference for the Step 4 Project Documents grid.
 * Polling and sheet navigation keep the same session. A new analysis phase or run resets the default.
 */

export type ProjectDocumentsPhase = "prepare" | "analyze" | "results";

export function resolveProjectDocumentsPhase(input: {
  activeStep: number;
  complianceRunActive: boolean;
  anyOrganizing: boolean;
}): ProjectDocumentsPhase {
  if (input.complianceRunActive || input.activeStep === 4) return "analyze";
  if (input.activeStep >= 5 && !input.anyOrganizing) return "results";
  return "prepare";
}

/** Upload and organize stay expanded so the document list is reachable. Analysis and results start collapsed. */
export function projectDocumentsDefaultExpanded(phase: ProjectDocumentsPhase): boolean {
  return phase === "prepare";
}

export function projectDocumentsSessionKey(
  phase: ProjectDocumentsPhase,
  runId: string | null,
): string {
  if (phase === "prepare") return "prepare";
  return `${phase}:${runId ?? "active"}`;
}

export function isSameProjectDocumentsSession(previousKey: string, nextKey: string): boolean {
  if (previousKey === nextKey) return true;
  const previousPhase = previousKey.split(":")[0];
  const nextPhase = nextKey.split(":")[0];
  if (previousPhase !== nextPhase) return false;
  if (previousPhase === "prepare") return true;
  const previousId = previousKey.slice(previousPhase.length + 1) || "active";
  const nextId = nextKey.slice(nextPhase.length + 1) || "active";
  if (previousId === "active" || nextId === "active") return true;
  return previousId === nextId;
}

export type ProjectDocumentsDisclosureState = {
  sessionKey: string;
  expanded: boolean;
};

export function reconcileProjectDocumentsDisclosure(
  current: ProjectDocumentsDisclosureState | null,
  input: { phase: ProjectDocumentsPhase; runId: string | null },
): ProjectDocumentsDisclosureState {
  const sessionKey = projectDocumentsSessionKey(input.phase, input.runId);
  if (current && isSameProjectDocumentsSession(current.sessionKey, sessionKey)) {
    if (current.sessionKey === sessionKey) return current;
    return { ...current, sessionKey };
  }
  return {
    sessionKey,
    expanded: projectDocumentsDefaultExpanded(input.phase),
  };
}
