/**
 * Associate text/OCR blocks with layout regions and propose technical relationships.
 * Proximity alone is never promoted to a verified relationship.
 */

const SHEET_REF_RE = /\b(?:see|refer(?:ence)?\s+to|detail|section|elevation)\b[^.\n]{0,40}?\b([A-Z]{1,4}-?\d{1,3}(?:\.\d{1,3})?(?:-\d{1,2})?)\b/gi;
const NOTE_NUM_RE = /^\s*(\d{1,2})[.)\s]/;
const DIMENSION_RE = /\b\d+(?:\s*\d+\/\d+)?\s*(?:'|′|ft|in|"|”|mm|cm)\b|\b\d+\s*["”]\s*=\s*\d+/i;
const SCHEDULE_WORD_RE = /\bschedule\b/i;
const DETAIL_WORD_RE = /\b(?:detail|section|elevation)\b/i;
const NOTES_WORD_RE = /\b(?:general notes?|keyed notes?|notes?)\b/i;
/** Explicit equipment / panel style tags only; proximity never invents a link. */
const EQUIPMENT_TAG_RE = /\b(?:AHU|EF|SF|RF|RTU|VAV|CU|FCU|WH|EQ|PMP|HP|UH|MAU|ERU|PANEL|PNL|XFMR|DISC|ATS|UPS)-[A-Z0-9]{1,8}\b/gi;

export function boxCenter(box) {
  if (!box) return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width ?? box.w) || 0;
  const height = Number(box.height ?? box.h) || 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: x + width / 2, y: y + height / 2, width, height };
}

export function containsPoint(regionBox, point) {
  if (!regionBox || !point) return false;
  return point.x >= regionBox.x
    && point.x <= regionBox.x + regionBox.width
    && point.y >= regionBox.y
    && point.y <= regionBox.y + regionBox.height;
}

export function iou(left, right) {
  if (!left || !right) return 0;
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const union = left.width * left.height + right.width * right.height - inter;
  return union > 0 ? inter / union : 0;
}

export function classifyTextCluster(texts) {
  const joined = texts.join("\n");
  if (SCHEDULE_WORD_RE.test(joined)) return "schedule_text";
  if (DETAIL_WORD_RE.test(joined) && texts.length <= 8) return "detail_callout_text";
  if (NOTES_WORD_RE.test(joined)) return "notes_text";
  if (texts.some((text) => DIMENSION_RE.test(text))) return "dimension_text";
  return "text_cluster";
}

export function clusterTextBlocks(blocks, gap = 36) {
  const items = [];
  for (const block of blocks || []) {
    if (!block?.text || !block.bbox) continue;
    if (!["text_span", "ocr_line", "layout_item"].includes(block.kind) && block.kind !== "annotation") continue;
    const center = boxCenter(block.bbox);
    if (!center) continue;
    items.push({ block, center, text: String(block.text).trim() });
  }
  items.sort((left, right) => right.center.y - left.center.y || left.center.x - right.center.x);
  const clusters = [];
  for (const item of items) {
    let best = null;
    let bestDist = Infinity;
    for (const cluster of clusters) {
      const dx = Math.abs(item.center.x - cluster.cx);
      const dy = Math.abs(item.center.y - cluster.cy);
      const dist = Math.hypot(dx, dy);
      if (dx <= gap * 4 && dy <= gap * 1.5 && dist < bestDist) {
        best = cluster;
        bestDist = dist;
      }
    }
    if (!best) {
      clusters.push({
        id: `cluster-${clusters.length}`,
        items: [item],
        cx: item.center.x,
        cy: item.center.y,
        texts: [item.text],
      });
      continue;
    }
    best.items.push(item);
    best.texts.push(item.text);
    const n = best.items.length;
    best.cx = best.items.reduce((sum, entry) => sum + entry.center.x, 0) / n;
    best.cy = best.items.reduce((sum, entry) => sum + entry.center.y, 0) / n;
  }
  return clusters.map((cluster) => {
    const xs = cluster.items.map((item) => item.block.bbox.x);
    const ys = cluster.items.map((item) => item.block.bbox.y);
    const rights = cluster.items.map((item) => item.block.bbox.x + (item.block.bbox.width || 0));
    const tops = cluster.items.map((item) => item.block.bbox.y + (item.block.bbox.height || 0));
    const bbox = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...rights) - Math.min(...xs),
      height: Math.max(...tops) - Math.min(...ys),
      unit: "pdf-point",
      origin: "bottom-left",
    };
    return {
      id: cluster.id,
      kind: classifyTextCluster(cluster.texts),
      text: cluster.texts.join("\n"),
      itemCount: cluster.items.length,
      bbox,
      origins: [...new Set(cluster.items.map((item) => item.block.origin).filter(Boolean))],
      extractionMethods: [...new Set(cluster.items.map((item) => item.block.extractionMethod).filter(Boolean))],
      independentlyVerified: false,
      observationStatus: "machine_clustered",
    };
  });
}

