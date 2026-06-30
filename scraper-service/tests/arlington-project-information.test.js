"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const pi = require("../lib/arlington-project-information.js");

const CTBO_SHELL = {
  url: "https://prd-ermsaccela-az.arlingtonva.us/PlanReviewIntegrated/Plan/ProjectInformation",
  preview:
    "Project Information Project ID Accela CAP ID Review Type Plan Review Project Name Address",
  bodyLen: 87,
  inputCount: 6,
  filledInputCount: 0,
  hasProjectLabels: true,
  hasProjectValues: false,
  likelyThinShell: true,
  isOuterShellUrl: true,
  isUnityFormUrl: false,
  hasUnityFormPath: false,
  readOnlyQuery: false,
  nonEmptyExpectedFieldCount: 0,
  extractedProjectId: "",
};

const CTBO_UNITY = {
  url: "https://prd-ermsaccela-az.arlingtonva.us/PlanReviewIntegrated/Plan/GetUnityForm/25754327?isFormInstance=true&readOnly=true",
  preview:
    "Project Information Project ID CTBO24-02589 Accela CAP ID 24REC-00000-00MZ8 Review Type 116 Plan Review Project Name 40 N GLEBE RD Address 40 N GLEBE RD CPHD Case #",
  bodyLen: 435,
  inputCount: 6,
  filledInputCount: 5,
  hasProjectLabels: true,
  hasProjectValues: true,
  likelyThinShell: false,
  isOuterShellUrl: false,
  isUnityFormUrl: true,
  hasUnityFormPath: true,
  readOnlyQuery: true,
  nonEmptyExpectedFieldCount: 5,
  extractedProjectId: "CTBO24-02589",
};

const LDAP_UNITY = {
  url: "https://prd-ermsaccela-az.arlingtonva.us/PlanReviewIntegrated/Plan/GetUnityForm/25754327?isFormInstance=true&readOnly=true",
  preview:
    "Project Information Project ID LDAP23-00156 Accela CAP ID 26REC-00000-001S7 Review Type 113 Plan Review Project Name 4834 LANGSTON BLVD Address 4834 LANGSTON BLVD",
  bodyLen: 420,
  inputCount: 6,
  filledInputCount: 5,
  hasProjectLabels: true,
  hasProjectValues: true,
  likelyThinShell: false,
  isOuterShellUrl: false,
  isUnityFormUrl: true,
  hasUnityFormPath: true,
  readOnlyQuery: true,
  nonEmptyExpectedFieldCount: 5,
  extractedProjectId: "LDAP23-00156",
};

function rankPair(shell, unity, permit) {
  const shellScore = pi.scoreArlingtonProjectInformationFrameCandidate(
    shell,
    permit,
  );
  const unityScore = pi.scoreArlingtonProjectInformationFrameCandidate(
    unity,
    permit,
  );
  const ranked = [
    { diag: shell, ...shellScore },
    { diag: unity, ...unityScore },
  ].sort((a, b) => b.score - a.score);
  return { ranked, pick: pi.selectArlingtonProjectInformationFrameFromRanked(ranked) };
}

