#!/usr/bin/env node
/**
 * Offline three-run repeatability report. No GPT calls. Writes eval output only.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRunFindings,
  summarizeRepeatability,
  topicRetention,
  matchFindingsAcrossRuns,
  findingFingerprint,
} from "../lib/threeRunRepeatability.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const fixtureDir = path.join(repoRoot, "eval/drawing-dataset/fixtures/three-run");
const baselinePath = path.join(repoRoot, "eval/drawing-dataset/fixtures/three-run-evidence-baseline.json");
const outDir = path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6/three-run");

async function loadLabeled(label) {
  const payload = JSON.parse(await readFile(path.join(fixtureDir, `findings-${label}.json`), "utf8"));
  return loadRunFindings(payload);
}

async function main() {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const runs = {
    baseline: await loadLabeled("baseline"),
    phase2b: await loadLabeled("phase2b"),
    v8: await loadLabeled("v8"),
  };
  const summary = summarizeRepeatability(runs);
  const baseToV8 = matchFindingsAcrossRuns(runs.baseline, runs.v8);
  const p2bToV8 = matchFindingsAcrossRuns(runs.phase2b, runs.v8);

  const lifeSafetyMissing = topicRetention(runs.phase2b, runs.v8).missingExamples
    .filter((key) => /door_locking|door_fire|guardrail|hydraulic|egress/i.test(key));

  const lines = [
    "# Three-run repeatability benchmark",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Professionally verified: **${baseline.professionallyVerified}**`,
    "",
    "## Scope",
    "",
    "- Compares frozen published findings from baseline / Phase 2B / v8.",
    "- Measures topic retention and severity variation only.",
    "- **Does not** claim precision, recall, or technical accuracy.",
    "",
    "## Counts",
    "",
    ...Object.entries(summary.counts).map(([label, count]) => `- ${label}: ${count}`),
    "",
    "## Pairwise match summary",
    "",
    "| Pair | Matched | Severity changed | Unmatched left | Unmatched right | Topics retained | Topics missing in right |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summary.pairwise.map((row) =>
      `| ${row.left} → ${row.right} | ${row.matchedPairs} | ${row.severityChanged} | ${row.unmatchedLeft} | ${row.unmatchedRight} | ${row.topicRetention.retained} | ${row.topicRetention.missingInRight} |`
    ),
    "",
    "## Tracked technical topics",
    "",
    ...baseline.trackedTopics.map((topic) =>
      [
        `### ${topic.id}`,
        "",
        `- Sheet: \`${topic.sheet}\``,
        `- Assessment: ${topic.assessment}`,
        `- Baseline: ${topic.acrossRuns.baseline}`,
        `- Phase 2B: ${topic.acrossRuns.phase2b}`,
        `- v8: ${topic.acrossRuns.v8}`,
        "",
      ].join("\n")
    ),
    "## Life-safety-ish topics present in Phase 2B but missing as same sheet::topic in v8",
    "",
    ...(lifeSafetyMissing.length
      ? lifeSafetyMissing.map((key) => `- ${key}`)
      : ["- (none flagged by heuristic)"]),
    "",
    "## Severity-changed pairs (Phase 2B → v8, sample)",
    "",
    ...p2bToV8.pairs
      .filter((pair) => pair.severityChanged)
      .slice(0, 15)
      .map((pair) =>
        `- ${pair.sheet} / ${pair.topic}: ${pair.severityLeft} → ${pair.severityRight} · ${pair.left.title} → ${pair.right.title}`
      ),
    "",
    "## Limitations",
    "",
    "- Matching is heuristic (sheet + topic + token overlap), not professional adjudication.",
    "- Model under-emission cannot be repaired by persist-time validation alone.",
    "- OCR notes in the evidence baseline are provisional (`independentlyVerified: false`).",
    "",
  ];

  await mkdir(outDir, { recursive: true });
  const mdPath = path.join(outDir, "repeatability-report.md");
  const jsonPath = path.join(outDir, "repeatability-summary.json");
  await writeFile(mdPath, lines.join("\n"));
  await writeFile(jsonPath, JSON.stringify({
    ...summary,
    baselineMeta: {
      version: baseline.version,
      professionallyVerified: baseline.professionallyVerified,
      trackedTopicCount: baseline.trackedTopics.length,
    },
    samples: {
      baseToV8SeverityChanged: baseToV8.pairs.filter((pair) => pair.severityChanged).slice(0, 25),
      p2bToV8SeverityChanged: p2bToV8.pairs.filter((pair) => pair.severityChanged).slice(0, 25),
      fingerprintsV8Sample: runs.v8.slice(0, 5).map(findingFingerprint),
    },
  }, null, 2));
  console.log(`Wrote ${path.relative(repoRoot, mdPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, jsonPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
