/**
 * Shared types/helpers for manual comment letter text extraction (client).
 * Full deterministic parsing runs in the parse-manual-comment-letter edge function.
 */

export interface DocumentPageText {
  pageNumber: number;
  text: string;
}

export function buildFullTextWithPageMarkers(pages: DocumentPageText[]): string {
  if (pages.length === 0) return "";
  return pages
    .map((p) => `\n[[PAGE:${p.pageNumber}]]\n${p.text}`)
    .join("\n");
}
