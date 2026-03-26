import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, PDFImage } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TemplateId = "letter" | "memo" | "simple";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const FONT_SIZE = 9;
const SMALL_FONT = 7.5;
const HEADER_FONT = 12;
const TITLE_FONT = 14;
const LINE_HEIGHT = FONT_SIZE + 2;
const SMALL_LINE_HEIGHT = SMALL_FONT + 2;

interface CommentRow {
  discipline: string | null;
  status: string | null;
  original_text: string;
  code_reference: string | null;
  response_text: string;
  sheet_reference: string | null;
  assigned_to: string | null;
  created_at: string;
}

interface CompanyBranding {
  logo_url?: string | null;
  company_name?: string | null;
  company_address?: string | null;
  company_phone?: string | null;
  company_email?: string | null;
  company_website?: string | null;
  default_signoff?: string | null;
}

interface ArchitectProfile {
  signature_image_url?: string | null;
  seal_image_url?: string | null;
  license_number?: string | null;
  license_state?: string | null;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

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

  const drawTableHeader = (p: PDFPage, headerY: number) => {
    drawHorizontalLine(p, headerY + 2);
    drawText(p, cols.num.x, headerY - 8, "#", fonts.bold, FONT_SIZE - 1);
    drawText(p, cols.discipline.x, headerY - 8, "Discipline", fonts.bold, FONT_SIZE - 1);
    drawText(p, cols.cityComment.x, headerY - 8, "City Comment", fonts.bold, FONT_SIZE - 1);
    drawText(p, cols.codeRef.x, headerY - 8, "Code Ref", fonts.bold, FONT_SIZE - 1);
    drawText(p, cols.response.x, headerY - 8, "Response", fonts.bold, FONT_SIZE - 1);
    drawText(p, cols.sheetRef.x, headerY - 8, "Sheet", fonts.bold, FONT_SIZE - 1);
    drawText(p, cols.status.x, headerY - 8, "Status", fonts.bold, FONT_SIZE - 1);
  };

