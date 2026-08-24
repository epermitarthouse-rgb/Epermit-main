"use strict";

/**
 * DC Construction Code Modification Review.
 * Separate from analyze-drawing: form extraction + grounded evidence review.
 */

const REVIEWER_MARKERS = [
  /for official use only/i,
  /dob reviewer/i,
  /doee reviewer/i,
  /conditions of approval/i,
  /dob approval date/i,
  /reserved for .*reviewer/i,
];

const APPLICANT_MARKERS = [
  /applicant request/i,
  /requests? a modification/i,
  /proposed alternative/i,
  /compensating measures/i,
  /flood hazard/i,
  /strict (application|compliance).{0,40}impractical/i,
  /complies with (the )?intent/i,
];

const BLANK_VALUE = /^(?:_{2,}|\.{3,}|[-–—]+|n\/a|tbd)?$/i;

const HEURISTIC_FIELD_WARNINGS = {
  requestedModification:
    "Could not extract a requested modification from applicant pages.",
  citedSections: "No applicant-cited code sections were found.",
  proposedMeasures: "No proposed alternative measures were found.",
};

const MEASURE_ACTION_VERBS =
  "Provide|Maintain|Incorporate|Install|Ensure|Limit|Keep|Add|Include|Equip|Supply|Furnish|Construct|Upgrade|Replace|Extend|Reduce|Restrict|Monitor|Signal|Mark|Label|Post";

const APPROVAL_CLAIM =
  /\b(?:dob|department of buildings)\s+(?:has\s+)?(?:approved|rejected)\b|\b(?:officially|formally)\s+approved\b|\bapproval\s+(?:granted|issued|probability)\b|\bdob approved\b|\bdob rejected\b/gi;

const EVIDENCE_STATUSES = new Set([
  "verified",
  "partially_supported",
  "not_found",
  "conflicting",
  "requires_professional_dob_review",
]);

const OVERALL_STATUSES = new Set([
  "evidence_appears_complete",
  "evidence_partially_supported",
  "material_evidence_missing",
  "manual_review_required",
]);

const DC_KEYS = new Set([
  "dc",
  "d.c.",
  "d-c",
  "washington-dc",
  "washington-d.c.",
  "district-of-columbia",
]);

