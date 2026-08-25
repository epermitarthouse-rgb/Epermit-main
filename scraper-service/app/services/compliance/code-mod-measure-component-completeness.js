"use strict";

const {
  evidencePolarity,
  isAbsenceLanguage,
  isIncompleteEvidenceLanguage,
} = require("./code-mod-evidence-polarity.js");

const TOKEN_STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "or",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "with",
  "all",
  "per",
  "throughout",
  "fully",
  "automatic",
  "provide",
  "maintain",
  "include",
  "incorporate",
  "install",
  "serving",
  "below",
  "less",
  "than",
  "maximum",
  "minimum",
]);

function significantTokens(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !TOKEN_STOP.has(word));
}

function parseMeasureComponents(measureText) {
  const normalized = String(measureText ?? "").trim();
  if (!normalized) return [];

  const provideServing = normalized.match(
    /\b(?:provide|install|include)\b[\s\S]*?\b(?:a|an|the)\s+([\s\S]+?)\s+serving\s+([\s\S]+?)(?:[,.]|$)/i,
  );
  if (provideServing) {
    const provisionText = provideServing[1].trim();
    const coverageText = provideServing[2].trim().replace(/[,.]$/, "");
    return [
      {
        id: "provision",
        kind: "provision",
        text: provisionText,
        tokens: significantTokens(provisionText),
      },
      {
        id: "coverage",
        kind: "coverage",
        text: coverageText,
        tokens: significantTokens(coverageText),
      },
    ];
  }

  return [
    {
      id: "requirement",
      kind: "requirement",
      text: normalized,
      tokens: significantTokens(normalized),
    },
  ];
}

function tokenMatches(text, token) {
  const normalized = text.toLowerCase();
  if (normalized.includes(token)) return true;
  const stem = token.slice(0, Math.min(5, token.length));
  if (stem.length < 3) return false;
  return normalized.split(/\s+/).some(
    (word) => word.startsWith(stem) || stem.startsWith(word.slice(0, Math.min(5, word.length))),
  );
}

function tokenOverlapCount(text, tokens) {
  return tokens.filter((token) => tokenMatches(text, token)).length;
}

function observationRelatesToComponent(text, component) {
  if (!text.trim()) return false;
  const overlap = tokenOverlapCount(text, component.tokens);
  const threshold = Math.max(1, Math.ceil(component.tokens.length * 0.2));
  return overlap >= threshold;
}

function observationSupportsComponent(text, component) {
  if (!text.trim() || isAbsenceLanguage(text) || isIncompleteEvidenceLanguage(text)) return false;
  if (!observationRelatesToComponent(text, component)) return false;
  const polarity = evidencePolarity(text);
  if (polarity === "negative") return false;
  if (polarity === "positive") return true;
  return (
    /\d/.test(text) ||
    tokenOverlapCount(text, component.tokens) >= Math.max(2, component.tokens.length * 0.4)
  );
}

function assessComponentCoverage(measureText, observationTexts) {
  const components = parseMeasureComponents(measureText);
  if (components.length <= 1) {
    const supported = observationTexts.some((text) => observationSupportsComponent(text, components[0]))
      ? 1
      : 0;
    return { total: 1, supported: components.length ? supported : 0, components };
  }

  let supported = 0;
  for (const component of components) {
    if (observationTexts.some((text) => observationSupportsComponent(text, component))) {
      supported += 1;
    }
  }
  return { total: components.length, supported, components };
}

function observationsShareComponent(left, right, measureText) {
  const components = parseMeasureComponents(measureText);
  if (components.length <= 1) return true;

  for (const component of components) {
    if (observationRelatesToComponent(left, component) && observationRelatesToComponent(right, component)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  parseMeasureComponents,
  observationRelatesToComponent,
  observationSupportsComponent,
  assessComponentCoverage,
  observationsShareComponent,
};
