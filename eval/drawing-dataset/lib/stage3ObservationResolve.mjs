/**
 * S4 observation resolution for overlapping OCR tiles (Stage 3 v2 path, opt-in).
 *
 * Input: the production-deduplicated words and the filtered reads they came from. Words that read
 * the same place (same orientation, boxes overlapping >= 50% of the smaller) form a location; within
 * a location, in order:
 *   S1 a read whose normalised text is contained in a longer read is dropped (fragment);
 *   S2 reads equal after normalisation keep the one with more support, then higher confidence;
 *   S3 a near-fragment (edit distance to a substring of a longer read <= 20% of its length) is dropped;
 *   S4 between reads of about the same length that differ by <= 15% (min 2 edits), a read with less
 *      support is dropped; ties keep both, and both reach the evidence model as competing readings.
 * Support is the number of filtered reads with the same normalised text at the same location, from
 * any tile. Nothing is corrected or invented: every kept word is a Vision read, with its own box and
 * confidence, plus its support and the tiles that agree with it.
 *
 * With tile geometry, one step runs before S1: a read cut off at an interior tile edge is continued
 * by a read from another tile that runs past that edge, when the two overlap in at least
 * CONTINUATION_MIN_OVERLAP identical characters. The continued word carries both source reads.
 * Without tile geometry the resolver is exactly the research S4.
 */

