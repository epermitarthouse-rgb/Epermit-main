"use strict";

/**
 * Normalize filename/metadata text for role classification.
 * JavaScript \\b treats underscore as a word character, so tokens like
 * `_ONE-LINE_` and `_COMcheck_` fail standard boundary-based rules.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeRoleClassificationText(text) {
  return String(text ?? "")
    .replace(/[_]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {{ fileName?: string, portalDocumentName?: string, portalDocumentType?: string, documentType?: string }} input
 * @returns {string}
 */
function buildRoleClassificationHaystack(input) {
  return normalizeRoleClassificationText(
    [input.fileName, input.portalDocumentName, input.portalDocumentType, input.documentType]
      .filter(Boolean)
      .join(" "),
  );
}

module.exports = {
  normalizeRoleClassificationText,
  buildRoleClassificationHaystack,
};
