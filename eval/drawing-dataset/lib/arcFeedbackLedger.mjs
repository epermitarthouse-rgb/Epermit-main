/**
 * ARC feedback ledger helpers (eval-only).
 * Append-only structured reviews. Never mutates AI findings rows.
 * Never promotes independentlyVerified/contributesToMetrics unless explicitly authorized.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const LEDGER_VERSION = "arc.feedback-ledger.v1";

export const PROFESSIONAL_DECISIONS = [
  "confirmed_issue",
  "false_positive",
  "partially_supported",
  "insufficient_evidence",
  "not_applicable",
];

export const TRIAGE_DECISIONS = ["accepted", "modified", "rejected"];

export const ALL_DECISIONS = [...PROFESSIONAL_DECISIONS, ...TRIAGE_DECISIONS];

/** Map in-app Accept/Modify/Reject to professional classifications for benchmark use. */
export function mapTriageToProfessional(decision) {
  if (decision === "accepted") return "confirmed_issue";
  if (decision === "rejected") return "false_positive";
  if (decision === "modified") return "partially_supported";
  return null;
}

export function normalizeDecision(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  const aliases = {
    accept: "accepted",
    accept_finding: "confirmed_issue",
    reject: "rejected",
    reject_finding: "false_positive",
    modify: "modified",
    unresolved: "insufficient_evidence",
    needs_more_evidence: "insufficient_evidence",
    needs_other_discipline: "insufficient_evidence",
  };
  const mapped = aliases[raw] || raw;
  return ALL_DECISIONS.includes(mapped) ? mapped : null;
}

export function assertNoSilentPromotion(record, options = {}) {
  const authorize = Boolean(options.authorizeMetricsContribution);
  if (record.independentlyVerified === true && !authorize) {
    throw new Error("independentlyVerified=true requires --authorize-metrics");
  }
  if (record.contributesToMetrics === true && !authorize) {
    throw new Error("contributesToMetrics=true requires --authorize-metrics");
  }
}

export function createLedgerRecord(partial, options = {}) {
  const decision = normalizeDecision(partial.decision);
  if (!decision) {
    throw new Error(`Invalid decision: ${partial.decision}`);
  }
  const record = {
    ledgerVersion: LEDGER_VERSION,
    recordId: partial.recordId || randomUUID(),
    recordedAt: partial.recordedAt || new Date().toISOString(),
    source: partial.source || "manual",
    status: partial.status || "preliminary",
    pbItemId: partial.pbItemId ?? null,
    findingOrCheckId: partial.findingOrCheckId ?? null,
    technicalCheckId: partial.technicalCheckId ?? null,
    sourceRunId: partial.sourceRunId ?? null,
    findingId: partial.findingId ?? null,
    sheetId: partial.sheetId ?? null,
    drawingNumber: partial.drawingNumber ?? null,
    drawingRevision: partial.drawingRevision ?? null,
    originalAi: {
      title: partial.originalAi?.title ?? null,
      severity: partial.originalAi?.severity ?? null,
      rationale: partial.originalAi?.rationale ?? null,
      evidenceQuote: partial.originalAi?.evidenceQuote ?? null,
    },
    decision,
    correctedInterpretation: partial.correctedInterpretation ?? null,
    modifiedSeverity: partial.modifiedSeverity ?? null,
    modifiedCodeReference: partial.modifiedCodeReference ?? null,
    supportingEvidence: partial.supportingEvidence ?? null,
    justification: partial.justification ?? null,
    reviewer: {
      identity: partial.reviewer?.identity ?? null,
      role: partial.reviewer?.role ?? null,
      discipline: partial.reviewer?.discipline ?? null,
      reviewedAt: partial.reviewer?.reviewedAt ?? partial.recordedAt ?? null,
    },
    analyzerVersion: partial.analyzerVersion ?? null,
    evidenceExtractionVersion: partial.evidenceExtractionVersion ?? null,
    independentlyVerified: Boolean(partial.independentlyVerified),
    contributesToMetrics: Boolean(partial.contributesToMetrics),
    needsSecondReview: Boolean(partial.needsSecondReview),
    disagreementWithRecordId: partial.disagreementWithRecordId ?? null,
    notes: partial.notes ?? null,
  };
  assertNoSilentPromotion(record, options);
  if (!options.authorizeMetricsContribution) {
    record.independentlyVerified = false;
    record.contributesToMetrics = false;
  }
  return record;
}

