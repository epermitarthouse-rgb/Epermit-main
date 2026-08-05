import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLIANCE_RESULTS_FILTER_ALL,
  filterComplianceResultGroups,
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
