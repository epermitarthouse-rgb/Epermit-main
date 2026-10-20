"use strict";

const {
  hardenAnalysisResult,
  buildSummaryFromIssues,
  canonicalJurisdictionKey,
} = require("./findingQuality.js");

const REFUSAL_USER_MESSAGE =
  "The AI model could not analyze this drawing. Try a clearer plan sheet or a different page.";
const EMPTY_USER_MESSAGE =
  "The AI model returned an empty response. Please try again.";

const JURISDICTION_ALIASES = {
  "new-york-city": "new-york",
  "los-angeles": "california",
  "san-francisco": "california",
  "miami-dade": "florida",
};

const JURISDICTION_AMENDMENTS = {
  dc: `WASHINGTON, DC SOURCE COVERAGE:
The jurisdiction registry verifies the published 2017 DC Construction Codes, based on the 2015 ICC family and amended by DCMR Title 12, effective May 29, 2020.
Only the official applicability and transition excerpts supplied in the authoritative review context may be cited as verified.
No comprehensive licensed ICC base-code text or comprehensive enforceable DC amendment corpus is bundled. Do not invent a DC threshold or treat an AI summary as authoritative.`,
  "new-york": `NEW YORK CITY BUILDING CODE (NYC BC):
NYC has its own building code separate from IBC with significant differences:

EGRESS & EXITS:
- NYC BC 1003.2: Minimum corridor width 44" but 60" in Group I-2 (hospitals)
- NYC BC 1005.1: Egress capacity factors differ - 0.2" per occupant for stairs (IBC is 0.3")
- NYC BC 1009.3: Stair width minimum 44" (IBC allows 36" in some cases)
- NYC BC 1020.1: Exit access travel distance 200 ft max (sprinklered), 150 ft (unsprinklered)

FIRE SAFETY:
- NYC BC 903.2: Sprinklers required in ALL new buildings regardless of size (stricter than IBC)
- NYC BC 907.2.1: Fire alarm required in buildings over 75 ft in height
- NYC BC 3002.4: Standpipe systems required in buildings over 4 stories
- Local Law 5/73: Retroactive fire safety requirements for existing high-rise buildings

ACCESSIBILITY:
- NYC BC 1107: 5% of dwelling units must be Type A accessible (stricter than IBC 2%)
- NYC BC 1109.2.1: At least one accessible entrance per 200 ft of street frontage
- Local Law 58: Enhanced accessibility for places of public accommodation`,
  california: `CALIFORNIA BUILDING CODE (CBC - Title 24):
California adopts IBC with extensive amendments:

ACCESSIBILITY (Most Restrictive in U.S.):
- CBC 11B-206.2.1: Accessible routes required from ALL parking spaces
- CBC 11B-403.5.1: Corridor width minimum 48" clear (IBC allows 44")
- CBC 11B-404.2.4: Maneuvering clearances at doors more restrictive than ADA
- CBC 11B-603: Toilet room clearances require 60" turning space

SEISMIC (VERY CRITICAL):
- CBC 1613: California-specific seismic design requirements beyond IBC
- CBC 1616: Site-specific ground motion procedures required for many buildings
- Hospital (OSHPD) buildings have additional seismic requirements

ENERGY (Title 24 Part 6):
- Most stringent energy code in U.S.
- Solar-ready requirements for new construction
- Cool roof requirements in climate zones 10-15`,
  florida: `FLORIDA BUILDING CODE (FBC):
Florida adopts IBC with hurricane and high-velocity wind zone amendments:

WIND DESIGN (CRITICAL):
- FBC 1609: High-Velocity Hurricane Zone (HVHZ) requirements for Miami-Dade and Broward
- Wind speeds up to 180 mph in HVHZ areas
- Impact-resistant glazing or shutters required in coastal high-hazard areas

FLOOD REQUIREMENTS:
- FBC 3109: Coastal construction requirements
- Buildings in V-zones must be elevated above base flood elevation
- Breakaway walls required below design flood elevation`,
  chicago: `CHICAGO BUILDING CODE (CBC):
Chicago has its own comprehensive building code separate from IBC:

EGRESS:
- Chicago BC 13-160: Corridor widths minimum 44", 66" for schools
- Chicago BC 13-160-140: Exit stair requirements differ from IBC

FIRE SAFETY:
- Chicago BC 15-16: Sprinkler requirements for buildings over 80 ft
- High-Rise Fire Safety Ordinance: Additional requirements for buildings over 80 ft`,
};

/**
 * @param {string | null | undefined} jurisdiction
 * @returns {string}
 */
