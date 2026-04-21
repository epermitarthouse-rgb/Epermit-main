/**
 * Re-export shared PGC Review Comments deterministic parser (see supabase/functions/_shared).
 */
export {
  inferPgcDisciplineFromReviewedBy,
  parsePgcReviewComments,
  parsePgcReviewCommentsStacked,
  preprocessPgcReviewCommentsExtractText,
  type PgcReviewCommentsRow,
} from "../../supabase/functions/_shared/pgcReviewCommentsStackedParse.ts";
