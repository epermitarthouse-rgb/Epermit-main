import registryData from "../../../shared/code-registry/jurisdiction-editions.json";

export type CodeSourceStatus = "verified" | "provisional" | "unavailable" | "outdated";
export type CodeReviewScope = "reference_only" | "permit_compliance";
export type LegalApplicabilityStatus =
  | "verified"
  | "verified_reference"
  | "reference_only"
  | "conflict"
  | "unresolved"
  | "unavailable";

export interface PermitApplicabilityFacts {
  applicationDate?: string | null;
  permitIssuedDate?: string | null;
  workScope?: string | null;
  occupancy?: string | null;
  originalPermitCodeEdition?: string | null;
  priorPermitActive?: boolean | null;
  applicationDepositPaidDate?: string | null;
  applicationComplete?: boolean | null;
  designContractDate?: string | null;
}

export interface JurisdictionEditionRecord {
  id: string;
  jurisdictionKey: string;
  jurisdictionName: string;
  governingAuthority: string;
  jurisdictionCodeFamily: string;
  jurisdictionCodeEdition: string;
  baseCodes: Array<{ family: string; edition: string; discipline: string }>;
  referencedStandards?: Array<{ family: string; edition: string; status?: string }>;
  effectiveFrom: string;
  supersededOn: string | null;
  officialSourceUrl: string;
  verificationDate: string;
  sourceStatus: CodeSourceStatus;
  transitionProvisions?: Array<{
    codeBook: string;
    section: string;
    topics: string[];
    rules?: Record<string, {
      section: string;
      requireOriginalEdition?: boolean;
      requireActivePermit?: boolean;
      requireDepositDate?: boolean;
      requireApplicationComplete?: boolean;
      requiresFurtherDocumentReview?: boolean;
    }>;
  }>;
  coverage?: {
    adoption?: string;
    applicability?: string;
    enforceableProvisionText?: string;
    note?: string;
  };
}

export interface JurisdictionEditionVerification {
  status: LegalApplicabilityStatus;
  reviewScope: CodeReviewScope;
  requestedReviewScope: CodeReviewScope;
  jurisdiction: string;
  selectedEdition: string;
  adoptedEdition: string | null;
  adoptedBaseCode: string | null;
  registryRecordId: string | null;
  governingAuthority: string | null;
  officialSourceUrl: string | null;
  verificationDate: string | null;
  sourceStatus: CodeSourceStatus;
  sourceCoverage: "unavailable" | "applicability_only" | "partial" | "complete";
  unresolvedReasons: string[];
  warning: string | null;
  requiresReferenceConfirmation: boolean;
  referenceReviewConfirmed: boolean;
  transitionSection?: string | null;
  permitFacts: PermitApplicabilityFacts;
}

const records = registryData as JurisdictionEditionRecord[];

export function normalizeRegistryJurisdiction(value: string | null | undefined): string {
  const key = String(value || "general").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (["washington-dc", "washington-d-c", "district-of-columbia", "d-c"].includes(key)) return "dc";
  return key || "general";
}

