"use strict";

const bundledEditions = require("../../../../../shared/code-registry/jurisdiction-editions.json");
const bundledProvisions = require("../../../../../shared/code-registry/authoritative-provisions.json");

const VERIFIED = "verified";
const REFERENCE_ONLY = "reference_only";
const PERMIT_COMPLIANCE = "permit_compliance";

function normalizeJurisdiction(value) {
  const key = String(value || "general").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (["washington-dc", "washington-d-c", "district-of-columbia", "d-c"].includes(key)) return "dc";
  return key || "general";
}

function isoDate(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[0]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : match[0];
}

function editionMatches(record, selectedEdition) {
  const selected = String(selectedEdition || "").trim();
  if (!selected) return false;
  return record.jurisdictionCodeEdition === selected
    || (record.baseCodes || []).some((code) => code.family === "IBC" && code.edition === selected);
}

function verifiedRecordsFor(jurisdiction, records = bundledEditions) {
  const key = normalizeJurisdiction(jurisdiction);
  return records
    .filter((record) => record.jurisdictionKey === key && record.sourceStatus === VERIFIED)
    .sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)));
}

function recordForDate(records, date) {
  if (!date) return records.find((record) => !record.supersededOn) || records[0] || null;
  return records.find((record) =>
    record.effectiveFrom <= date && (!record.supersededOn || date <= record.supersededOn),
  ) || null;
}

function unavailableResult(input, status, message) {
  return {
    status,
    reviewScope: REFERENCE_ONLY,
    requestedReviewScope: input.requestedReviewScope || REFERENCE_ONLY,
    jurisdiction: normalizeJurisdiction(input.jurisdiction),
    selectedEdition: String(input.selectedEdition || ""),
    adoptedEdition: null,
    adoptedBaseCode: null,
    registryRecordId: null,
    governingAuthority: null,
    officialSourceUrl: null,
    verificationDate: null,
    sourceStatus: status === "unavailable" ? "unavailable" : "provisional",
    sourceCoverage: "unavailable",
    unresolvedReasons: [message],
    warning: message,
    requiresReferenceConfirmation: status === "conflict",
    referenceReviewConfirmed: Boolean(input.referenceReviewConfirmed),
    permitFacts: input.permitFacts || {},
  };
}

function recordSummary(record) {
  const building = (record.baseCodes || []).find((code) => code.family === "IBC")
    || record.baseCodes?.[0]
    || null;
  return {
    adoptedEdition: `${record.jurisdictionCodeFamily} ${record.jurisdictionCodeEdition}`,
    adoptedBaseCode: building ? `${building.family} ${building.edition}` : null,
    registryRecordId: record.id,
    governingAuthority: record.governingAuthority,
    officialSourceUrl: record.officialSourceUrl,
    verificationDate: record.verificationDate,
    sourceStatus: record.sourceStatus,
    sourceCoverage: record.coverage?.enforceableProvisionText === "unavailable"
      ? "applicability_only"
      : "partial",
  };
}

/**
 * Conservative legal-applicability resolver. It only returns permit_compliance
 * when an official registry record and the facts required by its transition
 * rule agree. Missing facts never become assumptions.
 */