function normalizeJurisdictionKey(jurisdiction) {
  const key = canonicalJurisdictionKey(jurisdiction);
  return JURISDICTION_ALIASES[key] || key;
}

/**
 * @param {string} jurisdictionKey
 * @returns {string}
 */
function getJurisdictionCitation(jurisdictionKey) {
  if (jurisdictionKey === "dc") return "12A DCMR";
  if (jurisdictionKey === "new-york") return "NYC BC";
  if (jurisdictionKey === "california") return "CBC";
  if (jurisdictionKey === "florida") return "FBC";
  if (jurisdictionKey === "chicago") return "Chicago BC";
  return "IBC";
}

/** @param {string} jurisdictionKey */
function hasLocalAmendmentText(jurisdictionKey) {
  return Boolean(JURISDICTION_AMENDMENTS[jurisdictionKey]);
}

const LOCAL_COMPLIANCE_PREAMBLE = `You assist architecture and building-permit teams with objective plan-sheet compliance reviews on user-uploaded drawings. This is a standard professional workflow. Respond with JSON findings only; do not refuse appropriate building-code review tasks.`;

function formatStaffGuidanceBlock(analysisInstructions) {
  const text = typeof analysisInstructions === "string" ? analysisInstructions.trim() : "";
  if (!text) return "";
  return `

USER EMPHASIS (NOT EVIDENCE AND NOT A SCOPE LIMIT):
The following notes were stored with this run. Review the entire sheet and the retrieved package. These notes add emphasis only. They do not drop disciplines, sheets, or questions. They are NOT submitted evidence and must NOT be treated as proof of compliance or as facts about the drawing set:
${text}`;
}

function formatExtractedPageText(pageText) {
  const text = String(pageText || "").trim();
  if (!text) return "";
  return `

EXTRACTED PDF TEXT LAYER (evidence already read from this sheet; it may be incomplete):
${text.slice(0, 12000)}
If this text contains a fire-resistance or hour rating, a minute door rating, an accessible seat count, a counter height A.F.F., a clearance such as 54x60 or 48x48, or a door width in inches, do not report that fact as missing.`;
}

