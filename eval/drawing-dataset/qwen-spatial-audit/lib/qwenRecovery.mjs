/**
 * Adapters between the Qwen sheet index (stage 2) and the existing evaluation and v2 evidence code.
 *
 * qwenRecovery: Qwen lines as a recovery page, so the unchanged v2 evidence construction (rows,
 * annotation model, digest, analyzer block) runs on Qwen text exactly as it runs on Apple Vision 4x3.
 * A cross-tile conflicting reading is added as a second line at the same box, which the v2 model
 * renders as `{A | B}`; a self-reported uncertain line gets confidence 0.5.
 */
import { clean } from "../../lib/stage3EvidenceEval.mjs";

const pageBox = (b, pageWidth, pageHeight) => ({ ...b, unit: "pdf-point", origin: "bottom-left", pageWidth, pageHeight });

export function qwenRecovery(index) {
  const { width: pageWidth, height: pageHeight } = index.page;
  const words = [], lines = [];
  for (const l of index.lines) {
    const readings = [l.text, ...(l.conflict ? l.alternatives : [])];
    for (const text of readings) {
      const confidence = l.uncertain ? 0.5 : 1;
      const box = pageBox(l.box, pageWidth, pageHeight);
      words.push({ text, confidence, box, engine: `qwen:${index.backend}`, origin: "visual_interpretation", independentlyVerified: false, lid: l.lid });
      lines.push({ text, box: l.box, confidence, words: 1, vertical: Boolean(l.vertical), origin: "visual_interpretation", independentlyVerified: false });
    }
  }
  return { pages: [{ engine: `qwen:${index.backend}`, pageWidth, pageHeight, words, lines }] };
}

/** Every Qwen line as one delivered item; conflicting readings are marked like v2 conflicts. */
export function qwenLineItems(index) {
  return index.lines.map((l) => {
    const segs = l.conflict
      ? [l.text, ...l.alternatives].map((t) => ({ text: clean(t), words: [{ text: t, box: l.box }], marker: "conflict" }))
      : [{ text: clean(l.text), words: [{ text: l.text, box: l.box }], ...(l.uncertain ? { marker: "uncertain" } : {}) }];
    return { id: l.lid, segments: segs };
  });
}

/** Page boxes of the tiles stage 2 actually read. */
export function readTileBoxes(index, stage1) {
  const read = new Set(index.tileReports.map((t) => t.tileId));
  return stage1.tiles.filter((t) => read.has(t.id)).map((t) => t.pageBox);
}

const inside = (b, w) => {
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  return cx >= w.x && cx <= w.x + w.width && cy >= w.y && cy <= w.y + w.height;
};

/** Ground truth restricted to rows whose centre lies in a read tile (annotations keep only fully covered ones). */
export function restrictGroundTruth(gt, boxes) {
  const rows = gt.rows.filter((r) => boxes.some((b) => inside(r.box, b)));
  const keep = new Set(rows.map((r) => r.gid));
  const annotations = gt.annotations.filter((a) => a.rows.every((g) => keep.has(g)));
  const annRows = new Set(annotations.flatMap((a) => a.rows));
  return { ...gt, rows: rows.filter((r) => annRows.has(r.gid)), annotations, restrictedTo: boxes.length };
}
