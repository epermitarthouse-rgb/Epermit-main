"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  resolveLegalApplicability,
  bundledAuthoritativeProvisions,
} = require("../app/services/compliance/rag/jurisdictionEditionRegistry.js");
const {
  retrieveCodeProvisions,
} = require("../app/services/compliance/rag/codeCorpus.js");
const {
  createDrawingIndex,
} = require("../app/services/compliance/rag/drawingIndex.js");
const {
  prepareSheetReview,
} = require("../app/services/compliance/review/orchestrate.js");
const {
  hardenAnalysisResult,
} = require("../app/services/compliance/findingQuality.js");

describe("jurisdiction and edition verification", () => {
  it("keeps DC + selected IBC 2021 as a confirmed mismatch and reference-only", () => {
    const result = resolveLegalApplicability({
      jurisdiction: "dc",
      selectedEdition: "2021",
      requestedReviewScope: "permit_compliance",
      permitFacts: {},
    });
    assert.equal(result.status, "conflict");
    assert.equal(result.reviewScope, "reference_only");
    assert.equal(result.adoptedEdition, "District of Columbia Construction Codes 2017");
    assert.equal(result.adoptedBaseCode, "IBC 2015");
    assert.equal(result.requiresReferenceConfirmation, true);
    assert.match(result.officialSourceUrl, /dob\.dc\.gov/);
  });

  it("keeps General IBC 2021 as reference-only without a local override", () => {
    const result = resolveLegalApplicability({
      jurisdiction: "general",
      selectedEdition: "2021",
      requestedReviewScope: "permit_compliance",
    });
    assert.equal(result.status, "reference_only");
    assert.equal(result.reviewScope, "reference_only");
    assert.equal(result.adoptedEdition, null);
  });

  it("verifies a matching DC adoption only with application date and work scope", () => {
    const result = resolveLegalApplicability({
      jurisdiction: "dc",
      selectedEdition: "2015",
      requestedReviewScope: "permit_compliance",
      permitFacts: {
        applicationDate: "2026-10-20",
        workScope: "new_construction",
        occupancy: "commercial",
      },
    });
    assert.equal(result.status, "verified");
    assert.equal(result.reviewScope, "permit_compliance");
    assert.equal(result.registryRecordId, "dc-2017-construction-codes");
  });

  it("marks unsupported jurisdictions unavailable instead of inventing adoption", () => {
    const result = resolveLegalApplicability({
      jurisdiction: "seattle",
      selectedEdition: "2021",
      requestedReviewScope: "permit_compliance",
      permitFacts: { applicationDate: "2026-10-20", workScope: "alteration" },
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.sourceStatus, "unavailable");
    assert.equal(result.reviewScope, "reference_only");
  });

  it("requires transition facts for a pre-adoption application", () => {
    const missing = resolveLegalApplicability({
      jurisdiction: "dc",
      selectedEdition: "2012",
      requestedReviewScope: "permit_compliance",
      permitFacts: { applicationDate: "2020-05-01", workScope: "alteration" },
    });
    assert.equal(missing.status, "unresolved");
    assert.equal(missing.transitionSection, "12-A DCMR 123.1.2");
    assert.ok(missing.unresolvedReasons.length >= 2);

    const documented = resolveLegalApplicability({
      jurisdiction: "dc",
      selectedEdition: "2012",
      requestedReviewScope: "permit_compliance",
      permitFacts: {
        applicationDate: "2020-05-01",
        applicationDepositPaidDate: "2020-05-01",
        applicationComplete: true,
        workScope: "alteration",
      },
    });
    assert.equal(documented.status, "verified");
    assert.equal(documented.registryRecordId, "dc-2013-construction-codes");
  });

  it("leaves a missing permit date unresolved", () => {
    const result = resolveLegalApplicability({
      jurisdiction: "dc",
      selectedEdition: "2015",
      requestedReviewScope: "permit_compliance",
      permitFacts: { workScope: "existing_building" },
    });
    assert.equal(result.status, "unresolved");
    assert.match(result.unresolvedReasons.join(" "), /date/i);
  });

  it("handles documented revisions conservatively", () => {
    const result = resolveLegalApplicability({
      jurisdiction: "dc",
      selectedEdition: "2012",
      requestedReviewScope: "permit_compliance",
      permitFacts: {
        applicationDate: "2026-10-20",
        workScope: "revision",
        originalPermitCodeEdition: "2012",
        priorPermitActive: true,
      },
    });
    assert.equal(result.status, "verified");
    assert.equal(result.transitionSection, "12-A DCMR 123.1.5");
    assert.equal(result.registryRecordId, "dc-2013-construction-codes");
  });
});

describe("authoritative Code RAG", () => {
  it("filters official excerpts by jurisdiction and edition before topic matching", () => {
    const dc = retrieveCodeProvisions({
      jurisdiction: "dc",
      edition: "2015",
      topics: ["permit revision", "transition"],
      authoritativeOnly: true,
    });
    assert.ok(dc.some((hit) => hit.section === "123.1.5"));
    assert.ok(dc.every((hit) => hit.authoritative && hit.sourceUrl && hit.verificationDate));

    const wrongEdition = retrieveCodeProvisions({
      jurisdiction: "dc",
      edition: "2021",
      topics: ["permit revision"],
      authoritativeOnly: true,
    });
    assert.equal(wrongEdition.length, 0);
  });

  it("never promotes a verified summary to authoritative code text", () => {
    const hits = retrieveCodeProvisions({
      jurisdiction: "dc",
      edition: "2015",
      topics: ["application date"],
      authoritativeOnly: false,
    });
    const summary = hits.find((hit) => hit.id === "dc-2017-12a-102.6");
    assert.ok(summary);
    assert.equal(summary.authoritative, false);
    assert.equal(summary.section, null);
  });

  it("models an amendment-changing-base fixture without weakening deterministic filters", () => {
    const base = {
      id: "fixture-base",
      jurisdiction: "any",
      codeBook: "IBC",
      edition: "2021",
      section: "X.1",
      text: "The maximum test dimension is 44 inches.",
      sourceStatus: "verified_text",
      authoritative: true,
      supportsConfirmedViolation: true,
      topics: ["test dimension"],
    };
    const amendment = {
      ...base,
      id: "fixture-amendment",
      jurisdiction: "fixture-city",
      codeBook: "Fixture Municipal Code",
      text: "The amended maximum test dimension is 40 inches.",
      registryRecordId: "fixture-2021",
    };
    const hits = retrieveCodeProvisions({
      jurisdiction: "fixture-city",
      edition: "2021",
      registryRecordId: "fixture-2021",
      topics: ["test dimension"],
      provisions: [base, amendment],
      authoritativeOnly: true,
    });
    assert.ok(hits.some((hit) => hit.id === "fixture-amendment"));
    assert.ok(!hits.some((hit) => hit.id === "fixture-base"));
  });

  it("integrates Drawing RAG and Code RAG without treating either hit as proof by itself", () => {
    const index = createDrawingIndex();
    index.upsert({
      sheetId: "a101",
      fileName: "A-1.01.pdf",
      title: "Floor plan",
      discipline: "architectural",
      text: 'FLOOR PLAN CORRIDOR 36" CLEAR',
      observations: [],
    });
    const legalApplicability = resolveLegalApplicability({
      jurisdiction: "dc",
      selectedEdition: "2015",
      requestedReviewScope: "permit_compliance",
      permitFacts: { applicationDate: "2026-10-20", workScope: "alteration" },
    });
    const provisions = bundledAuthoritativeProvisions({
      jurisdiction: "dc",
      selectedEdition: "2015",
      registryRecordId: legalApplicability.registryRecordId,
    });
    const prepared = prepareSheetReview({
      sheet: { id: "a102", fileName: "A-1.02.pdf", discipline: "architectural" },
      pageText: "FLOOR PLAN",
      contentClass: "floor_plan",
      index,
      codeYear: "2015",
      jurisdictionScope: { enforcedJurisdiction: "dc", amendmentsEnforced: true },
      codeVerification: {
        legalApplicability,
        provisions,
        coverage: { status: "applicability_only" },
      },
    });
    assert.ok(prepared.retrieval.packages.some((pack) => pack.drawing.length > 0));
    assert.ok(prepared.authoritativeCode.every((hit) => hit.provesRequirementSatisfied === false));
  });
});

describe("confirmed-violation gate", () => {
  const verifiedProvision = {
    id: "fixture-riser",
    registryRecordId: "fixture-city-2021",
    jurisdiction: "fixture-city",
    codeBook: "Fixture Municipal Code",
    edition: "2021",
    section: "1011.5.2",
    text: 'Fixture Municipal Code Section 1011.5.2 maximum riser height is 7".',
    sourceStatus: "verified_text",
    authoritative: true,
    supportsConfirmedViolation: true,
    exceptions: [],
    sourceUrl: "https://example.gov/code/1011.5.2",
    sourceLocator: "Section 1011.5.2",
  };
  const candidate = {
    severity: "warning",
    category: "Egress",
    title: "Stair riser",
    description: 'Stair riser is 8" and exceeds the verified maximum of 7".',
    codeReference: "Fixture Municipal Code 1011.5.2",
    findingType: "confirmed_violation",
    measurableEvidence: true,
    evidenceTier: "drawing",
    location: "Stair A",
  };
  const ctx = {
    projectType: "Commercial",
    sheetTitle: "Floor plan",
    fileName: "floor-plan.pdf",
    contentClass: "floor_plan",
    pageText: 'FLOOR PLAN\nSTAIR A RISER 8"',
    authoritativeCode: [verifiedProvision],
  };

  it("withholds confirmation when legal scope is reference-only", () => {
    const hardened = hardenAnalysisResult(
      { issues: [candidate], summary: {}, jurisdictionNotes: "" },
      "ibc",
      {
        ...ctx,
        legalApplicability: {
          status: "verified_reference",
          reviewScope: "reference_only",
          registryRecordId: "fixture-city-2021",
        },
      },
    );
    assert.equal(hardened.issues[0].findingType, "missing_information");
    assert.equal(hardened.issues[0].codeSourceStatus, "unverified");
  });

  it("confirms only when legal scope, citation, threshold, and drawing evidence agree", () => {
    const hardened = hardenAnalysisResult(
      { issues: [candidate], summary: {}, jurisdictionNotes: "" },
      "ibc",
      {
        ...ctx,
        legalApplicability: {
          status: "verified",
          reviewScope: "permit_compliance",
          registryRecordId: "fixture-city-2021",
        },
      },
    );
    assert.equal(hardened.issues.length, 1);
    assert.equal(hardened.issues[0].findingType, "confirmed_violation");
    assert.equal(hardened.issues[0].codeSourceStatus, "authoritative");
    assert.equal(hardened.issues[0].provenance.codeProvisionId, "fixture-riser");
  });

  it("works across occupancy labels while preserving discipline evidence gates", () => {
    for (const projectType of ["commercial", "residential", "mixed"]) {
      const hardened = hardenAnalysisResult(
        { issues: [candidate], summary: {}, jurisdictionNotes: "" },
        "ibc",
        {
          ...ctx,
          projectType,
          legalApplicability: {
            status: "verified",
            reviewScope: "permit_compliance",
            registryRecordId: "fixture-city-2021",
          },
        },
      );
      assert.equal(hardened.issues[0].findingType, "confirmed_violation");
    }
  });
});

describe("scraper image registry bundle", () => {
  it("matches the canonical shared registry files included in the Docker context", () => {
    const fs = require("fs");
    const path = require("path");
    for (const filename of ["jurisdiction-editions.json", "authoritative-provisions.json"]) {
      const canonical = fs.readFileSync(path.join(__dirname, "../../shared/code-registry", filename), "utf8");
      const bundled = fs.readFileSync(
        path.join(__dirname, "../app/services/compliance/rag/bundled-registry", filename),
        "utf8",
      );
      assert.deepEqual(JSON.parse(bundled), JSON.parse(canonical));
    }
  });
});
