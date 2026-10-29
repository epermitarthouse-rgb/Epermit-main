/**
 * Offline dataset build for one drawing set and one frozen findings fixture.
 * Does not call a model, write to Supabase, or change stored findings.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assessDataset, renderCoverageReport } from "./acceptance.mjs";
import {
  applyTitleBlockConfirmation,
  canonicalSheetKey,
  matchSourceFiles,
  titleBlockTokens,
  upgradeUnmatchedFromTitleBlock,
} from "./identity.mjs";
import { classifyZipMember, inventorySource } from "./inventory.mjs";
import { extractPdfFile, VISUAL_GRID } from "./pdfExtract.mjs";

export const DATASET_VERSION = "phase2a1.v1";
export const EXTRACTOR_VERSION = "phase2a1.extract.1";

const require = createRequire(import.meta.url);
const drawingStructure = require("../../../scraper-service/app/services/compliance/rag/drawingStructureV2.js");

export const BASELINE_RUN = {
  id: "649fdaa6-14b9-45b9-bd62-695166363f75",
  shortId: "649fdaa6",
  jurisdiction: "Washington D.C. (12A DCMR)",
  codeEdition: "2017",
  codeContext: "2017 DC Construction Codes (2015 IBC base)",
  projectType: "Commercial (General)",
  publishedFindings: 252,
  analyzedIdentityCountInFixture: 82,
};

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function wordingRecord(finding) {
  return {
    clientReportId: finding.clientReportId,
    sourceFinding: finding.sourceFinding,
    severity: finding.severity,
    discipline: finding.discipline,
    sheetNumber: finding.sheetNumber,
    sheetTitle: finding.sheetTitle,
    title: finding.title,
    observation: finding.observation,
    drawingEvidence: finding.drawingEvidence,
    drawingLocation: finding.drawingLocation,
    codeReference: finding.codeReference,
    recommendation: finding.recommendation,
  };
}

export function wordingSha256(finding) {
  return sha256Text(JSON.stringify(wordingRecord(finding)));
}

export function parseBenchmarkCases(source) {
  const parts = String(source).split(/\n\s*id:\s*"/).slice(1);
  return parts.map((part) => {
    const id = part.slice(0, part.indexOf('"'));
    const grab = (key) => {
      const match = part.match(new RegExp(`${key}:\\s*"([^"]*)"`));
      return match ? match[1] : null;
    };
    const report = part.match(/reportId:\s*"([^"]+)"/);
    return {
      id,
      truth: grab("truth"),
      expected: grab("expected"),
      use: grab("use"),
      topic: grab("topic"),
      summary: grab("summary"),
      reportId: report ? report[1] : null,
      labelStatus: grab("truth") === "verified" ? "verified_regression" : "provisional_review_candidate",
    };
  }).filter((item) => item.truth === "verified" || item.truth === "provisional");
}

export function structurePage(input) {
  const document = drawingStructure.buildDrawingDocument(input);
  if (document?.extraction) delete document.extraction.last_attempt_at;
  const validation = drawingStructure.validateDrawingDocument(document);
  return {
    origin: "machine_extracted",
    interpretation: "structured_from_text_layer_only",
    independentlyVerified: false,
    validationOk: validation.ok,
    validationErrors: validation.errors,
    document,
  };
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function groundEvidence(evidence, pageTexts) {
  const needle = normalizeSearch(evidence);
  if (needle.length < 12) return { status: "not_checked", method: "normalized_substring", reason: "evidence_too_short" };
  for (const page of pageTexts) {
    const haystack = normalizeSearch(page.text);
    if (haystack.includes(needle)) {
      return { status: "span_found", method: "full_normalized_span", pageNumber: page.pageNumber };
    }
  }
  const words = needle.split(" ").filter((word) => word.length > 2);
  if (words.length >= 4) {
    const window = words.slice(0, 6).join(" ");
    for (const page of pageTexts) {
      if (normalizeSearch(page.text).includes(window)) {
        return { status: "partial_span", method: "leading_words", pageNumber: page.pageNumber };
      }
    }
  }
  return { status: "span_not_in_extracted_text", method: "normalized_substring", pageNumber: null };
}

function identitiesFromFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = `${finding.sheetNumber}\u0000${finding.sheetTitle}`;
    if (!groups.has(key)) {
      groups.set(key, {
        sheetNumber: finding.sheetNumber,
        sheetTitle: finding.sheetTitle,
        discipline: finding.discipline,
        findingCount: 0,
      });
    }
    groups.get(key).findingCount += 1;
  }
  return [...groups.values()];
}

function publicPage(file, page) {
  return {
    sha256: file.sha256,
    relativePath: file.relativePath,
    pageNumber: page.pageNumber,
    outcome: page.outcome,
    captureClass: page.captureClass,
    textChars: page.textChars,
    textItemCount: page.textItemCount,
    inkRatio: page.inkRatio,
    visualStatus: page.visualStatus,
    unresolvedCount: (page.unresolvedRegions || []).length,
    flags: page.flags || [],
    codeReferenceCount: page.codeReferenceCount || 0,
    dateSpanCount: page.dateSpanCount || 0,
    annotationCount: page.annotationCount || 0,
  };
}

function sheetMatchLabel(match) {
  if (!match) return "";
  if (!match.sheetNumber) return match.method;
  return `${match.sheetNumber} (${match.method})`;
}

export async function buildDrawingDataset(options) {
  const onProgress = options.onProgress || (() => {});
  const inventory = await inventorySource(options.sourceDir);
  const findingsRaw = JSON.parse(await readFile(options.findingsPath, "utf8"));
  const findings = findingsRaw.findings || [];
  const fixtureHashBefore = sha256Text(await readFile(options.findingsPath));
  const benchmarkSource = await readFile(options.benchmarkPath, "utf8");
  const benchmarkCases = parseBenchmarkCases(benchmarkSource);
  const identities = identitiesFromFindings(findings);
  const pdfs = inventory.files.filter((file) => file.format === "pdf" && file.sha256 && !file.duplicateOf);
  const duplicatePdfs = inventory.files.filter((file) => file.format === "pdf" && file.duplicateOf);

  await mkdir(options.outDir, { recursive: true });
  const cacheDir = path.join(options.outDir, "files");
  await mkdir(cacheDir, { recursive: true });

  const extractedByHash = new Map();
  for (const file of pdfs) {
    const cachePath = path.join(cacheDir, `${file.sha256}.json`);
    if (!options.force) {
      try {
        const cached = JSON.parse(await readFile(cachePath, "utf8"));
        if (cached.extractorVersion === EXTRACTOR_VERSION && cached.sha256 === file.sha256) {
          extractedByHash.set(file.sha256, cached);
          file.processingStatus = cached.openStatus === "opened" ? "extracted" : cached.openStatus === "password_protected" ? "password_protected" : "extract_failed";
          file.pageCount = cached.pageCount;
          file.boxScan = cached.boxScan;
          onProgress({ relativePath: file.relativePath, status: "cached" });
          continue;
        }
      } catch {
        // Cache miss is the normal first-run path.
      }
    }
    onProgress({ relativePath: file.relativePath, status: "extracting" });
    let extracted;
    try {
      extracted = await extractPdfFile(file.absolutePath || path.join(options.sourceDir, file.relativePath));
    } catch (error) {
      extracted = {
        openStatus: "unreadable",
        error: { errorClass: error?.name || "Error", message: String(error?.message || error).slice(0, 240) },
        pageCount: null,
        metadata: {},
        boxScan: null,
        pages: [],
      };
    }
    for (const page of extracted.pages || []) {
      const structured = structureSafe({
        sourceFingerprint: file.sha256,
        documentId: file.sha256,
        fileName: file.filename,
        sheetNumber: canonicalSheetKey(file.filename).raw,
        pageNumber: page.pageNumber,
        pageText: page.pageText,
        graphicalReadStatus: "text-layer",
        evidenceItems: (page.items || []).map((item) => ({
          str: item.text,
          extractionMethod: "pdfjs-text-layer",
          region: {
            x: item.x,
            y: item.y,
            width: item.w,
            height: item.h,
            unit: "pdf-point",
            origin: "bottom-left",
            pageWidth: item.pageWidth,
            pageHeight: item.pageHeight,
          },
        })),
        regions: [],
      });
      page.structure = {
        origin: structured.origin,
        interpretation: structured.interpretation,
        independentlyVerified: false,
        validationOk: structured.validationOk,
        validationErrors: structured.validationErrors,
        extractionStatus: structured.document?.extraction?.status || null,
        factCounts: factCounts(structured.document),
      };
      page.structuredDocument = structured.document;
    }
    const record = {
      extractorVersion: EXTRACTOR_VERSION,
      sha256: file.sha256,
      relativePath: file.relativePath,
      openStatus: extracted.openStatus,
      error: extracted.error,
      pageCount: extracted.pageCount,
      metadata: extracted.metadata,
      boxScan: extracted.boxScan,
      pages: extracted.pages,
    };
    await writeFile(cachePath, JSON.stringify(record));
    extractedByHash.set(file.sha256, record);
    file.processingStatus = extracted.openStatus === "opened" ? "extracted" : extracted.openStatus === "password_protected" ? "password_protected" : "extract_failed";
    file.pageCount = extracted.pageCount;
    file.boxScan = extracted.boxScan;
    if (extracted.openStatus !== "opened") file.error = extracted.error;
  }

  for (const file of duplicatePdfs) {
    file.processingStatus = "duplicate_of";
    const primary = extractedByHash.get(file.sha256);
    file.pageCount = primary?.pageCount ?? null;
  }

  const fileMatches = matchSourceFiles(
    inventory.files.filter((file) => file.format === "pdf"),
    identities,
  );
  const groups = identitiesFromGroups(identities);
  const confirmed = fileMatches.fileMatches.map((match) => {
    const file = inventory.files.find((item) => item.relativePath === match.relativePath);
    const extracted = file?.sha256 ? extractedByHash.get(file.sha256) : null;
    const first = extracted?.pages?.[0];
    const tokens = first?.items
      ? titleBlockTokens(first.items, first.pageWidth, first.pageHeight)
      : [];
    const withTokens = applyTitleBlockConfirmation(match, tokens);
    return upgradeUnmatchedFromTitleBlock(withTokens, groups);
  });

  const matchByPath = new Map(confirmed.map((match) => [match.relativePath, match]));
  const pages = [];
  const unresolvedRegions = [];
  for (const file of inventory.files) {
    if (file.format !== "pdf" || !file.sha256) continue;
    if (file.duplicateOf) continue;
    const extracted = extractedByHash.get(file.sha256);
    for (const page of extracted?.pages || []) {
      const summary = publicPage(file, page);
      pages.push(summary);
      for (const region of page.unresolvedRegions || []) {
        unresolvedRegions.push({
          sha256: file.sha256,
          relativePath: file.relativePath,
          pageNumber: page.pageNumber,
          cell: region.cell,
          inkRatio: region.inkRatio,
          reason: region.reason,
          interpretation: "unresolved",
        });
      }
    }
  }

  const textsBySheet = new Map();
  for (const match of confirmed) {
    if (!match.sheetNumber) continue;
    const file = inventory.files.find((item) => item.relativePath === match.relativePath);
    const extracted = file?.sha256 ? extractedByHash.get(file.sha256) : null;
    const texts = (extracted?.pages || []).map((page) => ({ pageNumber: page.pageNumber, text: page.pageText || "" }));
    if (!textsBySheet.has(match.sheetNumber)) textsBySheet.set(match.sheetNumber, []);
    textsBySheet.get(match.sheetNumber).push({
      relativePath: match.relativePath,
      sha256: file?.sha256 || null,
      method: match.method,
      duplicateOf: file?.duplicateOf || null,
      texts,
    });
  }

  const caseByReport = new Map(benchmarkCases.filter((item) => item.reportId).map((item) => [item.reportId, item]));
  const mappings = findings.map((finding) => {
    const original = wordingRecord(finding);
    const links = collapseSameHash(textsBySheet.get(finding.sheetNumber) || []);
    const link = links.length === 1 ? links[0] : null;
    const grounding = link
      ? groundEvidence(finding.drawingEvidence, link.texts)
      : { status: links.length > 1 ? "ambiguous_source_file" : "source_unmapped", method: "sheet_identity", pageNumber: null };
    const overlay = caseByReport.get(finding.clientReportId) || null;
    return {
      clientReportId: finding.clientReportId,
      sourceFinding: finding.sourceFinding,
      wordingSha256: wordingSha256(finding),
      wordingMatchesFixture: true,
      original,
      labelStatus: "unverified_model_output",
      benchmarkOverlay: overlay
        ? {
          caseId: overlay.id,
          truth: overlay.truth,
          use: overlay.use,
          labelStatus: overlay.labelStatus,
          note: "Overlay points at the existing benchmark. It does not change the finding wording.",
        }
        : null,
      sheetNumber: finding.sheetNumber,
      sheetTitle: finding.sheetTitle,
      discipline: finding.discipline,
      severity: finding.severity,
      codeEdition: BASELINE_RUN.codeEdition,
      matchResult: link ? "mapped" : links.length > 1 ? "ambiguous" : "unmapped",
      duplicateFileMatch: links.length > 1,
      matchMethod: link?.method || null,
      relativePath: link?.relativePath || null,
      sha256: link?.sha256 || null,
      grounding: {
        ...grounding,
        note: "Machine check against the text layer only. Not a verified label.",
      },
    };
  });

  const fixtureHashAfter = sha256Text(await readFile(options.findingsPath));
  if (fixtureHashBefore !== fixtureHashAfter) {
    throw new Error("Findings fixture changed during the build. The build does not write that file.");
  }

  const unmatchedFiles = confirmed
    .filter((match) => !match.sheetNumber)
    .map((match) => ({ relativePath: match.relativePath, method: match.method }));
  const assessmentInput = {
    walkedFiles: inventory.walkedFiles,
    files: inventory.files.map((file) => ({
      relativePath: file.relativePath,
      sha256: file.sha256,
      format: file.format,
      bytes: file.bytes,
      processingStatus: file.processingStatus,
      pageCount: file.pageCount ?? null,
      duplicateOf: file.duplicateOf || null,
      cropBoxPresent: Boolean(file.boxScan?.cropBoxPresent),
      indirectBoxesUnresolved: Boolean(file.boxScan?.indirectBoxesUnresolved),
    })),
    pages,
    unresolvedRegions,
    findings: findings.map((finding) => ({ clientReportId: finding.clientReportId })),
    mappings,
    unmatchedSheets: fileMatches.unmatchedSheets,
    unmatchedFiles,
  };
  if (options.requireBaselineCounts) {
    if (findings.length !== BASELINE_RUN.publishedFindings) {
      assessmentInput.findings = findings.map((finding) => ({ clientReportId: finding.clientReportId }));
    }
  }
  const assessment = assessDataset(assessmentInput);
  if (options.requireBaselineCounts && findings.length !== BASELINE_RUN.publishedFindings) {
    assessment.accountabilityPassed = false;
    assessment.accountabilityIssues.push({
      id: "baseline-finding-count",
      severity: "accountability",
      blocksAcceptance: true,
      message: `Fixture has ${findings.length} findings; baseline run expects ${BASELINE_RUN.publishedFindings}.`,
    });
  }
  if (options.requireBaselineCounts && identities.length !== BASELINE_RUN.analyzedIdentityCountInFixture) {
    assessment.accountabilityPassed = false;
    assessment.accountabilityIssues.push({
      id: "baseline-identity-count",
      severity: "accountability",
      blocksAcceptance: true,
      message: `Fixture has ${identities.length} sheet identities; baseline run expects ${BASELINE_RUN.analyzedIdentityCountInFixture}.`,
    });
  }
  if (!assessment.accountabilityPassed) assessment.contentComplete = false;

  const sharedTitles = confirmed.filter((match) => match.identityCount > 1);
  const zipMembers = inventory.files
    .filter((file) => file.format === "zip")
    .flatMap((file) => (file.zipEntries || []).map((entry) => ({
      container: file.relativePath,
      name: entry.name,
      uncompressedSize: entry.uncompressedSize,
      encrypted: entry.encrypted,
      memberClass: classifyZipMember(entry.name),
    })));
  const siblingPdfNames = new Set(
    inventory.files
      .filter((file) => file.format === "pdf")
      .map((file) => file.filename.replace(/\s+/g, "").toLowerCase()),
  );
  const zipPdfMembers = zipMembers.filter((entry) => entry.memberClass === "pdf_member");
  const zipOnlyNames = zipPdfMembers
    .map((entry) => entry.name.split("/").pop().replace(/\s+/g, "").toLowerCase())
    .filter((name) => !siblingPdfNames.has(name));
  const reconciliationSummary = [
    `Source files walked: ${inventory.walkedFiles}.`,
    `PDF files: ${inventory.counts.pdf}. Zip files: ${inventory.counts.zip}. Other files: ${inventory.counts.other}.`,
    `Published finding identities (sheet number + title): ${identities.length}. Unique sheet numbers: ${fileMatches.sheetGroups}.`,
    `PDF files matched to a sheet number: ${confirmed.filter((match) => match.sheetNumber).length}.`,
    `PDF files with no analyzed sheet: ${unmatchedFiles.length}.`,
    `Analyzed sheet numbers with no source file: ${fileMatches.unmatchedSheets.length}.`,
    `Sheet numbers that share one file across more than one title: ${sharedTitles.length}.`,
    `Zip members: ${zipMembers.length}. PDF members: ${zipPdfMembers.length}. AppleDouble sidecars: ${zipMembers.filter((entry) => entry.memberClass === "appledouble_sidecar").length}. PDF member names absent from the directory: ${zipOnlyNames.length}.`,
    "Zip member names are not a byte-for-byte proof that the archive matches the loose PDFs.",
    "A filename that is itself a sheet id is not reassigned when title-block text names a different sheet.",
    "The prior run's 82 count is the published sheet-and-title identity count. It is not assumed to equal the number of files in the directory.",
  ].join(" ");

  const fileRows = inventory.files.map((file) => {
    const related = pages.filter((page) => page.sha256 === file.sha256 && page.relativePath === file.relativePath);
    const match = matchByPath.get(file.relativePath);
    return {
      relativePath: file.relativePath,
      filename: file.filename,
      format: file.format,
      bytes: file.bytes,
      sha256: file.sha256,
      processingStatus: file.processingStatus,
      pageCount: file.pageCount ?? null,
      textChars: related.reduce((sum, page) => sum + (page.textChars || 0), 0),
      unresolvedCount: related.reduce((sum, page) => sum + (page.unresolvedCount || 0), 0),
      sheetMatch: sheetMatchLabel(match),
      duplicateOf: file.duplicateOf,
      duplicateFilename: file.duplicateFilename,
      zipEntryCount: (file.zipEntries || []).length,
      error: file.error || null,
    };
  });

  const report = {
    datasetVersion: DATASET_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    baselineRun: BASELINE_RUN,
    visualGrid: VISUAL_GRID,
    graphicReading: "not_performed",
    labelPolicy: "AI findings, reviewer decisions, and external AI qualifications are not professionally verified ground truth.",
    precision: assessment.precision,
    recall: assessment.recall,
    assessment,
    counts: {
      ...inventory.counts,
      walkedFiles: inventory.walkedFiles,
      emptyDirectories: inventory.emptyDirectories.length,
      pdfPages: pages.length,
      unresolvedInkCells: unresolvedRegions.length,
      findings: findings.length,
      analyzedIdentities: identities.length,
      uniqueSheetNumbers: fileMatches.sheetGroups,
      mappedFindings: mappings.filter((mapping) => mapping.matchResult === "mapped").length,
      unmappedFindings: mappings.filter((mapping) => mapping.matchResult === "unmapped").length,
      ambiguousFindings: mappings.filter((mapping) => mapping.matchResult === "ambiguous").length,
    },
    reconciliationSummary,
    duplicateGroups: inventory.duplicateGroups,
    duplicateNames: inventory.duplicateNames,
    emptyDirectories: inventory.emptyDirectories,
    unmatchedSheets: fileMatches.unmatchedSheets,
    unmatchedFiles,
    fileMatches: confirmed,
    files: fileRows,
    zipEntries: inventory.files
      .filter((file) => file.format === "zip")
      .map((file) => ({
        relativePath: file.relativePath,
        sha256: file.sha256,
        bytes: file.bytes,
        parsed: file.processingStatus === "container_indexed",
        entries: (file.zipEntries || []).map((entry) => ({
          name: entry.name,
          uncompressedSize: entry.uncompressedSize,
          encrypted: entry.encrypted,
          directory: entry.directory,
        })),
      })),
  };

  const independentReview = {
    status: "not_started",
    verifiedMissedIssues: [],
    instructions: "Append only issues a person has confirmed on the drawings. Do not copy model output or external AI notes into this list. Recall stays Not measured while this list is empty.",
  };

  const regression = {
    precision: "Not measured",
    recall: "Not measured",
    source: "src/lib/supabaseAnalyzer/qualityBenchmark.ts",
    verifiedRegression: benchmarkCases.filter((item) => item.use === "regression"),
    provisionalReviewCandidates: benchmarkCases.filter((item) => item.use === "provisional"),
    note: "These cases are the existing benchmark. Provisional cases are review candidates, not verified errors.",
  };

  await writeFile(path.join(options.outDir, "inventory.json"), JSON.stringify({
    datasetVersion: DATASET_VERSION,
    walkedFiles: inventory.walkedFiles,
    counts: inventory.counts,
    emptyDirectories: inventory.emptyDirectories,
    duplicateGroups: inventory.duplicateGroups,
    duplicateNames: inventory.duplicateNames,
    files: fileRows,
  }, null, 2));
  await writeFile(path.join(options.outDir, "pages-manifest.json"), JSON.stringify(pages, null, 2));
  await writeFile(path.join(options.outDir, "unresolved-regions.jsonl"), unresolvedRegions.map((region) => JSON.stringify(region)).join("\n") + (unresolvedRegions.length ? "\n" : ""));
  await writeFile(path.join(options.outDir, "finding-map.json"), JSON.stringify({
    datasetVersion: DATASET_VERSION,
    baselineRunId: BASELINE_RUN.id,
    labelPolicy: report.labelPolicy,
    precision: "Not measured",
    recall: "Not measured",
    findings: mappings,
  }, null, 2));
  await writeFile(path.join(options.outDir, "regression-cases.json"), JSON.stringify(regression, null, 2));
  await writeFile(path.join(options.outDir, "independent-review.json"), JSON.stringify(independentReview, null, 2));
  await writeFile(path.join(options.outDir, "acceptance.json"), JSON.stringify(assessment, null, 2));
  await writeFile(path.join(options.outDir, "coverage-report.md"), renderCoverageReport(report));
  await writeFile(path.join(options.outDir, "zip-members.json"), JSON.stringify({
    members: zipMembers,
    pdfMemberNamesAbsentFromDirectory: zipOnlyNames,
    note: "Members were listed from the zip central directory and were not extracted.",
  }, null, 2));
  await writeFile(path.join(options.outDir, "reconciliation.json"), JSON.stringify({
    summary: reconciliationSummary,
    fileMatches: confirmed,
    unmatchedSheets: fileMatches.unmatchedSheets,
    unmatchedFiles,
  }, null, 2));
  return { report, assessment, outDir: options.outDir };
}

function collapseSameHash(links) {
  const hashes = new Set(links.map((link) => link.sha256).filter(Boolean));
  if (hashes.size === 1) {
    const primary = links.find((link) => !link.duplicateOf) || links[0];
    return [primary];
  }
  return links;
}

function structureSafe(input) {
  try {
    return structurePage(input);
  } catch (error) {
    return {
      origin: "machine_extracted",
      interpretation: "structured_from_text_layer_only",
      independentlyVerified: false,
      validationOk: false,
      validationErrors: [String(error?.message || error).slice(0, 240)],
      document: null,
    };
  }
}

function factCounts(document) {
  if (!document) return null;
  return {
    elements: (document.elements || []).length,
    dimensions: (document.dimensions || []).length,
    notes: (document.notes || []).length,
    schedules: (document.schedules || []).length,
    calculations: (document.calculations || []).length,
    drawingReferences: (document.drawing_references || []).length,
    relationships: (document.relationships || []).length,
    evidence: (document.evidence || []).length,
  };
}

function identitiesFromGroups(identities) {
  const groups = [];
  const bySheet = new Map();
  for (const identity of identities) {
    if (!bySheet.has(identity.sheetNumber)) {
      const group = {
        sheetNumber: identity.sheetNumber,
        key: canonicalSheetKey(identity.sheetNumber),
        identities: [],
      };
      bySheet.set(identity.sheetNumber, group);
      groups.push(group);
    }
    bySheet.get(identity.sheetNumber).identities.push(identity);
  }
  return groups;
}