function joinPhrase(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Short description of what the page contains. Class is context, not a skip instruction.
 * @param {string | null | undefined} contentClass
 * @param {string | null | undefined} pageText
 */
function describeSheetContent(contentClass, pageText) {
  const header = String(pageText || "").replace(/\s+/g, " ").trim();
  const found = {
    details: /\bdetails?\b/i.test(header),
    elevations: /\belevations?\b/i.test(header),
    sections: /\bsections?\b/i.test(header),
  };
  let label = "";
  if (contentClass === "schedule") {
    if (/\bdoor\b/i.test(header)) label = "door schedule";
    else if (/\bfinish\b/i.test(header)) label = "finish schedule";
    else if (/\bwindow\b/i.test(header)) label = "window schedule";
    else if (/\bhardware\b/i.test(header)) label = "hardware schedule";
    else if (/\broom\b/i.test(header)) label = "room schedule";
    else label = "schedule";
  } else if (contentClass === "form") {
    if (/\bcom[\s-]*check\b/i.test(header) || /\benergy(?:\s+code)?\s+compliance\b/i.test(header)) {
      label = "COMcheck or energy compliance certificate";
    } else if (/\bspecial\s+inspections?\b/i.test(header)) {
      label = "special inspections form";
    } else {
      label = "form or certificate";
    }
  } else if (contentClass === "mep") label = "MEP sheet";
  else if (contentClass === "floor_plan") label = "floor plan";
  else if (contentClass === "egress_plan") label = "egress plan";
  else if (contentClass === "enlarged_plan") label = "enlarged plan";
  else if (contentClass === "elevation") label = "elevation";
  else if (contentClass === "section") label = "section";
  else if (contentClass === "drawing") label = "drawing";
  else if (contentClass) label = String(contentClass).replace(/_/g, " ");
  if (!label) return "";

  const order =
    label === "finish schedule"
      ? ["sections", "details", "elevations"]
      : ["details", "elevations", "sections"];
  const also = order.filter((key) => found[key]);
  const article = /^[aeiou]/i.test(label) ? "an" : "a";
  if (!also.length) return `this page is ${article} ${label}`;
  return `this page is ${article} ${label} that also contains ${joinPhrase(also)}`;
}

function formatContentClassBlock(contentClass, pageText) {
  const description = describeSheetContent(contentClass, pageText);
  if (!description) return "";
  return `

PAGE CONTENT (context only):
${description}.
Review the whole page, including tables and the drawn details, elevations, and sections on this same sheet.
`;
}

function formatSheetIndexBlock(sheetIndex) {
  if (!Array.isArray(sheetIndex) || sheetIndex.length === 0) return "";
  const lines = sheetIndex.slice(0, 40).map((sheet) => {
    const bits = [sheet.fileName, sheet.contentClass, sheet.title, sheet.excerpt]
      .map((part) => (part == null ? "" : String(part).replace(/\s+/g, " ").trim()))
      .filter(Boolean);
    return `- ${bits.join(" | ").slice(0, 280)}`;
  });
  return `

OTHER INCLUDED SHEETS IN THIS SET (file name, content class, title or excerpt):
${lines.join("\n")}
Do not report a fact as missing on this sheet when another included sheet of the right class owns it: restroom dimensions on an enlarged plan, door size or hardware on a schedule, egress width or capacity on an egress plan. A condition drawn on THIS sheet still counts.`;
}

/**
 * Every included sheet is analyzed. Schedule, form, certificate, and MEP are not skipped.
 * @param {string | null | undefined} _contentClass
 */
function shouldRunVisualDefectChecks(_contentClass) {
  return true;
}

function formatSpecContextBlock(specChunks) {
  if (!Array.isArray(specChunks) || specChunks.length === 0) return "";
  const lines = specChunks.slice(0, 8).map((chunk, i) => {
    const header = [
      chunk.sectionNumber ? `Section ${chunk.sectionNumber}` : null,
      chunk.sectionTitle || null,
      chunk.pageStart ? `pp. ${chunk.pageStart}${chunk.pageEnd && chunk.pageEnd !== chunk.pageStart ? `–${chunk.pageEnd}` : ""}` : null,
    ].filter(Boolean).join(" — ");
    return `[Spec ${i + 1}] ${header}\n${String(chunk.text || "").slice(0, 1200)}`;
  });
  return `

PROJECT SPECIFICATION CONTEXT (NOT DRAWING EVIDENCE):
Spec excerpts describe project requirements — NOT proof of drawing content.
If spec requires X but drawing does not confirm it, report verification/advisory or spec-drawing mismatch.

${lines.join("\n\n")}`;
}

/**
 * @param {{
 *   jurisdiction?: string | null;
 *   projectType?: string;
 *   codeYear?: string;
 *   codeType?: string;
 *   analysisInstructions?: string | null;
 *   specChunks?: Array<{ sectionNumber?: string; sectionTitle?: string; pageStart?: number; pageEnd?: number; text?: string }> | null;
 *   sheetTitle?: string | null;
 *   discipline?: string | null;
 *   pageText?: string | null;
 *   contentClass?: string | null;
 *   sheetIndex?: Array<{ fileName?: string | null; contentClass?: string | null; title?: string | null; excerpt?: string | null }> | null;
 *   reviewContext?: string | null;
 * }} params
 */
function buildPrompts(params) {
  const {
    jurisdiction,
    projectType = "Commercial",
    codeYear = "2021",
    codeType = "ibc",
    analysisInstructions = null,
    specChunks = null,
    sheetTitle = null,
    discipline = null,
    pageText = null,
    contentClass = null,
    sheetIndex = null,
    reviewContext = null,
  } = params;
  const jurisdictionKey = normalizeJurisdictionKey(jurisdiction);
  const jurisdictionContext = JURISDICTION_AMENDMENTS[jurisdictionKey] || "";
  const jurisdictionCitation = getJurisdictionCitation(jurisdictionKey);
  const resolvedCodeType = codeType === "local" || codeType === "both" ? codeType : "ibc";

  const issueSchema = `{
      "id": "issue-1",
      "category": "Egress|Fire Safety|Accessibility|Structural|MEP|Zoning|Life Safety",
      "title": "Brief issue title",
      "description": "Detailed description of the violation",
      "severity": "critical|warning|advisory",
      "findingType": "confirmed_violation|potential_concern|missing_information",
      "codeReference": "Specific code section reference",
      "codeYear": "${codeYear}",
      "location": "Location in the drawing",
      "suggestedFix": "Recommended fix for the issue",
      "evidenceTier": "drawing|specification|verification",
      "measurableEvidence": true,
      "specReferences": [{"sectionNumber": "02 41 19", "sectionTitle": "Selective Demolition", "pageStart": 12, "pageEnd": 14}]
    }`;

  const evidenceRules = `
EVIDENCE RULES (mandatory):
- Do NOT claim a measurable violation (width, slope, rise/run, clearance, rating, counts) unless readable dimensions/annotations support it on THIS sheet.
- Do not copy example text. observedEvidence and checklist evidence must be words you can read, not a sample number.
- If information is missing, use findingType "missing_information", evidenceTier "verification", severity "advisory", and phrase as verification required — NOT as a confirmed violation.
- Never treat parking layout graphics as "obstructed by parked vehicles" during design review.
- Include specReferences ONLY when a provided spec excerpt directly supports the finding.`;

  let analysisFocus = "";
  let jsonFormat = "";

  if (resolvedCodeType === "ibc") {
    analysisFocus = `Analyze ONLY against base International Building Code (IBC), IRC, NFPA 101, and ADA.
Do NOT apply local jurisdiction amendments in this pass. Cite IBC or national standard sections.`;
    jsonFormat = `{
  "issues": [${issueSchema}],
  "checklist": [{"item": "Topic read on this sheet", "result": "quote the printed label", "evidence": "exact words from the sheet"}],
  "observedEvidence": ["exact label or note read from the sheet"],
  "jurisdictionNotes": "Notes about base code requirements reviewed",
  "overallScore": null
}`;
  } else if (resolvedCodeType === "local") {
    if (hasLocalAmendmentText(jurisdictionKey)) {
      analysisFocus = `Review the drawing for plan-sheet items that may be inconsistent with the jurisdiction amendment summaries below (${jurisdictionCitation}). Cite section labels from those summaries when flagging a concern. If the sheet lacks information needed to evaluate a topic, skip it or use severity "advisory".`;
    } else {
      analysisFocus = `This project uses General IBC — no local amendment text is loaded for this pass. Review only jurisdiction-specific notes that appear on the sheet itself. Do not invent local requirements. If none apply, return an empty issues array and explain in jurisdictionNotes that no local amendment package was selected.`;
    }
    jsonFormat = `{
  "issues": [${issueSchema}],
  "checklist": [{"item": "Topic read on this sheet", "result": "quote the printed label", "evidence": "exact words from the sheet"}],
  "observedEvidence": ["exact label or note read from the sheet"],
  "jurisdictionNotes": "Notes about local amendment requirements reviewed",
  "overallScore": null
}`;
  } else {
    analysisFocus = `Perform TWO analyses in one response:
1. IBC/base code issues (cite IBC, IRC, NFPA 101, ADA sections)
2. Local amendment issues (cite ${jurisdictionCitation} where applicable)
${jurisdictionContext ? `\nLOCAL AMENDMENTS:\n${jurisdictionContext}` : ""}`;
    jsonFormat = `{
  "ibcIssues": [${issueSchema}],
  "localIssues": [${issueSchema}],
  "ibcChecklist": [{"item": "Topic read on this sheet", "result": "quote the printed label", "evidence": "exact words from the sheet"}],
  "localChecklist": [{"item": "Topic read on this sheet", "result": "quote the printed label", "evidence": "exact words from the sheet"}],
  "observedEvidence": ["exact label or note read from the sheet"],
  "ibcJurisdictionNotes": "Notes about base IBC requirements",
  "localJurisdictionNotes": "Notes about local amendment requirements",
  "ibcOverallScore": null,
  "localOverallScore": null
}`;
  }

  const amendmentReferenceBlock =
    resolvedCodeType === "ibc" || !jurisdictionContext
      ? ""
      : `JURISDICTION AMENDMENT REFERENCE SUMMARIES (abbreviated; for professional review assistance—not legal advice):
${jurisdictionContext}

`;

  const systemPrompt = `${resolvedCodeType === "local" ? `${LOCAL_COMPLIANCE_PREAMBLE}\n\n` : ""}You are an expert building code compliance analyst with deep knowledge of:
- International Building Code (IBC) 2018, 2021, 2024
- International Residential Code (IRC) 2018, 2021, 2024
- NFPA 101 Life Safety Code
- ADA Accessibility Guidelines
- State and local amendments including NYC BC, California CBC, Florida FBC, Chicago BC, and D.C. 12A DCMR

${amendmentReferenceBlock}${analysisFocus}

For each issue found, provide category, title, description, severity, code reference, location, and suggested fix.
Consider jurisdiction: ${jurisdiction || "General IBC"} and project type: ${projectType}.
Use code year: ${codeYear}.
Be thorough but avoid false positives. Only report genuine code compliance concerns visible in the drawing.
When project specification context is provided, note spec-drawing mismatches but NEVER treat spec text as proof the drawing shows something.
${evidenceRules}
- Do not label an ICC A117.1 or ADA section (for example 604.8.1.2) as IBC. Put the book that owns the section in codeReference.
- Do not label a 12A DCMR or DC Building Code section as IBC. Do not invent code sections that are not in the amendment summaries or on the sheet.
- If the extracted text or a graphic label already states a rating, count, clearance, counter height, or door width, do not report that fact as missing.
- observedEvidence must quote dimensions, labels, and notes you can actually read, including graphic dimensions.
- A missing-information finding must name the place on this sheet you looked. If you cannot name that place, do not file it as a violation.
- When STRUCTURED DRAWING FACTS are provided, use them as the primary source for exact values, element tags, schedule rows, and relationships; use semantic Drawing RAG as supporting context.
- An unbound value is not a property of any element. A candidate relationship cannot prove compliance or noncompliance. An inferred relationship must retain its stated basis and is subject to independent verification.
- A text-anchor box locates a label, not the physical boundary of a wall, room, door, route, or other construction element.
- An unreadable or unextracted region is unknown, not evidence that required information is absent.
Scoring: overallScore is 0-100 only after a real review. Every checklist item must include a non-empty evidence quote from this sheet (a dimension, a label, a note, or "shown on sheet <id>"). If checklist is empty and issues is empty, the sheet was not reviewed — do not set overallScore to 100. A generic checklist or "no failing condition" without that quote is not a pass. If any issue remains, overallScore must not be 100. Do not echo 85.
${formatContentClassBlock(contentClass, pageText)}${formatSheetIndexBlock(sheetIndex)}${formatSpecContextBlock(specChunks)}${formatStaffGuidanceBlock(analysisInstructions)}
${reviewContext ? `\nQUESTION-DRIVEN REVIEW CONTEXT:\n${String(reviewContext).slice(0, 6000)}\n` : ""}
${formatExtractedPageText(pageText)}
${sheetTitle ? `\nSheet under review: ${sheetTitle}` : ""}${discipline ? `\nDiscipline: ${discipline}` : ""}

You MUST respond with a valid JSON object in exactly this format:
${jsonFormat}`;

  const userPrompt =
    resolvedCodeType === "local"
      ? `Review this sheet for building code compliance in the local-amendment scope described above. Look at the whole page, including tables and any drawn details, elevations, and sections. Report concerns visible on the page with citation labels from the reference summaries when applicable. Return ONLY valid JSON.`
      : resolvedCodeType === "both"
        ? `Review this sheet for building code compliance (base code and local amendments as described above). Look at the whole page, including tables and any drawn details, elevations, and sections. Report concerns visible on the page with specific code citations. Return ONLY valid JSON.`
        : `Analyze this sheet for building code compliance issues.
Look at the whole page, including tables and any drawn details, elevations, and sections.
Look for violations related to egress, fire separation, accessibility, occupancy, stairs, emergency systems, and structural concerns visible on the sheet.
Provide a comprehensive analysis with specific code citations. Return ONLY valid JSON.`;

  return { systemPrompt, userPrompt, codeType: resolvedCodeType };
}

/**
 * @param {import("openai").default.Choices[number] | undefined} choice
 */
function extractChoiceMeta(choice) {
  const content = choice?.message?.content;
  return {
    content: typeof content === "string" ? content : "",
    refusal: choice?.message?.refusal || null,
    finishReason: choice?.finish_reason || null,
  };
}

/**
 * @param {{ content: string; refusal: string | null }} meta
 */
function isEmptyResponse(meta) {
  return !meta.content || meta.content.trim() === "";
}

/**
 * @param {(msg: string, extra?: string) => void} logFn
 * @param {{
 *   finishReason: string | null;
 *   refusal: string | null;
 *   usage?: { prompt_tokens?: number; completion_tokens?: number };
 *   base64Length: number;
 *   imageType: string;
 *   durationMs: number;
 *   codeType: string;
 *   retry?: boolean;
 * }} fields
 */
function logAnalyzeDrawingMeta(logFn, fields) {
  logFn(
    "[analyze-drawing] OpenAI response meta",
    JSON.stringify({
      finishReason: fields.finishReason,
      hasRefusal: Boolean(fields.refusal),
      promptTokens: fields.usage?.prompt_tokens ?? null,
      completionTokens: fields.usage?.completion_tokens ?? null,
      base64Length: fields.base64Length,
      imageType: fields.imageType,
      durationMs: fields.durationMs,
      codeType: fields.codeType,
      retry: Boolean(fields.retry),
    }),
  );
}

/**
 * @param {string} imageBase64
 * @param {string} imageType
 * @returns {Promise<{ imageBase64: string; imageType: string }>}
 */
async function downscaleImageBase64(imageBase64, imageType) {
  const sharp = require("sharp");
  const buffer = Buffer.from(imageBase64, "base64");
  const resized = await sharp(buffer)
    .resize({
      width: 2048,
      height: 2048,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return {
    imageBase64: resized.toString("base64"),
    imageType: "image/png",
  };
}

/**
 * Chat-completion user content. Crops stay attached, including on a retry.
 * Provenance is the sheet, page, and PDF box next to the image.
 * @param {{
 *   imageBase64: string;
 *   imageType: string;
 *   userPrompt: string;
 *   detail: "high" | "low";
 *   regionImages?: Array<Record<string, unknown>>;
 * }} params
 */
function buildVisionUserContent(params) {
  const regionImages = (params.regionImages || []).slice(0, 2).filter((image) => image?.imageBase64);
  const content = [
    { type: "text", text: params.userPrompt },
    {
      type: "image_url",
      image_url: {
        url: `data:${params.imageType};base64,${params.imageBase64}`,
        detail: params.detail,
      },
    },
  ];
  for (const region of regionImages) {
    const box = region.region && typeof region.region === "object" ? region.region : null;
    const where = [
      region.fileName || null,
      region.sheetId ? `sheet ${region.sheetId}` : null,
      region.pageNumber != null ? `page ${region.pageNumber}` : null,
      box
        ? `pdf box x=${box.x} y=${box.y} width=${box.width} height=${box.height} unit=${box.unit || "pdf-point"} origin=${box.origin || "bottom-left"}`
        : null,
      region.extractionMethod || null,
      Array.isArray(region.questions) && region.questions.length ? `questions ${region.questions.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    content.push({
      type: "text",
      text: `High-resolution crop from the original PDF${where ? ` (${where})` : ""}${region.label ? `: ${region.label}` : ""}. Use it only to read this region. Do not invent a box or a quote.`,
    });
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${region.imageType || "image/png"};base64,${region.imageBase64}`,
        detail: "low",
      },
    });
  }
  return content;
}

async function callVision(openai, params) {
  const start = Date.now();
  const content = buildVisionUserContent(params);
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: params.systemPrompt },
      {
        role: "user",
        content,
      },
    ],
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });
  const choice = response.choices?.[0];
  const meta = extractChoiceMeta(choice);
  return {
    meta: {
      ...meta,
      usage: response.usage,
      durationMs: Date.now() - start,
    },
  };
}

