-- Code Analyzer Async V2 — Milestones 10–11: observability views + worker metrics.

CREATE OR REPLACE VIEW public.code_analyzer_job_metrics AS
SELECT
  'ingestion' AS job_kind,
  status,
  COUNT(*) AS job_count,
  MIN(created_at) FILTER (WHERE status = 'pending') AS oldest_queued,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL) AS avg_duration_seconds
FROM public.code_analyzer_ingestion_jobs
GROUP BY status
UNION ALL
SELECT
  'sheet' AS job_kind,
  status,
  COUNT(*) AS job_count,
  MIN(created_at) FILTER (WHERE status = 'queued') AS oldest_queued,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL) AS avg_duration_seconds
FROM public.code_analyzer_sheet_jobs
GROUP BY status;

COMMENT ON VIEW public.code_analyzer_job_metrics IS
  'Operational metrics for Code Analyzer Async V2 job queues (service role only).';

-- Heartbeat for sheet jobs (mirrors ingestion)
CREATE OR REPLACE FUNCTION public.heartbeat_code_analyzer_sheet_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 180
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ttl INTEGER;
  v_updated INTEGER;
BEGIN
  v_ttl := GREATEST(30, COALESCE(p_lease_ttl_seconds, 180));
  UPDATE public.code_analyzer_sheet_jobs
  SET
    lease_expires_at = now() + make_interval(secs => v_ttl),
    last_heartbeat_at = now(),
    updated_at = now()
  WHERE id = p_job_id
    AND lease_owner = p_worker_id
    AND status = 'processing'
    AND cancelled_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.heartbeat_code_analyzer_sheet_job(UUID, TEXT, INTEGER) TO service_role;
