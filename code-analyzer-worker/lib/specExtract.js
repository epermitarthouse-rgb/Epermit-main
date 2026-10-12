"use strict";

const DIVISION_RE = /^DIVISION\s+(\d+)\s*[-–—]?\s*(.+)?$/i;
const SECTION_LINE_RE = /^SECTION\s+(\d{2}\s+\d{2}\s+\d{2}|\d{5,6})\s*[-–—]?\s*(.+)?$/i;
const PART_RE = /^PART\s+([12])\s*[-–—]?\s*(.+)?$/i;

/** @param {string} raw */
function normalizeSectionNumber(raw) {
  const trimmed = String(raw || "").trim();
  const compact = trimmed.replace(/\s+/g, "");
  if (/^\d{6}$/.test(compact)) {
    return `${compact.slice(0, 2)} ${compact.slice(2, 4)} ${compact.slice(4, 6)}`;
  }
  if (/^\d{5}$/.test(compact)) {
    return compact;
  }
  return trimmed.replace(/\s+/g, " ").trim();
}

/** @param {string} title */
function cleanSectionTitle(title) {
  return String(title || "")
    .replace(/\s+/g, " ")
    .replace(/^(?:[-–—]\s*)+/, "")
    .trim()
    .slice(0, 200);
}

/**
 * Scan flattened PDF text (single-line or few lines) for SECTION / DIVISION markers.
 */
function extractInlineSpecHeadings(pageText, pageNumber) {
  const text = String(pageText || "");
  if (!text.trim()) return [];

  const events = [];
  let currentDivision = null;

  const divisionRe = /DIVISION\s+(\d+)\s*[-–—]?\s*([^]*?)(?=DIVISION\s+\d|SECTION\s+\d|$)/gi;
  for (const divMatch of text.matchAll(divisionRe)) {
    currentDivision = divMatch[1];
    const title = cleanSectionTitle(divMatch[2] || "");
    events.push({
      type: "division",
      division: currentDivision,
      title: title || null,
      pageNumber,
    });
  }

  const sectionRe =
    /SECTION\s+(\d{2}\s+\d{2}\s+\d{2}|\d{5,6})\s*(?:[-–—]\s*)?([^]*?)(?=SECTION\s+(?:\d{2}\s+\d{2}\s+\d{2}|\d{5,6})|DIVISION\s+\d|$)/gi;

  for (const secMatch of text.matchAll(sectionRe)) {
    const sectionNumber = normalizeSectionNumber(secMatch[1]);
    let sectionTitle = cleanSectionTitle(secMatch[2] || "");
    sectionTitle = sectionTitle.split(/\bPART\s+(?:I|II|III|IV|1|2|3)\b/i)[0].trim();
    sectionTitle = sectionTitle.replace(/^(?:PART\s+[12]\s*[-–—]?\s*)+/i, "").trim();
    if (sectionTitle.length < 3) sectionTitle = null;

    events.push({
      type: "section_start",
      division: currentDivision,
      sectionNumber,
      sectionTitle,
      pageNumber,
    });
  }

  return events;
}

/**
 * Parse CSI-style headings from page text (line-based + inline fallback).
 */
function extractSpecHeadingsFromPage(pageText, pageNumber) {
  const lines = String(pageText || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const events = [];
  let currentDivision = null;
  let currentSection = null;

  for (const line of lines) {
    const divMatch = line.match(DIVISION_RE);
    if (divMatch) {
      currentDivision = divMatch[1];
      currentSection = null;
      events.push({
        type: "division",
        division: currentDivision,
        title: cleanSectionTitle(divMatch[2] || "") || null,
        pageNumber,
      });
      continue;
    }

    const secMatch = line.match(SECTION_LINE_RE);
    if (secMatch) {
      const sectionNumber = normalizeSectionNumber(secMatch[1]);
      currentSection = sectionNumber;
      events.push({
        type: "section_start",
        division: currentDivision,
        sectionNumber,
        sectionTitle: cleanSectionTitle(secMatch[2] || "") || null,
        pageNumber,
      });
      continue;
    }

    const partMatch = line.match(PART_RE);
    if (partMatch && currentSection) {
      events.push({
        type: "part",
        division: currentDivision,
        sectionNumber: currentSection,
        part: partMatch[1],
        title: cleanSectionTitle(partMatch[2] || "") || null,
        pageNumber,
      });
    }
  }

  if (events.some((e) => e.type === "section_start")) {
    return events;
  }

  return extractInlineSpecHeadings(pageText, pageNumber);
}

/**
 * Merge duplicate section numbers (TOC + body) into one span.
 * @param {Array<{ division: string | null; section_number: string; section_title: string | null; page_start: number; page_end: number; parts: unknown[] }>} sections
 */
function mergeSectionsByNumber(sections) {
  const byNum = new Map();
  for (const s of sections) {
    const key = normalizeSectionNumber(s.section_number);
    if (!byNum.has(key)) {
      byNum.set(key, { ...s, section_number: key, parts: [...(s.parts || [])] });
      continue;
    }
    const prev = byNum.get(key);
    prev.page_start = Math.min(prev.page_start, s.page_start);
    prev.page_end = Math.max(prev.page_end, s.page_end);
    if (!prev.division && s.division) prev.division = s.division;
    const prevTitle = prev.section_title || "";
    const nextTitle = s.section_title || "";
    if (nextTitle.length > prevTitle.length) prev.section_title = s.section_title;
    prev.parts.push(...(s.parts || []));
  }
  return [...byNum.values()].sort((a, b) => a.page_start - b.page_start || a.section_number.localeCompare(b.section_number));
}

/**
 * Build normalized spec sections from heading events across pages.
 */
function buildSpecSections(pageEvents) {
  const sorted = [...pageEvents].sort(
    (a, b) => a.pageNumber - b.pageNumber || (a.type === "section_start" ? 0 : 1),
  );

  const sections = [];
  let open = null;

  for (const event of sorted) {
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
      open.page_end = Math.max(open.page_end, event.pageNumber);
    }
  }

  if (open) {
    sections.push(open);
  }

  for (const s of sections) {
    if (s.page_end < s.page_start) s.page_end = s.page_start;
  }

  return mergeSectionsByNumber(sections);
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
  normalizeSectionNumber,
  extractSpecHeadingsFromPage,
  extractInlineSpecHeadings,
  buildSpecSections,
  chunkSectionText,
  mergeSectionsByNumber,
};
