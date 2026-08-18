/** Helpers for D5 communication classification display. */

export const UCI_COMMUNICATION_CATEGORIES = [
  "acknowledgment",
  "class_of_service",
  "design_review_response",
  "ciac_invoice",
  "equipment_eta_update",
  "inspection_release_request",
  "meter_set_scheduling",
  "energization_confirmation",
  "escalation_or_problem",
  "request_for_information",
  "unclassified",
] as const;

export type UciCommunicationCategory = (typeof UCI_COMMUNICATION_CATEGORIES)[number];

export const LOW_CONFIDENCE_THRESHOLD = 0.75;

export function formatCommunicationClassification(value: string | null | undefined): string {
  if (!value) return "Unclassified";
  return value.replace(/_/g, " ");
}

export function classificationNeedsAttention(
  classification: string | null | undefined,
  confidence: number | null | undefined,
  needsHumanAttention: boolean | null | undefined,
): boolean {
  if (needsHumanAttention) return true;
  if (!classification || classification === "unclassified") return true;
  if (confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD) return true;
  return false;
}