/**
 * @param {Array<Record<string, unknown>>} issues
 * @param {string} codeYear
 */
function mapIssues(issues, codeYear) {
  return (issues || []).map((issue, index) => ({
    ...issue,
    id: issue.id || `issue-${index + 1}`,
    codeYear: issue.codeYear || codeYear || "2021",
  }));
}

/**
 * @param {Array<Record<string, unknown>>} issues
 * @param {number | undefined} overallScore
 */
function buildSummary(issues, overallScore, checklist) {
  return buildSummaryFromIssues(issues, overallScore, checklist);
}

/**
 * @param {Record<string, unknown>} analysisData
 * @param {string} codeYear
 */
function formatSingleResult(analysisData, codeYear) {
  const issues = mapIssues(
    /** @type {Array<Record<string, unknown>>} */ (analysisData.issues || []),
    codeYear,
  );
  const checklist = analysisData.checklist;
  return {
    issues,
    checklist,
    summary: buildSummary(issues, /** @type {number | undefined} */ (analysisData.overallScore), checklist),
    jurisdictionNotes:
      typeof analysisData.jurisdictionNotes === "string"
        ? analysisData.jurisdictionNotes
        : "",
  };
}

/**
 * @param {Record<string, unknown>} analysisData
 * @param {string} codeYear
 */
