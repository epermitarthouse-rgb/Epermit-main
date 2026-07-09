"use strict";

const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");
const {
  REFUSAL_USER_MESSAGE,
  EMPTY_USER_MESSAGE,
  buildPrompts,
  extractChoiceMeta,
  isEmptyResponse,
  formatSingleResult,
  formatBothResult,
  analyzeDrawingWithOpenAI,
} = require("../app/services/compliance/analyze-drawing.service.js");

describe("analyze-drawing.service", () => {
  it("buildPrompts uses distinct schemas per codeType", () => {
    const ibc = buildPrompts({ codeType: "ibc", codeYear: "2021" });
    const local = buildPrompts({ codeType: "local", jurisdiction: "dc", codeYear: "2021" });
    const both = buildPrompts({ codeType: "both", jurisdiction: "dc", codeYear: "2021" });

    assert.match(ibc.systemPrompt, /Analyze ONLY against base International Building Code/i);
    assert.match(local.systemPrompt, /Analyze ONLY against LOCAL jurisdiction amendments/i);
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
    assert.equal(result.summary.critical, 1);
    assert.equal(result.summary.overallScore, 90);
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
    assert.equal(result.ibc.jurisdictionNotes, "ibc note");
    assert.equal(result.local.jurisdictionNotes, "local note");
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
    assert.equal(openai.chat.completions.create.mock.calls.length, 1);
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
