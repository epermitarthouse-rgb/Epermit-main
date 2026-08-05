/**
 * Pure UI state machine for PGC "Retry Failed Items" start flow.
 * Separates "request accepted / job started" from "job completed".
 */

export type PgcRetryStartUiState = {
  open: boolean;
  selectedIds: string[];
  /** True while login + /api/scrape start is in flight. */
  starting: boolean;
  startError: string | null;
};

export type PgcRetryStartUiEvent =
  | { type: "open"; selectedIds: string[] }
  | { type: "close" }
  | { type: "submit" }
  | { type: "start_succeeded"; jobId?: string | null }
  | { type: "start_failed"; error: string };

export function createPgcRetryStartUiState(
  partial?: Partial<PgcRetryStartUiState>,
): PgcRetryStartUiState {
  return {
    open: false,
    selectedIds: [],
    starting: false,
    startError: null,
    ...partial,
  };
}

/** Double-submit guard: ignore clicks while a start request is pending. */
export function canSubmitPgcRetryStart(state: PgcRetryStartUiState): boolean {
  return state.open && !state.starting && state.selectedIds.length > 0;
}

/**
 * Reduce dialog UI around retry *start* (not job completion).
 * - success → close immediately and clear selection
 * - failure → keep open and surface error
 */
export function reducePgcRetryStartUi(
  state: PgcRetryStartUiState,
  event: PgcRetryStartUiEvent,
): PgcRetryStartUiState {
  switch (event.type) {
    case "open":
      return {
        open: true,
        selectedIds: [...event.selectedIds],
        starting: false,
        startError: null,
      };
    case "close":
      return {
        ...state,
        open: false,
        selectedIds: [],
        starting: false,
        startError: null,
      };
    case "submit":
      if (!canSubmitPgcRetryStart(state)) return state;
      return {
        ...state,
        starting: true,
        startError: null,
      };
    case "start_succeeded":
      // Close as soon as backend accepts the job — do not wait for completion.
      return {
        open: false,
        selectedIds: [],
        starting: false,
        startError: null,
      };
    case "start_failed":
      return {
        ...state,
        open: true,
        starting: false,
        startError: String(event.error || "Failed to start retry"),
      };
    default:
      return state;
  }
}
