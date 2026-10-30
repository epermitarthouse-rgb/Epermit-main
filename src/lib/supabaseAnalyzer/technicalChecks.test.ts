import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TECHNICAL_CHECKS_VERSION,
  evaluateDoorScheduleChecks,
  evaluateGuardrailChecks,
  evaluateHydraulicChecks,
  mapCheckOutcomeToAdjudicationHints,
  mapProfessionalReviewToPhase2A6,
  runTechnicalChecks,
  type TechnicalEvidencePack,
} from "./technicalChecks.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "../../../eval/drawing-dataset/fixtures/technical-checks");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as T;
}

describe("technicalChecks hard rules", () => {
  it("marks version and never sets independentlyVerified true", () => {
    const report = runTechnicalChecks({ sheets: [{ sheetId: "X-1.00", packs: [] }] });
    assert.equal(report.version, TECHNICAL_CHECKS_VERSION);
    assert.equal(report.independentlyVerified, false);
    assert.ok(report.results.every((r) => r.independentlyVerified === false));
  });

  it("missing packs → unresolved (never auto-violation)", () => {
    const results = evaluateGuardrailChecks({ sheetId: "A-3.06", packs: [] });
    const height = results.find((r) => r.checkId === "guardrail.height_specified");
    assert.equal(height?.outcome, "unresolved");
    assert.match(height?.reason || "", /must not become a violation/i);
  });

  it("OCR quote does not claim compliance (no_issue_evidenced uncertainty)", () => {
    const pack = loadJson<TechnicalEvidencePack>("a306-stage3-pack.fixture.json");
    const results = evaluateGuardrailChecks({ sheetId: "A-3.06", packs: [pack] });
    const height = results.find((r) => r.checkId === "guardrail.height_specified");
    assert.equal(height?.outcome, "no_issue_evidenced");
    assert.match(height?.uncertainty || "", /not professionally verified|do not prove code compliance/i);
    assert.equal(height?.independentlyVerified, false);
  });
});

describe("guardrail checks A-3.06", () => {
  it("recovers height and detail association from Stage 3 fixture pack", () => {
    const pack = loadJson<TechnicalEvidencePack>("a306-stage3-pack.fixture.json");
    const results = evaluateGuardrailChecks({ sheetId: "A-3.06", packs: [pack] });
    assert.equal(results.find((r) => r.checkId === "guardrail.height_specified")?.outcome, "no_issue_evidenced");
    assert.equal(
      results.find((r) => r.checkId === "guardrail.height_associated_to_detail")?.outcome,
      "no_issue_evidenced",
    );
  });

  it("flags absence finding vs quoted associated height as supported_issue without clearing Critical", () => {
    const pack = loadJson<TechnicalEvidencePack>("a306-stage3-pack.fixture.json");
    const absence = loadJson<{ findings: Array<Record<string, string>> }>("a306-absence-finding.fixture.json");
    const results = evaluateGuardrailChecks({
      sheetId: "A-3.06",
      packs: [pack],
      findings: absence.findings,
    });
    const contradiction = results.find((r) => r.checkId === "guardrail.absence_claim_vs_quoted_height");
    assert.equal(contradiction?.outcome, "supported_issue");
    assert.match(contradiction?.uncertainty || "", /Does not clear Criticals/i);
  });
});

