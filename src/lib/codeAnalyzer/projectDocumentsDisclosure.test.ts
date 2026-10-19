import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSameProjectDocumentsSession,
  projectDocumentsDefaultExpanded,
  reconcileProjectDocumentsDisclosure,
  resolveProjectDocumentsPhase,
} from "./projectDocumentsDisclosure.ts";

describe("project documents disclosure", () => {
  it("starts expanded while uploading or organizing and collapsed for analysis and results", () => {
    assert.equal(
      resolveProjectDocumentsPhase({ activeStep: 2, complianceRunActive: false, anyOrganizing: true }),
      "prepare",
    );
    assert.equal(projectDocumentsDefaultExpanded("prepare"), true);
    assert.equal(
      resolveProjectDocumentsPhase({ activeStep: 4, complianceRunActive: true, anyOrganizing: false }),
      "analyze",
    );
    assert.equal(projectDocumentsDefaultExpanded("analyze"), false);
    assert.equal(
      resolveProjectDocumentsPhase({ activeStep: 5, complianceRunActive: false, anyOrganizing: false }),
      "results",
    );
    assert.equal(projectDocumentsDefaultExpanded("results"), false);
  });

  it("keeps a manual choice across polling and resets it for a new analysis", () => {
    const collapsedDefault = reconcileProjectDocumentsDisclosure(null, {
      phase: "analyze",
      runId: "run-a",
    });
    assert.equal(collapsedDefault.expanded, false);

    const opened = { ...collapsedDefault, expanded: true };
    const polled = reconcileProjectDocumentsDisclosure(opened, { phase: "analyze", runId: "run-a" });
    assert.equal(polled, opened);

    const hydrated = reconcileProjectDocumentsDisclosure(
      { sessionKey: "analyze:active", expanded: true },
      { phase: "analyze", runId: "run-a" },
    );
    assert.equal(hydrated.expanded, true);
    assert.equal(isSameProjectDocumentsSession("analyze:active", "analyze:run-a"), true);

    const nextRun = reconcileProjectDocumentsDisclosure(opened, { phase: "analyze", runId: "run-b" });
    assert.equal(nextRun.expanded, false);
    assert.notEqual(nextRun.sessionKey, opened.sessionKey);

    const results = reconcileProjectDocumentsDisclosure(opened, { phase: "results", runId: "run-a" });
    assert.equal(results.expanded, false);
  });
});
