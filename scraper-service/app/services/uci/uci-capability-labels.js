"use strict";

/**
 * User-facing UCI capability / package labels (backend).
 * Mirrors src/lib/uciCapabilityLabels.ts — keep in sync.
 * Internal agent_* / agent-N-* IDs stay in storage; translate before display/email.
 */

const CAPABILITY_BY_NUM = {
  "1": "Utility Provider Mapper",
  "2": "Load Profile Analyzer",
  "3": "Application Builder",
  "4": "Submission and Confirmation Tracker",
};

const UCI_CAPABILITY_STAGE_LABELS = {
  agent_1_provider_mapper: "Utility Provider Mapper",
  agent_1_utility_provider: "Utility Provider Mapper",
  agent_1_provider_resolution: "Utility Provider Mapper",
  agent_2_load_profile: "Load Profile Analyzer",
  agent_3_application_package: "Application Builder",
  agent_4_submission: "Submission and Confirmation Tracker",
};

function titleWords(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Translate Agent N / agent_N_* / bare stage ids for operator UI / outbound text. */
function formatUciCapabilityLabel(raw) {
  if (raw == null || !String(raw).trim()) return "—";
  const s = String(raw).trim();

  const numbered = s.match(/^agents?\s*[-_]?\s*(\d+)$/i);
  if (numbered) {
    return CAPABILITY_BY_NUM[numbered[1]] ?? `Capability ${numbered[1]}`;
  }

  const normalized = s.replace(/-/g, "_");
  if (UCI_CAPABILITY_STAGE_LABELS[normalized]) {
    return UCI_CAPABILITY_STAGE_LABELS[normalized];
  }
  if (UCI_CAPABILITY_STAGE_LABELS[s]) {
    return UCI_CAPABILITY_STAGE_LABELS[s];
  }

  const prefix = normalized.match(/^agent_(\d+)(?:_|$)/i);
  if (prefix && CAPABILITY_BY_NUM[prefix[1]]) {
    return CAPABILITY_BY_NUM[prefix[1]];
  }

  return titleWords(s);
}

/**
 * e.g. agent-3-reviewed-package-snapshot-v1
 *   → Application Builder · Reviewed package v1
 */
function formatUciPackageVersionLabel(raw) {
  if (raw == null || !String(raw).trim()) {
    return "Application Builder · Reviewed package";
  }
  const s = String(raw).trim();

  const reviewed = s.match(
    /^agent[-_]?(\d+)[-_]?reviewed[-_]?package(?:[-_]?snapshot)?[-_]?v?(\d+)$/i,
  );
  if (reviewed) {
    const capability =
      CAPABILITY_BY_NUM[reviewed[1]] ?? formatUciCapabilityLabel(`agent_${reviewed[1]}`);
    return `${capability} · Reviewed package v${reviewed[2]}`;
  }

  const agentPrefixed = s.match(/^agent[-_]?(\d+)[-_](.+)$/i);
  if (agentPrefixed) {
    const capability =
      CAPABILITY_BY_NUM[agentPrefixed[1]] ??
      formatUciCapabilityLabel(`agent_${agentPrefixed[1]}`);
    const rest = titleWords(agentPrefixed[2].replace(/\bsnapshot\b/gi, "")).replace(
      /\s+V(\d+)\b/g,
      " v$1",
    );
    return `${capability} · ${rest || "Package"}`;
  }

  return titleWords(s);
}

module.exports = {
  CAPABILITY_BY_NUM,
  UCI_CAPABILITY_STAGE_LABELS,
  formatUciCapabilityLabel,
  formatUciPackageVersionLabel,
};
