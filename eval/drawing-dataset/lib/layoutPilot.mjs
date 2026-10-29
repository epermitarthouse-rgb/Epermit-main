/**
 * Phase 2A.3 layout reconstruction pilot.
 * Isolated from the Supabase analyzer. Does not rewrite findings or 2A.1 extracts.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wordingRecord } from "./buildDataset.mjs";
import {
  associateBlocksToRegions,
  clusterTextBlocks,
  groundEvidenceInRegions,
  proposeRelationships,
} from "./layoutAssociate.mjs";
import { inventoryAccountability } from "./hybridSelect.mjs";
import { prepareFindingSemanticRows } from "./layoutSemanticPrep.mjs";
import {
  DEFAULT_LAYOUT_SHEETS,
  LAYOUT_FULL_VERSION,
  LAYOUT_PYTHON_VERSION,
  LAYOUT_VERSION,
  listAllLayoutSheets,
  resolveLayoutSheets,
  resolveValidationSamples,
} from "./layoutSelect.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PYTHON = path.resolve(here, "../.venv/bin/python");
const LAYOUT_SCRIPT = path.resolve(here, "../python/layout_reconstruct.py");

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourcePath(sourceDir, relativePath) {
  return path.join(sourceDir, relativePath);
}

async function loadHybridBlocks(outDir, sha256) {
  const hybridPath = path.join(outDir, "hybrid-pilot", "pages", `${sha256}.json`);
  if (!existsSync(hybridPath)) return null;
  const saved = JSON.parse(await readFile(hybridPath, "utf8"));
  return saved.pages?.[0] || null;
}

async function loadBaselinePage(outDir, sha256) {
  const filePath = path.join(outDir, "files", `${sha256}.json`);
  const extracted = JSON.parse(await readFile(filePath, "utf8"));
  return extracted.pages?.[0] || null;
}

async function loadOcrLines(outDir, sha256) {
  const recoveryPath = path.join(outDir, "recovery", `${sha256}.json`);
  if (existsSync(recoveryPath)) {
    const recovered = JSON.parse(await readFile(recoveryPath, "utf8"));
    const page = recovered.pages?.[0];
    return (page?.lines || []).map((line) => ({
      kind: "ocr_line",
      text: line.text,
      bbox: line.box,
      origin: "visual_interpretation",
      extractionMethod: page?.engine || "macos-vision",
      independentlyVerified: false,
    }));
  }
  const hybridOcr = path.join(outDir, "hybrid-pilot", "ocr", `${sha256}.json`);
  if (existsSync(hybridOcr)) {
    const recovered = JSON.parse(await readFile(hybridOcr, "utf8"));
    const page = recovered.pages?.[0];
    return (page?.lines || []).map((line) => ({
      kind: "ocr_line",
      text: line.text,
      bbox: line.box,
      origin: "visual_interpretation",
      extractionMethod: page?.engine || "macos-vision",
      independentlyVerified: false,
    }));
  }
  return [];
}

function baselineBlocks(page) {
  return (page?.items || []).map((item) => ({
    kind: "text_span",
    text: item.text,
    bbox: {
      x: item.x,
      y: item.y,
      width: item.w,
      height: item.h,
      unit: "pdf-point",
      origin: "bottom-left",
    },
    origin: "machine_extracted",
    extractionMethod: "pdfjs-text-layer",
    independentlyVerified: false,
  }));
}

async function runLayoutPython(pdfPath, outPath, overlayPath, options = {}) {
  if (typeof options.layoutFn === "function") {
    return options.layoutFn(pdfPath, outPath, overlayPath);
  }
  const pythonBin = options.pythonBin || DEFAULT_PYTHON;
  if (!existsSync(pythonBin) || !existsSync(LAYOUT_SCRIPT)) {
    return {
      status: "python_unavailable",
      regions: [],
      message: "Layout Python venv or script is missing.",
    };
  }
  const spawned = spawnSync(pythonBin, [
    LAYOUT_SCRIPT,
    "--pdf", pdfPath,
    "--out", outPath,
    "--overlay", overlayPath,
  ], {
    encoding: "utf8",
    timeout: options.timeoutMs || 120000,
    maxBuffer: 20_000_000,
  });
  if (spawned.status !== 0 || spawned.error) {
    return {
      status: "failed",
      regions: [],
      errorClass: spawned.error?.name || "SpawnError",
      message: String(spawned.stderr || spawned.stdout || spawned.error || "layout reconstruct failed").slice(0, 1200),
    };
  }
  return null;
}

export function recommendLayoutExpansion(summary) {
  const sheets = summary.sheets || [];
  const withRegions = sheets.filter((sheet) => (sheet.regionCount || 0) >= 3);
  const withAssocs = sheets.filter((sheet) => (sheet.associatedBlocks || 0) > 0);
  const withExplicitRels = sheets.filter((sheet) => (sheet.explicitRelationshipCandidates || 0) > 0);
  const groundingGain = (summary.grounding?.layoutMatched || 0) > (summary.grounding?.baselineMatched || 0);
  const overlays = sheets.filter((sheet) => sheet.overlayWritten).length;
  const avgMs = summary.performance?.averageSheetMs || 0;
  const scheduleSheets = sheets.filter((sheet) => (sheet.scheduleCandidates || 0) > 0);
  const bandReady = withRegions.length === sheets.length
    && withAssocs.length >= Math.ceil(sheets.length * 0.8)
    && overlays === sheets.length
    && avgMs > 0
    && avgMs < 60000;
  let decision = "hold_layout_pilot";
  let rationale = "Layout recovery is incomplete or too weak on the pilot set to justify processing all 82 sheets yet.";
  if (bandReady && (withExplicitRels.length >= 2 || groundingGain)) {
    decision = "expand_band_layout_to_82";
    rationale = "Title/notes/field bands, OCR association, overlays, and explicit note/sheet-reference candidates worked on the pilot. OpenCV schedule grids remain hypotheses and did not earn a separate schedule-model pass.";
  } else if (bandReady) {
    decision = "expand_band_layout_to_82_limited";
    rationale = "Band layout and text association are reproducible, but explicit technical relationships or evidence-grounding gains were thin. Expand bands only; keep relationship promotion gated.";
  }
  return {
    decision,
    rationale,
    expand: decision.startsWith("expand_band_layout"),
    scheduleDetectionUseful: scheduleSheets.length > 0,
    explicitRelationshipsReady: withExplicitRels.length >= 2,
    toolsUsed: summary.toolsUsed,
    toolsSkipped: summary.toolsSkipped,
    precision: "Not measured",
    recall: "Not measured",
  };
}

export async function runLayoutPilot(options) {
  const onProgress = options.onProgress || (() => {});
  const fullSet = Boolean(options.fullSet);
  const outName = options.outName || (fullSet ? "layout-full" : "layout-pilot");
  const layoutVersion = options.layoutVersion || (fullSet ? LAYOUT_FULL_VERSION : LAYOUT_VERSION);
  const outDir = path.join(options.outDir, outName);
  const regionsDir = path.join(outDir, "regions");
  const pagesDir = path.join(outDir, "pages");
  const overlaysDir = path.join(outDir, "overlays");
  await mkdir(regionsDir, { recursive: true });
  await mkdir(pagesDir, { recursive: true });
  await mkdir(overlaysDir, { recursive: true });

  const findingMapPath = path.join(options.outDir, "finding-map.json");
  const findingMapBefore = await readFile(findingMapPath);
  const findingMapHashBefore = sha256Text(findingMapBefore);
  const inventory = JSON.parse(await readFile(path.join(options.outDir, "inventory.json"), "utf8"));
  const recon = JSON.parse(await readFile(path.join(options.outDir, "reconciliation.json"), "utf8"));
  const findingMap = JSON.parse(findingMapBefore.toString("utf8"));
  const account = inventoryAccountability(inventory);
  const selected = options.sheets
    ? resolveLayoutSheets(inventory, options.sheets)
    : fullSet
      ? listAllLayoutSheets(inventory)
      : resolveLayoutSheets(inventory, DEFAULT_LAYOUT_SHEETS);
  const sheets = [];
  const pageByPath = new Map();
  const failures = [];

  for (const sheet of selected) {
    const started = Date.now();
    if (!sheet.file || sheet.file.processingStatus !== "extracted") {
      const row = {
        relativePath: sheet.relativePath,
        discipline: sheet.discipline,
        reason: sheet.reason,
        sha256: sheet.sha256,
        status: sheet.file ? `not_extracted:${sheet.file.processingStatus}` : "missing_source",
        timingMs: Date.now() - started,
        overlayWritten: false,
        regionCount: 0,
        associatedBlocks: 0,
        relationshipCandidates: 0,
        explicitRelationshipCandidates: 0,
        cacheHit: false,
      };
      sheets.push(row);
      failures.push({
        relativePath: sheet.relativePath,
        status: row.status,
        message: "PDF was not available as an extracted source page.",
      });
      onProgress({ relativePath: sheet.relativePath, status: row.status });
      continue;
    }
    const sha256 = sheet.sha256;
    const regionsCache = path.join(regionsDir, `${sha256}.json`);
    const pageCache = path.join(pagesDir, `${sha256}.json`);
    const overlayPath = path.join(overlaysDir, `${sha256}.png`);
    let layout;
    let cacheHit = false;
    const pageFresh = !options.force && existsSync(pageCache) && existsSync(regionsCache)
      && (existsSync(overlayPath) || options.allowMissingOverlayCache);
    if (pageFresh && !options.force) {
      // Resume: reuse page record when regions+page exist; still rebuild summary later.
      const cachedPage = JSON.parse(await readFile(pageCache, "utf8"));
      pageByPath.set(sheet.relativePath, cachedPage);
      const relationships = cachedPage.relationships || [];
      sheets.push({
        relativePath: sheet.relativePath,
        discipline: sheet.discipline,
        reason: sheet.reason,
        sha256,
        status: "cached",
        cacheHit: true,
        sheetMatch: recon.fileMatches?.find((match) => match.relativePath === sheet.relativePath)?.method || null,
        sheetNumber: recon.fileMatches?.find((match) => match.relativePath === sheet.relativePath)?.sheetNumber || null,
        regionCount: cachedPage.counts?.regions ?? cachedPage.regions?.length ?? 0,
        scheduleCandidates: cachedPage.counts?.scheduleCandidates ?? 0,
        clusterCount: cachedPage.counts?.clusters ?? 0,
        associatedBlocks: cachedPage.counts?.associatedBlocks ?? 0,
        unassignedBlocks: cachedPage.counts?.unassignedBlocks ?? 0,
        relationshipCandidates: cachedPage.counts?.relationshipCandidates ?? relationships.length,
        explicitRelationshipCandidates: relationships.filter((item) => ["sheet_reference", "note_number_to_callout", "equipment_tag_cooccurrence"].includes(item.type)).length,
        equipmentTagCandidates: relationships.filter((item) => item.type === "equipment_tag_cooccurrence").length,
        ocrBlocks: cachedPage.counts?.ocrBlocks ?? 0,
        overlayWritten: Boolean(cachedPage.overlayPath && existsSync(cachedPage.overlayPath)),
        timingMs: Date.now() - started,
        layoutTimingMs: cachedPage.layoutTimingMs || null,
      });
      onProgress({ relativePath: sheet.relativePath, status: "page-cached" });
      continue;
    }
    const regionsReusable = !options.force && existsSync(regionsCache) && existsSync(overlayPath);
    if (regionsReusable) {
      layout = JSON.parse(await readFile(regionsCache, "utf8"));
      cacheHit = true;
      onProgress({ relativePath: sheet.relativePath, status: "regions-cached" });
    } else {
      onProgress({ relativePath: sheet.relativePath, status: "regions" });
      const failed = await runLayoutPython(
        sourcePath(options.sourceDir, sheet.relativePath),
        regionsCache,
        overlayPath,
        options,
      );
      if (failed) {
        layout = failed;
        await writeFile(regionsCache, JSON.stringify(layout));
      } else {
        layout = JSON.parse(await readFile(regionsCache, "utf8"));
      }
    }

    if (layout.status === "failed" || layout.status === "python_unavailable") {
      failures.push({
        relativePath: sheet.relativePath,
        sha256,
        status: layout.status,
        message: layout.message || layout.errorClass || "layout reconstruction failed",
      });
    }

    const baseline = await loadBaselinePage(options.outDir, sha256);
    const hybrid = await loadHybridBlocks(options.outDir, sha256);
    const ocrBlocks = hybrid?.blocks?.filter((block) => block.origin === "visual_interpretation")
      || await loadOcrLines(options.outDir, sha256);
    const textBlocks = hybrid?.blocks?.filter((block) => block.extractionMethod === "pdfjs-text-layer" || block.extractionMethod === "pymupdf-text")
      || baselineBlocks(baseline);
    const blocks = [
      ...textBlocks,
      ...ocrBlocks,
    ];
    const regions = layout.regions || [];
    const clusters = clusterTextBlocks(blocks);
    const associations = associateBlocksToRegions(blocks, regions);
    const relationships = proposeRelationships({
      clusters,
      associations,
      regions,
      relativePath: sheet.relativePath,
    });

    const pageRecord = {
      layoutVersion,
      pythonVersion: LAYOUT_PYTHON_VERSION,
      relativePath: sheet.relativePath,
      sha256,
      pageNumber: 1,
      pageWidth: layout.pageWidth || baseline?.pageWidth || null,
      pageHeight: layout.pageHeight || baseline?.pageHeight || null,
      independentlyVerified: false,
      provenancePolicy: "machine_detected candidates, visual_interpretation OCR, and professionally verified labels stay separate.",
      regions,
      clusters,
      associations,
      relationships,
      counts: {
        regions: regions.length,
        scheduleCandidates: regions.filter((region) => region.kind === "schedule_candidate").length,
        clusters: clusters.length,
        associatedBlocks: associations.filter((item) => item.regionId).length,
        unassignedBlocks: associations.filter((item) => !item.regionId).length,
        relationshipCandidates: relationships.length,
        ocrBlocks: ocrBlocks.length,
        textBlocks: textBlocks.length,
      },
      overlayPath: existsSync(overlayPath) ? overlayPath : layout.overlayPath || null,
      layoutTimingMs: layout.timingMs || null,
      inkRatio: layout.inkRatio ?? null,
      layoutStatus: layout.status || "ok",
    };
    await writeFile(path.join(pagesDir, `${sha256}.json`), JSON.stringify(pageRecord));
    pageByPath.set(sheet.relativePath, pageRecord);

    const status = layout.status === "failed" || layout.status === "python_unavailable" ? layout.status : "processed";
    sheets.push({
      relativePath: sheet.relativePath,
      discipline: sheet.discipline,
      reason: sheet.reason,
      sha256,
      status,
      cacheHit,
      sheetMatch: recon.fileMatches?.find((match) => match.relativePath === sheet.relativePath)?.method || null,
      sheetNumber: recon.fileMatches?.find((match) => match.relativePath === sheet.relativePath)?.sheetNumber || null,
      regionCount: pageRecord.counts.regions,
      scheduleCandidates: pageRecord.counts.scheduleCandidates,
      clusterCount: pageRecord.counts.clusters,
      associatedBlocks: pageRecord.counts.associatedBlocks,
      unassignedBlocks: pageRecord.counts.unassignedBlocks,
      relationshipCandidates: pageRecord.counts.relationshipCandidates,
      explicitRelationshipCandidates: relationships.filter((item) => ["sheet_reference", "note_number_to_callout", "equipment_tag_cooccurrence"].includes(item.type)).length,
      equipmentTagCandidates: relationships.filter((item) => item.type === "equipment_tag_cooccurrence").length,
      ocrBlocks: pageRecord.counts.ocrBlocks,
      overlayWritten: Boolean(pageRecord.overlayPath && existsSync(pageRecord.overlayPath)),
      timingMs: Date.now() - started,
      layoutTimingMs: pageRecord.layoutTimingMs,
    });
  }

  const findings = (findingMap.findings || []).map((row) => {
    const original = row.original || wordingRecord(row);
    const page = pageByPath.get(row.relativePath);
    const inPilot = Boolean(page);
    const baselineGrounding = row.grounding || null;
    const layoutGrounding = inPilot
      ? groundEvidenceInRegions(original.drawingEvidence, page.associations)
      : null;
    return {
      clientReportId: row.clientReportId,
      wordingSha256: row.wordingSha256,
      original,
      wordingMatchesFixture: true,
      labelStatus: row.labelStatus,
      relativePath: row.relativePath,
      sheetNumber: row.sheetNumber,
      inPilot,
      baselineGrounding,
      layoutGrounding,
    };
  });

  const findingMapAfter = await readFile(findingMapPath);
  if (sha256Text(findingMapAfter) !== findingMapHashBefore) {
    throw new Error("finding-map.json changed during the layout run. Aborting.");
  }

  const coveredFindings = findings.filter((row) => row.inPilot);
  const matched = (rows, key, statuses) => rows.filter((row) => statuses.includes(row[key]?.status)).length;
  const grounding = {
    findings: findings.length,
    pilotFindings: coveredFindings.length,
    coveredFindings: coveredFindings.length,
    baselineMatched: matched(coveredFindings, "baselineGrounding", [
      "span_found", "partial_span", "span_found_ocr", "partial_span_ocr",
      "span_found_in_region", "partial_span_in_region", "token_overlap",
    ]),
    layoutMatched: matched(coveredFindings, "layoutGrounding", ["span_found_in_region", "partial_span_in_region"]),
    groundingImprovedClaim: false,
  };
  const performance = {
    sheets: sheets.length,
    totalMs: sheets.reduce((sum, sheet) => sum + (sheet.timingMs || 0), 0),
    averageSheetMs: sheets.length ? Math.round(sheets.reduce((sum, sheet) => sum + (sheet.timingMs || 0), 0) / sheets.length) : 0,
  };
  const coverage = buildLayoutCoverage(sheets, failures, inventory, recon, account);
  const validationSamples = buildValidationSampleReport(resolveValidationSamples(inventory), pageByPath, sheets);
  const summary = {
    layoutVersion,
    pythonVersion: LAYOUT_PYTHON_VERSION,
    phase: fullSet ? "2A.4" : "2A.3",
    productionNote: "The Supabase analyzer, GPT-4o path, and Code Analyzer V2 are unchanged.",
    labelPolicy: "Layout regions and relationships are machine-detected candidates. OCR remains visual interpretation. Precision and recall stay Not measured.",
    precision: "Not measured",
    recall: "Not measured",
    toolsUsed: ["pymupdf", "macos-vision-ocr-reused", "opencv", "shapely"],
    toolsSkipped: [
      "paddleocr-pp-structurev3: deferred; OpenCV grid hypotheses plus existing text/OCR were sufficient for the pilot",
      "microsoft-table-transformer: deferred; heavy model dependency not justified by five-sheet evidence",
    ],
    accountability: {
      inventoryFiles: account.recordedFiles,
      walkedFiles: account.walkedFiles,
      pdfFiles: account.pdfCount,
      findings: findings.length,
      findingsUnchanged: true,
      requiredPresent: account.requiredPresent,
      missingRequired: account.missingRequired,
      s204InSet: selected.some((sheet) => sheet.relativePath === "S-204.00.pdf"),
      s204IdentityCount: recon.fileMatches?.find((match) => match.relativePath === "S-204.00.pdf")?.identityCount || 0,
      s300MatchMethod: recon.fileMatches?.find((match) => match.relativePath === "S-300.00.pdf")?.method || null,
      archivePresent: account.zipPresent,
      // keep pilot key for 2A.3 markdown compatibility
      s204InPilot: selected.some((sheet) => sheet.relativePath === "S-204.00.pdf"),
    },
    sheets,
    failures,
    coverage,
    validationSamples,
    grounding,
    performance,
  };
  summary.recommendation = fullSet
    ? recommendFullLayoutReadiness(summary)
    : recommendLayoutExpansion(summary);

  await writeFile(path.join(outDir, "comparison.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(outDir, "comparison.md"), fullSet ? renderFullLayoutReport(summary) : renderLayoutComparison(summary));
  await writeFile(path.join(outDir, "finding-grounding.json"), JSON.stringify({
    layoutVersion,
    findingMapSha256: findingMapHashBefore,
    findingsUnchanged: true,
    precision: "Not measured",
    recall: "Not measured",
    groundingImprovedClaim: false,
    findings,
  }, null, 2));

  if (fullSet || options.semanticPrep) {
    const semanticRows = prepareFindingSemanticRows(findings, pageByPath);
    const withCandidates = semanticRows.filter((row) => (row.semanticPrep?.candidates || []).length > 0).length;
    await writeFile(path.join(outDir, "semantic-prep.json"), JSON.stringify({
      layoutVersion,
      phase: "2A.5-prep",
      findingMapSha256: findingMapHashBefore,
      findingsUnchanged: true,
      groundingClaimed: false,
      independentlyVerified: false,
      precision: "Not measured",
      recall: "Not measured",
      counts: {
        findings: semanticRows.length,
        withParaphraseCandidates: withCandidates,
        layoutSpanMatches: grounding.layoutMatched,
      },
      note: "Paraphrase token-overlap candidates only. Do not treat as improved evidence grounding.",
      findings: semanticRows,
    }, null, 2));
    await writeFile(path.join(outDir, "coverage.json"), JSON.stringify(coverage, null, 2));
    await writeFile(path.join(outDir, "failures.json"), JSON.stringify({
      layoutVersion,
      count: failures.length,
      failures,
    }, null, 2));
    await writeFile(path.join(outDir, "unresolved-layout.jsonl"), renderUnresolvedJsonl(sheets, failures, pageByPath));
    await writeFile(path.join(outDir, "validation-samples.json"), JSON.stringify({
      layoutVersion,
      independentlyVerified: false,
      samples: validationSamples,
    }, null, 2));
    await writeFile(path.join(outDir, "reconciliation-layout.md"), renderLayoutReconciliation(summary));
  }

  return { summary, outDir, findingMapHash: findingMapHashBefore, findingsUnchanged: true };
}

export async function runLayoutFull(options) {
  return runLayoutPilot({
    ...options,
    fullSet: true,
    outName: options.outName || "layout-full",
    layoutVersion: options.layoutVersion || LAYOUT_FULL_VERSION,
    semanticPrep: true,
  });
}

function buildLayoutCoverage(sheets, failures, inventory, recon, account) {
  const processed = sheets.filter((sheet) => ["processed", "cached"].includes(sheet.status));
  const withRegions = sheets.filter((sheet) => (sheet.regionCount || 0) >= 3);
  const withAssocs = sheets.filter((sheet) => (sheet.associatedBlocks || 0) > 0);
  const withOverlays = sheets.filter((sheet) => sheet.overlayWritten);
  const withExplicit = sheets.filter((sheet) => (sheet.explicitRelationshipCandidates || 0) > 0);
  const byDiscipline = {};
  for (const sheet of sheets) {
    const key = sheet.discipline || "other";
    if (!byDiscipline[key]) byDiscipline[key] = { sheets: 0, withRegions: 0, withOverlays: 0, failures: 0 };
    byDiscipline[key].sheets += 1;
    if ((sheet.regionCount || 0) >= 3) byDiscipline[key].withRegions += 1;
    if (sheet.overlayWritten) byDiscipline[key].withOverlays += 1;
    if (!["processed", "cached"].includes(sheet.status)) byDiscipline[key].failures += 1;
  }
  const unmatchedFiles = (recon.fileMatches || []).filter((match) => match.method === "unmatched_file");
  return {
    inventoryFiles: account.recordedFiles,
    walkedFiles: account.walkedFiles,
    pdfFiles: account.pdfCount,
    sheetsRequested: sheets.length,
    sheetsProcessed: processed.length,
    sheetsFailed: failures.length,
    sheetsWithRegions: withRegions.length,
    sheetsWithAssociations: withAssocs.length,
    sheetsWithOverlays: withOverlays.length,
    sheetsWithExplicitRelationships: withExplicit.length,
    overlayCoverage: sheets.length ? withOverlays.length / sheets.length : 0,
    regionCoverage: sheets.length ? withRegions.length / sheets.length : 0,
    byDiscipline,
    s204: {
      relativePath: "S-204.00.pdf",
      identityCount: recon.fileMatches?.find((match) => match.relativePath === "S-204.00.pdf")?.identityCount || 0,
      method: recon.fileMatches?.find((match) => match.relativePath === "S-204.00.pdf")?.method || null,
      inSet: sheets.some((sheet) => sheet.relativePath === "S-204.00.pdf"),
    },
    s300: {
      relativePath: "S-300.00.pdf",
      method: recon.fileMatches?.find((match) => match.relativePath === "S-300.00.pdf")?.method || null,
      inSet: sheets.some((sheet) => sheet.relativePath === "S-300.00.pdf"),
      note: "Unmatched published identity; OCR tokens must not reassign this file.",
    },
    archiveZip: {
      present: account.zipPresent,
      status: account.zipStatus,
      inLayoutSet: false,
      note: "Archive.zip is inventoried and not treated as a drawing page.",
    },
    unmatchedFileCount: unmatchedFiles.length,
    unmatchedFiles: unmatchedFiles.map((match) => match.relativePath),
  };
}

function buildValidationSampleReport(samples, pageByPath, sheets) {
  return samples.map((sample) => {
    const page = pageByPath.get(sample.relativePath) || null;
    const sheet = sheets.find((row) => row.relativePath === sample.relativePath) || null;
    const regionKinds = [...new Set((page?.regions || []).map((region) => region.kind))];
    const explicit = (page?.relationships || []).filter((item) => ["sheet_reference", "note_number_to_callout", "equipment_tag_cooccurrence"].includes(item.type));
    return {
      relativePath: sample.relativePath,
      discipline: sample.discipline,
      present: sample.present,
      status: sheet?.status || (sample.present ? "not_processed" : "missing"),
      regionCount: sheet?.regionCount ?? 0,
      regionKinds,
      associatedBlocks: sheet?.associatedBlocks ?? 0,
      unassignedBlocks: sheet?.unassignedBlocks ?? 0,
      explicitRelationshipCandidates: explicit.length,
      overlayWritten: sheet?.overlayWritten || false,
      independentlyVerified: false,
      note: sample.note,
      checks: {
        hasTitleBlock: regionKinds.includes("title_block"),
        hasDrawingField: regionKinds.includes("drawing_field"),
        hasNotesBand: regionKinds.includes("notes_band") || regionKinds.includes("notes"),
        hasOverlay: Boolean(sheet?.overlayWritten),
        associationsPresent: (sheet?.associatedBlocks || 0) > 0,
      },
    };
  });
}

export function recommendFullLayoutReadiness(summary) {
  const coverage = summary.coverage || {};
  const pdfTarget = coverage.pdfFiles || summary.accountability?.pdfFiles || 0;
  const processed = coverage.sheetsProcessed || 0;
  const overlays = coverage.sheetsWithOverlays || 0;
  const regions = coverage.sheetsWithRegions || 0;
  const failures = (summary.failures || []).length;
  const ready = pdfTarget === 82
    && processed === pdfTarget
    && overlays === pdfTarget
    && regions >= Math.ceil(pdfTarget * 0.9)
    && failures === 0
    && summary.accountability?.findings === 252
    && summary.accountability?.findingsUnchanged
    && summary.accountability?.s204IdentityCount === 2
    && summary.accountability?.s300MatchMethod === "unmatched_file";
  return {
    decision: ready ? "layout_full_ready_for_2a5_prep" : "layout_full_needs_attention",
    rationale: ready
      ? "All 82 PDFs have band layout pages, overlays, and associations. Semantic paraphrase prep may proceed after approval; grounding remains Not measured."
      : "Full layout coverage, overlays, failures, or S-204/S-300 accountability gates are incomplete.",
    readyForSemanticGroundingPrep: ready,
    startPhase2A5: false,
    precision: "Not measured",
    recall: "Not measured",
    toolsUsed: summary.toolsUsed,
    toolsSkipped: summary.toolsSkipped,
  };
}

function renderUnresolvedJsonl(sheets, failures, pageByPath) {
  const lines = [];
  for (const failure of failures) {
    lines.push(JSON.stringify({ kind: "processing_failure", ...failure }));
  }
  for (const sheet of sheets) {
    if (!["processed", "cached"].includes(sheet.status)) {
      lines.push(JSON.stringify({
        kind: "sheet_not_processed",
        relativePath: sheet.relativePath,
        status: sheet.status,
      }));
      continue;
    }
    if (!sheet.overlayWritten) {
      lines.push(JSON.stringify({
        kind: "missing_overlay",
        relativePath: sheet.relativePath,
        sha256: sheet.sha256,
      }));
    }
    if ((sheet.regionCount || 0) < 3) {
      lines.push(JSON.stringify({
        kind: "weak_regions",
        relativePath: sheet.relativePath,
        regionCount: sheet.regionCount || 0,
      }));
    }
    const page = pageByPath.get(sheet.relativePath);
    if ((sheet.unassignedBlocks || 0) > 0) {
      lines.push(JSON.stringify({
        kind: "unassigned_text_blocks",
        relativePath: sheet.relativePath,
        unassignedBlocks: sheet.unassignedBlocks,
        note: "Unassigned text is unresolved for region association, not deleted.",
      }));
    }
    if (page && (page.counts?.ocrBlocks || 0) === 0 && (page.counts?.textBlocks || 0) === 0) {
      lines.push(JSON.stringify({
        kind: "no_text_or_ocr_blocks",
        relativePath: sheet.relativePath,
      }));
    }
  }
  return `${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function renderLayoutReconciliation(summary) {
  const lines = [];
  lines.push("# Phase 2A.4 layout reconciliation");
  lines.push("");
  lines.push(`Inventory files: ${summary.accountability.inventoryFiles} (walked ${summary.accountability.walkedFiles})`);
  lines.push(`PDF files: ${summary.accountability.pdfFiles}`);
  lines.push(`Findings preserved: ${summary.accountability.findings}`);
  lines.push(`S-204.00 identity count: ${summary.accountability.s204IdentityCount}`);
  lines.push(`S-300.00 match: ${summary.accountability.s300MatchMethod}`);
  lines.push(`Archive.zip present: ${summary.accountability.archivePresent}`);
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push(`- sheets processed: ${summary.coverage.sheetsProcessed}/${summary.coverage.sheetsRequested}`);
  lines.push(`- overlays: ${summary.coverage.sheetsWithOverlays}`);
  lines.push(`- sheets with ≥3 regions: ${summary.coverage.sheetsWithRegions}`);
  lines.push(`- failures recorded: ${summary.coverage.sheetsFailed}`);
  lines.push("");
  lines.push("Archive.zip is inventoried and excluded from drawing-page layout.");
  lines.push("S-204.00 keeps dual published titles. S-300.00 stays unmatched.");
  lines.push("");
  return lines.join("\n");
}

export function renderFullLayoutReport(summary) {
  const lines = [];
  lines.push("# Phase 2A.4 full drawing layout reconstruction");
  lines.push("");
  lines.push("Content completeness: NOT COMPLETE");
  lines.push("Precision: Not measured");
  lines.push("Recall: Not measured");
  lines.push("");
  lines.push(summary.productionNote);
  lines.push(summary.labelPolicy);
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push(`- decision: ${summary.recommendation.decision}`);
  lines.push(`- ${summary.recommendation.rationale}`);
  lines.push(`- start Phase 2A.5: ${summary.recommendation.startPhase2A5 === false ? "no (awaiting approval)" : summary.recommendation.startPhase2A5}`);
  lines.push(`- tools used: ${(summary.toolsUsed || []).join(", ")}`);
  for (const skipped of summary.toolsSkipped || []) lines.push(`- skipped: ${skipped}`);
  lines.push("");
  lines.push("## Guardrails");
  lines.push("");
  lines.push(`- inventory files: ${summary.accountability.inventoryFiles}`);
  lines.push(`- pdf files: ${summary.accountability.pdfFiles}`);
  lines.push(`- findings preserved: ${summary.accountability.findings}`);
  lines.push(`- S-204.00 in set: ${summary.accountability.s204InSet}; identity count ${summary.accountability.s204IdentityCount}`);
  lines.push(`- S-300.00 match: ${summary.accountability.s300MatchMethod}`);
  lines.push(`- Archive.zip present: ${summary.accountability.archivePresent}`);
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push(`- processed: ${summary.coverage.sheetsProcessed}/${summary.coverage.sheetsRequested}`);
  lines.push(`- overlays: ${summary.coverage.sheetsWithOverlays}`);
  lines.push(`- region-ready (≥3): ${summary.coverage.sheetsWithRegions}`);
  lines.push(`- association-ready: ${summary.coverage.sheetsWithAssociations}`);
  lines.push(`- explicit relationship sheets: ${summary.coverage.sheetsWithExplicitRelationships}`);
  lines.push(`- failures: ${summary.coverage.sheetsFailed}`);
  lines.push("");
  lines.push("## Evidence grounding");
  lines.push("");
  lines.push(`- findings covered by layout pages: ${summary.grounding.coveredFindings}`);
  lines.push(`- baseline matches: ${summary.grounding.baselineMatched}`);
  lines.push(`- layout-region span matches: ${summary.grounding.layoutMatched}`);
  lines.push("- grounding improved claim: false");
  lines.push("- paraphrase candidates are in semantic-prep.json and are not counted as grounding");
  lines.push("");
  lines.push("## Discipline validation samples");
  lines.push("");
  lines.push("| File | Discipline | Status | Regions | Assocs | Explicit rels | Overlay | Title | Field | Notes |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |");
  for (const sample of summary.validationSamples || []) {
    lines.push(`| ${sample.relativePath} | ${sample.discipline} | ${sample.status} | ${sample.regionCount} | ${sample.associatedBlocks} | ${sample.explicitRelationshipCandidates} | ${sample.overlayWritten ? "yes" : "no"} | ${sample.checks?.hasTitleBlock ? "yes" : "no"} | ${sample.checks?.hasDrawingField ? "yes" : "no"} | ${sample.checks?.hasNotesBand ? "yes" : "no"} |`);
  }
  lines.push("");
  lines.push("## Performance");
  lines.push("");
  lines.push(`- average sheet ms: ${summary.performance.averageSheetMs}`);
  lines.push(`- total ms: ${summary.performance.totalMs}`);
  lines.push("");
  lines.push("Relationships remain candidates. Proximity alone is not proof.");
  lines.push("");
  return lines.join("\n");
}

export function renderLayoutComparison(summary) {
  const lines = [];
  lines.push("# Phase 2A.3 layout reconstruction pilot");
  lines.push("");
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
  lines.push(`- tools used: ${summary.toolsUsed.join(", ")}`);
  for (const skipped of summary.toolsSkipped || []) lines.push(`- skipped: ${skipped}`);
  lines.push("");
  lines.push("## Guardrails");
  lines.push("");
  lines.push(`- inventory files: ${summary.accountability.inventoryFiles}`);
  lines.push(`- pdf files: ${summary.accountability.pdfFiles}`);
  lines.push(`- findings preserved: ${summary.accountability.findings}`);
  lines.push(`- S-204.00 in pilot: ${summary.accountability.s204InPilot}`);
  lines.push(`- Archive.zip present: ${summary.accountability.archivePresent}`);
  lines.push("");
  lines.push("## Evidence grounding (pilot sheets)");
  lines.push("");
  lines.push(`- pilot findings: ${summary.grounding.pilotFindings}`);
  lines.push(`- baseline matches: ${summary.grounding.baselineMatched}`);
  lines.push(`- layout-region matches: ${summary.grounding.layoutMatched}`);
  lines.push("");
  lines.push("## Sheets");
  lines.push("");
  lines.push("| File | Discipline | Regions | Schedule candidates | Clusters | Associated blocks | Relationships | Overlay | Time ms |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |");
  for (const sheet of summary.sheets) {
    lines.push(`| ${sheet.relativePath} | ${sheet.discipline} | ${sheet.regionCount ?? ""} | ${sheet.scheduleCandidates ?? ""} | ${sheet.clusterCount ?? ""} | ${sheet.associatedBlocks ?? ""} | ${sheet.relationshipCandidates ?? ""} | ${sheet.overlayWritten ? "yes" : "no"} | ${sheet.timingMs ?? ""} |`);
  }
  lines.push("");
  lines.push("## Performance");
  lines.push("");
  lines.push(`- average sheet ms: ${summary.performance.averageSheetMs}`);
  lines.push(`- total ms: ${summary.performance.totalMs}`);
  lines.push("");
  lines.push("Relationships are candidates. Shared note numbers or explicit sheet references are required; proximity alone is not proof.");
  lines.push("");
  return lines.join("\n");
}
