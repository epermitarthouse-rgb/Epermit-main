/**
 * Accountability gate and coverage report.
 * Precision and recall stay "Not measured" until verified labels exist.
 * Content completeness is separate from accountability: unread ink, unreadable
 * files, and this extractor's refusal to read outlined graphics are explicit.
 */

export const NOT_MEASURED = "Not measured";

export const TERMINAL_STATUSES = new Set([
  "extracted",
  "extract_failed",
  "password_protected",
  "duplicate_of",
  "unexpected_format",
  "container_indexed",
  "container_unreadable",
  "symlink_not_followed",
  "unreadable",
]);

export function assessDataset(snapshot) {
  const issues = [];
  const files = snapshot.files || [];
  const pages = snapshot.pages || [];
  const regions = snapshot.unresolvedRegions || [];
  const findings = snapshot.findings || [];
  const mappings = snapshot.mappings || [];

  if (files.length !== snapshot.walkedFiles) {
    issues.push(issue("walked-file-count", "accountability", `Walked ${snapshot.walkedFiles} files and recorded ${files.length}.`));
  }
  for (const file of files) {
    if (!TERMINAL_STATUSES.has(file.processingStatus)) {
      issues.push(issue("file-status", "accountability", `${file.relativePath} has non-terminal status ${file.processingStatus || "missing"}.`));
    }
    if (file.format === "pdf" && file.processingStatus === "extracted") {
      const recorded = pages.filter((page) => page.sha256 === file.sha256);
      if (file.pageCount == null) {
        issues.push(issue("pdf-page-count", "accountability", `${file.relativePath} opened without a page count.`));
      } else if (recorded.length !== file.pageCount) {
        issues.push(issue("pdf-page-records", "accountability", `${file.relativePath} has ${file.pageCount} pages and ${recorded.length} page records.`));
      }
      const numbers = new Set(recorded.map((page) => page.pageNumber));
      for (let pageNumber = 1; pageNumber <= (file.pageCount || 0); pageNumber += 1) {
        if (!numbers.has(pageNumber)) {
          issues.push(issue("pdf-page-missing", "accountability", `${file.relativePath} page ${pageNumber} has no record.`));
        }
      }
    }
    if (file.format === "pdf" && file.processingStatus === "duplicate_of" && !file.duplicateOf) {
      issues.push(issue("duplicate-pointer", "accountability", `${file.relativePath} is marked duplicate without a source hash path.`));
    }
  }

  const regionCount = pages.reduce((sum, page) => sum + (page.unresolvedCount || 0), 0);
  if (regions.length !== regionCount) {
    issues.push(issue("region-manifest", "accountability", `Unresolved region rows ${regions.length} do not match page totals ${regionCount}.`));
  }
  const expectedCells = snapshot.expectedCellsPerPage
    ? pages.filter((page) => page.captureClass !== "failed").length * snapshot.expectedCellsPerPage
    : 0;
  if (snapshot.cells && expectedCells && snapshot.cells.length !== expectedCells) {
    issues.push(issue("cell-manifest", "accountability", `Classified cells ${snapshot.cells.length} do not match ${expectedCells} expected cells.`));
  }

  if (findings.length !== mappings.length) {
    issues.push(issue("finding-map-count", "accountability", `Findings ${findings.length} and mappings ${mappings.length} differ.`));
  }
  const seenIds = new Set();
  for (const mapping of mappings) {
    if (seenIds.has(mapping.clientReportId)) {
      issues.push(issue("duplicate-finding-map", "accountability", `Finding ${mapping.clientReportId} is mapped more than once.`));
    }
    seenIds.add(mapping.clientReportId);
    if (mapping.wordingMatchesFixture !== true) {
      issues.push(issue("finding-wording", "accountability", `Finding ${mapping.clientReportId} wording does not match the fixture.`));
    }
    if (!mapping.matchResult) {
      issues.push(issue("finding-match-result", "accountability", `Finding ${mapping.clientReportId} has no match result.`));
    }
  }
  for (const finding of findings) {
    if (!seenIds.has(finding.clientReportId)) {
      issues.push(issue("finding-unmapped-row", "accountability", `Finding ${finding.clientReportId} has no mapping row.`));
    }
  }

  const contentIssues = [];
  for (const file of files) {
    if (["unreadable", "extract_failed", "password_protected", "container_unreadable"].includes(file.processingStatus)) {
      contentIssues.push(contentIssue(`file-${file.processingStatus}:${file.relativePath}`, file.relativePath, null, file.processingStatus));
    }
    if (file.format === "other" || file.format === "symlink") {
      contentIssues.push(contentIssue(`unexpected:${file.relativePath}`, file.relativePath, null, file.processingStatus));
    }
    if (file.format === "zip") {
      contentIssues.push(contentIssue(`zip-not-extracted:${file.relativePath}`, file.relativePath, null, "Container members were listed and were not extracted as drawings."));
    }
    if (file.cropBoxPresent) {
      contentIssues.push(contentIssue(`crop-box:${file.relativePath}`, file.relativePath, null, "A CropBox is declared. Content outside the crop is not treated as read."));
    }
    if (file.indirectBoxesUnresolved) {
      contentIssues.push(contentIssue(`indirect-box:${file.relativePath}`, file.relativePath, null, "MediaBox or CropBox is an indirect object and was not geometrically compared."));
    }
  }
  for (const page of pages) {
    if (page.captureClass === "empty_measured") {
      contentIssues.push(contentIssue(`empty:${page.sha256}:${page.pageNumber}`, page.relativePath, page.pageNumber, "empty_page"));
    }
    if (page.captureClass === "failed") {
      contentIssues.push(contentIssue(`page-failed:${page.sha256}:${page.pageNumber}`, page.relativePath, page.pageNumber, "page_extraction_failed"));
    }
    if (page.captureClass === "partial_visual_unavailable") {
      contentIssues.push(contentIssue(`visual:${page.sha256}:${page.pageNumber}`, page.relativePath, page.pageNumber, "visual_measurement_unavailable"));
    }
    if ((page.unresolvedCount || 0) > 0) {
      contentIssues.push(contentIssue(`ink:${page.sha256}:${page.pageNumber}`, page.relativePath, page.pageNumber, `${page.unresolvedCount} cells still have unread lettering after classification`));
    }
    if ((page.flags || []).includes("low_text_high_ink")) {
      contentIssues.push(contentIssue(`low-text:${page.sha256}:${page.pageNumber}`, page.relativePath, page.pageNumber, "low text coverage with substantial ink"));
    }
  }
  for (const sheet of snapshot.unmatchedSheets || []) {
    contentIssues.push(contentIssue(`sheet-without-file:${sheet.sheetNumber}`, null, null, `Analyzed sheet ${sheet.sheetNumber} has no source file match.`));
  }
  for (const file of snapshot.unmatchedFiles || []) {
    contentIssues.push(contentIssue(`file-without-sheet:${file.relativePath}`, file.relativePath, null, "Source PDF has no analyzed sheet identity."));
  }
  for (const mapping of mappings) {
    if (mapping.matchResult === "unmapped") {
      contentIssues.push(contentIssue(`finding-unmapped:${mapping.clientReportId}`, mapping.relativePath || null, null, `Finding ${mapping.clientReportId} is not linked to a source file.`));
    }
    if (mapping.duplicateFileMatch) {
      contentIssues.push(contentIssue(`finding-ambiguous:${mapping.clientReportId}`, null, null, `Finding ${mapping.clientReportId} matches more than one source file.`));
    }
  }

  const accountabilityPassed = issues.length === 0;
  const graphicReadingPerformed = Boolean(snapshot.ocrAttempted);
  const contentComplete = false;
  return {
    accountabilityPassed,
    contentComplete,
    graphicReadingPerformed,
    precision: NOT_MEASURED,
    recall: NOT_MEASURED,
    precisionReason: "Published findings are model output. They are not verified labels, so precision is not measured.",
    recallReason: "No independent review has recorded missed issues, so recall is not measured.",
    accountabilityIssues: issues,
    contentIssues,
    counts: {
      files: files.length,
      pdfFiles: files.filter((file) => file.format === "pdf").length,
      pdfPages: pages.length,
      unresolvedRegions: regions.length,
      classifiedCells: (snapshot.cells || []).length,
      findings: findings.length,
      mappings: mappings.length,
    },
  };
}

