import { describe, expect, it } from "vitest";
import {
  EMPTY_PROJECT_UCI_DEPENDENCY_SUMMARY,
  formatUciDependencyBlockReason,
  hasUciDependencies,
  isPackageDocumentRemovalLocked,
} from "@/lib/projectDestructiveSafety";

describe("projectDestructiveSafety", () => {
  it("treats empty disposable project as deletable", () => {
    expect(hasUciDependencies(EMPTY_PROJECT_UCI_DEPENDENCY_SUMMARY)).toBe(false);
  });

  it("blocks cascade delete when any UCI dependency exists", () => {
    expect(
      hasUciDependencies({
        ...EMPTY_PROJECT_UCI_DEPENDENCY_SUMMARY,
        coordinationRecords: 1,
      }),
    ).toBe(true);
    expect(
      hasUciDependencies({
        ...EMPTY_PROJECT_UCI_DEPENDENCY_SUMMARY,
        transmissionAttempts: 2,
      }),
    ).toBe(true);
  });

  it("explains why deletion is blocked", () => {
    const message = formatUciDependencyBlockReason({
      ...EMPTY_PROJECT_UCI_DEPENDENCY_SUMMARY,
      coordinationRecords: 2,
      applications: 1,
    });
    expect(message).toMatch(/Permanent deletion is blocked/i);
    expect(message).toMatch(/2 utility coordination records/i);
    expect(message).toMatch(/Archive/i);
  });

  it("locks package remove when reviewed or submitted", () => {
    expect(isPackageDocumentRemovalLocked({ draft_status: "draft", submitted_at: null })).toBe(
      false,
    );
    expect(isPackageDocumentRemovalLocked({ draft_status: "reviewed", submitted_at: null })).toBe(
      true,
    );
    expect(isPackageDocumentRemovalLocked({ draft_status: "submitted", submitted_at: null })).toBe(
      true,
    );
    expect(
      isPackageDocumentRemovalLocked({
        draft_status: "needs_changes",
        submitted_at: "2026-08-18T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});