export async function readLedger(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function appendLedger(filePath, record) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function contentHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export function findLink(linkMap, query = {}) {
  const links = linkMap.links || [];
  if (query.pbItemId) {
    return links.find((row) => row.pbItemId === query.pbItemId) || null;
  }
  if (query.findingOrCheckId) {
    return links.find((row) => row.findingOrCheckId === query.findingOrCheckId) || null;
  }
  return null;
}

/**
 * Apply a professional decision onto a benchmark item reviewer block.
 * Preserves original AI fields on the item.
 */
export function applyDecisionToItem(item, decisionInput, options = {}) {
  const decision = normalizeDecision(decisionInput.decision);
  if (!decision) throw new Error(`Invalid decision for ${item.id}`);
  const professional = PROFESSIONAL_DECISIONS.includes(decision)
    ? decision
    : mapTriageToProfessional(decision);
  if (!professional) throw new Error(`Cannot map decision ${decision} for ${item.id}`);

  const authorize = Boolean(options.authorizeMetricsContribution);
  const next = {
    ...item,
    // analyzerFinding / evidenceQuote remain the original AI snapshot — never rewritten here.
    reviewer: {
      ...(item.reviewer || {}),
      decision: professional,
      explanation: decisionInput.justification || decisionInput.explanation || item.reviewer?.explanation || null,
      correctedInterpretation:
        decisionInput.correctedInterpretation ?? item.reviewer?.correctedInterpretation ?? null,
      modifiedSeverity: decisionInput.modifiedSeverity ?? item.reviewer?.modifiedSeverity ?? null,
      identity: decisionInput.reviewer?.identity || item.reviewer?.identity || null,
      role: decisionInput.reviewer?.role || item.reviewer?.role || null,
      discipline: decisionInput.reviewer?.discipline || item.reviewer?.discipline || null,
      reviewedAt: decisionInput.reviewer?.reviewedAt || new Date().toISOString(),
      professionallyVerified: authorize ? Boolean(decisionInput.professionallyVerified) : false,
      contributesToMetrics: authorize ? Boolean(decisionInput.contributesToMetrics) : false,
    },
  };
  return next;
}

export function detectDisagreements(ledgerRows) {
  const byItem = new Map();
  for (const row of ledgerRows) {
    if (!row.pbItemId || row.status === "preliminary") continue;
    const list = byItem.get(row.pbItemId) || [];
    list.push(row);
    byItem.set(row.pbItemId, list);
  }
  const disputes = [];
  for (const [pbItemId, rows] of byItem) {
    const decisions = new Set(rows.map((r) => r.decision));
    if (decisions.size > 1) {
      disputes.push({
        pbItemId,
        decisions: [...decisions],
        recordIds: rows.map((r) => r.recordId),
      });
    }
  }
  return disputes;
}

export function summarizeFeedback(ledgerRows, items = []) {
  const counts = Object.fromEntries(ALL_DECISIONS.map((d) => [d, 0]));
  const byStatus = {};
  const recurring = {
    false_positive: [],
    insufficient_evidence: [],
    confirmed_issue: [],
    missed_issue_hints: [],
  };
  for (const row of ledgerRows) {
    counts[row.decision] = (counts[row.decision] || 0) + 1;
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    if (row.decision === "false_positive" || row.decision === "rejected") {
      recurring.false_positive.push(row.pbItemId || row.findingOrCheckId);
    }
    if (row.decision === "insufficient_evidence") {
      recurring.insufficient_evidence.push(row.pbItemId || row.findingOrCheckId);
    }
    if (row.decision === "confirmed_issue" || row.decision === "accepted") {
      recurring.confirmed_issue.push(row.pbItemId || row.findingOrCheckId);
    }
  }
  const reviewedItems = items.filter((i) => i.reviewer?.decision);
  const completion = {
    totalItems: items.length,
    reviewedItems: reviewedItems.length,
    remaining: Math.max(0, items.length - reviewedItems.length),
  };
  return {
    decisionCounts: counts,
    statusCounts: byStatus,
    completion,
    disagreements: detectDisagreements(ledgerRows),
    recurring,
    metricsEligible: ledgerRows.filter((r) => r.contributesToMetrics).length,
    independentlyVerifiedCount: ledgerRows.filter((r) => r.independentlyVerified).length,
  };
}

export function buildMissedIssueRecord(input) {
  if (!String(input.title || "").trim()) throw new Error("missed issue title required");
  if (!String(input.drawingLocation || "").trim()) throw new Error("missed issue drawingLocation required");
  return {
    id: input.id || `missed-${randomUUID()}`,
    title: String(input.title).trim(),
    severity: input.severity || null,
    observation: input.observation || null,
    drawingLocation: String(input.drawingLocation).trim(),
    evidenceQuote: input.evidenceQuote || null,
    codeEditionSection: input.codeEditionSection || null,
    reviewerIdentity: input.reviewerIdentity || null,
    reviewerRole: input.reviewerRole || null,
    reviewedAt: input.reviewedAt || new Date().toISOString(),
    professionallyVerified: false,
    contributesToMetrics: false,
    notes: input.notes || null,
  };
}