describe("door schedule checks A-6.00", () => {
  it("recovers schedule and hardware; fire may be unresolved", () => {
    const pack = loadJson<TechnicalEvidencePack>("a600-stage3-pack.fixture.json");
    const results = evaluateDoorScheduleChecks({ sheetId: "A-6.00", packs: [pack] });
    assert.equal(results.find((r) => r.checkId === "door.schedule_identified")?.outcome, "no_issue_evidenced");
    assert.equal(results.find((r) => r.checkId === "door.hardware_present")?.outcome, "no_issue_evidenced");
    const fire = results.find((r) => r.checkId === "door.fire_rating_info");
    assert.ok(fire);
    assert.ok(["no_issue_evidenced", "unresolved"].includes(fire!.outcome));
  });

  it("contradicts blanket locking absence when hardware quotes exist", () => {
    const pack = loadJson<TechnicalEvidencePack>("a600-stage3-pack.fixture.json");
    const absence = loadJson<{ findings: Array<Record<string, string>> }>("a600-absence-finding.fixture.json");
    const results = evaluateDoorScheduleChecks({
      sheetId: "A-6.00",
      packs: [pack],
      findings: absence.findings,
    });
    const contradiction = results.find((r) => r.checkId === "door.absence_claim_vs_quoted_hardware");
    assert.equal(contradiction?.outcome, "supported_issue");
    assert.match(contradiction?.uncertainty || "", /conflicts must remain eligible for Critical/i);
  });
});

describe("hydraulic checks FP200", () => {
  it("marks density×area vs larger FLOW DEMAND allegation as supported_issue", () => {
    const facts = loadJson<{
      sheetId: string;
      hydraulicFacts: Record<string, unknown>;
      findings: Array<Record<string, string>>;
      packs: TechnicalEvidencePack[];
    }>("fp200-hydraulic-facts.fixture.json");
    const results = evaluateHydraulicChecks({
      sheetId: facts.sheetId,
      hydraulicFacts: facts.hydraulicFacts as never,
      findings: facts.findings,
      packs: facts.packs,
    });
    const density = results.find((r) => r.checkId === "hydraulic.density_area_vs_flow_demand");
    assert.equal(density?.outcome, "supported_issue");
    assert.match(density?.reason || "", /not total demand/i);
  });

  it("unresolved when hydraulic numbers missing", () => {
    const results = evaluateHydraulicChecks({ sheetId: "FP200", packs: [] });
    assert.equal(
      results.find((r) => r.checkId === "hydraulic.density_area_vs_flow_demand")?.outcome,
      "unresolved",
    );
  });
});

describe("runTechnicalChecks + label maps", () => {
  it("aggregates three families for pilot sheets", () => {
    const a306 = loadJson<TechnicalEvidencePack>("a306-stage3-pack.fixture.json");
    const a600 = loadJson<TechnicalEvidencePack>("a600-stage3-pack.fixture.json");
    const fp = loadJson<{
      sheetId: string;
      hydraulicFacts: Record<string, unknown>;
      findings: Array<Record<string, string>>;
    }>("fp200-hydraulic-facts.fixture.json");
    const report = runTechnicalChecks({
      sheets: [
        { sheetId: "A-3.06", packs: [a306] },
        { sheetId: "A-6.00", packs: [a600] },
        { sheetId: "FP200", hydraulicFacts: fp.hydraulicFacts as never, findings: fp.findings },
      ],
    });
    assert.ok(report.results.length >= 8);
    assert.equal(
      report.summary.supported_issue +
        report.summary.no_issue_evidenced +
        report.summary.unresolved +
        report.summary.not_applicable,
      report.results.length,
    );
  });

  it("maps outcomes to Phase 2A.6 hints without verification", () => {
    const hints = mapCheckOutcomeToAdjudicationHints("unresolved");
    assert.equal(hints.evidenceGroundingHint, "evidence_absent");
    const mapped = mapProfessionalReviewToPhase2A6("false_positive");
    assert.equal(mapped.findingValidity, "false_positive");
  });

  it("is repeatable on fixed fixtures", () => {
    const pack = loadJson<TechnicalEvidencePack>("a306-stage3-pack.fixture.json");
    const a = runTechnicalChecks({ sheets: [{ sheetId: "A-3.06", packs: [pack] }] });
    const b = runTechnicalChecks({ sheets: [{ sheetId: "A-3.06", packs: [pack] }] });
    assert.deepEqual(
      a.results.map((r) => [r.checkId, r.outcome]),
      b.results.map((r) => [r.checkId, r.outcome]),
    );
  });
});
