"use strict";

/**
 * Canonical, provenance-aware project address normalization.
 *
 * Canonical provenance is stored at portal_data._permitpilot.canonical_address.
 * Structured columns (projects.address, city, state, zip_code) mirror the canonical
 * formatted line when safe to update; raw portal payloads are never overwritten.
 */

const PERMITPILOT_META_KEY = "_permitpilot";
const CANONICAL_ADDRESS_KEY = "canonical_address";

/** @typedef {"manual" | "jurisdiction_scrape" | "utility_portal" | "confirmed" | "none"} CanonicalAddressSource */

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimStr(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeComparableAddress(value) {
  return trimStr(value).replace(/\s+/g, " ").toLowerCase();
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
function normalizePortalDataObject(raw) {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return /** @type {Record<string, unknown>} */ (raw);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return /** @type {Record<string, unknown>} */ (parsed);
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null | undefined} portalData
 * @returns {Record<string, unknown> | null}
 */
function readPermitPilotMeta(portalData) {
  const meta = portalData?.[PERMITPILOT_META_KEY];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return /** @type {Record<string, unknown>} */ (meta);
}

/**
 * @param {Record<string, unknown> | null | undefined} project
 * @returns {Record<string, unknown> | null}
 */
function readCanonicalAddressRecord(project) {
  const portalData = normalizePortalDataObject(project?.portal_data);
  const meta = readPermitPilotMeta(portalData);
  const canonical = meta?.[CANONICAL_ADDRESS_KEY];
  if (!canonical || typeof canonical !== "object" || Array.isArray(canonical)) return null;
  return /** @type {Record<string, unknown>} */ (canonical);
}

/**
 * @param {CanonicalAddressSource | string} source
 * @returns {boolean}
 */
function isProtectedCanonicalSource(source) {
  const normalized = trimStr(source).toLowerCase();
  return normalized === "manual" || normalized === "confirmed";
}

/**
 * @param {Record<string, unknown> | null | undefined} project
 * @returns {string | null}
 */
function extractPortalDataLocation(project) {
  const portalData = normalizePortalDataObject(project?.portal_data);
  if (!portalData) return null;
  const location = trimStr(portalData.location);
  return location || null;
}

/**
 * @param {Record<string, unknown>} project
 */
function buildStructuredAddressParts(project) {
  return {
    address: trimStr(project.address) || null,
    city: trimStr(project.city) || null,
    state: trimStr(project.state) || null,
    zip_code: trimStr(project.zip_code) || null,
    jurisdiction: trimStr(project.jurisdiction) || null,
  };
}

/**
 * @param {Record<string, string | null>} parts
 * @returns {string | null}
 */
function formatAddressParts(parts) {
  const lineParts = [parts.address, parts.city, parts.state, parts.zip_code].filter(Boolean);
  return lineParts.length ? lineParts.join(", ") : null;
}

/**
 * @param {object} params
 * @param {CanonicalAddressSource} params.source
 * @param {string | null} params.formatted
 * @param {Record<string, string | null>} [params.parts]
 * @param {string | null} [params.sourceField]
 * @param {string | null} [params.sourcePortal]
 * @param {string | null} [params.sourceTimestamp]
 * @param {boolean} [params.confirmed]
 * @param {string | null} [params.selectionReason]
 * @param {boolean} [params.fallbackUsed]
 * @returns {Record<string, unknown>}
 */
function buildResolvedAddress(params) {
  const parts = params.parts ?? {
    address: params.formatted,
    city: null,
    state: null,
    zip_code: null,
    jurisdiction: null,
  };
  const formatted = params.formatted ?? formatAddressParts(parts);
  const hasStreet = Boolean(trimStr(parts.address) || trimStr(formatted));
  return {
    source: params.source,
    parts,
    formatted,
    complete: Boolean(hasStreet && (parts.city || parts.state)),
    fallback_used: Boolean(params.fallbackUsed),
    source_field: params.sourceField ?? null,
    source_portal: params.sourcePortal ?? null,
    source_timestamp: params.sourceTimestamp ?? null,
    selection_reason: params.selectionReason ?? null,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} canonical
 * @returns {ReturnType<typeof buildResolvedAddress> | null}
 */
function resolvedFromCanonicalRecord(canonical) {
  if (!canonical) return null;
  const formatted = trimStr(canonical.formatted) || trimStr(canonical.address) || null;
  if (!formatted) return null;
  const partsRaw =
    canonical.parts && typeof canonical.parts === "object" && !Array.isArray(canonical.parts)
      ? /** @type {Record<string, unknown>} */ (canonical.parts)
      : {};
  const parts = {
    address: trimStr(partsRaw.address) || trimStr(canonical.address) || formatted,
    city: trimStr(partsRaw.city) || trimStr(canonical.city) || null,
    state: trimStr(partsRaw.state) || trimStr(canonical.state) || null,
    zip_code: trimStr(partsRaw.zip_code) || trimStr(canonical.zip_code) || null,
    jurisdiction: trimStr(partsRaw.jurisdiction) || trimStr(canonical.jurisdiction) || null,
  };
  const source = trimStr(canonical.source) || "none";
  return buildResolvedAddress({
    source: /** @type {CanonicalAddressSource} */ (source),
    formatted,
    parts,
    sourceField: trimStr(canonical.source_field) || null,
    sourcePortal: trimStr(canonical.source_portal) || null,
    sourceTimestamp: trimStr(canonical.source_timestamp) || null,
    confirmed: canonical.confirmed === true,
    selectionReason: trimStr(canonical.selection_reason) || null,
    fallbackUsed: canonical.fallback_used === true,
  });
}

/**
 * @param {Record<string, unknown> | null | undefined} project
 */
function buildLegacyStructuredResolvedAddress(project) {
  if (!project) return null;
  const parts = buildStructuredAddressParts(project);
  const formatted = formatAddressParts(parts);
  if (!formatted) return null;
  return buildResolvedAddress({
    source: "manual",
    formatted,
    parts,
    sourceField: "projects.address",
    selectionReason: "Legacy structured project fields without canonical provenance",
  });
}

/**
 * @param {string} location
 * @param {object} [meta]
 * @param {string | null} [meta.sourcePortal]
 * @param {string | null} [meta.sourceTimestamp]
 */
function buildJurisdictionScrapeResolvedAddress(location, meta = {}) {
  const formatted = trimStr(location);
  if (!formatted) return null;
  return buildResolvedAddress({
    source: "jurisdiction_scrape",
    formatted,
    parts: {
      address: formatted,
      city: null,
      state: null,
      zip_code: null,
      jurisdiction: null,
    },
    sourceField: "portal_data.location",
    sourcePortal: meta.sourcePortal ?? null,
    sourceTimestamp: meta.sourceTimestamp ?? null,
    selectionReason: "Jurisdiction portal scrape site/work location",
    fallbackUsed: false,
  });
}

/**
 * @param {string} propertyAddress
 * @param {object} [meta]
 * @param {string | null} [meta.externalApplicationId]
 * @param {string | null} [meta.sourcePortal]
 */
function buildUtilityPortalResolvedAddress(propertyAddress, meta = {}) {
  const formatted = trimStr(propertyAddress);
  if (!formatted) return null;
  return buildResolvedAddress({
    source: "utility_portal",
    formatted,
    parts: {
      address: formatted,
      city: null,
      state: null,
      zip_code: null,
      jurisdiction: null,
    },
    sourceField: "overview.propertyAddress",
    sourcePortal: meta.sourcePortal ?? "pepco",
    sourceTimestamp: null,
    selectionReason: meta.externalApplicationId
      ? `Selected utility application ${meta.externalApplicationId}`
      : "Selected utility application property address",
    fallbackUsed: true,
  });
}

/**
 * @param {Record<string, unknown> | null | undefined} coordinationRecord
 * @param {string | null | undefined} externalApplicationId
 * @returns {string | null}
 */
function extractUtilityApplicationAddressFromCoordinationRecord(
  coordinationRecord,
  externalApplicationId,
) {
  const extId = trimStr(externalApplicationId);
  if (!extId || !coordinationRecord?.metadata) return null;

  const metadata =
    coordinationRecord.metadata &&
    typeof coordinationRecord.metadata === "object" &&
    !Array.isArray(coordinationRecord.metadata)
      ? /** @type {Record<string, unknown>} */ (coordinationRecord.metadata)
      : null;
  if (!metadata) return null;

  const discovery = metadata.pepco_application_detail_discovery;
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery)) return null;

  const applications = Array.isArray(
    /** @type {{ applications?: unknown }} */ (discovery).applications,
  )
    ? /** @type {Array<Record<string, unknown>>} */ (
        /** @type {{ applications: unknown[] }} */ (discovery).applications
      )
    : [];

  const app = applications.find(
    (entry) =>
      trimStr(entry.applicationUuid ?? entry.external_application_id ?? entry.externalApplicationId) ===
      extId,
  );
  if (!app) return null;

  const overview =
    app.overview && typeof app.overview === "object" && !Array.isArray(app.overview)
      ? /** @type {Record<string, unknown>} */ (app.overview)
      : null;
  const propertyAddress = overview ? trimStr(overview.propertyAddress) : "";
  return propertyAddress || null;
}

/**
 * @param {object} params
 * @param {Record<string, unknown> | null | undefined} [params.project]
 * @param {Record<string, unknown> | null | undefined} [params.coordinationRecord]
 * @param {string | null | undefined} [params.externalApplicationId]
 * @param {string | null | undefined} [params.utilityApplicationAddress]
 * @param {CanonicalAddressSource | string | null | undefined} [params.preferAcknowledgedSource]
 */
function resolveAndNormalizeProjectAddress(params) {
  const project = params.project ?? null;
  const canonical = readCanonicalAddressRecord(project);
  const canonicalResolved = resolvedFromCanonicalRecord(canonical);
  const canonicalSource = canonical ? trimStr(canonical.source) : "";
  const canonicalConfirmed = canonical?.confirmed === true;

  const jurisdictionLocation = extractPortalDataLocation(project);
  const jurisdictionResolved = jurisdictionLocation
    ? buildJurisdictionScrapeResolvedAddress(jurisdictionLocation, {
        sourcePortal:
          normalizePortalDataObject(project?.portal_data)?.portalType != null
            ? String(normalizePortalDataObject(project?.portal_data)?.portalType)
            : null,
      })
    : null;

  const legacyStructured = buildLegacyStructuredResolvedAddress(project);

  const utilityAddressExplicit = trimStr(params.utilityApplicationAddress) || null;
  const utilityAddressFromRecord =
    utilityAddressExplicit ||
    extractUtilityApplicationAddressFromCoordinationRecord(
      params.coordinationRecord,
      params.externalApplicationId,
    );
  const utilityResolved = utilityAddressFromRecord
    ? buildUtilityPortalResolvedAddress(utilityAddressFromRecord, {
        externalApplicationId: trimStr(params.externalApplicationId) || null,
        sourcePortal: "pepco",
      })
    : null;

  /** @type {Array<ReturnType<typeof buildResolvedAddress>>} */
  const candidates = [];

  if (canonicalResolved && (canonicalConfirmed || isProtectedCanonicalSource(canonicalSource))) {
    candidates.push({
      ...canonicalResolved,
      source: canonicalConfirmed ? "confirmed" : /** @type {CanonicalAddressSource} */ (canonicalSource),
      selection_reason:
        canonicalResolved.selection_reason ||
        "Manually confirmed or corrected canonical project address",
    });
  } else if (canonicalResolved && canonicalSource === "jurisdiction_scrape") {
    candidates.push(canonicalResolved);
  } else if (legacyStructured && isProtectedCanonicalSource(canonicalSource)) {
    candidates.push(legacyStructured);
  } else if (legacyStructured && !canonicalResolved) {
    candidates.push(legacyStructured);
  }

  if (jurisdictionResolved) {
    candidates.push(jurisdictionResolved);
  }

  if (utilityResolved) {
    candidates.push(utilityResolved);
  }

  const acknowledged = trimStr(params.preferAcknowledgedSource).toLowerCase();
  if (acknowledged === "structured" || acknowledged === "manual") {
    const manualPick = candidates.find((c) => c.source === "manual" || c.source === "confirmed");
    if (manualPick) {
      return finalizeAddressResolution(manualPick, {
        canonical,
        jurisdictionResolved,
        utilityResolved,
        project,
      });
    }
  }
  if (acknowledged === "portal_data_location" || acknowledged === "jurisdiction_scrape") {
    const scrapePick = candidates.find((c) => c.source === "jurisdiction_scrape");
    if (scrapePick) {
      return finalizeAddressResolution(scrapePick, {
        canonical,
        jurisdictionResolved,
        utilityResolved,
        project,
      });
    }
  }
  if (acknowledged === "utility_portal") {
    const utilityPick = candidates.find((c) => c.source === "utility_portal");
    if (utilityPick) {
      return finalizeAddressResolution(utilityPick, {
        canonical,
        jurisdictionResolved,
        utilityResolved,
        project,
      });
    }
  }

  const selected = candidates[0] ?? buildResolvedAddress({ source: "none", formatted: null });
  return finalizeAddressResolution(selected, {
    canonical,
    jurisdictionResolved,
    utilityResolved,
    project,
  });
}

/**
 * @param {object} context
 * @param {Record<string, unknown> | null | undefined} [project]
 */
function buildAvailableAddressSources(context, project) {
  /** @type {CanonicalAddressSource[]} */
  const sources = [];
  const canonical = context.canonical;
  const canonicalSource = canonical ? trimStr(canonical.source) : "";
  if (
    canonical &&
    (canonical.confirmed === true || isProtectedCanonicalSource(canonicalSource)) &&
    (trimStr(canonical.formatted) || trimStr(canonical.address))
  ) {
    sources.push(canonical.confirmed === true ? "confirmed" : "manual");
  } else if (canonicalSource === "jurisdiction_scrape") {
    sources.push("jurisdiction_scrape");
  }
  const legacyStructured = buildLegacyStructuredResolvedAddress(project);
  if (legacyStructured?.formatted && !sources.includes("manual")) {
    sources.push("manual");
  }
  if (context.jurisdictionResolved?.formatted) {
    if (!sources.includes("jurisdiction_scrape")) sources.push("jurisdiction_scrape");
  }
  if (context.utilityResolved?.formatted) {
    sources.push("utility_portal");
  }
  if (sources.length === 0) sources.push("none");
  return sources;
}

/**
 * @param {ReturnType<typeof buildResolvedAddress>} selected
 * @param {object} context
 */
function finalizeAddressResolution(selected, context) {
  const canonicalFormatted = context.canonical
    ? trimStr(context.canonical.formatted) || trimStr(context.canonical.address)
    : "";
  const jurisdictionFormatted = context.jurisdictionResolved?.formatted ?? null;
  const utilityFormatted = context.utilityResolved?.formatted ?? null;

  const mismatchPairs = [];
  if (
    canonicalFormatted &&
    jurisdictionFormatted &&
    normalizeComparableAddress(canonicalFormatted) !==
      normalizeComparableAddress(jurisdictionFormatted)
  ) {
    mismatchPairs.push("canonical_vs_jurisdiction_scrape");
  }
  if (
    selected.formatted &&
    utilityFormatted &&
    selected.source !== "utility_portal" &&
    normalizeComparableAddress(selected.formatted) !== normalizeComparableAddress(utilityFormatted)
  ) {
    mismatchPairs.push("canonical_vs_utility_portal");
  }

  return {
    address: selected,
    address_source: selected.source,
    available_sources: buildAvailableAddressSources(context, context.project),
    jurisdiction_scrape_location: jurisdictionFormatted,
    utility_portal_location: utilityFormatted,
    canonical_record: context.canonical,
    address_mismatch: mismatchPairs.length > 0,
    mismatch_reasons: mismatchPairs,
    mismatch_warning:
      mismatchPairs.length > 0
        ? "Project address sources differ between canonical, jurisdiction scrape, and utility portal values."
        : null,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} existingProject
 * @param {string | null | undefined} scrapeLocation
 * @param {object} scrapeMeta
 * @param {string | null | undefined} scrapeMeta.sourcePortal
 * @param {string | null | undefined} scrapeMeta.scrapedAt
 */
function buildCanonicalAddressUpdatesForScrape(existingProject, scrapeLocation, scrapeMeta) {
  const location = trimStr(scrapeLocation);
  if (!location) {
    return { portalDataPatch: null, projectPatch: null, canonicalAddress: null };
  }

  const existingCanonical = readCanonicalAddressRecord(existingProject);
  const existingSource = existingCanonical ? trimStr(existingCanonical.source) : "";
  const protectedExisting =
    existingCanonical &&
    (existingCanonical.confirmed === true || isProtectedCanonicalSource(existingSource));

  if (protectedExisting) {
    const existingFormatted =
      trimStr(existingCanonical.formatted) || trimStr(existingCanonical.address) || "";
    const mismatch =
      existingFormatted &&
      normalizeComparableAddress(existingFormatted) !== normalizeComparableAddress(location);
    const nextCanonical = {
      ...existingCanonical,
      scrape_candidate: {
        formatted: location,
        source_field: "portal_data.location",
        source_portal: scrapeMeta.sourcePortal ?? null,
        source_timestamp: scrapeMeta.scrapedAt ?? new Date().toISOString(),
      },
      mismatch_with_scrape: mismatch,
      mismatch_note: mismatch
        ? "Latest jurisdiction scrape location differs from protected canonical project address"
        : null,
    };
    return {
      portalDataPatch: { [CANONICAL_ADDRESS_KEY]: nextCanonical },
      projectPatch: null,
      canonicalAddress: nextCanonical,
    };
  }

  const shouldRefresh =
    !existingCanonical ||
    !trimStr(existingCanonical.formatted) ||
    existingSource === "jurisdiction_scrape" ||
    existingSource === "" ||
    existingSource === "none";

  if (!shouldRefresh) {
    return { portalDataPatch: null, projectPatch: null, canonicalAddress: existingCanonical };
  }

  const canonicalAddress = {
    formatted: location,
    address: location,
    city: null,
    state: null,
    zip_code: null,
    jurisdiction: trimStr(existingProject?.jurisdiction) || null,
    source: "jurisdiction_scrape",
    source_field: "portal_data.location",
    source_portal: scrapeMeta.sourcePortal ?? null,
    source_timestamp: scrapeMeta.scrapedAt ?? new Date().toISOString(),
    confirmed: false,
    confirmed_at: null,
    confirmed_by: null,
    selection_reason: existingProject
      ? "Refreshed canonical address from jurisdiction re-scrape"
      : "Populated canonical address from jurisdiction scrape",
    mismatch_with_scrape: false,
    mismatch_note: null,
    scrape_candidate: {
      formatted: location,
      source_field: "portal_data.location",
      source_portal: scrapeMeta.sourcePortal ?? null,
      source_timestamp: scrapeMeta.scrapedAt ?? new Date().toISOString(),
    },
  };

  return {
    portalDataPatch: { [CANONICAL_ADDRESS_KEY]: canonicalAddress },
    projectPatch: { address: location },
    canonicalAddress,
  };
}

/**
 * @param {Record<string, unknown>} portalData
 * @param {Record<string, unknown> | null} permitPilotPatch
 * @returns {Record<string, unknown>}
 */
function mergePermitPilotMetaIntoPortalData(portalData, permitPilotPatch) {
  const base = { ...portalData };
  const existingMeta = readPermitPilotMeta(base) ?? {};
  const nextMeta = {
    ...existingMeta,
    ...permitPilotPatch,
  };
  base[PERMITPILOT_META_KEY] = nextMeta;
  return base;
}

/**
 * @param {Record<string, unknown> | null | undefined} existingPortalData
 * @param {Record<string, unknown>} incomingPortalData
 * @returns {Record<string, unknown>}
 */
function preservePermitPilotMetaOnPortalMerge(existingPortalData, incomingPortalData) {
  const existingMeta = readPermitPilotMeta(existingPortalData);
  if (!existingMeta || incomingPortalData[PERMITPILOT_META_KEY]) {
    return incomingPortalData;
  }
  return mergePermitPilotMetaIntoPortalData(incomingPortalData, existingMeta);
}

/**
 * @param {Record<string, unknown> | null | undefined} existingProject
 * @param {Record<string, unknown>} portalDataPayload
 * @param {object} scrapeMeta
 */
function applyScrapeCanonicalAddressToPortalData(existingProject, portalDataPayload, scrapeMeta) {
  const scrapeLocation = trimStr(portalDataPayload.location);
  const { portalDataPatch, projectPatch } = buildCanonicalAddressUpdatesForScrape(
    existingProject,
    scrapeLocation,
    scrapeMeta,
  );
  if (!portalDataPatch) {
    return { portalData: portalDataPayload, projectPatch: null };
  }
  const portalData = mergePermitPilotMetaIntoPortalData(portalDataPayload, portalDataPatch);
  return { portalData, projectPatch };
}

/**
 * @param {Record<string, unknown>} projectFields
 * @param {string | null | undefined} userId
 */
function buildManualCanonicalAddressFromProjectFields(projectFields, userId) {
  const parts = buildStructuredAddressParts(projectFields);
  const formatted = formatAddressParts(parts);
  if (!formatted) return null;
  return {
    formatted,
    address: parts.address,
    city: parts.city,
    state: parts.state,
    zip_code: parts.zip_code,
    jurisdiction: parts.jurisdiction,
    source: "manual",
    source_field: "projects.address",
    source_portal: null,
    source_timestamp: new Date().toISOString(),
    confirmed: false,
    confirmed_at: null,
    confirmed_by: userId ?? null,
    selection_reason: "Manual project address edit",
    mismatch_with_scrape: false,
    mismatch_note: null,
  };
}

/**
 * Map canonical sources to legacy UCI provider-setup source ids.
 * @param {CanonicalAddressSource | string} source
 */
function toLegacyUciAddressSource(source) {
  const normalized = trimStr(source).toLowerCase();
  if (normalized === "jurisdiction_scrape") return "portal_data_location";
  if (normalized === "utility_portal") return "utility_portal";
  if (normalized === "manual" || normalized === "confirmed") return "structured";
  if (normalized === "none") return "none";
  return normalized || "none";
}

module.exports = {
  PERMITPILOT_META_KEY,
  CANONICAL_ADDRESS_KEY,
  trimStr,
  normalizeComparableAddress,
  normalizePortalDataObject,
  readCanonicalAddressRecord,
  isProtectedCanonicalSource,
  extractPortalDataLocation,
  buildStructuredAddressParts,
  formatAddressParts,
  buildResolvedAddress,
  buildJurisdictionScrapeResolvedAddress,
  buildUtilityPortalResolvedAddress,
  extractUtilityApplicationAddressFromCoordinationRecord,
  resolveAndNormalizeProjectAddress,
  buildCanonicalAddressUpdatesForScrape,
  mergePermitPilotMetaIntoPortalData,
  preservePermitPilotMetaOnPortalMerge,
  applyScrapeCanonicalAddressToPortalData,
  buildManualCanonicalAddressFromProjectFields,
  toLegacyUciAddressSource,
};
