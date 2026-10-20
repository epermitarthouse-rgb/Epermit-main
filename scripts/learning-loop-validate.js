"use strict";

/**
 * Focused check of the learning cycle. No model calls and no production analysis.
 * Run: node scripts/learning-loop-validate.js
 */

const { measurementIsProven } = require("../scraper-service/app/services/compliance/rag/drawingStructureV2.js");

async function main() {
const {
  buildGuidanceFromFeedback,
  transitionFeedback,
  applyExtractionLearning,
  applyRetrievalLearning,
  applyFindingLearning,
  evaluateExamples,
  exampleFromFeedback,
  canPromote,
  promoteVersion,
  rollbackVersions,
  activeGuidance,
} = await import("../src/lib/codeAnalyzer/learningLoopCore.mjs");

const failures = [];

function check(name, condition) {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failures.push(name);
  console.error(`FAIL ${name}`);
}

const actor = { userId: "reviewer-1", at: "2026-10-21T00:00:00.000Z", attestation: true, approvalBasis: "human_approval" };
const projectId = "project-a";
const otherProject = "project-b";

const original = {
  elements: [
    { id: "el-1", type: "floor_drain", source_label: "GI-1 GREASE INTERCEPTOR", tag: "GI-1" },
    { id: "el-2", type: "floor_drain", source_label: "FD-1 FLOOR DRAIN", tag: "FD-1" },
  ],
  dimensions: [
    {
      id: "dim-1",
      context_text: "GI-1 75 GPM",
      original_content: "75 GPM",
      value_numeric: 75,
      binding_status: "unbound",
      association_status: "none",
      related_element_ids: [],
      related_calculation_ids: [],
    },
  ],
  calculations: [],
};

let feedback = {
  id: "fb-1",
  project_id: projectId,
  status: "pending",
  source_kind: "human_reviewer",
  category: "extraction_label",
  code_edition: "2017",
  jurisdiction: "dc",
  original_output: {
    elements: [original.elements[0]],
  },
  drawing_evidence: { file_name: "P-201.pdf", sheet_id: "sheet-201", quote: "GI-1 GREASE INTERCEPTOR" },
  proposed_correction: {
    scope: "sheet",
    conditions: {
      sheet_number: "P-201.pdf",
      sheet_id: "sheet-201",
      label_pattern: "GI-1",
      element_type: "floor_drain",
      code_edition: "2017",
      jurisdiction: "dc",
    },
    effect: {
      kind: "relabel_element",
      element_type: "grease_interceptor",
      note: "The printed tag GI-1 is the grease interceptor.",
    },
  },
};

check("pending feedback is not guidance", buildGuidanceFromFeedback(feedback).ok === false);
check("approval before evidence review is refused", transitionFeedback(feedback, "approve", actor).ok === false);

const aiSuggestion = transitionFeedback(
  { ...feedback, id: "fb-ai", source_kind: "ai_suggestion", status: "evidence_review", evidence_reviewed_at: actor.at },
  "approve",
  { ...actor, approvalBasis: "trusted_ground_truth" },
);
check("an AI suggestion cannot be approved as ground truth", aiSuggestion.ok === false);

const reviewed = transitionFeedback(feedback, "start_review", actor);
const approved = transitionFeedback(reviewed.record, "approve", actor);
check("evidence review then human approval succeeds", reviewed.ok && approved.ok && approved.record.status === "approved");
check("original evidence is still the submitted snapshot", approved.record.original_output.elements[0].type === "floor_drain");
check("drawing evidence is unchanged by approval", approved.record.drawing_evidence.quote === "GI-1 GREASE INTERCEPTOR");

const built = buildGuidanceFromFeedback(approved.record);
check("approved correction becomes project guidance", built.ok === true);

const context = {
  projectId,
  sheetId: "sheet-201",
  sheetNumber: "P-201",
  fileName: "P-201.pdf",
  jurisdiction: "dc",
  codeYear: "2017",
};
const applied = applyExtractionLearning(original, [built.guidance], context);
check("matching sheet reuses the correction", applied.document.elements[0].type === "grease_interceptor");
check("a different label on the same sheet is left alone", applied.document.elements[1].type === "floor_drain");
check("the original analysis object is not overwritten", original.elements[0].type === "floor_drain");
check(
  "another sheet does not inherit a sheet-scoped correction",
  applyExtractionLearning(original, [built.guidance], { ...context, sheetId: "sheet-301", fileName: "P-301.pdf" }).document.elements[0].type === "floor_drain",
);
check(
  "another project does not inherit the correction",
  applyExtractionLearning(original, [built.guidance], { ...context, projectId: otherProject }).document.elements[0].type === "floor_drain",
);

const bound = applyExtractionLearning(
  {
    elements: [{ id: "el-1", type: "grease_interceptor", source_label: "GI-1 GREASE INTERCEPTOR" }],
    dimensions: [
      {
        id: "dim-1",
        context_text: "GI-1 75 GPM",
        original_content: "75 GPM",
        value_numeric: 75,
        binding_status: "unbound",
        association_status: "none",
        related_element_ids: [],
      },
    ],
    calculations: [],
  },
  [
    {
      ...built.guidance,
      id: "bind-1",
      effect: { kind: "bind_dimension", element_type: "grease_interceptor", bind_to: "element", note: "Bind 75 GPM to GI-1." },
    },
  ],
  context,
);
const rebound = bound.document.dimensions[0];
check("dimension value is not rewritten", rebound.value_numeric === 75);
check("reviewer binding is recorded", rebound.association_status === "reviewer_bound" && rebound.related_element_ids[0] === "el-1");
check(
  "reviewer binding does not count as verifier proof",
  measurementIsProven(rebound, new Set(["el-1"])) === false,
);

const quotes = ["Existing adopted excerpt A.", "Existing adopted excerpt B."];
const retrievalBefore = {
  packages: [
    {
      questionId: "q1",
      code: [
        { id: "a", section: "101.2", quote: quotes[0], authoritative: true },
        { id: "b", section: "403.2", quote: quotes[1], authoritative: true },
      ],
      codeContext: [],
    },
  ],
};
const retrievalGuidance = {
  ...built.guidance,
  id: "retrieval-1",
  effect: { kind: "prefer_section", section_locator: "403.2", note: "Prefer the retrieved 403.2 locator." },
  conditions: { ...built.guidance.conditions, section_locator: "403.2", label_pattern: null },
};
const retrieved = applyRetrievalLearning(retrievalBefore, [retrievalGuidance], context);
check("an already retrieved section can move ahead", retrieved.retrieval.packages[0].code[0].section === "403.2");
check("retrieval does not add a code excerpt", retrieved.retrieval.packages[0].code.length === 2);
check("retrieval does not change authoritative text", retrieved.retrieval.packages[0].code.map((hit) => hit.quote).sort().join("|") === quotes.slice().sort().join("|"));
check("a missing section is not invented", applyRetrievalLearning(retrievalBefore, [{ ...retrievalGuidance, effect: { ...retrievalGuidance.effect, section_locator: "999.9" } }], context).applications.some((item) => item.action === "not_in_corpus"));

const finding = {
  id: "issue-1",
  title: "Grease interceptor flow is missing",
  description: "No flow is shown.",
  codeReference: "403.2",
  findingType: "confirmed_violation",
  verified: true,
  severity: "warning",
};
const falsePositive = applyFindingLearning(
  { issues: [finding], rejectedCandidates: [], summary: { totalIssues: 1, overallScore: 90 } },
  [
    {
      ...built.guidance,
      id: "fp-1",
      effect: { kind: "suppress_false_positive", issue_signature: finding.title, section_locator: "403.2", note: "The flow is printed next to GI-1." },
      conditions: { ...built.guidance.conditions, section_locator: "403.2" },
    },
  ],
  context,
);
check("a false positive is withheld from publication", falsePositive.result.issues.length === 0);
check(
  "the verifier decision is kept on the withheld finding",
  falsePositive.result.rejectedCandidates[0].findingType === "confirmed_violation" && falsePositive.result.rejectedCandidates[0].verified === true,
);
check("the published score is not rewritten as an accuracy gain", falsePositive.result.summary.overallScore === 90 && falsePositive.result.summary.learning.accuracyClaim === false);

const missed = applyFindingLearning(
  { issues: [], rejectedCandidates: [], summary: { totalIssues: 0, overallScore: null } },
  [
    {
      ...built.guidance,
      id: "fn-1",
      effect: { kind: "flag_missed_evidence", note: "The grease interceptor schedule was not cited.", section_locator: "403.2" },
    },
  ],
  context,
);
const openCheck = missed.result.issues[0];
check("a missed finding stays an unverified question", openCheck.findingType === "verification_question" && openCheck.verified === false);

const labeled = exampleFromFeedback(approved.record, built.guidance);
const otherSheetExample = {
  ...labeled,
  id: "fb-other",
  context: { ...labeled.context, sheetId: "sheet-301", fileName: "P-301.pdf", sheetNumber: "P-301.pdf" },
  before: { elements: [{ id: "el-2", type: "floor_drain", source_label: "FD-1 FLOOR DRAIN", tag: "FD-1" }] },
  expected: { ...labeled.expected, element_type: "floor_drain", label_pattern: "FD-1" },
};
const evaluation = evaluateExamples([labeled, otherSheetExample], [], [built.guidance]);
check("the labeled mistake improves", evaluation.improvements === 1 && evaluation.examples[0].outcome === "improvement");
check("a labeled example outside the sheet does not regress", evaluation.regressions === 0 && evaluation.examples[1].outcome === "unchanged_correct");
check("promotion is allowed for that evaluation", canPromote(evaluation).ok === true);
check("evaluation does not claim accuracy", evaluation.accuracyClaim === false && evaluation.confidence == null);

const broad = {
  ...built.guidance,
  id: "broad-1",
  scope: "project_pattern",
  conditions: { ...built.guidance.conditions, sheet_number: null, sheet_id: null, label_pattern: "GI-" },
};
const broadExample = {
  id: "fb-broad",
  metric: "extraction",
  context: { ...context, fileName: "P-301.pdf", sheetId: "sheet-301" },
  before: { elements: [{ id: "el-9", type: "floor_drain", source_label: "GI-2 FLOOR DRAIN", tag: "GI-2" }] },
  expected: { element_type: "floor_drain", label_pattern: "GI-2" },
};
const regression = evaluateExamples([labeled, broadExample], [], [broad]);
check("a pattern that changes a correct label is a regression", regression.regressions === 1);
check("a regression blocks promotion", canPromote(regression).ok === false);

const promoted = promoteVersion([], [built.guidance], evaluation, { userId: actor.userId, versionId: "version-1" });
check("promotion creates an active version", promoted.ok && promoted.version.is_active && promoted.audit.action === "promoted");
const live = activeGuidance(promoted.guidance, promoted.versions, projectId);
check("the active version is what a later analysis would load", applyExtractionLearning(original, live, context).document.elements[0].type === "grease_interceptor");

const rolled = rollbackVersions(promoted.versions, promoted.guidance, projectId, { userId: actor.userId, reason: "undo" });
check("rollback records the version it removed", rolled.ok && rolled.audit.action === "rolled_back" && rolled.rolledBack === "version-1");
const afterRollback = activeGuidance(rolled.guidance, rolled.versions, projectId);
check("rolled-back learning is not reused", afterRollback.length === 0);
check(
  "a later analysis uses the original reading after rollback",
  applyExtractionLearning(original, afterRollback, context).document.elements[0].type === "floor_drain",
);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nLearning loop cycle passed: capture, approval, reuse, evaluation, promotion, and rollback.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
