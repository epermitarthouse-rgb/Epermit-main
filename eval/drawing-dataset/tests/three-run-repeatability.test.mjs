import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findingFingerprint,
  loadRunFindings,
  matchFindingsAcrossRuns,
  summarizeRepeatability,
  topicRetention,
} from "../lib/threeRunRepeatability.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../fixtures/three-run");
const baselinePath = path.join(__dirname, "../fixtures/three-run-evidence-baseline.json");

async function load(label) {
  const payload = JSON.parse(await readFile(path.join(fixtureDir, `findings-${label}.json`), "utf8"));
  return loadRunFindings(payload);
}

describe("three-run repeatability baseline", () => {
  it("freezes three production published-finding dumps without claiming accuracy", async () => {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    assert.equal(baseline.professionallyVerified, false);
    const runs = {
      baseline: await load("baseline"),
      phase2b: await load("phase2b"),
      v8: await load("v8"),
    };
    assert.equal(runs.baseline.length, 252);
    assert.equal(runs.phase2b.length, 246);
    assert.equal(runs.v8.length, 214);
    const summary = summarizeRepeatability(runs);
    assert.equal(summary.professionallyVerified, false);
    assert.ok(summary.pairwise.length >= 3);
    assert.match(JSON.stringify(summary), /Repeatability only/);
  });

  it("matches by sheet+topic+tokens rather than titles alone", () => {
    const left = [{
      file: "A-3.06-00.pdf",
      sev: "warning",
      title: "Guard Rail Height Verification",
      obs: "The guard rail elevation detail does not specify the guard rail height.",
    }];
    const right = [{
      file: "A-3.06-00.pdf",
      sev: "critical",
      title: "Guardrail Height Missing Verification",
      obs: "Detail does not confirm guardrail height, raising compliance concerns with minimum height standard.",
    }];
    const matched = matchFindingsAcrossRuns(left, right);
    assert.equal(matched.pairs.length, 1);
    assert.equal(matched.pairs[0].severityChanged, true);
    assert.equal(findingFingerprint(left[0]).primaryTopic, "guardrail_height");
  });

  it("flags topic retention gaps without inventing findings", async () => {
    const phase2b = await load("phase2b");
    const v8 = await load("v8");
    const retention = topicRetention(phase2b, v8);
    assert.ok(retention.retained > 0);
    assert.ok(Array.isArray(retention.missingExamples));
  });
});
