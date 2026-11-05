import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAnalyzerVersion,
  withAnalyzerVersion,
} from "../../../supabase/functions/_shared/analyzerVersion.ts";
import { DEFAULT_ANALYZER_VERSION } from "./analyzerVersion.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Captures Edge Function bodies; nothing leaves the process. */
const sent: Array<Record<string, unknown>> = [];
const realFetch = globalThis.fetch;
let client: typeof import("./client.ts");

before(async () => {
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ runId: "run-new", created: true, uploads: [], reused: 0, added: 0, replaced: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  client = await import("./client.ts");
});

after(() => {
  globalThis.fetch = realFetch;
});

const runContext = {
  jurisdictionKey: "dc",
  jurisdictionLabel: "Washington, DC",
  projectType: "Commercial (General)",
  codeEdition: "2017",
  codeContext: "DC",
};

function serverScope(body: Record<string, unknown>) {
  const version = parseAnalyzerVersion(body.analyzerVersion);
  assert.equal(typeof version, "string");
  return withAnalyzerVersion({ analysisMode: "both" }, version as "v1" | "v2", { requiredSheetCount: 1 });
}

function assertV2FourByThree(body: Record<string, unknown>) {
  assert.equal(body.analyzerVersion, "v2");
  const scope = serverScope(body);
  assert.equal(scope.analyzerVersion, "v2");
  assert.equal(scope.stage3EvidenceVersion, "v2");
  assert.equal(scope.stage3OcrGrid, "4x3");
  assert.equal(scope.stage3V2ModelRevision, "model.r6-downstream");
  assert.notEqual(scope.stage3OcrGrid, "12x9");
}

describe("New Supabase Analyzer runs use V2 (4×3 OCR)", () => {
  it("defaults the UI to V2", () => {
    assert.equal(DEFAULT_ANALYZER_VERSION, "v2");
  });

  it("sends analyzerVersion v2 when a new run is created from the UI", async () => {
    sent.length = 0;
    await client.createSupabaseAnalyzerRun({
      projectId: "p",
      files: [new File([new Uint8Array([1])], "A-101.pdf", { type: "application/pdf" })],
      analyzerVersion: DEFAULT_ANALYZER_VERSION,
      ...runContext,
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].action, "create");
    assertV2FourByThree(sent[0]);
  });

  it("sends analyzerVersion v2 when a rerun creates a new run", async () => {
    sent.length = 0;
    await client.reanalyzeSupabaseAnalyzerRun({
      projectId: "p",
      sourceRunId: "old-v1-run",
      runId: "run-new",
      scope: "all",
      jobIds: [],
      files: [],
      confirmed: true,
      analyzerVersion: DEFAULT_ANALYZER_VERSION,
      ...runContext,
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].action, "reanalyze");
    assertV2FourByThree(sent[0]);
  });

  it("sends v2 when a caller omits the version", async () => {
    sent.length = 0;
    await client.createSupabaseAnalyzerRun({ projectId: "p", files: [], ...runContext });
    assertV2FourByThree(sent[0]);
  });

  it("has no version toggle in the analyzer UI", () => {
    const ui = readFileSync(join(__dirname, "../../components/compliance/SupabaseCodeAnalyzer.tsx"), "utf8");
    assert.doesNotMatch(ui, /analyzer-version-control|analyzer-version-\$\{|setAnalyzerVersion|ToggleGroup|analyzerVersionOptions/);
    assert.match(ui, /const analyzerVersion: AnalyzerVersion = DEFAULT_ANALYZER_VERSION;/);
    assert.equal([...ui.matchAll(/^\s+analyzerVersion,$/gm)].length, 3);
    assert.doesNotMatch(ui, /12x9/);
  });

  it("hides the six-layer Code Analyzer V2 while the Supabase analyzer is on, keeping its code", () => {
    const nav = readFileSync(join(__dirname, "../../components/layout/hybridNav.ts"), "utf8");
    assert.match(nav, /isSupabaseAnalyzerEnabled\(\)\s*\? \[\{\s*title: "Code Analyzer",[\s\S]*?\}\]\s*: \[\{\s*title: "Code Analyzer V2",/);
    const palette = readFileSync(join(__dirname, "../../components/navigation/CommandPalette.tsx"), "utf8");
    assert.doesNotMatch(palette, /\/code-compliance/);
    const page = readFileSync(join(__dirname, "../../pages/CodeCompliance.tsx"), "utf8");
    assert.match(page, /if \(isSupabaseAnalyzerEnabled\(\)\) \{\s*return <Navigate to="\/code-analyzer" replace \/>;/);
    assert.match(page, /<AIComplianceAnalyzer \/>/);
  });
});
