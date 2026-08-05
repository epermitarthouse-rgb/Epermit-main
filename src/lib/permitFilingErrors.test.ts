import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatPermitFilingError,
  isMissingRelationError,
  resolveProjectIdForFiling,
} from "./permitFilingErrors.ts";

describe("permitFilingErrors", () => {
  it("detects PostgREST schema-cache missing-table errors", () => {
    const err = {
      code: "PGRST205",
      message: "Could not find the table 'public.permit_filings' in the schema cache",
    };
    assert.equal(isMissingRelationError(err), true);
    const msg = formatPermitFilingError(err);
    assert.match(msg, /Permit filing storage is not set up/i);
    assert.doesNotMatch(msg, /schema cache/i);
  });

  it("names a missing related filing table when present", () => {
    const err = {
      code: "PGRST205",
      message: "Could not find the table 'public.filing_professionals' in the schema cache",
    };
    const msg = formatPermitFilingError(err);
    assert.match(msg, /filing_professionals/);
    assert.doesNotMatch(msg, /schema cache/i);
  });

  it("reuses a session-created project instead of creating another", () => {
    assert.deepEqual(
      resolveProjectIdForFiling({
        createMode: true,
        existingProjectId: null,
        sessionCreatedProjectId: "proj-1",
      }),
      { projectId: "proj-1", shouldCreateProject: false }
    );

    assert.deepEqual(
      resolveProjectIdForFiling({
        createMode: true,
        existingProjectId: null,
        sessionCreatedProjectId: null,
      }),
      { projectId: null, shouldCreateProject: true }
    );

    assert.deepEqual(
      resolveProjectIdForFiling({
        createMode: false,
        existingProjectId: "existing",
        sessionCreatedProjectId: null,
      }),
      { projectId: "existing", shouldCreateProject: false }
    );

    assert.deepEqual(
      resolveProjectIdForFiling({
        createMode: false,
        existingProjectId: "existing",
        sessionCreatedProjectId: "session-wins",
      }),
      { projectId: "session-wins", shouldCreateProject: false }
    );
  });
});
