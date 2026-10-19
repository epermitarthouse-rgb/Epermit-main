"use strict";

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9.]+/g, "");
}

function citationMatches(issue, provision) {
  const citation = compact(`${issue.codeReference || ""} ${issue.citationBook || ""}`);
  const section = compact(provision.section);
  const book = compact(provision.codeBook);
  return Boolean(section && citation.includes(section) && (!book || citation.includes(book)));
}

function thresholdMatches(issue, provision, measureTokens) {
  const claimTokens = measureTokens(`${issue.title || ""} ${issue.description || ""}`);
  if (!claimTokens.length) return false;
  const provisionText = compact(provision.text || provision.quote);
  return claimTokens.some((token) => {
    const number = String(token).match(/\d+(?:\.\d+)?/)?.[0];
    return Boolean(number && provisionText.includes(number));
  });
}

/**
 * A citation is independently usable only when legal scope, exact source,
 * edition, citation, threshold, and exception coverage all agree.
 */
function verifyAuthoritativeCitation(issue, ctx, measureTokens) {
  const legal = ctx.legalApplicability || null;
  if (!legal || legal.status !== "verified" || legal.reviewScope !== "permit_compliance") {
    return { verified: false, reason: "governing_code_unverified", provision: null };
  }

  const provisions = Array.isArray(ctx.authoritativeCode) ? ctx.authoritativeCode : [];
  const candidates = provisions.filter((provision) =>
    provision
    && provision.authoritative === true
    && provision.sourceStatus === "verified_text"
    && provision.supportsConfirmedViolation === true
    && provision.section
    && (provision.text || provision.quote)
    && (!legal.registryRecordId || provision.registryRecordId === legal.registryRecordId),
  );
  const cited = candidates.find((provision) => citationMatches(issue, provision));
  if (!cited) return { verified: false, reason: "authoritative_citation_not_found", provision: null };
  if (!thresholdMatches(issue, cited, measureTokens)) {
    return { verified: false, reason: "authoritative_threshold_not_matched", provision: cited };
  }
  if (Array.isArray(cited.exceptions) && cited.exceptions.length > 0 && issue.exceptionsChecked !== true) {
    return { verified: false, reason: "code_exceptions_unresolved", provision: cited };
  }
  if (issue.applicabilityVerified === false) {
    return { verified: false, reason: "provision_applicability_unresolved", provision: cited };
  }
  return { verified: true, reason: "verified_authoritative_citation", provision: cited };
}

module.exports = {
  citationMatches,
  verifyAuthoritativeCitation,
};