function issue(id, severity, message) {
  return { id, severity, blocksAcceptance: true, message };
}

function contentIssue(id, relativePath, pageNumber, message) {
  return { id, severity: "content", blocksAcceptance: false, blocksCompleteness: true, relativePath, pageNumber, message };
}

export function renderCoverageReport(report) {
  const lines = [];
  lines.push("# Drawing dataset coverage");
  lines.push("");
  lines.push(`Accountability: ${report.assessment.accountabilityPassed ? "PASS" : "FAIL"}`);
  lines.push(`Content completeness: ${report.assessment.contentComplete ? "COMPLETE" : "NOT COMPLETE"}`);
  lines.push(`Precision: ${report.assessment.precision}`);
  lines.push(`Recall: ${report.assessment.recall}`);
  lines.push("");
  lines.push(report.assessment.precisionReason);
  lines.push(report.assessment.recallReason);
  lines.push("");
  lines.push(report.productionNote || "Outlined CAD lettering is recovered only by local OCR. OCR is visual interpretation, not verified ground truth.");
  lines.push("Every ink cell is classified. Linework and fill are not assumed to be missing text. Remaining unread cells are mixed-graphics cells where OCR returned no lettering.");
  if (report.classification) {
    lines.push("");
    lines.push("## Cell classification");
    lines.push("");
    lines.push(JSON.stringify(report.classification));
  }
  if (report.grounding) {
    lines.push("");
    lines.push("## Finding evidence matches");
    lines.push("");
    lines.push(JSON.stringify(report.grounding));
  }
  if (report.identities) {
    lines.push("");
    lines.push("## S-204.00 and S-300.00");
    lines.push("");
    lines.push(JSON.stringify(report.identities));
  }
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  for (const [key, value] of Object.entries(report.counts || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Reconciliation");
  lines.push("");
  lines.push(report.reconciliationSummary || "");
  lines.push("");
  lines.push("## Accountability issues");
  lines.push("");
  if (!report.assessment.accountabilityIssues.length) lines.push("None.");
  for (const item of report.assessment.accountabilityIssues) lines.push(`- ${item.message}`);
  lines.push("");
  lines.push("## Content gaps");
  lines.push("");
  if (!report.assessment.contentIssues.length) lines.push("None.");
  for (const item of report.assessment.contentIssues) {
    const where = [item.relativePath, item.pageNumber ? `page ${item.pageNumber}` : null].filter(Boolean).join(" ");
    lines.push(`- ${where ? `${where}: ` : ""}${item.message}`);
  }
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push("| File | Status | Pages | Text chars | Unresolved ink cells | Sheet match |");
  lines.push("| --- | --- | ---: | ---: | ---: | --- |");
  for (const file of report.files || []) {
    lines.push(`| ${file.relativePath} | ${file.processingStatus} | ${file.pageCount ?? ""} | ${file.textChars ?? ""} | ${file.unresolvedCount ?? ""} | ${file.sheetMatch || ""} |`);
  }
  lines.push("");
  lines.push("Cell coordinates are in unresolved-regions.jsonl. Extracted sheet text is in the per-file page JSON under this output directory and is not copied into this summary.");
  lines.push("");
  return lines.join("\n");
}
