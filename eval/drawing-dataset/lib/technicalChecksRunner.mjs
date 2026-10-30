/**
 * Node runner for technicalChecks.ts fixtures (no GPT).
 * Dynamic-imports the TypeScript module via Node's native type stripping when available,
 * otherwise expects the caller to run through `node --experimental-strip-types` or tsx.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export async function loadTechnicalChecksModule(repoRoot) {
  const tsPath = path.join(repoRoot, "src/lib/supabaseAnalyzer/technicalChecks.ts");
  try {
    return await import(pathToFileURL(tsPath).href);
  } catch (error) {
    // Fallback: some Node versions need strip-types flag; surface clear error.
    const err = new Error(
      `Unable to import technicalChecks.ts (${error.message}). Run with Node 22+ or node --experimental-strip-types.`,
    );
    err.cause = error;
    throw err;
  }
}

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function buildPilotSheetInputs(fixtureDir) {
  const a306Pack = await loadJson(path.join(fixtureDir, "a306-stage3-pack.fixture.json"));
  const a600Pack = await loadJson(path.join(fixtureDir, "a600-stage3-pack.fixture.json"));
  const a306Absence = await loadJson(path.join(fixtureDir, "a306-absence-finding.fixture.json"));
  const a600Absence = await loadJson(path.join(fixtureDir, "a600-absence-finding.fixture.json"));
  const fp = await loadJson(path.join(fixtureDir, "fp200-hydraulic-facts.fixture.json"));
  return [
    {
      sheetId: "A-3.06",
      packs: [a306Pack],
      findings: a306Absence.findings,
    },
    {
      sheetId: "A-6.00",
      packs: [a600Pack],
      findings: a600Absence.findings,
    },
    {
      sheetId: "FP200",
      packs: fp.packs || [],
      hydraulicFacts: fp.hydraulicFacts,
      findings: fp.findings,
    },
  ];
}

/** Lightweight topic retention for Stage1–2 fixture findings if provided. */
export function classifyEmissionVariance(trackedTopic, acrossRuns) {
  const severities = Object.values(acrossRuns || {}).map((row) =>
    String(row?.severity || row || "").toLowerCase(),
  );
  const unique = new Set(severities.filter(Boolean));
  return {
    topicId: trackedTopic,
    severityVariants: [...unique],
    emissionVariance: unique.size > 1,
    note: unique.size > 1
      ? "Severity/emission changed across runs — model or evidence config variance."
      : "Stable severity label across compared runs (heuristic).",
  };
}

export function requireNodeAssert() {
  return require("node:assert/strict");
}
