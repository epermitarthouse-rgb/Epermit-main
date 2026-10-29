/**
 * Frozen quality-evaluation benchmark for the Supabase Code Analyzer.
 * Labels are human-authored. AI findings and the client's review-qualification
 * notes are not treated as automatically correct.
 *
 * verified  — established from run timestamps, adopted-edition registry facts,
 *             persist-time rules that already have unit tests, or a published
 *             calculation method (NFPA 13 density-area vs total demand).
 * provisional — client/tool notes or reasoning we have not independently confirmed.
 * accuracy  — may enter precision/recall. None of the 252-finding cases use this:
 *             that run has no professionally verified gold issue list.
 * regression — known error patterns tracked as still-published vs mitigated.
 */

export const QUALITY_BASELINE_RUN_ID = "649fdaa6-14b9-45b9-bd62-695166363f75";

export const QUALITY_EVALUATION_VERSION = "analyzer-quality-eval.v1";
export const QUALITY_BENCHMARK_ID = "run649fdaa6.known-issues.v2";

export type QualityTruth = "verified" | "provisional";
export type QualityExpected = "true_positive" | "false_positive" | "false_negative";
export type QualityLabelUse = "accuracy" | "regression" | "provisional";
export type QualityTopic =
  | "hydraulic_reasoning"
  | "revision_date_interpretation"
  | "code_edition"
  | "unsupported_finding"
  | "documented_restatement"
  | "cross_sheet_absence"
  | "keynote_citation"
  | "structural_notes";

export interface QualityCaseMatch {
  reportId?: string;
  sheetNumber?: string;
  titleIncludes?: string;
}

export interface QualityBenchmarkCase {
  id: string;
  truth: QualityTruth;
  expected: QualityExpected;
  use: QualityLabelUse;
  topic: QualityTopic;
  match: QualityCaseMatch;
  severityWhenPublished?: "critical" | "warning" | "advisory";
  summary: string;
  rationale: string;
  source: string;
}

export interface QualityBenchmark {
  id: typeof QUALITY_BENCHMARK_ID;
  evaluationVersion: typeof QUALITY_EVALUATION_VERSION;
  baselineRunId: string;
  title: string;
  limitations: readonly string[];
  cases: readonly QualityBenchmarkCase[];
}

