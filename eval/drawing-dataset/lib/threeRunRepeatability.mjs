/**
 * Offline three-run repeatability benchmark (topic retention / severity variation).
 * Not technical accuracy. Not precision/recall. Not professionally verified ground truth.
 */

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "onto", "over",
  "under", "not", "are", "was", "were", "has", "have", "been", "does", "did",
  "sheet", "drawing", "detail", "note", "notes", "plan", "title", "block",
  "should", "must", "shall", "provide", "review", "confirm", "verify",
]);

const TOPIC_PATTERNS = [
  { id: "date_revision_admin", re: /\b(future|revision\s+dates?|date\s+discrepan|analysis\s+date|permit\s+set\s+date|chronolog)/i },
  { id: "guardrail_height", re: /\bguard(?:\s*-?\s*rail)?\b.*\bheight\b|\bheight\b.*\bguard(?:\s*-?\s*rail)?/i },
  { id: "door_locking", re: /\b(lock(?:ing)?\s+mechanism|panic\s+hardware|door\s+hardware|keyless)\b/i },
  { id: "door_fire_rating", re: /\bfire[- ]rat(?:ed|ing)\b.*\bdoor|\bdoor\b.*\bfire[- ]rat/i },
  { id: "hydraulic_density_flow", re: /\b(density|flow\s+demand|hydraulic)\b/i },
  { id: "cross_sheet_pointer", re: /\b(see\s+sheet|see\s+detail|refer(?:ence)?\s+to)\b/i },
  { id: "egress_life_safety", re: /\b(means\s+of\s+egress|exit\s+door|clear\s+width|occupant\s+load)\b/i },
];

const SEV_RANK = { critical: 3, warning: 2, advisory: 1 };

export function normalizeSheetFile(fileName = "") {
  return String(fileName)
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, "")
    .replace(/-00$/i, "")
    .toUpperCase();
}

export function tokenize(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3 && !STOP.has(token));
}

export function topicIdsForFinding(finding) {
  const blob = `${finding.title || ""} ${finding.obs || finding.observation || ""}`;
  const hits = TOPIC_PATTERNS.filter((topic) => topic.re.test(blob)).map((topic) => topic.id);
  return hits.length ? hits : ["other"];
}

export function findingFingerprint(finding) {
  const sheet = normalizeSheetFile(finding.file || finding.original_file_name || "");
  const topics = topicIdsForFinding(finding);
  const tokens = tokenize(`${finding.title || ""} ${finding.obs || finding.observation || ""}`).slice(0, 12);
  return {
    sheet,
    topics,
    primaryTopic: topics[0],
    tokenKey: tokens.slice(0, 8).join(" "),
    severity: String(finding.sev || finding.severity || "").toLowerCase(),
    title: finding.title || "",
  };
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Match findings across two runs by sheet + topic overlap + token similarity.
 * Titles alone are intentionally not used as the sole key.
 */
export function matchFindingsAcrossRuns(leftFindings, rightFindings, options = {}) {
  const minToken = options.minTokenOverlap ?? 0.28;
  const left = leftFindings.map((item, index) => ({ index, fp: findingFingerprint(item), item }));
  const right = rightFindings.map((item, index) => ({ index, fp: findingFingerprint(item), item }));
  const usedRight = new Set();
  const pairs = [];

  for (const L of left) {
    let best = null;
    for (const R of right) {
      if (usedRight.has(R.index)) continue;
      if (L.fp.sheet !== R.fp.sheet) continue;
      const topicHit = L.fp.topics.some((topic) => R.fp.topics.includes(topic));
      if (!topicHit && L.fp.primaryTopic !== "other") continue;
      const score = jaccard(tokenize(`${L.item.title} ${L.item.obs || ""}`), tokenize(`${R.item.title} ${R.item.obs || ""}`));
      if (score < minToken && L.fp.primaryTopic !== R.fp.primaryTopic) continue;
      if (score < minToken && L.fp.primaryTopic === "other") continue;
      const topicBoost = topicHit ? 0.15 : 0;
      const total = score + topicBoost;
      if (!best || total > best.total) best = { R, score, total };
    }
    if (best && (best.score >= minToken || (best.R.fp.primaryTopic === L.fp.primaryTopic && L.fp.primaryTopic !== "other"))) {
      usedRight.add(best.R.index);
      pairs.push({
        left: L.item,
        right: best.R.item,
        sheet: L.fp.sheet,
        topic: L.fp.primaryTopic,
        tokenOverlap: Number(best.score.toFixed(3)),
        severityLeft: L.fp.severity,
        severityRight: best.R.fp.severity,
        severityChanged: L.fp.severity !== best.R.fp.severity,
        severityDelta: (SEV_RANK[best.R.fp.severity] || 0) - (SEV_RANK[L.fp.severity] || 0),
      });
    }
  }

  const unmatchedLeft = left.filter((row) => !pairs.some((pair) => pair.left === row.item)).map((row) => row.item);
  const unmatchedRight = right.filter((row) => !usedRight.has(row.index)).map((row) => row.item);
  return { pairs, unmatchedLeft, unmatchedRight };
}

export function summarizeRepeatability(runs) {
  const labels = Object.keys(runs);
  const pairwise = [];
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const a = labels[i];
      const b = labels[j];
      const matched = matchFindingsAcrossRuns(runs[a], runs[b]);
      const severityChanged = matched.pairs.filter((pair) => pair.severityChanged).length;
      pairwise.push({
        left: a,
        right: b,
        matchedPairs: matched.pairs.length,
        severityChanged,
        unmatchedLeft: matched.unmatchedLeft.length,
        unmatchedRight: matched.unmatchedRight.length,
        topicRetention: topicRetention(runs[a], runs[b]),
      });
    }
  }
  return {
    professionallyVerified: false,
    note: "Repeatability only. Does not measure technical accuracy or precision/recall.",
    counts: Object.fromEntries(labels.map((label) => [label, runs[label].length])),
    pairwise,
  };
}

export function topicRetention(leftFindings, rightFindings) {
  const leftTopics = new Map();
  const rightTopics = new Map();
  for (const finding of leftFindings) {
    const fp = findingFingerprint(finding);
    const key = `${fp.sheet}::${fp.primaryTopic}`;
    leftTopics.set(key, (leftTopics.get(key) || 0) + 1);
  }
  for (const finding of rightFindings) {
    const fp = findingFingerprint(finding);
    const key = `${fp.sheet}::${fp.primaryTopic}`;
    rightTopics.set(key, (rightTopics.get(key) || 0) + 1);
  }
  const retained = [];
  const missingInRight = [];
  const newInRight = [];
  for (const key of leftTopics.keys()) {
    if (rightTopics.has(key)) retained.push(key);
    else missingInRight.push(key);
  }
  for (const key of rightTopics.keys()) {
    if (!leftTopics.has(key)) newInRight.push(key);
  }
  return {
    retained: retained.length,
    missingInRight: missingInRight.length,
    newInRight: newInRight.length,
    missingExamples: missingInRight.slice(0, 20),
    newExamples: newInRight.slice(0, 20),
  };
}

export function loadRunFindings(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.findings)) return payload.findings;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}
