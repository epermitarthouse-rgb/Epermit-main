"use strict";

const DIVISION_RE = /^DIVISION\s+(\d+)\s*[-–—]?\s*(.+)?$/i;
const SECTION_RE = /^SECTION\s+(\d{2}\s*\d{2}\s*\d{2})\s*[-–—]?\s*(.+)?$/i;
const PART_RE = /^PART\s+([12])\s*[-–—]?\s*(.+)?$/i;

/**
 * Parse CSI-style headings from page text. Returns section updates keyed by section_number.
 */
function extractSpecHeadingsFromPage(pageText, pageNumber) {
  const lines = String(pageText || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const events = [];
  let currentDivision = null;
  let currentSection = null;
  let currentPart = null;

  for (const line of lines) {
    const divMatch = line.match(DIVISION_RE);
    if (divMatch) {
      currentDivision = divMatch[1];
      currentSection = null;
      currentPart = null;
      events.push({
        type: "division",
        division: currentDivision,
        title: (divMatch[2] || "").trim() || null,
        pageNumber,
      });
      continue;
    }

    const secMatch = line.match(SECTION_RE);
    if (secMatch) {
      const sectionNumber = secMatch[1].replace(/\s+/g, " ").trim();
      currentSection = sectionNumber;
      currentPart = null;
      events.push({
        type: "section_start",
        division: currentDivision,
        sectionNumber,
        sectionTitle: (secMatch[2] || "").trim() || null,
        pageNumber,
      });
      continue;
    }

    const partMatch = line.match(PART_RE);
    if (partMatch && currentSection) {
      currentPart = partMatch[1];
      events.push({
        type: "part",
        division: currentDivision,
        sectionNumber: currentSection,
        part: currentPart,
        title: (partMatch[2] || "").trim() || null,
        pageNumber,
      });
    }
  }

  return events;
}

/**
 * Build normalized spec sections from heading events across pages.
 */
function buildSpecSections(pageEvents) {
  const sections = [];
  let open = null;

  for (const event of pageEvents) {
    if (event.type === "section_start") {
      if (open) {
        open.page_end = Math.max(open.page_start, event.pageNumber - 1);
        sections.push(open);
      }
      open = {
        division: event.division,
        section_number: event.sectionNumber,
        section_title: event.sectionTitle,
        page_start: event.pageNumber,
        page_end: event.pageNumber,
        parts: [],
      };
      continue;
    }

    if (event.type === "part" && open && open.section_number === event.sectionNumber) {
      open.parts.push({
        part: event.part,
        title: event.title,
        page_start: event.pageNumber,
      });
    }
  }

  if (open) {
    sections.push(open);
  }

  return sections;
}

/**
 * Split section body text into chunks within section boundaries.
 */
function chunkSectionText(section, fullTextByPage) {
  const pages = [];
  for (let p = section.page_start; p <= section.page_end; p++) {
    if (fullTextByPage[p]) pages.push(fullTextByPage[p]);
  }
  const body = pages.join("\n\n").trim();
  if (!body) return [];

  const MAX = 1500;
  const OVERLAP = 200;
  if (body.length <= MAX) {
    return [{ chunkIndex: 0, chunkText: body }];
  }

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;
  while (start < body.length) {
    const end = Math.min(start + MAX, body.length);
    chunks.push({ chunkIndex, chunkText: body.slice(start, end) });
    chunkIndex++;
    if (end >= body.length) break;
    start = Math.max(0, end - OVERLAP);
  }
  return chunks;
}

module.exports = {
  extractSpecHeadingsFromPage,
  buildSpecSections,
  chunkSectionText,
};
