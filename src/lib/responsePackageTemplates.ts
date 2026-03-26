import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, PDFImage } from "pdf-lib";

export type TemplateId = "letter" | "memo" | "simple";

export interface TemplateConfig {
  id: TemplateId;
  name: string;
  description: string;
  icon: string;
}

export const TEMPLATE_CONFIGS: TemplateConfig[] = [
  {
    id: "letter",
    name: "Formal Letter",
    description:
      "Company letterhead with logo and address, date, municipality address block, RE: line with project/permit info, response table, and signature block.",
    icon: "FileText",
  },
  {
    id: "memo",
    name: "Technical Memo",
    description:
      "Header bar with logo and project info, compact response table, and signature line. Best for internal or technical submittals.",
    icon: "ClipboardList",
  },
  {
    id: "simple",
    name: "Simple Table",
    description:
      "Clean tabular format with a logo header and signature footer. Matches the classic export style with branding upgrades.",
    icon: "Table2",
  },
];

export interface CompanyBrandingData {
  logo_url?: string | null;
  company_name?: string | null;
  company_address?: string | null;
  company_phone?: string | null;
  company_email?: string | null;
  company_website?: string | null;
  default_signoff?: string | null;
}

export interface ArchitectProfileData {
  signature_image_url?: string | null;
  seal_image_url?: string | null;
  license_number?: string | null;
  license_state?: string | null;
}

export interface ProjectData {
  name: string;
  permit_number?: string | null;
  jurisdiction?: string | null;
}

export interface CommentRow {
  discipline: string | null;
  status: string | null;
  original_text: string;
  code_reference: string | null;
  response_text: string;
  sheet_reference: string | null;
  assigned_to: string | null;
  created_at: string;
}

export interface ResponsePackageInput {
  template: TemplateId;
  project: ProjectData;
  branding: CompanyBrandingData;
  architect?: ArchitectProfileData | null;
  comments: CommentRow[];
  municipalityAddress?: string | null;
  customNotes?: string | null;
  roundLabel?: string | null;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const FONT_SIZE = 9;
const SMALL_FONT = 7.5;
const HEADER_FONT = 12;
const TITLE_FONT = 14;
const LINE_HEIGHT = FONT_SIZE + 2;
const SMALL_LINE_HEIGHT = SMALL_FONT + 2;

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  const safe = String(text ?? "").trim() || "\u2014";
  const words = safe.split(/\s+/);
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 <= maxCharsPerLine) {
      line += (line ? " " : "") + w;
    } else {
      if (line) lines.push(line);
      line = w.length > maxCharsPerLine ? w.slice(0, maxCharsPerLine) : w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["\u2014"];
}

function formatDate(): string {
  const d = new Date();
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function drawHorizontalLine(
  page: PDFPage,
  y: number,
  x1: number = MARGIN,
  x2: number = PAGE_WIDTH - MARGIN,
) {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });
}

async function tryEmbedImage(
  doc: PDFDocument,
  url: string,
): Promise<PDFImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("png") || url.toLowerCase().endsWith(".png")) {
      return await doc.embedPng(uint8);
    }
    return await doc.embedJpg(uint8);
  } catch {
    return null;
  }
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

function drawText(
  page: PDFPage,
  x: number,
  y: number,
  text: string,
  font: PDFFont,
  size: number = FONT_SIZE,
  color = rgb(0.1, 0.1, 0.1),
) {
  page.drawText(text, { x, y, size, font, color });
}

