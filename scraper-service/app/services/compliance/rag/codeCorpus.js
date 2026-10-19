"use strict";

/**
 * Authoritative code text is empty on purpose.
 * This repository does not contain verified IBC or DCMR section text.
 * Amendment summaries that already live in analyze-drawing.service.js are
 * indexed only as unverified summaries and cannot support a confirmed violation.
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
 * @param {{ topics?: string[]; jurisdiction?: string | null; authoritativeOnly?: boolean }} query
 */
function retrieveCodeProvisions(query) {
  const topics = (query.topics || []).map((topic) => topic.toLowerCase());
  const hits = [];
  for (const provision of CODE_PROVISIONS) {
    if (query.authoritativeOnly && !provision.authoritative) continue;
    if (provision.jurisdiction !== "any" && query.jurisdiction && provision.jurisdiction !== query.jurisdiction) {
      continue;
    }
    const matched = topics.filter((topic) =>
      provision.topics.some((item) => item.includes(topic) || topic.includes(item)),
    );
    if (topics.length && !matched.length) continue;
    hits.push({
      sourceType: "code",
      id: provision.id,
      version: provision.version,
      codeBook: provision.codeBook,
      edition: provision.edition,
      jurisdiction: provision.jurisdiction,
      section: provision.section,
      quote: provision.requirement,
      applicability: provision.applicability,
      exceptions: provision.exceptions,
      requiredEvidence: provision.requiredEvidence,
      elementTypes: provision.elementTypes,
      sourceStatus: provision.sourceStatus,
      authoritative: provision.authoritative,
      provesRequirementSatisfied: false,
      provenance: {
        method: "code-library",
        sourceStatus: provision.sourceStatus,
        note: provision.authoritative
          ? "Retrieved from verified code text."
          : "Review policy or unverified summary. Not authoritative code text.",
      },
    });
  }
  return hits;
}

module.exports = {
  CODE_PROVISIONS,
  retrieveCodeProvisions,
};
