/**
 * Stable sheet identity for reconciliation.
 * Filename equality is not the identity. A SHA-256 is the file identity.
 * Sheet numbers match only by an exact normalized token, or by one unique
 * trailing-zero-suffix normalization. Ambiguous suffix matches stay unmatched.
 */

const SHEET_TOKEN =
  /\b((?:[A-Z]{1,4}-\d{1,3}(?:\.\d+){0,3}(?:-\d{1,2})?)|(?:[A-Z]{2,4}\d{2,4}))\b/g;

export function canonicalSheetKey(label) {
  const raw = String(label || "")
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const stripped = raw.replace(/-0+$/, "");
  return { raw, stripped };
}

export function sheetTokensInText(text) {
  const found = [];
  const source = String(text || "").toUpperCase();
  for (const match of source.matchAll(SHEET_TOKEN)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

export function filenameIsSheetToken(filename) {
  const raw = canonicalSheetKey(filename).raw;
  return sheetTokensInText(raw).includes(raw);
}

/**
 * Tokens that sit in the bottom band or the right band of the sheet.
 * Tokens elsewhere are cross-references, not a sheet identity.
 * Coordinates use PDF user space (origin at the bottom left).
 */
export function titleBlockTokens(items, pageWidth, pageHeight) {
  const width = Number(pageWidth) || 0;
  const height = Number(pageHeight) || 0;
  if (!width || !height) return [];
  const band = (items || []).filter((item) => {
    const x = Number(item.x);
    const y = Number(item.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return y <= height * 0.22 || x >= width * 0.72;
  });
  return sheetTokensInText(band.map((item) => item.text || "").join(" "));
}

function groupIdentities(identities) {
  const groups = [];
  const bySheet = new Map();
  for (const identity of identities) {
    const sheetNumber = String(identity.sheetNumber || "");
    if (!bySheet.has(sheetNumber)) {
      const group = {
        sheetNumber,
        key: canonicalSheetKey(sheetNumber),
        discipline: identity.discipline || null,
        identities: [],
      };
      bySheet.set(sheetNumber, group);
      groups.push(group);
    }
    bySheet.get(sheetNumber).identities.push(identity);
  }
  return groups;
}

function keysEqual(left, right) {
  return left.raw === right.raw && left.raw.length > 0;
}

/**
 * @param {Array<{ relativePath: string, filename: string }>} files
 * @param {Array<{ sheetNumber: string, sheetTitle?: string, discipline?: string }>} identities
 */
export function matchSourceFiles(files, identities) {
  const groups = groupIdentities(identities);
  const used = new Set();
  const fileMatches = [];

  for (const file of files) {
    const key = canonicalSheetKey(file.filename || file.relativePath || "");
    const exact = groups.filter((group) => keysEqual(group.key, key));
    if (exact.length === 1) {
      used.add(exact[0].sheetNumber);
      fileMatches.push({
        relativePath: file.relativePath,
        filename: file.filename,
        sheetNumber: exact[0].sheetNumber,
        method: "filename_exact",
        ambiguous: false,
        candidateSheetNumbers: [exact[0].sheetNumber],
        identityCount: exact[0].identities.length,
      });
      continue;
    }
    if (exact.length > 1) {
      fileMatches.push({
        relativePath: file.relativePath,
        filename: file.filename,
        sheetNumber: null,
        method: "filename_exact_ambiguous",
        ambiguous: true,
        candidateSheetNumbers: exact.map((group) => group.sheetNumber),
        identityCount: 0,
      });
      continue;
    }
    const soft = groups.filter((group) => group.key.stripped && group.key.stripped === key.stripped);
    if (soft.length === 1) {
      used.add(soft[0].sheetNumber);
      fileMatches.push({
        relativePath: file.relativePath,
        filename: file.filename,
        sheetNumber: soft[0].sheetNumber,
        method: "filename_suffix_normalized",
        ambiguous: false,
        candidateSheetNumbers: [soft[0].sheetNumber],
        identityCount: soft[0].identities.length,
      });
      continue;
    }
    if (soft.length > 1) {
      fileMatches.push({
        relativePath: file.relativePath,
        filename: file.filename,
        sheetNumber: null,
        method: "filename_suffix_ambiguous",
        ambiguous: true,
        candidateSheetNumbers: soft.map((group) => group.sheetNumber),
        identityCount: 0,
      });
      continue;
    }
    fileMatches.push({
      relativePath: file.relativePath,
      filename: file.filename,
      sheetNumber: null,
      method: "unmatched_file",
      ambiguous: false,
      candidateSheetNumbers: [],
      identityCount: 0,
    });
  }

  const unmatchedSheets = groups
    .filter((group) => !used.has(group.sheetNumber))
    .map((group) => ({
      sheetNumber: group.sheetNumber,
      identityCount: group.identities.length,
      titles: group.identities.map((identity) => identity.sheetTitle || null),
    }));

  return { fileMatches, unmatchedSheets, sheetGroups: groups.length };
}

/**
 * Title-block text may confirm a filename match or fill an unmatched file.
 * It never overrides a conflicting filename match.
 */
export function applyTitleBlockConfirmation(match, tokens) {
  const list = tokens || [];
  const next = {
    ...match,
    titleBlockTokens: list,
    titleBlockStatus: "not_read",
  };
  if (!list.length) {
    next.titleBlockStatus = match.sheetNumber ? "sheet_number_absent_from_text_layer" : "no_title_block_token";
    return next;
  }
  const tokenGroups = list.map((token) => ({ token, key: canonicalSheetKey(token) }));
  const agrees = (sheetNumber) => {
    const key = canonicalSheetKey(sheetNumber);
    return tokenGroups.some((token) => keysEqual(token.key, key) || (token.key.stripped && token.key.stripped === key.stripped));
  };
  if (match.sheetNumber) {
    next.titleBlockStatus = agrees(match.sheetNumber)
      ? "text_layer_confirms_filename"
      : "filename_sheet_not_in_title_block_text";
    return next;
  }
  if (match.ambiguous) {
    next.titleBlockStatus = "ambiguous_filename_not_overridden";
    return next;
  }
  const unique = new Map();
  for (const token of tokenGroups) {
    unique.set(token.key.raw, token.token);
  }
  if (unique.size === 1) {
    const token = [...unique.values()][0];
    next.titleBlockStatus = "title_block_candidate";
    next.titleBlockCandidate = token;
    return next;
  }
  next.titleBlockStatus = "multiple_title_block_tokens";
  return next;
}

export function upgradeUnmatchedFromTitleBlock(match, groups) {
  if (match.method !== "unmatched_file") return match;
  if (filenameIsSheetToken(match.filename)) {
    return { ...match, titleBlockStatus: "filename_sheet_not_in_analyzed_set" };
  }
  if (match.titleBlockStatus !== "title_block_candidate") return match;
  const key = canonicalSheetKey(match.titleBlockCandidate);
  const exact = groups.filter((group) => keysEqual(group.key, key));
  const soft = groups.filter((group) => group.key.stripped && group.key.stripped === key.stripped);
  const chosen = exact.length === 1 ? exact : soft.length === 1 ? soft : [];
  if (chosen.length !== 1) {
    return { ...match, titleBlockStatus: chosen.length > 1 ? "title_block_ambiguous" : "title_block_candidate_unmatched" };
  }
  return {
    ...match,
    sheetNumber: chosen[0].sheetNumber,
    method: "title_block_text",
    candidateSheetNumbers: [chosen[0].sheetNumber],
    identityCount: chosen[0].identities.length,
    titleBlockStatus: "text_layer_sheet_number",
  };
}
