-- Track A — UCI §4.1–§4.6 + prediction provenance
-- Additive. Existing RLS policies unchanged.

-- -----------------------------------------------------------------------------
-- coordination_records — nullable provider, unique type+scope, prediction audit
-- -----------------------------------------------------------------------------

ALTER TABLE public.coordination_records
  ALTER COLUMN utility_provider_id DROP NOT NULL;

ALTER TABLE public.coordination_records
  DROP CONSTRAINT IF EXISTS coordination_records_project_provider_scope_unique;
ALTER TABLE public.coordination_records
  DROP CONSTRAINT IF EXISTS coordination_records_project_provider_type_scope_unique;

-- Older uniqueness was (project, provider, type, scope), so one project could have
-- two electric rows with scope_description = ''. Relabel extras before tightening.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, utility_type, COALESCE(scope_description, '')
      ORDER BY
        CASE WHEN utility_provider_id IS NULL THEN 1 ELSE 0 END,
        COALESCE(current_stage, 0) DESC,
        CASE WHEN current_stage_state = 'COMPLETED' THEN 0 ELSE 1 END,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id
    ) AS keep_rank
  FROM public.coordination_records
)
UPDATE public.coordination_records AS rec
SET
  scope_description = 'legacy-duplicate:' || REPLACE(rec.id::text, '-', ''),
  metadata = COALESCE(rec.metadata, '{}'::jsonb) || jsonb_build_object(
    'uci_legacy_type_scope_duplicate', true,
    'original_scope_description', COALESCE(rec.scope_description, '')
  )
FROM ranked
WHERE rec.id = ranked.id
  AND ranked.keep_rank > 1;

ALTER TABLE public.coordination_records
  DROP CONSTRAINT IF EXISTS coordination_records_project_type_scope_unique;
ALTER TABLE public.coordination_records
  ADD CONSTRAINT coordination_records_project_type_scope_unique
  UNIQUE (project_id, utility_type, scope_description);

ALTER TABLE public.coordination_records
  ADD COLUMN IF NOT EXISTS current_stage_entered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prediction_baseline_source TEXT,
  ADD COLUMN IF NOT EXISTS prediction_sample_size INTEGER,
  ADD COLUMN IF NOT EXISTS prediction_reason JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.coordination_records
  DROP CONSTRAINT IF EXISTS coordination_records_prediction_baseline_source_check;
ALTER TABLE public.coordination_records
  ADD CONSTRAINT coordination_records_prediction_baseline_source_check
  CHECK (
    prediction_baseline_source IS NULL
    OR prediction_baseline_source IN (
      'historical',
      'seed_fallback',
      'code_fallback',
      'operator_override'
    )
  );

CREATE INDEX IF NOT EXISTS idx_coordination_records_null_provider
  ON public.coordination_records (project_id, utility_type)
  WHERE utility_provider_id IS NULL;

-- -----------------------------------------------------------------------------
-- coordination_applications — Graph identity, bounce, approved_for_submission
-- -----------------------------------------------------------------------------

ALTER TABLE public.coordination_applications
  DROP CONSTRAINT IF EXISTS coordination_applications_draft_status_check;

ALTER TABLE public.coordination_applications
  ADD CONSTRAINT coordination_applications_draft_status_check
  CHECK (
    draft_status IN (
      'draft',
      'reviewed',
      'approved_for_submission',
      'needs_changes',
      'submitted',
      'failed'
    )
  );

ALTER TABLE public.coordination_applications
  ADD COLUMN IF NOT EXISTS graph_message_id TEXT,
  ADD COLUMN IF NOT EXISTS graph_internet_message_id TEXT,
  ADD COLUMN IF NOT EXISTS email_bounced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_coordination_applications_graph_message
  ON public.coordination_applications (graph_message_id)
  WHERE graph_message_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Baselines: keep seed_fallback source explicit (never treat as historical)
-- -----------------------------------------------------------------------------

ALTER TABLE public.utility_stage_duration_baselines
  DROP CONSTRAINT IF EXISTS utility_stage_duration_baselines_source_check;
ALTER TABLE public.utility_stage_duration_baselines
  ADD CONSTRAINT utility_stage_duration_baselines_source_check
  CHECK (source IN ('seed_fallback', 'historical', 'operator_override'));

UPDATE public.utility_stage_duration_baselines
SET source = 'seed_fallback'
WHERE source IS NULL OR source = '' OR source = 'seed';
