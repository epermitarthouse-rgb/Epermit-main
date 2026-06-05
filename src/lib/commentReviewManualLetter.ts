import type { ProjectDocument } from "@/types/document";

export const MANUAL_COMMENT_LETTER_DESCRIPTION =
  "Manual comment letter upload (Comment Review)";

export function isManualCommentLetter(
  doc: Pick<ProjectDocument, "document_type" | "description">,
): boolean {
  return (
    doc.document_type === "correspondence" &&
    Boolean(doc.description?.includes("Manual comment letter upload"))
  );
}

export type ManualLetterCommentScope = "source_document" | "project_manual";
