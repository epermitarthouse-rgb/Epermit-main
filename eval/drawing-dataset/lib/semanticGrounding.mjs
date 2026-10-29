/**
 * Phase 2A.5 semantic evidence grounding runner.
 * Isolated from the Supabase analyzer. Does not rewrite findings or production labels.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { wordingRecord } from "./buildDataset.mjs";
import { inventoryAccountability } from "./hybridSelect.mjs";
import {
  assessRetrieval,
  findDuplicateCandidates,
  flagQualityIssues,
  sortFindingsForReview,
  summarizeAssessments,
} from "./semanticAssess.mjs";
import { retrieveEvidenceCandidates, SEMANTIC_VERSION } from "./semanticRetrieve.mjs";

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadLayoutPage(outDir, sha256) {
  const fullPath = path.join(outDir, "layout-full", "pages", `${sha256}.json`);
  if (existsSync(fullPath)) return JSON.parse(await readFile(fullPath, "utf8"));
  const pilotPath = path.join(outDir, "layout-pilot", "pages", `${sha256}.json`);
  if (existsSync(pilotPath)) return JSON.parse(await readFile(pilotPath, "utf8"));
  return null;
}

function buildRecord(finding, page, retrieval, assessment) {
  const original = finding.original || wordingRecord(finding);
  const severity = String(finding.severity || original.severity || "").toLowerCase();
  const record = {
    clientReportId: finding.clientReportId,
    wordingSha256: finding.wordingSha256,
    wordingMatchesFixture: true,
    severity,
    discipline: finding.discipline || original.discipline || null,
    sheetNumber: finding.sheetNumber || original.sheetNumber || null,
    relativePath: finding.relativePath || null,
    sha256: finding.sha256 || null,
    labelStatus: finding.labelStatus || "unverified_model_output",
    original: {
      title: original.title,
      observation: original.observation,
      drawingEvidence: original.drawingEvidence,
      drawingLocation: original.drawingLocation,
      recommendation: original.recommendation,
      codeReference: original.codeReference,
      severity: original.severity,
    },
    baselineGrounding: finding.grounding || null,
    layoutPagePresent: Boolean(page),
    retrieval: {
      status: retrieval.status,
      retrievalSuccess: retrieval.retrievalSuccess,
      bestScore: retrieval.bestScore || 0,
      relationshipSupport: Boolean(retrieval.relationshipSupport),
      candidateCount: (retrieval.candidates || []).length,
      query: {
        absenceClaim: retrieval.query?.absenceClaim || false,
        evidenceTokenCount: retrieval.query?.evidenceTokens?.length || 0,
        numbers: retrieval.query?.numbers || [],
        locationTokens: retrieval.query?.locationTokens || [],
        sheetRefs: retrieval.query?.sheetRefs || [],
      },
      candidates: retrieval.candidates || [],
    },
    assessment,
    qualityFlags: [],
    professionallyVerified: false,
    verificationStatus: "not_professionally_verified",
    groundingClaimed: false,
    precisionContribution: "Not measured",
    recallContribution: "Not measured",
  };
  record.qualityFlags = flagQualityIssues(record);
  return record;
}

function buildReviewDataset(records, duplicates, accountability) {
  const ordered = sortFindingsForReview(records);
  return {
    semanticVersion: SEMANTIC_VERSION,
    purpose: "Independent drawing review pack for false-negative discovery and professional verification.",
    precision: "Not measured",
    recall: "Not measured",
    falseNegativeRate: "Not measured",
    instructions: [
      "Review Critical findings first, then Warnings, then Advisories.",
      "Confirm whether retrieved candidates support, contradict, or fail to address the finding.",
      "Do not mark professionallyVerified unless a qualified reviewer inspected the drawing.",
      "Append confirmed missed issues (false negatives) to missedIssueSlots after drawing review.",
      "Retrieval success is not the same as verified grounding accuracy.",
    ],
    accountability: {
      inventoryFiles: accountability.recordedFiles,
      pdfFiles: accountability.pdfCount,
      findings: records.length,
      s204Required: true,
      s300UnmatchedRequired: true,
      archivePresent: accountability.zipPresent,
    },
    duplicateCandidates: duplicates,
    reviewQueue: ordered.map((row, index) => ({
      reviewOrder: index + 1,
      priority: row.severity,
      clientReportId: row.clientReportId,
      relativePath: row.relativePath,
      sheetNumber: row.sheetNumber,
      title: row.original?.title || null,
      automatedAssessment: row.assessment?.automatedAssessment,
      retrievalSuccess: row.assessment?.retrievalSuccess,
      bestScore: row.assessment?.bestScore ?? row.retrieval?.bestScore ?? 0,
      topCandidate: row.retrieval?.candidates?.[0]?.text || null,
      topRegionId: row.retrieval?.candidates?.[0]?.regionId || null,
      topBBox: row.retrieval?.candidates?.[0]?.bbox || null,
      qualityFlags: row.qualityFlags,
      reviewerFields: {
        professionalAssessment: null,
        supportsFindingConclusion: null,
        evidenceAdequate: null,
        notes: null,
        professionallyVerified: false,
      },
    })),
    missedIssueSlots: [],
    note: "missedIssueSlots stays empty until a human reviewer adds confirmed missed issues.",
  };
}

export function recommendSemanticNextStep(summary) {
  const counts = summary.coverage?.automatedAssessmentCounts || {};
  const critical = summary.coverage?.bySeverity?.critical || {};
  const allEvaluated = summary.coverage?.total === 252;
  const criticalCovered = (critical.total || 0) === 4;
  const retrievalOk = (summary.coverage?.retrievalSuccessCount || 0) >= 100;
  const ready = allEvaluated
    && criticalCovered
    && retrievalOk
    && summary.accountability?.findingsUnchanged
    && summary.accountability?.inventoryFiles === 83
    && summary.accountability?.pdfFiles === 82;
  return {
    decision: ready ? "semantic_grounding_ready_for_review" : "semantic_grounding_needs_attention",
    rationale: ready
      ? "All 252 findings have automated retrieval assessments. Critical findings are queued first. Professional verification and recall measurement still required before Phase 2B."
      : "Coverage, critical prioritization, or accountability gates are incomplete.",
    startPhase2B: false,
    precision: "Not measured",
    recall: "Not measured",
    falseNegativeRate: "Not measured",
  };
}

export async function runSemanticGrounding(options) {
  const onProgress = options.onProgress || (() => {});
  const outDir = path.join(options.outDir, options.outName || "semantic-ground");
  await mkdir(outDir, { recursive: true });

  const findingMapPath = path.join(options.outDir, "finding-map.json");
  const findingMapBefore = await readFile(findingMapPath);
  const findingMapHashBefore = sha256Text(findingMapBefore);
  const findingMap = JSON.parse(findingMapBefore.toString("utf8"));
  const inventory = JSON.parse(await readFile(path.join(options.outDir, "inventory.json"), "utf8"));
  const recon = JSON.parse(await readFile(path.join(options.outDir, "reconciliation.json"), "utf8"));
  const account = inventoryAccountability(inventory);

  const findings = findingMap.findings || [];
  const pageCache = new Map();
  const records = [];

  const ordered = sortFindingsForReview(findings);
  for (const finding of ordered) {
    onProgress({
      clientReportId: finding.clientReportId,
      severity: finding.severity || finding.original?.severity,
      status: "assess",
    });
    let page = null;
    if (finding.sha256) {
      if (!pageCache.has(finding.sha256)) {
        pageCache.set(finding.sha256, await loadLayoutPage(options.outDir, finding.sha256));
      }
      page = pageCache.get(finding.sha256);
    }
    if (typeof options.retrieveFn === "function") {
      const custom = await options.retrieveFn(finding, page);
      const assessment = assessRetrieval(custom);
      records.push(buildRecord(finding, page, custom, assessment));
      continue;
    }
    const retrieval = retrieveEvidenceCandidates(finding, page);
    const assessment = assessRetrieval(retrieval);
    records.push(buildRecord(finding, page, retrieval, assessment));
  }

  const findingMapAfter = await readFile(findingMapPath);
  if (sha256Text(findingMapAfter) !== findingMapHashBefore) {
    throw new Error("finding-map.json changed during semantic grounding. Aborting.");
  }

  const duplicates = findDuplicateCandidates(findings);
  const coverage = summarizeAssessments(records);
  const reviewDataset = buildReviewDataset(records, duplicates, account);
  const criticalRecords = records.filter((row) => row.severity === "critical");

  const summary = {
    semanticVersion: SEMANTIC_VERSION,
    phase: "2A.5",
    productionNote: "The Supabase analyzer, GPT-4o path, stored findings, M1–M4 reports, and Code Analyzer V2 are unchanged.",
    methodologyNote: "Semantic similarity retrieves evidence candidates. Automated assessments are not professional verification. Precision, recall, and false-negative rates remain Not measured.",
    precision: "Not measured",
    recall: "Not measured",
    falseNegativeRate: "Not measured",
    toolsUsed: ["layout-full-associations", "ocr-reused", "token-overlap", "numeric-fact", "location-keywords", "explicit-relationships"],
    toolsSkipped: [
      "embedding-models: deferred; lexical/technical retrieval was sufficient for candidate generation without new dependencies",
      "paid-apis: forbidden by Phase 2A.5 guardrails",
    ],
    accountability: {
      inventoryFiles: account.recordedFiles,
      walkedFiles: account.walkedFiles,
      pdfFiles: account.pdfCount,
      findings: records.length,
      findingsUnchanged: true,
      findingMapSha256: findingMapHashBefore,
      requiredPresent: account.requiredPresent,
      s204IdentityCount: recon.fileMatches?.find((match) => match.relativePath === "S-204.00.pdf")?.identityCount || 0,
      s300MatchMethod: recon.fileMatches?.find((match) => match.relativePath === "S-300.00.pdf")?.method || null,
      archivePresent: account.zipPresent,
    },
    coverage,
    duplicates: {
      pairCount: duplicates.length,
      pairs: duplicates,
    },
    critical: {
      count: criticalRecords.length,
      records: criticalRecords.map((row) => ({
        clientReportId: row.clientReportId,
        relativePath: row.relativePath,
        automatedAssessment: row.assessment?.automatedAssessment,
        retrievalSuccess: row.assessment?.retrievalSuccess,
        bestScore: row.assessment?.bestScore ?? row.retrieval?.bestScore,
        qualityFlags: row.qualityFlags,
      })),
    },
    records,
  };
  summary.recommendation = recommendSemanticNextStep(summary);

  await writeFile(path.join(outDir, "comparison.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(outDir, "comparison.md"), renderSemanticReport(summary));
  await writeFile(path.join(outDir, "finding-evidence.json"), JSON.stringify({
    semanticVersion: SEMANTIC_VERSION,
    findingMapSha256: findingMapHashBefore,
    findingsUnchanged: true,
    groundingClaimed: false,
    professionallyVerifiedCount: 0,
    precision: "Not measured",
    recall: "Not measured",
    records,
  }, null, 2));
  await writeFile(path.join(outDir, "coverage.json"), JSON.stringify({
    semanticVersion: SEMANTIC_VERSION,
    ...coverage,
    criticalFirst: true,
  }, null, 2));
  await writeFile(path.join(outDir, "duplicates.json"), JSON.stringify({
    semanticVersion: SEMANTIC_VERSION,
    independentlyVerified: false,
    pairs: duplicates,
  }, null, 2));
  await writeFile(path.join(outDir, "independent-review-pack.json"), JSON.stringify(reviewDataset, null, 2));
  await writeFile(path.join(outDir, "unresolved.jsonl"), records
    .filter((row) => ["unresolved", "insufficient_evidence"].includes(row.assessment?.automatedAssessment))
    .map((row) => JSON.stringify({
      clientReportId: row.clientReportId,
      severity: row.severity,
      relativePath: row.relativePath,
      automatedAssessment: row.assessment?.automatedAssessment,
      qualityFlags: row.qualityFlags,
    }))
    .join("\n") + "\n");
  await writeFile(path.join(outDir, "critical-priority.md"), renderCriticalPriority(criticalRecords));

  return {
    summary,
    outDir,
    findingMapHash: findingMapHashBefore,
    findingsUnchanged: true,
  };
}

export function renderCriticalPriority(criticalRecords) {
  const lines = [
    "# Critical findings — Phase 2A.5 priority queue",
    "",
    "Automated retrieval only. Not professionally verified.",
    "Precision / recall: Not measured",
    "",
  ];
  for (const row of criticalRecords) {
    lines.push(`## ${row.clientReportId} — ${row.original?.title || ""}`);
    lines.push("");
    lines.push(`- sheet: ${row.relativePath} (${row.sheetNumber})`);
    lines.push(`- automated assessment: ${row.assessment?.automatedAssessment}`);
    lines.push(`- retrieval success: ${row.assessment?.retrievalSuccess}`);
    lines.push(`- best score: ${row.assessment?.bestScore ?? row.retrieval?.bestScore ?? 0}`);
    lines.push(`- evidence claim: ${row.original?.drawingEvidence || ""}`);
    const top = row.retrieval?.candidates?.[0];
    if (top) {
      lines.push(`- top candidate: ${top.text}`);
      lines.push(`- region: ${top.regionId || top.clusterId || "n/a"} (${top.regionKind || "n/a"})`);
      lines.push(`- signals: ${(top.signals || []).join(", ")}`);
    } else {
      lines.push("- top candidate: none");
    }
    lines.push(`- quality flags: ${(row.qualityFlags || []).map((flag) => flag.type).join(", ") || "none"}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderSemanticReport(summary) {
  const lines = [];
  lines.push("# Phase 2A.5 semantic evidence grounding");
  lines.push("");
  lines.push("Evidence retrieval ≠ verified grounding accuracy.");
  lines.push("Precision: Not measured");
  lines.push("Recall: Not measured");
  lines.push("False-negative rate: Not measured");
  lines.push("");
  lines.push(summary.productionNote);
  lines.push(summary.methodologyNote);
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push(`- decision: ${summary.recommendation.decision}`);
  lines.push(`- ${summary.recommendation.rationale}`);
  lines.push(`- start Phase 2B: ${summary.recommendation.startPhase2B}`);
  lines.push(`- tools used: ${(summary.toolsUsed || []).join(", ")}`);
  for (const skipped of summary.toolsSkipped || []) lines.push(`- skipped: ${skipped}`);
  lines.push("");
  lines.push("## Guardrails");
  lines.push("");
  lines.push(`- inventory files: ${summary.accountability.inventoryFiles}`);
  lines.push(`- pdf files: ${summary.accountability.pdfFiles}`);
  lines.push(`- findings evaluated: ${summary.accountability.findings}`);
  lines.push(`- findings unchanged: ${summary.accountability.findingsUnchanged}`);
  lines.push(`- S-204 identity count: ${summary.accountability.s204IdentityCount}`);
  lines.push(`- S-300 match: ${summary.accountability.s300MatchMethod}`);
  lines.push(`- Archive.zip present: ${summary.accountability.archivePresent}`);
  lines.push("");
  lines.push("## Coverage (automated assessment)");
  lines.push("");
  const counts = summary.coverage.automatedAssessmentCounts;
  lines.push(`- evidence_retrieved (text/region match only): ${counts.evidence_retrieved ?? counts.supported ?? 0}`);
  lines.push(`- contradicted_candidate: ${counts.contradicted_candidate}`);
  lines.push(`- insufficient_evidence: ${counts.insufficient_evidence}`);
  lines.push(`- unresolved: ${counts.unresolved}`);
  lines.push(`- retrieval success: ${summary.coverage.retrievalSuccessCount}/${summary.coverage.total}`);
  lines.push(`- professionally verified: ${summary.coverage.professionallyVerifiedCount}`);
  lines.push("");
  lines.push("## By severity");
  lines.push("");
  lines.push("| Severity | Total | Evidence retrieved | Contradicted cand. | Insufficient | Unresolved | Retrieval success |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const severity of ["critical", "warning", "advisory"]) {
    const row = summary.coverage.bySeverity?.[severity] || {};
    lines.push(`| ${severity} | ${row.total || 0} | ${row.evidence_retrieved ?? row.supported ?? 0} | ${row.contradicted_candidate || 0} | ${row.insufficient_evidence || 0} | ${row.unresolved || 0} | ${row.retrievalSuccess || 0} |`);
  }
  lines.push("");
  lines.push("## Critical priority");
  lines.push("");
  for (const row of summary.critical.records || []) {
    lines.push(`- ${row.clientReportId} (${row.relativePath}): ${row.automatedAssessment}; score ${row.bestScore ?? "n/a"}`);
  }
  lines.push("");
  lines.push(`Duplicate candidate pairs: ${summary.duplicates.pairCount}`);
  lines.push("");
  lines.push("Reviewer pack: independent-review-pack.json (missedIssueSlots empty until human review).");
  lines.push("");
  return lines.join("\n");
}
