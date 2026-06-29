-- Arlington idempotent enqueue + duplicate active-job protection.
-- Order: columns → backfill → resolve duplicate actives → unique index → RPCs.
-- Does not delete rows, portal_data, or storage files.

-- 1. Identity / cancellation columns
ALTER TABLE public.scrape_jobs
  ADD COLUMN IF NOT EXISTS normalized_permit_number TEXT,
  ADD COLUMN IF NOT EXISTS normalized_scope_key TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS canonical_job_id UUID REFERENCES public.scrape_jobs(id) ON DELETE SET NULL;

-- 2. Backfill normalized Arlington permit + scope identity
UPDATE public.scrape_jobs
SET
  normalized_permit_number = upper(trim(permit_number)),
  normalized_scope_key = COALESCE(
    NULLIF(normalized_scope_key, ''),
    CASE
      WHEN requested_scope IS NULL OR requested_scope = '{}'::jsonb THEN 'tabs=attachments,info,plan_review|pr=all|att=1|dl=1|docs=1'
      ELSE (
        'tabs=' || (
          SELECT string_agg(t, ',' ORDER BY t)
          FROM jsonb_array_elements_text(
            COALESCE(requested_scope->'tabs', '["info","attachments","plan_review"]'::jsonb)
          ) AS t
        )
        || '|pr=' || COALESCE(NULLIF(requested_scope->>'planReviewScope', ''), 'all')
        || '|att=' || CASE WHEN COALESCE((requested_scope->>'autoContinueAttachments')::boolean, true) THEN '1' ELSE '0' END
        || '|dl=' || CASE WHEN COALESCE((requested_scope->>'autoContinueDownloads')::boolean, true) THEN '1' ELSE '0' END
        || '|docs=' || CASE WHEN COALESCE((requested_scope->>'downloadDocuments')::boolean, true) THEN '1' ELSE '0' END
      )
    END
  )
WHERE jurisdiction ILIKE '%arlington%'
  AND permit_number IS NOT NULL;

-- Terminal + active status constraint (partial_external_blocker is terminal, not active)
ALTER TABLE public.scrape_jobs
  DROP CONSTRAINT IF EXISTS scrape_jobs_status_check;

ALTER TABLE public.scrape_jobs
  ADD CONSTRAINT scrape_jobs_status_check CHECK (
    status IN (
      'queued',
      'running',
      'resuming',
      'rate_limited',
      'partial',
      'waiting_user',
      'completed',
      'completed_with_warnings',
      'partial_external_blocker',
      'failed',
      'failed_unrecoverable',
      'cancelled'
    )
  );

-- 3–7. Cancel redundant active Arlington jobs per identity before unique index
WITH active_arlington AS (
  SELECT
    id,
    project_id,
    normalized_permit_number,
    normalized_scope_key,
    checkpoint_version,
    created_at,
    metadata
  FROM public.scrape_jobs
  WHERE jurisdiction ILIKE '%arlington%'
    AND completed_at IS NULL
    AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial', 'waiting_user')
    AND normalized_permit_number IS NOT NULL
    AND length(trim(normalized_permit_number)) > 0
    AND normalized_scope_key IS NOT NULL
    AND length(trim(normalized_scope_key)) > 0
),
dup_groups AS (
  SELECT
    project_id,
    normalized_permit_number,
    normalized_scope_key
  FROM active_arlington
  GROUP BY project_id, normalized_permit_number, normalized_scope_key
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT
    a.id,
    a.metadata,
    a.project_id,
    a.normalized_permit_number,
    a.normalized_scope_key,
    ROW_NUMBER() OVER (
      PARTITION BY a.project_id, a.normalized_permit_number, a.normalized_scope_key
      ORDER BY COALESCE(a.checkpoint_version, 0) DESC, a.created_at ASC
    ) AS rn,
    FIRST_VALUE(a.id) OVER (
      PARTITION BY a.project_id, a.normalized_permit_number, a.normalized_scope_key
      ORDER BY COALESCE(a.checkpoint_version, 0) DESC, a.created_at ASC
    ) AS canonical_id
  FROM active_arlington a
  INNER JOIN dup_groups d
    ON a.project_id = d.project_id
   AND a.normalized_permit_number = d.normalized_permit_number
   AND a.normalized_scope_key = d.normalized_scope_key
),
duplicates AS (
  SELECT id, canonical_id, metadata
  FROM ranked
  WHERE rn > 1
)
UPDATE public.scrape_jobs sj
SET
  status = 'cancelled',
  cancellation_reason = 'duplicate_active_job',
  canonical_job_id = d.canonical_id,
  lease_worker_id = NULL,
  lease_expires_at = NULL,
  lease_heartbeat_at = NULL,
  next_attempt_at = NULL,
  completed_at = COALESCE(sj.completed_at, now()),
  phase = 'complete',
  current_stage = 'cancelled',
  current_user_message = 'Cancelled: duplicate active Arlington scrape job.',
  metadata = jsonb_set(
    COALESCE(d.metadata, '{}'::jsonb),
    '{arlington}',
    COALESCE(d.metadata->'arlington', '{}'::jsonb) || jsonb_build_object(
      'terminalReason', 'duplicate_active_job',
      'canonicalJobId', d.canonical_id::text
    ),
    true
  ),
  updated_at = now()
