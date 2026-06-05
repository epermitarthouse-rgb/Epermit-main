/**
 * Client-side document text extraction for manual comment letter parsing.
 */
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
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
  "Supported: PDF, DOCX, PNG, JPG. Legacy .DOC files are not supported — please save as DOCX or PDF.";

export const LEGACY_DOC_ERROR_MESSAGE =
  "Legacy .DOC files are not supported. Please open the file in Word/Google Docs and save it as .DOCX or PDF.";

export function isLegacyDocFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".doc") && !name.endsWith(".docx");
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

  const sourceFileName = file.name;

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
    message: "Unsupported file type. Please upload PDF, DOCX, or an image.",
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
