"use strict";

const UNSELECTED = new Set(["", "unselected", "auto", "detect", "default"]);

/**
 * "general" is an explicit General IBC selection.
 * Null, empty, and the unselected sentinels mean the user did not choose.
 * @param {unknown} value
 */
function isUnselectedJurisdiction(value) {
  if (value == null) return true;
  return UNSELECTED.has(String(value).trim().toLowerCase());
}

/**
 * @param {string} key
 * @returns {"general-ibc" | string}
 */
function selectedScopeLabel(key) {
  return key === "general" ? "general-ibc" : key;
}

/**
 * @param {{
 *   runJurisdiction?: string | null;
 *   runKey: string;
 *   projectKey: string;
 *   projectLocationKey?: string | null;
 *   detectedFromDrawing?: string | null;
 * }} input
 */
function resolveJurisdictionDecision(input) {
  const detectedFromDrawing = input.detectedFromDrawing || null;
  const projectLocationKey =
    input.projectKey && input.projectKey !== "general"
      ? input.projectKey
      : input.projectLocationKey || null;
  const detectedLocation = detectedFromDrawing || projectLocationKey || null;

  if (!isUnselectedJurisdiction(input.runJurisdiction)) {
    const enforced = input.runKey || "general";
    const differs = Boolean(detectedLocation && detectedLocation !== enforced);
    return {
      selectionSource: "explicit",
      selectedScope: selectedScopeLabel(enforced),
      enforcedJurisdiction: enforced,
      detectedLocation,
      amendmentsEnforced: enforced !== "general",
      disclosed: differs,
    };
  }

  if (input.projectKey && input.projectKey !== "general") {
    return {
      selectionSource: "project",
      selectedScope: null,
      enforcedJurisdiction: input.projectKey,
      detectedLocation: detectedFromDrawing || input.projectKey,
      amendmentsEnforced: true,
      disclosed: true,
    };
  }

  if (input.projectLocationKey) {
    return {
      selectionSource: "project",
      selectedScope: null,
      enforcedJurisdiction: input.projectLocationKey,
      detectedLocation: detectedFromDrawing || input.projectLocationKey,
      amendmentsEnforced: true,
      disclosed: true,
    };
  }

  if (detectedFromDrawing) {
    return {
      selectionSource: "detected",
      selectedScope: null,
      enforcedJurisdiction: detectedFromDrawing,
      detectedLocation: detectedFromDrawing,
      amendmentsEnforced: true,
      disclosed: true,
    };
  }

  return {
    selectionSource: "unselected",
    selectedScope: null,
    enforcedJurisdiction: "general",
    detectedLocation: null,
    amendmentsEnforced: false,
    disclosed: false,
  };
}

/**
 * @param {ReturnType<resolveJurisdictionDecision> | null | undefined} decision
 * @param {string[]} detectedHints
 */
function jurisdictionDisclosure(decision, detectedHints) {
  const detectedLocation = decision?.detectedLocation || detectedHints[0] || null;
  const selectedScope = decision?.selectedScope || null;
  const amendmentsEnforced = Boolean(decision?.amendmentsEnforced);
  const explicitGeneral =
    decision?.selectionSource === "explicit" &&
    (decision.selectedScope === "general-ibc" || decision.enforcedJurisdiction === "general");
  const locationDiffers = Boolean(
    detectedLocation && detectedLocation !== "general" && detectedLocation !== decision?.enforcedJurisdiction,
  );

  let message = null;
  if (explicitGeneral && detectedLocation && detectedLocation !== "general") {
    message =
      "Detected location is Washington, DC. Selected code scope is General IBC. DC amendments are not enforced.";
    if (detectedLocation !== "dc") {
      message = `Detected location is ${detectedLocation}. Selected code scope is General IBC. Local amendments are not enforced.`;
    }
  } else if (decision?.disclosed && decision.selectionSource !== "explicit") {
    message = `No jurisdiction was explicitly selected. Detected ${detectedLocation} is used for this run and is disclosed. It is location context, not a silent title-block override of an explicit choice.`;
  } else if (!decision && locationDiffers) {
    message =
      "Detected location is Washington, DC. Selected code scope is General IBC. DC amendments are not enforced.";
  }

  return {
    selectedScope: selectedScope || (explicitGeneral ? "general-ibc" : null),
    detectedLocation,
    amendmentsEnforced,
    selectionSource: decision?.selectionSource || null,
    mismatch: Boolean(locationDiffers || (explicitGeneral && detectedHints.length > 0 && !amendmentsEnforced)),
    message,
  };
}

module.exports = {
  isUnselectedJurisdiction,
  resolveJurisdictionDecision,
  jurisdictionDisclosure,
  selectedScopeLabel,
};