function drawResponseTable(
  doc: PDFDocument,
  page: PDFPage,
  startY: number,
  comments: CommentRow[],
  fonts: Fonts,
): { page: PDFPage; y: number } {
  let currentPage = page;
  let y = startY;

  const cols = {
    num: { x: MARGIN, w: 25 },
    discipline: { x: MARGIN + 25, w: 50 },
    cityComment: { x: MARGIN + 75, w: 130 },
    codeRef: { x: MARGIN + 205, w: 50 },
    response: { x: MARGIN + 255, w: 145 },
    sheetRef: { x: MARGIN + 400, w: 45 },
    status: { x: MARGIN + 445, w: 45 },
  };

  drawHorizontalLine(currentPage, y + 2);
  drawText(currentPage, cols.num.x, y - 8, "#", fonts.bold, FONT_SIZE - 1);
  drawText(currentPage, cols.discipline.x, y - 8, "Discipline", fonts.bold, FONT_SIZE - 1);
  drawText(currentPage, cols.cityComment.x, y - 8, "City Comment", fonts.bold, FONT_SIZE - 1);
  drawText(currentPage, cols.codeRef.x, y - 8, "Code Ref", fonts.bold, FONT_SIZE - 1);
  drawText(currentPage, cols.response.x, y - 8, "Response", fonts.bold, FONT_SIZE - 1);
  drawText(currentPage, cols.sheetRef.x, y - 8, "Sheet", fonts.bold, FONT_SIZE - 1);
  drawText(currentPage, cols.status.x, y - 8, "Status", fonts.bold, FONT_SIZE - 1);
  y -= 12;
  drawHorizontalLine(currentPage, y);
  y -= 4;

  for (let idx = 0; idx < comments.length; idx++) {
    const row = comments[idx];
    const numLines = wrapText(String(idx + 1), 4);
    const discLines = wrapText(row.discipline ?? "", 8);
    const cityLines = wrapText(row.original_text ?? "", 24);
    const codeLines = wrapText(row.code_reference ?? "", 8);
    const respLines = wrapText(row.response_text ?? "", 26);
    const sheetLines = wrapText(row.sheet_reference ?? "", 6);
    const statusLines = wrapText(row.status ?? "", 6);
    const lineCount = Math.max(
      1,
      numLines.length,
      discLines.length,
      cityLines.length,
      codeLines.length,
      respLines.length,
      sheetLines.length,
      statusLines.length,
    );

    const neededHeight = lineCount * LINE_HEIGHT + 10;
    if (y - neededHeight < MARGIN + 30) {
      currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawHorizontalLine(currentPage, y + 2);
      drawText(currentPage, cols.num.x, y - 8, "#", fonts.bold, FONT_SIZE - 1);
      drawText(currentPage, cols.discipline.x, y - 8, "Discipline", fonts.bold, FONT_SIZE - 1);
      drawText(currentPage, cols.cityComment.x, y - 8, "City Comment", fonts.bold, FONT_SIZE - 1);
      drawText(currentPage, cols.codeRef.x, y - 8, "Code Ref", fonts.bold, FONT_SIZE - 1);
      drawText(currentPage, cols.response.x, y - 8, "Response", fonts.bold, FONT_SIZE - 1);
      drawText(currentPage, cols.sheetRef.x, y - 8, "Sheet", fonts.bold, FONT_SIZE - 1);
      drawText(currentPage, cols.status.x, y - 8, "Status", fonts.bold, FONT_SIZE - 1);
      y -= 12;
      drawHorizontalLine(currentPage, y);
      y -= 4;
    }

    const altBg = idx % 2 === 1;
    if (altBg) {
      currentPage.drawRectangle({
        x: MARGIN - 2,
        y: y - lineCount * LINE_HEIGHT - 2,
        width: PAGE_WIDTH - 2 * MARGIN + 4,
        height: lineCount * LINE_HEIGHT + 4,
        color: rgb(0.96, 0.96, 0.96),
      });
    }

    let yOff = 0;
    for (let i = 0; i < lineCount; i++) {
      drawText(currentPage, cols.num.x, y - yOff, numLines[i] ?? "", fonts.regular);
      drawText(currentPage, cols.discipline.x, y - yOff, discLines[i] ?? "", fonts.regular);
      drawText(currentPage, cols.cityComment.x, y - yOff, cityLines[i] ?? "", fonts.regular);
      drawText(currentPage, cols.codeRef.x, y - yOff, codeLines[i] ?? "", fonts.regular);
      drawText(currentPage, cols.response.x, y - yOff, respLines[i] ?? "", fonts.regular);
      drawText(currentPage, cols.sheetRef.x, y - yOff, sheetLines[i] ?? "", fonts.regular);
      drawText(currentPage, cols.status.x, y - yOff, statusLines[i] ?? "", fonts.regular);
      yOff += LINE_HEIGHT;
    }
    y -= yOff + 6;
    drawHorizontalLine(currentPage, y + 2, MARGIN, PAGE_WIDTH - MARGIN);
  }

  return { page: currentPage, y };
}

