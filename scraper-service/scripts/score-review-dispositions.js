"use strict";

/**
 * Score review dispositions against drawing-verified ground truth.
 *
 *   node scripts/score-review-dispositions.js <dispositions.json> [ground-truth.json]
 *
 * dispositions.json is an array of { n, sheet, outcome, reason, detail, openReason }.
 * Only candidates with a groundTruth label count toward accuracy metrics.
 */

const fs = require("fs");
const path = require("path");
const { outcomeForReason } = require("../app/services/compliance/review/evaluation.js");

const DEFAULT_TRUTH = path.join(__dirname, "../tests/fixtures/benchmark/permit-set-82-dispositions.json");
const SHEET_RE = /[A-Z]{1,3}-?\d[\w.-]*(?:\s[\w.-]+)?\.pdf/gi;

const ratio = (num, den) => (den ? Number((num / den).toFixed(3)) : null);
const normal = (name) => String(name || "").trim().toUpperCase();

function citedSheets(detail) {
  return [...new Set((String(detail || "").match(SHEET_RE) || []).map(normal))];
}

function stripReason(reason) {
  return String(reason || "").replace(/^PUBLISHED:/, "");
}

/**
 * A run without per-candidate dispositions only says "closed"; classify it by its rejection reason
 * so it can be compared, and count it separately as lacking a disposition.
 */
function withOutcome(item, outcomes) {
  if (outcomes.includes(item.outcome)) return item;
  return { ...item, outcome: outcomeForReason(stripReason(item.reason), false), inferredOutcome: true };
}

function scoreDispositions(dispositions, truth) {
  const byN = new Map((dispositions || []).map((item) => [item.n, withOutcome(item, truth.outcomes)]));
  const rows = [];
  for (const label of truth.candidates) {
    const got = byN.get(label.n);
    if (!got) {
      rows.push({ n: label.n, missing: true, label });
      continue;
    }
    if (!normal(got.sheet).startsWith(normal(label.sheet))) {
      throw new Error(`candidate ${label.n}: sheet ${got.sheet} does not match ground truth ${label.sheet}`);
    }
    const row = {
      n: label.n, label, outcome: got.outcome, reason: stripReason(got.reason),
      openReason: got.openReason || null, inferredOutcome: Boolean(got.inferredOutcome),
    };
    if (label.groundTruth) {
      row.acceptable = label.acceptable.includes(got.outcome)
        && !(got.outcome === "published" && label.requiredReason && row.reason !== label.requiredReason);
      row.exact = row.acceptable && got.outcome === label.expected;
      if (got.outcome === "resolved_by_evidence" && label.evidenceSheets) {
        const cited = citedSheets(got.detail);
        row.cited = cited;
        row.grounded = cited.length > 0
          && cited.every((sheet) => label.evidenceSheets.some((prefix) => sheet.startsWith(normal(prefix))));
      }
    }
    rows.push(row);
  }

  const labelled = rows.filter((row) => row.label.groundTruth && !row.missing);
  const published = labelled.filter((row) => row.outcome === "published");
  const falsePublished = published.filter((row) => !row.acceptable);
  const shouldPublish = labelled.filter((row) => row.label.expected === "published");
  const resolved = labelled.filter((row) => row.outcome === "resolved_by_evidence");
  const groundable = resolved.filter((row) => row.grounded !== undefined);
  const allOpen = rows.filter((row) => row.outcome === "open_check");
  const byDiscipline = {};
  for (const row of labelled) {
    const entry = byDiscipline[row.label.discipline] || (byDiscipline[row.label.discipline] = { labelled: 0, acceptable: 0 });
    entry.labelled += 1;
    if (row.acceptable) entry.acceptable += 1;
  }

  return {
    candidates: truth.candidates.length,
    withDisposition: rows.filter((row) => !row.missing && !row.inferredOutcome).length,
    labelled: labelled.length,
    outcomes: rows.reduce((acc, row) => ({ ...acc, [row.outcome || "missing"]: (acc[row.outcome || "missing"] || 0) + 1 }), {}),
    acceptableRate: ratio(labelled.filter((row) => row.acceptable).length, labelled.length),
    exactRate: ratio(labelled.filter((row) => row.exact).length, labelled.length),
    publicationPrecision: ratio(published.length - falsePublished.length, published.length),
    publicationRecall: ratio(shouldPublish.filter((row) => row.outcome === "published" && row.acceptable).length, shouldPublish.length),
    falsePublications: falsePublished.map((row) => row.n),
    wrongResolutions: resolved.filter((row) => !row.acceptable).map((row) => row.n),
    wrongSuppressions: labelled
      .filter((row) => !row.acceptable && ["correctly_rejected", "not_applicable"].includes(row.outcome))
      .map((row) => row.n),
    groundingRate: ratio(groundable.filter((row) => row.grounded).length, groundable.length),
    ungrounded: groundable.filter((row) => !row.grounded).map((row) => ({ n: row.n, cited: row.cited })),
    openChecks: allOpen.length,
    openWithReason: allOpen.filter((row) => row.openReason).length,
    byDiscipline,
    unacceptable: labelled.filter((row) => !row.acceptable).map((row) => ({ n: row.n, outcome: row.outcome, reason: row.reason, expected: row.label.expected })),
  };
}

if (require.main === module) {
  const [input, truthPath = DEFAULT_TRUTH] = process.argv.slice(2);
  if (!input) {
    console.error("usage: node scripts/score-review-dispositions.js <dispositions.json> [ground-truth.json]");
    process.exit(2);
  }
  const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
  const dispositions = JSON.parse(fs.readFileSync(input, "utf8"));
  console.log(JSON.stringify(scoreDispositions(dispositions, truth), null, 2));
}

module.exports = { scoreDispositions, citedSheets };
