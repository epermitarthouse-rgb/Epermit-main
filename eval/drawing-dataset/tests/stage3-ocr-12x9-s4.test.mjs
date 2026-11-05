/**
 * Phase 4: opt-in 12x9 OCR resolved with S4 (v2 only), tile-edge continuation, the worker's fine
 * path with its 4x3 fallback, and the evidence-model rules added with it (model r3).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  RECOVERY_VERSION, dedupeOcrWords, recoverPdfFile, recoveryTiles, resolveRecoveryConfig, resolveRecoveryWords,
} from "../lib/ocrRecover.mjs";
import { S4_CONTINUATION_VERSION, S4_RESOLVER_VERSION, resolveObservationsS4 } from "../lib/stage3ObservationResolve.mjs";
import { resolveStage3EvidenceOptions, stage3ScopeArgs } from "../lib/stage3EvidenceConfig.mjs";
import {
  FINE_OCR_SOURCE, buildJobRecord, ensureWorkerDirs, fineRecoveryCachePath, produceV2Pack, resolveWorkerPaths, v2CacheKey,
} from "../lib/stage3MacOcrWorker.mjs";
import { dimensionLabelPair, similarReadings, tableCells, uncertaintyReasons } from "../lib/stage3AnnotationModel.mjs";

const box = (x, y, width, height = 9) => ({ x, y, width, height });
const read = (text, b, confidence = 0.9, tileId = undefined) => ({ text, box: b, confidence, ...(tileId ? { tileId } : {}) });

describe("OCR grid configuration", () => {
  it("keeps the production default and rejects 12x9 without S4", () => {
    assert.deepEqual(resolveRecoveryConfig({}), { ocrGrid: "4x3", resolution: "production", isDefault: true, recoveryVersion: RECOVERY_VERSION });
    assert.equal(resolveRecoveryConfig({ ocrGrid: "12x9", resolution: "s4" }).recoveryVersion, "phase4.recover.12x9-s4.1");
    assert.throws(() => resolveRecoveryConfig({ ocrGrid: "12x9" }), /ocr_grid_12x9_requires_s4/);
    assert.throws(() => resolveRecoveryConfig({ ocrGrid: "12x9", resolution: "production" }), /ocr_grid_12x9_requires_s4/);
    assert.throws(() => resolveRecoveryConfig({ ocrGrid: "8x6" }), /ocr_grid_unknown/);
    assert.throws(() => resolveRecoveryConfig({ resolution: "vote" }), /ocr_resolution_unknown/);
  });

  it("allows 12x9 only for v2 evidence, and always with S4", () => {
    assert.deepEqual(resolveStage3EvidenceOptions({ evidenceVersion: "v2", ocrGrid: "12x9" }).resolution, "s4");
    assert.throws(() => resolveStage3EvidenceOptions({ ocrGrid: "12x9" }), /stage3_ocr_grid_requires_v2/);
    assert.throws(() => resolveStage3EvidenceOptions({ evidenceVersion: "v2", ocrGrid: "12x9", resolution: "production" }), /requires_s4/);
  });

  it("maps a run's scope to worker arguments, ignoring 12x9 without v2 and unknown values", () => {
    const allow = { allowFineGrid: true };
    assert.deepEqual(stage3ScopeArgs({}), { analyzerVersion: "v1", evidenceVersion: "v1", ocrGrid: "4x3", syncArgs: [], buildArgs: [], ignored: [] });
    assert.deepEqual(stage3ScopeArgs({ stage3EvidenceVersion: "v2", stage3OcrGrid: "12x9" }, allow).buildArgs, ["--ocr-grid", "12x9"]);
    assert.deepEqual(stage3ScopeArgs({ stage3EvidenceVersion: "v2" }, allow).buildArgs, []);
    const v1Fine = stage3ScopeArgs({ stage3OcrGrid: "12x9" }, allow);
    assert.deepEqual([v1Fine.evidenceVersion, v1Fine.ocrGrid, v1Fine.syncArgs, v1Fine.buildArgs], ["v1", "4x3", [], []]);
    assert.deepEqual(v1Fine.ignored, [{ event: "ocr_grid_disabled", value: "12x9" }]);
    assert.deepEqual(stage3ScopeArgs({ stage3EvidenceVersion: "v3", stage3OcrGrid: "4x3" }).ignored, [{ event: "evidence_version_ignored", value: "v3" }]);
    assert.deepEqual(stage3ScopeArgs({ stage3EvidenceVersion: "v2", stage3OcrGrid: "24x18" }, allow).ocrGrid, "4x3");
  });

  it("keeps 12x9 off unless the worker allows it, and never for Supabase Analyzer V2 runs", () => {
    const fineByDefault = stage3ScopeArgs({ stage3EvidenceVersion: "v2", stage3OcrGrid: "12x9" });
    assert.deepEqual([fineByDefault.ocrGrid, fineByDefault.buildArgs], ["4x3", []]);
    assert.deepEqual(fineByDefault.ignored, [{ event: "ocr_grid_disabled", value: "12x9" }]);
    const analyzerV2 = stage3ScopeArgs({ analyzerVersion: "v2", stage3OcrGrid: "12x9" }, { allowFineGrid: true });
    assert.deepEqual(
      [analyzerV2.analyzerVersion, analyzerV2.evidenceVersion, analyzerV2.ocrGrid, analyzerV2.syncArgs, analyzerV2.buildArgs],
      ["v2", "v2", "4x3", ["--evidence-version", "v2"], []],
    );
  });

  it("renders 12x9 tiles at the scale of the 4x3 tile containing them", () => {
    const base = recoveryTiles(3024, 2160);
    const fine = recoveryTiles(3024, 2160, "12x9");
    assert.equal(base.length, 12);
    assert.equal(fine.length, 108);
    assert.equal(fine[0].id, "g12x9-r0c0");
    for (const t of fine) assert.equal(t.scale, base.find((b) => b.id === t.parentTileId).scale);
  });
});

describe("S4 observation resolution", () => {
  it("applies fragment, duplicate, near-fragment, support and tie rules within a location", () => {
    const at = box(100, 100, 80);
    const deduped = [
      read("GYP BOARD", at, 0.9), read("BOARD", box(140, 100, 40), 0.95),
      read('12" O.C.', box(100, 200, 40), 0.8), read("12″ O.C.", box(101, 200, 40), 0.9),
      read("CONCRETE SLAB", box(100, 300, 80), 0.9), read("CONCRFTE", box(100, 300, 50), 0.9),
      read("R-13 BATT", box(100, 400, 50), 0.9), read("R-18 BATT", box(101, 400, 50), 0.95),
      read("2X4 STUD", box(100, 500, 50), 0.9), read("2X6 STUD", box(101, 500, 50), 0.9),
    ];
    const reads = [...deduped, read("R-13 BATT", box(99, 400, 50), 0.7)];
    const { words, report } = resolveObservationsS4(deduped, reads);
    const texts = words.map((w) => w.text);
    assert.deepEqual(texts, ["GYP BOARD", "12″ O.C.", "CONCRETE SLAB", "R-13 BATT", "2X4 STUD", "2X6 STUD"]);
    assert.equal(words.find((w) => w.text === "12″ O.C.").support, 2);
    assert.deepEqual(report.suppressedByRule, { fragment: 1, normalised_duplicate: 1, near_fragment: 1, outvoted: 1 });
    assert.equal(report.competingReadsKept, 2);
    assert.equal(report.resolver, S4_RESOLVER_VERSION);
    assert.equal(words.find((w) => w.text === "R-13 BATT").support, 2);
  });

  it("is the production deduplication plus S4, and leaves the production path untouched", () => {
    const raw = [read("NOTES", box(10, 10, 40), 0.6), read("NOTES", box(11, 10, 40), 0.9), read("x", box(80, 10, 8), 0.2)];
    assert.deepEqual(resolveRecoveryWords(raw, "production"), { words: dedupeOcrWords(raw), report: null });
    const s4 = resolveRecoveryWords(raw, "s4");
    assert.equal(s4.words.length, 1);
    assert.equal(s4.words[0].support, 2);
  });
});

describe("tile-edge continuation", () => {
  const page = { width: 1000, height: 600 };
  const tiles = new Map([["A", box(0, 0, 520, 600)], ["B", box(480, 0, 520, 600)]]);
  const head = (text) => read(text, box(400, 100, 119), 0.9, "A");

  it("continues a read cut at an interior tile edge with the read that runs past it", () => {
    const words = [head("PROVIDE NEW MECHANICAL EQUIPME"), read("MECHANICAL EQUIPMENT", box(485, 100, 55), 0.8, "B")];
    const { words: out, report } = resolveObservationsS4(words, words, { tiles, page });
    assert.equal(report.resolver, S4_CONTINUATION_VERSION);
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "PROVIDE NEW MECHANICAL EQUIPMENT");
    assert.equal(out[0].confidence, 0.8);
    assert.deepEqual(out[0].continuedFrom.map((s) => s.tileId), ["A", "B"]);
    assert.deepEqual(report.continuations, [{ text: "PROVIDE NEW MECHANICAL EQUIPMENT", from: ["PROVIDE NEW MECHANICAL EQUIPME", "MECHANICAL EQUIPMENT"] }]);
  });

  it("does not join on a short overlap, away from a tile edge, or without tile geometry", () => {
    const short = [head("PROVIDE NEW EQUIPME"), read("EQUIPMENT PAD", box(485, 100, 55), 0.8, "B")];
    assert.equal(resolveObservationsS4(short, short, { tiles, page }).report.continuations.length, 0);
    const wide = new Map([["A", box(0, 0, 600, 600)], ["B", box(480, 0, 520, 600)]]);
    const words = [head("PROVIDE NEW MECHANICAL EQUIPME"), read("MECHANICAL EQUIPMENT", box(485, 100, 55), 0.8, "B")];
    assert.equal(resolveObservationsS4(words, words, { tiles: wide, page }).report.continuations.length, 0);
    assert.equal(resolveObservationsS4(words, words).report.continuations.length, 0);
  });
});

async function onePagePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText("GENERAL NOTES", { x: 40, y: 700, size: 11, font });
  return Buffer.from(await doc.save());
}

describe("12x9 page recovery", () => {
  const ocr = async () => ({ engine: "injected", words: [{ text: "NOTE", confidence: 0.9, x: 0.4, y: 0.4, width: 0.2, height: 0.1, origin: "bottom-left" }] });

  it("reads 108 tiles, keeps tile ids and S4 support, and leaves the default output unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ocr-12x9-"));
    try {
      const pdf = path.join(root, "T.pdf");
      await writeFile(pdf, await onePagePdf());
      const fine = (await recoverPdfFile(pdf, { ocr, ocrGrid: "12x9", resolution: "s4" })).pages[0];
      assert.equal(fine.recoveryVersion, "phase4.recover.12x9-s4.1");
      assert.equal(fine.tileOutcomes.length, 108);
      assert.deepEqual(fine.ocrConfig, { ocrGrid: "12x9", resolution: "s4", tiles: 108, rawWords: 108 });
      assert.equal(fine.resolutionReport.resolver, S4_CONTINUATION_VERSION);
      assert.ok(fine.words.every((w) => w.tileId?.startsWith("g12x9-r") && w.support >= 1));

      const coarse = await recoverPdfFile(pdf, { ocr });
      const page = coarse.pages[0];
      assert.equal(coarse.recoveryVersion, RECOVERY_VERSION);
      assert.equal(page.tileOutcomes.length, 12);
      assert.equal("ocrConfig" in page || "resolutionReport" in page, false);
      assert.ok(page.words.every((w) => !("tileId" in w) && !("support" in w)));
      await assert.rejects(recoverPdfFile(pdf, { ocr, ocrGrid: "12x9" }), /ocr_grid_12x9_requires_s4/);

      let call = 0;
      const flaky = async () => (++call === 1 ? { engine: "injected", words: [], failed: true } : ocr());
      const statuses = (await recoverPdfFile(pdf, { ocr: flaky, ocrGrid: "12x9", resolution: "s4" })).pages[0].tileOutcomes.map((t) => t.status);
      assert.equal(statuses[0], "ocr_failed");
      assert.equal(statuses.filter((s) => s === "ocr_ok").length, 107);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("worker 12x9 path", () => {
  const sheet = { id: "T-1", relativePath: "T-1.pdf", sha256: "abc123" };
  const line = (text, y) => ({ text, box: box(100, y, 120), confidence: 0.9, words: [{ text, box: box(100, y, 120), confidence: 0.9 }] });
  const fineRecovery = (tileOutcomes = [{ id: "g12x9-r0c0", status: "ocr_ok" }, { id: "g12x9-r0c1", status: "ocr_no_text" }]) => ({
    recoveryVersion: "phase4.recover.12x9-s4.1",
    pages: [{
      ocrAttempted: true, tileOutcomes, ocrConfig: { tiles: 108, rawWords: 2 },
      resolutionReport: { resolver: S4_CONTINUATION_VERSION, continuations: [], competingReadsKept: 0 },
      words: [], lines: [line('5/8" TYPE X GYP. BD.', 300)],
    }],
  });
  const coarseRecovery = { pages: [{ words: [], lines: [line('1/2" GYP. BD.', 300)] }] };

  async function withWorker(fn) {
    const root = await mkdtemp(path.join(tmpdir(), "worker-12x9-"));
    try {
      const paths = resolveWorkerPaths(root);
      await ensureWorkerDirs(paths);
      const pdfPath = path.join(root, "T-1.pdf");
      await writeFile(pdfPath, "%PDF-stub");
      await fn(paths, pdfPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it("records 12x9 on the job only for v2, with its own job id and cache key", () => {
    assert.throws(() => buildJobRecord(sheet, { ocrGrid: "12x9" }), /stage3_ocr_grid_requires_v2/);
    const v2 = buildJobRecord(sheet, { evidenceVersion: "v2" });
    const fine = buildJobRecord(sheet, { evidenceVersion: "v2", ocrGrid: "12x9" });
    assert.equal("ocrGrid" in v2, false);
    assert.equal(fine.ocrGrid, "12x9");
    assert.equal(fine.resolution, "s4");
    assert.notEqual(fine.id, v2.id);
    assert.equal(v2CacheKey("abc", false, FINE_OCR_SOURCE), `${v2CacheKey("abc", false)}.ocr-12x9-s4.${S4_CONTINUATION_VERSION}`);
  });

  it("builds v2 from the 12x9 recovery, caches the OCR, and does not repeat it on a forced rebuild", async () => {
    await withWorker(async (paths, pdfPath) => {
      let calls = 0;
      const recoverPdf = async (_file, config) => {
        calls += 1;
        assert.deepEqual(config, { ocrGrid: "12x9", resolution: "s4" });
        return fineRecovery();
      };
      const job = buildJobRecord(sheet, { evidenceVersion: "v2", ocrGrid: "12x9", pdfPath });
      const options = { pageGeometry: false, recoverPdf };
      const first = await produceV2Pack(paths, job, { layout: { regions: [] }, recovery: coarseRecovery }, options);
      assert.equal(first.status, "built");
      assert.equal(first.ocrSource, FINE_OCR_SOURCE);
      assert.equal(first.ocrFallbackReason, null);
      assert.equal(first.cacheKey, v2CacheKey(sheet.sha256, false, FINE_OCR_SOURCE));
      const pack = JSON.parse(await readFile(first.packPath, "utf8"));
      assert.equal(pack.provenance.ocr.used, FINE_OCR_SOURCE);
      assert.equal(pack.provenance.ocr.recoveryCacheHit, false);
      assert.match(pack.promptBlock, /5\/8" TYPE X GYP\. BD\./);
      assert.doesNotMatch(pack.promptBlock, /1\/2" GYP/);
      const cached = JSON.parse(await readFile(fineRecoveryCachePath(paths, sheet.sha256), "utf8"));
      assert.equal(cached.sha256, sheet.sha256);

      const rebuilt = await produceV2Pack(paths, job, { layout: { regions: [] } }, { ...options, force: true });
      assert.equal(calls, 1);
      assert.equal(JSON.parse(await readFile(rebuilt.packPath, "utf8")).provenance.ocr.recoveryCacheHit, true);
      const audit = (await readFile(paths.audit, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
      assert.ok(audit.every((e) => e.event !== "v2_pack" || e.ocrSource === FINE_OCR_SOURCE));
    });
  });

  for (const [name, setup, reason] of [
    ["the PDF is missing", { pdfPath: null }, "pdf_unavailable"],
    ["Vision is unavailable", { recovery: { pages: [{ ocrAttempted: false }] } }, "ocr_unavailable"],
    ["a tile failed", { recovery: fineRecovery([{ status: "ocr_ok" }, { status: "ocr_failed" }]) }, "ocr_tiles_failed:1"],
    ["the OCR run throws", { error: "vision crashed" }, "ocr_failed:vision crashed"],
  ]) {
    it(`falls back to the 4x3 recovery with the reason when ${name}`, async () => {
      await withWorker(async (paths, pdfPath) => {
        const job = buildJobRecord(sheet, { evidenceVersion: "v2", ocrGrid: "12x9", pdfPath: setup.pdfPath === null ? null : pdfPath });
        const recoverPdf = async () => {
          if (setup.error) throw new Error(setup.error);
          return setup.recovery;
        };
        const result = await produceV2Pack(paths, job, { layout: { regions: [] }, recovery: coarseRecovery }, { pageGeometry: false, recoverPdf });
        assert.equal(result.status, "built");
        assert.equal(result.ocrSource, "4x3");
        assert.equal(result.ocrFallbackReason, reason);
        assert.equal(result.cacheKey, v2CacheKey(sheet.sha256, false));
        const pack = JSON.parse(await readFile(result.packPath, "utf8"));
        assert.deepEqual(pack.provenance.ocr, { requested: FINE_OCR_SOURCE, used: "4x3", fallbackReason: reason });
        assert.match(pack.promptBlock, /1\/2" GYP\. BD\./);
      });
    });
  }

  it("leaves v2 without 12x9 on the 4x3 recovery with no OCR provenance", async () => {
    await withWorker(async (paths, pdfPath) => {
      const job = buildJobRecord(sheet, { evidenceVersion: "v2", pdfPath });
      const result = await produceV2Pack(paths, job, { layout: { regions: [] }, recovery: coarseRecovery }, {
        pageGeometry: false, recoverPdf: async () => assert.fail("12x9 OCR must not run"),
      });
      assert.equal(result.status, "built");
      assert.equal("ocrSource" in result, false);
      assert.equal("ocr" in JSON.parse(await readFile(result.packPath, "utf8")).provenance, false);
    });
  });
});

describe("evidence model rules for finer OCR (model r3)", () => {
  it("treats overlapping rows as one place only when their texts are similar", () => {
    assert.equal(similarReadings("FLATROOFSNOWLOAD", "FLATR00FSNOWLOAD"), true);
    assert.equal(similarReadings("TOROOFMEMBRANE", "VARIESVIF"), false);
    assert.equal(similarReadings("", "ANY"), false);
  });

  it("marks a bare dimension stacked against a descriptive label", () => {
    assert.equal(dimensionLabelPair('34"', "TOP OF GRAB BAR"), true);
    assert.equal(dimensionLabelPair("TOP OF GRAB BAR", "3'-6\""), true);
    assert.equal(dimensionLabelPair('34"', "MIN."), false);
    assert.equal(dimensionLabelPair('34"', "CLEAR"), false);
    assert.equal(dimensionLabelPair("2X4 STUD", "WOOD BLOCKING"), false);
  });

  it("flags misread inch, fraction and glyph shapes, and leaves clean values alone", () => {
    for (const t of ['7"-q"', '1 /4"', "SI 0.43", "{|15 MPH"]) assert.ok(uncertaintyReasons(t).includes("glyph"), t);
    for (const t of ['7\'-6"', '1/4"', "15 MPH", "SL 0.43", '24" MIN.']) assert.deepEqual(uncertaintyReasons(t), [], t);
  });

  it("takes a cell holding rows side by side out of the table row, and keeps the band's other cells", () => {
    const geometry = {
      horizontal: [100, 113, 126, 139, 152].map((y) => ({ y, x0: 100, x1: 400 })),
      vertical: [100, 200, 300, 400].map((x) => ({ x, y0: 100, y1: 152 })),
    };
    const row = (rid, text, x, y, width) => ({ rid, text, box: box(x, y, width), vertical: false });
    const stacked = tableCells([row("a", "1", 110, 115, 8), row("b", "ALUM.", 210, 115, 30)], geometry);
    assert.deepEqual([...stacked.keys()].sort(), ["a", "b"]);
    const sideBySide = tableCells([row("c", '24" MIN.', 110, 115, 30), row("d", '12"', 160, 115, 15), row("e", "ALUM.", 210, 115, 30)], geometry);
    assert.deepEqual([...sideBySide.keys()], ["e"]);
  });
});
