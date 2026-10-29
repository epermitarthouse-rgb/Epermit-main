/**
 * Persist-time checks for new Supabase Code Analyzer findings.
 * Historical rows are not read or rewritten here.
 * Edition checks use the jurisdiction registry snapshot and are not legal verification.
 */
import {
  DC_2017_REGISTRY_SNAPSHOT,
  isDc2017AnalyzerContext,
  type StoredAnalysisMode,
} from "./analyzerReviewScope.ts";

export interface SubmittedSheetRef {
  fileName: string;
  detectedSheetNumber?: string | null;
  detectedSheetTitle?: string | null;
  discipline?: string | null;
}

export interface DraftAnalyzerFinding {
  category: string;
  severity: string;
  title: string;
  observation: string;
  drawing_evidence: string;
  drawing_location: string;
  suggested_code_reference: string;
  recommendation: string;
}

export interface FindingValidationAudit {
  outcome: "accepted" | "adjusted";
  rules: string[];
  originalSeverity: string;
  originalTitle: string;
  originalObservation: string;
  originalCodeReference: string;
  publishedSeverity: string;
  publishedCodeReference: string | null;
  citationIssues: string[];
  editionMappingApplied: boolean;
  independentlyVerified: false;
  coverageLimitation: string | null;
}

export interface PublishedAnalyzerFinding extends DraftAnalyzerFinding {
  severity: "critical" | "warning" | "advisory";
  suggested_code_reference: string | null;
  verification_status: "proposed_reference" | "unresolved_reference";
  validation: FindingValidationAudit;
}

export interface WithheldAnalyzerFinding {
  title: string;
  originalSeverity: string;
  originalCodeReference: string;
  rules: string[];
}

export interface AnalyzerValidationContext {
  analysisMode: StoredAnalysisMode | null;
  jurisdictionKey: string;
  jurisdictionLabel: string;
  codeEdition: string;
  codeContext: string;
  sheetIndex: SubmittedSheetRef[];
  sheetDiscipline?: string | null;
}

interface FamilyRecord {
  canonical: string;
  edition: string;
  discipline: string;
  patterns: RegExp[];
}

