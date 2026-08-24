"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildSpecSections, extractSpecHeadingsFromPage } = require("../lib/specExtract");

describe("specExtract", () => {
  it("extracts CSI sections from page text", () => {
    const events = extractSpecHeadingsFromPage(
      "DIVISION 02 EXISTING CONDITIONS\nSECTION 02 41 19 SELECTIVE DEMOLITION\nPART 1 GENERAL",
      12,
    );
    assert.ok(events.some((e) => e.type === "section_start" && e.sectionNumber.includes("02")));
    const sections = buildSpecSections(events);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].page_start, 12);
  });
});
