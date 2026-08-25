import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COMPLIANCE_MAX_BATCH_FILES } from "../complianceUploadLimits.ts";
import type { DrawingUploadProgress } from "./uploadBatchProgress.ts";
import {
  createUploadSession,
  extendUploadSession,
  formatPendingUploadCapacityLabel,
  isUploadSessionActive,
  resetUploadSession,
  resolveUploadSessionBatchTotal,
  shouldShowPendingUploadCapacityLabel,
  syncUploadSession,
} from "./uploadSession.ts";

describe("upload session lifecycle", () => {
  it("A: idle — no pending files and no upload progress hides the capacity line", () => {
    assert.equal(shouldShowPendingUploadCapacityLabel(null, null, 0), false);
    assert.equal(formatPendingUploadCapacityLabel(0, 16), null);
  });

  it("B: active upload progress keeps session active even with empty pending queue", () => {
    const progress: DrawingUploadProgress = {
      total: 2,
      completed: 1,
      currentIndex: 2,
      currentFileName: "plan.pdf",
      phase: "uploading",
    };
    assert.equal(isUploadSessionActive(null, progress, 0), true);
    assert.equal(shouldShowPendingUploadCapacityLabel(null, progress, 0), false);
  });

  it("C: single queued file shows 1 of 1 (not 1 of max batch cap)", () => {
    const session = createUploadSession(1);
    assert.equal(
      formatPendingUploadCapacityLabel(1, resolveUploadSessionBatchTotal(session, 1, null)),
      "1 of 1 source document in this upload",
    );
  });

  it("D: 16-doc project adding 1 new file shows 1/1 not 1/16", () => {
    const projectSourceDocumentCount = 16;
    const session = syncUploadSession(null, 1, null);
    const batchTotal = resolveUploadSessionBatchTotal(session, 1, null);
    assert.equal(projectSourceDocumentCount, 16);
    assert.equal(COMPLIANCE_MAX_BATCH_FILES, 16);
    assert.notEqual(batchTotal, projectSourceDocumentCount);
    assert.equal(
      formatPendingUploadCapacityLabel(1, batchTotal),
      "1 of 1 source document in this upload",
    );
  });

  it("E: multi-file session shows N of N for the current batch", () => {
    let session = syncUploadSession(null, 1, null);
    session = syncUploadSession(session, 3, null);
    assert.equal(
      formatPendingUploadCapacityLabel(3, resolveUploadSessionBatchTotal(session, 3, null)),
      "3 of 3 source documents in this upload",
    );
  });

  it("F: terminal idle after batch clears session and label", () => {
    let session = createUploadSession(2);
    session = syncUploadSession(session, 0, null);
    assert.equal(session, null);
    assert.equal(shouldShowPendingUploadCapacityLabel(session, null, 0), false);
  });

  it("G: explicit reset clears session", () => {
    assert.equal(resetUploadSession(), null);
    assert.equal(shouldShowPendingUploadCapacityLabel(createUploadSession(1), null, 0), false);
  });

  it("H: code-mod-style upload uses progress total as batch denominator", () => {
    const progress: DrawingUploadProgress = {
      total: 1,
      completed: 0,
      currentIndex: 1,
      currentFileName: "mod-drawing.pdf",
      phase: "uploading",
    };
    const session = extendUploadSession(null, 1, progress.total);
    assert.equal(isUploadSessionActive(session, progress, 1), true);
    assert.equal(
      formatPendingUploadCapacityLabel(
        1,
        resolveUploadSessionBatchTotal(session, 1, progress),
      ),
      "1 of 1 source document in this upload",
    );
  });

  it("I: partial upload failure — pending cleared, session idle, no stale label", () => {
    const completeProgress: DrawingUploadProgress = {
      total: 2,
      completed: 2,
      currentIndex: 2,
      phase: "complete",
    };
    const session = syncUploadSession(createUploadSession(2), 0, completeProgress);
    assert.equal(session, null);
    assert.equal(shouldShowPendingUploadCapacityLabel(session, completeProgress, 0), false);
  });

  it("J: removing files before upload shrinks batch total", () => {
    let session = syncUploadSession(null, 3, null);
    session = syncUploadSession(session, 2, null);
    assert.equal(session?.batchTotal, 2);
    assert.equal(
      formatPendingUploadCapacityLabel(2, resolveUploadSessionBatchTotal(session, 2, null)),
      "2 of 2 source documents in this upload",
    );
  });

  it("K: hydration/reload idle — zero pending and null progress never shows label", () => {
    assert.equal(COMPLIANCE_MAX_BATCH_FILES, 16);
    assert.equal(shouldShowPendingUploadCapacityLabel(null, null, 0), false);
  });
});