export const S4_RESOLVER_VERSION = "stage3-s4.v1";
export const S4_CONTINUATION_VERSION = "stage3-s4.v1+tile-edge-continuation";
export const S4_MIN_OVERLAP = 0.5;
export const CONTINUATION_MIN_OVERLAP = 8;
/** A read ends at a tile edge when its box is within this fraction of its text height of the edge. */
export const TILE_EDGE_HEIGHTS = 0.5;

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toUpperCase()
  .replace(/[″“”〃]/g, '"').replace(/[’‘`´]/g, "'").replace(/[—–]/g, "-")
  .replace(/^[-_.•\s]+/, "").replace(/[-_\s]+$/, "").trim();
export const s4Key = (s) => norm(s).replace(/\s+/g, "");
const isVertical = (w) => clean(w.text).replace(/\s/g, "").length >= 2 && w.box.height > 1.6 * w.box.width;

function overlapSmaller(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.width * a.height || 1, b.width * b.height || 1);
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const c = [i];
    for (let j = 1; j <= n; j += 1) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = c;
  }
  return p[n];
}

/** Edit distance from needle to the closest substring of hay. */
export function substringDistance(needle, hay) {
  const m = needle.length, n = hay.length;
  if (!m) return 0;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (needle[i - 1] === hay[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(...prev);
}

/** Locations: union-find over words of the same orientation whose boxes overlap enough. */
function locations(words) {
  const parent = words.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < words.length; i += 1) for (let j = i + 1; j < words.length; j += 1) {
    if (isVertical(words[i]) !== isVertical(words[j])) continue;
    if (overlapSmaller(words[i].box, words[j].box) >= S4_MIN_OVERLAP) parent[find(i)] = find(j);
  }
  const groups = new Map();
  words.forEach((w, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(w);
  });
  return [...groups.values()];
}

/** Reading-direction extent of a box: horizontal left to right, vertical bottom to top. */
function along(w) {
  const b = w.box;
  return isVertical(w) ? { start: b.y, end: b.y + b.height, thick: b.width } : { start: b.x, end: b.x + b.width, thick: b.height };
}

/** Which ends of a read are cut by an interior edge of its tile (not a page edge). */
function cutEnds(w, tile, page) {
  if (!tile) return { start: false, end: false };
  const vertical = isVertical(w);
  const a = along(w);
  const t0 = vertical ? tile.y : tile.x, t1 = vertical ? tile.y + tile.height : tile.x + tile.width;
  const p1 = vertical ? page.height : page.width;
  const near = TILE_EDGE_HEIGHTS * a.thick;
  return { start: t0 > 0.5 && a.start - t0 <= near, end: t1 < p1 - 0.5 && t1 - a.end <= near };
}

/** Text of `head` continued by `tail` when head's end overlaps tail's start exactly; else null. */
function continuedText(head, tail) {
  const h = clean(head), t = clean(tail);
  for (let i = 1; i < h.length; i += 1) {
    const overlap = h.length - i;
    if (overlap < CONTINUATION_MIN_OVERLAP) break;
    if (overlap >= t.length) continue;
    if (h.slice(i) === t.slice(0, overlap)) return h + t.slice(overlap);
  }
  return null;
}

const unionBox = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { ...a, x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

/**
 * Tile-edge continuation inside one location. A read cut at an interior tile edge, and a read of the
 * same orientation from another tile that runs past that edge, are joined when their texts overlap
 * exactly. Repeats until nothing changes. Returns the members and the continuation records.
 */
function continueAtTileEdges(ms, tiles, page) {
  const merged = [];
  let members = [...ms];
  for (let changed = true; changed;) {
    changed = false;
    for (const cut of members) {
      const ends = cutEnds(cut, tiles.get(cut.tileId), page);
      if (!ends.start && !ends.end) continue;
      const ac = along(cut);
      for (const other of members) {
        if (other === cut || other.tileId === cut.tileId || isVertical(other) !== isVertical(cut)) continue;
        const ao = along(other);
        const text = ends.end && ao.end > ac.end + 0.3 * ac.thick ? continuedText(cut.text, other.text)
          : ends.start && ao.start < ac.start - 0.3 * ac.thick ? continuedText(other.text, cut.text) : null;
        if (!text) continue;
        const word = {
          ...cut,
          text,
          key: s4Key(text),
          box: unionBox(cut.box, other.box),
          confidence: Math.min(Number(cut.confidence), Number(other.confidence)),
          support: Math.min(cut.support, other.support),
          agreeingTiles: [...new Set([...cut.agreeingTiles, ...other.agreeingTiles])].sort(),
          continuedFrom: [...(cut.continuedFrom || [{ text: cut.text, tileId: cut.tileId }]), ...(other.continuedFrom || [{ text: other.text, tileId: other.tileId }])],
          order: Math.min(cut.order, other.order),
        };
        merged.push({ text, from: word.continuedFrom.map((s) => s.text) });
        members = [...members.filter((m) => m !== cut && m !== other), word];
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return { members, merged };
}

const sameSpanVariant = (v, m) => Math.abs(v.key.length - m.key.length) <= Math.max(2, 0.1 * m.key.length)
  && lev(v.key, m.key) <= Math.max(2, Math.floor(0.15 * m.key.length));

/** S1-S4 within one location. Returns kept members and the suppressed ones with the rule and the read that won. */
function resolveLocation(ms) {
  const suppressed = [];
  const drop = (m, rule, by) => suppressed.push({ text: m.text, box: m.box, confidence: m.confidence, support: m.support, rule, keptText: by?.text ?? null });
  const s1 = ms.filter((m) => {
    const by = ms.find((v) => v !== m && v.key.length > m.key.length && v.key.includes(m.key));
    if (by) drop(m, "fragment", by);
    return !by;
  });
  const best = new Map();
  for (const m of s1) {
    const b = best.get(m.key);
    if (!b || m.support > b.support || (m.support === b.support && m.confidence > b.confidence)) best.set(m.key, m);
  }
  for (const m of s1) if (best.get(m.key) !== m) drop(m, "normalised_duplicate", best.get(m.key));
  const s2 = [...best.values()];
  const s3 = s2.filter((m) => {
    const by = s2.find((v) => v !== m && v.key.length > m.key.length && substringDistance(m.key, v.key) <= Math.max(1, Math.floor(m.key.length * 0.2)));
    if (by) drop(m, "near_fragment", by);
    return !by;
  });
  const kept = s3.filter((m) => {
    const by = s3.find((v) => v !== m && sameSpanVariant(v, m) && v.support > m.support);
    if (by) drop(m, "outvoted", by);
    return !by;
  });
  const tied = kept.filter((m) => kept.some((v) => v !== m && sameSpanVariant(v, m))).length;
  return { kept, suppressed, tied };
}

/**
 * Resolve production-deduplicated words with S4. `reads` are the filtered observations before
 * deduplication (text, box, optional tileId); they provide support and tile agreement.
 * `options.tiles` (tile id -> {x, y, width, height}) and `options.page` ({width, height}) enable
 * tile-edge continuation. Returns words in the input order, each with `support` and
 * `agreeingTiles`, and a report.
 */
export function resolveObservationsS4(deduped, reads, options = {}) {
  const tiles = !options.tiles || !options.page ? null
    : options.tiles instanceof Map ? options.tiles : new Map(Object.entries(options.tiles));
  const prepared = deduped.map((w, order) => {
    const key = s4Key(w.text);
    const agreeing = reads.filter((f) => s4Key(f.text) === key && overlapSmaller(f.box, w.box) >= S4_MIN_OVERLAP);
    return {
      ...w, key, order,
      support: agreeing.length,
      agreeingTiles: [...new Set(agreeing.map((f) => f.tileId).filter(Boolean))].sort(),
    };
  });
  const kept = [];
  const suppressed = [];
  const continuations = [];
  let multiReadLocations = 0, tiedReads = 0;
  const groups = locations(prepared);
  for (const group of groups) {
    if (group.length > 1) multiReadLocations += 1;
    let ms = group;
    if (tiles && group.length > 1) {
      const c = continueAtTileEdges(group, tiles, options.page);
      ms = c.members;
      continuations.push(...c.merged);
    }
    const r = resolveLocation(ms);
    kept.push(...r.kept);
    suppressed.push(...r.suppressed);
    tiedReads += r.tied;
  }
  const words = kept.sort((a, b) => a.order - b.order).map(({ key: _k, order: _o, ...w }) => w);
  const byRule = {};
  for (const s of suppressed) byRule[s.rule] = (byRule[s.rule] || 0) + 1;
  return {
    words,
    report: {
      resolver: tiles ? S4_CONTINUATION_VERSION : S4_RESOLVER_VERSION,
      continuations,
      reads: reads.length,
      deduplicated: deduped.length,
      locations: groups.length,
      multiReadLocations,
      kept: words.length,
      suppressedByRule: byRule,
      competingReadsKept: tiedReads,
      suppressed,
    },
  };
}
