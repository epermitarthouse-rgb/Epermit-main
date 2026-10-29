/**
 * Classify every 8×6 ink cell. Raster features describe graphics.
 * Lettering status is only what was actually read (text layer or OCR).
 * A cell with ink and no lettering is not assumed to be missing text.
 */

export const GRID_COLS = 8;
export const GRID_ROWS = 6;
export const EMPTY_INK = 0.03;
export const OCR_KEEP = 0.45;
export const OCR_CONFIDENT = 0.5;

export function zoneFor(row, col) {
  if (col >= 6) return "title_block";
  if (row >= 5) return "bottom_notes";
  return "drawing_field";
}

export function rasterFeatures(image, width, height) {
  const data = image.data;
  const cellW = width / GRID_COLS;
  const cellH = height / GRID_ROWS;
  const ink = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0));
  const seen = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0));
  const edge = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0));
  const isInk = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const offset = (y * width + x) * 4;
    return data[offset] < 245 || data[offset + 1] < 245 || data[offset + 2] < 245;
  };
  const stride = 2;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const col = Math.min(GRID_COLS - 1, Math.floor(x / cellW));
      const row = Math.min(GRID_ROWS - 1, Math.floor(y / cellH));
      seen[row][col] += 1;
      if (!isInk(x, y)) continue;
      ink[row][col] += 1;
      if (!isInk(x - stride, y) || !isInk(x + stride, y) || !isInk(x, y - stride) || !isInk(x, y + stride)) {
        edge[row][col] += 1;
      }
    }
  }
  const cells = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const inkRatio = seen[row][col] ? ink[row][col] / seen[row][col] : 0;
      const edgeRatio = ink[row][col] ? edge[row][col] / ink[row][col] : 0;
      cells.push({
        cell: `r${row}c${col}`,
        row,
        col,
        inkRatio: Math.round(inkRatio * 1000) / 1000,
        edgeRatio: Math.round(edgeRatio * 1000) / 1000,
        hypothesizedGraphicKind: graphicKind(inkRatio, edgeRatio),
      });
    }
  }
  return cells;
}

export function graphicKind(inkRatio, edgeRatio) {
  if (inkRatio < EMPTY_INK) return "empty";
  if (inkRatio >= 0.5 && edgeRatio <= 0.38) return "dense_fill";
  if (edgeRatio >= 0.42) return "linework";
  return "mixed_graphics";
}

export function cellIndex(x, y, pageWidth, pageHeight) {
  const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((Number(x) / pageWidth) * GRID_COLS)));
  const rowFromBottom = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((Number(y) / pageHeight) * GRID_ROWS)));
  const row = GRID_ROWS - 1 - rowFromBottom;
  return { row, col, cell: `r${row}c${col}` };
}

export function classifyCell(base, textItems, ocrWords, ocrAttempted) {
  const zone = zoneFor(base.row, base.col);
  const confident = (ocrWords || []).filter((word) => Number(word.confidence) >= OCR_CONFIDENT);
  const kept = (ocrWords || []).filter((word) => Number(word.confidence) >= OCR_KEEP);
  const textCount = (textItems || []).length;
  let letteringStatus = "none_read";
  if (textCount > 0 && confident.length > 0) letteringStatus = "text_layer_and_ocr";
  else if (textCount > 0) letteringStatus = "text_layer";
  else if (confident.length > 0) letteringStatus = "ocr_recovered";
  else if (kept.length > 0) letteringStatus = "ocr_low_confidence";
  else if (!ocrAttempted) letteringStatus = "ocr_not_attempted";
  else letteringStatus = "none_read";

  const remainingUnread = letteringStatus === "none_read"
    && ocrAttempted
    && base.hypothesizedGraphicKind === "mixed_graphics";

  return {
    ...base,
    zone,
    textLayerItemCount: textCount,
    ocrWordCount: kept.length,
    ocrConfidentWordCount: confident.length,
    ocrChars: kept.reduce((sum, word) => sum + String(word.text || "").length, 0),
    letteringStatus,
    remainingUnread,
    originNotes: letteringOrigins(letteringStatus),
  };
}

function letteringOrigins(status) {
  if (status === "text_layer") return ["machine_extracted"];
  if (status === "ocr_recovered" || status === "ocr_low_confidence") return ["visual_interpretation"];
  if (status === "text_layer_and_ocr") return ["machine_extracted", "visual_interpretation"];
  return [];
}

export function classifyPageCells({ rasterCells, textItems, ocrWords, pageWidth, pageHeight, ocrAttempted }) {
  const textByCell = new Map();
  const ocrByCell = new Map();
  for (const item of textItems || []) {
    const key = cellIndex(item.x, item.y, pageWidth, pageHeight).cell;
    if (!textByCell.has(key)) textByCell.set(key, []);
    textByCell.get(key).push(item);
  }
  for (const word of ocrWords || []) {
    const box = word.box || word;
    const key = cellIndex(box.x + (box.width || 0) / 2, box.y + (box.height || 0) / 2, pageWidth, pageHeight).cell;
    if (!ocrByCell.has(key)) ocrByCell.set(key, []);
    ocrByCell.get(key).push(word);
  }
  return (rasterCells || []).map((base) => classifyCell(
    base,
    textByCell.get(base.cell) || [],
    ocrByCell.get(base.cell) || [],
    ocrAttempted,
  ));
}