export const QUALITY_BENCHMARK_V1: QualityBenchmark = {
  id: QUALITY_BENCHMARK_ID,
  evaluationVersion: QUALITY_EVALUATION_VERSION,
  baselineRunId: QUALITY_BASELINE_RUN_ID,
  title: "Run 649fdaa6 known-issue benchmark",
  limitations: [
    "The 252 published findings are not a professionally verified gold set.",
    "Precision and recall are not inferred from unlabeled findings.",
    "Client review-qualification notes are provisional unless independently established.",
    "NFPA 13 edition is not in the DC 2017 registry snapshot used by this analyzer.",
    "Section existence is not checked; the analyzer has no code-section index.",
    "This benchmark does not rerun analysis and does not rewrite stored findings.",
  ],
  cases: [
    {
      id: "fp-hydraulic-density-area",
      truth: "verified",
      expected: "false_positive",
      use: "regression",
      topic: "hydraulic_reasoning",
      match: { reportId: "C-002", sheetNumber: "FP200", titleIncludes: "Hydraulic" },
      severityWhenPublished: "critical",
      summary: "Density × area treated as total hydraulic demand",
      rationale:
        "0.15 gpm/ft² × 1,524 ft² = 228.6 gpm is the density-area sprinkler discharge, not a complete NFPA 13 hydraulic demand. Hose allowance and water-supply analysis make total flow larger. The 596.81 gpm box is not proven wrong by that product.",
      source: "NFPA 13 hydraulic method (density-area plus hose); persist-time rule hydraulic_density_area_not_flow_demand covers this pattern for new analyses.",
    },
    {
      id: "prov-ceiling-penetration-cross-sheet",
      truth: "provisional",
      expected: "false_positive",
      use: "provisional",
      topic: "cross_sheet_absence",
      match: { reportId: "C-001", sheetNumber: "A-1.03-00", titleIncludes: "Penetration" },
      severityWhenPublished: "critical",
      summary: "RCP-local penetration omission without cross-sheet verification",
      rationale:
        "Phase 2A.7 provisional pilot: A-1.03 lacks penetration sections locally but points elsewhere for finishes/coordination; FP/MEP sheets can carry penetration guidance. Not professionally verified.",
      source: "Phase 2A.7 critical pilot provisional assessment; persist-time catches this when SEE SHEET/DETAIL appears in evidence.",
    },
    {
      id: "prov-refrigerant-keynote-cross-sheet",
      truth: "provisional",
      expected: "false_positive",
      use: "provisional",
      topic: "keynote_citation",
      match: { reportId: "C-003", sheetNumber: "M-1.4", titleIncludes: "Refrigerant" },
      severityWhenPublished: "critical",
      summary: "Refrigerant insulation declared missing despite detail cross-reference",
      rationale:
        "Phase 2A.7 provisional pilot: keyed notes 1–2 cite M3.0 Detail 3; insulation callouts appear on M-3.0. Note 22 citation was not supported.",
      source: "Phase 2A.7 critical pilot provisional assessment.",
    },
    {
      id: "prov-foundation-reinforcement-notes",
      truth: "provisional",
      expected: "false_positive",
      use: "provisional",
      topic: "structural_notes",
      match: { reportId: "C-004", sheetNumber: "S-201.00", titleIncludes: "Foundation" },
      severityWhenPublished: "critical",
      summary: "Foundation reinforcement treated as absent despite notes",
      rationale:
        "Phase 2A.7 provisional pilot: Masonry and Foundation Notes specify #4@48\" and dowels; graphic sections may be on other S-sheets.",
      source: "Phase 2A.7 critical pilot provisional assessment.",
    },
    {
      id: "fp-revision-dates-future",
      truth: "verified",
      expected: "false_positive",
      use: "regression",
      topic: "revision_date_interpretation",
      match: { reportId: "W-002", sheetNumber: "A-1.00-00", titleIncludes: "Revisions Dates" },
      severityWhenPublished: "warning",
      summary: "2026 revision dates called future relative to a 2026 analysis",
      rationale:
        "The frozen fixture run timestamp is 2026-10-26. Cited revision dates 02/16/26 and 07/17/26 precede that date, so they are not in the future relative to the analysis.",
      source: "Run created_at versus dates printed in the finding observation.",
    },
    {
      id: "fp-gfci-note-restatement",
      truth: "verified",
      expected: "false_positive",
      use: "regression",
      topic: "documented_restatement",
      match: { reportId: "A-055", sheetNumber: "E-1.1-00", titleIncludes: "GFCI Protection for Kitchen Equipment" },
      severityWhenPublished: "advisory",
      summary: "Kitchen GFCI note restated as a finding",
      rationale:
        "The observation restates an explicit general note without a drawing conflict. That is not a discrepancy. Persist-time restatement withholding currently applies to critical and warning findings, so this advisory row remains published.",
      source: "Drawing note restated as a finding; persist-time documented_requirement_restatement tests cover the same pattern at critical/warning.",
    },
    {
      id: "fp-gfci-provided-note",
      truth: "verified",
      expected: "false_positive",
      use: "regression",
      topic: "documented_restatement",
      match: { reportId: "A-060", sheetNumber: "E-1.3-00", titleIncludes: "GFCI Protection Requirement" },
      severityWhenPublished: "advisory",
      summary: "Weatherproof GFCI provision restated as a finding",
      rationale:
        "Note E2 already states that weatherproof GFCI receptacles are provided. Repeating that instruction is not a discrepancy on the sheet.",
      source: "Drawing note restated as a finding; persist-time documented_requirement_restatement tests cover the same pattern at critical/warning.",
    },
    {
      id: "prov-nfpa13-edition-w051",
      truth: "provisional",
      expected: "false_positive",
      use: "provisional",
      topic: "code_edition",
      match: { reportId: "W-051", sheetNumber: "FP201", titleIncludes: "Sprinkler Head" },
      summary: "NFPA 13 2015 cited; DC public list may be 2013",
      rationale:
        "The client/tool note flags NFPA 13-2015 against a Chapter 35 list of NFPA 13-2013. The analyzer registry snapshot records NFPA 70 only, so this edition is not independently confirmed here.",
      source: "Provisional client/tool qualification; not scored as accuracy.",
    },
    {
      id: "prov-nfpa13-edition-a091",
      truth: "provisional",
      expected: "false_positive",
      use: "provisional",
      topic: "code_edition",
      match: { reportId: "A-091", sheetNumber: "FP201", titleIncludes: "Safety Factor" },
      summary: "Safety-factor finding cites NFPA 13 2015",
      rationale:
        "Same unconfirmed NFPA 13 edition question as W-051. A printed 44.81% safety factor is also not validated as a code requirement.",
      source: "Provisional client/tool qualification; not scored as accuracy.",
    },
    {
      id: "prov-section-1705-16-2",
      truth: "provisional",
      expected: "false_positive",
      use: "provisional",
      topic: "unsupported_finding",
      match: { reportId: "W-083", sheetNumber: "S-204.00", titleIncludes: "Incomplete Reference for Inspections" },
      summary: "IBC §1705.16.2 may not exist in the examined text",
      rationale:
        "A client/tool note says the examined DC public-reference text has §1705.16 and §1705.16.1 but not §1705.16.2. This analyzer has no section index, so existence is not verified here.",
      source: "Provisional client/tool qualification; not scored as accuracy.",
    },
    {
      id: "prov-guard-21-inch",
      truth: "provisional",
      expected: "false_positive",
      use: "provisional",
      topic: "unsupported_finding",
      match: { reportId: "A-032", sheetNumber: "A-3.06-00", titleIncludes: "Guard Installation" },
      summary: "21-inch guard opening note applied without location exception",
      rationale:
        "A client/tool note warns that IBC 2015 generally uses a 4-inch sphere, with limited 21-inch exceptions. Location on this sheet was not independently checked.",
      source: "Provisional client/tool qualification; not scored as accuracy.",
    },
  ],
};
