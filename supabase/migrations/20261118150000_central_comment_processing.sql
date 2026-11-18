-- Central comment processing, reused on project link (D-121..D-124, D-130..D-132; CENTRAL_PROCESSING_PROPOSAL.md option A).
--
-- 1. permit_comment_insights: preliminary AI analysis per central comment (permit_review_comments), keyed by
--    (comment, input hash, processing version), with discipline, confidence, code reference with provenance
--    (cited / inferred / none), generic guidance and limitations. One current row per comment; older rows are kept
--    as history (is_current false, superseded_at). Readable like the comment (can_read_permit); service-role writes only.
-- 2. permit_comment_processing_state + permit_central_claim / permit_central_finish: the same leased state machine
--    as project_comment_pipeline_state, per permit. A permit is due when the fingerprint over its comments' input
--    hashes and the processing version differs from the last completed one.
-- 3. permit_ai_budgets + permit_ai_cost_ledger: every central AI call reserves its upper-bound cost first and is
--    refused when it could pass the approved cap; the real token usage is settled after the call.
-- 4. parsed_comments: per-comment processing status, field provenance (central / project_ai / human), the central
--    result a row was filled from, and a marker for newer central results that were not applied over human edits.
--    A trigger records 'human' when a signed-in user changes a tracked field.
-- 5. The project fingerprint also covers the current central results of its permits, so linked projects pick up
--    new central results (with zero AI calls). Unchanged while no central result exists.
--
-- Additive and idempotent. Nothing runs until the dispatcher is deployed with CENTRAL_PROCESSING_ENABLED and an
-- approved budget exists. Rollback: scripts/permit-repo/rollback-20261118150000_central_comment_processing.sql

