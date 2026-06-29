-- Allow due retry jobs in partial status to be claimed, and include partial in restart recovery.

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
  v_recovery_window INTERVAL := interval '30 minutes';
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id required';
  END IF;
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));

  SELECT *
  INTO v_job
  FROM public.scrape_jobs sj
  WHERE sj.jurisdiction ILIKE '%arlington%'
    AND sj.completed_at IS NULL
    AND sj.run_intent <> 'dormant'
    AND sj.status IN ('queued', 'running', 'resuming', 'rate_limited', 'partial')
    AND sj.status NOT IN (
      'completed',
      'completed_with_warnings',
      'partial_external_blocker',
      'failed',
      'failed_unrecoverable',
      'cancelled'
    )
    AND (sj.next_attempt_at IS NULL OR sj.next_attempt_at <= now() OR sj.run_intent <> 'retry')
    AND (sj.lease_expires_at IS NULL OR sj.lease_expires_at < now())
    AND (sj.phase IS NULL OR sj.phase IS DISTINCT FROM 'complete')
    AND COALESCE(sj.metadata->'arlington'->>'terminalReason', '') NOT IN (
      'plan_review_metadata_only',
      'no_progress_guard',
      'duplicate_active_job'
    )
    AND (
      sj.run_intent = 'foreground'
      OR (
        sj.run_intent = 'recovery'
        AND sj.explicitly_resumed_at IS NOT NULL
      )
      OR (
        sj.run_intent = 'retry'
        AND sj.status IN ('rate_limited', 'partial')
        AND (sj.next_attempt_at IS NULL OR sj.next_attempt_at <= now())
      )
      OR (
        sj.run_intent IN ('foreground', 'recovery', 'retry')
        AND sj.status IN ('running', 'resuming', 'partial')
        AND GREATEST(
          COALESCE(sj.last_worker_started_at, 'epoch'::timestamptz),
          COALESCE(sj.lease_heartbeat_at, 'epoch'::timestamptz),
          COALESCE(sj.last_heartbeat_at, 'epoch'::timestamptz)
        ) > now() - v_recovery_window
      )
    )
  ORDER BY
    CASE
      WHEN sj.run_intent = 'foreground' THEN 0
      WHEN sj.run_intent = 'recovery' AND sj.explicitly_resumed_at IS NOT NULL THEN 1
      WHEN sj.run_intent IN ('foreground', 'recovery', 'retry')
        AND sj.status IN ('running', 'resuming', 'partial')
        AND GREATEST(
          COALESCE(sj.last_worker_started_at, 'epoch'::timestamptz),
          COALESCE(sj.lease_heartbeat_at, 'epoch'::timestamptz),
          COALESCE(sj.last_heartbeat_at, 'epoch'::timestamptz)
        ) > now() - v_recovery_window THEN 2
      WHEN sj.run_intent = 'retry' THEN 3
      ELSE 99
    END,
    sj.dispatch_priority DESC,
    sj.requested_at DESC NULLS LAST,
    sj.created_at ASC
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
    last_worker_started_at = now(),
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

REVOKE ALL ON FUNCTION public.claim_arlington_scrape_job(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_arlington_scrape_job(TEXT, INTEGER) TO service_role;
