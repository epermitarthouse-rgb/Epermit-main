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
const LARGER_GOVERNS = /potential discrepancy|discrepancy in flow|maximum flow|potential maximum|larger (?:of the two|flow|value|result)|accommodate the potential maximum|might govern|should govern/i;
const SELECTION_ERROR = /not the lesser|exceeds the (?:printed )?lesser|greater than the lesser|below the lesser|less than the lesser|does not (?:equal|follow|match) the (?:lesser|governing)/i;
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

export function buildAnalyzerUserPrompt(fileName: string, sheets: SubmittedSheetRef[]): string {
  return [
    "Review this permit drawing sheet and return the structured preliminary observations.",
    `Current file: ${oneLine(fileName, 180)}`,
    formatSubmittedSheetIndex(sheets, fileName),
  ].join("\n\n");
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

function adjustCrossSheet(finding: DraftAnalyzerFinding, sheets: SubmittedSheetRef[]): { finding: DraftAnalyzerFinding; rule: string | null } {
  const text = `${finding.title} ${finding.observation} ${finding.drawing_evidence}`;
  if (!PROJECT_ABSENCE.test(text)) return { finding, rule: null };
  const { resolved, unresolved } = resolveSheetReferences(text, sheets);
  if (resolved.length) {
    const names = resolved.map((sheet) => oneLine(sheet.fileName, 120)).join(", ");
    let observation = `The drawing refers to a sheet that is in the submitted set (${names}). This review did not read that sheet, so the reference does not establish that it is missing and does not establish compliance.`;
    if (unresolved.length) {
      observation += ` Unresolved references are not treated as absent from the project: ${unresolved.join(", ")}.`;
    }
    return {
      rule: "cross_sheet_reference_in_set",
      finding: {
        ...finding,
        severity: "advisory",
        title: "Referenced sheet is in the submitted set",
        observation,
        recommendation: `Review ${names} when that sheet is processed. Do not treat this cross-reference as a missing document.`,
      },
    };
  }
  if (!unresolved.length) return { finding, rule: null };
  const severity = finding.severity === "critical" || finding.severity === "warning" ? "advisory" : finding.severity;
  return {
    rule: "cross_sheet_reference_unresolved",
    finding: {
      ...finding,
      severity,
      observation: `The drawing refers to ${unresolved.join(", ")}. The submitted sheet index did not resolve that reference. Absence from the project is not established.`,
      recommendation: "Confirm the referenced sheet against the submitted filenames before treating it as missing.",
    },
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
        coverageLimitation: coverageLimitation(context),
      },
    });
  }

  return { published, withheld };
}
