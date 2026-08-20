export type UciProjectRequestType =
  | "provider_setup"
  | "provider_resolution"
  | "coordination_records";

export type UciProjectDataLogEvent =
  | "project_selected"
  | "generation_created"
  | "request_started"
  | "request_completed"
  | "response_ignored_stale"
  | "loading_cleared"
  | "request_failed";

export function shouldApplyProjectScopedResponse(
  requestGeneration: number,
  requestedProjectId: string | null,
  currentGeneration: number,
  currentProjectId: string | null,
): boolean {
  return (
    requestGeneration === currentGeneration &&
    requestedProjectId === currentProjectId
  );
}

export function logUciProjectDataEvent(
  event: UciProjectDataLogEvent,
  details: {
    projectId?: string | null;
    requestType?: UciProjectRequestType;
    generation?: number;
    message?: string;
  },
): void {
  try {
    if (!import.meta.env.DEV) return;
    console.debug("[uci-project-data]", { event, ...details });
  } catch {
    // Debug logging must never crash the coordination workspace.
  }
}
