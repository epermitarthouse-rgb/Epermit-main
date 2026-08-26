-- QuickBooks milestone invoice trigger: atomic claim + ambiguous external-success states.
-- Service-role backend only; no client RLS changes required.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS m1_invoice_trigger_status TEXT,
  ADD COLUMN IF NOT EXISTS m2_invoice_trigger_status TEXT,
  ADD COLUMN IF NOT EXISTS m3_invoice_trigger_status TEXT,
  ADD COLUMN IF NOT EXISTS m1_qb_pending_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS m2_qb_pending_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS m3_qb_pending_invoice_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_m1_invoice_trigger_status_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_m1_invoice_trigger_status_check
      CHECK (
        m1_invoice_trigger_status IS NULL
        OR m1_invoice_trigger_status IN ('processing', 'completed', 'failed', 'qb_uncertain')
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_m2_invoice_trigger_status_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_m2_invoice_trigger_status_check
      CHECK (
        m2_invoice_trigger_status IS NULL
        OR m2_invoice_trigger_status IN ('processing', 'completed', 'failed', 'qb_uncertain')
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_m3_invoice_trigger_status_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_m3_invoice_trigger_status_check
      CHECK (
        m3_invoice_trigger_status IS NULL
        OR m3_invoice_trigger_status IN ('processing', 'completed', 'failed', 'qb_uncertain')
      );
  END IF;
END$$;

COMMENT ON COLUMN public.projects.m1_invoice_trigger_status IS
  'QuickBooks M1 trigger lifecycle: processing | completed | failed | qb_uncertain (external invoice id in m1_qb_pending_invoice_id).';

-- Atomic milestone claim (service_role). Returns JSON:
-- { "claimed": true } | { "claimed": false, "reason": "...", "pending_invoice_id": "..." }
CREATE OR REPLACE FUNCTION public.claim_project_milestone_invoice(
  p_project_id UUID,
  p_milestone TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.projects%ROWTYPE;
  v_status_col TEXT;
  v_invoice_col TEXT;
  v_triggered_col TEXT;
  v_triggered_at_col TEXT;
  v_trigger_source_col TEXT;
  v_pending_col TEXT;
  v_now TIMESTAMPTZ := now();
  v_stale_before TIMESTAMPTZ := now() - interval '15 minutes';
BEGIN
  IF p_milestone NOT IN ('M1', 'M2', 'M3') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_milestone');
  END IF;

  IF p_milestone = 'M1' THEN
    v_status_col := 'm1_invoice_trigger_status';
    v_invoice_col := 'qb_invoice_id_m1';
    v_triggered_col := 'm1_triggered';
    v_triggered_at_col := 'm1_triggered_at';
    v_trigger_source_col := 'm1_trigger_source';
    v_pending_col := 'm1_qb_pending_invoice_id';
  ELSIF p_milestone = 'M2' THEN
    v_status_col := 'm2_invoice_trigger_status';
    v_invoice_col := 'qb_invoice_id_m2';
    v_triggered_col := 'm2_triggered';
    v_triggered_at_col := 'm2_triggered_at';
    v_trigger_source_col := 'm2_trigger_source';
    v_pending_col := 'm2_qb_pending_invoice_id';
  ELSE
    v_status_col := 'm3_invoice_trigger_status';
    v_invoice_col := 'qb_invoice_id_m3';
    v_triggered_col := 'm3_triggered';
    v_triggered_at_col := 'm3_triggered_at';
    v_trigger_source_col := 'm3_trigger_source';
    v_pending_col := 'm3_qb_pending_invoice_id';
  END IF;

  SELECT * INTO v_row FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'project_not_found');
  END IF;

  IF (to_jsonb(v_row) ->> v_triggered_col)::boolean IS TRUE
     OR COALESCE(to_jsonb(v_row) ->> v_invoice_col, '') <> '' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_triggered');
  END IF;

  IF COALESCE(to_jsonb(v_row) ->> v_pending_col, '') <> '' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'qb_uncertain',
      'pending_invoice_id', to_jsonb(v_row) ->> v_pending_col
    );
  END IF;

  IF (to_jsonb(v_row) ->> v_status_col) = 'qb_uncertain' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'qb_uncertain',
      'pending_invoice_id', to_jsonb(v_row) ->> v_pending_col
    );
  END IF;

  IF (to_jsonb(v_row) ->> v_status_col) = 'processing'
     AND (to_jsonb(v_row) ->> v_triggered_at_col) IS NOT NULL
     AND (to_jsonb(v_row) ->> v_triggered_at_col)::timestamptz > v_stale_before THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'in_progress');
  END IF;

  IF (to_jsonb(v_row) ->> v_status_col) IS NOT NULL
     AND (to_jsonb(v_row) ->> v_status_col) NOT IN ('failed', 'processing') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_triggered');
  END IF;

  EXECUTE format(
    'UPDATE public.projects SET %I = $1, %I = $2, %I = $3 WHERE id = $4',
    v_status_col,
    v_triggered_at_col,
    v_trigger_source_col
  ) USING 'processing', v_now, 'manual', p_project_id;

  RETURN jsonb_build_object('claimed', true, 'claimed_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_project_milestone_invoice(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_project_milestone_invoice(UUID, TEXT) TO service_role;
