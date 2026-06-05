/**
 * Server-side document text extraction, chunking, sheet detection for AI ingestion.
 */
import OpenAI from "https://esm.sh/openai@4.28.0";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import mammoth from "npm:mammoth@1.8.0";

export interface PageText {
  pageNumber: number;
  text: string;
  lowText: boolean;
}

export interface PreparedChunk {
  pageNumber: number;
  chunkIndex: number;
  chunkText: string;
  sheetLabel: string | null;
  sheetTitle: string | null;
  metadata: Record<string, unknown>;
}

const MIN_PAGE_TEXT_CHARS = 40;
const MAX_CHUNK_CHARS = 1500;
const CHUNK_OVERLAP = 200;

/** Generic architectural/equipment sheet labels (A-1.04, EQ-2.00, S-201.00, etc.) */
const SHEET_LABEL_RE = /\b([A-Z]{1,4}-\d+(?:\.\d+)*)\b/g;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isLegacyDoc(fileName: string, fileType: string): boolean {
  const lower = fileName.toLowerCase();
  return (lower.endsWith(".doc") && !lower.endsWith(".docx")) ||
    fileType === "application/msword";
}

export function isIngestSupported(fileName: string, fileType: string): boolean {
  if (isLegacyDoc(fileName, fileType)) return false;
  const lower = fileName.toLowerCase();
  if (fileType === "application/pdf" || lower.endsWith(".pdf")) return true;
  if (
    fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return true;
  }
  return false;
}

export async function extractPdfPages(arrayBuffer: ArrayBuffer): Promise<PageText[]> {
  const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages: PageText[] = [];

  if (Array.isArray(text)) {
    for (let i = 0; i < text.length; i++) {
      const pageText = normalizeWhitespace(text[i] ?? "");
      pages.push({
        pageNumber: i + 1,
        text: pageText,
        lowText: pageText.length < MIN_PAGE_TEXT_CHARS,
      });
    }
    return pages;
  }

  const combined = normalizeWhitespace(String(text ?? ""));
  if (totalPages <= 1) {
    return [{
      pageNumber: 1,
      text: combined,
      lowText: combined.length < MIN_PAGE_TEXT_CHARS,
    }];
  }

  // Fallback: split combined text evenly if per-page array unavailable
  const approxLen = Math.ceil(combined.length / totalPages);
  for (let i = 0; i < totalPages; i++) {
    const slice = combined.slice(i * approxLen, (i + 1) * approxLen);
    pages.push({
      pageNumber: i + 1,
      text: slice,
      lowText: slice.length < MIN_PAGE_TEXT_CHARS,
    });
  }
  return pages;
}

export async function extractDocxPages(arrayBuffer: ArrayBuffer): Promise<PageText[]> {
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = (result.value ?? "").replace(/\r\n/g, "\n").trim();
  return [{
    pageNumber: 1,
    text,
    lowText: text.length < MIN_PAGE_TEXT_CHARS,
  }];
}

export function detectSheetLabel(text: string): string | null {
  const matches = [...text.matchAll(SHEET_LABEL_RE)];
  if (matches.length === 0) return null;
  // Prefer labels appearing early on the page (title block area)
  return matches[0]?.[1] ?? null;
}

export function detectSheetTitle(text: string, sheetLabel: string | null): string | null {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 12)) {
    if (line.length < 10 || line.length > 120) continue;
    if (sheetLabel && line.includes(sheetLabel)) continue;
    const letters = line.replace(/[^A-Za-z]/g, "");
    if (letters.length < 6) continue;
    const upperCount = [...letters].filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
    if (upperCount / letters.length >= 0.65) {
      return line.slice(0, 120);
    }
  }
  return null;
}

export function chunkPage(page: PageText, fileName: string): PreparedChunk[] {
  const sheetLabel = detectSheetLabel(page.text);
  const sheetTitle = detectSheetTitle(page.text, sheetLabel);
  const baseMeta = {
    source_file: fileName,
    low_text: page.lowText,
  };

  if (page.text.length <= MAX_CHUNK_CHARS) {
    return [{
      pageNumber: page.pageNumber,
      chunkIndex: 0,
      chunkText: page.text,
      sheetLabel,
      sheetTitle,
      metadata: baseMeta,
    }];
  }

  const chunks: PreparedChunk[] = [];
  let start = 0;
  let chunkIndex = 0;
  while (start < page.text.length) {
    const end = Math.min(start + MAX_CHUNK_CHARS, page.text.length);
    chunks.push({
      pageNumber: page.pageNumber,
      chunkIndex,
      chunkText: page.text.slice(start, end),
      sheetLabel,
      sheetTitle,
      metadata: { ...baseMeta, split: true },
    });
    chunkIndex++;
    if (end >= page.text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

export function prepareChunksFromPages(pages: PageText[], fileName: string): PreparedChunk[] {
  return pages.flatMap((p) => chunkPage(p, fileName));
}

export async function embedTexts(openai: OpenAI, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batchSize = 50;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });
    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      embeddings.push(item.embedding);
    }
  }
  return embeddings;
}

export function vectorToPg(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function extractDocumentPages(
  fileName: string,
  fileType: string,
  arrayBuffer: ArrayBuffer,
): Promise<{ pages: PageText[]; unsupported: boolean }> {
  if (isLegacyDoc(fileName, fileType)) {
    return { pages: [], unsupported: true };
  }
  const lower = fileName.toLowerCase();
  if (fileType === "application/pdf" || lower.endsWith(".pdf")) {
    const pages = await extractPdfPages(arrayBuffer);
    return { pages, unsupported: false };
  }
  if (
    fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const pages = await extractDocxPages(arrayBuffer);
    return { pages, unsupported: false };
  }
  return { pages: [], unsupported: true };
}