function editionMatches(record: JurisdictionEditionRecord, selectedEdition: string): boolean {
  const selected = String(selectedEdition || "").trim();
  if (!selected) return false;
  if (record.jurisdictionCodeEdition === selected) return true;
  const codes = [
    ...(record.baseCodes || []),
    ...(record.referencedStandards || []),
  ];
  const ibc = codes.find((code) => code.family === "IBC");
  if (ibc && ibc.edition === selected) return true;
  const years = [...new Set([...selected.matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => match[1]))];
  const lower = selected.toLowerCase();
  const namesIbc = /\bibc\b|international building code/.test(lower);
  const namesBuilding = /\b(?:building|construction)\s+codes?\b/.test(lower);
  const jurisdictionNamed = record.jurisdictionKey === "dc"
    ? /\b(?:dc|d\.c\.|district of columbia)\b/i.test(selected)
    : false;
  if (years.length === 2 && ibc && (namesBuilding || namesIbc || jurisdictionNamed)) {
    const set = new Set(years);
    if (set.has(record.jurisdictionCodeEdition) && set.has(ibc.edition)) return true;
  }
  if (years.length !== 1) return false;
  const year = years[0];
  if (namesIbc && ibc && year === ibc.edition) return true;
  if (namesBuilding && !namesIbc && ibc && year === ibc.edition) return true;
  if ((namesBuilding || jurisdictionNamed) && year === record.jurisdictionCodeEdition && !namesIbc) return true;
  return codes.some((code) => {
    const family = String(code.family || "");
    const named = family.length > 0 && new RegExp(`\\b${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(selected);
    const nec = /\bnec\b|\bnfpa\s*70\b/i.test(selected) && /^(?:NEC|NFPA 70)$/i.test(family);
    if (!named && !nec) return false;
    return code.edition === year || year === record.jurisdictionCodeEdition;
  });
}

function verifiedRecords(jurisdiction: string): JurisdictionEditionRecord[] {
  return records
    .filter(
      (record) =>
        record.jurisdictionKey === normalizeRegistryJurisdiction(jurisdiction)
        && record.sourceStatus === "verified",
    )
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

function recordForDate(
  available: JurisdictionEditionRecord[],
  applicationDate: string | null,
): JurisdictionEditionRecord | null {
  if (!applicationDate) return available.find((record) => !record.supersededOn) || available[0] || null;
  return (
    available.find(
      (record) =>
        record.effectiveFrom <= applicationDate
        && (!record.supersededOn || applicationDate <= record.supersededOn),
    ) || null
  );
}

function recordFields(record: JurisdictionEditionRecord | null) {
  const building = record?.baseCodes.find((code) => code.family === "IBC") || record?.baseCodes[0] || null;
  return {
    adoptedEdition: record
      ? `${record.jurisdictionCodeFamily} ${record.jurisdictionCodeEdition}`
      : null,
    adoptedBaseCode: building ? `${building.family} ${building.edition}` : null,
    registryRecordId: record?.id || null,
    governingAuthority: record?.governingAuthority || null,
    officialSourceUrl: record?.officialSourceUrl || null,
    verificationDate: record?.verificationDate || null,
    sourceStatus: record?.sourceStatus || ("unavailable" as const),
    sourceCoverage:
      record?.coverage?.enforceableProvisionText === "unavailable"
        ? ("applicability_only" as const)
        : record
          ? ("partial" as const)
          : ("unavailable" as const),
  };
}

export function resolveJurisdictionEditionVerification(input: {
  jurisdiction: string;
  selectedEdition: string;
  requestedReviewScope?: CodeReviewScope;
  permitFacts?: PermitApplicabilityFacts;
  referenceReviewConfirmed?: boolean;
}): JurisdictionEditionVerification {
  const jurisdiction = normalizeRegistryJurisdiction(input.jurisdiction);
  const selectedEdition = String(input.selectedEdition || "");
  const requestedReviewScope =
    input.requestedReviewScope === "permit_compliance" ? "permit_compliance" : "reference_only";
  const permitFacts = input.permitFacts || {};
  const base = {
    requestedReviewScope,
    jurisdiction,
    selectedEdition,
    referenceReviewConfirmed: Boolean(input.referenceReviewConfirmed),
    permitFacts,
  };

  if (jurisdiction === "general") {
    return {
      ...base,
      status: "reference_only",
      reviewScope: "reference_only",
      ...recordFields(null),
      unresolvedReasons: [],
      warning:
        "General IBC is a selected-edition reference review. It is not a verified local permit-compliance determination.",
      requiresReferenceConfirmation: false,
    };
  }

  const available = verifiedRecords(jurisdiction);
  if (!available.length) {
    return {
      ...base,
      status: "unavailable",
      reviewScope: "reference_only",
      ...recordFields(null),
      unresolvedReasons: ["No verified jurisdiction-edition record is available."],
      warning: "Adoption data is unavailable. This run can only be reference-only.",
      requiresReferenceConfirmation: false,
    };
  }

  const current = available.find((record) => !record.supersededOn) || available[0];
  const applicationDate = permitFacts.applicationDate || null;
  let applicable = recordForDate(available, applicationDate);
  const transitionRules = current.transitionProvisions?.[0]?.rules || {};
  const unresolvedReasons: string[] = [];
  let transitionSection: string | null = null;

  if (["revision", "tenant_layout", "existing_permit"].includes(String(permitFacts.workScope))) {
    const rule = transitionRules[String(permitFacts.workScope)];
    const originalEdition = String(permitFacts.originalPermitCodeEdition || "");
    if (!rule) unresolvedReasons.push("No verified transition rule is indexed for this work scope.");
    if (rule?.requireOriginalEdition && !originalEdition) {
      unresolvedReasons.push("Original permit code edition is required.");
    } else if (rule?.requireOriginalEdition) {
      applicable = available.find((record) => editionMatches(record, originalEdition)) || null;
      if (!applicable) unresolvedReasons.push("Original permit edition is not verified.");
    }
    if (rule?.requireActivePermit && permitFacts.priorPermitActive !== true) {
      unresolvedReasons.push("An active prior permit must be documented.");
    }
    transitionSection = rule?.section || null;
  } else if (applicationDate && applicationDate < current.effectiveFrom) {
    const rule = transitionRules.pre_adoption_application;
    transitionSection = rule?.section || null;
    if (!rule) unresolvedReasons.push("No verified pre-adoption transition rule is indexed.");
    if (rule?.requireDepositDate && !permitFacts.applicationDepositPaidDate) {
      unresolvedReasons.push("Pre-adoption filing-deposit date is required.");
    }
    if (rule?.requireApplicationComplete && permitFacts.applicationComplete !== true) {
      unresolvedReasons.push("Pre-adoption application completeness must be documented.");
    }
  } else if (permitFacts.designContractDate && permitFacts.designContractDate < current.effectiveFrom) {
    const rule = transitionRules.design_contract;
    transitionSection = rule?.section || null;
    if (!rule) {
      unresolvedReasons.push("No verified design-contract transition rule is indexed.");
    } else if (rule.requiresFurtherDocumentReview) {
      unresolvedReasons.push("Design-contract transition requires further document review.");
    }
  }

  applicable ||= current;
  const fields = recordFields(applicable);
  if (!editionMatches(applicable, selectedEdition)) {
    return {
      ...base,
      status: "conflict",
      reviewScope: "reference_only",
      ...fields,
      unresolvedReasons,
      warning: `Selected ${selectedEdition || "edition"} is not the adopted local edition (${fields.adoptedEdition}) or its base model code (${fields.adoptedBaseCode}). A different model year is not the same adoption. The selection will not be silently changed.`,
      requiresReferenceConfirmation: true,
      transitionSection,
    };
  }

  if (requestedReviewScope === "reference_only") {
    return {
      ...base,
      status: "verified_reference",
      reviewScope: "reference_only",
      ...fields,
      unresolvedReasons,
      warning: null,
      requiresReferenceConfirmation: false,
      transitionSection,
    };
  }

  if (!permitFacts.applicationDate && !permitFacts.permitIssuedDate) {
    unresolvedReasons.push("Permit application or issue date is required.");
  }
  if (!permitFacts.workScope) unresolvedReasons.push("Construction scope is required.");
  if (unresolvedReasons.length) {
    return {
      ...base,
      status: "unresolved",
      reviewScope: requestedReviewScope,
      ...fields,
      unresolvedReasons,
      warning: unresolvedReasons[0],
      requiresReferenceConfirmation: false,
      transitionSection,
    };
  }

  return {
    ...base,
    status: "verified",
    reviewScope: "permit_compliance",
    ...fields,
    unresolvedReasons: [],
    warning: null,
    requiresReferenceConfirmation: false,
    transitionSection,
  };
}

export function currentVerifiedRecord(jurisdiction: string): JurisdictionEditionRecord | null {
  return verifiedRecords(jurisdiction).find((record) => !record.supersededOn) || null;
}
