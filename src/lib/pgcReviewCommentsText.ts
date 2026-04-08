/**
 * PGC SSRS PDF text extraction often glues column headers and cells. Normalize into
 * line-oriented text for Reports UI (Review Comments only, pgc-export artifacts).
 */
export function normalizePgcFlattenedReviewCommentsText(raw: string): string {
  let s = String(raw || "").replace(/\r\n/g, "\n");

  // Glued ".pdf" + status (no space)
  s = s.replace(
    /\.pdf\s*(UnResolved|Resolved|Info\s*Only|InfoOnly)\b/gi,
    ".pdf $1",
  );
  // ".pdf" immediately followed by other letters (row boundary)
  s = s.replace(/\.pdf(?=[A-Za-z])/g, ".pdf\n");

  // Concatenated header labels (common PGC Plan Review export)
  s = s.replace(/REF\s*#\s*CYCLE(?=REVIEWED)/gi, "REF # CYCLE\n");
  s = s.replace(/CYCLE(?=REVIEWED)/gi, "CYCLE\n");
  s = s.replace(/REVIEWED\s*BY(?=TYPE)/gi, "REVIEWED BY\n");
  s = s.replace(/TYPE(?=FILENAME)/gi, "TYPE\n");
  s = s.replace(/FILENAME(?=DISCUSSION)/gi, "FILENAME\n");
  s = s.replace(/DISCUSSION(?=STATUS)/gi, "DISCUSSION\n");
  s = s.replace(/STATUS(?=REF)/gi, "STATUS\n");

  s = s.replace(/REF#\s*/gi, "REF # ");
  // Start of a new REF row after other content on same line
  s = s.replace(/([^\n])(?=(?:REF\s*#\s*\d+|REF\s*#\s*CYCLE))/gi, "$1\n");

  // Blank line between rows when status is immediately followed by next REF
  s = s.replace(
    /\b(UnResolved|Resolved|Info\s*Only|InfoOnly)\b\s*(?=(?:REF\s*#))/gi,
    "$1\n\n",
  );

  return s.replace(/\n{3,}/g, "\n\n").trim();
}

export function shouldNormalizePgcReviewCommentsDisplayText(
  fileName: string | undefined,
  info: { source?: string } | undefined,
): boolean {
  return (
    String(info?.source ?? "") === "pgc-export" &&
    String(fileName ?? "").includes("Review Comments")
  );
}
