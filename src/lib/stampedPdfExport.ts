import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, PDFImage } from "pdf-lib";
import type { PlanMarkup, MarkupData } from "@/hooks/usePlanMarkups";
import { supabase } from "@/lib/supabase";

export interface RevisionEntry {
  deltaNumber: number;
  description: string;
  date: string;
  pageNumber: number;
}

export interface StampedPdfInput {
  originalPdfUrl: string;
  markups: PlanMarkup[];
  sealImageUrl?: string | null;
  revisionEntries: RevisionEntry[];
  architectName?: string | null;
  licenseNumber?: string | null;
  licenseState?: string | null;
}

export interface StampedPdfResult {
  pdfBytes: Uint8Array;
  fileName: string;
}

const CLOUD_SCALLOP_RADIUS = 6;
const CLOUD_SCALLOP_COUNT_PER_SIDE = 8;
const SEAL_SIZE = 80;
const REVISION_BLOCK_HEIGHT = 14;
const REVISION_BLOCK_MARGIN = 12;

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; isPng: boolean } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const contentType = response.headers.get("content-type") || "";
    const isPng = contentType.includes("png") || url.toLowerCase().endsWith(".png");
    return { bytes, isPng };
  } catch {
    return null;
  }
}

async function embedImage(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  const imageData = await fetchImageBytes(url);
  if (!imageData) return null;
  try {
    if (imageData.isPng) {
      return await doc.embedPng(imageData.bytes);
    }
    return await doc.embedJpg(imageData.bytes);
  } catch {
    return null;
  }
}

function drawScallopedCloud(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  deltaNumber?: number,
  font?: PDFFont,
) {
  const r = CLOUD_SCALLOP_RADIUS;
  const countH = Math.max(4, Math.round(width / (r * 2)));
  const countV = Math.max(4, Math.round(height / (r * 2)));

  const drawScallopsAlongEdge = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    count: number,
  ) => {
    const dx = (x2 - x1) / count;
    const dy = (y2 - y1) / count;
    const perpX = -dy;
    const perpY = dx;
    const len = Math.sqrt(perpX * perpX + perpY * perpY);
    const normX = len > 0 ? (perpX / len) * r * 0.6 : 0;
    const normY = len > 0 ? (perpY / len) * r * 0.6 : 0;

    for (let i = 0; i < count; i++) {
      const cx = x1 + dx * (i + 0.5) + normX;
      const cy = y1 + dy * (i + 0.5) + normY;
      const arcR = Math.sqrt(dx * dx + dy * dy) / 2;
      page.drawCircle({
        x: cx,
        y: cy,
        size: Math.max(arcR * 0.7, 3),
        borderColor: rgb(0.8, 0.1, 0.1),
        borderWidth: 1.2,
        color: rgb(1, 0.9, 0.9),
        opacity: 0.15,
        borderOpacity: 0.85,
      });
    }
  };

  drawScallopsAlongEdge(x, y + height, x + width, y + height, countH);
  drawScallopsAlongEdge(x + width, y + height, x + width, y, countV);
  drawScallopsAlongEdge(x + width, y, x, y, countH);
  drawScallopsAlongEdge(x, y, x, y + height, countV);

  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0.8, 0.1, 0.1),
    borderWidth: 0.5,
    borderOpacity: 0.4,
    opacity: 0,
  });

  if (deltaNumber !== undefined && font) {
    const label = `\u0394${deltaNumber}`;
    const labelSize = 8;
    const labelWidth = font.widthOfTextAtSize(label, labelSize);
    const labelX = x + width - labelWidth - 3;
    const labelY = y + height - labelSize - 3;

    page.drawRectangle({
      x: labelX - 2,
      y: labelY - 1,
      width: labelWidth + 4,
      height: labelSize + 3,
      color: rgb(1, 1, 1),
      opacity: 0.85,
    });

    page.drawText(label, {
      x: labelX,
      y: labelY,
      size: labelSize,
      font,
      color: rgb(0.8, 0.1, 0.1),
    });
  }
}