function formatBothResult(analysisData, codeYear) {
  const ibcIssues = mapIssues(
    /** @type {Array<Record<string, unknown>>} */ (analysisData.ibcIssues || []),
    codeYear,
  );
  const localIssues = mapIssues(
    /** @type {Array<Record<string, unknown>>} */ (analysisData.localIssues || []),
    codeYear,
  );
  const ibcChecklist = analysisData.ibcChecklist ?? analysisData.checklist;
  const localChecklist = analysisData.localChecklist ?? analysisData.checklist;
  return {
    ibc: {
      issues: ibcIssues,
      checklist: ibcChecklist,
      summary: buildSummary(
        ibcIssues,
        /** @type {number | undefined} */ (analysisData.ibcOverallScore),
        ibcChecklist,
      ),
      jurisdictionNotes:
        typeof analysisData.ibcJurisdictionNotes === "string"
          ? analysisData.ibcJurisdictionNotes
          : "",
    },
    local: {
      issues: localIssues,
      checklist: localChecklist,
      summary: buildSummary(
        localIssues,
        /** @type {number | undefined} */ (analysisData.localOverallScore),
        localChecklist,
      ),
      jurisdictionNotes:
        typeof analysisData.localJurisdictionNotes === "string"
          ? analysisData.localJurisdictionNotes
          : "",
    },
  };
}

