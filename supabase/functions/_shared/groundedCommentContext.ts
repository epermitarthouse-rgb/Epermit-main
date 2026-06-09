/**
 * Builds retrieval query + prompt blocks for grounded comment responses.
 * Ensures previous_comment_text is included when original_text is short or a placeholder.
 */

export interface GroundedCommentInput {
  original_text?: string | null;
  previous_comment_text?: string | null;
  existing_response_text?: string | null;
  reviewer_name?: string | null;
  comment_number?: string | null;
  discipline?: string | null;
  code_reference?: string | null;
  code_references?: string[] | string | null;
}

export interface GroundedCommentContext {
  original_text: string;
  previous_comment_text: string;
  existing_response_text: string;
  retrieval_query_text: string;
  prompt_comment_block: string;
  code_references: string[];
  has_substantive_content: boolean;
}

const PLACEHOLDER_ORIGINAL_RE = /^see previous comments?\.?$/i;

const UNUSABLE_TEXT_LITERALS = new Set(["null", "undefined"]);

export const GROUNDED_NO_REVIEW_TEXT_MESSAGE =
  "Cannot generate grounded response because this comment has no review text. Please edit the comment and add text first.";

/** Treat null, undefined, empty, whitespace, and literal "null"/"undefined" as empty. */
export function sanitizeGroundedTextField(value: string | null | undefined): string {
  if (value == null) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  if (UNUSABLE_TEXT_LITERALS.has(trimmed.toLowerCase())) return "";
  return trimmed;
}

export function hasGroundedReviewText(input: GroundedCommentInput): boolean {
  const ctx = buildGroundedCommentContext(input);
  return Boolean(ctx.original_text || ctx.previous_comment_text);
}

export function parseStoredCodeReferences(
  raw: string[] | string | null | undefined,
): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => v.trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      }
    } catch {
      return [raw.trim()];
    }
  }
  return [];
}

export function buildGroundedCommentContext(
  input: GroundedCommentInput,
): GroundedCommentContext {
  const rawOriginal = sanitizeGroundedTextField(input.original_text);
  const previous = sanitizeGroundedTextField(input.previous_comment_text);
  const existing = sanitizeGroundedTextField(input.existing_response_text);
  const discipline = sanitizeGroundedTextField(input.discipline);
  const reviewerName = sanitizeGroundedTextField(input.reviewer_name);
  const commentNumber = sanitizeGroundedTextField(input.comment_number);

  const original =
    rawOriginal && !PLACEHOLDER_ORIGINAL_RE.test(rawOriginal) ? rawOriginal : "";

  const codeRefs = parseStoredCodeReferences(input.code_references)
    .map((ref) => sanitizeGroundedTextField(ref))
    .filter(Boolean);
  const primaryCode = sanitizeGroundedTextField(input.code_reference);
  const code_references = [...new Set([primaryCode, ...codeRefs].filter(Boolean))];

  const retrievalParts = [
    original,
    previous,
    existing ? `Existing applicant response: ${existing}` : "",
    discipline ? `Discipline: ${discipline}` : "",
    code_references.length > 0 ? `Code references: ${code_references.join(", ")}` : "",
    reviewerName ? `Reviewer: ${reviewerName}` : "",
    commentNumber ? `Comment number: ${commentNumber}` : "",
  ].filter(Boolean);

  const promptSections: string[] = [];
  if (original) {
    promptSections.push(`Current reviewer comment:\n${original}`);
  }
  if (previous) {
    promptSections.push(`Previous reviewer comment/context:\n${previous}`);
  }
  if (existing) {
    promptSections.push(`Existing applicant response on letter:\n${existing}`);
  }
  if (!original && !previous && rawOriginal) {
    promptSections.push(`Current reviewer comment:\n${rawOriginal}`);
  }

  const prompt_comment_block =
    promptSections.join("\n\n") ||
    rawOriginal ||
    previous ||
    existing;

  const has_substantive_content = Boolean(original || previous);

  return {
    original_text: original,
    previous_comment_text: previous,
    existing_response_text: existing,
    retrieval_query_text: retrievalParts.join("\n"),
    prompt_comment_block,
    code_references,
    has_substantive_content,
  };
}

export function buildFullCommentContext(
  input: GroundedCommentInput & {
    ingest_source?: string | null;
    source_document_id?: string | null;
  },
) {
  const ctx = buildGroundedCommentContext(input);
  const rawOriginal = sanitizeGroundedTextField(input.original_text);
  return {
    ...ctx,
    reviewer_name: sanitizeGroundedTextField(input.reviewer_name),
    comment_number: sanitizeGroundedTextField(input.comment_number),
    discipline: sanitizeGroundedTextField(input.discipline),
    code_reference: sanitizeGroundedTextField(input.code_reference),
    ingest_source: input.ingest_source ?? null,
    source_document_id: input.source_document_id ?? null,
    is_manual_letter: input.ingest_source === "manual_letter",
    is_portal: input.ingest_source === "raw_ref",
    display_primary_text: ctx.original_text || ctx.previous_comment_text,
    should_expand_previous: Boolean(
      ctx.previous_comment_text &&
        (!ctx.original_text || ctx.original_text.length < 48 || PLACEHOLDER_ORIGINAL_RE.test(rawOriginal)),
    ),
  };
}

export function autoDraftPayloadFromRow(row: {
  original_text: string;
  discipline: string;
  code_reference?: string | null;
  reviewer_name?: string | null;
  comment_number?: string | null;
  previous_comment_text?: string | null;
  existing_response_text?: string | null;
  code_references?: string[] | string | null;
}) {
  const ctx = buildGroundedCommentContext(row);
  return {
    comment_text: ctx.prompt_comment_block,
    previous_comment_text: ctx.previous_comment_text,
    existing_response_text: ctx.existing_response_text,
    discipline: row.discipline,
    code_reference: row.code_reference || ctx.code_references[0] || "",
    code_references: ctx.code_references,
    reviewer_name: row.reviewer_name || "",
    comment_number: row.comment_number || "",
  };
}