function drawRevisionBlock(
  page: PDFPage,
  revisions: RevisionEntry[],
  fonts: { regular: PDFFont; bold: PDFFont },
) {
  if (revisions.length === 0) return;

  const pageWidth = page.getWidth();
  const blockWidth = 250;
  const headerHeight = 16;
  const rowHeight = REVISION_BLOCK_HEIGHT;
  const totalHeight = headerHeight + revisions.length * rowHeight + 4;
  const blockX = pageWidth - blockWidth - REVISION_BLOCK_MARGIN;
  const blockY = REVISION_BLOCK_MARGIN;
  const fontSize = 7;
  const headerFontSize = 8;

  page.drawRectangle({
    x: blockX,
    y: blockY,
    width: blockWidth,
    height: totalHeight,
    color: rgb(1, 1, 1),
    opacity: 0.92,
    borderColor: rgb(0.3, 0.3, 0.3),
    borderWidth: 0.75,
  });

  const headerY = blockY + totalHeight - headerHeight;
  page.drawRectangle({
    x: blockX,
    y: headerY,
    width: blockWidth,
    height: headerHeight,
    color: rgb(0.15, 0.22, 0.35),
  });

  page.drawText("REVISION SCHEDULE", {
    x: blockX + 6,
    y: headerY + 4,
    size: headerFontSize,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });

  const colDelta = blockX + 6;
  const colDate = blockX + 35;
  const colPage = blockX + 100;
  const colDesc = blockX + 130;
  const labelY = headerY - rowHeight + 2;

  page.drawText("#", { x: colDelta, y: labelY, size: fontSize, font: fonts.bold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("Date", { x: colDate, y: labelY, size: fontSize, font: fonts.bold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("Page", { x: colPage, y: labelY, size: fontSize, font: fonts.bold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("Description", { x: colDesc, y: labelY, size: fontSize, font: fonts.bold, color: rgb(0.2, 0.2, 0.2) });

  page.drawLine({
    start: { x: blockX + 2, y: labelY - 2 },
    end: { x: blockX + blockWidth - 2, y: labelY - 2 },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });

  for (let i = 0; i < revisions.length; i++) {
    const rev = revisions[i];
    const ry = labelY - (i + 1) * rowHeight;
    const deltaStr = `\u0394${rev.deltaNumber}`;
    const descTrunc = rev.description.length > 20 ? rev.description.slice(0, 18) + "..." : rev.description;

    page.drawText(deltaStr, { x: colDelta, y: ry, size: fontSize, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(rev.date, { x: colDate, y: ry, size: fontSize, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(String(rev.pageNumber), { x: colPage, y: ry, size: fontSize, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(descTrunc, { x: colDesc, y: ry, size: fontSize, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
  }
}

function drawSealStamp(
  page: PDFPage,
  sealImage: PDFImage,
  position: "bottom-right" | "bottom-left" = "bottom-right",
) {
  const pageWidth = page.getWidth();
  const sealHeight = SEAL_SIZE;
  const sealWidth = (sealImage.width / sealImage.height) * sealHeight;
  const clampedWidth = Math.min(sealWidth, SEAL_SIZE * 1.5);
  const clampedHeight = (clampedWidth / sealWidth) * sealHeight;

  const margin = REVISION_BLOCK_MARGIN + 8;
  const x = position === "bottom-right"
    ? pageWidth - clampedWidth - margin - 260
    : margin;
  const y = margin;

  page.drawImage(sealImage, {
    x,
    y,
    width: clampedWidth,
    height: clampedHeight,
    opacity: 0.35,
  });
}

export async function generateStampedPdf(input: StampedPdfInput): Promise<StampedPdfResult> {
  const originalBytes = await fetchPdfBytes(input.originalPdfUrl);
  const doc = await PDFDocument.load(originalBytes);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let sealImage: PDFImage | null = null;
  if (input.sealImageUrl) {
    sealImage = await embedImage(doc, input.sealImageUrl);
  }

  const pages = doc.getPages();
  const markupsByPage = new Map<number, PlanMarkup[]>();
  for (const markup of input.markups) {
    if (markup.status !== "approved") continue;
    const existing = markupsByPage.get(markup.page_number) || [];
    existing.push(markup);
    markupsByPage.set(markup.page_number, existing);
  }

  const revisedPages = new Set<number>();

  for (const [pageNum, pageMarkups] of markupsByPage.entries()) {
    const pageIndex = pageNum - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const pageHeight = page.getHeight();
    const pageWidth = page.getWidth();
    revisedPages.add(pageNum);

    for (const markup of pageMarkups) {
      const data = markup.markup_data as MarkupData;
      const pdfX = data.x * pageWidth;
      const pdfY = pageHeight - (data.y + data.height) * pageHeight;
      const pdfW = data.width * pageWidth;
      const pdfH = data.height * pageHeight;

      drawScallopedCloud(page, pdfX, pdfY, pdfW, pdfH, data.deltaNumber, bold);
    }

    if (sealImage) {
      drawSealStamp(page, sealImage);
    }
  }

  for (const pageNum of revisedPages) {
    const pageIndex = pageNum - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const pageRevisions = input.revisionEntries.filter((r) => r.pageNumber === pageNum);
    if (pageRevisions.length > 0) {
      drawRevisionBlock(page, pageRevisions, { regular, bold });
    }
  }

  if (input.revisionEntries.length > 0) {
    const allPagesRevisions = input.revisionEntries;
    const lastPage = pages[pages.length - 1];
    if (lastPage && !revisedPages.has(pages.length)) {
      drawRevisionBlock(lastPage, allPagesRevisions, { regular, bold });
    }
  }

  const pdfBytes = await doc.save();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `stamped_plan_${timestamp}.pdf`;

  return { pdfBytes, fileName };
}

export function buildRevisionEntries(
  markups: PlanMarkup[],
  commentMap?: Map<string, { original_text?: string; discipline?: string }>,
): RevisionEntry[] {
  const approvedMarkups = markups.filter((m) => m.status === "approved");
  const entries: RevisionEntry[] = [];
  const seen = new Set<string>();

  for (const markup of approvedMarkups) {
    const data = markup.markup_data as MarkupData;
    const delta = data.deltaNumber ?? entries.length + 1;
    const key = `${markup.page_number}-${delta}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let description = data.label || "";
    if (!description && markup.comment_id && commentMap) {
      const comment = commentMap.get(markup.comment_id);
      if (comment) {
        const text = comment.original_text || "";
        description = text.length > 50 ? text.slice(0, 48) + "..." : text;
        if (comment.discipline) {
          description = `[${comment.discipline}] ${description}`;
        }
      }
    }
    if (!description) {
      description = `Revision cloud on page ${markup.page_number}`;
    }

    const date = markup.approved_at
      ? new Date(markup.approved_at).toLocaleDateString("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "2-digit",
        })
      : new Date().toLocaleDateString("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "2-digit",
        });

    entries.push({
      deltaNumber: delta,
      description,
      date,
      pageNumber: markup.page_number,
    });
  }

  return entries.sort((a, b) => a.deltaNumber - b.deltaNumber);
}

export async function saveStampedPdfAsVersion(
  result: StampedPdfResult,
  projectId: string,
  userId: string,
  parentDocumentId: string,
  existingVersion: number,
): Promise<string | null> {
  const filePath = `${userId}/${projectId}/${Date.now()}_${result.fileName}`;

  const blob = new Blob([result.pdfBytes], { type: "application/pdf" });
  const { error: uploadError } = await supabase.storage
    .from("project-documents")
    .upload(filePath, blob);

  if (uploadError) {
    throw new Error(`Failed to upload stamped PDF: ${uploadError.message}`);
  }

  const { data: newDoc, error: insertError } = await supabase
    .from("project_documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      file_name: result.fileName,
      file_path: filePath,
      file_size: result.pdfBytes.length,
      file_type: "application/pdf",
      document_type: "permit_drawing",
      version: existingVersion + 1,
      parent_document_id: parentDocumentId,
      description: "Stamped plan with revision clouds and architect seal",
    })
    .select("id")
    .single();

  if (insertError) {
    await supabase.storage.from("project-documents").remove([filePath]);
    throw new Error(`Failed to save document record: ${insertError.message}`);
  }

  return newDoc?.id || null;
}
