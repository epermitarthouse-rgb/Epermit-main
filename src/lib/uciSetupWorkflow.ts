import type {
  UciProviderSetupAddressSource,
  UciProviderSetupResponse,
  UtilityProvider,
} from "@/types/uci";
import { UCI_SUPPORTED_UTILITY_TYPES, type UciUtilityType } from "@/lib/uciUtilityTypes";

export type AddressPresentationMode =
  | "missing"
  | "single"
  | "choose_source"
  | "loading";

export interface AddressPresentation {
  mode: AddressPresentationMode;
  structuredFormatted: string | null;
  scrapedFormatted: string | null;
  activeFormatted: string | null;
  activeSourceLabel: string | null;
  mismatchWarning: string | null;
}

export function providerDisplayLabel(provider: UtilityProvider): string {
  return (provider.display_name ?? provider.name ?? provider.slug).trim();
}

export function normalizeUtilityType(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function formatUtilityTypeLabel(value: string): string {
  const normalized = normalizeUtilityType(value);
  if (!normalized) return "Unknown";
  if (normalized === "water/sewer" || normalized === "water_sewer") return "Water / sewer";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function getSupportedUtilityTypes(
  _catalogTypes: readonly string[] = [],
): UciUtilityType[] {
  return [...UCI_SUPPORTED_UTILITY_TYPES];
}

/** CET partners first, then display name. */
export function sortProvidersForPicker(providers: UtilityProvider[]): UtilityProvider[] {
  return [...providers].sort((a, b) => {
    const cetA = Boolean(a.cet_relationship);
    const cetB = Boolean(b.cet_relationship);
    if (cetA !== cetB) return cetA ? -1 : 1;
    return providerDisplayLabel(a).localeCompare(providerDisplayLabel(b));
  });
}

export function providerMatchesSearch(provider: UtilityProvider, query: string): boolean {
  const haystack = [
    provider.slug,
    provider.name,
    provider.display_name,
    provider.canonical_name,
    provider.utility_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export function filterProvidersForPicker(
  providers: UtilityProvider[],
  opts: {
    utilityTypeFilter: string;
    searchQuery: string;
  },
): UtilityProvider[] {
  const typeFilter = normalizeUtilityType(opts.utilityTypeFilter);
  const search = opts.searchQuery.trim().toLowerCase();

  return sortProvidersForPicker(providers).filter((provider) => {
    if (typeFilter && typeFilter !== "all") {
      if (normalizeUtilityType(provider.utility_type) !== typeFilter) return false;
    }
    if (search && !providerMatchesSearch(provider, search)) return false;
    return true;
  });
}

export function groupProvidersByUtilityType(
  providers: UtilityProvider[],
): Array<{ utilityType: string; label: string; providers: UtilityProvider[] }> {
  const groups = new Map<string, UtilityProvider[]>();
  for (const provider of sortProvidersForPicker(providers)) {
    const key = normalizeUtilityType(provider.utility_type) || "unknown";
    const list = groups.get(key) ?? [];
    list.push(provider);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([utilityType, rows]) => ({
      utilityType,
      label: formatUtilityTypeLabel(utilityType),
      providers: rows,
    }));
}

export function deriveAddressPresentation(
  setup: UciProviderSetupResponse | null,
  loading: boolean,
  acknowledgedSource: UciProviderSetupAddressSource | null,
): AddressPresentation {
  if (loading) {
    return {
      mode: "loading",
      structuredFormatted: null,
      scrapedFormatted: null,
      activeFormatted: null,
      activeSourceLabel: null,
      mismatchWarning: null,
    };
  }

  if (!setup) {
    return {
      mode: "missing",
      structuredFormatted: null,
      scrapedFormatted: null,
      activeFormatted: null,
      activeSourceLabel: null,
      mismatchWarning: null,
    };
  }

  const structuredFormatted = setup.structured?.formatted?.trim() || null;
  const scrapedFormatted = setup.scraped_location?.formatted?.trim() || null;
  const fallbackFormatted = setup.address?.formatted?.trim() || null;

  if (!structuredFormatted && !scrapedFormatted && !fallbackFormatted) {
    return {
      mode: "missing",
      structuredFormatted: null,
      scrapedFormatted: null,
      activeFormatted: null,
      activeSourceLabel: null,
      mismatchWarning: null,
    };
  }

  if (setup.address_mismatch && structuredFormatted && scrapedFormatted) {
    const activeSource = acknowledgedSource ?? setup.recommended_address_source;
    const activeFormatted =
      activeSource === "jurisdiction_scrape" ? scrapedFormatted : structuredFormatted;
    return {
      mode: "choose_source",
      structuredFormatted,
      scrapedFormatted,
      activeFormatted,
      activeSourceLabel: formatAddressSourceLabel(activeSource),
      mismatchWarning: setup.mismatch_warning,
    };
  }

  const activeFormatted = structuredFormatted ?? scrapedFormatted ?? fallbackFormatted;
  const activeSource =
    acknowledgedSource ??
    setup.recommended_address_source ??
    (structuredFormatted ? "structured" : scrapedFormatted ? "jurisdiction_scrape" : "none");

  return {
    mode: "single",
    structuredFormatted,
    scrapedFormatted,
    activeFormatted,
    activeSourceLabel: formatAddressSourceLabel(activeSource),
    mismatchWarning: null,
  };
}

export function formatAddressSourceLabel(source: UciProviderSetupAddressSource | null | undefined): string {
  switch (source) {
    case "structured":
      return "Structured project address";
    case "jurisdiction_scrape":
      return "Scraped portal location";
    case "none":
      return "No address on file";
    default:
      return source ? String(source).replace(/_/g, " ") : "Address";
  }
}

export function hasConfirmableAddress(presentation: AddressPresentation): boolean {
  return presentation.mode === "single" || presentation.mode === "choose_source";
}

export function countSelectedProviders(initPick: Record<string, boolean>): number {
  return Object.values(initPick).filter(Boolean).length;
}

export function getInitDisabledReasons(params: {
  projectSelected: boolean;
  providerSetupLoading: boolean;
  providersLoading: boolean;
  initting: boolean;
  addressPresentation: AddressPresentation;
  addressSourceAcknowledged: UciProviderSetupAddressSource | null;
  providerSetupConfirmed: boolean;
  selectedProviderCount: number;
}): string[] {
  const reasons: string[] = [];
  if (!params.projectSelected) reasons.push("Select a project.");
  if (params.providersLoading) reasons.push("Loading available utility providers.");
  if (params.providerSetupLoading) reasons.push("Loading project address context.");
  if (params.initting) reasons.push("Initialization in progress.");
  if (params.projectSelected && !params.providerSetupLoading) {
    if (params.addressPresentation.mode === "missing") {
      reasons.push("Add or confirm the project address before selecting utility providers.");
    } else if (!params.addressSourceAcknowledged) {
      reasons.push("Confirm which project address to use.");
    }
  }
  if (params.selectedProviderCount === 0) {
    reasons.push("Select at least one utility provider.");
  }
  if (!params.providerSetupConfirmed) {
    reasons.push("Check the confirmation box to proceed.");
  }
  return reasons;
}

export function buildInitializedSlugSet(
  setup: UciProviderSetupResponse | null | undefined,
): Set<string> {
  const slugs = new Set<string>();
  for (const item of setup?.providers ?? []) {
    if (item.already_initialized) slugs.add(item.slug);
  }
  return slugs;
}

export function formatProjectAddressLine(project: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
}): string | null {
  const street = project.address?.trim();
  const locality = [project.city, project.state, project.zip_code]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const combined = [street, locality].filter(Boolean).join(", ");
  return combined || street || locality || null;
}
