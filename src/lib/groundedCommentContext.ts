/**
 * Client mirror of supabase/functions/_shared/groundedCommentContext.ts
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
  const rawOriginal = (input.original_text ?? "").trim();
  const previous = (input.previous_comment_text ?? "").trim();
  const existing = (input.existing_response_text ?? "").trim();

  const original =
    rawOriginal && !PLACEHOLDER_ORIGINAL_RE.test(rawOriginal) ? rawOriginal : "";

  const codeRefs = parseStoredCodeReferences(input.code_references);
  const primaryCode = (input.code_reference ?? "").trim();
  const code_references = [...new Set([primaryCode, ...codeRefs].filter(Boolean))];

  const retrievalParts = [
    original,
    previous,
    existing ? `Existing applicant response: ${existing}` : "",
    input.discipline ? `Discipline: ${input.discipline}` : "",
    code_references.length > 0 ? `Code references: ${code_references.join(", ")}` : "",
    input.reviewer_name ? `Reviewer: ${input.reviewer_name}` : "",
    input.comment_number ? `Comment number: ${input.comment_number}` : "",
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

  const has_substantive_content =
    (original.length >= 8) ||
    (previous.length >= 12) ||
    (existing.length >= 8) ||
    (rawOriginal.length >= 8 && !PLACEHOLDER_ORIGINAL_RE.test(rawOriginal));

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
  const rawOriginal = (input.original_text ?? "").trim();
  return {
    ...ctx,
    reviewer_name: (input.reviewer_name ?? "").trim(),
    comment_number: (input.comment_number ?? "").trim(),
    discipline: (input.discipline ?? "").trim(),
    code_reference: (input.code_reference ?? "").trim(),
    ingest_source: input.ingest_source ?? null,
    source_document_id: input.source_document_id ?? null,
    is_manual_letter: input.ingest_source === "manual_letter",
    is_portal: input.ingest_source === "raw_ref",
    display_primary_text: ctx.original_text || ctx.previous_comment_text || rawOriginal,
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

export function groundedDraftPayloadFromRow(row: {
  project_id: string;
  id: string;
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
    project_id: row.project_id,
    comment_id: row.id,
    comment_text: row.original_text,
    previous_comment_text: row.previous_comment_text ?? "",
    existing_response_text: row.existing_response_text ?? "",
    discipline: row.discipline,
    code_reference: row.code_reference || "",
    code_references: ctx.code_references,
    reviewer_name: row.reviewer_name || "",
    comment_number: row.comment_number || "",
    retrieval_query_text: ctx.retrieval_query_text,
    prompt_comment_block: ctx.prompt_comment_block,
  };
}