function isDcJurisdiction(jurisdiction) {
  const raw = String(jurisdiction || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
  return DC_KEYS.has(raw);
}

function emptyExtractedRequest(warnings = []) {
  return {
    projectAddress: null,
    requestedModification: "",
    citedSections: [],
    impracticalReason: null,
    compliesWithIntent: null,
    proposedMeasures: [],
    floodHazardApplicable: null,
    supportingNarrative: null,
    extractionWarnings: warnings,
  };
}

function classifyPageRole(page) {
  const text = page?.text || "";
  const hasReviewer = REVIEWER_MARKERS.some((re) => re.test(text));
  const hasApplicant = APPLICANT_MARKERS.some((re) => re.test(text));
  if (hasReviewer && hasApplicant) return "mixed";
  if (hasReviewer) return "reviewer";
  if (hasApplicant) return "applicant";
  return "unknown";
}

function stripReviewerSections(text) {
  let next = text || "";
  next = next.replace(/for official use only[\s\S]*$/i, "");
  next = next.replace(
    /^(?:dob|doee)\s+(?:reviewer|approval|comments|decision)[^:\n]*:[^\n]*$/gim,
    "",
  );
  next = next.replace(/^conditions of approval:[^\n]*$/gim, "");
  return next.replace(/[ \t]+\n/g, "\n").trim();
}

function applicantPagesFrom(pages) {
  return (pages || [])
    .map((page) => ({ ...page, role: page.role || classifyPageRole(page) }))
    .filter((page) => page.role !== "reviewer")
    .map((page) =>
      page.role === "mixed" ? { ...page, text: stripReviewerSections(page.text) } : page,
    )
    .filter((page) => String(page.text || "").trim().length > 0);
}

function usableFieldValue(raw) {
  if (raw == null) return null;
  const value = String(raw).replace(/\s+/g, " ").trim();
  if (!value || BLANK_VALUE.test(value) || /^_+$/.test(value)) return null;
  if (/reviewer|official use only|approval date/i.test(value) && value.length < 40) {
    return null;
  }
  return value;
}

function uniqueCitations(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item.citation || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractCitedSections(text) {
  const found = [];
  const ibc = /IBC\s+(\d+(?:\.\d+)*)(?:\s*\((\d{4})\))?/gi;
  for (const match of text.matchAll(ibc)) {
    const year = match[2] || null;
    found.push({
      citation: year ? `IBC ${match[1]} (${year})` : `IBC ${match[1]}`,
      year,
      source: "applicant",
      label: "Applicant-cited code",
    });
  }
  const dcmr = /12A\s*DCMR\s+(\d+(?:\.\d+)*)/gi;
  for (const match of text.matchAll(dcmr)) {
    found.push({
      citation: `12A DCMR ${match[1]}`,
      year: null,
      source: "applicant",
      label: "Applicant-cited code",
    });
  }
  return uniqueCitations(found);
}

function extractAddress(text) {
  const match = text.match(
    /(?:project\s*(?:\/\s*)?address|property address|site address)\s*[:]\s*([^\n]+)/i,
  );
  return usableFieldValue(match && match[1]);
}

function extractRequestedModification(text) {
  const patterns = [
    /requests?\s+a\s+modification\s+of\s+([^\n]+(?:\n[^\n]+)?)/i,
    /modification\s+(?:of|to|concerning)\s+([^\n]+)/i,
    /applicant request:\s*([\s\S]{20,400}?)(?:\n\s*\n|reason |proposed )/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    const value = usableFieldValue(match && match[1]);
    if (value) return value.replace(/\s+/g, " ").replace(/\.$/, "").trim();
  }
  return "";
}

function extractImpracticalReason(text) {
  const labeled = text.match(
    /reason[^:\n]*impractical[^:\n]*:\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i,
  );
  if (labeled) return usableFieldValue(labeled[1]);
  const sentence = text.match(/([^.]*\b(?:historic stair|impractical)[^.]*\.)/i);
  return usableFieldValue(sentence && sentence[1]);
}

function extractCompliesWithIntent(text) {
  if (/complies with (the )?intent/i.test(text)) return true;
  if (/does not comply with (the )?intent/i.test(text)) return false;
  return null;
}

function extractFloodHazard(text) {
  const match = text.match(/flood\s+hazard[^:\n]*:\s*(yes|no)\b/i);
  if (!match) return null;
  return match[1].toLowerCase() === "yes";
}

function extractNarrative(text) {
  const match = text.match(
    /supporting narrative:\s*([\s\S]+?)(?:\n\s*\n|for official use|$)/i,
  );
  return usableFieldValue(match && match[1]);
}

function normalizeMeasureClause(clause) {
  let value = String(clause || "")
    .replace(/^[,.\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (value && /^[a-z]/.test(value)) {
    value = value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value.replace(/[.,;]+$/, "").trim();
}

function splitMeasureDescription(description) {
  const text = String(description || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];

  const numbered = [...text.matchAll(/\b(\d+)\s*[.)]\s+(.+?)(?=\s\d+\s*[.)]\s|$)/gi)];
  if (numbered.length >= 2) {
    return numbered.map((match) => normalizeMeasureClause(match[2])).filter(Boolean);
  }

  const splitOnActionVerbs = (input) => {
    const boundary = new RegExp(
      `(?:[.;]\\s+|,\\s*)(?=(?:${MEASURE_ACTION_VERBS})\\s+)`,
      "gi",
    );
    const segments = input
      .split(boundary)
      .map((part) => normalizeMeasureClause(part))
      .filter((part) => part.length >= 10);
    return segments.length >= 2 ? segments : [input.trim()];
  };

  let parts = splitOnActionVerbs(text);
  const expanded = [];
  for (const part of parts) {
    const nested = splitOnActionVerbs(part);
    expanded.push(...(nested.length >= 2 ? nested : [part]));
  }

  const final = [];
  for (const part of expanded) {
    const subParts = part
      .split(/,\s*(?=(?:include|maintain|provide|install|ensure|limit)\s+)/i)
      .map((segment) => normalizeMeasureClause(segment))
      .filter((segment) => segment.length >= 10);
    if (subParts.length >= 2) {
      final.push(...subParts);
      continue;
    }
    final.push(normalizeMeasureClause(part));
  }

  const unique = [];
  const seen = new Set();
  for (const part of final) {
    const key = part.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  return unique.length >= 2 ? unique : [text];
}

function normalizeProposedMeasures(measures) {
  const expanded = [];
  for (const measure of measures || []) {
    const description = String(measure.description || "").trim();
    if (!description) continue;
    const parts = splitMeasureDescription(description);
    const sourceContext =
      measure.sourceContext ||
      (parts.length > 1 ? description.slice(0, 160) : null);
    if (parts.length <= 1) {
      expanded.push({
        ...measure,
        description,
        sourcePageNumber: measure.sourcePageNumber ?? null,
        sourceContext,
      });
      continue;
    }
    for (const part of parts) {
      expanded.push({
        id: `measure-${expanded.length + 1}`,
        description: part,
        category: measure.category ?? null,
        sourcePageNumber: measure.sourcePageNumber ?? null,
        sourceContext,
      });
    }
  }
  return expanded.map((measure, index) => ({
    ...measure,
    id: `measure-${index + 1}`,
  }));
}

function reconcileExtractionWarnings(extracted) {
  const warnings = [...(extracted.extractionWarnings || [])];
  return warnings.filter((warning) => {
    if (
      warning === HEURISTIC_FIELD_WARNINGS.requestedModification &&
      usableFieldValue(extracted.requestedModification)
    ) {
      return false;
    }
    if (
      warning === HEURISTIC_FIELD_WARNINGS.citedSections &&
      (extracted.citedSections || []).length > 0
    ) {
      return false;
    }
    if (
      warning === HEURISTIC_FIELD_WARNINGS.proposedMeasures &&
      (extracted.proposedMeasures || []).length > 0
    ) {
      return false;
    }
    return true;
  });
}

function extractProposedMeasures(text, sourcePageNumber = null) {
  const section = text.match(
    /proposed alternative[\s\S]*?(?:flood hazard|supporting narrative|for official use|$)/i,
  );
  const block = (section && section[0]) || text;
  const sectionLabel = section ? "Proposed alternative / compensating measures" : null;
  const measures = [];

  const pushMeasure = (raw) => {
    const description = usableFieldValue(raw);
    if (!description) return;
    if (/proposed alternative|compensating measures|flood hazard/i.test(description)) return;
    measures.push({
      id: `measure-${measures.length + 1}`,
      description,
      sourcePageNumber: sourcePageNumber ?? null,
      sourceContext: sectionLabel,
    });
  };

  for (const line of block.split(/\n+/)) {
    const item = line.match(/^\s*(?:\d+\s*[.)]|[-*•])\s+(.+)$/);
    pushMeasure(item && item[1]);
  }
  if (measures.length > 0) return normalizeProposedMeasures(measures);

  // pdf.js joins text items with spaces; numbered lists often appear inline.
  for (const match of block.matchAll(
    /\b(\d+)\s*[.)]\s+(.+?)(?=\s\d+\s*[.)]\s|\sFlood Hazard|\sSupporting narrative|\sFOR OFFICIAL USE|$)/gi,
  )) {
    pushMeasure(match[2]);
  }
  if (measures.length > 0) return normalizeProposedMeasures(measures);

  if (!section) return normalizeProposedMeasures(measures);

  const paragraph = usableFieldValue(block.replace(/proposed alternative[^:]*:/i, ""));
  if (paragraph && !/proposed alternative|compensating measures|flood hazard/i.test(paragraph)) {
    pushMeasure(paragraph);
  }
  return normalizeProposedMeasures(measures);
}

function heuristicExtractModificationRequest(pages) {
  const applicantPages = applicantPagesFrom(pages);
  const text = applicantPages.map((p) => p.text).join("\n\n");
  const warnings = [];
  if (applicantPages.length === 0) {
    warnings.push("No applicant pages found; official-use sections were ignored.");
    return emptyExtractedRequest(warnings);
  }
  const citedSections = extractCitedSections(text);
  const proposedMeasures = normalizeProposedMeasures(
    applicantPages.flatMap((page) => {
      if (!/proposed alternative|compensating measures/i.test(page.text)) return [];
      return extractProposedMeasures(page.text, page.pageNumber);
    }),
  );
  const requestedModification = extractRequestedModification(text);
  const extracted = {
    projectAddress: extractAddress(text),
    requestedModification,
    citedSections,
    impracticalReason: extractImpracticalReason(text),
    compliesWithIntent: extractCompliesWithIntent(text),
    proposedMeasures,
    floodHazardApplicable: extractFloodHazard(text),
    supportingNarrative: extractNarrative(text),
    extractionWarnings: warnings,
  };
  if (!requestedModification) {
    warnings.push(HEURISTIC_FIELD_WARNINGS.requestedModification);
  }
  if (citedSections.length === 0) {
    warnings.push(HEURISTIC_FIELD_WARNINGS.citedSections);
  }
  if (proposedMeasures.length === 0) {
    warnings.push(HEURISTIC_FIELD_WARNINGS.proposedMeasures);
  }
  extracted.extractionWarnings = warnings;
  return extracted;
}

function mergeExtractedRequests(primary, secondary) {
  const pick = (a, b) => {
    const left = usableFieldValue(a);
    const right = usableFieldValue(b);
    if (left && right) return left.length >= right.length ? left : right;
    return left || right || null;
  };
  const measures = normalizeProposedMeasures([...(primary.proposedMeasures || [])]);
  const seen = new Set(measures.map((m) => m.description.toLowerCase()));
  for (const measure of normalizeProposedMeasures(secondary.proposedMeasures || [])) {
    const key = String(measure.description || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    measures.push({ ...measure, id: `measure-${measures.length + 1}` });
  }
  const normalizedMeasures = normalizeProposedMeasures(measures);
  const warnings = [
    ...(primary.extractionWarnings || []),
    ...(secondary.extractionWarnings || []),
  ].filter((w, i, arr) => arr.indexOf(w) === i);
  const merged = {
    projectAddress: pick(primary.projectAddress, secondary.projectAddress),
    requestedModification:
      pick(primary.requestedModification, secondary.requestedModification) || "",
    citedSections: uniqueCitations([
      ...(primary.citedSections || []),
      ...(secondary.citedSections || []),
    ]),
    impracticalReason: pick(primary.impracticalReason, secondary.impracticalReason),
    compliesWithIntent:
      primary.compliesWithIntent == null
        ? secondary.compliesWithIntent
        : primary.compliesWithIntent,
    proposedMeasures: normalizedMeasures,
    floodHazardApplicable:
      primary.floodHazardApplicable == null
        ? secondary.floodHazardApplicable
        : primary.floodHazardApplicable,
    supportingNarrative: pick(primary.supportingNarrative, secondary.supportingNarrative),
    extractionWarnings: warnings,
  };
  merged.extractionWarnings = reconcileExtractionWarnings(merged);
  return merged;
}

function pagesAreSparse(pages) {
  const texts = (pages || []).map((p) => String(p.text || "").trim());
  const total = texts.join(" ").length;
  const substantial = texts.filter((t) => t.length >= 80).length;
  return total < 240 || substantial === 0;
}

function stripApprovalClaims(text) {
  if (!text) return "";
  return String(text)
    .replace(APPROVAL_CLAIM, "requires professional / DOB review")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sourceHasSheetOrPage(source) {
  if (!source) return false;
  if (typeof source.pageNumber === "number" && Number.isFinite(source.pageNumber)) return true;
  return Boolean(source.sheetId || source.sheetLabel || source.fileName || source.documentId);
}

function normalizeRef(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sourceIsAllowed(source, allowed) {
  if (!sourceHasSheetOrPage(source) || !source) return false;
  if (!allowed || !allowed.length) return false;
  return allowed.some((ref) => {
    if (source.sheetId && ref.sheetId && source.sheetId === ref.sheetId) return true;
    if (
      source.documentId &&
      ref.documentId &&
      source.documentId === ref.documentId &&
      (source.pageNumber == null ||
        ref.pageNumber == null ||
        source.pageNumber === ref.pageNumber)
    ) {
      return true;
    }
    const sourceLabel = normalizeRef(source.sheetLabel || source.fileName);
    const refLabel = normalizeRef(ref.sheetLabel || ref.fileName);
    if (sourceLabel && refLabel && sourceLabel === refLabel) {
      if (source.pageNumber == null || ref.pageNumber == null) return true;
      return source.pageNumber === ref.pageNumber;
    }
    if (
      source.pageNumber != null &&
      ref.pageNumber === source.pageNumber &&
      !source.sheetId &&
      !source.documentId &&
      !sourceLabel
    ) {
      return true;
    }
    return false;
  });
}

function normalizeStatus(status) {
  const raw = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (raw === "verified_in_submitted_documents" || raw === "supported") return "verified";
  if (raw === "partial" || raw === "partially_supported") return "partially_supported";
  if (raw === "not_found_in_submitted_documents" || raw === "missing") return "not_found";
  if (raw === "conflicting_information" || raw === "conflict") return "conflicting";
  if (
    raw === "requires_professional_dob_review" ||
    raw === "requires_professional_/_dob_review" ||
    raw === "manual_review"
  ) {
    return "requires_professional_dob_review";
  }
  return EVIDENCE_STATUSES.has(raw) ? raw : "requires_professional_dob_review";
}

function validateAndGroundFindings(findings, allowed) {
  return (findings || []).map((finding, index) => {
    const status = normalizeStatus(finding.status);
    const note = stripApprovalClaims(finding.note);
    const excerpt = stripApprovalClaims(finding.source && finding.source.excerpt);
    const source = finding.source
      ? { ...finding.source, excerpt: excerpt || finding.source.excerpt || null }
      : null;
    const allowedSource = sourceIsAllowed(source, allowed);
    const grounded = {
      id: finding.id || `finding-${index + 1}`,
      measureId: finding.measureId || null,
      measure: finding.measure || "Unnamed measure",
      status,
      source,
      note: note || null,
    };
    if (status === "verified" || status === "partially_supported") {
      if (!allowedSource) {
        return {
          ...grounded,
          status: "not_found",
          source: null,
          note: note
            ? `${note} Evidence was not grounded to a submitted sheet or page.`
            : "Not found in submitted documents. The cited sheet/page is missing or not in the drawing set.",
        };
      }
      return grounded;
    }
    if (status === "conflicting" && !allowedSource) {
      return {
        ...grounded,
        status: "requires_professional_dob_review",
        source: sourceHasSheetOrPage(source) ? null : source,
        note: note
          ? `${note} Conflict could not be grounded to a submitted source.`
          : "Conflicting information was claimed without a submitted source and requires professional / DOB review.",
      };
    }
    return grounded;
  });
}

function computeOverallStatus(findings) {
  if (!findings || findings.length === 0) return "manual_review_required";
  const statuses = findings.map((f) => f.status);
  if (
    statuses.includes("conflicting") ||
    statuses.includes("requires_professional_dob_review")
  ) {
    return "manual_review_required";
  }
  if (statuses.includes("not_found")) return "material_evidence_missing";
  if (statuses.includes("partially_supported")) return "evidence_partially_supported";
  if (statuses.every((s) => s === "verified")) return "evidence_appears_complete";
  return "manual_review_required";
}

function normalizeOverallStatus(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (OVERALL_STATUSES.has(raw)) return raw;
  return "manual_review_required";
}

const PROMPT_CONSTRAINTS = `CRITICAL RULES:
- Use ONLY submitted evidence (the application text and the attached drawing/sheet).
- Do not invent drawings, sheet numbers, dimensions, systems, or DOB requirements.
- Do not claim official DOB approval or rejection.
- If evidence is missing, mark it missing. Do not guess.
- Cite the exact submitted sheet/page for every supported or conflicting finding.
- Preserve the applicant's cited code section/year exactly. Label it applicant-cited. Do not rewrite the edition.
- Separate applicant claims from verified drawing evidence.
- Return schema JSON only.`;

function buildFormExtractPrompt(pageTexts) {
  return {
    systemPrompt: `You extract fields from a DC Department of Buildings Application for Modification of Construction Code Requirements.

${PROMPT_CONSTRAINTS}

Ignore FOR OFFICIAL USE ONLY / DOB / DOEE reviewer sections and blank reviewer fields. Those are not applicant answers.
Return each distinct compensating measure as its own proposedMeasures entry. Preserve sourcePageNumber when visible.

Respond with JSON:
{
  "projectAddress": "string or null",
  "requestedModification": "string",
  "citedSections": [{"citation": "string", "year": "string or null", "source": "applicant", "label": "Applicant-cited code"}],
  "impracticalReason": "string or null",
  "compliesWithIntent": true,
  "proposedMeasures": [{"id": "measure-1", "description": "string", "sourcePageNumber": 2, "sourceContext": "string or null"}],
  "floodHazardApplicable": false,
  "supportingNarrative": "string or null",
  "extractionWarnings": ["string"]
}`,
    userPrompt: `Extract the applicant modification request from these application pages. Do not treat blank reviewer fields as answers.\n\n${pageTexts}`,
  };
}

function buildSheetReviewPrompt(extracted, sheet) {
  return {
    systemPrompt: `You review a DC Construction Code Modification request against ONE submitted drawing sheet.

${PROMPT_CONSTRAINTS}

This is an evidence review, not a DOB approval. Do not invent missing systems.

Respond with JSON:
{
  "findings": [
    {
      "id": "finding-1",
      "measureId": "measure-1 or null",
      "measure": "string",
      "status": "verified|partially_supported|not_found|conflicting|requires_professional_dob_review",
      "source": {
        "sheetId": "string or null",
        "fileName": "string or null",
        "sheetLabel": "string or null",
        "pageNumber": 1,
        "excerpt": "string or null"
      },
      "note": "string"
    }
  ]
}`,
    userPrompt: `Applicant request (preserve cited code exactly):
${JSON.stringify(extracted, null, 2)}

Review only this submitted sheet:
id=${sheet.id || ""} fileName=${sheet.fileName || sheet.sheetLabel || ""} pageNumber=${sheet.pageNumber ?? ""}
${sheet.text ? `Sheet text:\n${sheet.text}` : "A drawing image is attached. Use only what is visible."}

For each proposed measure, say whether this sheet supports, partially supports, conflicts with, or does not show the measure. Missing = missing.`,
  };
}

async function extractPdfPageTexts(pdfBase64) {
  let pdfjs;
  try {
    pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  } catch (err) {
    throw new Error(`pdfjs-dist unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  const buf = Buffer.from(pdfBase64, "base64");
  const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const loadingTask = pdfjs.getDocument({
    data: uint8,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = (content.items || [])
      .map((item) => (item && typeof item.str === "string" ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    pages.push({ pageNumber: pageNum, text });
  }
  return pages;
}

function parseJsonContent(content) {
  if (!content || typeof content !== "string") return null;
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeExtracted(raw) {
  if (!raw || typeof raw !== "object") return emptyExtractedRequest(["LLM extract returned no JSON"]);
  const cited = Array.isArray(raw.citedSections)
    ? raw.citedSections.map((s) => ({
        citation: String(s.citation || "").trim(),
        year: s.year || null,
        source: "applicant",
        label: "Applicant-cited code",
      }))
    : [];
  const measures = normalizeProposedMeasures(
    Array.isArray(raw.proposedMeasures)
      ? raw.proposedMeasures
          .map((m, i) => ({
            id: m.id || `measure-${i + 1}`,
            description: String(m.description || "").trim(),
            sourcePageNumber:
              typeof m.sourcePageNumber === "number" ? m.sourcePageNumber : null,
            sourceContext: usableFieldValue(m.sourceContext),
          }))
          .filter((m) => m.description)
      : [],
  );
  const normalized = {
    projectAddress: usableFieldValue(raw.projectAddress),
    requestedModification: usableFieldValue(raw.requestedModification) || "",
    citedSections: uniqueCitations(cited.filter((c) => c.citation)),
    impracticalReason: usableFieldValue(raw.impracticalReason),
    compliesWithIntent:
      typeof raw.compliesWithIntent === "boolean" ? raw.compliesWithIntent : null,
    proposedMeasures: measures,
    floodHazardApplicable:
      typeof raw.floodHazardApplicable === "boolean" ? raw.floodHazardApplicable : null,
    supportingNarrative: usableFieldValue(raw.supportingNarrative),
    extractionWarnings: Array.isArray(raw.extractionWarnings) ? raw.extractionWarnings : [],
  };
  normalized.extractionWarnings = reconcileExtractionWarnings(normalized);
  return normalized;
}

async function optionalLlmExtract(openai, pages, formImages, logError) {
  if (!openai) return null;
  const applicant = applicantPagesFrom(pages);
  const pageTexts = applicant.map((p) => `--- page ${p.pageNumber} ---\n${p.text}`).join("\n\n");
  if (!pageTexts && !(formImages && formImages.length)) return null;
  const { systemPrompt, userPrompt } = buildFormExtractPrompt(pageTexts || "(scanned form images attached)");
  const content = [{ type: "text", text: userPrompt }];
  for (const image of formImages || []) {
    if (!image.imageBase64) continue;
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${image.imageType || "image/png"};base64,${image.imageBase64}`,
        detail: "high",
      },
    });
  }
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      max_tokens: 2048,
      response_format: { type: "json_object" },
    });
    return normalizeExtracted(parseJsonContent(response.choices?.[0]?.message?.content));
  } catch (err) {
    logError(
      "[analyze-code-modification] LLM extract failed:",
      err instanceof Error ? err.message : String(err),
    );
    return emptyExtractedRequest([
      `Form LLM extract failed: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }
}

function allowedRefsFromSheets(sheets) {
  return (sheets || []).map((sheet) => ({
    documentId: sheet.documentId || sheet.sourceDocumentId || null,
    sheetId: sheet.id || sheet.sheetId || null,
    pageNumber: sheet.pageNumber ?? null,
    fileName: sheet.fileName || sheet.file_name || null,
    sheetLabel: sheet.sheetLabel || sheet.fileName || sheet.file_name || null,
  }));
}

function findingsFromExtracted(extracted) {
  return (extracted.proposedMeasures || []).map((measure, index) => ({
    id: `finding-${index + 1}`,
    measureId: measure.id,
    measure: measure.description,
    status: "not_found",
    source: null,
    note: "No drawing evidence was reviewed for this measure.",
  }));
}

function mergeFindings(existing, incoming) {
  const byMeasure = new Map();
  for (const finding of existing) {
    byMeasure.set((finding.measureId || finding.measure || finding.id).toLowerCase(), finding);
  }
  const rank = {
    conflicting: 5,
    requires_professional_dob_review: 4,
    not_found: 1,
    partially_supported: 2,
    verified: 3,
  };
  for (const finding of incoming) {
    const key = (finding.measureId || finding.measure || finding.id).toLowerCase();
    const prev = byMeasure.get(key);
    if (!prev || (rank[finding.status] || 0) >= (rank[prev.status] || 0)) {
      byMeasure.set(key, finding);
    }
  }
  return Array.from(byMeasure.values());
}

async function reviewSheetWithVision(openai, extracted, sheet, logError) {
  const { systemPrompt, userPrompt } = buildSheetReviewPrompt(extracted, sheet);
  const content = [{ type: "text", text: userPrompt }];
  if (sheet.imageBase64) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${sheet.imageType || "image/png"};base64,${sheet.imageBase64}`,
        detail: "high",
      },
    });
  }
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    max_tokens: 2048,
    response_format: { type: "json_object" },
  });
  const parsed = parseJsonContent(response.choices?.[0]?.message?.content);
  if (!parsed || !Array.isArray(parsed.findings)) {
    logError("[analyze-code-modification] Sheet review returned no findings array");
    return [];
  }
  return parsed.findings.map((finding, index) => ({
    id: finding.id || `finding-${sheet.pageNumber || 1}-${index + 1}`,
    measureId: finding.measureId || null,
    measure: finding.measure || "Unnamed measure",
    status: finding.status,
    source: {
      ...(finding.source || {}),
      sheetId: (finding.source && finding.source.sheetId) || sheet.id || null,
      fileName: (finding.source && finding.source.fileName) || sheet.fileName || null,
      sheetLabel: (finding.source && finding.source.sheetLabel) || sheet.sheetLabel || sheet.fileName || null,
      pageNumber:
        typeof (finding.source && finding.source.pageNumber) === "number"
          ? finding.source.pageNumber
          : sheet.pageNumber ?? null,
    },
    note: finding.note || null,
  }));
}