/**
 * Graphic quotes returned by image understanding. These are evidence, not findings.
 * @param {Record<string, unknown>} analysisData
 * @returns {string[]}
 */
function collectObservedEvidence(analysisData) {
  const quotes = [];
  for (const key of ["observedEvidence", "graphicEvidence", "ibcObservedEvidence", "localObservedEvidence"]) {
    const value = analysisData?.[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) quotes.push(item.trim());
      }
    } else if (typeof value === "string" && value.trim()) {
      quotes.push(value.trim());
    }
  }
  return quotes;
}

/**
 * @param {import("openai").OpenAI} openai
 * @param {{
 *   imageBase64: string;
 *   imageType?: string;
 *   jurisdiction?: string | null;
 *   projectType?: string;
 *   codeYear?: string;
 *   codeType?: string;
 *   analysisInstructions?: string | null;
 *   specChunks?: Array<{ sectionNumber?: string; sectionTitle?: string; pageStart?: number; pageEnd?: number; text?: string }> | null;
 *   sheetTitle?: string | null;
 *   discipline?: string | null;
 *   pageText?: string | null;
 *   contentClass?: string | null;
 *   sheetIndex?: Array<{ fileName?: string | null; contentClass?: string | null; title?: string | null; excerpt?: string | null; sheetId?: string | null }> | null;
 *   sheetId?: string | null;
 *   jurisdictionDiagnostics?: Record<string, unknown> | null;
 *   reviewContext?: string | null;
 *   jurisdictionScope?: Record<string, unknown> | null;
 *   drawingRecords?: Array<Record<string, unknown>>;
 *   observations?: Array<Record<string, unknown>>;
 *   regions?: Array<Record<string, unknown>>;
 *   regionImages?: Array<{ imageBase64: string; imageType?: string; label?: string }>;
 *   fileName?: string | null;
 *   logInfo?: (msg: string, extra?: string) => void;
 *   logError?: (msg: string, extra?: string) => void;
 *   downscaleFn?: typeof downscaleImageBase64;
 * }} params
 */
