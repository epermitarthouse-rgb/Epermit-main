/**
 * Client-side document text extraction for manual comment letter parsing.
 */
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  buildFullTextWithPageMarkers,
  type DocumentPageText,
} from "@/lib/manualCommentLetterParse";

const MIN_PAGE_TEXT_CHARS = 40;
const MIN_TOTAL_TEXT_CHARS = 80;

export type DocumentExtractionResult =
  | {
      kind: "text";
      pages: DocumentPageText[];
      fullText: string;
      sourceFileName: string;
      sparsePageNumbers: number[];
    }
  | {
      kind: "image";
      file: File;
      sourceFileName: string;
    }
  | {
      kind: "unsupported_doc";
      message: string;
    };

export const COMMENT_LETTER_SUPPORTED_FORMATS_HINT =
  "Supported: PDF, DOCX, XLSX, CSV, PNG, JPG. Legacy DOC/XLS may require conversion.";

export const LEGACY_DOC_ERROR_MESSAGE =
  "Legacy .DOC files are not supported. Please open the file in Word/Google Docs and save it as .DOCX or PDF.";

export const LEGACY_XLS_ERROR_MESSAGE =
  "Legacy .XLS files are not supported yet. Please upload XLSX or CSV.";

export function isLegacyDocFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".doc") && !name.endsWith(".docx");
}

export function isLegacyXlsFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xls") && !name.endsWith(".xlsx");
}

export function isSpreadsheetFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    name.endsWith(".csv") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "text/csv" ||
    file.type === "application/csv"
  );
}

function formatSpreadsheetRows(sheetName: string, rows: string[][]): string {
  const lines = [`Sheet: ${sheetName}`];
  rows.forEach((row, index) => {
    const cells = row.map((cell) => String(cell ?? "").trim());
    if (cells.some((cell) => cell.length > 0)) {
      lines.push(`Row ${index + 1}: ${cells.join(" | ")}`);
    }
  });
  return lines.join("\n");
}

/** Parse CSV text into rows while preserving quoted fields. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      if (ch === "\r") i++;
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

/** Extract CSV rows into readable text for the comment parser. */
export async function extractCsvText(file: File): Promise<DocumentPageText[]> {
  const raw = await file.text();
  const rows = parseCsvText(raw.replace(/^\uFEFF/, ""));
  return [{ pageNumber: 1, text: formatSpreadsheetRows("CSV", rows) }];
}

/** Extract all XLSX sheets into readable text for the comment parser. */
export async function extractXlsxText(file: File): Promise<DocumentPageText[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const pages: DocumentPageText[] = [];

  workbook.SheetNames.forEach((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as string[][];
    pages.push({
      pageNumber: index + 1,
      text: formatSpreadsheetRows(sheetName, rows),
    });
  });

  if (pages.length === 0) {
    return [{ pageNumber: 1, text: "Sheet: Workbook\n" }];
  }

  return pages;
}

/** Extract text from all pages of a PDF; track pages with little text for OCR fallback. */
export async function extractPdfTextAllPages(file: File): Promise<{
  pages: DocumentPageText[];
  sparsePageNumbers: number[];
}> {
  const arrayBuffer = await file.arrayBuffer();
  const worker = new Worker(pdfjsWorkerUrl, { type: "module" });
  const pdfWorker = new pdfjsLib.PDFWorker({ port: worker });
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer, worker: pdfWorker }).promise;
  const pages: DocumentPageText[] = [];
  const sparsePageNumbers: number[] = [];

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ pageNumber: i, text });
      if (text.length < MIN_PAGE_TEXT_CHARS) {
        sparsePageNumbers.push(i);
      }
    }
  } finally {
    worker.terminate();
  }

  return { pages, sparsePageNumbers };
}

/** Extract plain text from a DOCX file. */
export async function extractDocxText(file: File): Promise<DocumentPageText[]> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = (result.value ?? "").replace(/\r\n/g, "\n").trim();
  return [{ pageNumber: 1, text }];
}

export async function extractDocumentForCommentParse(
  file: File,
): Promise<DocumentExtractionResult> {
  if (isLegacyDocFile(file)) {
    return {
      kind: "unsupported_doc",
      message: LEGACY_DOC_ERROR_MESSAGE,
    };
  }

  if (isLegacyXlsFile(file) || file.type === "application/vnd.ms-excel") {
    return {
      kind: "unsupported_doc",
      message: LEGACY_XLS_ERROR_MESSAGE,
    };
  }

  const sourceFileName = file.name;
  const lowerName = file.name.toLowerCase();

  if (
    lowerName.endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/csv"
  ) {
    const pages = await extractCsvText(file);
    const fullText = buildFullTextWithPageMarkers(pages);
    return {
      kind: "text",
      pages,
      fullText,
      sourceFileName,
      sparsePageNumbers: pages[0].text.length < MIN_TOTAL_TEXT_CHARS ? [1] : [],
    };
  }

  if (
    lowerName.endsWith(".xlsx") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    const pages = await extractXlsxText(file);
    const fullText = buildFullTextWithPageMarkers(pages);
    const sparsePageNumbers = pages
      .filter((page) => page.text.length < MIN_PAGE_TEXT_CHARS)
      .map((page) => page.pageNumber);
    return {
      kind: "text",
      pages,
      fullText,
      sourceFileName,
      sparsePageNumbers,
    };
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    const pages = await extractDocxText(file);
    const fullText = buildFullTextWithPageMarkers(pages);
    return {
      kind: "text",
      pages,
      fullText,
      sourceFileName,
      sparsePageNumbers: pages[0].text.length < MIN_TOTAL_TEXT_CHARS ? [1] : [],
    };
  }

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const { pages, sparsePageNumbers } = await extractPdfTextAllPages(file);
    const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
    const fullText = buildFullTextWithPageMarkers(pages);

    if (totalChars < MIN_TOTAL_TEXT_CHARS) {
      return { kind: "image", file, sourceFileName };
    }

    return {
      kind: "text",
      pages,
      fullText,
      sourceFileName,
      sparsePageNumbers,
    };
  }

  if (file.type.startsWith("image/")) {
    return { kind: "image", file, sourceFileName };
  }

  return {
    kind: "unsupported_doc",
    message: "Unsupported file type. Please upload PDF, DOCX, XLSX, CSV, or an image.",
  };
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
