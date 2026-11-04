/**
 * Stage 3 v2 technical digest: renders the evidence model into a bounded prompt block.
 *
 * - One line per annotation; " / " separates its printed rows. Annotations are never cut.
 * - {A | B} marks conflicting readings of one place; ?text marks a format or glyph doubt;
 *   (ctx?) marks an item whose relation to a neighbouring item is unconfirmed. The
 *   interpretation rules for these markers are stated by the analyzer v2 header.
 * - Selection is by technical priority within the character budget; what is left out is
 *   counted in an omission line.
 */
import { createHash } from "node:crypto";
import { STAGE3_EVIDENCE_V2, STAGE3_V2_BUDGET } from "./stage3EvidenceConfig.mjs";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const ROW_MAX = 160;
const OMISSION_RESERVE = 200;

export function renderRow(row) {
  const t = clean(row.text).slice(0, ROW_MAX);
  if (row.alternatives?.length) return `{${[t, ...row.alternatives.map((a) => clean(a.text).slice(0, ROW_MAX))].join(" | ")}}`;
  return row.uncertain?.length ? `?${t}` : t;
}

export function renderAnnotation(annotation, rowById) {
  const body = annotation.rows.map((rid) => renderRow(rowById.get(rid))).join(" / ");
  return `- ${body}${annotation.contextUncertain ? " (ctx?)" : ""}`;
}

const REGION_ORDER = { drawing_field: 0, graphical_component: 0, schedule_candidate: 1, notes_band: 2, title_block: 3 };

/**
 * Select and render. Returns the prompt block and the digest record (shown / omitted ids and counts).
 */
export function renderTechnicalDigest(model, options = {}) {
  const maxChars = options.maxChars ?? STAGE3_V2_BUDGET.maxCharsPerPack;
  const sheetId = options.sheetId || "sheet";
  const source = options.source || "4x3";
  const rowById = new Map(model.rows.map((r) => [r.rid, r]));
  const lines = new Map(model.annotations.map((a) => [a.aid, renderAnnotation(a, rowById)]));
  const technicalCount = model.annotations.filter((a) => a.technical).length;
  const headerFor = (shown) => `Stage3 OCR evidence v2 sheet=${sheetId} source=${source} annotations=${model.annotations.length} technical=${technicalCount} shown=${shown} independentlyVerified=false`;
  const budget = maxChars - headerFor(model.annotations.length).length - 1 - OMISSION_RESERVE;

  const candidates = [...model.annotations].sort((a, b) => b.priority - a.priority || lines.get(a.aid).length - lines.get(b.aid).length
    || (b.box.y + b.box.height) - (a.box.y + a.box.height) || a.box.x - b.box.x);
  const shown = new Set();
  let used = 0;
  for (const a of candidates) {
    const len = lines.get(a.aid).length + 1;
    if (used + len > budget) continue;
    shown.add(a.aid);
    used += len;
  }
  const shownList = model.annotations.filter((a) => shown.has(a.aid))
    .sort((a, b) => (REGION_ORDER[a.regionKind] ?? 0) - (REGION_ORDER[b.regionKind] ?? 0) || (b.box.y + b.box.height) - (a.box.y + a.box.height) || a.box.x - b.box.x);
  const omitted = model.annotations.filter((a) => !shown.has(a.aid));
  const omittedTech = omitted.filter((a) => a.technical);
  const byClass = {};
  for (const a of omittedTech) { const c = a.classes[0] || "numeric"; byClass[c] = (byClass[c] || 0) + 1; }
  const omissionLine = omitted.length
    ? `omitted: ${omitted.length} annotations (${omittedTech.length} technical${Object.keys(byClass).length ? `: ${Object.entries(byClass).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}; ${omitted.length - omittedTech.length} other) by budget; not shown is not absent`
    : "omitted: none";
  const block = [headerFor(shownList.length), ...shownList.map((a) => lines.get(a.aid)), omissionLine].join("\n");
  return {
    promptBlock: block,
    digest: {
      shown: shownList.map((a) => a.aid),
      omitted: omitted.map((a) => a.aid),
      annotations: model.annotations.length,
      technical: technicalCount,
      shownTechnical: shownList.filter((a) => a.technical).length,
      omittedTechnical: omittedTech.length,
      omittedByClass: byClass,
      conflictsShown: shownList.filter((a) => a.conflict).length,
      uncertainShown: shownList.filter((a) => a.uncertain.length).length,
      contextUncertainShown: shownList.filter((a) => a.contextUncertain).length,
      chars: block.length,
      maxChars,
    },
  };
}

const wordRecord = (w) => ({ text: w.text, box: w.box, confidence: w.confidence });

/**
 * Provenance for what the pack shows: shown annotations and their rows (box, confidence, classes,
 * markers, alternative readings, source words). Omitted annotations are listed by id in the digest;
 * the full model is reproducible from the cached recovery. Keeps packs under the storage bound.
 */
export function compactEvidenceModel(model, shownIds) {
  const shown = new Set(shownIds);
  const annotations = model.annotations.filter((a) => shown.has(a.aid));
  const rowIds = new Set(annotations.flatMap((a) => a.rows));
  const rows = model.rows.filter((r) => rowIds.has(r.rid)).map((r) => ({
    rid: r.rid,
    text: r.text,
    box: r.box,
    vertical: r.vertical,
    confidence: r.confidence,
    technical: r.technical,
    classes: r.classes,
    uncertain: r.uncertain,
    regionKind: r.regionKind,
    words: (r.words || []).map(wordRecord),
    alternatives: (r.alternatives || []).map((a) => ({ text: a.text, box: a.box, confidence: a.confidence, words: (a.words || []).map(wordRecord) })),
    absorbed: (r.absorbed || []).length,
    ...(r.splitFrom ? { splitFrom: r.splitFrom } : {}),
  }));
  return { scope: "shown", rowCount: model.rows.length, annotationCount: model.annotations.length, rows, annotations };
}

/** v2 pack envelope fields shared by the worker and the harness (the worker adds job identity). */
export function buildStage3V2Pack({ sheetId, model, source = "4x3", maxChars }) {
  const { promptBlock, digest } = renderTechnicalDigest(model, { sheetId, source, maxChars });
  const shownLines = promptBlock.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const id = `${sheetId}.technical_digest.${createHash("sha1").update(`${sheetId}|${STAGE3_EVIDENCE_V2}|${promptBlock}`).digest("hex").slice(0, 12)}`;
  return {
    id,
    sheetId,
    topic: "technical_digest",
    status: digest.shownTechnical ? "evidence_recovered" : digest.shown.length ? "partial_recovery" : "not_found",
    promptBlock,
    extractedTexts: shownLines.slice(0, 40),
    extractionVersion: STAGE3_EVIDENCE_V2,
    digest,
    evidenceModel: compactEvidenceModel(model, digest.shown),
    provenance: {
      origin: "visual_interpretation",
      method: "stage3_v2_annotation_digest",
      independentlyVerified: false,
      uncertainty: "Machine OCR. Annotations are geometric groupings; markers flag conflicts and format doubts. Not professionally verified.",
    },
    limitations: [
      "Machine OCR evidence; the PDF remains the primary input.",
      "Budgeted digest: omitted annotations are counted, not shown. Absence is not proof of absence.",
    ],
    independentlyVerified: false,
  };
}
