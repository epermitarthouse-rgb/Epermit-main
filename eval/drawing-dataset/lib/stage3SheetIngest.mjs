/**
 * Stage 3 inputs for one drawing outside the prepared dataset (Supabase Analyzer V2 runs).
 *
 * Builds what the prepared set already has for its sheets, keyed by the drawing's SHA-256: the
 * production 4x3 OCR recovery and the layout page (detected regions with the text-layer and OCR
 * blocks associated to them, as in layout-full). Local only, under the gitignored worker root.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractPdfFile } from "./pdfExtract.mjs";
import { recoverPdfFile } from "./ocrRecover.mjs";
import { baselineBlocks, buildLayoutPageRecord, recoveryOcrBlocks, runLayoutPython } from "./layoutPilot.mjs";
import { LAYOUT_FULL_VERSION } from "./layoutSelect.mjs";

export const STAGE3_INGEST_VERSION = "phase3.stage3-sheet-ingest.v1";

export function ingestPaths(ingestRoot, contentSha256) {
  const dir = path.join(path.resolve(ingestRoot), String(contentSha256).toLowerCase());
  return {
    dir,
    recoveryPath: path.join(dir, "recovery.json"),
    layoutPagePath: path.join(dir, "layout.json"),
    regionsPath: path.join(dir, "regions.json"),
    overlayPath: path.join(dir, "overlay.png"),
  };
}

/**
 * Text layer, 4x3 OCR and layout for one PDF. Reuses a previous ingest of the same bytes. Throws when
 * the PDF cannot be opened or OCR did not run; a failed layout step leaves no regions (recorded in
 * layoutStatus), as in the prepared set.
 */
export async function ingestSheetPdf({ pdfPath, contentSha256, relativePath, ingestRoot }, deps = {}) {
  const sha256 = String(contentSha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("ingest_sha256_required");
  const paths = ingestPaths(ingestRoot, sha256);
  if (!deps.force && existsSync(paths.recoveryPath) && existsSync(paths.layoutPagePath)) {
    const layout = JSON.parse(await readFile(paths.layoutPagePath, "utf8"));
    return { ...paths, cacheHit: true, layoutStatus: layout.layoutStatus || null };
  }
  await mkdir(paths.dir, { recursive: true });

  const extracted = await (deps.extractPdf || extractPdfFile)(pdfPath);
  const baseline = extracted?.pages?.[0];
  if (extracted?.openStatus !== "opened" || !baseline) {
    throw new Error(`ingest_pdf_unreadable:${extracted?.openStatus || "unknown"}`);
  }
  const recovered = await (deps.recoverPdf || recoverPdfFile)(pdfPath, {});
  if (!recovered?.pages?.[0]?.ocrAttempted) throw new Error("ingest_ocr_unavailable");
  const recovery = { ...recovered, sha256, relativePath };

  const failed = await (deps.runLayout || runLayoutPython)(pdfPath, paths.regionsPath, paths.overlayPath, deps.layoutOptions || {});
  if (failed) await writeFile(paths.regionsPath, JSON.stringify(failed));
  const layout = JSON.parse(await readFile(paths.regionsPath, "utf8"));

  const page = buildLayoutPageRecord({
    layoutVersion: LAYOUT_FULL_VERSION,
    relativePath,
    sha256,
    layout,
    baseline,
    textBlocks: baselineBlocks(baseline),
    ocrBlocks: recoveryOcrBlocks(recovery),
    overlayPath: paths.overlayPath,
  });
  page.ingestVersion = STAGE3_INGEST_VERSION;
  await writeFile(paths.recoveryPath, JSON.stringify(recovery));
  await writeFile(paths.layoutPagePath, JSON.stringify(page));
  return { ...paths, cacheHit: false, layoutStatus: page.layoutStatus };
}
