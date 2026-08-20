-- Stage 6 — operator accepted values + override audit + frozen approval snapshot.
-- Utility-issued extraction (extracted_fields) remains immutable source of truth.

ALTER TABLE public.coordination_cos_design_records
  ADD COLUMN IF NOT EXISTS accepted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS field_overrides JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS review_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.coordination_cos_design_records.accepted_fields IS
  'Operator-accepted values per field; defaults to utility-issued; never mutates extracted_fields';
COMMENT ON COLUMN public.coordination_cos_design_records.field_overrides IS
  'Append-only audit of accepted-value edits (reason required when differing from utility-issued)';
COMMENT ON COLUMN public.coordination_cos_design_records.approved_snapshot IS
  'Frozen reviewed/accepted snapshot at Approve COS; prior versions keep their own snapshot';
COMMENT ON COLUMN public.coordination_cos_design_records.review_version IS
  'Increments on accepted-value edits within a COS design record version';
