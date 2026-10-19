"use strict";

const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const {
  REFUSAL_USER_MESSAGE,
  EMPTY_USER_MESSAGE,
  buildPrompts,
  buildVisionUserContent,
  formatStaffGuidanceBlock,
  extractChoiceMeta,
  isEmptyResponse,
  formatSingleResult,
  formatBothResult,
  analyzeDrawingWithOpenAI,
} = require("../app/services/compliance/analyze-drawing.service.js");

async function captureSheetReview(params) {
  let system = "";
  let user = "";
  let model = "";
  const create = mock.fn(async (body) => {
    system = body.messages[0].content;
    user = body.messages[1].content[0].text;
    model = body.model;
    return {
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({ issues: [], checklist: [], overallScore: 100 }),
          },
        },
      ],
    };
  });
  const outcome = await analyzeDrawingWithOpenAI({
    openai: { chat: { completions: { create } } },
    imageBase64: "abc",
    logInfo: () => {},
    logError: () => {},
    ...params,
  });
  return { system, user, model, calls: create.mock.calls.length, outcome };
}

describe("analyze-drawing.service", () => {
  it("buildPrompts uses distinct schemas per codeType", () => {
    const ibc = buildPrompts({ codeType: "ibc", codeYear: "2021" });
    const local = buildPrompts({ codeType: "local", jurisdiction: "dc", codeYear: "2021" });
    const both = buildPrompts({ codeType: "both", jurisdiction: "dc", codeYear: "2021" });

    assert.match(ibc.systemPrompt, /Analyze ONLY against base International Building Code/i);
    assert.match(local.systemPrompt, /JURISDICTION AMENDMENT REFERENCE SUMMARIES/i);
    assert.match(local.systemPrompt, /plan-sheet items that may be inconsistent/i);
    assert.doesNotMatch(local.systemPrompt, /Analyze ONLY against LOCAL jurisdiction amendments/i);
    assert.match(both.systemPrompt, /ibcIssues/i);
    assert.match(both.systemPrompt, /localIssues/i);
    assert.equal(ibc.codeType, "ibc");
    assert.equal(local.codeType, "local");
    assert.equal(both.codeType, "both");
  });

  it("extractChoiceMeta reads refusal and finish reason", () => {
    const meta = extractChoiceMeta({
      finish_reason: "stop",
      message: {
        content: "",
        refusal: "cannot assist",
      },
    });
    assert.equal(meta.content, "");
    assert.equal(meta.refusal, "cannot assist");
    assert.equal(meta.finishReason, "stop");
    assert.equal(isEmptyResponse(meta), true);
  });

  it("formatSingleResult maps issues and summary", () => {
    const result = formatSingleResult(
      {
        issues: [
          {
            id: "a",
            severity: "critical",
            category: "Egress",
            title: "t",
            description: "d",
            codeReference: "IBC 1005",
            codeYear: "2021",
            location: "hall",
            suggestedFix: "fix",
          },
        ],
        overallScore: 90,
        jurisdictionNotes: "note",
      },
      "2021",
    );
    assert.equal(result.summary.totalIssues, 1);
    assert.equal(result.summary.reviewState, "reviewed_partial");
    assert.equal(result.summary.overallScore, null);
    assert.equal(result.jurisdictionNotes, "note");
  });

  it("formatBothResult maps ibc and local sections", () => {
    const result = formatBothResult(
      {
        ibcIssues: [{ id: "i1", severity: "warning", category: "Egress", title: "t", description: "d", codeReference: "IBC", codeYear: "2021", location: "l", suggestedFix: "f" }],
        localIssues: [],
        ibcOverallScore: 88,
        localOverallScore: 95,
        ibcJurisdictionNotes: "ibc note",
        localJurisdictionNotes: "local note",
      },
      "2021",
    );
    assert.equal(result.ibc.summary.totalIssues, 1);
    assert.equal(result.local.summary.totalIssues, 0);
    assert.equal(result.local.summary.reviewState, "reviewed_partial");
    assert.equal(result.local.summary.overallScore, null);
    assert.notEqual(result.local.summary.overallScore, 95);
    assert.equal(result.ibc.jurisdictionNotes, "ibc note");
    assert.equal(result.local.jurisdictionNotes, "local note");
  });

  it("formatSingleResult does not treat an empty issue list as a pass", () => {
    const result = formatSingleResult(
      {
        issues: [],
        overallScore: 85,
        jurisdictionNotes: "clean",
      },
      "2021",
    );
    assert.equal(result.summary.totalIssues, 0);
    assert.equal(result.summary.reviewState, "reviewed_partial");
    assert.equal(result.summary.overallScore, null);
  });

  it("formatSingleResult does not pass a checklist that has no evidence quote", () => {
    const result = formatSingleResult(
      {
        issues: [],
        checklist: ["Egress width checked, no failing condition"],
        overallScore: 85,
        jurisdictionNotes: "clean",
      },
      "2021",
    );
    assert.equal(result.summary.reviewState, "reviewed_partial");
    assert.equal(result.summary.overallScore, null);
  });

  it("formatSingleResult passes when every checklist item quotes a dimension or sheet reference", () => {
    const result = formatSingleResult(
      {
        issues: [],
        checklist: ['Corridor width: 44" labeled', "Exit sign: shown on sheet A-1.04"],
        overallScore: 85,
        jurisdictionNotes: "clean",
      },
      "2021",
    );
    assert.equal(result.summary.reviewState, "reviewed_clear");
    assert.equal(result.summary.overallScore, 100);
  });

  it("formatSingleResult does not keep a score of 100 when issues exist", () => {
    const result = formatSingleResult(
      {
        issues: [
          {
            id: "a",
            severity: "warning",
            category: "Egress",
            title: "t",
            description: "d",
            codeReference: "IBC 1005",
          },
        ],
        overallScore: 100,
        jurisdictionNotes: "",
      },
      "2021",
    );
    assert.equal(result.summary.totalIssues, 1);
    assert.notEqual(result.summary.overallScore, 100);
  });

  it("buildPrompts does not tell the model to score an empty review as 100", () => {
    const ibc = buildPrompts({ codeType: "ibc", codeYear: "2021", pageText: "1 HR WALL" });
    assert.match(ibc.systemPrompt, /"overallScore": 100/);
    assert.doesNotMatch(ibc.systemPrompt, /"overallScore": 85/);
    assert.match(ibc.systemPrompt, /do not set overallScore to 100/i);
    assert.doesNotMatch(ibc.systemPrompt, /overallScore MUST be 100/i);
    assert.match(ibc.systemPrompt, /EXTRACTED PDF TEXT LAYER/);
    assert.match(ibc.systemPrompt, /1 HR WALL/);
  });

  it("buildPrompts uses DC Building Code summaries for a Washington DC jurisdiction", () => {
    const local = buildPrompts({
      codeType: "local",
      jurisdiction: "Washington, D.C.",
      codeYear: "2021",
    });
    assert.match(local.systemPrompt, /12A DCMR/);
    assert.match(local.systemPrompt, /WASHINGTON D\.C\. BUILDING CODE AMENDMENTS/i);
  });

  it("buildPrompts injects staff guidance as non-evidence focus", () => {
    const withGuidance = buildPrompts({
      codeType: "ibc",
      codeYear: "2021",
      analysisInstructions: "Prioritize stair egress.",
    });
    assert.match(withGuidance.systemPrompt, /USER EMPHASIS \(NOT EVIDENCE AND NOT A SCOPE LIMIT\)/i);
    assert.match(withGuidance.systemPrompt, /Prioritize stair egress/);
    assert.match(withGuidance.systemPrompt, /NOT submitted evidence/i);
    const without = buildPrompts({ codeType: "ibc", codeYear: "2021" });
    assert.doesNotMatch(without.systemPrompt, /USER EMPHASIS/i);
  });

  it("formatStaffGuidanceBlock returns empty for blank input", () => {
    assert.equal(formatStaffGuidanceBlock(""), "");
    assert.equal(formatStaffGuidanceBlock("   "), "");
  });

  it("buildPrompts uses a bounded local pass when jurisdiction is General IBC", () => {
    const localGeneral = buildPrompts({
      codeType: "local",
      jurisdiction: "general",
      codeYear: "2021",
    });
    assert.match(localGeneral.systemPrompt, /objective plan-sheet compliance reviews/i);
    assert.match(localGeneral.systemPrompt, /no local amendment text is loaded/i);
    assert.doesNotMatch(localGeneral.systemPrompt, /WASHINGTON D\.C\. BUILDING CODE AMENDMENTS/i);
    assert.doesNotMatch(localGeneral.userPrompt, /violations related to egress/i);
  });

  it("buildPrompts treats 3-hour stair staff guidance as non-evidence focus only", () => {
    const withGuidance = buildPrompts({
      codeType: "ibc",
      codeYear: "2021",
      analysisInstructions:
        "Verify the 3-hour fire rating on the stair enclosure is shown on every egress sheet.",
    });
    assert.match(withGuidance.systemPrompt, /USER EMPHASIS \(NOT EVIDENCE AND NOT A SCOPE LIMIT\)/i);
    assert.match(withGuidance.systemPrompt, /3-hour fire rating/i);
    assert.match(withGuidance.systemPrompt, /must NOT be treated as proof/i);
    assert.doesNotMatch(withGuidance.userPrompt, /3-hour/i);
  });

  it("returns success for normal content response", async () => {
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async () => ({
            model: "gpt-4o",
            usage: { prompt_tokens: 10, completion_tokens: 5 },
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    issues: [],
                    jurisdictionNotes: "",
                    overallScore: 100,
                  }),
                },
              },
            ],
          })),
        },
      },
    };

    const outcome = await analyzeDrawingWithOpenAI({
      openai,
      imageBase64: "abc",
      imageType: "image/png",
      codeType: "ibc",
      logInfo: () => {},
      logError: () => {},
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, 200);
    assert.equal(outcome.result.summary.totalIssues, 0);
    assert.equal(outcome.result.summary.reviewState, "reviewed_partial");
    assert.equal(outcome.result.summary.overallScore, null);
    assert.equal(openai.chat.completions.create.mock.calls.length, 1);
    assert.equal(openai.chat.completions.create.mock.calls[0].arguments[0].model, "gpt-4o");
  });

  it("does not pass a generic checklist returned by the model", async () => {
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async () => ({
            usage: { prompt_tokens: 10, completion_tokens: 5 },
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    issues: [],
                    checklist: [
                      {
                        item: "Egress, fire separation, stairs, structural",
                        result: "no failing condition",
                      },
                    ],
                    jurisdictionNotes: "",
                    overallScore: 100,
                  }),
                },
              },
            ],
          })),
        },
      },
    };
    const outcome = await analyzeDrawingWithOpenAI({
      openai,
      imageBase64: "abc",
      codeType: "ibc",
      logInfo: () => {},
      logError: () => {},
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.summary.reviewState, "reviewed_partial");
    assert.equal(outcome.result.summary.overallScore, null);
  });

  it("drops a missing clearance when image understanding quotes the graphic dimension", async () => {
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async () => ({
            usage: { prompt_tokens: 10, completion_tokens: 5 },
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    issues: [
                      {
                        severity: "warning",
                        category: "Accessibility",
                        title: "Clearance not shown",
                        description: "The clearance symbol is not shown.",
                        codeReference: "ICC A117.1",
                      },
                    ],
                    observedEvidence: ["54x60 clearance", "48x48"],
                    checklist: [],
                    overallScore: 100,
                  }),
                },
              },
            ],
          })),
        },
      },
    };
    const outcome = await analyzeDrawingWithOpenAI({
      openai,
      imageBase64: "abc",
      pageText: "ENLARGED PLAN",
      codeType: "ibc",
      logInfo: () => {},
      logError: () => {},
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.issues.length, 0);
    assert.notEqual(outcome.result.summary.overallScore, 100);
  });

  it("tells the model which other sheets own facts and keeps drawing review on gpt-4o", async () => {
    let systemPrompt = "";
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async (body) => {
            systemPrompt = body.messages[0].content;
            return {
              usage: { prompt_tokens: 1, completion_tokens: 1 },
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({ issues: [], observedEvidence: [], overallScore: 100 }),
                  },
                },
              ],
            };
          }),
        },
      },
    };
    await analyzeDrawingWithOpenAI({
      openai,
      imageBase64: "abc",
      contentClass: "floor_plan",
      sheetIndex: [
        { fileName: "A-4.00.pdf", contentClass: "enlarged_plan", title: "Enlarged Restroom", excerpt: "ENLARGED TOILET PLAN" },
      ],
      codeType: "ibc",
      logInfo: () => {},
      logError: () => {},
    });
    assert.match(systemPrompt, /OTHER INCLUDED SHEETS/);
    assert.match(systemPrompt, /A-4\.00\.pdf/);
    assert.match(systemPrompt, /evidence quote/i);
    assert.equal(openai.chat.completions.create.mock.calls[0].arguments[0].model, "gpt-4o");
  });

  it("sends a door schedule that also contains details to gpt-4o", async () => {
    const captured = await captureSheetReview({
      contentClass: "schedule",
      pageText: "A-6.00\nDOOR AND HARDWARE SCHEDULE\nDOOR DETAILS\nWINDOW ELEVATIONS",
      codeType: "ibc",
    });
    assert.equal(captured.calls, 1);
    assert.equal(captured.model, "gpt-4o");
    assert.match(captured.system, /this page is a door schedule that also contains details/i);
    assert.match(captured.system, /whole page/i);
    assert.doesNotMatch(captured.system, /not sent through/i);
    assert.doesNotMatch(captured.user, /do not report architectural/i);
    assert.equal(captured.outcome.result.summary.reviewState, "reviewed_partial");
    assert.equal(captured.outcome.result.summary.overallScore, null);
  });

  it("sends a finish schedule that also contains sections to gpt-4o", async () => {
    const captured = await captureSheetReview({
      contentClass: "schedule",
      pageText: "A-6.01\nFINISH SCHEDULE\nFLOOR AND WALL SECTIONS\nPEDIMAT DETAIL",
      codeType: "ibc",
    });
    assert.equal(captured.calls, 1);
    assert.equal(captured.model, "gpt-4o");
    assert.match(captured.system, /this page is a finish schedule that also contains sections/i);
    assert.match(captured.system, /whole page/i);
    assert.doesNotMatch(captured.system, /not sent through/i);
  });

  it("sends a COMcheck form through the local code-type review", async () => {
    const captured = await captureSheetReview({
      contentClass: "form",
      pageText: "EN-1.00\nCOMcheck\nEnergy Compliance Certificate",
      codeType: "local",
      jurisdiction: "dc",
    });
    assert.equal(captured.calls, 1);
    assert.equal(captured.model, "gpt-4o");
    assert.match(captured.system, /COMcheck or energy compliance certificate/i);
    assert.match(captured.system, /whole page/i);
    assert.doesNotMatch(captured.system, /not sent through/i);
    assert.equal(captured.outcome.result.summary.reviewState, "reviewed_partial");
  });

  it("sends a floor plan through architectural review", async () => {
    const captured = await captureSheetReview({
      contentClass: "floor_plan",
      pageText: "A-2.01\nFIRST FLOOR PLAN",
      codeType: "ibc",
    });
    assert.equal(captured.calls, 1);
    assert.equal(captured.model, "gpt-4o");
    assert.match(captured.system, /this page is a floor plan/i);
    assert.match(captured.user, /whole page/i);
    assert.doesNotMatch(captured.system, /not sent through/i);
    assert.doesNotMatch(captured.user, /do not report architectural/i);
  });

  it("returns 422 when refusal is present after retry", async () => {
    const refusalChoice = {
      finish_reason: "stop",
      message: { content: "", refusal: "policy" },
    };
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async () => ({
            usage: { prompt_tokens: 10, completion_tokens: 0 },
            choices: [refusalChoice],
          })),
        },
      },
    };

    const outcome = await analyzeDrawingWithOpenAI({
      openai,
      imageBase64: "abc",
      codeType: "ibc",
      logInfo: () => {},
      logError: () => {},
      downscaleFn: async () => ({ imageBase64: "def", imageType: "image/png" }),
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 422);
    assert.equal(outcome.error, REFUSAL_USER_MESSAGE);
    assert.equal(openai.chat.completions.create.mock.calls.length, 2);
  });

  it("returns 502 when empty response has no refusal after retry", async () => {
    const emptyChoice = {
      finish_reason: "stop",
      message: { content: "" },
    };
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async () => ({
            usage: { prompt_tokens: 10, completion_tokens: 0 },
            choices: [emptyChoice],
          })),
        },
      },
    };

    const outcome = await analyzeDrawingWithOpenAI({
      openai,
      imageBase64: "abc",
      codeType: "ibc",
      logInfo: () => {},
      logError: () => {},
      downscaleFn: async () => ({ imageBase64: "def", imageType: "image/png" }),
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 502);
    assert.equal(outcome.error, EMPTY_USER_MESSAGE);
    assert.equal(openai.chat.completions.create.mock.calls.length, 2);
  });

  it("retry succeeds after initial refusal", async () => {
    let call = 0;
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async () => {
            call += 1;
            if (call === 1) {
              return {
                usage: { prompt_tokens: 10, completion_tokens: 0 },
                choices: [
                  {
                    finish_reason: "stop",
                    message: { content: "", refusal: "no" },
                  },
                ],
              };
            }
            return {
              usage: { prompt_tokens: 8, completion_tokens: 4 },
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      issues: [],
                      jurisdictionNotes: "",
                      overallScore: 100,
                    }),
                  },
                },
              ],
            };
          }),
        },
      },
    };

    const outcome = await analyzeDrawingWithOpenAI({
      openai,
      imageBase64: "abc",
      codeType: "ibc",
      logInfo: () => {},
      logError: () => {},
      downscaleFn: async () => ({ imageBase64: "def", imageType: "image/png" }),
    });

    assert.equal(outcome.ok, true);
    assert.equal(openai.chat.completions.create.mock.calls.length, 2);
    const retryCall = openai.chat.completions.create.mock.calls[1].arguments[0];
    assert.equal(
      retryCall.messages[1].content[1].image_url.detail,
      "low",
    );
  });

  it("sends the crop image and its sheet coordinates, including on retry", async () => {
    const crop = {
      imageBase64: "crop-bytes",
      imageType: "image/png",
      label: "rating: sample",
      fileName: "A-1.00-00.pdf",
      sheetId: "sheet-1",
      pageNumber: 1,
      extractionMethod: "original-pdf-clip",
      region: { x: 1544, y: 393, width: 180, height: 24, unit: "pdf-point", origin: "bottom-left" },
    };
    let call = 0;
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async () => {
            call += 1;
            if (call === 1) {
              return {
                usage: { prompt_tokens: 10, completion_tokens: 0 },
                choices: [{ finish_reason: "stop", message: { content: "" } }],
              };
            }
            return {
              usage: { prompt_tokens: 8, completion_tokens: 4 },
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify({ issues: [], jurisdictionNotes: "", overallScore: null }) },
                },
              ],
            };
          }),
        },
      },
    };

    const outcome = await analyzeDrawingWithOpenAI({
      openai,
      imageBase64: "full-sheet",
      imageType: "image/png",
      codeType: "ibc",
      jurisdiction: "general",
      regionImages: [crop],
      logInfo: () => {},
      logError: () => {},
      downscaleFn: async () => ({ imageBase64: "full-sheet-small", imageType: "image/png" }),
    });

    assert.equal(outcome.ok, true);
    assert.equal(openai.chat.completions.create.mock.calls.length, 2);
    for (const entry of openai.chat.completions.create.mock.calls) {
      const content = entry.arguments[0].messages[1].content;
      const images = content.filter((part) => part.type === "image_url");
      assert.equal(images.length, 2);
      assert.match(images[1].image_url.url, /crop-bytes/);
      assert.equal(images[1].image_url.detail, "low");
      const note = content.find((part) => part.type === "text" && String(part.text).includes("High-resolution crop"));
      assert.match(note.text, /A-1\.00-00\.pdf/);
      assert.match(note.text, /page 1/);
      assert.match(note.text, /x=1544/);
      assert.match(note.text, /y=393/);
      assert.match(note.text, /pdf-point/);
    }
    const built = buildVisionUserContent({
      imageBase64: "full-sheet",
      imageType: "image/png",
      userPrompt: "review",
      detail: "high",
      regionImages: [crop, { imageBase64: "second" }, { imageBase64: "third" }],
    });
    assert.equal(built.filter((part) => part.type === "image_url").length, 3);
  });

  it("both mode returns split ibc/local payload", async () => {
    const openai = {
      chat: {
        completions: {
          create: mock.fn(async () => ({
            usage: { prompt_tokens: 10, completion_tokens: 5 },
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    ibcIssues: [],
                    localIssues: [],
                    ibcJurisdictionNotes: "ibc",
                    localJurisdictionNotes: "local",
                    ibcOverallScore: 100,
                    localOverallScore: 100,
                  }),
                },
              },
            ],
          })),
        },
      },
    };

    const outcome = await analyzeDrawingWithOpenAI({
      openai,
      imageBase64: "abc",
      codeType: "both",
      jurisdiction: "dc",
      logInfo: () => {},
      logError: () => {},
    });

    assert.equal(outcome.ok, true);
    assert.ok(outcome.result.ibc);
    assert.ok(outcome.result.local);
    assert.equal(openai.chat.completions.create.mock.calls.length, 1);
  });
});
