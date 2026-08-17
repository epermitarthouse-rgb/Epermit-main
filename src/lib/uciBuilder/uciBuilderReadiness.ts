/**
 * Section readiness for the Lovable-style UCI Application Builder.
 * Completion is derived from real coordination / load / package state only.
 */

import {
  canSubmitApplication,
  getApplicationPackageDraftApplication,
  parseApplicationPackageMetadata,
  parsePackageDocuments,
  type UciApplicationPackageDocument,
  type UciApplicationPackageMetadata,
} from "@/lib/uciApplicationPrep";
import {
  getLoadProfileDraftApplication,
  parseLoadProfileSummary,
  type UciLoadProfileSummary,
  type UciVerifiedLoadValue,
} from "@/lib/uciLoadProfile";
import type { CoordinationApplication, CoordinationRecord, UtilityProvider } from "@/types/uci";

export const UCI_BUILDER_SECTIONS = [
  { id: "service", label: "Service requested" },
  { id: "load", label: "Load profile" },
  { id: "site", label: "Site & access" },
  { id: "owner", label: "Owner & billing" },
  { id: "drawings", label: "Drawings & exhibits" },
  { id: "review", label: "Review & submit" },
] as const;

export type UciBuilderSectionId = (typeof UCI_BUILDER_SECTIONS)[number]["id"];

export type UciBuilderSectionStatus = "ready" | "partial" | "blocked" | "coming_soon";

export interface UciBuilderSectionState {
  id: UciBuilderSectionId;
  label: string;
  status: UciBuilderSectionStatus;
  complete: boolean;
  helper: string | null;
}

export interface UciBuilderLoadMetric {
  label: string;
  value: string | null;
  comingSoon: boolean;
  helper?: string;
}

function embeddedProvider(record: CoordinationRecord | null | undefined): UtilityProvider | null {
  if (!record?.utility_providers) return null;
  return Array.isArray(record.utility_providers)
    ? record.utility_providers[0] ?? null
    : record.utility_providers;
}

export function formatUtilityProviderLabel(record: CoordinationRecord | null | undefined): string {
  if (!record) return "";
  const provider = embeddedProvider(record);
  const name =
    provider?.display_name?.trim() ||
    provider?.canonical_name?.trim() ||
    provider?.name?.trim() ||
    "Provider unassigned";
  const utility = record.utility_type?.trim();
  return utility ? `${name} — ${utility}` : name;
}

function formatScalar(value: unknown, unit?: string | null): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  const text = String(value);
  return unit ? `${text} ${unit}` : text;
}

function pickVerifiedOrCalculated(
  summary: UciLoadProfileSummary | null,
  keys: string[],
): { value: unknown; unit: string | null; source: "verified" | "calculated" | null } {
  if (!summary) return { value: null, unit: null, source: null };
  for (const key of keys) {
    const verified = summary.verified_values?.[key] as UciVerifiedLoadValue | undefined;
    if (verified && verified.value != null && verified.value !== "") {
      return { value: verified.value, unit: verified.unit, source: "verified" };
    }
  }
  for (const key of keys) {
    const calculated = summary.calculated_values?.[key];
    if (calculated != null && calculated !== "") {
      return { value: calculated, unit: null, source: "calculated" };
    }
  }
  return { value: null, unit: null, source: null };
}