const SHEET_TOKEN_SOURCE = "\\b([A-Z]{1,4})\\s*[- ]?\\s*(\\d{1,3}\\.\\d{1,3})(?:\\s*-\\s*00)?\\b|\\b([A-Z]{1,4})\\s*-\\s*(\\d{1,3})(?:\\s*-\\s*00)?\\b";
const SECTION_PHRASE = /\b((?:section|sec\.?|article|art\.?|chapter|ch\.?)\s+[0-9]{1,4}(?:\.[0-9]+)*)/i;
const REQUIREMENT_LANGUAGE = /\b(must|shall|required to|is required|are required|are to be|to be provided|shall be)\b/i;
const DISCREPANCY_LANGUAGE = /\b(not shown|not provided|not indicated|not specified|not detailed|missing|omitted|absent|conflicts?|contradict\w*|inconsistenc\w*|does not|doesn't|do not match|fails? to|contrary|discrepanc\w*|no indication|cannot be verified|illegible|less than the required|greater than the (?:allowed|maximum|required)|exceeds the|not the lesser|below the lesser)\b/i;
const PROJECT_ABSENCE = /\b(?:not included here|not included in (?:the )?(?:set|project|submission|package|drawings)|not in the (?:submitted )?(?:set|project|package)|missing from the (?:set|project|drawings)|not part of the (?:set|project)|was not submitted|are not included|is not included)\b/i;
const SHEET_LOCAL_ABSENCE = /\b(?:not visible on (?:the |this )?(?:drawing|sheet|plan)|absence of|absent from (?:the |this )?(?:drawing|sheet|plan)|not (?:visibly )?(?:shown|provided|indicated|specified|detailed|described)(?:\s+on (?:the |this )?(?:drawing|sheet|plan))?|lacks? (?:detailed|specific)|do not describe|does not (?:provide|describe|detail)|are not (?:visibly )?detailed)\b/i;
const CROSS_SHEET_POINTER = /\b(?:see|refer(?:ence)?\s+to|refer)\b[^.\n]{0,40}\b(?:sheet|drawing|detail)\b|\bsee\s+detail\b|\bdetail\s+\d+\s+on\s+drawing\b/i;
const LARGER_GOVERNS = /potential discrepancy|discrepancy in flow|maximum flow|potential maximum|larger (?:of the two|flow|value|result)|accommodate the potential maximum|might govern|should govern/i;
const SELECTION_ERROR = /not the lesser|exceeds the (?:printed )?lesser|greater than the lesser|below the lesser|less than the lesser|does not (?:equal|follow|match) the (?:lesser|governing)/i;
const HYDRAULIC_DENSITY_AREA = /\bdensity\b/i;
const HYDRAULIC_FLOW_DEMAND = /\bflow\s+demand\b/i;
const HYDRAULIC_INCONSISTENCY = /\b(?:inconsistenc\w*|should be|calculated flow|density\s*[×x*]\s*|gpm\s*per\s*square\s*foot)\b/i;
const PRESENT_SPEC_SIGNAL = /\b(?:#\s*\d+\s*@|rebar|reinforc\w+|dowels?|armaflex|foam insulation|batt insulation|joint reinforcement|k-factor|hose allowance)\b/i;
const ABSENCE_OF_SPEC = /\b(?:not (?:visibly )?(?:provide|provided|specified|detailed|described)|do not describe|does not (?:provide|describe|detail)|absence of|missing|lacks?)\b/i;
const MEP_DISCIPLINES = new Set(["electrical", "plumbing", "mechanical", "fire", "fuel_gas"]);

function oneLine(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function familyRecords(): FamilyRecord[] {
  const records: FamilyRecord[] = DC_2017_REGISTRY_SNAPSHOT.baseCodes.map((code) => ({
    canonical: code.family,
    edition: code.edition,
    discipline: code.discipline,
    patterns: [new RegExp(`\\b${escapeRegExp(code.family)}\\b`, "i")],
  }));
  const electrical = records.find((record) => record.canonical === "NEC");
  const nfpa = DC_2017_REGISTRY_SNAPSHOT.referencedStandards.find((item) => item.family === "NFPA 70");
  if (electrical && nfpa && nfpa.edition === electrical.edition) {
    records.push({
      canonical: "NFPA 70",
      edition: nfpa.edition,
      discipline: electrical.discipline,
      patterns: [/\bNFPA\s*70\b/i],
    });
  }
  return records;
}

function sheetTokenPattern(): RegExp {
  return new RegExp(SHEET_TOKEN_SOURCE, "gi");
}

export function sheetIdentityKeys(value: string | null | undefined): string[] {
  if (!value) return [];
  const cleaned = value.toUpperCase().replace(/\.PDF\b/g, " ");
  const keys = new Set<string>();
  for (const match of cleaned.matchAll(sheetTokenPattern())) {
    const prefix = match[1] || match[3];
    const number = match[2] || match[4];
    if (prefix && number) keys.add(`${prefix}${number}`);
  }
  return [...keys];
}

function sheetRefs(text: string): Array<{ key: string; display: string }> {
  const found = new Map<string, string>();
  for (const match of text.toUpperCase().matchAll(sheetTokenPattern())) {
    const prefix = match[1] || match[3];
    const number = match[2] || match[4];
    if (!prefix || !number) continue;
    found.set(`${prefix}${number}`, match[0].replace(/\s+/g, ""));
  }
  return [...found.entries()].map(([key, display]) => ({ key, display }));
}

function keysForSheet(sheet: SubmittedSheetRef): string[] {
  return [
    ...sheetIdentityKeys(sheet.fileName),
    ...sheetIdentityKeys(sheet.detectedSheetNumber),
  ];
}

export function formatSubmittedSheetIndex(sheets: SubmittedSheetRef[], currentFileName: string): string {
  if (!sheets.length) {
    return "Submitted sheet index: unavailable. Do not claim that a referenced sheet is absent from the project.";
  }
  const current = currentFileName.trim().toLowerCase();
  const lines = sheets.slice(0, 100).map((sheet) => {
    const name = oneLine(sheet.fileName, 120);
    const number = oneLine(sheet.detectedSheetNumber || "", 40);
    const title = oneLine(sheet.detectedSheetTitle || "", 80);
    const marker = name.toLowerCase() === current ? " | current sheet" : "";
    return `- ${number || "number not detected"} | ${name}${title ? ` | ${title}` : ""}${marker}`;
  });
  return [
    "Submitted sheet index (filenames and detected numbers only; other sheets were not read in this request):",
    ...lines,
    "If a note refers to a sheet on this index, that sheet is in the project. Do not report it as missing. Do not treat its listing as proof of compliance.",
  ].join("\n");
}

export function buildAnalyzerUserPrompt(
  fileName: string,
  sheets: SubmittedSheetRef[],
  options: { crossSheetEvidence?: string | null } = {},
): string {
  const parts = [
    "Review this permit drawing sheet and return the structured preliminary observations.",
    `Current file: ${oneLine(fileName, 180)}`,
    formatSubmittedSheetIndex(sheets, fileName),
  ];
  const evidence = options.crossSheetEvidence?.trim();
  if (evidence) parts.push(evidence);
  return parts.join("\n\n");
}

function gpmTokens(text: string): string[] {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*gpm\b/gi)].map((match) => match[1]);
}

function uniqueGpmTokens(text: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of gpmTokens(text)) {
    const key = String(Number(token));
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

function isUnsupportedFlowAllegation(finding: DraftAnalyzerFinding): boolean {
  const combined = `${finding.title}\n${finding.observation}\n${finding.drawing_evidence}\n${finding.recommendation}`;
  const flows = uniqueGpmTokens(combined);
  if (flows.length < 2) return false;
  if (SELECTION_ERROR.test(combined)) return false;
  const evidence = `${finding.observation} ${finding.drawing_evidence}`;
  const allegation = `${finding.title} ${finding.observation} ${finding.recommendation}`;
  if (!LARGER_GOVERNS.test(allegation)) return false;
  const lesserStated = /lesser[\s-]*of|smaller of|whichever is (?:less|smaller|lower)/i.test(evidence);
  const ruleStated = lesserStated || /governing method|selection method|formula|equation/i.test(evidence);
  return lesserStated || !ruleStated;
}

function neutralizeFlowAllegation(finding: DraftAnalyzerFinding): DraftAnalyzerFinding {
  const flows = uniqueGpmTokens(`${finding.title}\n${finding.observation}\n${finding.drawing_evidence}\n${finding.recommendation}`);
  const listed = flows.length >= 2 ? `${flows[0]} GPM and ${flows[1]} GPM` : "the stated flows";
  const lesserStated = /lesser[\s-]*of|smaller of|whichever is (?:less|smaller|lower)/i.test(
    `${finding.observation} ${finding.drawing_evidence}`,
  );
  const observation = lesserStated
    ? `The drawing states a lesser-of selection method for the intermediate values ${listed}. That difference is not itself a demonstrated sizing discrepancy, and the larger value is not treated as governing.`
    : `The drawing shows intermediate values ${listed}. The supplied evidence does not state a governing selection method, so the larger value is not treated as a code violation.`;
  return {
    ...finding,
    severity: "advisory",
    title: "Intermediate flow comparison",
    observation,
    recommendation: "Use the selection method printed on the sheet before comparing these intermediate values.",
  };
}

function resolveSheetReferences(text: string, sheets: SubmittedSheetRef[]) {
  const resolved: SubmittedSheetRef[] = [];
  const unresolved: string[] = [];
  const seenSheets = new Set<string>();
  for (const ref of sheetRefs(text)) {
    const sheet = sheets.find((item) => keysForSheet(item).includes(ref.key));
    if (sheet) {
      if (!seenSheets.has(sheet.fileName)) {
        seenSheets.add(sheet.fileName);
        resolved.push(sheet);
      }
    } else {
      unresolved.push(ref.display);
    }
  }
  return { resolved, unresolved };
}

/**
 * Cross-sheet uncertainty is a verification limit, not proof of a false positive.
 * Do not rewrite client-facing text or downgrade severity solely because a referenced
 * sheet was not opened in this request. Record the limitation via the returned rule.
 */
function adjustCrossSheet(finding: DraftAnalyzerFinding, sheets: SubmittedSheetRef[]): { finding: DraftAnalyzerFinding; rule: string | null } {
  const text = `${finding.title} ${finding.observation} ${finding.drawing_evidence} ${finding.recommendation}`;
  const projectAbsence = PROJECT_ABSENCE.test(text);
  const localAbsence = SHEET_LOCAL_ABSENCE.test(text);
  const hasPointer = CROSS_SHEET_POINTER.test(text);
  if (!projectAbsence && !(localAbsence && hasPointer)) return { finding, rule: null };
  const { resolved, unresolved } = resolveSheetReferences(text, sheets);
  if (resolved.length) {
    const detailPointer = hasPointer && localAbsence;
    return {
      rule: detailPointer ? "cross_sheet_detail_not_reviewed" : "cross_sheet_reference_in_set",
      finding,
    };
  }
  if (!unresolved.length) return { finding, rule: null };
  return {
    rule: "cross_sheet_reference_unresolved",
    finding,
  };
}

function crossSheetCoverageNote(rules: string[]): string | null {
  if (!rules.some((rule) => rule.startsWith("cross_sheet_"))) return null;
  return "Referenced sheet content was not reviewed in this request. Severity was not changed solely for that unread cross-sheet reference. Absence from the project and compliance are both unverified.";
}

function parseGpmValues(text: string): number[] {
  return uniqueGpmTokens(text).map((token) => Number(token)).filter((value) => Number.isFinite(value));
}

function parseAreaSqFt(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:ft(?:\u00b2|2)|sq\.?\s*ft|square\s*feet)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseDensityGpmPerSqFt(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*gpm(?:\s*\/\s*(?:ft(?:\u00b2|2)|sq\.?\s*ft)|\s*per\s*square\s*foot)?/i);
  // Prefer an explicit density near the word density.
  const densityNear = text.match(/density[^0-9]{0,24}(\d+(?:\.\d+)?)/i);
  if (densityNear) {
    const value = Number(densityNear[1]);
    if (Number.isFinite(value) && value > 0 && value < 5) return value;
  }
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 && value < 5 ? value : null;
}

/**
 * Detects the recurring false-positive where density×discharge area is treated as FLOW DEMAND.
 * Does not suppress legitimate hydraulic conflicts that cite governing selection errors.
 */
export function isDensityAreaFlowDemandAllegation(finding: DraftAnalyzerFinding): boolean {
  const combined = `${finding.title}\n${finding.observation}\n${finding.drawing_evidence}\n${finding.recommendation}`;
  if (!HYDRAULIC_DENSITY_AREA.test(combined) || !HYDRAULIC_FLOW_DEMAND.test(combined)) return false;
  if (!HYDRAULIC_INCONSISTENCY.test(combined)) return false;
  if (SELECTION_ERROR.test(combined)) return false;
  const area = parseAreaSqFt(combined);
  const density = parseDensityGpmPerSqFt(combined);
  const flows = parseGpmValues(combined);
  if (area && density && flows.length >= 2) {
    const product = density * area;
    const matchesProduct = flows.some((flow) => Math.abs(flow - product) <= Math.max(1, product * 0.02));
    const hasLargerFlow = flows.some((flow) => flow > product * 1.05);
    if (matchesProduct && hasLargerFlow) return true;
  }
  // Linguistic fallback when units are incomplete but the finding equates density×area to demand.
  return /\b(?:density\s*[×x*]\s*(?:area|discharge)|calculated flow should be|should be\s+\d+(?:\.\d+)?\s*gpm)\b/i.test(combined);
}

function neutralizeDensityAreaFlowDemand(finding: DraftAnalyzerFinding): DraftAnalyzerFinding {
  const combined = `${finding.observation} ${finding.drawing_evidence}`;
  const hose = /\bhose\s+allowance\b/i.test(combined);
  const observation = hose
    ? "The hydraulic summary lists density, discharge area, hose allowance, and FLOW DEMAND as related but distinct values. Density × discharge area is the density-area sprinkler quantity, not proof that FLOW DEMAND is inconsistent."
    : "The hydraulic summary's density × discharge area quantity is not the same as total FLOW DEMAND from a hydraulic calculation. Different values alone do not establish an inconsistency without the governing hydraulic method.";
  return {
    ...finding,
    severity: "advisory",
    title: "Hydraulic density-area versus flow demand",
    observation,
    recommendation: "Review the full hydraulic calculation (including hose allowance and supply analysis) before treating density × area and FLOW DEMAND as a conflict.",
  };
}

function evidenceContradictsAbsenceClaim(finding: DraftAnalyzerFinding): boolean {
  const claim = `${finding.title} ${finding.observation} ${finding.recommendation}`;
  const evidence = finding.drawing_evidence || "";
  if (!ABSENCE_OF_SPEC.test(claim) && !SHEET_LOCAL_ABSENCE.test(claim)) return false;
  if (!PRESENT_SPEC_SIGNAL.test(evidence)) return false;
  // Notes that state sizes do not prove graphic detail drawings exist; keep those concerns prioritized.
  const detailDrawingGap = /\b(?:not (?:visibly )?detailed|missing (?:detail|section|drawing)s?|detail(?:s)?\b.*\b(?:missing|not|absent)|provide detailed)\b/i.test(claim);
  // Evidence already states the kind of specification the finding says is missing.
  if (/\breinforc|rebar|#\s*\d+\s*@|dowel/i.test(evidence) && /\breinforc|foundation|masonry/i.test(claim)) {
    if (detailDrawingGap) return false;
    return true;
  }
  if (/\binsulat|armaflex/i.test(evidence) && /\binsulat|refrigerant|armaflex/i.test(claim)) {
    return true;
  }
  if (/\bhose allowance\b/i.test(evidence) && /\bhose|flow demand|hydraulic/i.test(claim)) {
    return true;
  }
  if (detailDrawingGap) return false;
  return PRESENT_SPEC_SIGNAL.test(evidence) && ABSENCE_OF_SPEC.test(claim);
}

function neutralizePresenceContradiction(finding: DraftAnalyzerFinding): DraftAnalyzerFinding {
  return {
    ...finding,
    severity: "advisory",
    title: "Specification appears in the cited evidence",
    observation: "The cited drawing evidence already includes specification content related to this topic. A missing-specification conclusion is not established from that evidence alone.",
    recommendation: "Re-read the cited notes or details and identify any remaining gap that is not already stated in the quoted evidence.",
  };
}


function keynoteCitationMismatch(finding: DraftAnalyzerFinding): boolean {
  const location = `${finding.drawing_location} ${finding.observation}`;
  const noteMatch = location.match(/\bnotes?\s*(?:#|number|no\.?)?\s*(\d{1,2})\b/i)
    || location.match(/\b(?:keyed\s+notes?,?\s*)?(?:note)\s+(\d{1,2})\b/i);
  if (!noteMatch) return false;
  const cited = noteMatch[1];
  const evidence = finding.drawing_evidence || "";
  if (!/\b(?:keyed\s+)?notes?\b/i.test(`${finding.drawing_location} ${evidence}`)) return false;
  // If evidence clearly leads with a different boxed/numbered note, flag mismatch.
  const evidenceNote = evidence.match(/(?:^|\n|\s)(\d{1,2})(?:\s*[\].:]|\s+)/);
  if (!evidenceNote) {
    // No note number recovered in evidence while location asserts one.
    return !new RegExp(`\\b${cited}\\b`).test(evidence);
  }
  return evidenceNote[1] !== cited && !new RegExp(`\\b${cited}\\b`).test(evidence);
}

function neutralizeKeynoteMismatch(finding: DraftAnalyzerFinding): DraftAnalyzerFinding {
  return {
    ...finding,
    severity: "advisory",
    title: "Keynote citation needs confirmation",
    observation: "The finding cites a keyed-note number that is not supported by the quoted drawing evidence. The note citation and the numbered note text on the sheet need to agree.",
    recommendation: "Confirm the keyed-note number against the sheet before treating the specification as missing or deficient.",
  };
}

function tokenOverlap(leftText: string, rightText: string): number {
  const tokens = (value: string) => new Set(
    value.toLowerCase().replace(/[^a-z0-9.]+/g, " ").split(/\s+/).filter((word) => word.length > 3),
  );
  const left = tokens(leftText);
  const right = tokens(rightText);
  if (left.size < 4 || right.size < 4) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function isDocumentedRequirement(finding: DraftAnalyzerFinding): boolean {
  const severity = finding.severity.trim().toLowerCase();
  // Critical/warning only: expanding to advisory over-withholds legitimate discrepancy advisories.
  // Advisory note-restatement remains a tracked regression (see qualityBenchmark GFCI cases).
  if (severity !== "critical" && severity !== "warning") return false;
  const blob = `${finding.title} ${finding.observation} ${finding.drawing_evidence}`;
  if (DISCREPANCY_LANGUAGE.test(blob)) return false;
  const statesRequirement = REQUIREMENT_LANGUAGE.test(finding.observation) || REQUIREMENT_LANGUAGE.test(finding.drawing_evidence);
  return statesRequirement || tokenOverlap(finding.observation, finding.drawing_evidence) >= 0.6;
}

function signalScore(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function inferDiscipline(finding: DraftAnalyzerFinding, sheetDiscipline?: string | null): string | null {
  const text = `${finding.category} ${finding.title} ${finding.observation} ${finding.drawing_evidence}`;
  const scores: Array<[string, number]> = [
    ["electrical", signalScore(text, /\b(gfci|receptacles?|circuit breakers?|panelboards?|panel schedule|conduits?|luminaires?|branch circuits?|nec|electrical)\b/gi)],
    ["plumbing", signalScore(text, /\b(grease interceptors?|gpm|shut-?off valves?|balancing valves?|sanitary|water closets?|domestic water|ipc|plumbing)\b/gi)],
    ["mechanical", signalScore(text, /\b(kitchen hoods?|exhaust fans?|hood\/fan|interlocks?|cfm|hvac|imc|mechanical)\b/gi)],
    ["fire", signalScore(text, /\b(sprinklers?|fire extinguishers?|standpipes?|fire pumps?|ifc|fire protection)\b/gi)],
    ["building", signalScore(text, /\b(means of egress|exit doors?|occupant loads?|guardrails?|stairways?|door schedules?|ibc)\b/gi)],
  ];
  scores.sort((left, right) => right[1] - left[1]);
  if (scores[0][1] > 0 && scores[0][1] !== scores[1][1]) return scores[0][0];
  const label = (sheetDiscipline || "").toLowerCase();
  if (label.includes("electric")) return "electrical";
  if (label.includes("plumb")) return "plumbing";
  if (label.includes("mech") || label.includes("hvac")) return "mechanical";
  if (label.includes("fire")) return "fire";
  if (label.includes("fuel")) return "fuel_gas";
  return null;
}

function matchFamily(reference: string): { record: FamilyRecord; index: number; length: number } | null {
  let best: { record: FamilyRecord; index: number; length: number } | null = null;
  for (const record of familyRecords()) {
    for (const pattern of record.patterns) {
      const match = pattern.exec(reference);
      if (!match || match.index === undefined) continue;
      if (!best || match.index < best.index) {
        best = { record, index: match.index, length: match[0].length };
      }
    }
  }
  return best;
}

function closestYear(reference: string, index: number): string | null {
  let best: { year: string; distance: number } | null = null;
  for (const match of reference.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    const distance = Math.abs((match.index ?? 0) - index);
    if (distance > 20) continue;
    if (!best || distance < best.distance) best = { year: match[0], distance };
  }
  return best?.year ?? null;
}

function genericCitationIssue(reference: string): string | null {
  if (/general compliance/i.test(reference)) return "generic_compliance_label";
  if (/\b(could reference|suggest referencing|suggested referencing|could relate|consider nec|refer to local code)\b/i.test(reference)) {
    return "conversational_reference";
  }
  if (!SECTION_PHRASE.test(reference) && /\bdc construction codes\b/i.test(reference) && !/\b(section|article|chapter)\b/i.test(reference)) {
    return "generic_compliance_label";
  }
  return null;
}

function localAmendmentSection(reference: string): string | null {
  if (!/\bDCMR\b/i.test(reference)) return null;
  const match = reference.match(/\b(?:section|sec\.?|§)\s*([0-9]+(?:\.[0-9]+)*)/i);
  return match ? match[1] : "";
}

function isRecordedLocalSection(section: string): boolean {
  return DC_2017_REGISTRY_SNAPSHOT.recordedLocalSections.some((item) => item === section);
}

function isIbcChapter27(reference: string, family: string | null): boolean {
  if (family !== "IBC") return false;
  if (/\b(?:chapter|ch\.?)\s*27\b/i.test(reference)) return true;
  return /\b(?:section|sec\.?)\s*27\d{2}(?:\.\d+)*/i.test(reference);
}

function disciplinesConflict(inferred: string | null, familyDiscipline: string): boolean {
  if (!inferred || inferred === familyDiscipline) return false;
  const inferredMep = MEP_DISCIPLINES.has(inferred);
  const familyMep = MEP_DISCIPLINES.has(familyDiscipline);
  if (inferredMep && (familyDiscipline === "building" || (familyMep && familyDiscipline !== inferred))) return true;
  return inferred === "building" && familyMep;
}

interface CitationDecision {
  stored: string | null;
  status: "proposed_reference" | "unresolved_reference";
  issues: string[];
  editionMappingApplied: boolean;
}

function clearCitation(issues: string[]): CitationDecision {
  return { stored: null, status: "unresolved_reference", issues, editionMappingApplied: false };
}

function assessCitation(reference: string, finding: DraftAnalyzerFinding, context: AnalyzerValidationContext): CitationDecision {
  const original = reference.trim();
  if (!original) return clearCitation([]);
  const generic = genericCitationIssue(original);
  if (generic) return clearCitation([generic]);

  const dc2017 = isDc2017AnalyzerContext(context);
  const localSection = localAmendmentSection(original);
  if (dc2017 && localSection !== null && (localSection === "" || !isRecordedLocalSection(localSection))) {
    return clearCitation(["unsupported_local_amendment"]);
  }

  const family = matchFamily(original);
  if (dc2017 && isIbcChapter27(original, family?.record.canonical || null)) {
    return clearCitation(["ibc_chapter_27_not_electrical_code"]);
  }

  if (dc2017 && localSection && isRecordedLocalSection(localSection) && !family) {
    return {
      stored: original,
      status: "proposed_reference",
      issues: ["local_section_recorded_not_text_verified"],
      editionMappingApplied: false,
    };
  }

  if (!family) {
    if (/\b(NEC|NFPA|IBC|IPC|IMC|IFC|IRC|IEBC|IECC|IFGC|DCMR|ASHRAE|IgCC)\b/i.test(original)) {
      return {
        stored: original,
        status: "proposed_reference",
        issues: [],
        editionMappingApplied: false,
      };
    }
    return clearCitation(["unrecognized_reference"]);
  }

  const inferred = inferDiscipline(finding, context.sheetDiscipline);
  if (dc2017 && disciplinesConflict(inferred, family.record.discipline)) {
    return clearCitation(["unrelated_discipline"]);
  }

  const section = original.match(SECTION_PHRASE)?.[1] || "";
  const year = closestYear(original, family.index);
  if (!dc2017) {
    return {
      stored: original,
      status: "proposed_reference",
      issues: [],
      editionMappingApplied: false,
    };
  }
  if (!section) {
    const issues = ["section_not_supported"];
    if (year && year !== family.record.edition) issues.push("incompatible_edition");
    return clearCitation(issues);
  }
  if (year === family.record.edition) {
    return { stored: original, status: "proposed_reference", issues: [], editionMappingApplied: false };
  }
  return {
    stored: `${family.record.canonical} ${family.record.edition} ${section}`,
    status: "proposed_reference",
    issues: ["edition_mapped_from_registry"],
    editionMappingApplied: true,
  };
}

function isMepFinding(finding: DraftAnalyzerFinding, context: AnalyzerValidationContext): boolean {
  const inferred = inferDiscipline(finding, context.sheetDiscipline);
  if (inferred && MEP_DISCIPLINES.has(inferred)) return true;
  const family = matchFamily(finding.suggested_code_reference || "");
  return Boolean(family && MEP_DISCIPLINES.has(family.record.discipline));
}

function outsideLocalOnly(finding: DraftAnalyzerFinding): boolean {
  const text = `${finding.category} ${finding.title} ${finding.observation} ${finding.drawing_evidence} ${finding.suggested_code_reference}`;
  return !/\b(DCMR|local amendment|District of Columbia)\b/i.test(text);
}

function supportedSeverity(value: string): "critical" | "warning" | "advisory" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "critical" || normalized === "warning" || normalized === "advisory") return normalized;
  return null;
}

function duplicateKey(finding: DraftAnalyzerFinding): string {
  return `${finding.title} ${finding.observation}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length > 3));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function coverageLimitation(context: AnalyzerValidationContext): string {
  if (isDc2017AnalyzerContext(context)) {
    return "Registry edition checks are not confirmation of legal applicability.";
  }
  return "No adopted-edition record for this selection. Citation editions were not rewritten and were not verified.";
}

export function validateAnalyzerFindings(
  findings: DraftAnalyzerFinding[],
  context: AnalyzerValidationContext,
): { published: PublishedAnalyzerFinding[]; withheld: WithheldAnalyzerFinding[] } {
  const published: PublishedAnalyzerFinding[] = [];
  const withheld: WithheldAnalyzerFinding[] = [];
  const seenExact = new Set<string>();
  const seenTokens: Set<string>[] = [];

  for (const input of findings) {
    const originalSeverity = input.severity || "";
    const originalReference = input.suggested_code_reference || "";
    const withhold = (rules: string[]) => {
      withheld.push({
        title: clip(input.title || "Untitled observation", 240),
        originalSeverity,
        originalCodeReference: clip(originalReference, 500),
        rules,
      });
    };

    if (!input.category?.trim() || !input.title?.trim() || !input.observation?.trim() || !input.recommendation?.trim()) {
      withhold(["missing_required_field"]);
      continue;
    }
    const evidence = input.drawing_evidence?.trim() || "";
    if (evidence.length < 12 || /^(n\/a|na|none|see drawing|the drawing|drawing|note)\.?$/i.test(evidence)) {
      withhold(["thin_drawing_evidence"]);
      continue;
    }

    let current: DraftAnalyzerFinding = { ...input, drawing_evidence: evidence };
    const rules: string[] = [];
    const crossSheet = adjustCrossSheet(current, context.sheetIndex);
    current = crossSheet.finding;
    if (crossSheet.rule) rules.push(crossSheet.rule);

    if (isUnsupportedFlowAllegation(current)) {
      current = neutralizeFlowAllegation(current);
      rules.push("calculation_governing_method_required");
    }

    if (isDensityAreaFlowDemandAllegation(current)) {
      current = neutralizeDensityAreaFlowDemand(current);
      rules.push("hydraulic_density_area_not_flow_demand");
    }

    if (evidenceContradictsAbsenceClaim(current)) {
      current = neutralizePresenceContradiction(current);
      rules.push("absence_claim_contradicted_by_evidence");
    }

    if (keynoteCitationMismatch(current)) {
      current = neutralizeKeynoteMismatch(current);
      rules.push("keynote_citation_mismatch");
    }

    if (isDocumentedRequirement(current)) {
      withhold(["documented_requirement_restatement"]);
      continue;
    }

    if (context.analysisMode === "ibc_only" && isMepFinding(current, context)) {
      withhold(["outside_ibc_only_scope"]);
      continue;
    }
    if (context.analysisMode === "local_only" && outsideLocalOnly(current)) {
      withhold(["outside_local_only_scope"]);
      continue;
    }

    const exact = duplicateKey(current);
    const tokens = tokenSet(current.observation);
    const nearDuplicate = seenExact.has(exact) || seenTokens.some((prior) => jaccard(prior, tokens) >= 0.85);
    if (nearDuplicate) {
      withhold(["near_duplicate"]);
      continue;
    }
    seenExact.add(exact);
    seenTokens.push(tokens);

    const severity = supportedSeverity(current.severity);
    const publishedSeverity = severity || "advisory";
    if (!severity) rules.push("unsupported_severity_presented_as_advisory");

    const citation = assessCitation(current.suggested_code_reference || "", current, context);
    if (citation.issues.length) rules.push(...citation.issues);

    const changed = publishedSeverity !== originalSeverity.trim().toLowerCase()
      || current.observation !== input.observation
      || current.title !== input.title
      || (citation.stored || "") !== originalReference.trim()
      || rules.length > 0;

    const baseCoverage = coverageLimitation(context);
    const crossNote = crossSheetCoverageNote(rules);
    const coverage = [baseCoverage, crossNote].filter(Boolean).join(" ");

    published.push({
      category: clip(current.category, 120),
      severity: publishedSeverity,
      title: clip(current.title, 240),
      observation: clip(current.observation, 2000),
      drawing_evidence: clip(current.drawing_evidence, 1500),
      drawing_location: clip(current.drawing_location || "", 500),
      suggested_code_reference: citation.stored ? clip(citation.stored, 500) : null,
      recommendation: clip(current.recommendation, 1500),
      verification_status: citation.status,
      validation: {
        outcome: changed ? "adjusted" : "accepted",
        rules,
        originalSeverity,
        originalTitle: clip(input.title, 240),
        originalObservation: clip(input.observation, 2000),
        originalCodeReference: clip(originalReference, 500),
        publishedSeverity,
        publishedCodeReference: citation.stored ? clip(citation.stored, 500) : null,
        citationIssues: citation.issues,
        editionMappingApplied: citation.editionMappingApplied,
        independentlyVerified: false,
        coverageLimitation: coverage || null,
      },
    });
  }

  return { published, withheld };
}
