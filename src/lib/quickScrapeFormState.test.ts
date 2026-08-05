import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildQuickScrapeRequestIdentity,
  formFieldsFromSelectedProject,
  resolveQuickScrapeSubmitFields,
} from "./quickScrapeFormState.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WASHINGTON = {
  id: "proj-washington",
  permit_number: "B2606607",
  credential_id: "cred-washington",
};

const BALTIMORE = {
  id: "proj-baltimore",
  name: "test baltimore",
  permit_number: "BCCM-26-003168",
  credential_id: "cred-baltimore",
};

describe("quickScrapeFormState — project switch", () => {
  it("Washington → Baltimore updates form to Baltimore project id, permit, credential", () => {
    const afterWashington = formFieldsFromSelectedProject(WASHINGTON);
    assert.deepEqual(afterWashington, {
      projectId: "proj-washington",
      permitNumber: "B2606607",
      credentialId: "cred-washington",
    });

    // Selecting Baltimore must overwrite prior Washington form values.
    const afterBaltimore = formFieldsFromSelectedProject(BALTIMORE);
    assert.deepEqual(afterBaltimore, {
      projectId: "proj-baltimore",
      permitNumber: "BCCM-26-003168",
      credentialId: "cred-baltimore",
    });
    assert.notEqual(afterBaltimore?.permitNumber, "B2606607");
    assert.notEqual(afterBaltimore?.credentialId, "cred-washington");
  });

  it("submit payload after Washington → Baltimore contains only Baltimore identity", () => {
    // Simulate sticky local draft from Washington still in memory.
    const stickyLocalPermit = "B2606607";
    assert.equal(stickyLocalPermit, "B2606607");

    const submit = resolveQuickScrapeSubmitFields({
      selectedProjectId: BALTIMORE.id,
      selectedProject: BALTIMORE,
    });

    assert.equal(submit.ok, true);
    if (!submit.ok) return;

    assert.equal(submit.projectId, "proj-baltimore");
    assert.equal(submit.permitNumber, "BCCM-26-003168");
    assert.equal(submit.credentialId, "cred-baltimore");
    assert.notEqual(submit.permitNumber, stickyLocalPermit);
    assert.notEqual(submit.credentialId, "cred-washington");

    const body = buildQuickScrapeRequestIdentity({
      sessionId: "sess-1",
      userId: "user-1",
      projectId: submit.projectId,
      permitNumber: submit.permitNumber,
    });

    assert.deepEqual(body, {
      sessionId: "sess-1",
      permitNumber: "BCCM-26-003168",
      userId: "user-1",
      projectId: "proj-baltimore",
    });
    assert.doesNotMatch(JSON.stringify(body), /B2606607/);
  });

  it("does not fall back to another project's permit when selection mismatches", () => {
    const submit = resolveQuickScrapeSubmitFields({
      selectedProjectId: BALTIMORE.id,
      // Stale Washington snapshot still loaded — must not be used.
      selectedProject: WASHINGTON,
    });
    assert.equal(submit.ok, false);
    if (submit.ok) return;
    assert.equal(submit.reason, "project_mismatch");
  });

  it("clears permit/credential when the newly selected project has none", () => {
    const afterWashington = formFieldsFromSelectedProject(WASHINGTON);
    assert.equal(afterWashington?.permitNumber, "B2606607");

    const emptyProject = {
      id: "proj-empty",
      permit_number: null,
      credential_id: null,
    };
    const afterEmpty = formFieldsFromSelectedProject(emptyProject);
    assert.deepEqual(afterEmpty, {
      projectId: "proj-empty",
      permitNumber: "",
      credentialId: "",
    });
  });
});

describe("quickScrapeFormState — wiring contracts", () => {
  it("ActiveProjectControl syncs permit+credential from selected project (no sticky empty-only fill)", () => {
    const src = readFileSync(
      join(__dirname, "../components/layout/ActiveProjectControl.tsx"),
      "utf8",
    );
    assert.match(src, /formFieldsFromSelectedProject/);
    // Old bug: only fill permit when local state is empty, leaving B2606607 stuck.
    assert.doesNotMatch(
      src,
      /projectPermit && !permitNumber\.trim\(\)/,
    );
  });

  it("AgentWorkflowStatus submits from selected project UUID, not latestPermitNumber fallback", () => {
    const src = readFileSync(
      join(__dirname, "../components/dashboard/AgentWorkflowStatus.tsx"),
      "utf8",
    );
    assert.match(src, /resolveQuickScrapeSubmitFields/);
    assert.match(src, /buildQuickScrapeRequestIdentity/);
    // Scrape path must not reuse latest project's permit after a switch.
    assert.doesNotMatch(
      src,
      /projectBySelectedId\?\.permit_number \?\? latestPermitNumber/,
    );
  });

  it("AgentWorkflowStatus re-reads projects.credential_id from DB before scrape submit", () => {
    const src = readFileSync(
      join(__dirname, "../components/dashboard/AgentWorkflowStatus.tsx"),
      "utf8",
    );
    // Stale React state after header credential bind must not block scrape.
    assert.match(src, /Always re-read credential_id from DB/);
    assert.match(
      src,
      /\.select\("id, permit_number, jurisdiction, credential_id, portal_data"\)/,
    );
    assert.match(src, /freshSelectedProject/);
  });
});
