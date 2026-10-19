"use strict";

const {
  bundledAuthoritativeProvisions,
} = require("./jurisdictionEditionRegistry.js");

/**
 * Review policy remains separate from authoritative code text. Verified,
 * permitted excerpts are loaded through the jurisdiction/edition registry and
 * deterministically filtered before topic matching.
 */
const CODE_PROVISIONS = [
  {
    id: "egress-width-sheet-applicability",
    version: "2026-10-19",
    codeBook: null,
    edition: null,
    jurisdiction: "any",
    section: null,
    requirement:
      "Corridor and exit-access width is reviewed on architectural floor plans and egress plans. An equipment plan does not establish a corridor width that is not drawn on that sheet.",
    applicability: "floor_plan, egress_plan",
    exceptions: ["A dimension string is actually present on the sheet being reviewed."],
    requiredEvidence: ["dimension quote on the applicable sheet"],
    elementTypes: ["corridor", "exit_access"],
    sourceStatus: "review_policy",
    authoritative: false,
    topics: ["corridor", "width", "egress", "exit access"],
  },
  {
    id: "fire-rating-tag-on-plan",
    version: "2026-10-19",
    codeBook: null,
    edition: null,
    jurisdiction: "any",
    section: null,
    requirement:
      "A missing fire-rating claim is not confirmed when a partition tag, legend, schedule, or section in the set already states the rating.",
    applicability: "architectural plans, legends, sections, schedules",
    exceptions: [],
    requiredEvidence: ["hour or minute rating quote"],
    elementTypes: ["fire_rated_partition"],
    sourceStatus: "review_policy",
    authoritative: false,
    topics: ["fire rating", "partition", "1 hr", "1-hour", "legend"],
  },
  {
    id: "emergency-lighting-note",
    version: "2026-10-19",
    codeBook: null,
    edition: null,
    jurisdiction: "any",
    section: null,
    requirement:
      "Emergency-lighting notes already present on the electrical sheet are evidence. They are not, by themselves, proof the requirement is satisfied, and they block a missing-note allegation.",
    applicability: "electrical lighting sheets",
    exceptions: [],
    requiredEvidence: ["emergency lighting note quote"],
    elementTypes: ["emergency_lighting"],
    sourceStatus: "review_policy",
    authoritative: false,
    topics: ["emergency lighting", "emergency light"],
  },
  {
    id: "plumbing-note-already-specified",
    version: "2026-10-19",
    codeBook: null,
    edition: null,
    jurisdiction: "any",
    section: null,
    requirement:
      "A plumbing note that already specifies the item, including a water-hammer arrester, is not republished as a violation.",
    applicability: "plumbing sheets, schedules, details",
    exceptions: [],
    requiredEvidence: ["note quote on the plumbing sheet"],
    elementTypes: ["water_hammer_arrester", "plumbing_fixture"],
    sourceStatus: "review_policy",
    authoritative: false,
    topics: ["water hammer", "plumbing", "arrester"],
  },
];

/**
 * @param {{
 *   topics?: string[];
 *   jurisdiction?: string | null;
 *   edition?: string | null;
 *   registryRecordId?: string | null;
 *   effectiveOn?: string | null;
 *   authoritativeOnly?: boolean;
 *   provisions?: Array<Record<string, unknown>>;
 * }} query
 */
function provisionIsVerified(provision) {
  return Boolean(
    provision
    && provision.authoritative === true
    && provision.sourceStatus === "verified_text"
    && provision.section
    && String(provision.text || "").trim().length >= 12
  );
}

function retrieveCodeProvisions(query) {
  const topics = (query.topics || []).map((topic) => topic.toLowerCase());
  const bundled = bundledAuthoritativeProvisions({
    jurisdiction: query.jurisdiction,
    selectedEdition: query.edition,
    registryRecordId: query.registryRecordId,
  });
  const source = [
    ...new Map(
      [
        ...CODE_PROVISIONS,
        ...bundled,
        ...(Array.isArray(query.provisions) ? query.provisions : []),
      ].map((item) => [item.id, item]),
    ).values(),
  ];
  const hits = [];
  for (const provision of source) {
    const verified = provisionIsVerified(provision);
    if (query.authoritativeOnly && !verified) continue;
    const jurisdiction = provision.jurisdiction || "any";
    if (jurisdiction !== "any" && query.jurisdiction && jurisdiction !== query.jurisdiction) {
      continue;
    }
    if (query.edition && provision.edition &&
        provision.edition !== query.edition &&
        provision.baseCodeEdition !== query.edition &&
        provision.jurisdictionCodeEdition !== query.edition) {
      continue;
    }
    if (query.registryRecordId && provision.registryRecordId &&
        provision.registryRecordId !== query.registryRecordId) {
      continue;
    }
    if (query.effectiveOn && provision.applicability?.effectiveFrom &&
        query.effectiveOn < provision.applicability.effectiveFrom) {
      continue;
    }
    const provisionTopics = Array.isArray(provision.topics) ? provision.topics : [];
    const matched = topics.filter((topic) =>
      provisionTopics.some((item) => item.includes(topic) || topic.includes(item)),
    );
    if (topics.length && provisionTopics.length && !matched.length) continue;
    if (topics.length && !provisionTopics.length && !verified) continue;
    hits.push({
      sourceType: "code",
      id: provision.id,
      version: provision.version,
      codeBook: provision.codeBook,
      edition: provision.edition,
      jurisdiction: provision.jurisdiction,
      section: verified ? provision.section : null,
      quote: provision.text || provision.requirement,
      text: provision.text || provision.requirement,
      heading: provision.heading || null,
      provisionType: provision.provisionType || "review_policy",
      applicability: provision.applicability,
      exceptions: provision.exceptions,
      thresholds: provision.thresholds || [],
      requiredEvidence: provision.requiredEvidence,
      elementTypes: provision.elementTypes,
      sourceStatus: verified ? "verified_text" : (provision.sourceStatus || "unverified"),
      authoritative: verified,
      supportsConfirmedViolation: Boolean(verified && provision.supportsConfirmedViolation === true),
      sourceUrl: provision.sourceUrl || null,
      sourceLocator: provision.sourceLocator || null,
      verificationDate: provision.verificationDate || null,
      licenseStatus: provision.licenseStatus || null,
      registryRecordId: provision.registryRecordId || null,
      provesRequirementSatisfied: false,
      provenance: {
        method: "code-library",
        sourceStatus: provision.sourceStatus,
        sourceUrl: provision.sourceUrl || null,
        sourceLocator: provision.sourceLocator || null,
        verificationDate: provision.verificationDate || null,
        licenseStatus: provision.licenseStatus || null,
        note: verified
          ? "Retrieved from verified code text."
          : "Review policy or unverified summary. Not authoritative code text.",
      },
    });
  }
  const locallyAmendedSections = new Set(
    hits
      .filter((hit) => hit.jurisdiction && hit.jurisdiction !== "any" && hit.section)
      .map((hit) => `${hit.codeBook || ""}:${hit.section}`),
  );
  const amendedSectionNumbers = new Set(
    hits
      .filter((hit) => hit.jurisdiction && hit.jurisdiction !== "any" && hit.section)
      .map((hit) => hit.section),
  );
  return hits.filter((hit) => {
    if (hit.jurisdiction !== "any" || !hit.section) return true;
    if (locallyAmendedSections.has(`${hit.codeBook || ""}:${hit.section}`)) return false;
    return !amendedSectionNumbers.has(hit.section);
  });
}

module.exports = {
  CODE_PROVISIONS,
  retrieveCodeProvisions,
  provisionIsVerified,
};
