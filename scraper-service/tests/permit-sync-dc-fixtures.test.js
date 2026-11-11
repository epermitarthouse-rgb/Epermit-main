"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "fixtures", "permit-sync", "dc");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
const load = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));

describe("permit-sync DC fixtures: redaction", () => {
  it("contain no emails, phone numbers or session tokens", () => {
    for (const f of files) {
      const raw = fs.readFileSync(path.join(DIR, f), "utf8");
      assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(raw), false, `${f} has an email`);
      assert.equal(/\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/.test(raw), false, `${f} has a phone number`);
      assert.equal(/eyJ[A-Za-z0-9_-]{10,}\./.test(raw), false, `${f} has a JWT`);
    }
  });

  it("use role labels for reviewers and responders", () => {
    const { rows } = load("corrections-resubmit.json");
    for (const r of rows) {
      assert.equal(r.reviewer, "reviewer");
      for (const resp of r.responses) assert.ok(["applicant", "reviewer"].includes(resp.by), `role ${resp.by}`);
    }
  });
});

describe("permit-sync DC fixtures: inventory reconciliation", () => {
  const inv = load("inventory.json");

  it("lists exactly totalRecords unique permits", () => {
    assert.equal(inv.records.length, inv.totalRecords);
    assert.equal(new Set(inv.records.map((r) => r.permit)).size, inv.totalRecords);
  });

  it("fills pages in pageSize chunks", () => {
    const byPage = {};
    for (const r of inv.records) byPage[r.page] = (byPage[r.page] || 0) + 1;
    assert.deepEqual(byPage, { 1: 10, 2: 10, 3: 8 });
  });

  it("matches the observed status totals", () => {
    const counts = {};
    for (const r of inv.records) counts[r.status] = (counts[r.status] || 0) + 1;
    assert.deepEqual(counts, { Upload: 6, Resubmit: 3, "In Review": 4, Approved: 15 });
  });
});

describe("permit-sync DC fixtures: count parity", () => {
  it("Status unresolved count equals unresolved Reviews rows", () => {
    const status = load("workflow-status-resubmit.json");
    const { rows } = load("corrections-resubmit.json");
    const sw = status.SubWorkflows[0];
    const unresolvedRows = rows.filter((r) => r.status === "Unresolved");
    assert.equal(sw.UnresolvedComments, unresolvedRows.length);
    const byGroup = sw.UnresolvedByGroup.reduce((n, g) => n + g.UnresolvedComments, 0);
    assert.equal(byGroup, sw.UnresolvedComments);
    for (const r of unresolvedRows) {
      const g = sw.UnresolvedByGroup.find((x) => x.GroupName === r.department);
      assert.ok(g && g.UnresolvedComments > 0, `department ${r.department} has an unresolved count`);
    }
  });

  it("Approved folder sentinel DateUpdated is not a usable change signal", () => {
    const { folders } = load("project-folders-approved.json");
    assert.equal(folders[0].DateUpdated, "0001-01-01T00:00:00");
    assert.equal(folders.reduce((n, f) => n + f.FilesCount, 0), 92);
  });
});
