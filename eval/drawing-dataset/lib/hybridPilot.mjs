/**
 * Phase 2A.2 hybrid extraction pilot. Isolated from the Supabase analyzer.
 * Does not rewrite the 252 findings, the 2A.1 file extracts, or production prompts.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { groundEvidence, wordingRecord } from "./buildDataset.mjs";
import { classifyWithOcr, mergePageLayout, novelTokens } from "./hybridLayout.mjs";
import { targetedOcrFile, TARGETED_OCR_VERSION } from "./hybridOcr.mjs";
import {
  DEFAULT_PILOT_SHEETS,
  HYBRID_VERSION,
  PYTHON_EXTRACT_VERSION,
  inventoryAccountability,
  resolvePilotSheets,
} from "./hybridSelect.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PYTHON = path.resolve(here, "../.venv/bin/python");
const EXTRACT_SCRIPT = path.resolve(here, "../python/hybrid_extract.py");

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourcePath(sourceDir, relativePath) {
  return path.join(sourceDir, relativePath);
}

export function groundHybrid(evidence, pageNumber, texts) {
  const pdfjs = groundEvidence(evidence, [{ pageNumber, text: texts.baseline || "" }]);
  if (pdfjs.status === "span_found" || pdfjs.status === "partial_span") {
    return { ...pdfjs, origin: "machine_extracted", independentlyVerified: false, source: "pdfjs-text-layer" };
  }
  const pymupdf = groundEvidence(evidence, [{ pageNumber, text: texts.pymupdf || "" }]);
  if (pymupdf.status === "span_found" || pymupdf.status === "partial_span") {
    return { ...pymupdf, origin: "machine_extracted", independentlyVerified: false, source: "pymupdf-text" };
  }
  const ocr = groundEvidence(evidence, [{ pageNumber, text: texts.ocr || "" }]);
  if (ocr.status === "span_found" || ocr.status === "partial_span") {
    return {
      status: ocr.status === "span_found" ? "span_found_ocr" : "partial_span_ocr",
      method: ocr.method,
      pageNumber,
      origin: "visual_interpretation",
      independentlyVerified: false,
      source: "targeted-ocr",
      note: "Match is against OCR lettering, not a verified label.",
    };
  }
  return { ...pdfjs, origin: null, independentlyVerified: false, source: null };
}

export function recommendExpansion(summary) {
  const sheets = summary.sheets || [];
  const outlined = sheets.filter((sheet) => ["architectural", "mechanical", "electrical", "plumbing"].includes(sheet.discipline)
    && sheet.baselineUnread >= 20);
  const outlinedWithOcr = outlined.filter((sheet) => (sheet.novelOcrTokenCount || 0) >= 8);
  const evidenceBetter = (summary.grounding?.hybridMatched || 0) > (summary.grounding?.baselineMatched || 0);
  const unreadDown = sheets.filter((sheet) => sheet.remainingUnread < sheet.baselineUnread).length;
  const avgMs = summary.performance?.averageSheetMs || 0;
  const ocrRan = sheets.every((sheet) => sheet.ocrAttempted || sheet.ocrEngine === "injected");
  const expandOcr = ocrRan && outlinedWithOcr.length >= Math.max(1, Math.ceil(outlined.length * 0.5))
    && unreadDown >= Math.ceil(sheets.length * 0.5)
    && avgMs > 0
    && avgMs < 180000;
  const layoutSheets = sheets.filter((sheet) => ["layout", "ocr"].includes(sheet.doclingMode));
  const uniqueDoclingSheets = sheets.filter((sheet) => (sheet.novelDoclingTokenCount || 0) >= 8).length;
  const expandDocling = layoutSheets.length === sheets.length
    && layoutSheets.every((sheet) => sheet.doclingStatus === "ok")
    && uniqueDoclingSheets >= Math.ceil(sheets.length * 0.5);
  const doclingScheduleOnly = layoutSheets.length > 0 && uniqueDoclingSheets > 0 && !expandDocling;
  let decision = "do_not_expand_yet";
  let rationale = "Pilot did not show a stable gain in recovered lettering or evidence matches.";
  if (expandOcr && expandDocling) {
    decision = "expand_hybrid_to_82";
    rationale = "Targeted OCR recovered lettering on outlined plans and the Docling layout model added unique structure on most sheets.";
  } else if (expandOcr && doclingScheduleOnly) {
    decision = "expand_ocr_to_82_docling_on_schedules";
    rationale = "Targeted OCR helped outlined plans. The Docling layout model helped some schedule/note sheets and failed or added nothing on others.";
  } else if (expandOcr) {
    decision = "expand_targeted_ocr_to_82";
    rationale = "Targeted OCR recovered outlined lettering on CAD plans. Docling's layout model did not earn a full-set pass; docling-parse only reread native PDF text.";
  } else if (evidenceBetter) {
    decision = "hold_for_review";
    rationale = "Evidence matches improved on the pilot subset, but coverage or runtime is not yet enough to process all 82.";
  }
  return {
    decision,
    rationale,
    expandOcr,
    expandDocling,
    doclingScheduleOnly,
    evidenceBetter,
    precision: "Not measured",
    recall: "Not measured",
  };
}

async function runPythonExtract(pdfPath, outPath, options) {
  if (typeof options.extractFn === "function") {
    const result = await options.extractFn(pdfPath, options.doclingMode);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(result));
    return result;
  }
  const pythonBin = options.pythonBin || DEFAULT_PYTHON;
  if (!existsSync(pythonBin) || !existsSync(EXTRACT_SCRIPT)) {
    return {
      engine: null,
      status: "python_unavailable",
      pages: [],
      message: "Hybrid Python venv or extract script is missing.",
    };
  }
  const started = Date.now();
  const spawned = spawnSync(pythonBin, [
    EXTRACT_SCRIPT,
    "--pdf", pdfPath,
    "--out", outPath,
    "--docling", options.doclingMode || "off",
  ], {
    encoding: "utf8",
    timeout: options.doclingTimeoutMs || 180000,
    maxBuffer: 20_000_000,
    env: {
      ...process.env,
      HF_HOME: path.resolve(here, "../.cache/hf"),
      DOCLING_CACHE_DIR: path.resolve(here, "../.cache/docling"),
    },
  });
  if (spawned.status !== 0 || spawned.error) {
    return {
      engine: "pymupdf",
      status: "failed",
      pages: [],
      errorClass: spawned.error?.name || "SpawnError",
      message: String(spawned.stderr || spawned.error || "python extract failed").slice(0, 400),
      timingMs: Date.now() - started,
    };
  }
  try {
    return JSON.parse(await readFile(outPath, "utf8"));
  } catch (error) {
    return {
      engine: "pymupdf",
      status: "failed",
      pages: [],
      errorClass: error?.name || "Error",
      message: String(error?.message || error).slice(0, 400),
      timingMs: Date.now() - started,
    };
  }
}

export async function runHybridPilot(options) {
  const onProgress = options.onProgress || (() => {});
  const outDir = path.join(options.outDir, "hybrid-pilot");
  const pymupdfDir = path.join(outDir, "pymupdf");
  const ocrDir = path.join(outDir, "ocr");
  const pagesDir = path.join(outDir, "pages");
  await mkdir(pymupdfDir, { recursive: true });
  await mkdir(ocrDir, { recursive: true });
  await mkdir(pagesDir, { recursive: true });

  const findingMapPath = path.join(options.outDir, "finding-map.json");
  const findingMapBefore = await readFile(findingMapPath);
  const findingMapHashBefore = sha256Text(findingMapBefore);
  const inventory = JSON.parse(await readFile(path.join(options.outDir, "inventory.json"), "utf8"));
  const recon = JSON.parse(await readFile(path.join(options.outDir, "reconciliation.json"), "utf8"));
  const findingMap = JSON.parse(findingMapBefore.toString("utf8"));
  const requested = options.sheets || DEFAULT_PILOT_SHEETS;
  const selected = resolvePilotSheets(inventory, requested);
  const accountability = inventoryAccountability(inventory);
  let doclingMode = options.skipDocling ? "off" : (options.doclingMode || "layout");
  const sheets = [];
  const pages = [];

  for (const sheet of selected) {
    const started = Date.now();
    if (!sheet.file || sheet.file.processingStatus !== "extracted") {
      sheets.push({
        ...sheet,
        status: "missing_source",
        baselineUnread: sheet.file?.unresolvedCount || 0,
        remainingUnread: null,
        timingMs: Date.now() - started,
      });
      onProgress({ relativePath: sheet.relativePath, status: "missing" });
      continue;
    }
    const sha256 = sheet.sha256;
    const baseline = JSON.parse(await readFile(path.join(options.outDir, "files", `${sha256}.json`), "utf8"));
    const pymupdfCache = path.join(pymupdfDir, `${sha256}.json`);
    let pymupdf;
    if (!options.force && existsSync(pymupdfCache)) {
      pymupdf = JSON.parse(await readFile(pymupdfCache, "utf8"));
      onProgress({ relativePath: sheet.relativePath, status: "pymupdf-cached" });
    } else {
      onProgress({ relativePath: sheet.relativePath, status: "pymupdf" });
      pymupdf = await runPythonExtract(sourcePath(options.sourceDir, sheet.relativePath), pymupdfCache, {
        ...options,
        doclingMode,
      });
      const doclingStatus = pymupdf.pages?.[0]?.docling?.status;
      if ((pymupdf.status === "failed" || doclingStatus === "failed" || doclingStatus === "unavailable")
        && doclingMode !== "off"
        && !options.forceDocling) {
        doclingMode = "off";
        onProgress({ relativePath: sheet.relativePath, status: "docling-disabled-for-remaining" });
      }
    }

    const ocrCache = path.join(ocrDir, `${sha256}.json`);
    let ocr;
    if (!options.force && existsSync(ocrCache) && JSON.parse(await readFile(ocrCache, "utf8")).recoveryVersion === TARGETED_OCR_VERSION) {
      ocr = JSON.parse(await readFile(ocrCache, "utf8"));
      onProgress({ relativePath: sheet.relativePath, status: "ocr-cached" });
    } else {
      onProgress({ relativePath: sheet.relativePath, status: "ocr" });
      ocr = await targetedOcrFile(sourcePath(options.sourceDir, sheet.relativePath), {
        ...options,
        pymupdfPages: pymupdf.pages || [],
      });
      await writeFile(ocrCache, JSON.stringify(ocr));
    }

    const pageLayouts = [];
    for (const baselinePage of baseline.pages || []) {
      const pyPage = (pymupdf.pages || []).find((page) => page.pageNumber === baselinePage.pageNumber) || null;
      const ocrPage = (ocr.pages || []).find((page) => page.pageNumber === baselinePage.pageNumber) || null;
      const classified = classifyWithOcr({
        rasterCells: ocrPage?.rasterCells || [],
        textItems: baselinePage.items || [],
        ocrWords: ocrPage?.words || [],
        pageWidth: baselinePage.pageWidth,
        pageHeight: baselinePage.pageHeight,
        ocrAttempted: Boolean(ocrPage?.ocrAttempted),
      });
      const layout = mergePageLayout({
        baselinePage,
        pymupdfPage: pyPage,
        ocrPage,
        classified,
        relativePath: sheet.relativePath,
        sha256,
      });
      pageLayouts.push(layout);
      pages.push({
        relativePath: sheet.relativePath,
        sha256,
        pageNumber: layout.pageNumber,
        remainingUnread: layout.unresolvedRegions.length,
        ocrChars: layout.texts.ocrChars,
        captureClass: layout.unresolvedRegions.length ? "partial_lettering_unread" : "graphics_classified",
      });
    }
    await writeFile(path.join(pagesDir, `${sha256}.json`), JSON.stringify({
      hybridVersion: HYBRID_VERSION,
      pythonExtractVersion: PYTHON_EXTRACT_VERSION,
      relativePath: sheet.relativePath,
      sha256,
      independentlyVerified: false,
      pages: pageLayouts,
    }));

    const first = pageLayouts[0] || null;
    const doclingStatus = first?.methods?.docling || pymupdf.status || "skipped";
    const doclingText = (first?.blocks || []).filter((block) => String(block.extractionMethod || "").startsWith("docling")).map((block) => block.text).join("\n");
    sheets.push({
      relativePath: sheet.relativePath,
      discipline: sheet.discipline,
      reason: sheet.reason,
      sha256,
      status: "processed",
      sheetMatch: recon.fileMatches?.find((match) => match.relativePath === sheet.relativePath)?.method || null,
      sheetNumber: recon.fileMatches?.find((match) => match.relativePath === sheet.relativePath)?.sheetNumber || null,
      baselineChars: first?.texts.baselineChars || 0,
      pymupdfChars: first?.texts.pymupdfChars || 0,
      ocrChars: first?.texts.ocrChars || 0,
      novelOcrTokenCount: (first?.texts.novelOcrTokens || []).length,
      novelPymupdfTokenCount: (first?.texts.novelPymupdfTokens || []).length,
      novelDoclingTokenCount: novelTokens(first?.texts.baselineChars ? baseline.pages?.[0]?.pageText : "", doclingText).length,
      baselineUnread: (baseline.pages?.[0]?.unresolvedRegions || []).length,
      remainingUnread: first?.unresolvedRegions.length || 0,
      mixedGraphics: first?.classification?.hypothesizedGraphicKind?.mixed_graphics || 0,
      linework: first?.classification?.hypothesizedGraphicKind?.linework || 0,
      denseFill: first?.classification?.hypothesizedGraphicKind?.dense_fill || 0,
      ocrAttempted: Boolean(ocr.pages?.[0]?.ocrAttempted),
      ocrEngine: ocr.pages?.[0]?.engine || null,
      selectedOcrCells: ocr.pages?.[0]?.selectedCellCount || 0,
      doclingStatus,
      doclingMode: pymupdf.pages?.[0]?.docling?.mode || doclingStatus,
      drawings: first?.drawings || null,
      images: first?.images || 0,
      structured: first?.structured?.factCounts || null,
      timingMs: Date.now() - started,
      pythonTimingMs: pymupdf.timingMs || null,
      maxRssKb: pymupdf.maxRssKb || null,
    });
  }

  const originalFindings = (findingMap.findings || []).map((row) => ({
    ...row,
    original: row.original || wordingRecord(row),
  }));
  const pilotPaths = new Set(selected.map((sheet) => sheet.relativePath));
  const pageByPath = new Map();
  for (const sheet of selected) {
    if (!sheet.sha256) continue;
    try {
      const saved = JSON.parse(await readFile(path.join(pagesDir, `${sheet.sha256}.json`), "utf8"));
      pageByPath.set(sheet.relativePath, saved.pages?.[0] || null);
    } catch {
      pageByPath.set(sheet.relativePath, null);
    }
  }

  const hybridFindings = originalFindings.map((row) => {
    const original = row.original;
    const inPilot = pilotPaths.has(row.relativePath);
    const page = inPilot ? pageByPath.get(row.relativePath) : null;
    const baselineText = page ? (page.blocks || []).filter((block) => block.extractionMethod === "pdfjs-text-layer").map((block) => block.text).join("\n") : "";
    const pymupdfText = page ? (page.blocks || []).filter((block) => block.extractionMethod === "pymupdf-text").map((block) => block.text).join("\n") : "";
    const ocrText = page ? (page.blocks || []).filter((block) => block.origin === "visual_interpretation").map((block) => block.text).join("\n") : "";
    const grounding = inPilot && page
      ? groundHybrid(original.drawingEvidence, page.pageNumber, {
        baseline: baselineText,
        pymupdf: pymupdfText,
        ocr: ocrText,
      })
      : row.grounding;
    return {
      clientReportId: row.clientReportId,
      wordingSha256: row.wordingSha256,
      original,
      wordingMatchesFixture: true,
      labelStatus: row.labelStatus,
      relativePath: row.relativePath,
      sheetNumber: row.sheetNumber,
      inPilot,
      baselineGrounding: row.grounding,
      hybridGrounding: grounding,
    };
  });

  const findingMapAfter = await readFile(findingMapPath);
  if (sha256Text(findingMapAfter) !== findingMapHashBefore) {
    throw new Error("finding-map.json changed during the hybrid pilot. Aborting.");
  }

  const pilotFindings = hybridFindings.filter((row) => row.inPilot);
  const countStatus = (rows, key, statuses) => rows.filter((row) => statuses.includes(row[key]?.status)).length;
  const grounding = {
    findings: originalFindings.length,
    pilotFindings: pilotFindings.length,
    baselineMatched: countStatus(pilotFindings, "baselineGrounding", ["span_found", "partial_span", "span_found_ocr", "partial_span_ocr"]),
    hybridMatched: countStatus(pilotFindings, "hybridGrounding", ["span_found", "partial_span", "span_found_ocr", "partial_span_ocr"]),
    hybridOcrMatched: countStatus(pilotFindings, "hybridGrounding", ["span_found_ocr", "partial_span_ocr"]),
  };
  const performance = {
    sheets: sheets.length,
    totalMs: sheets.reduce((sum, sheet) => sum + (sheet.timingMs || 0), 0),
    averageSheetMs: sheets.length ? Math.round(sheets.reduce((sum, sheet) => sum + (sheet.timingMs || 0), 0) / sheets.length) : 0,
    rss: process.memoryUsage(),
  };
  const summary = {
    hybridVersion: HYBRID_VERSION,
    pythonExtractVersion: PYTHON_EXTRACT_VERSION,
    ocrVersion: TARGETED_OCR_VERSION,
    productionNote: "The Supabase analyzer is unchanged. This pilot does not feed GPT-4o.",
    labelPolicy: "OCR and Docling output are not professionally verified. Precision and recall stay Not measured.",
    precision: "Not measured",
    recall: "Not measured",
    accountability,
    identities: {
      s204: {
        relativePath: "S-204.00.pdf",
        inPilot: selected.some((sheet) => sheet.relativePath === "S-204.00.pdf"),
        identityCount: recon.fileMatches?.find((match) => match.relativePath === "S-204.00.pdf")?.identityCount || 0,
        note: "One file carries two published titles. They are not merged.",
      },
      s300: {
        relativePath: "S-300.00.pdf",
        inPilot: selected.some((sheet) => sheet.relativePath === "S-300.00.pdf"),
        matchMethod: recon.fileMatches?.find((match) => match.relativePath === "S-300.00.pdf")?.method || null,
        note: "Filename is a sheet id with no published finding identity. It is not reassigned.",
      },
      archive: {
        relativePath: "Archive.zip",
        present: accountability.zipPresent,
        status: accountability.zipStatus,
        note: "Zip members stay listed and are not unpacked into the drawing set.",
      },
    },
    sheets,
    grounding,
    performance,
  };
  summary.recommendation = recommendExpansion(summary);
  const comparison = renderComparison(summary);

  await writeFile(path.join(outDir, "comparison.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(outDir, "comparison.md"), comparison);
  await writeFile(path.join(outDir, "finding-grounding.json"), JSON.stringify({
    hybridVersion: HYBRID_VERSION,
    findingMapSha256: findingMapHashBefore,
    findingsUnchanged: true,
    precision: "Not measured",
    recall: "Not measured",
    findings: hybridFindings,
  }, null, 2));
  await writeFile(path.join(outDir, "pages-manifest.json"), JSON.stringify(pages, null, 2));

  return {
    summary,
    outDir,
    findingMapHash: findingMapHashBefore,
    findingsUnchanged: true,
  };
}

export function renderComparison(summary) {
  const lines = [];
  lines.push("# Phase 2A.2 hybrid extraction pilot");
  lines.push("");
  lines.push(`Accountability of the 83-file inventory: ${summary.accountability.requiredPresent && summary.accountability.pdfCount === 82 ? "PASS" : "CHECK"}`);
  lines.push("Content completeness: NOT COMPLETE");
  lines.push("Precision: Not measured");
  lines.push("Recall: Not measured");
  lines.push("");
  lines.push(summary.productionNote);
  lines.push(summary.labelPolicy);
  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  lines.push(`- decision: ${summary.recommendation.decision}`);
  lines.push(`- ${summary.recommendation.rationale}`);
  lines.push("");
  lines.push("## Inventory guardrails");
  lines.push("");
  lines.push(`- walked/recorded files: ${summary.accountability.walkedFiles}/${summary.accountability.recordedFiles}`);
  lines.push(`- pdf files: ${summary.accountability.pdfCount}`);
  lines.push(`- Archive.zip: ${summary.identities.archive.status}`);
  lines.push(`- S-204.00.pdf in pilot: ${summary.identities.s204.inPilot}; identity count ${summary.identities.s204.identityCount}`);
  lines.push(`- S-300.00.pdf in pilot: ${summary.identities.s300.inPilot}; match ${summary.identities.s300.matchMethod}`);
  lines.push("");
  lines.push("## Finding evidence (pilot sheets only)");
  lines.push("");
  lines.push(`- original findings preserved: ${summary.grounding.findings}`);
  lines.push(`- findings on pilot sheets: ${summary.grounding.pilotFindings}`);
  lines.push(`- baseline text-layer matches: ${summary.grounding.baselineMatched}`);
  lines.push(`- hybrid matches: ${summary.grounding.hybridMatched}`);
  lines.push(`- hybrid OCR-only matches: ${summary.grounding.hybridOcrMatched}`);
  lines.push("");
  lines.push("## Sheets");
  lines.push("");
  lines.push("| File | Discipline | Baseline chars | PyMuPDF chars | OCR chars | Novel OCR tokens | Baseline unread | Remaining unread | Docling | Time ms |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |");
  for (const sheet of summary.sheets) {
    const docling = [sheet.doclingMode, sheet.doclingStatus].filter(Boolean).join("/");
    lines.push(`| ${sheet.relativePath} | ${sheet.discipline} | ${sheet.baselineChars ?? ""} | ${sheet.pymupdfChars ?? ""} | ${sheet.ocrChars ?? ""} | ${sheet.novelOcrTokenCount ?? ""} | ${sheet.baselineUnread ?? ""} | ${sheet.remainingUnread ?? ""} | ${docling} | ${sheet.timingMs ?? ""} |`);
  }
  lines.push("");
  lines.push("## Performance");
  lines.push("");
  lines.push(`- average sheet ms: ${summary.performance.averageSheetMs}`);
  lines.push(`- total ms: ${summary.performance.totalMs}`);
  lines.push("");
  lines.push("Linework and dense fill are not assumed to hide text. OCR runs on mixed-graphics cells and on linework cells with many tiny filled paths (outlined-lettering candidates). OCR strings are visual interpretation. The Docling layout model was attempted; a parse-only fallback is native PDF text, not recovered CAD lettering.");
  lines.push("");
  return lines.join("\n");
}
