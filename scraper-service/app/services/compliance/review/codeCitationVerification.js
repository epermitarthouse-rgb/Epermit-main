"use strict";

const {
  citationMatchesProvision,
  classifyRequirement,
  compareRequirementToFacts,
  isEnforceable,
} = require("../rag/technicalCorpus.js");

function citationMatches(issue, provision) {
  return citationMatchesProvision(
    `${issue?.codeReference || ""} ${issue?.citationBook || ""}`,
    provision,
  );
}

function thresholdMatches(issue, provision, measureTokens) {
  const claimTokens = measureTokens(`${issue.title || ""} ${issue.description || ""}`);
  if (!claimTokens.length) return false;
  const provisionText = String(provision.text || provision.quote || "").toLowerCase().replace(/[^a-z0-9.]+/g, "");
  return claimTokens.some((token) => {
    const number = String(token).match(/\d+(?:\.\d+)?/)?.[0];
    return Boolean(number && provisionText.includes(number));
  });
}

/**
 * A citation supports a requirement-level decision only when the stored
 * provision is licensed text, the edition and applicability fit, exceptions
 * are resolved, and a bound drawing fact agrees or disagrees with the
 * structured threshold. A locator is not that text.
 */
function verifyAuthoritativeCitation(issue, ctx, measureTokens) {
  const legal = ctx.legalApplicability || null;
  if (!legal || legal.status !== "verified" || legal.reviewScope !== "permit_compliance") {
    return { verified: false, reason: "governing_code_unverified", provision: null, coverageClass: "missing_coverage" };
  }

  const classified = classifyRequirement(issue, ctx);
  const coverageClass = classified.coverageClass;
  if (coverageClass !== "verified_requirement" || !isEnforceable(classified.provision)) {
    return {
      verified: false,
      reason: coverageClass === "verified_requirement" ? "authoritative_citation_not_found" : coverageClass,
      provision: classified.provision || null,
      locator: classified.locator || null,
      coverageClass,
    };
  }

  const cited = classified.provision;
  if (issue.applicabilityVerified === false) {
    return { verified: false, reason: "provision_applicability_unresolved", provision: cited, coverageClass };
  }
  const comparison = compareRequirementToFacts(cited, ctx, issue, ctx.claim || null);
  if (comparison.outcome === "violation") {
    return { verified: true, reason: "verified_technical_comparison", provision: cited, coverageClass, comparison };
  }
  if (comparison.outcome === "compliant") {
    return { verified: false, reason: "requirement_met", provision: cited, coverageClass, comparison };
  }
  if (comparison.outcome === "insufficient_drawing_evidence") {
    return { verified: false, reason: "insufficient_drawing_evidence", provision: cited, coverageClass, comparison };
  }
  if (comparison.outcome === "exceptions_unresolved") {
    return { verified: false, reason: "code_exceptions_unresolved", provision: cited, coverageClass, comparison };
  }
  if (comparison.outcome === "not_applicable") {
    return { verified: false, reason: "provision_applicability_unresolved", provision: cited, coverageClass, comparison };
  }
  if (!thresholdMatches(issue, cited, measureTokens)) {
    return { verified: false, reason: "authoritative_threshold_not_matched", provision: cited, coverageClass };
  }
  return { verified: true, reason: "verified_authoritative_citation", provision: cited, coverageClass, comparison };
}

module.exports = {
  citationMatches,
  verifyAuthoritativeCitation,
};