export function associateBlocksToRegions(blocks, regions) {
  const associations = [];
  const usable = (regions || []).filter((region) => region.kind !== "projection_split");
  for (const block of blocks || []) {
    if (!block?.bbox) continue;
    const center = boxCenter(block.bbox);
    if (!center) continue;
    const containing = usable.filter((region) => containsPoint(region.bbox, center));
    // Prefer the smallest containing region that is not the whole drawing field when a tighter region exists.
    containing.sort((left, right) => (left.bbox.width * left.bbox.height) - (right.bbox.width * right.bbox.height));
    let chosen = containing[0] || null;
    if (containing.length > 1) {
      const nonField = containing.find((region) => region.kind !== "drawing_field");
      if (nonField) chosen = nonField;
    }
    let method = chosen ? "point_in_region" : "unassigned";
    let score = chosen ? 1 : 0;
    if (!chosen) {
      let best = null;
      let bestIou = 0;
      for (const region of usable) {
        const value = iou(block.bbox, region.bbox);
        if (value > bestIou) {
          bestIou = value;
          best = region;
        }
      }
      if (best && bestIou >= 0.15) {
        chosen = best;
        method = "bbox_iou";
        score = bestIou;
      }
    }
    associations.push({
      blockKind: block.kind,
      text: block.text || "",
      bbox: block.bbox,
      origin: block.origin || null,
      extractionMethod: block.extractionMethod || null,
      regionId: chosen?.id || null,
      regionKind: chosen?.kind || null,
      associationMethod: method,
      associationScore: Math.round(score * 1000) / 1000,
      independentlyVerified: false,
      note: method === "unassigned"
        ? "Text was not inside a detected region."
        : "Geometric containment/overlap only. Not a verified technical association.",
    });
  }
  return associations;
}