function resolveLegalApplicability(input, records = bundledEditions) {
  const jurisdiction = normalizeJurisdiction(input.jurisdiction);
  const requestedReviewScope = input.requestedReviewScope === PERMIT_COMPLIANCE
    ? PERMIT_COMPLIANCE
    : REFERENCE_ONLY;
  const selectedEdition = String(input.selectedEdition || "").trim();
  const permitFacts = input.permitFacts || {};

  if (jurisdiction === "general") {
    return {
      ...unavailableResult(
        { ...input, requestedReviewScope },
        "reference_only",
        "General IBC is a selected-edition reference review and is not a jurisdictional adoption determination.",
      ),
      status: "reference_only",
      sourceStatus: "unavailable",
      requiresReferenceConfirmation: false,
    };
  }

  const verified = verifiedRecordsFor(jurisdiction, records);
  if (!verified.length) {
    return unavailableResult(
      { ...input, requestedReviewScope },
      "unavailable",
      "No verified jurisdiction-edition record is available. This run can only be presented as reference-only.",
    );
  }

  const current = verified.find((record) => !record.supersededOn) || verified[0];
  const applicationDate = isoDate(permitFacts.applicationDate);
  const issuedDate = isoDate(permitFacts.permitIssuedDate);
  const workScope = String(permitFacts.workScope || "").trim();
  let applicable = applicationDate ? recordForDate(verified, applicationDate) : current;
  const transitionRules = current.transitionProvisions?.[0]?.rules || {};
  const unresolvedReasons = [];
  let transitionSection = null;

  if (!editionMatches(current, selectedEdition) && !applicationDate) {
    return {
      ...unavailableResult(
        { ...input, requestedReviewScope },
        "conflict",
        `Selected edition ${selectedEdition || "is blank"} does not match the verified current adoption (${recordSummary(current).adoptedBaseCode}). It will not be silently changed.`,
      ),
      ...recordSummary(current),
      status: "conflict",
      sourceStatus: VERIFIED,
      sourceCoverage: current.coverage?.enforceableProvisionText === "unavailable"
        ? "applicability_only"
        : "partial",
    };
  }

  if (!workScope && requestedReviewScope === PERMIT_COMPLIANCE) {
    unresolvedReasons.push("Construction scope is required for a permit-compliance determination.");
  }
  if (!applicationDate && !issuedDate && requestedReviewScope === PERMIT_COMPLIANCE) {
    unresolvedReasons.push("Permit application or issue date is required for a permit-compliance determination.");
  }

  if (["revision", "tenant_layout", "existing_permit"].includes(workScope)) {
    const rule = transitionRules[workScope];
    const originalEdition = String(permitFacts.originalPermitCodeEdition || "").trim();
    if (!rule) {
      unresolvedReasons.push("No verified transition rule is indexed for this work scope.");
    }
    if (rule?.requireOriginalEdition && !originalEdition) {
      unresolvedReasons.push("The original permit code edition is required for this transition review.");
    } else if (rule?.requireOriginalEdition) {
      applicable = verified.find((record) => editionMatches(record, originalEdition)) || null;
      if (!applicable) {
        unresolvedReasons.push("The original permit edition is not covered by a verified registry record.");
      }
    }
    if (rule?.requireActivePermit && permitFacts.priorPermitActive !== true) {
      unresolvedReasons.push("An active, unexpired, unrevoked prior permit must be documented.");
    }
    transitionSection = rule?.section || null;
  } else if (applicationDate && applicationDate < current.effectiveFrom) {
    const rule = transitionRules.pre_adoption_application;
    transitionSection = rule?.section || null;
    if (!rule) {
      unresolvedReasons.push("No verified pre-adoption application transition rule is indexed.");
    }
    if (rule?.requireDepositDate && !isoDate(permitFacts.applicationDepositPaidDate)) {
      unresolvedReasons.push("The pre-adoption application filing-deposit date is required by the documented transition rule.");
    }
    if (rule?.requireApplicationComplete && permitFacts.applicationComplete !== true) {
      unresolvedReasons.push("The pre-adoption application's documented completeness is required by the transition rule.");
    }
  } else if (permitFacts.designContractDate && isoDate(permitFacts.designContractDate) < current.effectiveFrom) {
    const rule = transitionRules.design_contract;
    transitionSection = rule?.section || null;
    if (!rule) {
      unresolvedReasons.push("No verified design-contract transition rule is indexed.");
    } else if (rule.requiresFurtherDocumentReview) {
      unresolvedReasons.push("The design-contract transition requires document and deadline review that is not fully covered by the indexed authoritative text.");
    }
  }

  if (!applicable) {
    unresolvedReasons.push("No verified edition record covers the supplied application date.");
    applicable = current;
  }

  const summary = recordSummary(applicable);
  const selectedMatchesApplicable = editionMatches(applicable, selectedEdition);
  if (!selectedMatchesApplicable) {
    return {
      ...unavailableResult(
        { ...input, requestedReviewScope },
        "conflict",
        `Selected edition ${selectedEdition || "is blank"} does not match the verified applicable edition (${summary.adoptedBaseCode}). It will not be silently changed.`,
      ),
      ...summary,
      status: "conflict",
      sourceStatus: VERIFIED,
      sourceCoverage: summary.sourceCoverage,
      transitionSection,
      unresolvedReasons,
    };
  }

  if (requestedReviewScope === REFERENCE_ONLY) {
    return {
      status: "verified_reference",
      reviewScope: REFERENCE_ONLY,
      requestedReviewScope,
      jurisdiction,
      selectedEdition,
      ...summary,
      unresolvedReasons,
      warning: null,
      requiresReferenceConfirmation: false,
      referenceReviewConfirmed: Boolean(input.referenceReviewConfirmed),
      transitionSection,
      permitFacts,
    };
  }

  if (unresolvedReasons.length) {
    return {
      status: "unresolved",
      reviewScope: REFERENCE_ONLY,
      requestedReviewScope,
      jurisdiction,
      selectedEdition,
      ...summary,
      unresolvedReasons,
      warning: "Legal applicability is unresolved. Results must remain reference-only.",
      requiresReferenceConfirmation: false,
      referenceReviewConfirmed: Boolean(input.referenceReviewConfirmed),
      transitionSection,
      permitFacts,
    };
  }

  return {
    status: VERIFIED,
    reviewScope: PERMIT_COMPLIANCE,
    requestedReviewScope,
    jurisdiction,
    selectedEdition,
    ...summary,
    unresolvedReasons: [],
    warning: null,
    requiresReferenceConfirmation: false,
    referenceReviewConfirmed: Boolean(input.referenceReviewConfirmed),
    transitionSection,
    permitFacts,
  };
}