/**
 * @param {{
 *   openai?: import("openai").OpenAI | null;
 *   formPages?: Array<{ pageNumber: number; text: string }>;
 *   formPdfBase64?: string;
 *   formImages?: Array<{ pageNumber?: number; imageBase64: string; imageType?: string }>;
 *   sheets?: Array<Record<string, unknown>>;
 *   formDocument?: { id?: string; fileName?: string; updatedAt?: string };
 *   jurisdiction?: string;
 *   projectType?: string;
 *   codeYear?: string;
 *   logInfo?: (msg: string, extra?: string) => void;
 *   logError?: (msg: string, extra?: string) => void;
 * }} params
 */
async function analyzeCodeModification(params) {
  const {
    openai = null,
    formPages,
    formPdfBase64,
    formImages = [],
    sheets = [],
    formDocument,
    logInfo = console.log,
    logError = console.error,
  } = params;

  let pages = Array.isArray(formPages) ? formPages.slice() : [];
  if (pages.length === 0 && formPdfBase64) {
    try {
      pages = await extractPdfPageTexts(formPdfBase64);
    } catch (err) {
      logError(
        "[analyze-code-modification] PDF text extract failed:",
        err instanceof Error ? err.message : String(err),
      );
      pages = [];
    }
  }

  let extracted = heuristicExtractModificationRequest(pages);
  const sparse = pagesAreSparse(pages) || !extracted.requestedModification;
  if (sparse && openai) {
    logInfo("[analyze-code-modification] Heuristic extract sparse; trying optional LLM extract");
    const llmExtracted = await optionalLlmExtract(openai, pages, formImages, logError);
    if (llmExtracted) {
      extracted = mergeExtractedRequests(extracted, llmExtracted);
    }
  }

  const allowed = allowedRefsFromSheets(sheets);
  let findings = findingsFromExtracted(extracted);
  const sheetWarnings = [];

  const reviewable = (sheets || []).filter((sheet) => sheet.imageBase64 || sheet.text);
  if (openai && reviewable.length > 0) {
    for (const sheet of reviewable) {
      try {
        const sheetFindings = await reviewSheetWithVision(openai, extracted, sheet, logError);
        findings = mergeFindings(findings, sheetFindings);
      } catch (err) {
        const label = sheet.fileName || sheet.sheetLabel || `page ${sheet.pageNumber ?? "?"}`;
        const message = err instanceof Error ? err.message : String(err);
        logError(`[analyze-code-modification] Sheet review failed (${label}):`, message);
        sheetWarnings.push(`Sheet ${label} could not be reviewed: ${message}`);
      }
    }
  } else if (reviewable.length === 0) {
    sheetWarnings.push("No drawing sheets were provided for evidence review.");
  }

  const grounded = validateAndGroundFindings(findings, allowed);
  const overall_status = normalizeOverallStatus(computeOverallStatus(grounded));
  const extraction_warnings = [
    ...(extracted.extractionWarnings || []),
    ...sheetWarnings,
  ];

  logInfo(
    `[analyze-code-modification] Review complete: ${grounded.length} findings, status=${overall_status}`,
  );

  return {
    ok: true,
    status: 200,
    result: {
      extracted_request: extracted,
      evidence: grounded,
      overall_status,
      extraction_warnings,
      form_fingerprint: formDocument?.id
        ? [formDocument.id, formDocument.updatedAt || "", String(pages.length)].join("|")
        : "",
      sheet_warnings: sheetWarnings,
    },
  };
}

module.exports = {
  classifyPageRole,
  stripReviewerSections,
  applicantPagesFrom,
  heuristicExtractModificationRequest,
  mergeExtractedRequests,
  pagesAreSparse,
  extractCitedSections,
  validateAndGroundFindings,
  stripApprovalClaims,
  sourceIsAllowed,
  computeOverallStatus,
  buildFormExtractPrompt,
  buildSheetReviewPrompt,
  extractPdfPageTexts,
  analyzeCodeModification,
  isDcJurisdiction,
  emptyExtractedRequest,
  PROMPT_CONSTRAINTS,
  HEURISTIC_FIELD_WARNINGS,
  reconcileExtractionWarnings,
  splitMeasureDescription,
  normalizeProposedMeasures,
};
