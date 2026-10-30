/**
 * Authoritative drawing manifest for Stage 3 full-set OCR (local dataset).
 * Uses pages-manifest.json + layout-full coverage — never invents sheets.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalSheetKey } from "./identity.mjs";

export const STAGE3_MANIFEST_VERSION = "phase3.stage3-drawing-manifest.v1";

function sheetLabelFromPath(relativePath) {
  const base = path.basename(String(relativePath || ""), ".pdf");
  return canonicalSheetKey(base).raw || base;
}

/**
 * @param {string} datasetOut e.g. eval/drawing-dataset/out/mcd-649fdaa6
 */
export async function loadAuthoritativeDrawingManifest(datasetOut) {
  const root = path.resolve(datasetOut);
  const manifestPath = path.join(root, "pages-manifest.json");
  const coveragePath = path.join(root, "layout-full", "coverage.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`drawing_manifest_missing:${manifestPath}`);
  }
  const pages = JSON.parse(await readFile(manifestPath, "utf8"));
  const pdfs = pages.filter((row) => String(row.relativePath || "").toLowerCase().endsWith(".pdf"));
  const coverage = existsSync(coveragePath)
    ? JSON.parse(await readFile(coveragePath, "utf8"))
    : null;

  const sheets = pdfs.map((row) => ({
    id: sheetLabelFromPath(row.relativePath),
    relativePath: row.relativePath,
    sha256: String(row.sha256 || "").toLowerCase(),
    pageNumber: row.pageNumber || 1,
    layoutPagePath: path.join(root, "layout-full", "pages", `${row.sha256}.json`),
    disciplineHint: row.discipline || null,
  }));

  sheets.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const missingLayout = sheets.filter((sheet) => !existsSync(sheet.layoutPagePath));
  return {
    version: STAGE3_MANIFEST_VERSION,
    datasetOut: root,
    pdfSheetCount: sheets.length,
    inventoryWalkedFiles: coverage?.walkedFiles ?? null,
    inventoryPdfFiles: coverage?.pdfFiles ?? null,
    sheetsRequested: coverage?.sheetsRequested ?? null,
    discrepancyNote: coverage?.walkedFiles && coverage.pdfFiles
      ? `${coverage.walkedFiles} walked filesystem entries; ${coverage.pdfFiles} PDF drawings (non-PDF sidecars excluded).`
      : null,
    sheets,
    missingLayout,
    sourceFilesDir: path.join(root, "files"),
  };
}

export function resolvePdfPath(manifest, sheet, options = {}) {
  const sourceDir = options.sourceDir || manifest.sourceFilesDir;
  const candidate = path.join(sourceDir, sheet.relativePath);
  if (existsSync(candidate)) return candidate;
  if (options.fallbackSourceDir) {
    const alt = path.join(options.fallbackSourceDir, sheet.relativePath);
    if (existsSync(alt)) return alt;
  }
  return null;
}