export function buildLoadProfileMetrics(
  summary: UciLoadProfileSummary | null,
): UciBuilderLoadMetric[] {
  const demand = pickVerifiedOrCalculated(summary, [
    "demand_load_kw",
    "connected_load_kw",
    "demand_load_kva",
    "connected_load_kva",
  ]);
  const voltage = pickVerifiedOrCalculated(summary, [
    "service_voltage",
    "requested_voltage",
    "voltage",
  ]);
  const amperage = pickVerifiedOrCalculated(summary, [
    "service_amperage",
    "amperage",
    "amps",
  ]);
  const phase = pickVerifiedOrCalculated(summary, ["phase", "service_configuration"]);

  const entranceParts = [
    formatScalar(amperage.value, amperage.unit ?? (amperage.value != null ? "A" : null)),
    formatScalar(voltage.value, voltage.unit ?? (voltage.value != null ? "V" : null)),
    formatScalar(phase.value, phase.unit),
  ].filter(Boolean);

  return [
    {
      label: "Peak demand / connected load",
      value: formatScalar(demand.value, demand.unit ?? (demand.value != null ? "kW" : null)),
      comingSoon: false,
      helper: demand.source
        ? `From load profile (${demand.source})`
        : "Run Load Profile Analyzer and verify connected load",
    },
    {
      label: "Load factor",
      value: null,
      comingSoon: true,
      helper: "No tariff / load-factor engine in PermitPilot yet",
    },
    {
      label: "Coincident peak",
      value: null,
      comingSoon: true,
      helper: "No coincident-peak calculation service yet",
    },
    {
      label: "Service entrance",
      value: entranceParts.length ? entranceParts.join(" · ") : null,
      comingSoon: false,
      helper: entranceParts.length
        ? "From verified or calculated load values"
        : "Voltage / amperage not yet present in load summary",
    },
    {
      label: "Service class",
      value: null,
      comingSoon: true,
      helper: "Tariff / service-class assignment is Coming Soon",
    },
    {
      label: "Standby generator",
      value: null,
      comingSoon: true,
      helper: "Standby generator capture is not in the UCI package model yet",
    },
  ];
}

export function resolveServiceFieldValues(params: {
  projectName: string | null;
  projectType: string | null;
  record: CoordinationRecord | null;
  summary: UciLoadProfileSummary | null;
}): {
  project: string;
  utility: string;
  voltage: string;
  amperage: string;
  serviceType: string;
  targetDate: string;
  contact: string;
} {
  const { projectName, projectType, record, summary } = params;
  const voltage = pickVerifiedOrCalculated(summary, [
    "service_voltage",
    "requested_voltage",
    "voltage",
  ]);
  const amperage = pickVerifiedOrCalculated(summary, [
    "service_amperage",
    "amperage",
    "amps",
  ]);
  const phase = pickVerifiedOrCalculated(summary, ["phase"]);

  const voltageParts = [
    formatScalar(voltage.value, voltage.unit ?? (voltage.value != null ? "V" : null)),
    formatScalar(phase.value, null),
  ].filter(Boolean);

  const contactParts = [
    record?.utility_contact_name,
    record?.utility_contact_email,
    record?.utility_contact_phone,
  ].filter((v): v is string => Boolean(v && String(v).trim()));

  return {
    project: projectName?.trim() || "",
    utility: formatUtilityProviderLabel(record),
    voltage: voltageParts.join(" · "),
    amperage:
      formatScalar(amperage.value, amperage.unit ?? (amperage.value != null ? "A" : null)) || "",
    serviceType: projectType?.trim() || "new_service",
    targetDate: record?.energization_target_date
      ? String(record.energization_target_date).slice(0, 10)
      : "",
    contact: contactParts.join(" · "),
  };
}

