#!/usr/bin/env node
/**
 * Stage 3 OCR comparison harness (local validation only).
 * Fresh Vision OCR from original PDFs; optional PaddleOCR via sidecar;
 * Azure assessed but not invoked (no paid/third-party without approval).
 * Writes only under gitignored eval/drawing-dataset/out/.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recoverPdfFile } from "../lib/ocrRecover.mjs";
import {
  extractGuardrailDetailEvidence,
  extractDoorScheduleEvidence,
  extractHydraulicEvidence,
  formatStage3PromptBlock,
  evaluateCriticalControls,
} from "../lib/stage3VisualExtractionSpike.mjs";
import { associateBlocksToRegions } from "../lib/layoutAssociate.mjs";

const require = createRequire(import.meta.url);
const { ocrEngine, ensureVisionBinary } = require("../../../code-analyzer-worker/lib/ocr.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const datasetOut = path.resolve(repoRoot, "eval/drawing-dataset/out/mcd-649fdaa6");
const outDir = path.resolve(datasetOut, "phase3-ocr-compare");

const SHEETS = [
  {
    id: "A-3.06",
    relativePath: "A-3.06-00.pdf",
    sha256: "c20cc018310747ea435c888f7c1b1d4884ef8d1054b16da9ab770a504a33b6cf",
    topic: "guardrail",
  },
  {
    id: "A-6.00",
    relativePath: "A-6.00-00.pdf",
    sha256: "28369090ce34e1d503f9364bc293f9be51ff37bb521dd50a86968b472411c56d",
    topic: "door",
  },
  {
    id: "FP200",
    relativePath: "FP200 .pdf",
    sha256: "983bbfcf38083ff04c7b5c93092f2267f3d5776a01f92ff71411460107127dea",
    topic: "hydraulic",
  },
];

const HEIGHT_36 = /3\s*['′]\s*-?\s*6\s*"?\s*MIN\.?\s*HEIGHT/i;
const GUARD_TITLE = /\bGUARD\s*RAIL\s+(?:ELEVATION\s+)?DETAIL\b/i;
const HARDWARE =
  /\b(?:PANIC|LOCK(?:SET)?|SCHLAGE|V\.?\s*DUPRIN|ALARM\s+LOCK|ELEC\s+STRIKE|CLOSER)\b/i;
const FIRE = /\bFIRE[- ]RATED|\bFIRE\s*RATING|\bUL\s*LABEL|\bGASKETS?\s+FOR\s+DOOR/i;
const DOOR_MARK = /\bD\d{1,3}\b|\bEX-\d+\b/i;

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function scoreOcrText(sheetId, text) {
  const blob = String(text || "");
  if (sheetId === "A-3.06") {
    return {
      height36Min: HEIGHT_36.test(blob),
      guardRailTitle: GUARD_TITLE.test(blob),
      heightSnippet: (blob.match(HEIGHT_36) || [null])[0],
      titleSnippet: (blob.match(GUARD_TITLE) || [null])[0],
    };
  }
  if (sheetId === "A-6.00") {
    return {
      hardware: HARDWARE.test(blob),
      fire: FIRE.test(blob),
      doorMarks: DOOR_MARK.test(blob),
      hardwareCount: (blob.match(new RegExp(HARDWARE.source, "gi")) || []).length,
      fireCount: (blob.match(new RegExp(FIRE.source, "gi")) || []).length,
      markCount: (blob.match(new RegExp(DOOR_MARK.source, "gi")) || []).length,
    };
  }
  return {
    density: /\b0\.15\b/.test(blob),
    area: /\b1524\b/.test(blob),
    flowDemand: /\bFLOW\s*DEMAND\b/i.test(blob) || /\b\d{3,4}\s*GPM\b/i.test(blob),
  };
}

function ocrBlobFromRecovery(recovered) {
  const pages = recovered?.pages || [];
  const parts = [];
  for (const page of pages) {
    for (const line of page.lines || []) parts.push(line.text || "");
    for (const word of page.words || []) parts.push(word.text || "");
  }
  return parts.join("\n");
}

function rebuildAssociationsFromFreshOcr(cachedLayout, recovered) {
  const regions = cachedLayout.regions || [];
  // layout-full pages store associations, not raw blocks — reuse non-OCR text spans.
  const textBlocks = (cachedLayout.associations || [])
    .filter((item) => item.origin !== "visual_interpretation" && item.blockKind !== "ocr_line")
    .map((item) => ({
      kind: item.blockKind || "text_span",
      text: item.text,
      bbox: item.bbox,
      origin: item.origin || "machine_extracted",
      extractionMethod: item.extractionMethod || "pdfjs-text-layer",
      independentlyVerified: false,
    }));
  const ocrBlocks = [];
  for (const page of recovered.pages || []) {
    for (const line of page.lines || []) {
      if (!line?.text || !line?.box) continue;
      ocrBlocks.push({
        kind: "ocr_line",
        text: line.text,
        bbox: {
          x: line.box.x,
          y: line.box.y,
          width: line.box.width,
          height: line.box.height,
          unit: "pdf-point",
          origin: "bottom-left",
        },
        origin: "visual_interpretation",
        extractionMethod: page.engine || "macos-vision",
        independentlyVerified: false,
      });
    }
  }
  const blocks = [...textBlocks, ...ocrBlocks];
  const associations = associateBlocksToRegions(blocks, regions);
  return {
    ...cachedLayout,
    associations,
    counts: {
      ...(cachedLayout.counts || {}),
      ocrBlocks: ocrBlocks.length,
      textBlocks: textBlocks.length,
      associatedBlocks: associations.filter((item) => item.regionId).length,
      rebuiltFromFreshOcr: true,
    },
  };
}

async function runVisionFresh(sourceDir) {
  const visionBin = ensureVisionBinary();
  const engine = ocrEngine();
  const results = {};
  for (const sheet of SHEETS) {
    const pdfPath = path.join(sourceDir, sheet.relativePath);
    if (!existsSync(pdfPath)) {
      results[sheet.id] = { status: "missing_pdf", path: pdfPath };
      continue;
    }
    const memBefore = process.memoryUsage();
    const t0 = Date.now();
    const recovered = await recoverPdfFile(pdfPath, {});
    const elapsedMs = Date.now() - t0;
    const memAfter = process.memoryUsage();
    const blob = ocrBlobFromRecovery(recovered);
    const score = scoreOcrText(sheet.id, blob);
    const recoveryPath = path.join(outDir, "vision-fresh", "recovery", `${sheet.sha256}.json`);
    await mkdir(path.dirname(recoveryPath), { recursive: true });
    await writeFile(recoveryPath, JSON.stringify({
      ...recovered,
      relativePath: sheet.relativePath,
      sha256: sheet.sha256,
      engine: recovered.pages?.[0]?.engine || engine,
      timingMs: elapsedMs,
      independentlyVerified: false,
    }, null, 2));

    const layoutPath = path.join(datasetOut, "layout-full/pages", `${sheet.sha256}.json`);
    let stage3 = null;
    if (existsSync(layoutPath)) {
      const cached = JSON.parse(await readFile(layoutPath, "utf8"));
      const rebuilt = rebuildAssociationsFromFreshOcr(cached, recovered);
      const rebuiltPath = path.join(outDir, "vision-fresh", "layout-pages", `${sheet.sha256}.json`);
      await mkdir(path.dirname(rebuiltPath), { recursive: true });
      await writeFile(rebuiltPath, JSON.stringify(rebuilt));
      if (sheet.topic === "guardrail") stage3 = extractGuardrailDetailEvidence(rebuilt);
      else if (sheet.topic === "door") stage3 = extractDoorScheduleEvidence(rebuilt);
      else stage3 = extractHydraulicEvidence(rebuilt);
      stage3.promptBlock = formatStage3PromptBlock(stage3);
      stage3.criticalControls = sheet.topic === "door" ? evaluateCriticalControls(stage3) : undefined;
      await writeFile(
        path.join(outDir, "vision-fresh", "packages", `${sheet.id}.json`),
        JSON.stringify(stage3, null, 2),
      );
    }

    results[sheet.id] = {
      status: "ok",
      engine: recovered.pages?.[0]?.engine || engine,
      visionBinaryPresent: Boolean(visionBin),
      elapsedMs,
      rssDeltaMb: Math.round(((memAfter.rss - memBefore.rss) / (1024 * 1024)) * 10) / 10,
      heapUsedMb: Math.round((memAfter.heapUsed / (1024 * 1024)) * 10) / 10,
      ocrChars: (recovered.pages || []).reduce((sum, page) => sum + (page.ocrChars || 0), 0),
      ocrLines: (recovered.pages || []).reduce((sum, page) => sum + (page.ocrLineCount || 0), 0),
      tileOutcomes: recovered.pages?.[0]?.tileOutcomes || [],
      phraseScore: score,
      stage3: stage3
        ? {
            status: stage3.status,
            detailIdentifier: stage3.detailIdentifier || stage3.assessment?.detailIdentifier || null,
            associationStatus: stage3.assessment?.status || null,
            applicableToGuardrail: stage3.assessment?.applicableToGuardrail || null,
            hits: stage3.hits || null,
            independentlyVerified: stage3.provenance?.independentlyVerified === false
              ? false
              : stage3.independentlyVerified ?? false,
          }
        : null,
    };
  }
  return results;
}

function runPaddleSidecar(sourceDir) {
  const venvPython = path.join(outDir, "venv-ocr/bin/python");
  const sidecar = path.join(outDir, "paddle_ocr_sidecar.py");
  if (!existsSync(venvPython) || !existsSync(sidecar)) {
    return { status: "sidecar_unavailable", reason: "venv or sidecar missing" };
  }
  const t0 = Date.now();
  const result = spawnSync(venvPython, [sidecar, "--source", sourceDir, "--out", path.join(outDir, "paddle")], {
    encoding: "utf8",
    timeout: 600_000,
    env: {
      ...process.env,
      PADDLEX_HOME: path.join(outDir, "paddlex-home"),
      HOME: path.join(outDir, "fake-home"),
    },
    maxBuffer: 20_000_000,
  });
  const elapsedMs = Date.now() - t0;
  let summary = null;
  const summaryPath = path.join(outDir, "paddle", "summary.json");
  if (existsSync(summaryPath)) {
    try {
      summary = JSON.parse(require("fs").readFileSync(summaryPath, "utf8"));
    } catch {
      summary = null;
    }
  }
  return {
    status: result.status === 0 ? "ok" : "failed",
    exitCode: result.status,
    elapsedMs,
    stderrTail: String(result.stderr || "").slice(-2000),
    stdoutTail: String(result.stdout || "").slice(-2000),
    summary,
  };
}

const azureAssessment = {
  tested: false,
  reason: "No Azure resource created; paid/third-party drawing exposure requires approval.",
  freeTierF0: {
    pagesPerMonth: 500,
    maxFileSizeMb: 4,
    maxPagesPerRequest: 2,
    note: "A-3.06/A-6.00/FP200 are single-page and under 4MB, so F0 size/page limits would allow a trial IF a free resource existed and high-res were unused.",
  },
  highResolution: {
    requiredForCadLettering: "likely for small CAD text on A1/A2/A3 drawings",
    billing: "Add-on capability; not free on F0 — can incur charges even when base F0 is free",
    source: "https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/add-on-capabilities",
  },
  privacy: {
    customerDrawingsLeaveTenant: true,
    approvalRequired: true,
    recommendation: "Do not send permit drawings to Azure without explicit approval",
  },
  productionFit: "NO-GO without approval; high-res add-on costs + third-party exposure outweigh benefit vs local Vision/Paddle",
};

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, "vision-fresh/packages"), { recursive: true });

  const sourceDir = argument(
    "--source",
    path.join(outDir, "source-subset"),
  );

  const platform = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    visionEngine: ocrEngine(),
    visionBinary: Boolean(ensureVisionBinary()),
    tesseractProbe: (() => {
      const probe = spawnSync("tesseract", ["--version"], { encoding: "utf8" });
      return !(probe.status !== 0 && probe.error);
    })(),
    railwayNote: "Railway nixpacks installs tesseract apt packages; Apple Vision is darwin-only and cannot run on Railway Linux.",
  };

  console.error("Running fresh Apple Vision OCR…");
  const vision = await runVisionFresh(sourceDir);
  await writeFile(path.join(outDir, "vision-fresh/results.json"), JSON.stringify(vision, null, 2));

  console.error("Running PaddleOCR sidecar (if available)…");
  const paddle = runPaddleSidecar(sourceDir);
  await writeFile(path.join(outDir, "paddle-results.json"), JSON.stringify(paddle, null, 2));

  // Cached-layout baseline (prior Stage 3 spike) for regression comparison
  const cachedBaseline = {};
  for (const sheet of SHEETS) {
    const layoutPath = path.join(datasetOut, "layout-full/pages", `${sheet.sha256}.json`);
    if (!existsSync(layoutPath)) continue;
    const layout = JSON.parse(await readFile(layoutPath, "utf8"));
    let pack;
    if (sheet.topic === "guardrail") pack = extractGuardrailDetailEvidence(layout);
    else if (sheet.topic === "door") pack = extractDoorScheduleEvidence(layout);
    else pack = extractHydraulicEvidence(layout);
    cachedBaseline[sheet.id] = {
      status: pack.status,
      associationStatus: pack.assessment?.status || null,
      detailIdentifier: pack.detailIdentifier || pack.assessment?.detailIdentifier || null,
      hits: pack.hits || null,
      independentlyVerified: false,
    };
  }

  const report = {
    version: "phase3.stage3-ocr-compare.v1",
    generatedAt: new Date().toISOString(),
    sourceDir,
    platform,
    azureAssessment,
    cachedBaseline,
    visionFresh: vision,
    paddle,
    fp200Regression: {
      visionStatus: vision.FP200?.stage3?.status || null,
      independentlyVerifiedPreserved: vision.FP200?.stage3?.independentlyVerified === false,
      note: "Hydraulic pack must remain machine-extracted; density×area ≠ flow demand.",
    },
    railwayFeasibility: {
      appleVisionOnRailway: false,
      tesseractOnRailway: true,
      paddleOnRailway: "possible with larger image + model download; not currently packaged",
      recommendation: "Do not force Vision onto Railway. Prefer macOS OCR worker or cached evidence packages ingested by Supabase analyzer.",
    },
  };

  await writeFile(path.join(outDir, "comparison-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    outDir,
    visionEngine: platform.visionEngine,
    sheets: Object.fromEntries(
      Object.entries(vision).map(([id, row]) => [id, {
        elapsedMs: row.elapsedMs,
        phraseScore: row.phraseScore,
        stage3: row.stage3,
      }]),
    ),
    paddleStatus: paddle.status,
    azureTested: false,
  }, null, 2));
}

await main();