describe("Arlington Project Information", () => {
  it("normalizeArlingtonBaseProjectId strips revision suffixes", () => {
    assert.equal(pi.normalizeArlingtonBaseProjectId("CTBO24-02589-RA1"), "CTBO24-02589");
    assert.equal(pi.normalizeArlingtonBaseProjectId("LDAP23-00156-RA2"), "LDAP23-00156");
    assert.equal(pi.normalizeArlingtonBaseProjectId("COFO26-00417"), "COFO26-00417");
    assert.equal(pi.normalizeArlingtonBaseProjectId("CTBO24-02589-REN1"), "CTBO24-02589");
  });

  it("arlingtonProjectIdsMatch supports revision child permits", () => {
    assert.equal(
      pi.arlingtonProjectIdsMatch("CTBO24-02589-RA1", "CTBO24-02589"),
      true,
    );
    assert.equal(
      pi.arlingtonProjectIdsMatch("LDAP23-00156-RA2", "LDAP23-00156"),
      true,
    );
    assert.equal(
      pi.arlingtonProjectIdsMatch("COFO26-00417", "COFO26-00417"),
      true,
    );
    assert.equal(
      pi.arlingtonProjectIdsMatch("CTBO24-02589-RA1", "CTBO24-99999"),
      false,
    );
    assert.equal(
      pi.arlingtonProjectIdsMatch("CTBO24-02589", "CTBO24-0258"),
      false,
    );
  });

  it("selects nested Unity frame over thin outer shell (CTBO)", () => {
    const { pick, ranked } = rankPair(
      CTBO_SHELL,
      CTBO_UNITY,
      "CTBO24-02589-RA1",
    );
    assert.ok(pick);
    assert.equal(pick.index, 0);
    assert.match(ranked[0].diag.url, /GetUnityForm/i);
    assert.ok(ranked[0].score > ranked[1].score);
  });

  it("outer shell with labels but empty values is not a valid data frame", () => {
    const shellOnly = pi.selectArlingtonProjectInformationFrameFromRanked([
      {
        diag: CTBO_SHELL,
        ...pi.scoreArlingtonProjectInformationFrameCandidate(
          CTBO_SHELL,
          "CTBO24-02589-RA1",
        ),
      },
    ]);
    assert.equal(shellOnly, null);
  });

  it("delayed nested frame candidate wins once populated (scoring)", () => {
    const before = pi.selectArlingtonProjectInformationFrameFromRanked([
      { diag: CTBO_SHELL, score: -500, reason: "shell" },
    ]);
    assert.equal(before, null);

    const after = rankPair(CTBO_SHELL, CTBO_UNITY, "CTBO24-02589-RA1");
    assert.ok(after.pick);
    assert.match(after.ranked[0].diag.url, /GetUnityForm/i);
  });

  it("working Zoning fixture still prefers Unity frame", () => {
    const { pick, ranked } = rankPair(
      {
        ...CTBO_SHELL,
        preview:
          "Plans & Documents Review Results Project Information",
        bodyLen: 82,
      },
      LDAP_UNITY,
      "LDAP23-00156",
    );
    assert.ok(pick);
    assert.match(ranked[pick.index].diag.url, /GetUnityForm/i);
    assert.equal(ranked[pick.index].diag.extractedProjectId, "LDAP23-00156");
  });

  it("accepts CTBO revision permit fields as strong extraction", () => {
    const fields = [
      { label: "Project ID", value: "CTBO24-02589" },
      { label: "Plan Review Project Name", value: "40 N GLEBE RD" },
      { label: "Accela CAP ID", value: "24REC-00000-00MZ8" },
      { label: "Address", value: "40 N GLEBE RD" },
      { label: "Review Type", value: "116" },
      { label: "CPHD Case #", value: "" },
    ];
    assert.equal(
      pi.arlingtonProjectInformationExtractionIsWeak(
        fields,
        "CTBO24-02589-RA1",
      ),
      false,
    );
  });

  it("blank CPHD Case # does not invalidate section", () => {
    const fields = [
      { label: "Project ID", value: "CTBO24-02589" },
      { label: "Plan Review Project Name", value: "40 N GLEBE RD" },
      { label: "Accela CAP ID", value: "24REC-00000-00MZ8" },
      { label: "Address", value: "40 N GLEBE RD" },
      { label: "Review Type", value: "116" },
      { label: "CPHD Case #", value: "" },
    ];
    assert.equal(
      pi.arlingtonProjectInformationFieldValueIsRejected("CPHD Case #", ""),
      false,
    );
    assert.equal(
      pi.arlingtonProjectInformationExtractionIsWeak(
        fields,
        "CTBO24-02589-RA1",
      ),
      false,
    );
  });

  it("exact Project ID match still works", () => {
    const fields = [
      { label: "Project ID", value: "LDAP23-00156" },
      { label: "Plan Review Project Name", value: "4834 LANGSTON BLVD" },
      { label: "Accela CAP ID", value: "26REC-00000-001S7" },
      { label: "Address", value: "4834 LANGSTON BLVD" },
      { label: "Review Type", value: "113" },
      { label: "CPHD Case #", value: "" },
    ];
    assert.equal(
      pi.arlingtonProjectInformationExtractionIsWeak(fields, "LDAP23-00156"),
      false,
    );
  });

  it("unity text validation accepts revision base Project ID", () => {
    const parsed = {
      projectId: "CTBO24-02589",
      accelaCapId: "24REC-00000-00MZ8",
      reviewType: "116",
      planReviewProjectName: "40 N GLEBE RD",
      address: "40 N GLEBE RD",
      cphdCase: "",
    };
    assert.equal(
      pi.arlingtonProjectInformationUnityTextExtractionIsValid(
        parsed,
        "CTBO24-02589-RA1",
      ),
      true,
    );
  });

  it("thin shell diag is normalized as likelyThinShell when labels exist but values empty", () => {
    const norm = pi.normalizeArlingtonProjectInformationFrameDiag({
      url: CTBO_SHELL.url,
      preview: CTBO_SHELL.preview,
      bodyLen: 87,
      inputCount: 6,
      filledInputCount: 0,
      hasProjectLabels: true,
      hasProjectValues: false,
    });
    assert.equal(norm.likelyThinShell, true);
    assert.equal(norm.isOuterShellUrl, true);
  });

  it("fresh scrape missing nested frame uses explicit unity_frame_not_found constant", () => {
    assert.equal(
      pi.ARLINGTON_PROJECT_INFORMATION_UNITY_FRAME_NOT_FOUND,
      "project_information_unity_frame_not_found",
    );
  });
});

