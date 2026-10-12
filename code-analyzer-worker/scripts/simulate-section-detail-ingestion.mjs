#!/usr/bin/env node
/**
 * Local ingestion classification dry-run (no Supabase): count pages that would create analyzer sheets.
 */
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extractPdfPagesFromFile } = require("../lib/pdfExtract.js");
const { classifyPage, buildSegmentsFromPageClasses, getPageClass, shouldCreateSheetsForPage } =
  require("../lib/segments.js");
const { classifyDocument } = require("../lib/classify.js");

const baseDir =
  process.argv[2] ||
  path.resolve(
    process.cwd(),
    "../ai compliance/wetransfer_100-41st-full-facade_2026-07-08_1405",
  );

const files = [
  "ASK04 - SECTION DETAILS.pdf",
  "ASK05 - SECTION DETAILS.pdf",
  "ASK06 - SECTION DETAILS.pdf",
];

async function simulate(fileName) {
  const filePath = path.join(baseDir, fileName);
  const pageClasses = {};
  const pages = [];
  for await (const page of extractPdfPagesFromFile(filePath)) {
    pages.push(page);
    const result = classifyPage({
      pageNumber: page.pageNumber,
      text: page.text,
      fileName,
      documentType: "specification",
    });
    pageClasses[page.pageNumber] = result.analyzerClass;
  }
  const segments = buildSegmentsFromPageClasses(pageClasses);
  const docLevel = classifyDocument({
    fileName,
    documentType: "specification",
    samplePageTexts: pages.slice(0, 5).map((p) => p.text),
  });
  let sheetsCreated = 0;
  for (const page of pages) {
    const pageClass = getPageClass(page.pageNumber, segments, docLevel.analyzerClass);
    if (shouldCreateSheetsForPage(pageClass)) sheetsCreated += 1;
  }
  return {
    fileName,
    totalPages: pages.length,
    pageClasses,
    docLevel: docLevel.analyzerClass,
    sheetsCreated,
  };
}

const results = [];
for (const file of files) {
  try {
    results.push(await simulate(file));
  } catch (err) {
    results.push({ fileName: file, error: err.message });
  }
}

console.log(JSON.stringify({ baseDir, results }, null, 2));
