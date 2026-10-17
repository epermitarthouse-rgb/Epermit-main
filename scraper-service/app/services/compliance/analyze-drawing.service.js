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
  dc: `WASHINGTON D.C. BUILDING CODE AMENDMENTS (12A DCMR):
The District of Columbia adopts the IBC with the following key amendments:

EGRESS & EXITS:
- 12A DCMR 1004.5: Occupant load calculations for assembly spaces require additional 15% capacity factor
- 12A DCMR 1006.3: Exit access travel distance reduced to 200 ft (unsprinklered) and 250 ft (sprinklered) for B occupancy
- 12A DCMR 1017.2: Corridor width minimum 48" for all occupancies (stricter than IBC 44")

FIRE SAFETY:
- 12A DCMR 903.2.1: Automatic sprinkler systems required in all new buildings over 5,000 sq ft
- 12A DCMR 903.2.9: Group R-2 occupancies require NFPA 13R systems minimum (no 13D allowed in D.C.)
- 12A DCMR 907.2: Fire alarm systems required in buildings over 3 stories (not 4 as in IBC)

ACCESSIBILITY (D.C. Human Rights Act compliance):
- 12A DCMR 1103.2.2: 10% of dwelling units in multi-family must be Type A units (IBC requires 2%)
- 12A DCMR 1107.6: All primary entrances must be accessible (no exemptions for grade changes)
- 12A DCMR 1109.2: D.C. requires grab bars at all water closets in public restrooms

STRUCTURAL:
- 12A DCMR 1604.5: Snow load minimum 30 psf (higher than standard IBC for region)
- 12A DCMR 1609.3: Wind design per ASCE 7 with 115 mph basic wind speed minimum

HISTORIC PRESERVATION (unique to D.C.):
- 12A DCMR 3412: Historic buildings within Historic Districts require HPRB approval
- Work in L'Enfant Plan zones requires additional Historic Preservation Review Board compliance

ENERGY:
- D.C. Green Building Act: Buildings over 10,000 sq ft must meet LEED certification or equivalent
- 12A DCMR C402: Envelope requirements 10% more stringent than IECC`,
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

STAFF GUIDANCE / REVIEW FOCUS (NOT EVIDENCE):
The following notes were provided by staff to guide this review. They are NOT submitted evidence and must NOT be treated as proof of compliance or as facts about the drawing set. Use them only to prioritize or focus your review:
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

