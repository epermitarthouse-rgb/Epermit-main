/**
 * Delivery outcome helpers for scheduled checklist reports.
 */

export type DeliveryStatus = "success" | "partial" | "failed" | "no_match";

export interface DeliveryOutcome {
  status: DeliveryStatus;
  successfulCount: number;
  failedCount: number;
  recipientCount: number;
  /** Advance next_send_at and clear claim (true) vs leave due for retry (false). */
  advanceSchedule: boolean;
  /** Persist a delivery log row. */
  shouldLog: boolean;
}

export function classifyEmailSendOutcome(
  successfulCount: number,
  failedCount: number,
): DeliveryOutcome {
  const recipientCount = successfulCount + failedCount;
  if (recipientCount === 0) {
    return {
      status: "failed",
      successfulCount: 0,
      failedCount: 0,
      recipientCount: 0,
      advanceSchedule: false,
      shouldLog: true,
    };
  }
  if (failedCount === 0) {
    return {
      status: "success",
      successfulCount,
      failedCount: 0,
      recipientCount,
      advanceSchedule: true,
      shouldLog: true,
    };
  }
  if (successfulCount === 0) {
    return {
      status: "failed",
      successfulCount: 0,
      failedCount,
      recipientCount,
      // Temporary / total failure: remain retryable on next cron tick after lease expires
      advanceSchedule: false,
      shouldLog: true,
    };
  }
  return {
    status: "partial",
    successfulCount,
    failedCount,
    recipientCount,
    advanceSchedule: true,
    shouldLog: true,
  };
}

export function classifyNoMatchOutcome(): DeliveryOutcome {
  return {
    status: "no_match",
    successfulCount: 0,
    failedCount: 0,
    recipientCount: 0,
    advanceSchedule: true,
    shouldLog: true,
  };
}

/** Ensure production test subjects are clearly labeled. */
export function ensureTestSubject(subject: string): string {
  const trimmed = (subject || "").trim();
  if (!trimmed) return "[TEST] Scheduled Inspection Report";
  if (/^\[TEST\]/i.test(trimmed)) return trimmed;
  return `[TEST] ${trimmed}`;
}
