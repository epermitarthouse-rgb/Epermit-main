/**
 * Phase 2A.2 recovery over a Phase 2A.1 dataset. Does not rewrite findings wording,
 * call a model, or write to Supabase.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assessDataset, renderCoverageReport } from "./acceptance.mjs";
import { classifyPageCells, GRID_COLS, GRID_ROWS } from "./cellClassify.mjs";
import { BASELINE_RUN, groundEvidence, structurePage, wordingRecord } from "./buildDataset.mjs";
import { recoverPdfFile, RECOVERY_VERSION } from "./ocrRecover.mjs";
import { canonicalSheetKey, titleBlockTokens } from "./identity.mjs";

export const DATASET_VERSION = "phase2a2.v1";

function sourcePath(sourceDir, relativePath) {
  return path.join(sourceDir, relativePath);
}

function ocrPageText(page) {
  return (page.lines || []).map((line) => line.text).join("\n");
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "sheet", "note", "visible", "section", "drawing", "plan"]);

function distinctiveTokens(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")
    .filter((word) => word.length > 3 && !STOP.has(word));
}

function tokenOverlap(evidence, pages) {
  const tokens = distinctiveTokens(evidence);
  if (tokens.length < 3) return { status: "too_few_tokens", hits: 0, total: tokens.length, pageNumber: null };
  let best = { hits: 0, matched: [], pageNumber: null };
  for (const page of pages) {
    const hay = distinctiveTokens(page.text).join(" ");
    const matched = tokens.filter((token) => hay.includes(token));
    if (matched.length > best.hits) best = { hits: matched.length, matched, pageNumber: page.pageNumber };
  }
  return { ...best, total: tokens.length, ratio: best.hits / tokens.length };
}

export function groundRecovered(evidence, textPages, ocrPages) {
  const text = groundEvidence(evidence, textPages);
  const ocr = groundEvidence(evidence, ocrPages.map((page) => ({ pageNumber: page.pageNumber, text: ocrPageText(page) })));
  if (text.status === "span_found" || text.status === "partial_span") {
    return { ...text, origin: "machine_extracted", independentlyVerified: false, ocrStatus: ocr.status };
  }
  if (ocr.status === "span_found" || ocr.status === "partial_span") {
    return {
      status: ocr.status === "span_found" ? "span_found_ocr" : "partial_span_ocr",
      method: ocr.method,
      pageNumber: ocr.pageNumber,
      origin: "visual_interpretation",
      independentlyVerified: false,
      note: "Match is against OCR lettering, not the PDF text layer, and is not a verified label.",
    };
  }
  const overlap = tokenOverlap(evidence, [
    ...textPages,
    ...ocrPages.map((page) => ({ pageNumber: page.pageNumber, text: ocrPageText(page) })),
  ]);
  if (overlap.hits >= 3 && overlap.ratio >= 0.4) {
    return {
      status: "token_overlap",
      method: "distinctive_tokens",
      pageNumber: overlap.pageNumber,
      origin: "unverified_inference",
      independentlyVerified: false,
      tokenHits: overlap.hits,
      tokenTotal: overlap.total,
      note: "Some distinctive words from the finding appear on the sheet. That is not a quoted span and is not a verified label.",
    };
  }
  return { ...text, origin: null, independentlyVerified: false, ocrStatus: ocr.status, tokenHits: overlap.hits, tokenTotal: overlap.total };
}

function specialIdentities(recon, recoveredByPath) {
  const s204 = recon.fileMatches.find((match) => match.relativePath === "S-204.00.pdf");
  const s300 = recon.fileMatches.find((match) => match.relativePath === "S-300.00.pdf");
  const s300Rec = recoveredByPath.get("S-300.00.pdf");
  return {
    s204: {
      relativePath: "S-204.00.pdf",
      matchMethod: s204?.method || null,
      sheetNumber: s204?.sheetNumber || null,
      identityCount: s204?.identityCount || 0,
      note: "One file carries two published titles for sheet S-204.00. They are not merged.",
    },
    s300: {
      relativePath: "S-300.00.pdf",
      matchMethod: s300?.method || null,
      sheetNumber: s300?.sheetNumber || null,
      titleBlockStatus: s300?.titleBlockStatus || null,
      titleBlockTokens: s300?.titleBlockTokens || [],
      recoveredSheetTokens: s300Rec?.pages?.[0]?.sheetTokens || [],
      note: "Filename is a sheet id with no published finding identity. Title-block text naming another sheet does not reassign the file.",
    },
  };
}

export async function recoverDrawingDataset(options) {
  const onProgress = options.onProgress || (() => {});
  const inventory = JSON.parse(await readFile(path.join(options.outDir, "inventory.json"), "utf8"));
  const recon = JSON.parse(await readFile(path.join(options.outDir, "reconciliation.json"), "utf8"));
  const findingMap = JSON.parse(await readFile(path.join(options.outDir, "finding-map.json"), "utf8"));
  const recoveryDir = path.join(options.outDir, "recovery");
  await mkdir(recoveryDir, { recursive: true });

  const pdfs = inventory.files.filter((file) => file.format === "pdf" && file.sha256 && file.processingStatus === "extracted");
  const selected = options.limit ? pdfs.slice(0, options.limit) : pdfs;
  const recoveredByHash = new Map();

  for (const file of selected) {
    const cachePath = path.join(recoveryDir, `${file.sha256}.json`);
    if (!options.force) {
      try {
        const cached = JSON.parse(await readFile(cachePath, "utf8"));
        if (cached.recoveryVersion === RECOVERY_VERSION && cached.sha256 === file.sha256) {
          recoveredByHash.set(file.sha256, cached);
          onProgress({ relativePath: file.relativePath, status: "cached" });
          continue;
        }
      } catch {
        // First recovery pass.
      }
    }
    onProgress({ relativePath: file.relativePath, status: "recovering" });
    const recovered = await recoverPdfFile(sourcePath(options.sourceDir, file.relativePath), options);
    const record = { ...recovered, sha256: file.sha256, relativePath: file.relativePath };
    await writeFile(cachePath, JSON.stringify(record));
    recoveredByHash.set(file.sha256, record);
  }

  const extractedDir = path.join(options.outDir, "files");
  const cells = [];
  const remainingUnread = [];
  const pages = [];
  const recoveredByPath = new Map();

  for (const file of pdfs) {
    const extracted = JSON.parse(await readFile(path.join(extractedDir, `${file.sha256}.json`), "utf8"));
    const recovered = recoveredByHash.get(file.sha256);
    recoveredByPath.set(file.relativePath, recovered);
    const pageSummaries = [];
    for (const page of extracted.pages || []) {
      const recPage = recovered?.pages?.find((item) => item.pageNumber === page.pageNumber) || null;
      const classified = recPage
        ? classifyPageCells({
          rasterCells: recPage.rasterCells,
          textItems: page.items || [],
          ocrWords: recPage.words || [],
          pageWidth: page.pageWidth,
          pageHeight: page.pageHeight,
          ocrAttempted: Boolean(recPage.ocrAttempted),
        })
        : [];
      const unread = classified.filter((cell) => cell.remainingUnread);
      const structured = structurePage({
        sourceFingerprint: file.sha256,
        documentId: file.sha256,
        fileName: file.filename,
        sheetNumber: canonicalSheetKey(file.filename).raw,
        pageNumber: page.pageNumber,
        pageText: [page.pageText || "", recPage ? ocrPageText(recPage) : ""].filter(Boolean).join("\n"),
        graphicalReadStatus: recPage?.ocrAttempted ? "ocr" : "text-layer",
        evidenceItems: (page.items || []).map((item) => ({
          str: item.text,
          extractionMethod: "pdfjs-text-layer",
          region: { x: item.x, y: item.y, width: item.w, height: item.h, unit: "pdf-point", origin: "bottom-left", pageWidth: item.pageWidth, pageHeight: item.pageHeight },
        })),
        words: (recPage?.words || []).map((word) => ({
          text: word.text,
          confidence: word.confidence,
          box: word.box,
          rotated: Boolean(word.vertical),
        })),
        regions: unread.map((cell) => ({
          readable: false,
          limitations: "lettering_not_read",
          x: cell.col,
          y: cell.row,
          width: 1,
          height: 1,
          unit: "ink-cell",
        })),
      });
      if (structured.document?.extraction) delete structured.document.extraction.last_attempt_at;
      pageSummaries.push({
        sha256: file.sha256,
        relativePath: file.relativePath,
        pageNumber: page.pageNumber,
        outcome: page.outcome,
        captureClass: unread.length ? "partial_lettering_unread" : recPage?.ocrAttempted ? "graphics_classified" : page.captureClass,
        textChars: page.textChars,
        ocrChars: recPage?.ocrChars || 0,
        ocrLines: recPage?.ocrLineCount || 0,
        ocrAttempted: Boolean(recPage?.ocrAttempted),
        operators: recPage?.operators || null,
        remainingUnread: unread.length,
        cellCount: classified.length,
        flags: page.flags || [],
        structureFactCounts: structured.document ? {
          elements: (structured.document.elements || []).length,
          dimensions: (structured.document.dimensions || []).length,
          notes: (structured.document.notes || []).length,
          schedules: (structured.document.schedules || []).length,
        } : null,
      });
      for (const cell of classified) {
        const row = {
          sha256: file.sha256,
          relativePath: file.relativePath,
          pageNumber: page.pageNumber,
          ...cell,
        };
        cells.push(row);
        if (cell.remainingUnread) remainingUnread.push(row);
      }
      if (!classified.length) {
        for (const region of page.unresolvedRegions || []) {
          remainingUnread.push({
            sha256: file.sha256,
            relativePath: file.relativePath,
            pageNumber: page.pageNumber,
            cell: region.cell,
            remainingUnread: true,
            letteringStatus: "ocr_not_attempted",
            hypothesizedGraphicKind: "mixed_graphics",
          });
        }
      }
    }
    pages.push(...pageSummaries);
  }

  const matchByPath = new Map((recon.fileMatches || []).map((match) => [match.relativePath, match]));
  const textsBySheet = new Map();
  const ocrBySheet = new Map();
  for (const match of recon.fileMatches || []) {
    if (!match.sheetNumber) continue;
    const file = inventory.files.find((item) => item.relativePath === match.relativePath);
    const extracted = file?.sha256 ? JSON.parse(await readFile(path.join(extractedDir, `${file.sha256}.json`), "utf8")) : null;
    const recovered = file?.sha256 ? recoveredByHash.get(file.sha256) : null;
    if (!textsBySheet.has(match.sheetNumber)) textsBySheet.set(match.sheetNumber, []);
    textsBySheet.get(match.sheetNumber).push({
      relativePath: match.relativePath,
      sha256: file?.sha256 || null,
      duplicateOf: file?.duplicateOf || null,
      texts: (extracted?.pages || []).map((page) => ({ pageNumber: page.pageNumber, text: page.pageText || "" })),
    });
    if (!ocrBySheet.has(match.sheetNumber)) ocrBySheet.set(match.sheetNumber, []);
    ocrBySheet.get(match.sheetNumber).push({
      relativePath: match.relativePath,
      sha256: file?.sha256 || null,
      pages: (recovered?.pages || []).map((page) => ({ pageNumber: page.pageNumber, lines: page.lines || [] })),
    });
  }

  function collapse(links) {
    const hashes = new Set(links.map((link) => link.sha256).filter(Boolean));
    if (hashes.size === 1) return [links.find((link) => !link.duplicateOf) || links[0]];
    return links;
  }

  const mappings = (findingMap.findings || []).map((row) => {
    const original = row.original || wordingRecord(row);
    const links = collapse(textsBySheet.get(row.sheetNumber) || []);
    const link = links.length === 1 ? links[0] : null;
    const ocrPages = (ocrBySheet.get(row.sheetNumber) || []).find((item) => item.relativePath === link?.relativePath)?.pages || [];
    const grounding = link
      ? groundRecovered(original.drawingEvidence, link.texts, ocrPages)
      : { status: links.length > 1 ? "ambiguous_source_file" : "source_unmapped", method: "sheet_identity", pageNumber: null, independentlyVerified: false };
    return {
      ...row,
      original,
      wordingMatchesFixture: true,
      labelStatus: "unverified_model_output",
      matchResult: link ? "mapped" : links.length > 1 ? "ambiguous" : "unmapped",
      duplicateFileMatch: links.length > 1,
      relativePath: link?.relativePath || row.relativePath || null,
      sha256: link?.sha256 || row.sha256 || null,
      grounding: {
        ...grounding,
        note: grounding.note || "Machine check against the text layer and OCR. Not a verified label.",
      },
    };
  });

  const unmatchedFiles = (recon.unmatchedFiles || []).length
    ? recon.unmatchedFiles
    : (recon.fileMatches || []).filter((match) => !match.sheetNumber).map((match) => ({ relativePath: match.relativePath, method: match.method }));

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
    })),
    pages: pages.map((page) => ({
      sha256: page.sha256,
      relativePath: page.relativePath,
      pageNumber: page.pageNumber,
      captureClass: page.captureClass,
      unresolvedCount: page.remainingUnread,
      flags: page.flags,
    })),
    unresolvedRegions: remainingUnread,
    cells: recoveredByHash.size === pdfs.length ? cells : undefined,
    findings: (findingMap.findings || []).map((finding) => ({ clientReportId: finding.clientReportId })),
    mappings,
    unmatchedSheets: recon.unmatchedSheets || [],
    unmatchedFiles,
    ocrAttempted: [...recoveredByHash.values()].some((item) => item.pages?.some((page) => page.ocrAttempted)),
    expectedCellsPerPage: recoveredByHash.size === pdfs.length ? GRID_COLS * GRID_ROWS : undefined,
  };
  const assessment = assessDataset(assessmentInput);

  const classCounts = {};
  const letteringCounts = {};
  const zoneCounts = {};
  for (const cell of cells) {
    classCounts[cell.hypothesizedGraphicKind] = (classCounts[cell.hypothesizedGraphicKind] || 0) + 1;
    letteringCounts[cell.letteringStatus] = (letteringCounts[cell.letteringStatus] || 0) + 1;
    zoneCounts[cell.zone] = (zoneCounts[cell.zone] || 0) + 1;
  }
  const groundingCounts = {};
  for (const mapping of mappings) groundingCounts[mapping.grounding.status] = (groundingCounts[mapping.grounding.status] || 0) + 1;

  const identities = specialIdentities(recon, recoveredByPath);
  const validation = await validateSamples(pdfs, recoveredByHash, extractedDir);

  const report = {
    datasetVersion: DATASET_VERSION,
    recoveryVersion: RECOVERY_VERSION,
    baselineRun: BASELINE_RUN,
    productionNote: "The Supabase analyzer sends each PDF to GPT-4o as input_file. It does not use this text-layer or OCR dataset as model context.",
    labelPolicy: "AI findings, OCR lettering, and external qualifications are not professionally verified ground truth.",
    precision: "Not measured",
    recall: "Not measured",
    assessment,
    counts: {
      files: inventory.counts.files,
      pdf: inventory.counts.pdf,
      pdfPages: pages.length,
      cells: cells.length,
      remainingUnread: remainingUnread.length,
      ocrChars: pages.reduce((sum, page) => sum + (page.ocrChars || 0), 0),
      findings: mappings.length,
      mappedFindings: mappings.filter((mapping) => mapping.matchResult === "mapped").length,
    },
    classification: { hypothesizedGraphicKind: classCounts, letteringStatus: letteringCounts, zone: zoneCounts },
    grounding: groundingCounts,
    identities,
    validation,
    reconciliationSummary: recon.summary,
    files: inventory.files.map((file) => {
      const related = pages.filter((page) => page.relativePath === file.relativePath);
      return {
        ...file,
        ocrChars: related.reduce((sum, page) => sum + (page.ocrChars || 0), 0),
        remainingUnread: related.reduce((sum, page) => sum + (page.remainingUnread || 0), 0),
        sheetMatch: sheetLabel(matchByPath.get(file.relativePath)),
      };
    }),
  };

  const ocrLines = [];
  for (const recovered of recoveredByHash.values()) {
    for (const page of recovered.pages || []) {
      for (const line of page.lines || []) {
        ocrLines.push({
          sha256: recovered.sha256,
          relativePath: recovered.relativePath,
          pageNumber: page.pageNumber,
          text: line.text,
          box: line.box,
          confidence: line.confidence,
          origin: "visual_interpretation",
          independentlyVerified: false,
        });
      }
    }
  }
  await writeFile(path.join(options.outDir, "ocr-lines.jsonl"), ocrLines.map((line) => JSON.stringify(line)).join("\n") + (ocrLines.length ? "\n" : ""));
  await writeFile(path.join(options.outDir, "classified-cells.jsonl"), cells.map((cell) => JSON.stringify(cell)).join("\n") + (cells.length ? "\n" : ""));
  await writeFile(path.join(options.outDir, "unresolved-regions.jsonl"), remainingUnread.map((cell) => JSON.stringify(cell)).join("\n") + (remainingUnread.length ? "\n" : ""));
  await writeFile(path.join(options.outDir, "pages-manifest.json"), JSON.stringify(pages, null, 2));
  await writeFile(path.join(options.outDir, "finding-map.json"), JSON.stringify({
    datasetVersion: DATASET_VERSION,
    baselineRunId: BASELINE_RUN.id,
    labelPolicy: report.labelPolicy,
    precision: "Not measured",
    recall: "Not measured",
    findings: mappings,
  }, null, 2));
  await writeFile(path.join(options.outDir, "recovery-validation.json"), JSON.stringify({ identities, validation, classification: report.classification, grounding: groundingCounts }, null, 2));
  await writeFile(path.join(options.outDir, "acceptance.json"), JSON.stringify(assessment, null, 2));
  await writeFile(path.join(options.outDir, "coverage-report.md"), renderCoverageReport(report));
  return { report, assessment, outDir: options.outDir };
}

function sheetLabel(match) {
  if (!match) return "";
  if (!match.sheetNumber) return match.method;
  return `${match.sheetNumber} (${match.method})`;
}

async function validateSamples(pdfs, recoveredByHash, extractedDir) {
  const byPrefix = new Map();
  for (const file of pdfs) {
    const prefix = String(file.filename || "").replace(/\s+/g, "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "OTHER";
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, file);
  }
  const samples = [];
  for (const [prefix, file] of byPrefix) {
    const recovered = recoveredByHash.get(file.sha256);
    const extracted = JSON.parse(await readFile(path.join(extractedDir, `${file.sha256}.json`), "utf8"));
    const page = extracted.pages?.[0];
    const recPage = recovered?.pages?.[0];
    const filenameKey = canonicalSheetKey(file.filename);
    const textTokens = page ? titleBlockTokens(page.items || [], page.pageWidth, page.pageHeight) : [];
    const ocrTokens = recPage?.sheetTokens || [];
    const occupancy = (recPage?.words || []).filter((word) => word.occupancyStatus === "ink_under_box").length;
    const words = (recPage?.words || []).length;
    const filenameSeen = [...textTokens, ...ocrTokens].some((token) => {
      const key = canonicalSheetKey(token);
      return key.raw === filenameKey.raw || (key.stripped && key.stripped === filenameKey.stripped);
    });
    samples.push({
      prefix,
      relativePath: file.relativePath,
      filenameSeenInTitleOrOcr: filenameSeen,
      textLayerTokens: textTokens,
      ocrSheetTokens: ocrTokens,
      ocrWords: words,
      ocrWordsWithInk: occupancy,
      independentlyVerified: false,
      note: "Filename check against title-block text and OCR tokens. OCR is visual interpretation.",
    });
  }
  return samples;
}