function formatContentClassBlock(contentClass) {
  switch (contentClass) {
    case "mep":
      return "\nThis is an MEP sheet (electrical, mechanical, plumbing, or equipment). Do not report architectural egress or accessibility defects.\n";
    case "egress_plan":
      return "\nThis is an egress plan. Limit the review to egress width, capacity, exits, and travel distance this sheet can show.\n";
    case "enlarged_plan":
      return "\nThis is an enlarged plan. Limit the review to dimensions, clearances, and accessories shown at this scale.\n";
    case "elevation":
      return "\nThis is an elevation. Limit the review to heights, openings, and exterior conditions this view can show.\n";
    case "section":
      return "\nThis is a section. Limit the review to assemblies, ratings, and heights this section can show.\n";
    case "floor_plan":
      return "\nThis is a floor plan. Review only conditions this plan can show.\n";
    default:
      return "";
  }
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

function shouldRunVisualDefectChecks(contentClass) {
  return contentClass !== "schedule" && contentClass !== "form";
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
  "checklist": [{"item": "Corridor clear width", "result": "44 in labeled at the corridor", "evidence": "44 in"}],
  "observedEvidence": ["44 in clear", "1-hour wall"],
  "jurisdictionNotes": "Notes about base code requirements reviewed",
  "overallScore": 100
}`;
  } else if (resolvedCodeType === "local") {
    if (hasLocalAmendmentText(jurisdictionKey)) {
      analysisFocus = `Review the drawing for plan-sheet items that may be inconsistent with the jurisdiction amendment summaries below (${jurisdictionCitation}). Cite section labels from those summaries when flagging a concern. If the sheet lacks information needed to evaluate a topic, skip it or use severity "advisory".`;
    } else {
      analysisFocus = `This project uses General IBC — no local amendment text is loaded for this pass. Review only jurisdiction-specific notes that appear on the sheet itself. Do not invent local requirements. If none apply, return an empty issues array and explain in jurisdictionNotes that no local amendment package was selected.`;
    }
    jsonFormat = `{
  "issues": [${issueSchema}],
  "checklist": [{"item": "Corridor clear width", "result": "44 in labeled at the corridor", "evidence": "44 in"}],
  "observedEvidence": ["44 in clear"],
  "jurisdictionNotes": "Notes about local amendment requirements reviewed",
  "overallScore": 100
}`;
  } else {
    analysisFocus = `Perform TWO analyses in one response:
1. IBC/base code issues (cite IBC, IRC, NFPA 101, ADA sections)
2. Local amendment issues (cite ${jurisdictionCitation} where applicable)
${jurisdictionContext ? `\nLOCAL AMENDMENTS:\n${jurisdictionContext}` : ""}`;
    jsonFormat = `{
  "ibcIssues": [${issueSchema}],
  "localIssues": [${issueSchema}],
  "ibcChecklist": [{"item": "Corridor clear width", "result": "44 in labeled at the corridor", "evidence": "44 in"}],
  "localChecklist": [{"item": "Local corridor width", "result": "shown on sheet A-1.04", "evidence": "shown on sheet A-1.04"}],
  "observedEvidence": ["44 in clear"],
  "ibcJurisdictionNotes": "Notes about base IBC requirements",
  "localJurisdictionNotes": "Notes about local amendment requirements",
  "ibcOverallScore": 100,
  "localOverallScore": 100
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
Scoring: overallScore is 0-100 only after a real review. Every checklist item must include a non-empty evidence quote from this sheet (a dimension, a label, a note, or "shown on sheet <id>"). If checklist is empty and issues is empty, the sheet was not reviewed — do not set overallScore to 100. A generic checklist or "no failing condition" without that quote is not a pass. If any issue remains, overallScore must not be 100. Do not echo 85.
${formatContentClassBlock(contentClass)}${formatSheetIndexBlock(sheetIndex)}${formatSpecContextBlock(specChunks)}${formatStaffGuidanceBlock(analysisInstructions)}
${formatExtractedPageText(pageText)}
${sheetTitle ? `\nSheet under review: ${sheetTitle}` : ""}${discipline ? `\nDiscipline: ${discipline}` : ""}

You MUST respond with a valid JSON object in exactly this format:
${jsonFormat}`;

  const scopedReview =
    contentClass === "mep"
      ? "Review this MEP sheet only for conditions this discipline shows. Do not report architectural egress or accessibility defects."
      : contentClass === "elevation"
        ? "Review this elevation only for heights, openings, and exterior conditions this view can show."
        : contentClass === "section"
          ? "Review this section only for assemblies, ratings, and heights this section can show."
          : contentClass === "egress_plan"
            ? "Review this egress plan for egress width, capacity, exits, and travel distance shown on this sheet."
            : contentClass === "enlarged_plan"
              ? "Review this enlarged plan for dimensions, clearances, and accessories shown at this scale."
              : contentClass === "floor_plan"
                ? "Review this floor plan for egress, fire separation, accessibility, and occupancy conditions this plan can show."
                : null;

  const userPrompt = scopedReview
    ? `${scopedReview} Return ONLY valid JSON.`
    : resolvedCodeType === "local"
      ? `Review this architectural plan sheet for building code compliance in the local-amendment scope described above. Report only concerns visible in the drawing with citation labels from the reference summaries when applicable. Return ONLY valid JSON.`
      : resolvedCodeType === "both"
        ? `Review this architectural plan sheet for building code compliance (base code and local amendments as described above). Report only concerns visible in the drawing with specific code citations. Return ONLY valid JSON.`
        : `Analyze this architectural drawing for building code compliance issues.
Look for violations related to egress, fire separation, accessibility, occupancy, stairs, emergency systems, and structural concerns visible in the plans.
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
 * @param {import("openai").OpenAI} openai
 * @param {{
 *   imageBase64: string;
 *   imageType: string;
 *   systemPrompt: string;
 *   userPrompt: string;
 *   detail: "high" | "low";
 * }} params
 */
async function callVision(openai, params) {
  const start = Date.now();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: params.systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: params.userPrompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${params.imageType};base64,${params.imageBase64}`,
              detail: params.detail,
            },
          },
        ],
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
    jurisdictionDiagnostics,
  };

  if (!shouldRunVisualDefectChecks(contentClass)) {
    const note =
      contentClass === "schedule"
        ? "This sheet is a schedule. It was not sent through visual architectural-defect checks."
        : "This sheet is a form or certificate. It was not sent through visual architectural-defect checks.";
    const emptyBundle = { issues: [], checklist: [], summary: {}, jurisdictionNotes: note };
    const rawResult =
      resolvedCodeType === "both"
        ? { ibc: { ...emptyBundle }, local: { ...emptyBundle } }
        : emptyBundle;
    const result = hardenAnalysisResult(rawResult, resolvedCodeType, qualityCtx);
    logInfo(`[analyze-drawing] Skipped visual checks for content class ${contentClass}`);
    return { ok: true, status: 200, result, codeType: resolvedCodeType };
  }

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
