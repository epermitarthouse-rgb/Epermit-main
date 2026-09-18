-- Platform Control Phase 2: server-backed feature flags (product visibility)
-- DO NOT apply until reviewed. Regenerate src/integrations/supabase/types.ts after apply.

-- =============================================================================
-- Scope: boolean, platform-wide product visibility flags only.
-- NOT governance permissions (user_feature_permissions) or Railway env vars.
-- =============================================================================

CREATE TABLE public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  label text NOT NULL,
  description text,
  category text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.feature_flag_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key text NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  old_value boolean NOT NULL,
  new_value boolean NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feature_flag_audit_flag_key ON public.feature_flag_audit(flag_key);
CREATE INDEX idx_feature_flag_audit_changed_at ON public.feature_flag_audit(changed_at DESC);

-- Seed known product flags (allowlist enforced by FK + RPC existence check)
INSERT INTO public.feature_flags (key, enabled, label, description, category)
VALUES (
  'homepage.show_demo_video',
  false,
  'Platform Demo Video',
  'Show the interactive platform demo video on the homepage',
  'Homepage'
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flag_audit ENABLE ROW LEVEL SECURITY;

-- Public read for homepage and other product surfaces (anon + authenticated)
CREATE POLICY feature_flags_select_public
  ON public.feature_flags
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Audit trail visible to admins only
CREATE POLICY feature_flag_audit_select_admin
  ON public.feature_flag_audit
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- No direct table writes; mutations go through set_feature_flag RPC

CREATE OR REPLACE FUNCTION public.get_feature_flags()
RETURNS TABLE (
  key text,
  enabled boolean,
  label text,
  description text,
  category text,
  updated_at timestamptz,
  updated_by uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ff.key,
    ff.enabled,
    ff.label,
    ff.description,
    ff.category,
    ff.updated_at,
    ff.updated_by
  FROM public.feature_flags ff
  ORDER BY ff.category NULLS LAST, ff.key;
$$;

REVOKE ALL ON FUNCTION public.get_feature_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_feature_flags() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_feature_flag(p_key text, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value boolean;
  v_user_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT ff.enabled INTO v_old_value
  FROM public.feature_flags ff
  WHERE ff.key = p_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown feature flag key: %', p_key;
  END IF;

  IF v_old_value IS NOT DISTINCT FROM p_enabled THEN
    RETURN jsonb_build_object(
      'key', p_key,
      'enabled', p_enabled,
      'changed', false
    );
  END IF;

  v_user_id := auth.uid();

  UPDATE public.feature_flags
  SET
    enabled = p_enabled,
    updated_at = now(),
    updated_by = v_user_id
  WHERE key = p_key;

  INSERT INTO public.feature_flag_audit (flag_key, old_value, new_value, changed_by)
  VALUES (p_key, v_old_value, p_enabled, v_user_id);

  RETURN jsonb_build_object(
    'key', p_key,
    'enabled', p_enabled,
    'changed', true,
    'updated_at', now(),
    'updated_by', v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_feature_flag(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(text, boolean) TO authenticated;
