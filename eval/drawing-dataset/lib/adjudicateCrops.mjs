/**
 * Prepare reviewer crop manifests and optional PNG clips for adjudication.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PYTHON = path.resolve(here, "../.venv/bin/python");
const CROP_SCRIPT = path.resolve(here, "../python/crop_evidence.py");

export function pickCropTarget(record) {
  const candidates = record.retrieval?.candidates || record.candidates || [];
  const withBox = candidates.find((item) => item.bbox && Number(item.bbox.width) > 0 && Number(item.bbox.height) > 0);
  if (withBox) {
    return {
      source: "top_evidence_candidate",
      text: withBox.text || null,
      regionId: withBox.regionId || null,
      regionKind: withBox.regionKind || null,
      bbox: withBox.bbox,
      score: withBox.score ?? null,
      signals: withBox.signals || [],
    };
  }
  return {
    source: "none",
    text: null,
    regionId: null,
    regionKind: null,
    bbox: null,
    score: null,
    signals: [],
    note: "No candidate bbox available; reviewer should open the full sheet.",
  };
}

export function renderCropViaPython(pdfPath, outPath, bbox, options = {}) {
  if (typeof options.cropFn === "function") {
    return options.cropFn(pdfPath, outPath, bbox);
  }
  const pythonBin = options.pythonBin || DEFAULT_PYTHON;
  if (!existsSync(pythonBin) || !existsSync(CROP_SCRIPT)) {
    return { status: "python_unavailable", message: "Crop Python venv or script missing." };
  }
  if (!existsSync(pdfPath)) {
    return { status: "missing_pdf", message: `PDF not found: ${pdfPath}` };
  }
  const spawned = spawnSync(pythonBin, [
    CROP_SCRIPT,
    "--pdf", pdfPath,
    "--out", outPath,
    "--bbox-json", JSON.stringify(bbox),
  ], {
    encoding: "utf8",
    timeout: options.timeoutMs || 60000,
    maxBuffer: 5_000_000,
  });
  if (spawned.status !== 0) {
    try {
      return JSON.parse(String(spawned.stdout || "{}"));
    } catch {
      return {
        status: "failed",
        message: String(spawned.stderr || spawned.stdout || "crop failed").slice(0, 800),
      };
    }
  }
  try {
    return JSON.parse(spawned.stdout);
  } catch {
    return { status: "ok", outPath };
  }
}

export async function prepareRecordCrop(record, options = {}) {
  const target = pickCropTarget(record);
  const cropDir = options.cropDir;
  await mkdir(cropDir, { recursive: true });
  const manifest = {
    benchmarkId: record.benchmarkId,
    clientReportId: record.clientReportId,
    relativePath: record.relativePath,
    sourceFileSha256: record.sha256 || record.sourceFileSha256 || null,
    target,
    cropPath: null,
    cropStatus: "not_rendered",
    independentlyVerified: false,
  };
  if (!target.bbox || !options.sourceDir || !record.relativePath) {
    await writeFile(path.join(cropDir, `${record.benchmarkId}.json`), JSON.stringify(manifest, null, 2));
    return manifest;
  }
  const pdfPath = path.join(options.sourceDir, record.relativePath);
  const pngPath = path.join(cropDir, `${record.benchmarkId}.png`);
  if (!options.force && existsSync(pngPath)) {
    manifest.cropPath = pngPath;
    manifest.cropStatus = "cached";
    await writeFile(path.join(cropDir, `${record.benchmarkId}.json`), JSON.stringify(manifest, null, 2));
    return manifest;
  }
  if (options.renderCrops === false) {
    manifest.cropStatus = "coordinates_only";
    await writeFile(path.join(cropDir, `${record.benchmarkId}.json`), JSON.stringify(manifest, null, 2));
    return manifest;
  }
  const rendered = renderCropViaPython(pdfPath, pngPath, target.bbox, options);
  manifest.cropStatus = rendered.status || "failed";
  manifest.cropPath = rendered.status === "ok" || rendered.status === "cached" ? pngPath : null;
  manifest.render = rendered;
  await writeFile(path.join(cropDir, `${record.benchmarkId}.json`), JSON.stringify(manifest, null, 2));
  return manifest;
}
