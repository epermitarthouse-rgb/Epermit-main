import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applyMissedIssue } from "../lib/adjudicateRunner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const outDir = argument("--out", path.join(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6"));
const issuePath = argument("--issue");
if (!issuePath) {
  console.error("Usage: node eval/drawing-dataset/cli/adjudicate-missed.mjs --issue <file.json> [--out <dir>]");
  process.exit(2);
}

const issue = JSON.parse(await readFile(path.resolve(issuePath), "utf8"));
const result = await applyMissedIssue({
  outDir: path.resolve(outDir),
  issue,
});

console.log(`missedIssueId: ${result.issue.benchmarkMissedIssueId}`);
console.log(`sheet: ${result.issue.relativePath}`);
console.log(`professionallyVerified: ${result.issue.professionallyVerified}`);
console.log(`confirmedMissedIssues: ${result.pack.confirmedMissedIssues.length}`);
