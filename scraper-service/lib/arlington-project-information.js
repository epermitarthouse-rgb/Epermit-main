"use strict";

/**
 * Recognized Arlington revision / renewal suffixes on permit / project IDs.
 * Examples: CTBO24-02589-RA1, CNEW24-00737-RA2, LDAP23-00156-REN1
 */
const ARLINGTON_REVISION_SUFFIX_RE = /-(?:RA|REN|RB)\d+$/i;

/**
 * Strip recognized trailing revision/renewal suffixes for base-ID comparison.
 * @param {string} recordNumber
 * @returns {string}
 */
function normalizeArlingtonBaseProjectId(recordNumber) {
  const raw = `${recordNumber ?? ""}`.trim();
  if (!raw) return "";
  return raw.replace(ARLINGTON_REVISION_SUFFIX_RE, "").trim();
}

/**
 * True when permit number and portal Project ID refer to the same Arlington record.
 * @param {string} permitNumber
 * @param {string} projectId
 */
function arlingtonProjectIdsMatch(permitNumber, projectId) {
  const permit = `${permitNumber ?? ""}`.trim();
  const pid = `${projectId ?? ""}`.trim();
  if (!pid) return false;
  if (!permit) return pid !== "0" && /[A-Za-z0-9-]/.test(pid);
  if (pid.toUpperCase() === permit.toUpperCase()) return true;
  const permitBase = normalizeArlingtonBaseProjectId(permit);
  const pidBase = normalizeArlingtonBaseProjectId(pid);
  if (!permitBase || !pidBase) return false;
  return permitBase.toUpperCase() === pidBase.toUpperCase();
}

