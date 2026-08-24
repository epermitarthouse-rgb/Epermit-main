"use strict";

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
  const raw = jurisdiction?.toLowerCase().replace(/\s+/g, "-") || "general";
  return JURISDICTION_ALIASES[raw] || raw;
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

function formatStaffGuidanceBlock(analysisInstructions) {
  const text = typeof analysisInstructions === "string" ? analysisInstructions.trim() : "";
  if (!text) return "";
  return `

STAFF GUIDANCE / REVIEW FOCUS (NOT EVIDENCE):
The following notes were provided by staff to guide this review. They are NOT submitted evidence and must NOT be treated as proof of compliance or as facts about the drawing set. Use them only to prioritize or focus your review:
${text}`;
}

/**
 * @param {{
 *   jurisdiction?: string | null;
 *   projectType?: string;
 *   codeYear?: string;
 *   codeType?: string;
 *   analysisInstructions?: string | null;
 * }} params
 */
function buildPrompts(params) {
  const {
    jurisdiction,
    projectType = "Commercial",
    codeYear = "2021",
    codeType = "ibc",
    analysisInstructions = null,
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
      "codeReference": "Specific code section reference",
      "codeYear": "${codeYear}",
      "location": "Location in the drawing",
      "suggestedFix": "Recommended fix for the issue"
    }`;

  let analysisFocus = "";
  let jsonFormat = "";

  if (resolvedCodeType === "ibc") {
    analysisFocus = `Analyze ONLY against base International Building Code (IBC), IRC, NFPA 101, and ADA.
Do NOT apply local jurisdiction amendments in this pass. Cite IBC or national standard sections.`;
    jsonFormat = `{
  "issues": [${issueSchema}],
  "jurisdictionNotes": "Notes about base code requirements reviewed",
  "overallScore": 100
}`;
  } else if (resolvedCodeType === "local") {
    analysisFocus = jurisdictionContext
      ? `Analyze ONLY against LOCAL jurisdiction amendments (${jurisdictionCitation}). Apply amendments that may be MORE RESTRICTIVE than base IBC. Cite ${jurisdictionCitation} sections.`
      : `Analyze for jurisdiction-specific requirements. No local amendment text was provided; note limitations in jurisdictionNotes.`;
    jsonFormat = `{
  "issues": [${issueSchema}],
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
  "ibcJurisdictionNotes": "Notes about base IBC requirements",
  "localJurisdictionNotes": "Notes about local amendment requirements",
  "ibcOverallScore": 100,
  "localOverallScore": 100
}`;
  }

  const systemPrompt = `You are an expert building code compliance analyst with deep knowledge of:
- International Building Code (IBC) 2018, 2021, 2024
- International Residential Code (IRC) 2018, 2021, 2024
- NFPA 101 Life Safety Code
- ADA Accessibility Guidelines
- State and local amendments including NYC BC, California CBC, Florida FBC, Chicago BC, and D.C. 12A DCMR

${resolvedCodeType === "ibc" ? "" : jurisdictionContext}

${analysisFocus}

For each issue found, provide category, title, description, severity, code reference, location, and suggested fix.
Consider jurisdiction: ${jurisdiction || "General IBC"} and project type: ${projectType}.
Use code year: ${codeYear}.
Be thorough but avoid false positives. Only report genuine code compliance concerns visible in the drawing.
Scoring: overallScore is 0-100. If issues is an empty array, overallScore MUST be 100. Do not invent a partial score when there are no findings.
${formatStaffGuidanceBlock(analysisInstructions)}

You MUST respond with a valid JSON object in exactly this format:
${jsonFormat}`;

  const userPrompt = `Analyze this architectural drawing for building code compliance issues.
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
function buildSummary(issues, overallScore) {
  const critical = issues.filter((i) => i.severity === "critical").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const advisory = issues.filter((i) => i.severity === "advisory").length;
  const computed =
    issues.length === 0
      ? 100
      : Math.max(0, 100 - critical * 20 - warnings * 10 - advisory * 3);
  return {
    totalIssues: issues.length,
    critical,
    warnings,
    advisory,
    // Never trust an AI-echoed exemplar score (e.g. 85) when there are zero issues.
    overallScore:
      issues.length === 0
        ? 100
        : typeof overallScore === "number"
          ? overallScore
          : computed,
  };
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
  return {
    issues,
    summary: buildSummary(issues, /** @type {number | undefined} */ (analysisData.overallScore)),
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
  return {
    ibc: {
      issues: ibcIssues,
      summary: buildSummary(
        ibcIssues,
        /** @type {number | undefined} */ (analysisData.ibcOverallScore),
      ),
      jurisdictionNotes:
        typeof analysisData.ibcJurisdictionNotes === "string"
          ? analysisData.ibcJurisdictionNotes
          : "",
    },
    local: {
      issues: localIssues,
      summary: buildSummary(
        localIssues,
        /** @type {number | undefined} */ (analysisData.localOverallScore),
      ),
      jurisdictionNotes:
        typeof analysisData.localJurisdictionNotes === "string"
          ? analysisData.localJurisdictionNotes
          : "",
    },
  };
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
    logInfo = console.log,
    logError = console.error,
    downscaleFn = downscaleImageBase64,
  } = params;

  const { systemPrompt, userPrompt, codeType: resolvedCodeType } = buildPrompts({
    jurisdiction,
    projectType,
    codeYear,
    codeType,
    analysisInstructions,
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
      codeType: resolvedCodeType,
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

  const result =
    resolvedCodeType === "both"
      ? formatBothResult(analysisData, codeYear)
      : formatSingleResult(analysisData, codeYear);

  const issueCount =
    resolvedCodeType === "both"
      ? (result.ibc.summary.totalIssues + result.local.summary.totalIssues)
      : result.summary.totalIssues;

  logInfo(`[analyze-drawing] Analysis complete: ${issueCount} issues found`);
  return { ok: true, status: 200, result, codeType: resolvedCodeType };
}

module.exports = {
  REFUSAL_USER_MESSAGE,
  EMPTY_USER_MESSAGE,
  normalizeJurisdictionKey,
  buildPrompts,
  formatStaffGuidanceBlock,
  extractChoiceMeta,
  isEmptyResponse,
  downscaleImageBase64,
  analyzeDrawingWithOpenAI,
  formatSingleResult,
  formatBothResult,
};
