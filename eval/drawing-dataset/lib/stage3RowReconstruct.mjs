/**
 * Stage 3 v2 rows: printed text rows with word-level provenance, built from the
 * recovery page (production 4x3 words and groupWordsIntoLines lines).
 */

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const r1 = (v) => Math.round(v * 10) / 10;
export const roundBox = (b) => ({ x: r1(b.x), y: r1(b.y), width: r1(b.width), height: r1(b.height) });

/** Words of a production line: same text pieces inside the line box. */
export function lineWords(line, words) {
  const eps = 0.01;
  const within = words.filter((w) => w.box.x >= line.box.x - eps && w.box.y >= line.box.y - eps
    && w.box.x + w.box.width <= line.box.x + line.box.width + eps
    && w.box.y + w.box.height <= line.box.y + line.box.height + eps);
  let rest = String(line.text);
  const used = [];
  for (const w of [...within].sort((a, b) => clean(b.text).length - clean(a.text).length)) {
    const t = clean(w.text);
    const i = rest.indexOf(t);
    if (!t || i < 0) continue;
    used.push(w);
    rest = rest.slice(0, i) + "\u0000".repeat(t.length) + rest.slice(i + t.length);
  }
  if (line.words != null && used.length !== line.words) return null;
  return used.sort((a, b) => (line.vertical ? a.box.y - b.box.y : a.box.x - b.box.x));
}

export const ROW_SPLIT_GAP = 1.5;

const unionBox = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
};

/** Split a line's words where the reading-direction gap exceeds ROW_SPLIT_GAP text heights (separate columns). */
export function splitLineWords(ws, vertical) {
  const along = (b) => (vertical ? [b.y, b.height, b.width] : [b.x, b.width, b.height]);
  const parts = [[ws[0]]];
  for (let i = 1; i < ws.length; i++) {
    const [p0, plen, ph] = along(ws[i - 1].box), [c0, , ch] = along(ws[i].box);
    if (c0 - (p0 + plen) > ROW_SPLIT_GAP * Math.max(ph, ch)) parts.push([]);
    parts.at(-1).push(ws[i]);
  }
  return parts;
}

/** Rows from a recovery page. Each row keeps its words (text, box, confidence) for provenance. */
export function rowsFromRecoveryPage(page) {
  const words = page?.words || [];
  const rows = [];
  for (const line of (page?.lines || []).filter((l) => clean(l.text) && l.box)) {
    const matched = lineWords(line, words);
    const parts = matched && matched.length > 1 ? splitLineWords(matched, line.vertical) : [matched || [{ text: line.text, box: line.box, confidence: line.confidence }]];
    for (const ws of parts) {
      rows.push({
        rid: `r${String(rows.length + 1).padStart(3, "0")}`,
        text: parts.length > 1 ? clean(ws.map((w) => w.text).join(" ")) : clean(line.text),
        box: roundBox(parts.length > 1 ? unionBox(ws.map((w) => w.box)) : line.box),
        vertical: Boolean(line.vertical),
        confidence: Math.min(...ws.map((w) => Number(w.confidence ?? 1))),
        words: ws.map((w) => ({ text: clean(w.text), box: roundBox(w.box), confidence: Number(w.confidence ?? 1) })),
        ...(parts.length > 1 ? { splitFrom: clean(line.text) } : {}),
      });
    }
  }
  return rows;
}
