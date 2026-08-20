-- Track B — UCI Lifecycle Completion (Stages 7–10)
-- Additive only. No drops. Existing RLS policies unchanged.

-- -----------------------------------------------------------------------------
-- coordination_records — Stage 9/10 + prediction audit columns
-- -----------------------------------------------------------------------------

ALTER TABLE public.coordination_records
  ADD COLUMN IF NOT EXISTS inspection_release_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meter_set_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS site_readiness_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS site_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS site_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS site_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS energization_date_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS closeout_package_doc_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS predicted_p50_previous DATE,
  ADD COLUMN IF NOT EXISTS predicted_p50_computed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_coordination_records_meter_set_scheduled
  ON public.coordination_records (meter_set_scheduled_at)
  WHERE meter_set_scheduled_at IS NOT NULL
    AND site_readiness_confirmed_at IS NULL;

-- -----------------------------------------------------------------------------
-- coordination_costs — CIAC type, approval, QB sync (no unique on record+type)
-- -----------------------------------------------------------------------------

UPDATE public.coordination_costs
SET cost_type = 'CIAC'
WHERE lower(trim(coalesce(cost_type, ''))) IN ('ciac', 'ciac_estimate');

ALTER TABLE public.coordination_costs
  ADD COLUMN IF NOT EXISTS client_approval_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS client_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_hold BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS human_override_bill_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qb_sync_status TEXT NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS qb_last_error TEXT,
  ADD COLUMN IF NOT EXISTS qb_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_source TEXT,
  ADD COLUMN IF NOT EXISTS estimated_source TEXT;

ALTER TABLE public.coordination_costs
  DROP CONSTRAINT IF EXISTS coordination_costs_cost_type_check;
ALTER TABLE public.coordination_costs
  ADD CONSTRAINT coordination_costs_cost_type_check
  CHECK (
    cost_type IS NULL
    OR cost_type IN (
      'CIAC',
      'application_fee',
      'design_review',
      'meter',
      'recording',
      'courier'
    )
  );

ALTER TABLE public.coordination_costs
  DROP CONSTRAINT IF EXISTS coordination_costs_client_approval_status_check;
ALTER TABLE public.coordination_costs
  ADD CONSTRAINT coordination_costs_client_approval_status_check
  CHECK (client_approval_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.coordination_costs
  DROP CONSTRAINT IF EXISTS coordination_costs_qb_sync_status_check;
ALTER TABLE public.coordination_costs
  ADD CONSTRAINT coordination_costs_qb_sync_status_check
  CHECK (
    qb_sync_status IN (
      'not_ready',
      'ready',
      'pending',
      'succeeded',
      'retry',
      'failed',
      'uncertain'
    )
  );

CREATE INDEX IF NOT EXISTS idx_coordination_costs_qb_retry
  ON public.coordination_costs (qb_sync_status, updated_at)
  WHERE qb_sync_status IN ('ready', 'pending', 'retry', 'uncertain');

-- -----------------------------------------------------------------------------
-- coordination_equipment — check-in provenance + due index
-- -----------------------------------------------------------------------------

ALTER TABLE public.coordination_equipment
  ADD COLUMN IF NOT EXISTS check_in_method TEXT,
  ADD COLUMN IF NOT EXISTS last_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_weeks_of_slip NUMERIC(6, 2);

CREATE INDEX IF NOT EXISTS idx_coord_equipment_check_in_pending
  ON public.coordination_equipment (tenant_id, next_check_in_at)
  WHERE status IN ('pending', 'on_order', 'shipped');

-- -----------------------------------------------------------------------------
-- projects — rollup when ALL coordination records reach Stage 10 COMPLETED
-- -----------------------------------------------------------------------------

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS utility_coordination_completed_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- project_documents — closeout package type
-- -----------------------------------------------------------------------------

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'uci_closeout_package';

-- -----------------------------------------------------------------------------
-- utility_stage_duration_baselines — P50 fallbacks (stage N → 10)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.utility_stage_duration_baselines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  utility_type TEXT NOT NULL,
  ownership_type TEXT NOT NULL,
  from_stage SMALLINT NOT NULL CHECK (from_stage BETWEEN 1 AND 10),
  to_stage SMALLINT NOT NULL DEFAULT 10 CHECK (to_stage = 10),
  p50_business_days INTEGER NOT NULL CHECK (p50_business_days >= 0),
  source TEXT NOT NULL DEFAULT 'seed_fallback',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT utility_stage_duration_baselines_unique
    UNIQUE (utility_type, ownership_type, from_stage)
);

CREATE INDEX IF NOT EXISTS idx_utility_stage_duration_baselines_lookup
  ON public.utility_stage_duration_baselines (utility_type, ownership_type, from_stage);

ALTER TABLE public.utility_stage_duration_baselines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select utility stage duration baselines"
  ON public.utility_stage_duration_baselines;
CREATE POLICY "Users can select utility stage duration baselines"
  ON public.utility_stage_duration_baselines
  FOR SELECT
  USING (true);

DROP TRIGGER IF EXISTS utility_stage_duration_baselines_updated_at
  ON public.utility_stage_duration_baselines;
CREATE TRIGGER utility_stage_duration_baselines_updated_at
  BEFORE UPDATE ON public.utility_stage_duration_baselines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed fallbacks for common utility / ownership combinations.
-- remaining_days = baseline(current_stage → 10) + elapsed business days in current stage.
INSERT INTO public.utility_stage_duration_baselines
  (utility_type, ownership_type, from_stage, to_stage, p50_business_days, source)
SELECT
  u.utility_type,
  o.ownership_type,
  s.from_stage,
  10,
  s.p50_business_days,
  'seed_fallback'
FROM (
  VALUES
    ('electric'),
    ('gas'),
    ('water'),
    ('sewer')
) AS u(utility_type)
CROSS JOIN (
  VALUES
    ('iou'),
    ('municipal'),
    ('cooperative'),
    ('unknown')
) AS o(ownership_type)
CROSS JOIN (
  VALUES
    (1, 180),
    (2, 160),
    (3, 140),
    (4, 120),
    (5, 100),
    (6, 80),
    (7, 55),
    (8, 40),
    (9, 18),
    (10, 5)
) AS s(from_stage, p50_business_days)
ON CONFLICT (utility_type, ownership_type, from_stage) DO NOTHING;
