import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLIANCE_RESULTS_FILTER_ALL,
  COMPLIANCE_SCORE_FILTER_ALL,
  COMPLIANCE_SCORE_FILTER_NOT_100,
  filterComplianceGroupsByScore,
  filterComplianceResultGroups,
  isNotFullyCompliantGroup,
} from "./complianceResultFilter.ts";

const groups = [
  { id: "batch-1", documentId: "doc-a", fileName: "plan-a.pdf" },
  { id: "batch-2", documentId: "doc-b", fileName: "plan-b.pdf" },
  { id: "doc-c", documentId: "doc-c", fileName: "loaded.pdf" },
];

describe("filterComplianceResultGroups", () => {
  it("returns all groups for the All sentinel", () => {
    assert.deepEqual(
      filterComplianceResultGroups(groups, COMPLIANCE_RESULTS_FILTER_ALL),
      groups,
    );
  });

  it("returns all groups for empty filter", () => {
    assert.deepEqual(filterComplianceResultGroups(groups, ""), groups);
  });

  it("filters by persisted documentId", () => {
    assert.deepEqual(filterComplianceResultGroups(groups, "doc-b"), [groups[1]]);
  });

  it("filters by group id (loaded-from-DB or batch id)", () => {
    assert.deepEqual(filterComplianceResultGroups(groups, "batch-1"), [groups[0]]);
    assert.deepEqual(filterComplianceResultGroups(groups, "doc-c"), [groups[2]]);
  });

  it("filters by file name when documentId is missing on the group", () => {
    const sessionOnly = [
      { id: "batch-x", documentId: null, fileName: "session.pdf" },
      { id: "batch-y", documentId: null, fileName: "other.pdf" },
    ];
    assert.deepEqual(
      filterComplianceResultGroups(sessionOnly, "doc-from-db", "session.pdf"),
      [sessionOnly[0]],
    );
  });

  it("returns empty when nothing matches", () => {
    assert.deepEqual(filterComplianceResultGroups(groups, "missing"), []);
  });
});

const scoredGroups = [
  {
    id: "perfect",
    fileName: "perfect.pdf",
    documentId: "doc-perfect",
    ibcResult: { summary: { overallScore: 100, totalIssues: 0 }, issues: [] },
    localResult: null,
  },
  {
    id: "issues",
    fileName: "issues.pdf",
    documentId: "doc-issues",
    ibcResult: {
      summary: { overallScore: 85, totalIssues: 2 },
      issues: [{ id: "1" }, { id: "2" }],
    },
    localResult: null,
  },
  {
    id: "failed",
    fileName: "failed.pdf",
    documentId: "doc-failed",
    failed: true,
    ibcResult: null,
    localResult: null,
  },
  {
    id: "zero-score-issues",
    fileName: "zero.pdf",
    documentId: "doc-zero",
    ibcResult: { summary: { overallScore: 100, totalIssues: 1 }, issues: [{ id: "x" }] },
    localResult: null,
  },
];

describe("isNotFullyCompliantGroup / filterComplianceGroupsByScore", () => {
  it("treats perfect 100 / zero-issue groups as fully compliant", () => {
    assert.equal(isNotFullyCompliantGroup(scoredGroups[0]), false);
  });

  it("treats score < 100, failed, and issue rows as not fully compliant", () => {
    assert.equal(isNotFullyCompliantGroup(scoredGroups[1]), true);
    assert.equal(isNotFullyCompliantGroup(scoredGroups[2]), true);
    assert.equal(isNotFullyCompliantGroup(scoredGroups[3]), true);
  });

  it("returns all groups for the All score sentinel", () => {
    assert.deepEqual(
      filterComplianceGroupsByScore(scoredGroups, COMPLIANCE_SCORE_FILTER_ALL),
      scoredGroups,
    );
    assert.deepEqual(filterComplianceGroupsByScore(scoredGroups, ""), scoredGroups);
  });

  it("keeps only not-100% / failed groups for not_100 filter", () => {
    assert.deepEqual(
      filterComplianceGroupsByScore(scoredGroups, COMPLIANCE_SCORE_FILTER_NOT_100).map((g) => g.id),
      ["issues", "failed", "zero-score-issues"],
    );
  });

  it("stacks with document All filter: All docs × not_100 keeps every non-compliant group", () => {
    const afterDoc = filterComplianceResultGroups(scoredGroups, COMPLIANCE_RESULTS_FILTER_ALL);
    assert.deepEqual(
      filterComplianceGroupsByScore(afterDoc, COMPLIANCE_SCORE_FILTER_NOT_100).map((g) => g.id),
      ["issues", "failed", "zero-score-issues"],
    );
  });

  it("stacks with a single-document filter", () => {
    const afterDoc = filterComplianceResultGroups(scoredGroups, "doc-issues");
    assert.deepEqual(
      filterComplianceGroupsByScore(afterDoc, COMPLIANCE_SCORE_FILTER_NOT_100).map((g) => g.id),
      ["issues"],
    );
    const perfectOnly = filterComplianceResultGroups(scoredGroups, "doc-perfect");
    assert.deepEqual(
      filterComplianceGroupsByScore(perfectOnly, COMPLIANCE_SCORE_FILTER_NOT_100),
      [],
    );
  });
});