-- ---------------------------------------------------------------------------
-- 1. Central results
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permit_comment_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL REFERENCES public.permits(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES public.permit_review_comments(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  processing_version TEXT NOT NULL,
  analysis_kind TEXT NOT NULL DEFAULT 'preliminary_ai' CHECK (analysis_kind = 'preliminary_ai'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'needs_attention')),
  is_current BOOLEAN NOT NULL DEFAULT false,
  discipline TEXT,
  discipline_confidence NUMERIC(4, 3),
  code_reference TEXT,
  code_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  code_basis TEXT CHECK (code_basis IN ('cited', 'inferred', 'none')),
  guidance_text TEXT,
  limitations TEXT[] NOT NULL DEFAULT '{}',
  model TEXT,
  classifier_prompt_version TEXT,
  enrichment_prompt_version TEXT,
  copied_from_insight_id UUID REFERENCES public.permit_comment_insights(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  classified_at TIMESTAMPTZ,
  enriched_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permit_comment_insights_key UNIQUE (comment_id, input_hash, processing_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_permit_comment_insights_current
  ON public.permit_comment_insights (comment_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_permit_comment_insights_permit ON public.permit_comment_insights (permit_id);
CREATE INDEX IF NOT EXISTS idx_permit_comment_insights_ready_hash
  ON public.permit_comment_insights (input_hash, processing_version) WHERE status = 'ready';

COMMENT ON TABLE public.permit_comment_insights IS
  'Preliminary AI analysis of central permit comments (not verified compliance). Permit-level inputs only; no project data.';

ALTER TABLE public.permit_comment_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Readable permit comment insights" ON public.permit_comment_insights;
CREATE POLICY "Readable permit comment insights" ON public.permit_comment_insights
FOR SELECT TO authenticated USING (status = 'ready' AND public.can_read_permit(permit_id));

-- ---------------------------------------------------------------------------
-- 2. Per-permit processing state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permit_comment_processing_state (
  permit_id UUID PRIMARY KEY REFERENCES public.permits(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'due'
    CHECK (status IN ('due', 'running', 'completed', 'failed', 'blocked', 'paused')),
  processing_version TEXT,
  requested_fingerprint TEXT,
  completed_fingerprint TEXT,
  force_requested BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 0,
  continuations INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.permit_comment_processing_state ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. AI budget and cost ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permit_ai_budgets (
  scope TEXT PRIMARY KEY CHECK (scope ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  cap_usd NUMERIC(10, 4) NOT NULL CHECK (cap_usd >= 0 AND cap_usd <= 100),
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  closed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.permit_ai_budgets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.permit_ai_cost_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL REFERENCES public.permit_ai_budgets(scope) ON DELETE RESTRICT,
  permit_id UUID REFERENCES public.permits(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('classify', 'enrich')),
  model TEXT NOT NULL,
  comment_count INTEGER NOT NULL CHECK (comment_count > 0),
  request_hash TEXT,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled', 'failed')),
  reserved_usd NUMERIC(12, 6) NOT NULL CHECK (reserved_usd > 0),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(12, 6),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_permit_ai_cost_ledger_scope ON public.permit_ai_cost_ledger (scope);
CREATE INDEX IF NOT EXISTS idx_permit_ai_cost_ledger_permit ON public.permit_ai_cost_ledger (permit_id);
ALTER TABLE public.permit_ai_cost_ledger ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['permit_comment_insights', 'permit_comment_processing_state', 'permit_ai_budgets', 'permit_ai_cost_ledger'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END;
$$;
GRANT SELECT ON public.permit_comment_insights TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. parsed_comments: processing status and field provenance
-- ---------------------------------------------------------------------------

ALTER TABLE public.parsed_comments
  ADD COLUMN IF NOT EXISTS processing_status TEXT
    CHECK (processing_status IN ('pending', 'processed', 'failed', 'needs_attention')),
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discipline_source TEXT CHECK (discipline_source IN ('central', 'project_ai', 'human')),
  ADD COLUMN IF NOT EXISTS code_reference_source TEXT CHECK (code_reference_source IN ('central', 'project_ai', 'human')),
  ADD COLUMN IF NOT EXISTS response_text_source TEXT CHECK (response_text_source IN ('central', 'project_ai', 'human')),
  ADD COLUMN IF NOT EXISTS assigned_to_source TEXT CHECK (assigned_to_source IN ('central', 'project_ai', 'human')),
  ADD COLUMN IF NOT EXISTS central_insight_id UUID REFERENCES public.permit_comment_insights(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS central_update_at TIMESTAMPTZ;

COMMENT ON COLUMN public.parsed_comments.processing_status IS
  'Pipeline state of this row: pending (not yet classified and routed), processed, failed (will retry), needs_attention (set aside). NULL = row predates tracking.';
COMMENT ON COLUMN public.parsed_comments.discipline_source IS
  'Who wrote discipline: central (permit_comment_insights), project_ai (project agents), human. NULL = unknown, treated as human.';
COMMENT ON COLUMN public.parsed_comments.central_update_at IS
  'A newer central result differs from a value a person set; the value was kept.';

-- A signed-in user changing a tracked field makes it human-owned. Service-role writes (the pipeline) have no
-- auth.uid() and set the source themselves. Separate from the approval trigger; both are BEFORE triggers.
CREATE OR REPLACE FUNCTION public._parsed_comment_track_field_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.discipline IS DISTINCT FROM OLD.discipline THEN
    NEW.discipline_source := 'human';
  END IF;
  IF NEW.code_reference IS DISTINCT FROM OLD.code_reference THEN
    NEW.code_reference_source := 'human';
  END IF;
  IF NEW.response_text IS DISTINCT FROM OLD.response_text THEN
    NEW.response_text_source := 'human';
  END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    NEW.assigned_to_source := 'human';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_parsed_comments_field_source ON public.parsed_comments;
CREATE TRIGGER trg_parsed_comments_field_source
  BEFORE UPDATE ON public.parsed_comments
  FOR EACH ROW EXECUTE FUNCTION public._parsed_comment_track_field_source();

-- ---------------------------------------------------------------------------
-- 5. Inputs, fingerprint and per-comment status
-- ---------------------------------------------------------------------------

-- sha256 over exactly what central processing sends to the model: whitespace-normalised body, department, comment
-- type and jurisdiction. Status, cycle and file name are not inputs, so a status flip never re-runs AI.
CREATE OR REPLACE FUNCTION public._permit_comment_input_hash(p_body TEXT, p_department TEXT, p_comment_type TEXT, p_jurisdiction TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT encode(sha256(convert_to(concat_ws(chr(31),
    regexp_replace(btrim(coalesce(p_body, '')), '\s+', ' ', 'g'),
    lower(regexp_replace(btrim(coalesce(p_department, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(coalesce(p_comment_type, '')), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(coalesce(p_jurisdiction, '')), '\s+', ' ', 'g'))), 'UTF8')), 'hex')
$$;

-- Active comments of the permits with their input hash.
CREATE OR REPLACE FUNCTION public._permit_central_comments(p_permit_ids UUID[])
RETURNS TABLE (
  permit_id UUID,
  comment_id UUID,
  portal_comment_key TEXT,
  input_hash TEXT,
  has_body BOOLEAN,
  body TEXT,
  department TEXT,
  comment_type TEXT,
  jurisdiction TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.permit_id, c.id, c.portal_comment_key,
    public._permit_comment_input_hash(c.body, c.department, c.comment_type, p.jurisdiction),
    btrim(coalesce(c.body, '')) <> '', c.body, c.department, c.comment_type, p.jurisdiction
  FROM public.permit_review_comments c
  JOIN public.permits p ON p.id = c.permit_id
  WHERE c.permit_id = ANY (p_permit_ids) AND c.removed_at IS NULL
$$;

-- Per active comment: processed | pending | failed | needs_attention | skipped (empty body). Exactly one each, so
-- the counts always add up to the number of source comments (reconciliation).
CREATE OR REPLACE FUNCTION public._permit_central_comment_status(p_permit_ids UUID[], p_version TEXT)
RETURNS TABLE (permit_id UUID, comment_id UUID, input_hash TEXT, status TEXT, insight_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cc.permit_id, cc.comment_id, cc.input_hash,
    CASE
      WHEN NOT cc.has_body THEN 'skipped'
      WHEN i.status = 'ready' THEN 'processed'
      WHEN i.status = 'needs_attention' THEN 'needs_attention'
      WHEN i.status = 'failed' THEN 'failed'
      ELSE 'pending'
    END,
    CASE WHEN i.status = 'ready' THEN i.id END
  FROM public._permit_central_comments(p_permit_ids) cc
  LEFT JOIN public.permit_comment_insights i
    ON i.comment_id = cc.comment_id AND i.input_hash = cc.input_hash AND i.processing_version = p_version
$$;

CREATE OR REPLACE FUNCTION public.permit_central_summary(p_permit_ids UUID[], p_version TEXT)
RETURNS TABLE (
  permit_id UUID,
  source_comments INTEGER,
  processed INTEGER,
  pending INTEGER,
  failed INTEGER,
  needs_attention INTEGER,
  skipped INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.permit_id,
    count(*)::int,
    count(*) FILTER (WHERE s.status = 'processed')::int,
    count(*) FILTER (WHERE s.status = 'pending')::int,
    count(*) FILTER (WHERE s.status = 'failed')::int,
    count(*) FILTER (WHERE s.status = 'needs_attention')::int,
    count(*) FILTER (WHERE s.status = 'skipped')::int
  FROM public._permit_central_comment_status(p_permit_ids, p_version) s
  GROUP BY s.permit_id
$$;

CREATE OR REPLACE FUNCTION public._permit_central_fingerprint(p_permit_id UUID, p_version TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN count(*) FILTER (WHERE cc.has_body) = 0 THEN NULL ELSE
    md5(p_version || '|' || string_agg(cc.comment_id::text || ':' || cc.input_hash, ',' ORDER BY cc.comment_id) FILTER (WHERE cc.has_body))
  END
  FROM public._permit_central_comments(ARRAY[p_permit_id]) cc
$$;

-- ---------------------------------------------------------------------------
-- 6. Claim / finish (service role; permit-comment-pipeline central_sweep and central_backfill)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.permit_central_claim(
  p_worker TEXT,
  p_version TEXT,
  p_limit INTEGER DEFAULT 2,
  p_lease_seconds INTEGER DEFAULT 300,
  p_permit_ids UUID[] DEFAULT NULL,
  p_adapter_key TEXT DEFAULT NULL
)
RETURNS TABLE (permit_id UUID, fingerprint TEXT, attempts INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r RECORD;
  v_fp TEXT;
  v_state public.permit_comment_processing_state;
  v_claimed INTEGER := 0;
BEGIN
  IF p_worker IS NULL OR btrim(p_worker) = '' OR p_version IS NULL OR btrim(p_version) = '' THEN
    RAISE EXCEPTION 'worker id and processing version required' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    SELECT p.id AS pid, s.next_attempt_at
    FROM public.permits p
    LEFT JOIN public.permit_comment_processing_state s ON s.permit_id = p.id
    WHERE (p_permit_ids IS NULL OR p.id = ANY (p_permit_ids))
      AND (p_adapter_key IS NULL OR p.adapter_key = p_adapter_key)
      AND EXISTS (SELECT 1 FROM public.permit_review_comments c WHERE c.permit_id = p.id AND c.removed_at IS NULL)
    ORDER BY s.next_attempt_at NULLS FIRST, p.id
  LOOP
    EXIT WHEN v_claimed >= greatest(coalesce(p_limit, 2), 1);
    v_fp := public._permit_central_fingerprint(r.pid, p_version);
    CONTINUE WHEN v_fp IS NULL;

    INSERT INTO public.permit_comment_processing_state AS s (permit_id)
    VALUES (r.pid)
    ON CONFLICT ON CONSTRAINT permit_comment_processing_state_pkey DO NOTHING;
    SELECT * INTO v_state FROM public.permit_comment_processing_state s
    WHERE s.permit_id = r.pid FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;

    CONTINUE WHEN v_state.completed_fingerprint IS NOT DISTINCT FROM v_fp AND NOT v_state.force_requested;
    CONTINUE WHEN v_state.lease_expires_at IS NOT NULL AND v_state.lease_expires_at > now();

    IF v_state.requested_fingerprint IS DISTINCT FROM v_fp THEN
      v_state.attempts := 0;
      v_state.continuations := 0;
      IF v_state.status <> 'paused' THEN
        v_state.next_attempt_at := now();
      END IF;
      IF v_state.status = 'blocked' THEN
        v_state.status := 'due';
      END IF;
    END IF;
    IF v_state.status = 'running' AND v_state.attempts >= 5 THEN
      UPDATE public.permit_comment_processing_state s SET
        status = 'blocked', lease_owner = NULL, lease_expires_at = NULL,
        last_error = 'processing was interrupted repeatedly', updated_at = now()
      WHERE s.permit_id = r.pid;
      CONTINUE;
    END IF;
    CONTINUE WHEN v_state.status = 'blocked';
    CONTINUE WHEN v_state.next_attempt_at > now();

    UPDATE public.permit_comment_processing_state s SET
      status = 'running',
      processing_version = p_version,
      requested_fingerprint = v_fp,
      attempts = v_state.attempts + 1,
      continuations = v_state.continuations,
      next_attempt_at = v_state.next_attempt_at,
      lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30)),
      last_started_at = now(),
      updated_at = now()
    WHERE s.permit_id = r.pid;

    permit_id := r.pid;
    fingerprint := v_fp;
    attempts := v_state.attempts + 1;
    v_claimed := v_claimed + 1;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- p_outcome: completed | released (time used up, more work; resumes at once) | paused (budget refused; 1 h) | failed (backs off).
-- "completed" is accepted only when no comment is pending or failed; otherwise it is recorded as a failure.
CREATE OR REPLACE FUNCTION public.permit_central_finish(
  p_permit_id UUID,
  p_worker TEXT,
  p_fingerprint TEXT,
  p_version TEXT,
  p_outcome TEXT,
  p_error TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.permit_comment_processing_state;
  v_sum RECORD;
  v_outcome TEXT := p_outcome;
  v_error TEXT := p_error;
  v_status TEXT;
BEGIN
  IF p_outcome NOT IN ('completed', 'released', 'paused', 'failed') THEN
    RAISE EXCEPTION 'invalid outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_state FROM public.permit_comment_processing_state WHERE permit_id = p_permit_id FOR UPDATE;
  IF NOT FOUND OR v_state.lease_owner IS DISTINCT FROM p_worker THEN
    RETURN 'lease_lost';
  END IF;

  IF v_outcome = 'completed' THEN
    SELECT * INTO v_sum FROM public.permit_central_summary(ARRAY[p_permit_id], p_version);
    IF coalesce(v_sum.pending, 0) + coalesce(v_sum.failed, 0) > 0 THEN
      v_outcome := 'failed';
      v_error := format('incomplete: %s pending, %s failed of %s comments', v_sum.pending, v_sum.failed, v_sum.source_comments);
    END IF;
  END IF;

  IF v_outcome = 'completed' THEN
    UPDATE public.permit_comment_processing_state SET
      status = 'completed', completed_fingerprint = p_fingerprint, processing_version = p_version,
      force_requested = false, attempts = 0, continuations = 0, lease_owner = NULL, lease_expires_at = NULL,
      last_error = NULL, last_completed_at = now(), updated_at = now()
    WHERE permit_id = p_permit_id;
    RETURN 'completed';
  END IF;

  IF v_outcome = 'released' AND v_state.continuations < 30 THEN
    UPDATE public.permit_comment_processing_state SET
      status = 'due', attempts = greatest(attempts - 1, 0), continuations = continuations + 1,
      next_attempt_at = now(), lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE permit_id = p_permit_id;
    RETURN 'due';
  END IF;

  IF v_outcome = 'paused' THEN
    UPDATE public.permit_comment_processing_state SET
      status = 'paused', attempts = greatest(attempts - 1, 0), next_attempt_at = now() + interval '1 hour',
      lease_owner = NULL, lease_expires_at = NULL, last_error = left(coalesce(v_error, 'budget'), 500), updated_at = now()
    WHERE permit_id = p_permit_id;
    RETURN 'paused';
  END IF;

  v_status := CASE WHEN v_state.attempts >= 5 THEN 'blocked' ELSE 'failed' END;
  UPDATE public.permit_comment_processing_state SET
    status = v_status,
    next_attempt_at = now() + least(interval '5 minutes' * power(4, greatest(v_state.attempts - 1, 0)), interval '6 hours'),
    lease_owner = NULL, lease_expires_at = NULL,
    last_error = left(coalesce(v_error, CASE WHEN v_outcome = 'released' THEN 'did not finish' ELSE 'failed' END), 500),
    updated_at = now()
  WHERE permit_id = p_permit_id;
  RETURN v_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Work selection and result recording (service role; called by the central agent modes)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._permit_central_publish(p_insight_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comment UUID;
BEGIN
  SELECT comment_id INTO v_comment FROM public.permit_comment_insights WHERE id = p_insight_id;
  UPDATE public.permit_comment_insights SET is_current = false, superseded_at = now(), updated_at = now()
  WHERE comment_id = v_comment AND is_current AND id <> p_insight_id;
  UPDATE public.permit_comment_insights SET is_current = true, superseded_at = NULL, updated_at = now()
  WHERE id = p_insight_id AND NOT is_current;
END;
$$;

-- Comments whose exact input already has a ready result (a duplicate body on this or another permit) get a copy,
-- with no AI call. Returns the number copied.
CREATE OR REPLACE FUNCTION public._permit_central_copy_ready(p_permit_id UUID, p_version TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_id UUID;
  v_n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT cc.permit_id, cc.comment_id, cc.input_hash, src.*
    FROM public._permit_central_comments(ARRAY[p_permit_id]) cc
    LEFT JOIN public.permit_comment_insights own
      ON own.comment_id = cc.comment_id AND own.input_hash = cc.input_hash AND own.processing_version = p_version
    CROSS JOIN LATERAL (
      SELECT s.id AS src_id, s.discipline AS src_discipline, s.discipline_confidence AS src_confidence,
        s.code_reference AS src_code_reference, s.code_references AS src_code_references, s.code_basis AS src_code_basis,
        s.guidance_text AS src_guidance, s.limitations AS src_limitations, s.model AS src_model,
        s.classifier_prompt_version AS src_cpv, s.enrichment_prompt_version AS src_epv
      FROM public.permit_comment_insights s
      WHERE s.input_hash = cc.input_hash AND s.processing_version = p_version AND s.status = 'ready'
        AND s.comment_id <> cc.comment_id
      ORDER BY s.created_at, s.id
      LIMIT 1
    ) src
    WHERE cc.has_body AND (own.id IS NULL OR own.status <> 'ready')
  LOOP
    INSERT INTO public.permit_comment_insights AS i (
      permit_id, comment_id, input_hash, processing_version, status, discipline, discipline_confidence,
      code_reference, code_references, code_basis, guidance_text, limitations, model,
      classifier_prompt_version, enrichment_prompt_version, copied_from_insight_id, classified_at, enriched_at
    ) VALUES (
      r.permit_id, r.comment_id, r.input_hash, p_version, 'ready', r.src_discipline, r.src_confidence,
      r.src_code_reference, r.src_code_references, r.src_code_basis, r.src_guidance, r.src_limitations, r.src_model,
      r.src_cpv, r.src_epv, r.src_id, now(), now()
    )
    ON CONFLICT ON CONSTRAINT permit_comment_insights_key DO UPDATE SET
      status = 'ready', discipline = EXCLUDED.discipline, discipline_confidence = EXCLUDED.discipline_confidence,
      code_reference = EXCLUDED.code_reference, code_references = EXCLUDED.code_references, code_basis = EXCLUDED.code_basis,
      guidance_text = EXCLUDED.guidance_text, limitations = EXCLUDED.limitations, model = EXCLUDED.model,
      classifier_prompt_version = EXCLUDED.classifier_prompt_version, enrichment_prompt_version = EXCLUDED.enrichment_prompt_version,
      copied_from_insight_id = EXCLUDED.copied_from_insight_id, last_error = NULL,
      classified_at = now(), enriched_at = now(), updated_at = now()
    RETURNING i.id INTO v_id;
    PERFORM public._permit_central_publish(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Next comments that need the stage, at most p_limit. classify: no result for (comment, input hash, version) yet,
-- or a failed classification below the attempt limit; one comment per identical input (the others are copied).
-- enrich: classified, not yet enriched, below the attempt limit.
CREATE OR REPLACE FUNCTION public.permit_central_work(p_permit_id UUID, p_version TEXT, p_stage TEXT, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  comment_id UUID,
  input_hash TEXT,
  body TEXT,
  department TEXT,
  comment_type TEXT,
  jurisdiction TEXT,
  insight_id UUID,
  discipline TEXT,
  discipline_confidence NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF p_stage NOT IN ('classify', 'enrich') THEN
    RAISE EXCEPTION 'invalid stage' USING ERRCODE = '22023';
  END IF;
  IF p_version IS NULL OR btrim(p_version) = '' THEN
    RAISE EXCEPTION 'processing version required' USING ERRCODE = '22023';
  END IF;
  PERFORM public._permit_central_copy_ready(p_permit_id, p_version);

  IF p_stage = 'classify' THEN
    RETURN QUERY
    WITH keyed AS (
      SELECT cc.*, i.id AS iid, i.status AS istatus, i.discipline AS idisc
      FROM public._permit_central_comments(ARRAY[p_permit_id]) cc
      LEFT JOIN public.permit_comment_insights i
        ON i.comment_id = cc.comment_id AND i.input_hash = cc.input_hash AND i.processing_version = p_version
      WHERE cc.has_body
    ),
    taken AS (SELECT DISTINCT k.input_hash FROM keyed k WHERE k.istatus IN ('pending', 'ready'))
    SELECT * FROM (
      SELECT DISTINCT ON (k.input_hash)
        k.comment_id, k.input_hash, k.body, k.department, k.comment_type, k.jurisdiction, k.iid,
        NULL::text AS no_discipline, NULL::numeric AS no_confidence
      FROM keyed k
      WHERE (k.iid IS NULL OR (k.istatus = 'failed' AND k.idisc IS NULL))
        AND k.input_hash NOT IN (SELECT t.input_hash FROM taken t)
      ORDER BY k.input_hash, k.comment_id
    ) x
    ORDER BY x.comment_id
    LIMIT greatest(least(coalesce(p_limit, 20), 100), 1);
  ELSE
    RETURN QUERY
    SELECT cc.comment_id, cc.input_hash, cc.body, cc.department, cc.comment_type, cc.jurisdiction,
      i.id, i.discipline, i.discipline_confidence
    FROM public._permit_central_comments(ARRAY[p_permit_id]) cc
    JOIN public.permit_comment_insights i
      ON i.comment_id = cc.comment_id AND i.input_hash = cc.input_hash AND i.processing_version = p_version
    WHERE cc.has_body AND i.discipline IS NOT NULL AND i.enriched_at IS NULL AND i.status IN ('pending', 'failed')
    ORDER BY cc.comment_id
    LIMIT greatest(least(coalesce(p_limit, 20), 100), 1);
  END IF;
END;
$$;

-- Records one batch. A comment the model skipped counts an attempt; after 3 it is set aside (needs_attention)
-- instead of being retried forever. Results for comments of another permit are rejected.
CREATE OR REPLACE FUNCTION public.permit_central_record(
  p_permit_id UUID,
  p_version TEXT,
  p_stage TEXT,
  p_model TEXT,
  p_prompt_version TEXT,
  p_results JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r JSONB;
  v_comment UUID;
  v_hash TEXT;
  v_id UUID;
  v_processed INTEGER := 0;
  v_failed INTEGER := 0;
  v_rejected INTEGER := 0;
  v_max CONSTANT INTEGER := 3;
BEGIN
  IF p_stage NOT IN ('classify', 'enrich') THEN
    RAISE EXCEPTION 'invalid stage' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'results must be an array' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_results) LOOP
    v_comment := nullif(r->>'comment_id', '')::uuid;
    v_hash := r->>'input_hash';
    IF v_comment IS NULL OR v_hash IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.permit_review_comments c WHERE c.id = v_comment AND c.permit_id = p_permit_id) THEN
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    IF p_stage = 'classify' THEN
      IF (r->>'ok')::boolean THEN
        INSERT INTO public.permit_comment_insights AS i (
          permit_id, comment_id, input_hash, processing_version, status, discipline, discipline_confidence,
          model, classifier_prompt_version, classified_at
        ) VALUES (
          p_permit_id, v_comment, v_hash, p_version, 'pending', r->>'discipline',
          least(greatest(coalesce((r->>'confidence')::numeric, 0.5), 0), 1), p_model, p_prompt_version, now()
        )
        ON CONFLICT ON CONSTRAINT permit_comment_insights_key DO UPDATE SET
          status = 'pending', discipline = EXCLUDED.discipline, discipline_confidence = EXCLUDED.discipline_confidence,
          model = EXCLUDED.model, classifier_prompt_version = EXCLUDED.classifier_prompt_version,
          classified_at = now(), last_error = NULL, updated_at = now()
        WHERE i.status IN ('pending', 'failed');
        v_processed := v_processed + 1;
      ELSE
        INSERT INTO public.permit_comment_insights AS i (
          permit_id, comment_id, input_hash, processing_version, status, attempts, last_error, model, classifier_prompt_version
        ) VALUES (
          p_permit_id, v_comment, v_hash, p_version, 'failed', 1, left(coalesce(r->>'error', 'failed'), 300), p_model, p_prompt_version
        )
        ON CONFLICT ON CONSTRAINT permit_comment_insights_key DO UPDATE SET
          attempts = i.attempts + 1,
          status = CASE WHEN i.attempts + 1 >= v_max THEN 'needs_attention' ELSE 'failed' END,
          last_error = EXCLUDED.last_error, updated_at = now()
        WHERE i.status IN ('pending', 'failed');
        v_failed := v_failed + 1;
      END IF;
    ELSE
      SELECT i.id INTO v_id FROM public.permit_comment_insights i
      WHERE i.comment_id = v_comment AND i.input_hash = v_hash AND i.processing_version = p_version
        AND i.status IN ('pending', 'failed') AND i.discipline IS NOT NULL;
      IF v_id IS NULL THEN
        v_rejected := v_rejected + 1;
        CONTINUE;
      END IF;
      IF (r->>'ok')::boolean THEN
        UPDATE public.permit_comment_insights SET
          status = 'ready',
          code_reference = nullif(r->>'code_reference', ''),
          code_references = coalesce(r->'code_references', '[]'::jsonb),
          code_basis = coalesce(r->>'code_basis', 'none'),
          guidance_text = nullif(r->>'guidance_text', ''),
          limitations = ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'limitations', '[]'::jsonb))),
          model = p_model,
          enrichment_prompt_version = p_prompt_version,
          enriched_at = now(),
          last_error = NULL,
          updated_at = now()
        WHERE id = v_id;
        PERFORM public._permit_central_publish(v_id);
        v_processed := v_processed + 1;
      ELSE
        UPDATE public.permit_comment_insights SET
          attempts = attempts + 1,
          status = CASE WHEN attempts + 1 >= v_max THEN 'needs_attention' ELSE 'failed' END,
          last_error = left(coalesce(r->>'error', 'failed'), 300),
          updated_at = now()
        WHERE id = v_id;
        v_failed := v_failed + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('processed', v_processed, 'failed', v_failed, 'rejected', v_rejected);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Budget: reserve before a call, settle after it
-- ---------------------------------------------------------------------------

-- Committed spend of a scope: settled calls at their real cost; in-flight and failed calls at their reservation
-- (a failed call may still have been billed). Never under-counts.
CREATE OR REPLACE FUNCTION public._permit_ai_budget_used(p_scope TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(CASE WHEN l.status = 'settled' THEN coalesce(l.cost_usd, l.reserved_usd)
                           ELSE greatest(l.reserved_usd, coalesce(l.cost_usd, 0)) END), 0)
  FROM public.permit_ai_cost_ledger l WHERE l.scope = p_scope
$$;

CREATE OR REPLACE FUNCTION public.permit_ai_budget_reserve(
  p_scope TEXT,
  p_stage TEXT,
  p_permit_id UUID,
  p_model TEXT,
  p_comment_count INTEGER,
  p_reserve_usd NUMERIC,
  p_request_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget public.permit_ai_budgets;
  v_used NUMERIC;
  v_id UUID;
BEGIN
  IF p_reserve_usd IS NULL OR p_reserve_usd <= 0 THEN
    RAISE EXCEPTION 'a positive reservation is required' USING ERRCODE = '22023';
  END IF;
  -- Row lock: concurrent reservations on one scope are serialised, so two calls cannot both fit the last dollars.
  SELECT * INTO v_budget FROM public.permit_ai_budgets WHERE scope = p_scope FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'budget_not_found');
  END IF;
  IF v_budget.approved_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'budget_not_approved');
  END IF;
  IF v_budget.closed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'budget_closed');
  END IF;
  v_used := public._permit_ai_budget_used(p_scope);
  IF v_used + p_reserve_usd > v_budget.cap_usd THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'budget_exhausted', 'used_usd', v_used, 'cap_usd', v_budget.cap_usd);
  END IF;
  INSERT INTO public.permit_ai_cost_ledger (scope, permit_id, stage, model, comment_count, request_hash, reserved_usd)
  VALUES (p_scope, p_permit_id, p_stage, p_model, p_comment_count, p_request_hash, p_reserve_usd)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'ledger_id', v_id, 'used_usd', v_used, 'cap_usd', v_budget.cap_usd);
END;
$$;

CREATE OR REPLACE FUNCTION public.permit_ai_budget_settle(
  p_ledger_id UUID,
  p_status TEXT,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_cost_usd NUMERIC,
  p_error TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('settled', 'failed') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.permit_ai_cost_ledger SET
    status = p_status,
    input_tokens = p_input_tokens,
    output_tokens = p_output_tokens,
    cost_usd = coalesce(p_cost_usd, reserved_usd),
    error = left(p_error, 300),
    settled_at = now()
  WHERE id = p_ledger_id AND status = 'reserved';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.permit_ai_budget_status(p_scope TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN b.scope IS NULL THEN NULL ELSE jsonb_build_object(
    'scope', b.scope, 'cap_usd', b.cap_usd, 'approved', b.approved_at IS NOT NULL, 'closed', b.closed_at IS NOT NULL,
    'used_usd', public._permit_ai_budget_used(b.scope),
    'calls', (SELECT count(*) FROM public.permit_ai_cost_ledger l WHERE l.scope = b.scope),
    'input_tokens', (SELECT coalesce(sum(l.input_tokens), 0) FROM public.permit_ai_cost_ledger l WHERE l.scope = b.scope),
    'output_tokens', (SELECT coalesce(sum(l.output_tokens), 0) FROM public.permit_ai_cost_ledger l WHERE l.scope = b.scope)
  ) END
  FROM (SELECT p_scope AS s) x LEFT JOIN public.permit_ai_budgets b ON b.scope = x.s
$$;

-- Dry-run inventory for a backfill: what would be sent, without any AI call (D-124).
CREATE OR REPLACE FUNCTION public.permit_central_backfill_inventory(p_version TEXT, p_adapter_key TEXT DEFAULT NULL)
RETURNS TABLE (
  permit_id UUID,
  source_comments INTEGER,
  processed INTEGER,
  pending INTEGER,
  failed INTEGER,
  needs_attention INTEGER,
  skipped INTEGER,
  distinct_inputs_to_send INTEGER,
  body_chars_to_send BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT array_agg(p.id) AS a FROM public.permits p WHERE p_adapter_key IS NULL OR p.adapter_key = p_adapter_key
  ),
  st AS (SELECT s.* FROM ids, public._permit_central_comment_status(ids.a, p_version) s),
  cc AS (SELECT c.* FROM ids, public._permit_central_comments(ids.a) c)
  SELECT sm.permit_id, sm.source_comments, sm.processed, sm.pending, sm.failed, sm.needs_attention, sm.skipped,
    (SELECT count(DISTINCT st.input_hash)::int FROM st WHERE st.permit_id = sm.permit_id AND st.status IN ('pending', 'failed')),
    (SELECT coalesce(sum(length(cc.body)), 0) FROM cc JOIN st ON st.comment_id = cc.comment_id
      WHERE cc.permit_id = sm.permit_id AND st.status IN ('pending', 'failed'))
  FROM ids, public.permit_central_summary(ids.a, p_version) sm
  ORDER BY sm.source_comments DESC, sm.permit_id
$$;

-- Current ready central results whose input still matches the comment (stale results are never copied).
-- Read by comment-parser-agent's repository merge with the service role.
CREATE OR REPLACE FUNCTION public.permit_central_current_insights(p_permit_ids UUID[])
RETURNS TABLE (
  permit_id UUID,
  portal_comment_key TEXT,
  insight_id UUID,
  discipline TEXT,
  discipline_confidence NUMERIC,
  code_reference TEXT,
  code_basis TEXT,
  guidance_text TEXT,
  limitations TEXT[],
  processing_version TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cc.permit_id, cc.portal_comment_key, i.id, i.discipline, i.discipline_confidence, i.code_reference,
    i.code_basis, i.guidance_text, i.limitations, i.processing_version
  FROM public._permit_central_comments(p_permit_ids) cc
  JOIN public.permit_comment_insights i
    ON i.comment_id = cc.comment_id AND i.is_current AND i.status = 'ready' AND i.input_hash = cc.input_hash
$$;

-- ---------------------------------------------------------------------------
-- 9. Project fingerprint also covers current central results (unchanged while none exist)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._project_permit_comment_fingerprint(p_project_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_permits UUID[];
  v_insights TEXT;
BEGIN
  SELECT user_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(pp.permit_id ORDER BY pp.permit_id) INTO v_permits
  FROM public.project_permits pp
  WHERE pp.project_id = p_project_id
    AND public.user_can_read_permit(v_owner, pp.permit_id);
  IF v_permits IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT string_agg(i.id::text, ',' ORDER BY i.id) INTO v_insights
  FROM public.permit_comment_insights i
  WHERE i.permit_id = ANY (v_permits) AND i.is_current AND i.status = 'ready';
  RETURN md5(
    array_to_string(v_permits, ',') || '|' ||
    coalesce((
      SELECT string_agg(
        c.permit_id::text || ':' || c.portal_comment_key || ':' ||
          md5(concat_ws(E'\x1f', c.body, c.status, c.cycle::text, c.comment_type, c.department, c.file_name, c.ref_number::text)),
        ',' ORDER BY c.permit_id, c.portal_comment_key)
      FROM public.permit_review_comments c
      WHERE c.permit_id = ANY (v_permits) AND c.removed_at IS NULL
    ), '') ||
    CASE WHEN v_insights IS NULL THEN '' ELSE '|central:' || v_insights END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Read models (Permit Queue; Management Admin diagnostics)
-- ---------------------------------------------------------------------------

-- Per readable permit: processing_state not_processed | processing | ready | needs_attention | no_comments, with
-- counts that add up (source = processed + pending + failed + needs_attention + skipped). No diagnostics here.
CREATE OR REPLACE FUNCTION public.get_permit_comment_processing(p_permit_ids UUID[])
RETURNS TABLE (
  permit_id UUID,
  processing_state TEXT,
  source_comments INTEGER,
  processed INTEGER,
  pending INTEGER,
  failed INTEGER,
  needs_attention INTEGER,
  skipped INTEGER,
  last_completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_permit_ids IS NULL OR cardinality(p_permit_ids) > 200 THEN
    RAISE EXCEPTION 'between 1 and 200 permit ids' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT p.id,
    CASE
      WHEN coalesce(sm.source_comments, 0) - coalesce(sm.skipped, 0) = 0 THEN 'no_comments'
      WHEN s.status = 'running' AND s.lease_expires_at > now() THEN 'processing'
      WHEN s.status = 'blocked' OR coalesce(sm.needs_attention, 0) > 0 THEN 'needs_attention'
      WHEN s.processing_version IS NOT NULL AND sm.pending = 0 AND sm.failed = 0 THEN 'ready'
      WHEN s.status IN ('failed', 'due') AND s.attempts > 0 THEN 'processing'
      ELSE 'not_processed'
    END,
    coalesce(sm.source_comments, 0), coalesce(sm.processed, 0), coalesce(sm.pending, 0), coalesce(sm.failed, 0),
    coalesce(sm.needs_attention, 0), coalesce(sm.skipped, 0), s.last_completed_at
  FROM public.permits p
  LEFT JOIN public.permit_comment_processing_state s ON s.permit_id = p.id
  LEFT JOIN LATERAL (
    SELECT * FROM public.permit_central_summary(ARRAY[p.id], coalesce(s.processing_version, ''))
  ) sm ON true
  WHERE p.id = ANY (p_permit_ids) AND public.user_can_read_permit(v_uid, p.id)
  ORDER BY p.id;
END;
$$;

-- Platform admins: versions, fingerprints, failures and cost per permit.
CREATE OR REPLACE FUNCTION public.admin_get_central_processing_diagnostics(p_permit_ids UUID[] DEFAULT NULL)
RETURNS TABLE (
  permit_id UUID,
  permit_number TEXT,
  status TEXT,
  processing_version TEXT,
  completed_fingerprint TEXT,
  current_fingerprint TEXT,
  attempts INTEGER,
  next_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  last_completed_at TIMESTAMPTZ,
  source_comments INTEGER,
  processed INTEGER,
  pending INTEGER,
  failed INTEGER,
  needs_attention INTEGER,
  skipped INTEGER,
  ai_calls INTEGER,
  input_tokens BIGINT,
  output_tokens BIGINT,
  cost_usd NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.permit_number, s.status, s.processing_version, s.completed_fingerprint,
    CASE WHEN s.processing_version IS NULL THEN NULL ELSE public._permit_central_fingerprint(p.id, s.processing_version) END,
    s.attempts, s.next_attempt_at, s.last_error, s.last_completed_at,
    coalesce(sm.source_comments, 0), coalesce(sm.processed, 0), coalesce(sm.pending, 0), coalesce(sm.failed, 0),
    coalesce(sm.needs_attention, 0), coalesce(sm.skipped, 0),
    coalesce(l.calls, 0)::int, coalesce(l.input_tokens, 0)::bigint, coalesce(l.output_tokens, 0)::bigint, coalesce(l.cost, 0)
  FROM public.permits p
  LEFT JOIN public.permit_comment_processing_state s ON s.permit_id = p.id
  LEFT JOIN LATERAL (SELECT * FROM public.permit_central_summary(ARRAY[p.id], coalesce(s.processing_version, ''))) sm ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS calls, sum(x.input_tokens) AS input_tokens, sum(x.output_tokens) AS output_tokens,
      sum(coalesce(x.cost_usd, x.reserved_usd)) AS cost
    FROM public.permit_ai_cost_ledger x WHERE x.permit_id = p.id
  ) l ON true
  WHERE (p_permit_ids IS NULL OR p.id = ANY (p_permit_ids))
    AND EXISTS (SELECT 1 FROM public.permit_review_comments c WHERE c.permit_id = p.id AND c.removed_at IS NULL)
  ORDER BY p.permit_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_permit_ai_budgets()
RETURNS SETOF JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT public.permit_ai_budget_status(b.scope) FROM public.permit_ai_budgets b ORDER BY b.created_at;
END;
$$;

-- Platform admins: process a permit again (also gives set-aside comments a fresh set of attempts). Audited.
CREATE OR REPLACE FUNCTION public.admin_retry_permit_comment_processing(p_permit_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reset INTEGER;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permits WHERE id = p_permit_id) THEN
    RAISE EXCEPTION 'permit not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.permit_comment_insights SET status = 'failed', attempts = 0, updated_at = now()
  WHERE permit_id = p_permit_id AND status = 'needs_attention';
  GET DIAGNOSTICS v_reset = ROW_COUNT;
  INSERT INTO public.permit_comment_processing_state AS s (permit_id, force_requested)
  VALUES (p_permit_id, true)
  ON CONFLICT ON CONSTRAINT permit_comment_processing_state_pkey DO UPDATE SET
    force_requested = true,
    status = CASE WHEN s.status = 'running' AND s.lease_expires_at > now() THEN s.status ELSE 'due' END,
    attempts = 0, continuations = 0, next_attempt_at = now(), updated_at = now();
  PERFORM public._permit_audit('permit.retry_comment_processing', 'permit', p_permit_id::text, NULL,
    jsonb_build_object('reset_comments', v_reset));
  RETURN 'due';
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._permit_comment_input_hash(text, text, text, text)',
    'public._permit_central_comments(uuid[])',
    'public._permit_central_comment_status(uuid[], text)',
    'public.permit_central_summary(uuid[], text)',
    'public._permit_central_fingerprint(uuid, text)',
    'public.permit_central_claim(text, text, integer, integer, uuid[], text)',
    'public.permit_central_finish(uuid, text, text, text, text, text)',
    'public._permit_central_publish(uuid)',
    'public._permit_central_copy_ready(uuid, text)',
    'public.permit_central_work(uuid, text, text, integer)',
    'public.permit_central_record(uuid, text, text, text, text, jsonb)',
    'public._permit_ai_budget_used(text)',
    'public.permit_ai_budget_reserve(text, text, uuid, text, integer, numeric, text)',
    'public.permit_ai_budget_settle(uuid, text, integer, integer, numeric, text)',
    'public.permit_ai_budget_status(text)',
    'public.permit_central_backfill_inventory(text, text)',
    'public.permit_central_current_insights(uuid[])',
    'public.get_permit_comment_processing(uuid[])',
    'public.admin_get_central_processing_diagnostics(uuid[])',
    'public.admin_list_permit_ai_budgets()',
    'public.admin_retry_permit_comment_processing(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_permit_comment_processing(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_central_processing_diagnostics(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_permit_ai_budgets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retry_permit_comment_processing(uuid) TO authenticated;
