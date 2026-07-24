import type { BadgeProps } from "@/components/ui/badge";
import type { StatusTone } from "@/components/design/ProductPrimitives";
import type {
  CompletionState,
  ImplementationStatus,
  VerificationStatus,
} from "@/types/architectureReplication";

export function implementationBadgeVariant(
  status: ImplementationStatus,
): NonNullable<BadgeProps["variant"]> {
  switch (status) {
    case "Implemented":
      return "default";
    case "In progress":
      return "warning";
    case "Ready for implementation":
      return "secondary";
    case "Blocked":
      return "destructive";
    case "Do not implement":
      return "mutedLight";
    case "Audited":
    case "Not reviewed":
    default:
      return "outline";
  }
}

export function verificationBadgeVariant(
  status: VerificationStatus,
): NonNullable<BadgeProps["variant"]> {
  switch (status) {
    case "Client approved":
      return "success";
    case "E2E checked":
      return "default";
    case "Functional checked":
    case "Visual checked":
      return "secondary";
    case "Code inspected":
    case "Not tested":
    default:
      return "outline";
  }
}

export function completionTone(state: CompletionState): StatusTone {
  switch (state) {
    case "Complete":
      return "good";
    case "Blocked":
      return "bad";
    case "Ready for test":
    case "Testing":
      return "warn";
    case "Building":
    case "Planning":
      return "info";
    case "Not started":
    default:
      return "default";
  }
}

export function priorityBadgeVariant(priority: string): NonNullable<BadgeProps["variant"]> {
  switch (priority) {
    case "P0":
      return "destructive";
    case "P1":
      return "warning";
    case "P2":
      return "secondary";
    default:
      return "outline";
  }
}

export function riskBadgeVariant(risk: string): NonNullable<BadgeProps["variant"]> {
  switch (risk) {
    case "High":
      return "destructive";
    case "Medium":
      return "warning";
    default:
      return "outline";
  }
}