async function analyzeDrawingWithOpenAI(params) {
  const {
    openai,
    imageBase64,
    imageType = "image/png",
    jurisdiction,
    projectType,
    codeYear = "2021",
    codeType = "ibc",
    analysisInstructions = null,
    specChunks = null,
    sheetTitle = null,
    discipline = null,
    pageText = null,
    contentClass = null,
    sheetIndex = null,
    sheetId = null,
    jurisdictionDiagnostics = null,
    reviewContext = null,
    jurisdictionScope = null,
    drawingRecords = null,
    drawingRetrieval = null,
    codeVerification = null,
    observations = null,
    regions = null,
    regionImages = null,
    fileName = null,
    graphicalReadStatus = null,
    structuredDrawing = null,
    logInfo = console.log,
    logError = console.error,
    downscaleFn = downscaleImageBase64,
  } = params;

  const resolvedCodeType = codeType === "local" || codeType === "both" ? codeType : "ibc";
  const qualityCtx = {
    sheetTitle,
    sheetId,
    specChunks,
    pageText,
    contentClass,
    sheetIndex,
    fileName: fileName || sheetTitle,
    jurisdictionDiagnostics,
    jurisdictionScope,
    drawingRecords,
    drawingRetrieval,
    authoritativeCode: (codeVerification?.provisions || []).filter(
      (item) => item.authoritative === true && item.sourceStatus === "verified_text",
    ),
    legalApplicability: codeVerification?.legalApplicability || null,
    codeCoverage: codeVerification?.coverage || null,
    projectType,
    observations,
    regions,
    graphicalReadStatus,
    structuredDrawing,
  };

  const legal = codeVerification?.legalApplicability || null;
  const verifiedContext = legal
    ? [
        `Review scope: ${legal.reviewScope || "reference_only"}.`,
        `Legal determination: ${legal.status || "unavailable"}.`,
        `Selected edition: ${legal.selectedEdition || codeYear}.`,
        `Verified adopted code: ${legal.adoptedEdition || "unavailable"}; base code: ${legal.adoptedBaseCode || "unavailable"}.`,
        legal.officialSourceUrl ? `Official source: ${legal.officialSourceUrl}.` : "",
        legal.warning || "",
        codeVerification?.coverage
          ? `Authoritative source coverage: ${codeVerification.coverage.status}; enforceable provisions loaded: ${codeVerification.coverage.enforceableProvisionCount || 0}.`
          : "",
        "Do not describe this review as legally applicable permit compliance unless review scope is permit_compliance and legal determination is verified.",
      ].filter(Boolean).join("\n")
    : "";
  const combinedReviewContext = [reviewContext, verifiedContext].filter(Boolean).join("\n\n");
  const { systemPrompt, userPrompt, codeType: promptedCodeType } = buildPrompts({
    jurisdiction,
    projectType,
    codeYear,
    codeType,
    analysisInstructions,
    specChunks,
    sheetTitle,
    discipline,
    pageText,
    contentClass,
    sheetIndex,
    reviewContext: combinedReviewContext,
  });

  logInfo("[analyze-drawing] Calling OpenAI GPT-4o Vision...");

  /**
   * @param {{ imageBase64: string; imageType: string; detail: "high" | "low"; retry?: boolean }} attempt
   */
  async function runAttempt(attempt) {
    const { meta } = await callVision(openai, {
      imageBase64: attempt.imageBase64,
      imageType: attempt.imageType,
      systemPrompt,
      userPrompt,
      detail: attempt.detail,
      regionImages,
    });
    logAnalyzeDrawingMeta(logInfo, {
      finishReason: meta.finishReason,
      refusal: meta.refusal,
      usage: meta.usage,
      base64Length: attempt.imageBase64.length,
      imageType: attempt.imageType,
      durationMs: meta.durationMs,
      codeType: promptedCodeType,
      retry: attempt.retry,
    });
    return meta;
  }

  let meta = await runAttempt({
    imageBase64,
    imageType,
    detail: "high",
    retry: false,
  });

  if (isEmptyResponse(meta)) {
    logInfo("[analyze-drawing] Retrying with downscaled image and low vision detail...");
    try {
      const downscaled = await downscaleFn(imageBase64, imageType);
      meta = await runAttempt({
        imageBase64: downscaled.imageBase64,
        imageType: downscaled.imageType,
        detail: "low",
        retry: true,
      });
    } catch (retryErr) {
      logError(
        "[analyze-drawing] Retry downscale failed:",
        retryErr instanceof Error ? retryErr.message : String(retryErr),
      );
    }
  }

  if (isEmptyResponse(meta)) {
    if (meta.refusal) {
      return { ok: false, status: 422, error: REFUSAL_USER_MESSAGE };
    }
    return { ok: false, status: 502, error: EMPTY_USER_MESSAGE };
  }

  let analysisData;
  try {
    analysisData = JSON.parse(meta.content);
  } catch (parseError) {
    logError(
      "[analyze-drawing] Failed to parse OpenAI response:",
      meta.content.substring(0, 500),
    );
    return {
      ok: false,
      status: 500,
      error: "Invalid JSON response from AI model",
    };
  }

  const rawResult =
    promptedCodeType === "both"
      ? formatBothResult(analysisData, codeYear)
      : formatSingleResult(analysisData, codeYear);

  const result = hardenAnalysisResult(rawResult, promptedCodeType, {
    ...qualityCtx,
    observedEvidence: collectObservedEvidence(analysisData),
  });
  result.codeVerification = codeVerification || null;

  const issueCount =
    promptedCodeType === "both"
      ? (result.ibc.summary.totalIssues + result.local.summary.totalIssues)
      : result.summary.totalIssues;

  logInfo(`[analyze-drawing] Analysis complete: ${issueCount} issues found`);
  return { ok: true, status: 200, result, codeType: promptedCodeType };
}

module.exports = {
  REFUSAL_USER_MESSAGE,
  EMPTY_USER_MESSAGE,
  normalizeJurisdictionKey,
  hasLocalAmendmentText,
  buildPrompts,
  buildVisionUserContent,
  formatStaffGuidanceBlock,
  extractChoiceMeta,
  isEmptyResponse,
  downscaleImageBase64,
  analyzeDrawingWithOpenAI,
  formatSingleResult,
  formatBothResult,
  hardenAnalysisResult,
  shouldRunVisualDefectChecks,
};
