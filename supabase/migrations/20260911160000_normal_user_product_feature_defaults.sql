-- Corrective migration: global active-user defaults = write for all standard product features.
-- Project role caps remain separate via _project_role_default_feature_access().
-- Does not modify existing user_feature_permissions rows.

CREATE OR REPLACE FUNCTION public._active_user_default_feature_access(p_feature_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_feature_key = ANY(
    ARRAY[
      'project.core',
      'scraper.run',
      'scraper.results',
      'filing.submit',
      'documents.vault',
      'ingestion.rag',
      'billing.quickbooks',
      'code.analyzer',
      'uci.workspace',
      'credentials.self'
    ]
  ) THEN
    RETURN 'write';
  END IF;
  RETURN 'write';
END;
$$;

CREATE OR REPLACE FUNCTION public._project_role_default_feature_access(
  p_user_id UUID,
  p_project_id UUID,
  p_feature_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_project_id IS NULL THEN
    RETURN 'none';
  END IF;

  IF public.has_project_admin_access(p_user_id, p_project_id) THEN
    RETURN 'write';
  END IF;

  IF public.has_project_editor_access(p_user_id, p_project_id) THEN
    IF p_feature_key = ANY(
      ARRAY[
        'scraper.run',
        'filing.submit',
        'documents.vault',
        'ingestion.rag',
        'code.analyzer',
        'credentials.self'
      ]
    ) THEN
      RETURN 'write';
    END IF;
    RETURN 'read';
  END IF;

  IF public.has_project_access(p_user_id, p_project_id) THEN
    RETURN 'read';
  END IF;

  RETURN 'none';
END;
$$;

CREATE OR REPLACE FUNCTION public._resolve_feature_access_level(
  p_user_id UUID,
  p_project_id UUID,
  p_feature_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global TEXT;
  v_explicit TEXT;
  v_project_baseline TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'none';
  END IF;

  v_global := public._global_feature_access_level(p_user_id, p_feature_key);
  IF v_global = 'none' THEN
    RETURN 'none';
  END IF;

  IF p_project_id IS NULL THEN
    RETURN v_global;
  END IF;

  IF NOT public.has_project_access(p_user_id, p_project_id) THEN
    RETURN v_global;
  END IF;

  SELECT ufp.access_level
  INTO v_explicit
  FROM public.user_feature_permissions ufp
  WHERE ufp.user_id = p_user_id
    AND ufp.project_id = p_project_id
    AND ufp.feature_key = p_feature_key;

  IF v_explicit IS NOT NULL THEN
    v_project_baseline := v_explicit;
  ELSE
    v_project_baseline := public._project_role_default_feature_access(
      p_user_id,
      p_project_id,
      p_feature_key
    );
  END IF;

  IF public._feature_level_rank(v_global) <= public._feature_level_rank(v_project_baseline) THEN
    RETURN v_global;
  END IF;

  RETURN v_project_baseline;
END;
$$;
