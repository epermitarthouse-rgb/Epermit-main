import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildInitializedSlugSet,
  countSelectedProviders,
  deriveAddressPresentation,
  deriveSelectedProvidersForInit,
  filterProvidersForPicker,
  getSupportedUtilityTypes,
  getInitDisabledReasons,
  hasAdditionalManualProviderSelections,
  isProviderConfirmationSatisfied,
  sortProvidersForPicker,
} from "./uciSetupWorkflow.ts";
import type { UciProviderResolutionResult, UciProviderSetupResponse, UtilityProvider } from "@/types/uci";

function provider(partial: Partial<UtilityProvider> & Pick<UtilityProvider, "slug">): UtilityProvider {
  return {
    id: partial.id ?? partial.slug,
    slug: partial.slug,
    name: partial.name ?? partial.slug,
    display_name: partial.display_name ?? partial.name ?? partial.slug,
    utility_type: partial.utility_type ?? "electric",
    primary_portal_type: partial.primary_portal_type ?? null,
    portal_url: partial.portal_url ?? null,
    automation_status: partial.automation_status ?? "placeholder",
    is_active: partial.is_active ?? true,
    cet_relationship: partial.cet_relationship ?? false,
    canonical_name: partial.canonical_name ?? null,
  };
}

describe("uciSetupWorkflow helpers", () => {
  it("returns missing address presentation when no project address exists", () => {
    const setup = {
      structured: { formatted: "", source: "structured", complete: false },
      scraped_location: null,
      address: { formatted: "", source: "none", complete: false },
      address_mismatch: false,
      mismatch_warning: null,
      recommended_address_source: "structured",
    } as UciProviderSetupResponse;

    const presentation = deriveAddressPresentation(setup, false, null);
    assert.equal(presentation.mode, "missing");
  });

  it("returns single address presentation when only structured address exists", () => {
    const setup = {
      structured: { formatted: "123 Main St, Washington, DC", source: "structured", complete: true },
      scraped_location: null,
      address: { formatted: "123 Main St, Washington, DC", source: "structured", complete: true },
      address_mismatch: false,
      mismatch_warning: null,
      recommended_address_source: "structured",
    } as UciProviderSetupResponse;

    const presentation = deriveAddressPresentation(setup, false, "structured");
    assert.equal(presentation.mode, "single");
    assert.equal(presentation.activeFormatted, "123 Main St, Washington, DC");
  });

  it("returns choose_source when structured and scraped addresses conflict", () => {
    const setup = {
      structured: { formatted: "123 Main St, Washington, DC", source: "structured", complete: true },
      scraped_location: { formatted: "456 Portal Ave, Washington, DC", source: "portal_data_location" },
      address: { formatted: "123 Main St, Washington, DC", source: "structured", complete: true },
      address_mismatch: true,
      mismatch_warning: "Addresses differ",
      recommended_address_source: "structured",
      available_address_sources: ["structured", "jurisdiction_scrape"],
    } as UciProviderSetupResponse;

    const presentation = deriveAddressPresentation(setup, false, "structured");
    assert.equal(presentation.mode, "choose_source");
    assert.equal(presentation.structuredFormatted, "123 Main St, Washington, DC");
    assert.equal(presentation.scrapedFormatted, "456 Portal Ave, Washington, DC");
  });

  it("sorts CET partners first and filters providers by search and utility type", () => {
    const catalog = [
      provider({ slug: "z-co", display_name: "Z Utility", utility_type: "electric" }),
      provider({ slug: "pepco", display_name: "PEPCO", utility_type: "electric", cet_relationship: true }),
      provider({ slug: "washington-gas", display_name: "Washington Gas", utility_type: "gas" }),
    ];

    const sorted = sortProvidersForPicker(catalog);
    assert.equal(sorted[0].slug, "pepco");

    const filtered = filterProvidersForPicker(catalog, {
      utilityTypeFilter: "gas",
      searchQuery: "wash",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].slug, "washington-gas");
  });

  it("exposes and filters every supported UCI utility type without fallback", () => {
    assert.deepEqual(getSupportedUtilityTypes(["electric", "gas"]), [
      "electric",
      "gas",
      "water",
      "sewer",
      "telecom",
    ]);
    const catalog = [
      provider({ slug: "electric-co", utility_type: "electric" }),
      provider({ slug: "gas-co", utility_type: "gas" }),
      provider({ slug: "water-co", utility_type: "water" }),
      provider({ slug: "sewer-co", utility_type: "sewer" }),
      provider({ slug: "telecom-co", utility_type: "telecom" }),
    ];
    for (const utilityType of getSupportedUtilityTypes()) {
      const filtered = filterProvidersForPicker(catalog, {
        utilityTypeFilter: utilityType,
        searchQuery: "",
      });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].utility_type, utilityType);
    }
  });

  it("builds initialized slug set and excludes initialized providers from selection counts", () => {
    const setup = {
      providers: [
        { slug: "pepco", already_initialized: true },
        { slug: "bge", already_initialized: false },
      ],
    } as UciProviderSetupResponse;

    const initialized = buildInitializedSlugSet(setup);
    assert.ok(initialized.has("pepco"));
    assert.equal(countSelectedProviders({ pepco: true, bge: true }), 2);
  });

  it("lists exact disabled reasons for initialize coordination", () => {
    const reasons = getInitDisabledReasons({
      projectSelected: false,
      providerSetupLoading: false,
      providersLoading: false,
      initting: false,
      addressPresentation: deriveAddressPresentation(null, false, null),
      addressSourceAcknowledged: null,
      providerSetupConfirmed: false,
      selectedProviderCount: 0,
    });

    assert.ok(reasons.includes("Select a project."));
    assert.ok(reasons.includes("Select at least one utility provider."));
    assert.ok(reasons.includes("Check the confirmation box to proceed."));
  });

  it("requires address confirmation when project address is missing", () => {
    const reasons = getInitDisabledReasons({
      projectSelected: true,
      providerSetupLoading: false,
      providersLoading: false,
      initting: false,
      addressPresentation: { mode: "missing", structuredFormatted: null, scrapedFormatted: null, activeFormatted: null, activeSourceLabel: null, mismatchWarning: null },
      addressSourceAcknowledged: null,
      providerSetupConfirmed: true,
      selectedProviderCount: 1,
    });

    assert.ok(
      reasons.some((reason) => reason.includes("Add or confirm the project address")),
    );
  });

  it("hydrates Step 3 selection from confirmed territory provider resolution", () => {
    const catalog = [
      provider({ id: "dom-id", slug: "dominion-energy-virginia", utility_type: "electric" }),
      provider({ id: "gas-id", slug: "washington-gas", utility_type: "gas" }),
    ];
    const resolutions: Record<string, UciProviderResolutionResult> = {
      electric: {
        service_type: "electric",
        status: "confirmed",
        resolution_tier: 1,
        resolution_method: "point_in_polygon",
        confidence: "high",
        address: {
          formatted: "123 Main St",
          source: "project",
          latitude: null,
          longitude: null,
          geocode_provider: null,
          geocoded_at: null,
        },
        source: { name: "eia", dataset_vintage: "2024", layer_id: null, source_url: null, generated_at: null },
        candidates: [],
        suggested_provider_id: "dom-id",
        boundary_risk: false,
        boundary_distance_miles: null,
        requires_human_confirmation: false,
        confirmed_provider_id: "dom-id",
        confirmed_provider_slug: "dominion-energy-virginia",
        confirmed_by: "user-1",
        confirmed_at: "2026-01-01T00:00:00.000Z",
        override_reason: null,
        notes: null,
      },
    };

    const selected = deriveSelectedProvidersForInit({
      providers: catalog,
      initPick: {},
      initializedSlugs: new Set(),
      resolutions,
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0].slug, "dominion-energy-virginia");
    assert.equal(
      isProviderConfirmationSatisfied({
        selectedProviders: selected,
        confirmedProviderIds: new Set(["dom-id"]),
        providerSetupConfirmed: false,
      }),
      true,
    );
    assert.equal(
      hasAdditionalManualProviderSelections({
        selectedProviders: selected,
        confirmedProviderIds: new Set(["dom-id"]),
      }),
      false,
    );
  });

  it("unblocks initialization when only confirmed providers are selected", () => {
    const selected = [
      provider({ id: "dom-id", slug: "dominion-energy-virginia", utility_type: "electric" }),
    ];
    const reasons = getInitDisabledReasons({
      projectSelected: true,
      providerSetupLoading: false,
      providersLoading: false,
      initting: false,
      addressPresentation: {
        mode: "single",
        structuredFormatted: "123 Main St",
        scrapedFormatted: null,
        activeFormatted: "123 Main St",
        activeSourceLabel: "Structured project address",
        mismatchWarning: null,
      },
      addressSourceAcknowledged: "structured",
      providerSetupConfirmed: isProviderConfirmationSatisfied({
        selectedProviders: selected,
        confirmedProviderIds: new Set(["dom-id"]),
        providerSetupConfirmed: false,
      }),
      selectedProviderCount: selected.length,
    });

    assert.deepEqual(reasons, []);
  });

  it("requires manual acknowledgment for additional providers beyond Step 2b", () => {
    const selected = [
      provider({ id: "dom-id", slug: "dominion-energy-virginia", utility_type: "electric" }),
      provider({ id: "gas-id", slug: "washington-gas", utility_type: "gas" }),
    ];

    assert.equal(
      hasAdditionalManualProviderSelections({
        selectedProviders: selected,
        confirmedProviderIds: new Set(["dom-id"]),
      }),
      true,
    );
    assert.equal(
      isProviderConfirmationSatisfied({
        selectedProviders: selected,
        confirmedProviderIds: new Set(["dom-id"]),
        providerSetupConfirmed: false,
      }),
      false,
    );
    assert.equal(
      isProviderConfirmationSatisfied({
        selectedProviders: selected,
        confirmedProviderIds: new Set(["dom-id"]),
        providerSetupConfirmed: true,
      }),
      true,
    );
  });

  it("retains confirmed provider selection after reload-style hydration", () => {
    const catalog = [
      provider({ id: "dom-id", slug: "dominion-energy-virginia", utility_type: "electric" }),
    ];
    const resolutions: Record<string, UciProviderResolutionResult> = {
      electric: {
        service_type: "electric",
        status: "confirmed",
        resolution_tier: null,
        resolution_method: "manual_selection",
        confidence: "none",
        address: {
          formatted: "123 Main St",
          source: "project",
          latitude: null,
          longitude: null,
          geocode_provider: null,
          geocoded_at: null,
        },
        source: { name: "manual", dataset_vintage: null, layer_id: null, source_url: null, generated_at: null },
        candidates: [],
        suggested_provider_id: null,
        boundary_risk: false,
        boundary_distance_miles: null,
        requires_human_confirmation: false,
        confirmed_provider_id: "dom-id",
        confirmed_provider_slug: "dominion-energy-virginia",
        confirmed_by: "user-1",
        confirmed_at: "2026-01-01T00:00:00.000Z",
        override_reason: null,
        notes: null,
      },
    };

    const selected = deriveSelectedProvidersForInit({
      providers: catalog,
      initPick: {},
      initializedSlugs: new Set(),
      resolutions,
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, "dom-id");
  });

  it("updates Step 3 selection when provider mapping changes", () => {
    const catalog = [
      provider({ id: "dom-id", slug: "dominion-energy-virginia", utility_type: "electric" }),
      provider({ id: "old-dom-id", slug: "dominion-old", utility_type: "electric" }),
    ];
    const baseResolution = {
      service_type: "electric",
      resolution_tier: null,
      resolution_method: "manual_selection" as const,
      confidence: "none" as const,
      address: {
        formatted: "123 Main St",
        source: "project" as const,
        latitude: null,
        longitude: null,
        geocode_provider: null,
        geocoded_at: null,
      },
      source: { name: "manual", dataset_vintage: null, layer_id: null, source_url: null, generated_at: null },
      candidates: [],
      suggested_provider_id: null,
      boundary_risk: false,
      boundary_distance_miles: null,
      requires_human_confirmation: false,
      confirmed_by: "user-1",
      override_reason: null,
      notes: null,
    };
    const initial = deriveSelectedProvidersForInit({
      providers: catalog,
      initPick: {},
      initializedSlugs: new Set(),
      resolutions: {
        electric: {
          ...baseResolution,
          status: "confirmed",
          confirmed_provider_id: "old-dom-id",
          confirmed_provider_slug: "dominion-old",
          confirmed_at: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    const updated = deriveSelectedProvidersForInit({
      providers: catalog,
      initPick: {},
      initializedSlugs: new Set(),
      resolutions: {
        electric: {
          ...baseResolution,
          status: "overridden",
          suggested_provider_id: "old-dom-id",
          confirmed_provider_id: "dom-id",
          confirmed_provider_slug: "dominion-energy-virginia",
          confirmed_at: "2026-01-02T00:00:00.000Z",
          override_reason: "Corrected serving utility",
        },
      },
    });

    assert.equal(initial[0]?.slug, "dominion-old");
    assert.equal(updated[0]?.slug, "dominion-energy-virginia");
  });

  it("excludes already initialized providers from derived selection", () => {
    const catalog = [
      provider({ id: "dom-id", slug: "dominion-energy-virginia", utility_type: "electric" }),
    ];
    const selected = deriveSelectedProvidersForInit({
      providers: catalog,
      initPick: { "dominion-energy-virginia": true },
      initializedSlugs: new Set(["dominion-energy-virginia"]),
      resolutions: {
        electric: {
          service_type: "electric",
          status: "confirmed",
          resolution_tier: null,
          resolution_method: "manual_selection",
          confidence: "none",
          address: {
            formatted: "123 Main St",
            source: "project",
            latitude: null,
            longitude: null,
            geocode_provider: null,
            geocoded_at: null,
          },
          source: { name: "manual", dataset_vintage: null, layer_id: null, source_url: null, generated_at: null },
          candidates: [],
          suggested_provider_id: null,
          boundary_risk: false,
          boundary_distance_miles: null,
          requires_human_confirmation: false,
          confirmed_provider_id: "dom-id",
          confirmed_provider_slug: "dominion-energy-virginia",
          confirmed_by: "user-1",
          confirmed_at: "2026-01-01T00:00:00.000Z",
          override_reason: null,
          notes: null,
        },
      },
    });

    assert.equal(selected.length, 0);
  });
});