export function evaluateUciBuilderSections(params: {
  hasProject: boolean;
  record: CoordinationRecord | null;
  applications: CoordinationApplication[] | null | undefined;
  projectAddress: string | null;
}): UciBuilderSectionState[] {
  const { hasProject, record, applications, projectAddress } = params;
  const loadDraft = getLoadProfileDraftApplication(applications);
  const summary = parseLoadProfileSummary(loadDraft?.load_summary);
  const packageApp = getApplicationPackageDraftApplication(applications);
  const packageMeta = parseApplicationPackageMetadata(packageApp);
  const packageDocs = parsePackageDocuments(packageApp?.package_documents);
  const hasProvider = Boolean(record?.utility_provider_id);
  const address =
    projectAddress?.trim() ||
    packageMeta?.project_address?.formatted?.trim() ||
    "";

  const serviceComplete = hasProject && Boolean(record) && hasProvider;
  const loadComplete = Boolean(loadDraft) && Boolean(summary);
  const siteComplete = Boolean(address);
  const drawingsComplete =
    Boolean(packageApp) &&
    packageDocs.length > 0 &&
    packageDocs.every((d) => d.status === "attached");
  const reviewComplete =
    Boolean(packageApp) &&
    (packageMeta?.package_status === "ready_for_review" ||
      canSubmitApplication(packageApp?.draft_status) ||
      packageApp?.draft_status === "submitted");

  return UCI_BUILDER_SECTIONS.map((section) => {
    switch (section.id) {
      case "service":
        return {
          ...section,
          status: serviceComplete ? "ready" : hasProject ? "partial" : "blocked",
          complete: serviceComplete,
          helper: !hasProject
            ? "Select a project to begin"
            : !record
              ? "Initialize UCI coordination for this project first"
              : !hasProvider
                ? "Assign a utility provider in UCI setup"
                : null,
        };
      case "load":
        return {
          ...section,
          status: loadComplete ? "ready" : "partial",
          complete: loadComplete,
          helper: loadComplete
            ? null
            : "Run Load Profile Analyzer and refresh — package build depends on the load draft",
        };
      case "site":
        return {
          ...section,
          status: siteComplete ? "partial" : "blocked",
          complete: siteComplete,
          helper: siteComplete
            ? "Address is live; parcel / access logistics remain Coming Soon"
            : "Project address is missing — update the project or resolve address in UCI setup",
        };
      case "owner":
        return {
          ...section,
          status: "coming_soon",
          complete: false,
          helper:
            "Owner & billing (including Federal Tax ID) have no secure UCI store — Coming Soon",
        };
      case "drawings":
        return {
          ...section,
          status: drawingsComplete ? "ready" : packageApp ? "partial" : "blocked",
          complete: drawingsComplete,
          helper: !packageApp
            ? "Save / build the application package to load required exhibit slots"
            : drawingsComplete
              ? null
              : "Confirm document mappings for each required slot",
        };
      case "review":
        return {
          ...section,
          status: reviewComplete ? "ready" : packageApp ? "partial" : "blocked",
          complete: reviewComplete,
          helper: !packageApp
            ? "Build a package draft before review"
            : packageApp.draft_status === "submitted"
              ? null
              : canSubmitApplication(packageApp.draft_status)
                ? "Reviewed — submit runs Pepco validation dry-run by default"
                : "Mark reviewed after gaps are resolved — Agent QA / W-9 checks are Coming Soon",
        };
    }
  });
}

export function computeBuilderCompletionPercent(sections: UciBuilderSectionState[]): number {
  if (!sections.length) return 0;
  const complete = sections.filter((s) => s.complete).length;
  return Math.round((complete / sections.length) * 100);
}

export function canBuildApplicationPackage(params: {
  coordinationId: string | null;
  applications: CoordinationApplication[] | null | undefined;
}): { ok: boolean; reason: string | null } {
  if (!params.coordinationId) {
    return { ok: false, reason: "No coordination record selected" };
  }
  if (getApplicationPackageDraftApplication(params.applications)?.draft_status === "reviewed") {
    return {
      ok: false,
      reason: "Request changes before rebuilding the locked reviewed package",
    };
  }
  if (!getLoadProfileDraftApplication(params.applications)) {
    return {
      ok: false,
      reason: "Load profile analysis is required before saving an application package draft",
    };
  }
  return { ok: true, reason: null };
}

export function packageDocumentGaps(
  docs: UciApplicationPackageDocument[],
  meta: UciApplicationPackageMetadata | null,
): { missingDocs: string[]; missingFields: string[]; status: string | undefined } {
  return {
    missingDocs: meta?.missing_documents ?? docs.filter((d) => d.status !== "attached").map((d) => d.key),
    missingFields: meta?.missing_fields ?? [],
    status: meta?.package_status,
  };
}

/** Lovable marketing exhibit names — shown only as Coming Soon until a real package exists. */
export const LOVABLE_EXHIBIT_PLACEHOLDERS = [
  "Electrical riser diagram",
  "Site plan w/ service entrance",
  "Load letter (sealed)",
  "Switchgear nameplate",
  "Standby gen one-line",
] as const;

export const OWNER_BILLING_FIELDS = [
  "Account-holder name",
  "Federal Tax ID",
  "Billing address",
  "Billing email",
  "Authorized signatory",
  "Phone",
] as const;

export const SITE_LOGISTICS_COMING_SOON = [
  "Parcel ID",
  "Primary connection point",
  "Crane access",
  "Working clearance",
  "Restricted hours",
] as const;