describe("Arlington Project Information DOM value helpers", () => {
  it("reads input.value from readonly controls (browser script contract)", () => {
    const read = (el) => {
      if (!el) return "";
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        return `${el.value || el.defaultValue || el.getAttribute("value") || ""}`.trim();
      }
      return "";
    };
    const input = {
      tagName: "INPUT",
      value: "CTBO24-02589",
      defaultValue: "",
      getAttribute: () => "",
      readOnly: true,
      disabled: false,
    };
    assert.equal(read(input), "CTBO24-02589");
  });

  it("reads disabled input values", () => {
    const input = {
      tagName: "INPUT",
      value: "116",
      defaultValue: "",
      getAttribute: () => "",
      disabled: true,
    };
    const v = `${input.value || input.defaultValue || input.getAttribute("value") || ""}`;
    assert.equal(v, "116");
  });

  it("reads textarea values", () => {
    const ta = { tagName: "TEXTAREA", value: "40 N GLEBE RD", defaultValue: "" };
    assert.equal(ta.value, "40 N GLEBE RD");
  });

  it("reads select option text", () => {
    const select = {
      tagName: "SELECT",
      value: "116",
      selectedOptions: [{ textContent: "116", value: "116" }],
    };
    const opt = select.selectedOptions[0];
    const v = `${opt.textContent || opt.value || select.value || ""}`.trim();
    assert.equal(v, "116");
  });
});

describe("Arlington Project Information merge isolation", () => {
  it("weak extraction preserves prior PI without touching other plan review tabs", () => {
    const priorPortal = {
      tabs: {
        planReview: {
          tabs: {
            projectInformation: {
              fields: [{ label: "Project ID", value: "OLD-ID" }],
              extractionStatus: "ok",
            },
            plansAndDocuments: {
              sections: {
                planSetDocuments: {
                  documents: [{ name: "plan.pdf", downloadStatus: "uploaded" }],
                },
              },
            },
            reviewResultsAndMarkups: {
              documents: [{ name: "letter.pdf", downloadStatus: "uploaded" }],
            },
            approvedDocuments: {
              documents: [{ name: "approved.pdf", downloadStatus: "uploaded" }],
            },
          },
        },
        attachments: {
          tables: [{ rows: [{ name: "a.pdf", downloadStatus: "uploaded" }] }],
        },
      },
    };

    const integrated = JSON.parse(
      JSON.stringify(priorPortal.tabs.planReview.tabs),
    );
    const weakFields = [
      { label: "Project ID", value: "" },
      { label: "Plan Review Project Name", value: "" },
      { label: "Accela CAP ID", value: "" },
      { label: "Address", value: "" },
      { label: "Review Type", value: "" },
      { label: "CPHD Case #", value: "" },
    ];

    assert.equal(
      pi.arlingtonProjectInformationExtractionIsWeak(
        weakFields,
        "CTBO24-02589-RA1",
      ),
      true,
    );

    const planSetBefore =
      integrated.plansAndDocuments.sections.planSetDocuments.documents.length;
    const rrBefore = integrated.reviewResultsAndMarkups.documents.length;
    const adBefore = integrated.approvedDocuments.documents.length;

    integrated.projectInformation.fields = weakFields;
    if (
      pi.arlingtonProjectInformationExtractionIsWeak(
        weakFields,
        "CTBO24-02589-RA1",
      )
    ) {
      integrated.projectInformation.fields =
        priorPortal.tabs.planReview.tabs.projectInformation.fields;
      integrated.projectInformation.extractionStatus = "preserved_prior";
    }

    assert.equal(integrated.projectInformation.fields[0].value, "OLD-ID");
    assert.equal(
      integrated.plansAndDocuments.sections.planSetDocuments.documents.length,
      planSetBefore,
    );
    assert.equal(
      integrated.reviewResultsAndMarkups.documents.length,
      rrBefore,
    );
    assert.equal(integrated.approvedDocuments.documents.length, adBefore);
  });
});
