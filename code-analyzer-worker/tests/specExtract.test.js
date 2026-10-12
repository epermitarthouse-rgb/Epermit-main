"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSpecSections,
  extractSpecHeadingsFromPage,
  normalizeSectionNumber,
  mergeSectionsByNumber,
} = require("../lib/specExtract");

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

  it("extracts Riverside-style inline 5-digit SECTION headings from flattened TOC text", () => {
    const riversideToc =
      "DIVISION 1 - GENERAL REQUIREMENTS SECTION 01010 Summary of Work SECTION 01025 Payment " +
      "SECTION 02070 Selective Demolition SECTION 03700 Concrete Repair & Related Work";
    const events = extractSpecHeadingsFromPage(riversideToc, 2);
    const starts = events.filter((e) => e.type === "section_start");
    assert.ok(starts.length >= 4);
    assert.ok(starts.some((e) => e.sectionNumber === "01010" && /Summary of Work/i.test(e.sectionTitle || "")));
    assert.ok(starts.some((e) => e.sectionNumber === "02070"));
    const sections = buildSpecSections(events);
    assert.ok(sections.length >= 4);
  });

  it("supports SECTION 03 30 00 with spaced CSI numbering", () => {
    const events = extractSpecHeadingsFromPage("SECTION 03 30 00 - CAST-IN-PLACE CONCRETE", 5);
    assert.equal(events[0].sectionNumber, "03 30 00");
    assert.match(events[0].sectionTitle || "", /CAST-IN-PLACE/i);
  });

  it("normalizes compact 6-digit section numbers", () => {
    assert.equal(normalizeSectionNumber("033000"), "03 30 00");
    assert.equal(normalizeSectionNumber("01010"), "01010");
  });

  it("merges TOC and body occurrences of the same section number", () => {
    const merged = mergeSectionsByNumber([
      {
        division: "2",
        section_number: "02070",
        section_title: "Selective Demolition",
        page_start: 2,
        page_end: 2,
        parts: [],
      },
      {
        division: "2",
        section_number: "02070",
        section_title: "Selective Demolition",
        page_start: 40,
        page_end: 45,
        parts: [],
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].page_start, 2);
    assert.equal(merged[0].page_end, 45);
  });
});