/** Tab-nav-only shell: labels without actual PI field copy. */
function arlingtonProjectInformationPreviewLooksLikeTabShellOnly(preview) {
  const t = `${preview ?? ""}`.trim().replace(/\s+/g, " ");
  if (!t) return false;
  if (/Project\s+ID/i.test(t)) return false;
  if (
    /Plans\s*&\s*Documents/i.test(t) &&
    /Review Results/i.test(t) &&
    /Project Information/i.test(t) &&
    t.length < 220
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} url
 */
function arlingtonProjectInformationUrlIsOuterShell(url) {
  const u = `${url || ""}`;
  return (
    /\/Plan\/ProjectInformation(?:\?|$|#)/i.test(u) &&
    !/\/GetUnityForm\//i.test(u)
  );
}

/**
 * @param {string} url
 */
function arlingtonProjectInformationUrlIsUnityForm(url) {
  const u = `${url || ""}`;
  return /\/GetUnityForm\//i.test(u) && /readOnly=true/i.test(u);
}

/**
 * Browser-evaluated frame diagnostics (also built in unit tests).
 * @param {Record<string, unknown>} raw
 */
function normalizeArlingtonProjectInformationFrameDiag(raw) {
  const url = `${raw?.url || ""}`;
  const preview = `${raw?.preview || ""}`;
  const bodyLen = Number(raw?.bodyLen) || 0;
  const inputCount = Number(raw?.inputCount) || 0;
  const filledInputCount = Number(raw?.filledInputCount) || 0;
  const hasProjectLabels = raw?.hasProjectLabels === true;
  const hasProjectValues = raw?.hasProjectValues === true;
  const isOuterShellUrl = arlingtonProjectInformationUrlIsOuterShell(url);
  const isUnityFormUrl = arlingtonProjectInformationUrlIsUnityForm(url);
  const hasUnityFormPath = /\/GetUnityForm\//i.test(url);
  const readOnlyQuery = /readOnly=true/i.test(url);

  let likelyThinShell = raw?.likelyThinShell === true;
  if (!likelyThinShell) {
    if (isOuterShellUrl && (bodyLen < 200 || filledInputCount < 1)) {
      likelyThinShell = true;
    } else if (
      isOuterShellUrl &&
      hasProjectLabels &&
      filledInputCount < 1
    ) {
      likelyThinShell = true;
    } else if (
      inputCount <= 24 &&
      filledInputCount < 1 &&
      isOuterShellUrl
    ) {
      likelyThinShell = true;
    } else if (
      arlingtonProjectInformationPreviewLooksLikeTabShellOnly(preview)
    ) {
      likelyThinShell = true;
    }
  }

  return {
    url,
    preview,
    bodyLen,
    inputCount,
    filledInputCount,
    hasProjectLabels,
    hasProjectValues,
    isOuterShellUrl,
    isUnityFormUrl,
    hasUnityFormPath,
    readOnlyQuery,
    likelyThinShell,
    nonEmptyExpectedFieldCount: Number(raw?.nonEmptyExpectedFieldCount) || 0,
    extractedProjectId: `${raw?.extractedProjectId || ""}`.trim(),
  };
}

/**
 * Rank Project Information iframe candidates; prefer UnityForm readOnly over tab shell.
 * @param {Record<string, unknown> | null | undefined} diagIn
 * @param {string} [permitHint]
 * @returns {{ score: number; reason: string }}
 */
function scoreArlingtonProjectInformationFrameCandidate(diagIn, permitHint) {
  const diag = normalizeArlingtonProjectInformationFrameDiag(diagIn || {});
  if (!diagIn || typeof diagIn !== "object") {
    return { score: -9999, reason: "no-diag" };
  }

  let score = 0;
  /** @type {string[]} */
  const reasons = [];
  const permit = `${permitHint || ""}`.trim();
  const permitBase = normalizeArlingtonBaseProjectId(permit);

  if (diag.likelyThinShell) {
    score -= 1200;
    reasons.push("likelyThinShell");
  }

  if (diag.isUnityFormUrl && !diag.likelyThinShell) {
    score += 600;
    reasons.push("unityFormReadOnly");
  } else if (diag.hasUnityFormPath && diag.readOnlyQuery) {
    score += 450;
    reasons.push("unityFormPath");
  }

  if (diag.isOuterShellUrl) {
    if (diag.bodyLen < 200 || diag.filledInputCount < 1) {
      score -= 900;
      reasons.push("projectInformationShell");
    }
    if (diag.hasProjectLabels && diag.filledInputCount < 1) {
      score -= 400;
      reasons.push("shellLabelsNoValues");
    }
  }

  if (permit && diag.preview.includes(permit)) {
    score += 200;
    reasons.push("permitMatch");
  } else if (permitBase && diag.preview.includes(permitBase)) {
    score += 180;
    reasons.push("basePermitMatch");
  }

  if (diag.extractedProjectId && permit) {
    if (arlingtonProjectIdsMatch(permit, diag.extractedProjectId)) {
      score += 160;
      reasons.push("extractedProjectIdMatch");
    }
  }

  if (/\b\d{2}REC-\d+-\w+/i.test(diag.preview)) {
    score += 150;
    reasons.push("capIdInPreview");
  }

  if (diag.hasProjectValues) {
    score += 120;
    reasons.push("hasProjectValues");
  }

  if (diag.hasProjectLabels && /Project\s+ID/i.test(diag.preview)) {
    score += 80;
    reasons.push("projectIdLabelInPreview");
  }

  if (diag.filledInputCount > 0) {
    score += diag.filledInputCount * 20;
    reasons.push(`filledInputs=${diag.filledInputCount}`);
  }

  if (diag.nonEmptyExpectedFieldCount >= 3) {
    score += 100;
    reasons.push(`expectedFields=${diag.nonEmptyExpectedFieldCount}`);
  }

  if (diag.inputCount >= 4 && diag.inputCount <= 24) {
    score += 40;
    reasons.push("expectedInputCount");
  }

  if (diag.bodyLen >= 200) {
    score += 30;
    reasons.push("substantialBody");
  } else if (diag.bodyLen < 120) {
    score -= 120;
    reasons.push("shortBody");
  }

  return { score, reason: reasons.join(",") || "baseline" };
}

/**
 * Pick best frame candidate from ranked diagnostics (unit-testable).
 * @param {{ diag: Record<string, unknown> | null; score: number; reason: string }[]} ranked
 * @returns {{ index: number; reason: string } | null}
 */
function selectArlingtonProjectInformationFrameFromRanked(ranked) {
  if (!Array.isArray(ranked) || ranked.length === 0) return null;

  const best = ranked[0];
  if (
    best &&
    best.score > -500 &&
    best.diag &&
    best.diag.likelyThinShell !== true &&
    (Number(best.diag.filledInputCount) > 0 ||
      best.diag.isUnityFormUrl === true ||
      Number(best.diag.nonEmptyExpectedFieldCount) >= 1)
  ) {
    return { index: 0, reason: best.reason || "bestScore" };
  }

  const valuePickIx = ranked.findIndex(
    (x) =>
      x.diag &&
      x.diag.likelyThinShell !== true &&
      (x.diag.hasProjectValues === true ||
        Number(x.diag.filledInputCount) > 0 ||
        x.diag.isUnityFormUrl === true),
  );
  if (valuePickIx >= 0) {
    return {
      index: valuePickIx,
      reason: `fallbackHasProjectValues,${ranked[valuePickIx].reason || ""}`,
    };
  }

  return null;
}

/** Detect Project Group / address dropdown option strings (not PI form values). */
function arlingtonProjectInformationValueLooksLikeAddressDropdownList(value) {
  const v = `${value ?? ""}`.trim().replace(/\s+/g, " ");
  if (!v) return false;
  if (/^<none>/i.test(v)) return true;
  if (
    /\b40 N GLEBE RD\b/i.test(v) &&
    (/\b4500 31ST ST S\b/i.test(v) || /\b4505 31ST ST S\b/i.test(v))
  ) {
    return true;
  }
  if (
    /\b4500 31ST ST S\b/i.test(v) &&
    /\b4505 31ST ST S\b/i.test(v) &&
    /\b4834 LANGSTON BLVD\b/i.test(v)
  ) {
    return true;
  }
  const streets =
    v.match(/\b\d{3,5}\s+[A-Z0-9 .]+(?:ST|AVE|BLVD|RD|DR|LN|WAY|CT|PL)\b/gi) ||
    [];
  return streets.length >= 2 && v.length > 40;
}

/** @param {string} label @param {string} value */
function arlingtonProjectInformationFieldValueIsRejected(label, value) {
  const v = `${value ?? ""}`.trim();
  if (!v) return false;
  const low = v.toLowerCase();
  if (/^<none>/i.test(v)) return true;
  if (arlingtonProjectInformationValueLooksLikeAddressDropdownList(v)) return true;
  if (label === "Project ID" && (v === "0" || !/[A-Za-z0-9-]/.test(v))) {
    return true;
  }
  if (
    (label === "Review Type" || label === "Accela CAP ID") &&
    /\b40 n glebe rd\b/i.test(low)
  ) {
    return true;
  }
  if (
    (label === "Review Type" || label === "Accela CAP ID") &&
    /\b4500 31st st\b/i.test(low)
  ) {
    return true;
  }
  if (
    label === "Review Type" &&
    !/^\d{1,6}$/.test(v) &&
    /\b(st|ave|blvd|rd|dr)\b/i.test(v)
  ) {
    return true;
  }
  if (
    label === "Accela CAP ID" &&
    v &&
    !/\d{2}REC-\d+-\w+/i.test(v) &&
    v.length < 10
  ) {
    return true;
  }
  if (
    (label === "Plan Review Project Name" || label === "Address") &&
    /^<none>\s+\d/i.test(v)
  ) {
    return true;
  }
  return false;
}

/** @param {{ label: string; value: string }[]} fields @param {string} [permitNumber] */
function arlingtonProjectInformationExtractionIsWeak(fields, permitNumber) {
  if (!Array.isArray(fields) || fields.length === 0) return true;
  const get = (label) => {
    const f = fields.find((x) => `${x.label || ""}`.trim() === label);
    return `${f?.value ?? ""}`.trim();
  };
  for (const label of [
    "Project ID",
    "Plan Review Project Name",
    "Accela CAP ID",
    "Address",
    "Review Type",
  ]) {
    if (arlingtonProjectInformationFieldValueIsRejected(label, get(label))) {
      return true;
    }
  }

  const permit = `${permitNumber || ""}`.trim();
  const pid = get("Project ID");
  if (permit) {
    if (!pid || !arlingtonProjectIdsMatch(permit, pid)) return true;
  } else if (pid === "0" || !pid) {
    return true;
  }

  let strongFields = 0;
  const cap = get("Accela CAP ID");
  const name = get("Plan Review Project Name");
  const addr = get("Address");
  const reviewType = get("Review Type");

  if (pid && permit && arlingtonProjectIdsMatch(permit, pid)) strongFields++;
  else if (pid && /^[A-Z]{2,6}\d{2}-\d+/i.test(pid)) strongFields++;
  if (cap && /\d{2}REC-\d+-\w+/i.test(cap)) strongFields++;
  if (name && /LANGSTON/i.test(name) && name.length >= 8) strongFields++;
  if (addr && /LANGSTON/i.test(addr) && addr.length >= 8) strongFields++;
  if (reviewType && /^\d{1,6}$/.test(reviewType)) strongFields++;
  if (name && name.length >= 8) strongFields++;
  if (addr && addr.length >= 8) strongFields++;

  return strongFields < 2;
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {string} [requestedPermit]
 */
function arlingtonProjectInformationUnityTextExtractionIsValid(
  parsed,
  requestedPermit,
) {
  if (!parsed || typeof parsed !== "object") return false;
  const permit = `${requestedPermit || ""}`.trim();
  const pid = `${parsed.projectId || ""}`.trim();
  if (pid === "0") return false;
  if (permit) {
    if (!pid || !arlingtonProjectIdsMatch(permit, pid)) return false;
  } else if (!pid) {
    return false;
  }

  for (const v of [
    parsed.projectId,
    parsed.accelaCapId,
    parsed.reviewType,
    parsed.planReviewProjectName,
    parsed.address,
    parsed.cphdCase,
  ]) {
    const s = `${v ?? ""}`.trim();
    if (!s) continue;
    if (/^<none>/i.test(s)) return false;
    if (arlingtonProjectInformationValueLooksLikeAddressDropdownList(s)) {
      return false;
    }
  }

  const cap = `${parsed.accelaCapId || ""}`.trim();
  const addr = `${parsed.address || ""}`.trim();
  const name = `${parsed.planReviewProjectName || ""}`.trim();
  return !!(cap || addr || name);
}

const ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND =
  "project_information_unity_frame_not_found";

module.exports = {
  ARLINGTON_REVISION_SUFFIX_RE,
  ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND,
  normalizeArlingtonBaseProjectId,
  arlingtonProjectIdsMatch,
  arlingtonProjectInformationPreviewLooksLikeTabShellOnly,
  arlingtonProjectInformationUrlIsOuterShell,
  arlingtonProjectInformationUrlIsUnityForm,
  normalizeArlingtonProjectInformationFrameDiag,
  scoreArlingtonProjectInformationFrameCandidate,
  selectArlingtonProjectInformationFrameFromRanked,
  arlingtonProjectInformationValueLooksLikeAddressDropdownList,
  arlingtonProjectInformationFieldValueIsRejected,
  arlingtonProjectInformationExtractionIsWeak,
  arlingtonProjectInformationUnityTextExtractionIsValid,
};