function bundledAuthoritativeProvisions(query = {}) {
  const jurisdiction = normalizeJurisdiction(query.jurisdiction);
  const selectedEdition = String(query.selectedEdition || "");
  const registryRecordId = query.registryRecordId || null;
  return bundledProvisions.filter((provision) => {
    if (provision.verificationStatus !== VERIFIED) return false;
    if (provision.jurisdiction !== jurisdiction) return false;
    if (registryRecordId && provision.registryRecordId !== registryRecordId) return false;
    if (selectedEdition &&
        provision.edition !== selectedEdition &&
        provision.baseCodeEdition !== selectedEdition &&
        provision.jurisdictionCodeEdition !== selectedEdition) {
      return false;
    }
    return true;
  });
}

async function loadRegistryRows(supabase, jurisdiction) {
  if (!supabase || normalizeJurisdiction(jurisdiction) === "general") return [];
  let data;
  try {
    const result = await supabase
      .from("code_analyzer_jurisdiction_editions")
      .select("*")
      .eq("jurisdiction_key", normalizeJurisdiction(jurisdiction))
      .in("source_status", ["verified", "provisional", "outdated"])
      .order("effective_from", { ascending: false });
    if (result.error) return [];
    data = result.data;
  } catch {
    return [];
  }
  return (data || []).map((row) => ({
    id: row.registry_key,
    jurisdictionKey: row.jurisdiction_key,
    jurisdictionName: row.jurisdiction_name,
    governingAuthority: row.governing_authority,
    jurisdictionCodeFamily: row.jurisdiction_code_family,
    jurisdictionCodeEdition: row.jurisdiction_code_edition,
    baseCodes: row.base_codes || [],
    localAmendments: row.local_amendments || [],
    referencedStandards: row.referenced_standards || [],
    effectiveFrom: row.effective_from,
    supersededOn: row.superseded_on,
    officialSourceUrl: row.official_source_url,
    officialTextUrl: row.official_text_url,
    verificationDate: row.verification_date,
    sourceStatus: row.source_status,
    applicablePermitApplicationDates: row.applicable_permit_dates || {},
    transitionProvisions: row.transition_provisions || [],
    documentedExceptions: row.documented_exceptions || [],
    coverage: row.coverage || {},
  }));
}

async function loadProvisionRows(supabase, registryRecordId) {
  if (!supabase || !registryRecordId) return [];
  let data;
  try {
    const result = await supabase
      .from("code_analyzer_code_provisions")
      .select("*")
      .eq("registry_key", registryRecordId)
      .eq("verification_status", VERIFIED);
    if (result.error) return [];
    data = result.data;
  } catch {
    return [];
  }
  return (data || []).map((row) => ({
    id: row.provision_key,
    registryRecordId: row.registry_key,
    jurisdiction: row.jurisdiction_key,
    jurisdictionCodeEdition: row.jurisdiction_code_edition,
    codeBook: row.code_book,
    edition: row.edition,
    baseCodeFamily: row.base_code_family,
    baseCodeEdition: row.base_code_edition,
    section: row.section,
    heading: row.heading,
    text: row.exact_text,
    exactTextStored: row.exact_text_stored,
    provisionType: row.provision_type,
    topics: row.topics || [],
    thresholds: row.thresholds || [],
    exceptions: row.exceptions || [],
    applicability: row.applicability || {},
    sourceUrl: row.source_url,
    sourceLocator: row.source_locator,
    verificationDate: row.verification_date,
    sourceStatus: row.source_status,
    verificationStatus: row.verification_status,
    licenseStatus: row.license_status,
    authoritative: row.authoritative,
    supportsConfirmedViolation: row.supports_confirmed_violation,
  }));
}

async function buildCodeVerificationBundle(input) {
  const dbRecords = await loadRegistryRows(input.supabase, input.jurisdiction);
  const records = dbRecords.length ? dbRecords : bundledEditions;
  const legalApplicability = resolveLegalApplicability(input, records);
  const dbProvisions = await loadProvisionRows(input.supabase, legalApplicability.registryRecordId);
  const bundled = bundledAuthoritativeProvisions({
    jurisdiction: input.jurisdiction,
    selectedEdition: input.selectedEdition,
    registryRecordId: legalApplicability.registryRecordId,
  });
  const provisions = [
    ...new Map([...bundled, ...dbProvisions].map((item) => [item.id, item])).values(),
  ];
  return {
    legalApplicability,
    provisions,
    coverage: {
      registrySource: dbRecords.length ? "database" : "bundled_verified_registry",
      authoritativeProvisionCount: provisions.filter((item) =>
        item.authoritative === true && item.sourceStatus === "verified_text",
      ).length,
      enforceableProvisionCount: provisions.filter((item) =>
        item.authoritative === true && item.supportsConfirmedViolation === true,
      ).length,
      status: legalApplicability.sourceCoverage || "unavailable",
    },
  };
}

module.exports = {
  VERIFIED,
  REFERENCE_ONLY,
  PERMIT_COMPLIANCE,
  normalizeJurisdiction,
  editionMatches,
  verifiedRecordsFor,
  resolveLegalApplicability,
  bundledAuthoritativeProvisions,
  buildCodeVerificationBundle,
};
