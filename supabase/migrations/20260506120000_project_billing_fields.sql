-- Phase 4B: Nullable billing, reimbursement, milestone trigger metadata on projects.
-- Idempotent: IF NOT EXISTS columns; constraints via guarded DO blocks.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS client_email TEXT,
  ADD COLUMN IF NOT EXISTS service_type TEXT,
  ADD COLUMN IF NOT EXISTS contract_value NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS reimbursement_amount NUMERIC(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reimbursement_description TEXT,
  ADD COLUMN IF NOT EXISTS m1_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS m2_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS m3_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS m1_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS m2_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS m3_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS m1_trigger_source TEXT,
  ADD COLUMN IF NOT EXISTS m2_trigger_source TEXT,
  ADD COLUMN IF NOT EXISTS m3_trigger_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_contract_value_non_negative'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_contract_value_non_negative
      CHECK (contract_value IS NULL OR contract_value >= 0);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_reimbursement_amount_non_negative'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_reimbursement_amount_non_negative
      CHECK (reimbursement_amount IS NULL OR reimbursement_amount >= 0);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_m1_trigger_source_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_m1_trigger_source_check
      CHECK (
        m1_trigger_source IS NULL
        OR m1_trigger_source IN ('manual', 'agent', 'system')
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_m2_trigger_source_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_m2_trigger_source_check
      CHECK (
        m2_trigger_source IS NULL
        OR m2_trigger_source IN ('manual', 'agent', 'system')
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_m3_trigger_source_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_m3_trigger_source_check
      CHECK (
        m3_trigger_source IS NULL
        OR m3_trigger_source IN ('manual', 'agent', 'system')
      );
  END IF;
END$$;
