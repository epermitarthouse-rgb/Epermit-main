import type {
  UciProviderResolutionResult,
  UciProviderResolutionStatus,
  UtilityProvider,
} from "@/types/uci";

export const RESOLUTION_STATUS_LABELS: Record<UciProviderResolutionStatus, string> = {
  resolved: "Resolved",
  ambiguous: "Multiple candidates",
  not_found: "No provider found",
  geocoding_failed: "Address geocoding failed",
  territory_data_unavailable: "Territory matching unavailable",
  manual_confirmation_required: "Confirmation required",
  confirmed: "Confirmed",
  overridden: "Overridden",
};

export const RESOLUTION_METHOD_LABELS: Record<string, string> = {
  point_in_polygon: "Territory polygon match",
  boundary_buffer: "Near territory boundary",
  county_fallback: "County lookup (EIA-861)",
  zip_cache_suggestion: "ZIP suggestion (non-authoritative)",
  manual_selection: "Manual selection",
};

export function formatResolutionStatusLabel(status: UciProviderResolutionStatus | string): string {
  return RESOLUTION_STATUS_LABELS[status as UciProviderResolutionStatus] ?? String(status);
}

export function formatResolutionMethodLabel(method: string | null | undefined): string {
  if (!method) return "Not determined";
  return RESOLUTION_METHOD_LABELS[method] ?? method;
}

export function formatConfidenceLabel(confidence: string | null | undefined): string {
  if (!confidence || confidence === "none") return "No automatic confidence";
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

export function getResolutionUserMessage(resolution: UciProviderResolutionResult | null): string {
  if (!resolution) {
    return "Automatic territory matching is not available yet. Select and confirm the utility serving this project.";
  }
  if (resolution.user_message?.trim()) return resolution.user_message.trim();
  if (resolution.status === "ambiguous") {
    return "Multiple possible providers were found. Review the candidates before continuing.";
  }
  if (resolution.boundary_risk) {
    return "This project is near a utility territory boundary. Human confirmation is required.";
  }
  if (resolution.requires_human_confirmation) {
    return "Human confirmation is required.";
  }
  if (resolution.status === "territory_data_unavailable") {
    return "Automatic territory matching is not available yet. Select and confirm the utility serving this project.";
  }
  if (resolution.status === "confirmed") {
    return "Provider selection confirmed.";
  }
  if (resolution.status === "overridden") {
    return "Provider selection overridden with documented reason.";
  }
  return "Review the provider mapping details before continuing.";
}

export function filterProvidersForServiceType(
  providers: UtilityProvider[],
  serviceType: string,
): UtilityProvider[] {
  const normalized = serviceType.trim().toLowerCase();
  return providers.filter((provider) => provider.utility_type.trim().toLowerCase() === normalized);
}

export function findProviderById(
  providers: UtilityProvider[],
  providerId: string | null | undefined,
): UtilityProvider | null {
  if (!providerId) return null;
  return providers.find((provider) => provider.id === providerId) ?? null;
}

export function isResolutionConfirmed(resolution: UciProviderResolutionResult | null): boolean {
  return resolution?.status === "confirmed" || resolution?.status === "overridden";
}

export function needsOverrideReason(
  resolution: UciProviderResolutionResult | null,
  selectedProviderId: string | null,
): boolean {
  if (!resolution?.suggested_provider_id || !selectedProviderId) return false;
  return resolution.suggested_provider_id !== selectedProviderId;
}
