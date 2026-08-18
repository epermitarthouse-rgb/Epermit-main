"use strict";

/**
 * Stage 5 classifier accuracy harness (A5.15).
 * Target ≥85% on synthetic fixtures. Client-labeled production samples remain a live-verification dependency.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { classifyCommunicationText } = require("../app/services/uci/uci-communication-categories.js");
const { classifyWithLlmOrKeyword } = require("../app/services/uci/uci-llm-classifier.service.js");
const { classifyWithClaudeOrKeyword } = require("../app/services/uci/uci-claude-classifier.service.js");

/** @type {Array<{ id: string, subject: string, body: string, expected: string }>} */
const SYNTHETIC_FIXTURES = [
  {
    id: "ack-1",
    subject: "Application received",
    body: "We have acknowledged your interconnection application. Ticket WO-551122 assigned.",
    expected: "acknowledgment",
  },
  {
    id: "ack-2",
    subject: "Initiated",
    body: "Your application has been initiated and is in queue.",
    expected: "acknowledgment",
  },
  {
    id: "cos-1",
    subject: "Class of Service issued",
    body: "Please find attached the class of service letter.",
    expected: "class_of_service",
  },
  {
    id: "design-1",
    subject: "In Technical Review",
    body: "The project is in design review with our engineering team.",
    expected: "design_review_response",
  },
  {
    id: "ciac-1",
    subject: "Contract Sent",
    body: "CIAC invoice attached. Payment due within 30 days.",
    expected: "ciac_invoice",
  },
  {
    id: "eta-1",
    subject: "Equipment ETA update",
    body: "Long lead transformer delivery date moved to September.",
    expected: "equipment_eta_update",
  },
  {
    id: "insp-1",
    subject: "Inspection release request",
    body: "Please submit inspection release before meter set.",
    expected: "inspection_release_request",
  },
  {
    id: "meter-1",
    subject: "Meter set scheduling",
    body: "We can schedule meter installation next Tuesday.",
    expected: "meter_set_scheduling",
  },
  {
    id: "energ-1",
    subject: "Energization confirmation",
    body: "Service connected and energized as of today.",
    expected: "energization_confirmation",
  },
  {
    id: "rfi-1",
    subject: "Information Required",
    body: "Missing documents: one-line diagram and load schedule. RFI-12.",
    expected: "request_for_information",
  },
  {
    id: "esc-1",
    subject: "Action required — rejected",
    body: "Application rejected due to incomplete package. Urgent escalation.",
    expected: "escalation_or_problem",
  },
  {
    id: "unclass-1",
    subject: "Newsletter",
    body: "Quarterly utility customer update with no project references.",
    expected: "unclassified",
  },
  {
    id: "ack-3",
    subject: "Received your application",
    body: "Acknowledgment: utility project manager Jordan Lee assigned. Account 778812.",
    expected: "acknowledgment",
  },
  {
    id: "ciac-2",
    subject: "Contribution in aid of construction",
    body: "Please remit the construction cost invoice.",
    expected: "ciac_invoice",
  },
  {
    id: "design-2",
    subject: "Design review complete",
    body: "Technical review comments attached for your design review response.",
    expected: "design_review_response",
  },
  {
    id: "meter-2",
    subject: "Set meter appointment",
    body: "Confirm meter set window for the site.",
    expected: "meter_set_scheduling",
  },
  {
    id: "energ-2",
    subject: "Power on notice",
    body: "Power on complete — energization confirmed.",
    expected: "energization_confirmation",
  },
  {
    id: "rfi-2",
    subject: "Please provide additional information",
    body: "Information needed for panel schedule revision.",
    expected: "request_for_information",
  },
  {
    id: "eta-2",
    subject: "Long lead equipment delivery",
    body: "Equipment delivery ETA is week of Oct 12.",
    expected: "equipment_eta_update",
  },
  {
    id: "cos-2",
    subject: "COS issued for LC 451497",
    body: "Class of service document is available in the portal.",
    expected: "class_of_service",
  },
];

function scoreFixtures(classifyFn) {
  let correct = 0;
  /** @type {Array<{ id: string, expected: string, actual: string }>} */
  const misses = [];
  for (const fixture of SYNTHETIC_FIXTURES) {
    const result = classifyFn(fixture.subject, fixture.body);
    if (result.classification === fixture.expected) correct += 1;
    else misses.push({ id: fixture.id, expected: fixture.expected, actual: result.classification });
  }
  const accuracy = correct / SYNTHETIC_FIXTURES.length;
  return { correct, total: SYNTHETIC_FIXTURES.length, accuracy, misses };
}

describe("Stage 5 accuracy harness (synthetic ≥85%)", () => {
  it("keyword classifier meets ≥85% on synthetic fixtures", () => {
    const scored = scoreFixtures(classifyCommunicationText);
    assert.ok(
      scored.accuracy >= 0.85,
      `accuracy ${scored.accuracy} < 0.85; misses=${JSON.stringify(scored.misses)}`,
    );
  });

  it("LLM path without provider still meets ≥85% via keyword", async () => {
    /** @type {Array<{ classification: string }>} */
    const results = [];
    for (const fixture of SYNTHETIC_FIXTURES) {
      results.push(
        await classifyWithLlmOrKeyword({
          subject: fixture.subject,
          body: fixture.body,
          env: {},
        }),
      );
    }
    let correct = 0;
    results.forEach((r, i) => {
      if (r.classification === SYNTHETIC_FIXTURES[i].expected) correct += 1;
    });
    const accuracy = correct / SYNTHETIC_FIXTURES.length;
    assert.ok(accuracy >= 0.85, `accuracy ${accuracy} < 0.85`);
  });

  it("compat Claude entry without key still meets ≥85% via keyword", async () => {
    /** @type {Array<{ classification: string }>} */
    const results = [];
    for (const fixture of SYNTHETIC_FIXTURES) {
      results.push(
        await classifyWithClaudeOrKeyword({
          subject: fixture.subject,
          body: fixture.body,
          env: {},
        }),
      );
    }
    let correct = 0;
    results.forEach((r, i) => {
      if (r.classification === SYNTHETIC_FIXTURES[i].expected) correct += 1;
    });
    const accuracy = correct / SYNTHETIC_FIXTURES.length;
    assert.ok(accuracy >= 0.85, `accuracy ${accuracy} < 0.85`);
  });
});

module.exports = {
  SYNTHETIC_FIXTURES,
  scoreFixtures,
};
