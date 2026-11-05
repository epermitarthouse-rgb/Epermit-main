-- Platform-admin view of Supabase Analyzer spend. One row per run.
-- Project-member RLS stays as it is; this function is the only cross-project read.

CREATE OR REPLACE FUNCTION public.admin_supabase_analyzer_usage(p_limit INTEGER DEFAULT 200)
RETURNS TABLE (
  run_id UUID,
  project_id UUID,
  project_name TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT,
  analyzer_version TEXT,
  ai_model TEXT,
  total_sheets INTEGER,
  completed_sheets INTEGER,
  failed_sheets INTEGER,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  estimated_cost_usd NUMERIC,
  budget_limit_usd NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 200);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Platform admin access is required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.project_id,
    p.name,
    r.created_at,
    r.completed_at,
    r.status,
    CASE WHEN r.analysis_scope->>'analyzerVersion' = 'v2' THEN 'v2' ELSE 'v1' END,
    r.ai_model,
    r.total_sheets,
    r.completed_sheets,
    r.failed_sheets,
    r.total_input_tokens,
    r.total_output_tokens,
    r.estimated_cost_usd,
    r.budget_limit_usd
  FROM public.supabase_analyzer_runs r
  LEFT JOIN public.projects p ON p.id = r.project_id
  ORDER BY r.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_supabase_analyzer_usage(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_supabase_analyzer_usage(INTEGER) TO authenticated;

COMMENT ON FUNCTION public.admin_supabase_analyzer_usage(INTEGER) IS
  'Supabase Analyzer cost per run for platform admins. Estimated from recorded token usage.';