  drawTableHeader(currentPage, y);
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
      drawTableHeader(currentPage, y);
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
  branding: CompanyBranding,
  architect?: ArchitectProfile | null,
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
  branding: CompanyBranding,
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
  comments: CommentRow[],
  fonts: Fonts,
  branding: CompanyBranding,
  architect: ArchitectProfile | null,
  project: { name: string; permit_number?: string | null; jurisdiction?: string | null },
  municipalityAddress?: string | null,
  customNotes?: string | null,
  roundLabel?: string | null,
): Promise<void> {
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  if (branding.logo_url) {
    const logoImage = await tryEmbedImage(doc, branding.logo_url);
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

  if (branding.company_name) {
    drawText(page, MARGIN, y, branding.company_name, fonts.bold, HEADER_FONT);
    y -= HEADER_FONT + 2;
  }

  if (branding.company_address) {
    const addressLines = branding.company_address.split("\n");
    for (const line of addressLines) {
      drawText(page, MARGIN, y, line.trim(), fonts.regular, SMALL_FONT, rgb(0.35, 0.35, 0.35));
      y -= SMALL_LINE_HEIGHT;
    }
  }

  const contactParts: string[] = [];
  if (branding.company_phone) contactParts.push(branding.company_phone);
  if (branding.company_email) contactParts.push(branding.company_email);
  if (branding.company_website) contactParts.push(branding.company_website);
  if (contactParts.length > 0) {
    drawText(page, MARGIN, y, contactParts.join("  |  "), fonts.regular, SMALL_FONT, rgb(0.35, 0.35, 0.35));
    y -= SMALL_LINE_HEIGHT;
  }

  y -= 8;
  drawHorizontalLine(page, y);
  y -= 16;

  drawText(page, MARGIN, y, formatDate(), fonts.regular, FONT_SIZE);
  y -= LINE_HEIGHT * 2;

  if (municipalityAddress) {
    const muniLines = municipalityAddress.split("\n");
    for (const line of muniLines) {
      drawText(page, MARGIN, y, line.trim(), fonts.regular, FONT_SIZE);
      y -= LINE_HEIGHT;
    }
    y -= LINE_HEIGHT;
  }

  const reLine = `RE: ${project.name}${project.permit_number ? ` \u2014 Permit #${project.permit_number}` : ""}`;
  drawText(page, MARGIN, y, reLine, fonts.bold, FONT_SIZE + 1);
  y -= LINE_HEIGHT;
  if (project.jurisdiction) {
    drawText(page, MARGIN, y, `Jurisdiction: ${project.jurisdiction}`, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }
  if (roundLabel) {
    drawText(page, MARGIN, y, `Review Round: ${roundLabel}`, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }
  y -= LINE_HEIGHT;

  if (customNotes) {
    const noteLines = wrapText(customNotes, 80);
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

  const result = drawResponseTable(doc, page, y, comments, fonts);
  page = result.page;
  y = result.y;

  y -= LINE_HEIGHT * 2;
  if (y < MARGIN + 80) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  await drawSignatureBlock(doc, page, y, fonts, branding, architect);

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    drawFooter(pages[i], fonts, branding, i + 1, pages.length);
  }
}

async function renderMemoTemplate(
  doc: PDFDocument,
  comments: CommentRow[],
  fonts: Fonts,
  branding: CompanyBranding,
  architect: ArchitectProfile | null,
  project: { name: string; permit_number?: string | null; jurisdiction?: string | null },
  customNotes?: string | null,
  roundLabel?: string | null,
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

  if (branding.logo_url) {
    const logoImage = await tryEmbedImage(doc, branding.logo_url);
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
  drawText(page, infoValueX, y, project.name, fonts.regular, FONT_SIZE);
  y -= LINE_HEIGHT;

  if (project.permit_number) {
    drawText(page, infoBlockX, y, "Permit #:", fonts.bold, FONT_SIZE);
    drawText(page, infoValueX, y, project.permit_number, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  if (project.jurisdiction) {
    drawText(page, infoBlockX, y, "Jurisdiction:", fonts.bold, FONT_SIZE);
    drawText(page, infoValueX, y, project.jurisdiction, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  drawText(page, infoBlockX, y, "Date:", fonts.bold, FONT_SIZE);
  drawText(page, infoValueX, y, formatDate(), fonts.regular, FONT_SIZE);
  y -= LINE_HEIGHT;

  if (roundLabel) {
    drawText(page, infoBlockX, y, "Round:", fonts.bold, FONT_SIZE);
    drawText(page, infoValueX, y, roundLabel, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  if (branding.company_name) {
    drawText(page, infoBlockX, y, "Prepared by:", fonts.bold, FONT_SIZE);
    drawText(page, infoValueX, y, branding.company_name, fonts.regular, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  y -= 8;
  drawHorizontalLine(page, y);
  y -= 12;

  if (customNotes) {
    const noteLines = wrapText(customNotes, 80);
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

  const result = drawResponseTable(doc, page, y, comments, fonts);
  page = result.page;
  y = result.y;

  y -= LINE_HEIGHT * 2;
  if (y < MARGIN + 60) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  drawHorizontalLine(page, y);
  y -= LINE_HEIGHT;

  if (architect?.signature_image_url) {
    const sigImage = await tryEmbedImage(doc, architect.signature_image_url);
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

  if (branding.company_name) {
    drawText(page, MARGIN, y, branding.company_name, fonts.bold, FONT_SIZE);
    y -= LINE_HEIGHT;
  }

  if (architect?.license_number) {
    const licText = `License #${architect.license_number}${architect.license_state ? `, ${architect.license_state}` : ""}`;
    drawText(page, MARGIN, y, licText, fonts.regular, SMALL_FONT, rgb(0.4, 0.4, 0.4));
  }

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    drawFooter(pages[i], fonts, branding, i + 1, pages.length);
  }
}

async function renderSimpleTemplate(
  doc: PDFDocument,
  comments: CommentRow[],
  fonts: Fonts,
  branding: CompanyBranding,
  architect: ArchitectProfile | null,
  project: { name: string; permit_number?: string | null; jurisdiction?: string | null },
  roundLabel?: string | null,
): Promise<void> {
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  if (branding.logo_url) {
    const logoImage = await tryEmbedImage(doc, branding.logo_url);
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

  const title = `Response Package: ${project.name}${project.permit_number ? ` \u00B7 Permit #${project.permit_number}` : ""}`;
  drawText(page, MARGIN, y, title, fonts.bold, TITLE_FONT - 2);
  y -= TITLE_FONT;

  const timestamp = formatDate();
  drawText(page, MARGIN, y, `Generated: ${timestamp}`, fonts.regular, SMALL_FONT, rgb(0.4, 0.4, 0.4));
  y -= SMALL_LINE_HEIGHT;

  if (project.jurisdiction) {
    drawText(page, MARGIN, y, `Jurisdiction: ${project.jurisdiction}`, fonts.regular, SMALL_FONT, rgb(0.4, 0.4, 0.4));
    y -= SMALL_LINE_HEIGHT;
  }

  if (roundLabel) {
    drawText(page, MARGIN, y, `Review Round: ${roundLabel}`, fonts.regular, SMALL_FONT, rgb(0.4, 0.4, 0.4));
    y -= SMALL_LINE_HEIGHT;
  }

  y -= 8;
  drawHorizontalLine(page, y);
  y -= 12;

  const result = drawResponseTable(doc, page, y, comments, fonts);
  page = result.page;
  y = result.y;

  y -= LINE_HEIGHT * 2;
  if (y < MARGIN + 70) {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  drawHorizontalLine(page, y);
  y -= LINE_HEIGHT;

  await drawSignatureBlock(doc, page, y, fonts, branding, architect);

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    drawFooter(pages[i], fonts, branding, i + 1, pages.length);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Missing config" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing or invalid Authorization" }, 401);
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Invalid JWT" }, 401);

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) return json({ error: "Invalid JWT" }, 401);

    const body = await req.json().catch(() => ({}));
    const projectId = (body.project_id ?? body.projectId) as string | undefined;
    if (!projectId) return json({ error: "project_id is required" }, 400);

    const template = ((body.template as string) || "simple") as TemplateId;
    const validTemplates: TemplateId[] = ["letter", "memo", "simple"];
    const selectedTemplate: TemplateId = validTemplates.includes(template) ? template : "simple";

    const municipalityAddress = (body.municipality_address ?? body.municipalityAddress) as string | undefined;
    const customNotes = (body.custom_notes ?? body.customNotes) as string | undefined;
    const roundLabel = (body.round_label ?? body.roundLabel) as string | undefined;
    const includeOnlyStatuses = body.include_only_statuses as string[] | undefined;

    const { data: project } = await supabaseAuth
      .from("projects")
      .select("id, user_id, name, permit_number, jurisdiction")
      .eq("id", projectId)
      .single();
    if (!project || project.user_id !== user.id) {
      return json({ error: "Project not found or access denied" }, 404);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const [commentsResult, brandingResult, architectResult, profileResult] = await Promise.all([
      supabase
        .from("parsed_comments")
        .select("discipline, status, original_text, code_reference, response_text, sheet_reference, assigned_to, created_at")
        .eq("project_id", projectId)
        .order("discipline", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("company_branding")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("architect_profiles")
        .select("signature_image_url, seal_image_url, license_number, license_state")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("company_name")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    if (commentsResult.error) {
      console.error("export-response-package: fetch error", commentsResult.error);
      return json({ error: commentsResult.error.message }, 500);
    }

    const rows = (commentsResult.data ?? []) as CommentRow[];
    const withResponse = rows.filter((r) => r.response_text != null && String(r.response_text).trim() !== "");
    const missingCount = rows.length - withResponse.length;

    let toExport = withResponse;
    if (includeOnlyStatuses?.length) {
      const set = new Set(includeOnlyStatuses.map((s: string) => s.toLowerCase()));
      toExport = toExport.filter((r) => set.has((r.status ?? "").toLowerCase()));
    }

    if (toExport.length === 0) {
      return json({ error: "No comments to export", missing_count: 0 }, 400);
    }

    const brandingData: CompanyBranding = {
      logo_url: brandingResult.data?.logo_url || null,
      company_name: profileResult.data?.company_name || brandingResult.data?.company_name || null,
      company_address: brandingResult.data?.company_address || null,
      company_phone: brandingResult.data?.company_phone || null,
      company_email: brandingResult.data?.company_email || null,
      company_website: brandingResult.data?.company_website || null,
      default_signoff: brandingResult.data?.default_signoff || "Respectfully submitted,",
    };

    const architectData: ArchitectProfile | null = architectResult.data ? {
      signature_image_url: architectResult.data.signature_image_url || null,
      seal_image_url: architectResult.data.seal_image_url || null,
      license_number: architectResult.data.license_number || null,
      license_state: architectResult.data.license_state || null,
    } : null;

    const projectData = {
      name: (project as Record<string, unknown>).name as string ?? "Project",
      permit_number: (project as Record<string, unknown>).permit_number as string | null ?? null,
      jurisdiction: (project as Record<string, unknown>).jurisdiction as string | null ?? null,
    };

    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
    const fonts: Fonts = { regular, bold, italic };

    switch (selectedTemplate) {
      case "letter":
        await renderLetterTemplate(doc, toExport, fonts, brandingData, architectData, projectData, municipalityAddress, customNotes, roundLabel);
        break;
      case "memo":
        await renderMemoTemplate(doc, toExport, fonts, brandingData, architectData, projectData, customNotes, roundLabel);
        break;
      case "simple":
      default:
        await renderSimpleTemplate(doc, toExport, fonts, brandingData, architectData, projectData, roundLabel);
        break;
    }

    const pdfBytes = await doc.save();
    const timestampSafe = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filePath = `exports/${projectId}/response-package-${selectedTemplate}-${timestampSafe}.pdf`;

    const { error: uploadError } = await supabase.storage.from("exports").upload(filePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

    if (uploadError) {
      console.error("export-response-package: upload error", uploadError);
      return json({ error: "Upload failed: " + uploadError.message }, 500);
    }

    const { data: signed, error: signError } = await supabase.storage.from("exports").createSignedUrl(filePath, 3600);
    if (signError || !signed?.signedUrl) {
      console.error("export-response-package: sign error", signError);
      return json({ error: "Signed URL failed", file_path: filePath }, 500);
    }

    return json({
      url: signed.signedUrl,
      file_path: filePath,
      template: selectedTemplate,
      exported_count: toExport.length,
      missing_count: missingCount,
      total_count: rows.length,
    });
  } catch (err) {
    console.error("export-response-package:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