FROM duplicates d
WHERE sj.id = d.id;

-- 8. Partial unique index (safe after duplicate cleanup)
DROP INDEX IF EXISTS public.idx_scrape_jobs_arlington_active_identity;

CREATE UNIQUE INDEX idx_scrape_jobs_arlington_active_identity
  ON public.scrape_jobs (project_id, normalized_permit_number, normalized_scope_key)
  WHERE jurisdiction ILIKE '%arlington%'
    AND completed_at IS NULL
    AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial', 'waiting_user');

-- 9a. Atomic idempotent enqueue
CREATE OR REPLACE FUNCTION public.enqueue_or_get_arlington_scrape_job(
  p_project_id UUID,
  p_user_id UUID,
  p_credential_id UUID,
  p_permit_number TEXT,
  p_normalized_permit_number TEXT,
  p_requested_scope JSONB,
  p_normalized_scope_key TEXT,
  p_scraper_session_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (job public.scrape_jobs, reused_existing BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.scrape_jobs;
  v_inserted public.scrape_jobs;
  v_scope JSONB := COALESCE(p_requested_scope, '{}'::jsonb);
  v_meta JSONB := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;
  IF p_normalized_permit_number IS NULL OR length(trim(p_normalized_permit_number)) = 0 THEN
    RAISE EXCEPTION 'normalized_permit_number required';
  END IF;
  IF p_normalized_scope_key IS NULL OR length(trim(p_normalized_scope_key)) = 0 THEN
    RAISE EXCEPTION 'normalized_scope_key required';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.scrape_jobs
  WHERE project_id = p_project_id
    AND jurisdiction ILIKE '%arlington%'
    AND normalized_permit_number = p_normalized_permit_number
    AND normalized_scope_key = p_normalized_scope_key
    AND completed_at IS NULL
    AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial', 'waiting_user')
  ORDER BY checkpoint_version DESC NULLS LAST, created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    job := v_existing;
    reused_existing := true;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.scrape_jobs (
      project_id,
      user_id,
      credential_id,
      scraper_session_id,
      jurisdiction,
      portal_type,
      permit_number,
      normalized_permit_number,
      requested_scope,
      normalized_scope_key,
      status,
      phase,
      attachments_state,
      project_info_state,
      plan_review_state,
      checkpoint_version,
      next_attempt_at,
      attempt_count,
      current_stage,
      current_user_message,
      metadata
    ) VALUES (
      p_project_id,
      p_user_id,
      p_credential_id,
      p_scraper_session_id,
      'Arlington County',
      'accela',
      trim(p_permit_number),
      p_normalized_permit_number,
      v_scope,
      p_normalized_scope_key,
      'queued',
      'record_info',
      'not_started',
      'not_started',
      'not_started',
      0,
      now(),
      0,
      'queued',
      'Arlington scrape queued for durable worker.',
      v_meta
    )
    RETURNING * INTO v_inserted;

    job := v_inserted;
    reused_existing := false;
    RETURN NEXT;
    RETURN;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_existing
      FROM public.scrape_jobs
      WHERE project_id = p_project_id
        AND jurisdiction ILIKE '%arlington%'
        AND normalized_permit_number = p_normalized_permit_number
        AND normalized_scope_key = p_normalized_scope_key
        AND completed_at IS NULL
        AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial', 'waiting_user')
      ORDER BY checkpoint_version DESC NULLS LAST, created_at ASC
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE;
      END IF;

      job := v_existing;
      reused_existing := true;
      RETURN NEXT;
      RETURN;
  END;
END;
$$;

-- 9b. Claim RPC — never reclaim terminal or cancelled jobs
CREATE OR REPLACE FUNCTION public.claim_arlington_scrape_job(
  p_worker_id TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 180
)
RETURNS public.scrape_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.scrape_jobs;
  v_ttl INTEGER;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id required';
  END IF;
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));

  SELECT *
  INTO v_job
  FROM public.scrape_jobs
  WHERE jurisdiction ILIKE '%arlington%'
    AND completed_at IS NULL
    AND status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial')
    AND status NOT IN (
      'completed',
      'completed_with_warnings',
      'partial_external_blocker',
      'failed',
      'failed_unrecoverable',
      'cancelled'
    )
    AND (next_attempt_at IS NULL OR next_attempt_at <= now())
    AND (lease_expires_at IS NULL OR lease_expires_at < now())
    AND (phase IS NULL OR phase IS DISTINCT FROM 'complete')
    AND COALESCE(metadata->'arlington'->>'terminalReason', '') NOT IN (
      'plan_review_metadata_only',
      'no_progress_guard',
      'duplicate_active_job'
    )
  ORDER BY next_attempt_at NULLS FIRST, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.scrape_jobs
  SET
    lease_worker_id = p_worker_id,
    lease_expires_at = now() + make_interval(secs => v_ttl),
    lease_heartbeat_at = now(),
    status = CASE
      WHEN status IN ('queued', 'rate_limited', 'partial') THEN 'running'
      ELSE status
    END,
    last_heartbeat_at = now(),
    last_activity_at = now(),
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_or_get_arlington_scrape_job(UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_or_get_arlington_scrape_job(UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) TO service_role;