async function drawSignatureBlock(
  doc: PDFDocument,
  page: PDFPage,
  y: number,
  fonts: Fonts,
  branding: CompanyBrandingData,
  architect?: ArchitectProfileData | null,
): Promise<number> {
  const signoff = branding.default_signoff || "Respectfully submitted,";
  drawText(page, MARGIN, y, signoff, fonts.italic, FONT_SIZE);
  y -= LINE_HEIGHT * 3;

  if (architect?.signature_image_url) {
    const sigImage = await tryEmbedImage(doc, architect.signature_image_url);
    if (sigImage) {
      const sigHeight = 30;
      const sigWidth = (sigImage.width / sigImage.height) * sigHeight;
      page.drawImage(sigImage, {
        x: MARGIN,
        y: y,
        width: Math.min(sigWidth, 150),
        height: sigHeight,
      });
      y -= sigHeight + 4;
    }
  }

  if (branding.company_name) {
    drawText(page, MARGIN, y, branding.company_name, fonts.bold, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  if (architect?.license_number) {
    const licText = `License #${architect.license_number}${architect.license_state ? `, ${architect.license_state}` : ""}`;
    drawText(page, MARGIN, y, licText, fonts.regular, SMALL_FONT, rgb(0.4, 0.4, 0.4));
    y -= SMALL_LINE_HEIGHT;
  }

  return y;
}

function drawFooter(
  page: PDFPage,
  fonts: Fonts,
  branding: CompanyBrandingData,
  pageNum: number,
  totalPages: number,
) {
  const footerY = 25;
  drawHorizontalLine(page, footerY + 10);

  const parts: string[] = [];
  if (branding.company_name) parts.push(branding.company_name);
  if (branding.company_phone) parts.push(branding.company_phone);
  if (branding.company_email) parts.push(branding.company_email);
  if (branding.company_website) parts.push(branding.company_website);

  if (parts.length > 0) {
    const footerText = parts.join("  |  ");
    drawText(page, MARGIN, footerY, footerText, fonts.regular, SMALL_FONT, rgb(0.5, 0.5, 0.5));
  }

  const pageText = `Page ${pageNum} of ${totalPages}`;
  const pageTextWidth = fonts.regular.widthOfTextAtSize(pageText, SMALL_FONT);
  drawText(
    page,
    PAGE_WIDTH - MARGIN - pageTextWidth,
    footerY,
    pageText,
    fonts.regular,
    SMALL_FONT,
    rgb(0.5, 0.5, 0.5),
  );
}

async function renderLetterTemplate(
  doc: PDFDocument,
  input: ResponsePackageInput,
  fonts: Fonts,
): Promise<void> {
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  if (input.branding.logo_url) {
    const logoImage = await tryEmbedImage(doc, input.branding.logo_url);
    if (logoImage) {
      const logoHeight = 40;
      const logoWidth = (logoImage.width / logoImage.height) * logoHeight;
      page.drawImage(logoImage, {
        x: MARGIN,
        y: y - logoHeight,
        width: Math.min(logoWidth, 180),
        height: logoHeight,
      });
      y -= logoHeight + 6;
    }
  }

  if (input.branding.company_name) {
    drawText(page, MARGIN, y, input.branding.company_name, fonts.bold, HEADER_FONT);
    y -= HEADER_FONT + 2;
  }

  if (input.branding.company_address) {
    const addressLines = input.branding.company_address.split("\n");
    for (const line of addressLines) {
      drawText(page, MARGIN, y, line.trim(), fonts.regular, SMALL_FONT, rgb(0.35, 0.35, 0.35));
      y -= SMALL_LINE_HEIGHT;
    }
  }

  const contactParts: string[] = [];
  if (input.branding.company_phone) contactParts.push(input.branding.company_phone);
  if (input.branding.company_email) contactParts.push(input.branding.company_email);
  if (input.branding.company_website) contactParts.push(input.branding.company_website);
  if (contactParts.length > 0) {
    drawText(page, MARGIN, y, contactParts.join("  |  "), fonts.regular, SMALL_FONT, rgb(0.35, 0.35, 0.35));
    y -= SMALL_LINE_HEIGHT;
  }

  y -= 8;
  drawHorizontalLine(page, y);
  y -= 16;

  drawText(page, MARGIN, y, formatDate(), fonts.regular, FONT_SIZE);
  y -= LINE_HEIGHT * 2;

  if (input.municipalityAddress) {
    const muniLines = input.municipalityAddress.split("\n");
    for (const line of muniLines) {
      drawText(page, MARGIN, y, line.trim(), fonts.regular, FONT_SIZE);
      y -= LINE_HEIGHT;
    }
    y -= LINE_HEIGHT;
  }

  const reLine = `RE: ${input.project.name}${input.project.permit_number ? ` \u2014 Permit #${input.project.permit_number}` : ""}`;
  drawText(page, MARGIN, y, reLine, fonts.bold, FONT_SIZE + 1);
  y -= LINE_HEIGHT;
  if (input.project.jurisdiction) {
    drawText(page, MARGIN, y, `Jurisdiction: ${input.project.jurisdiction}`, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }
  if (input.roundLabel) {
    drawText(page, MARGIN, y, `Review Round: ${input.roundLabel}`, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }
  y -= LINE_HEIGHT;

  if (input.customNotes) {
    const noteLines = wrapText(input.customNotes, 80);
    for (const line of noteLines) {
      if (y < MARGIN + 30) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      drawText(page, MARGIN, y, line, fonts.regular, FONT_SIZE);
      y -= LINE_HEIGHT;
    }
    y -= LINE_HEIGHT;
  }

  drawText(page, MARGIN, y, "Please find our responses to the review comments below:", fonts.regular, FONT_SIZE);
  y -= LINE_HEIGHT * 2;

  const result = drawResponseTable(doc, page, y, input.comments, fonts);
  page = result.page;
  y = result.y;

  y -= LINE_HEIGHT * 2;
  if (y < MARGIN + 80) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  await drawSignatureBlock(doc, page, y, fonts, input.branding, input.architect);

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    drawFooter(pages[i], fonts, input.branding, i + 1, pages.length);
  }
}

async function renderMemoTemplate(
  doc: PDFDocument,
  input: ResponsePackageInput,
  fonts: Fonts,
): Promise<void> {
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const headerBarHeight = 55;
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - headerBarHeight,
    width: PAGE_WIDTH,
    height: headerBarHeight,
    color: rgb(0.15, 0.22, 0.35),
  });

  if (input.branding.logo_url) {
    const logoImage = await tryEmbedImage(doc, input.branding.logo_url);
    if (logoImage) {
      const logoHeight = 30;
      const logoWidth = (logoImage.width / logoImage.height) * logoHeight;
      page.drawImage(logoImage, {
        x: MARGIN,
        y: PAGE_HEIGHT - headerBarHeight + (headerBarHeight - logoHeight) / 2,
        width: Math.min(logoWidth, 140),
        height: logoHeight,
      });
    }
  }

  const memoTitle = "TECHNICAL MEMO";
  const titleWidth = fonts.bold.widthOfTextAtSize(memoTitle, HEADER_FONT);
  drawText(
    page,
    PAGE_WIDTH - MARGIN - titleWidth,
    PAGE_HEIGHT - headerBarHeight + (headerBarHeight - HEADER_FONT) / 2,
    memoTitle,
    fonts.bold,
    HEADER_FONT,
    rgb(1, 1, 1),
  );

  y = PAGE_HEIGHT - headerBarHeight - 20;

  const infoBlockX = MARGIN;
  const infoValueX = MARGIN + 70;

  drawText(page, infoBlockX, y, "Project:", fonts.bold, FONT_SIZE);
  drawText(page, infoValueX, y, input.project.name, fonts.regular, FONT_SIZE);
  y -= LINE_HEIGHT;

  if (input.project.permit_number) {
    drawText(page, infoBlockX, y, "Permit #:", fonts.bold, FONT_SIZE);
    drawText(page, infoValueX, y, input.project.permit_number, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  if (input.project.jurisdiction) {
    drawText(page, infoBlockX, y, "Jurisdiction:", fonts.bold, FONT_SIZE);
    drawText(page, infoValueX, y, input.project.jurisdiction, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  drawText(page, infoBlockX, y, "Date:", fonts.bold, FONT_SIZE);
  drawText(page, infoValueX, y, formatDate(), fonts.regular, FONT_SIZE);
  y -= LINE_HEIGHT;

  if (input.roundLabel) {
    drawText(page, infoBlockX, y, "Round:", fonts.bold, FONT_SIZE);
    drawText(page, infoValueX, y, input.roundLabel, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  if (input.branding.company_name) {
    drawText(page, infoBlockX, y, "Prepared by:", fonts.bold, FONT_SIZE);
    drawText(page, infoValueX, y, input.branding.company_name, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  y -= 8;
  drawHorizontalLine(page, y);
  y -= 12;

  if (input.customNotes) {
    const noteLines = wrapText(input.customNotes, 80);
    for (const line of noteLines) {
      if (y < MARGIN + 30) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      drawText(page, MARGIN, y, line, fonts.regular, FONT_SIZE);
      y -= LINE_HEIGHT;
    }
    y -= LINE_HEIGHT;
    drawHorizontalLine(page, y);
    y -= 12;
  }

  const result = drawResponseTable(doc, page, y, input.comments, fonts);
  page = result.page;
  y = result.y;

  y -= LINE_HEIGHT * 2;
  if (y < MARGIN + 60) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  drawHorizontalLine(page, y);
  y -= LINE_HEIGHT;

  if (input.architect?.signature_image_url) {
    const sigImage = await tryEmbedImage(doc, input.architect.signature_image_url);
    if (sigImage) {
      const sigHeight = 25;
      const sigWidth = (sigImage.width / sigImage.height) * sigHeight;
      page.drawImage(sigImage, {
        x: MARGIN,
        y: y - sigHeight,
        width: Math.min(sigWidth, 120),
        height: sigHeight,
      });
      y -= sigHeight + 4;
    }
  }

  if (input.branding.company_name) {
    drawText(page, MARGIN, y, input.branding.company_name, fonts.bold, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  if (input.architect?.license_number) {
    const licText = `License #${input.architect.license_number}${input.architect.license_state ? `, ${input.architect.license_state}` : ""}`;
    drawText(page, MARGIN, y, licText, fonts.regular, SMALL_FONT, rgb(0.4, 0.4, 0.4));
  }

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    drawFooter(pages[i], fonts, input.branding, i + 1, pages.length);
  }
}

async function renderSimpleTemplate(
  doc: PDFDocument,
  input: ResponsePackageInput,
  fonts: Fonts,
): Promise<void> {
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  if (input.branding.logo_url) {
    const logoImage = await tryEmbedImage(doc, input.branding.logo_url);
    if (logoImage) {
      const logoHeight = 35;
      const logoWidth = (logoImage.width / logoImage.height) * logoHeight;
      page.drawImage(logoImage, {
        x: MARGIN,
        y: y - logoHeight,
        width: Math.min(logoWidth, 150),
        height: logoHeight,
      });
      y -= logoHeight + 10;
    }
  }

  const title = `Response Package: ${input.project.name}${input.project.permit_number ? ` \u00B7 Permit #${input.project.permit_number}` : ""}`;
  drawText(page, MARGIN, y, title, fonts.bold, TITLE_FONT - 2);
  y -= TITLE_FONT;

  const timestamp = formatDate();
  drawText(page, MARGIN, y, `Generated: ${timestamp}`, fonts.regular, SMALL_FONT, rgb(0.4, 0.4, 0.4));
  y -= SMALL_LINE_HEIGHT;

  if (input.project.jurisdiction) {
    drawText(page, MARGIN, y, `Jurisdiction: ${input.project.jurisdiction}`, fonts.regular, SMALL_FONT, rgb(0.4, 0.4, 0.4));
    y -= SMALL_LINE_HEIGHT;
  }

  if (input.roundLabel) {
    drawText(page, MARGIN, y, `Review Round: ${input.roundLabel}`, fonts.regular, SMALL_FONT, rgb(0.4, 0.4, 0.4));
    y -= SMALL_LINE_HEIGHT;
  }

  y -= 8;
  drawHorizontalLine(page, y);
  y -= 12;

  const result = drawResponseTable(doc, page, y, input.comments, fonts);
  page = result.page;
  y = result.y;

  y -= LINE_HEIGHT * 2;
  if (y < MARGIN + 70) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  drawHorizontalLine(page, y);
  y -= LINE_HEIGHT;

  await drawSignatureBlock(doc, page, y, fonts, input.branding, input.architect);

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    drawFooter(pages[i], fonts, input.branding, i + 1, pages.length);
  }
}

export async function generateResponsePackagePdf(
  input: ResponsePackageInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const fonts: Fonts = { regular, bold, italic };

  switch (input.template) {
    case "letter":
      await renderLetterTemplate(doc, input, fonts);
      break;
    case "memo":
      await renderMemoTemplate(doc, input, fonts);
      break;
    case "simple":
    default:
      await renderSimpleTemplate(doc, input, fonts);
      break;
  }

  return await doc.save();
}

export function getTemplateConfig(id: TemplateId): TemplateConfig {
  return TEMPLATE_CONFIGS.find((t) => t.id === id) ?? TEMPLATE_CONFIGS[2];
}