export function proposeRelationships({ clusters, associations, regions, relativePath }) {
  const relationships = [];
  const push = (partial) => {
    relationships.push({
      independentlyVerified: false,
      verificationStatus: "candidate",
      confidence: "hypothesis",
      note: "Candidate only. Geometric proximity alone is not treated as proof.",
      ...partial,
    });
  };

  for (const cluster of clusters || []) {
    SHEET_REF_RE.lastIndex = 0;
    const refs = [...String(cluster.text || "").matchAll(SHEET_REF_RE)];
    for (const match of refs) {
      push({
        id: `sheet-ref:${cluster.id}:${match[1]}`,
        type: "sheet_reference",
        basis: "explicit_textual_reference",
        source: { clusterId: cluster.id, text: match[0], regionHint: null },
        target: { sheetToken: match[1], relativePathHint: null },
        evidence: [match[0]],
      });
    }
  }

  const noteClusters = (clusters || []).filter((cluster) => cluster.kind === "notes_text" || NOTE_NUM_RE.test(cluster.text.split("\n")[0] || ""));
  const fieldAssocs = (associations || []).filter((item) => item.regionKind === "drawing_field" && /^\s*\d{1,2}\b/.test(item.text || ""));
  for (const note of noteClusters) {
    const lines = String(note.text || "").split("\n");
    for (const line of lines) {
      const numbered = line.match(NOTE_NUM_RE);
      if (!numbered) continue;
      const number = numbered[1];
      const callouts = fieldAssocs.filter((item) => new RegExp(`^\\s*${number}\\b`).test(item.text));
      if (!callouts.length) continue;
      push({
        id: `note-callout:${note.id}:${number}`,
        type: "note_number_to_callout",
        basis: "shared_note_number_token",
        source: { clusterId: note.id, noteNumber: number, text: line.slice(0, 160) },
        target: {
          calloutCount: callouts.length,
          sampleTexts: callouts.slice(0, 5).map((item) => item.text),
          association: "token_match_not_proximity",
        },
        evidence: [line.slice(0, 160), ...callouts.slice(0, 3).map((item) => item.text)],
      });
    }
  }

  for (const region of regions || []) {
    if (region.kind !== "schedule_candidate") continue;
    const inside = (associations || []).filter((item) => item.regionId === region.id && item.text);
    if (!inside.length) continue;
    const joined = inside.map((item) => item.text).join("\n");
    if (!SCHEDULE_WORD_RE.test(joined) && inside.length < 6) continue;
    push({
      id: `schedule-text:${region.id}`,
      type: "schedule_region_text",
      basis: "text_inside_grid_hypothesis",
      source: { regionId: region.id, rulingSupported: true, scheduleWordPresent: SCHEDULE_WORD_RE.test(joined) },
      target: { textCount: inside.length, sampleTexts: inside.slice(0, 5).map((item) => item.text) },
      evidence: inside.slice(0, 5).map((item) => item.text),
      note: "Text falls inside a ruling-grid hypothesis. Not a verified schedule row mapping.",
    });
  }

  // Title-block identity stays observational, never rewritten.
  const titleText = (associations || []).filter((item) => item.regionKind === "title_block").map((item) => item.text).join(" ");
  if (titleText) {
    push({
      id: `title-block-text:${relativePath}`,
      type: "title_block_contents",
      basis: "text_inside_title_block_band",
      source: { regionKind: "title_block", relativePath },
      target: { chars: titleText.length },
      evidence: [titleText.slice(0, 240)],
      note: "Title-block band occupancy only. Does not reassign sheet identity.",
    });
  }

  // Shared explicit equipment tags across distinct clusters (not proximity).
  const tagIndex = new Map();
  for (const cluster of clusters || []) {
    EQUIPMENT_TAG_RE.lastIndex = 0;
    const tags = [...String(cluster.text || "").matchAll(EQUIPMENT_TAG_RE)].map((match) => match[0].toUpperCase());
    for (const tag of [...new Set(tags)]) {
      if (!tagIndex.has(tag)) tagIndex.set(tag, []);
      tagIndex.get(tag).push(cluster);
    }
  }
  for (const [tag, hits] of tagIndex) {
    if (hits.length < 2) continue;
    push({
      id: `equipment-tag:${tag}`,
      type: "equipment_tag_cooccurrence",
      basis: "shared_equipment_tag_token",
      source: { tag, clusterIds: hits.map((cluster) => cluster.id) },
      target: {
        occurrenceCount: hits.length,
        sampleTexts: hits.slice(0, 4).map((cluster) => String(cluster.text || "").slice(0, 120)),
      },
      evidence: hits.slice(0, 4).map((cluster) => String(cluster.text || "").slice(0, 120)),
      note: "Same equipment/tag token appears in multiple clusters. Not a verified connection or schedule row.",
    });
  }

  return relationships;
}

export function groundEvidenceInRegions(evidence, associations) {
  const needle = String(evidence || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (needle.length < 12) {
    return { status: "not_checked", reason: "evidence_too_short", independentlyVerified: false };
  }
  for (const item of associations || []) {
    const hay = String(item.text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!hay) continue;
    if (hay.includes(needle)) {
      return {
        status: "span_found_in_region",
        regionId: item.regionId,
        regionKind: item.regionKind,
        origin: item.origin,
        extractionMethod: item.extractionMethod,
        independentlyVerified: false,
        note: "Match against associated region text. Not a verified label.",
      };
    }
  }
  const words = needle.split(" ").filter((word) => word.length > 2);
  if (words.length >= 4) {
    const window = words.slice(0, 6).join(" ");
    for (const item of associations || []) {
      const hay = String(item.text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (hay.includes(window)) {
        return {
          status: "partial_span_in_region",
          regionId: item.regionId,
          regionKind: item.regionKind,
          origin: item.origin,
          extractionMethod: item.extractionMethod,
          independentlyVerified: false,
          note: "Partial match against associated region text. Not a verified label.",
        };
      }
    }
  }
  return { status: "span_not_in_region_text", independentlyVerified: false };
}
