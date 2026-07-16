-- Row 3: Canonical utility provider directory + alias resolution foundation.
-- Does NOT ingest territory polygons or county lookup (D2.2).

-- ---------------------------------------------------------------------------
-- Canonical identity columns on utility_providers
-- ---------------------------------------------------------------------------

ALTER TABLE public.utility_providers
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS canonical_name TEXT,
  ADD COLUMN IF NOT EXISTS portal_key TEXT,
  ADD COLUMN IF NOT EXISTS cet_relationship BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS directory_source JSONB;

-- Backfill display/canonical from legacy name for existing global templates.
UPDATE public.utility_providers
SET
  display_name = COALESCE(display_name, name),
  canonical_name = COALESCE(canonical_name, name),
  portal_key = COALESCE(portal_key, slug),
  updated_at = now()
WHERE tenant_id IS NULL
  AND is_global_template = true;

-- ---------------------------------------------------------------------------
-- Alias table (deterministic exact match only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.utility_provider_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES public.utility_providers(id) ON DELETE CASCADE,
  alias_display TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  alias_source TEXT NOT NULL DEFAULT 'manual_alias',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT utility_provider_aliases_alias_normalized_unique UNIQUE (alias_normalized)
);

CREATE INDEX IF NOT EXISTS idx_utility_provider_aliases_provider_id
  ON public.utility_provider_aliases (provider_id);

CREATE TRIGGER utility_provider_aliases_updated_at
  BEFORE UPDATE ON public.utility_provider_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.utility_provider_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read aliases for visible providers"
ON public.utility_provider_aliases
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.utility_providers up
    WHERE up.id = provider_id
      AND (
        (up.is_global_template = true AND up.tenant_id IS NULL)
        OR (
          up.tenant_id IS NOT NULL
          AND public.can_access_tenant(auth.uid(), up.tenant_id)
        )
      )
  )
);

CREATE POLICY "Platform admins can manage global provider aliases"
ON public.utility_provider_aliases
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- Extend copy_utility_provider_template_for_tenant to include new columns
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.copy_utility_provider_template_for_tenant(
  p_tenant_id UUID,
  p_template_slug TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_template public.utility_providers%ROWTYPE;
  v_existing UUID;
  v_new_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_tenant_admin_access(v_uid, p_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_template
  FROM public.utility_providers
  WHERE slug = lower(trim(p_template_slug))
    AND is_global_template = true
    AND tenant_id IS NULL
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template provider not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_existing
  FROM public.utility_providers
  WHERE tenant_id = p_tenant_id AND slug = v_template.slug;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.utility_providers (
    slug, name, display_name, canonical_name, utility_type, ownership_type,
    service_territory, primary_portal_type, portal_url, portal_credentials_ref,
    portal_key, cet_relationship, directory_source, primary_contact,
    sla_acknowledgment_business_days, sla_class_of_service_business_days,
    sla_ciac_confirmation_business_days, automation_status, notes,
    is_active, tenant_id, is_global_template, source_template_id
  ) VALUES (
    v_template.slug, v_template.name, v_template.display_name, v_template.canonical_name,
    v_template.utility_type, v_template.ownership_type, v_template.service_territory,
    v_template.primary_portal_type, v_template.portal_url, v_template.portal_credentials_ref,
    v_template.portal_key, v_template.cet_relationship, v_template.directory_source,
    v_template.primary_contact, v_template.sla_acknowledgment_business_days,
    v_template.sla_class_of_service_business_days, v_template.sla_ciac_confirmation_business_days,
    v_template.automation_status, v_template.notes,
    true, p_tenant_id, false, v_template.id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.copy_utility_provider_template_for_tenant(UUID, TEXT) TO authenticated;

-- Note: Full provider catalog + alias rows are applied idempotently via
-- scraper-service seedUtilityProviderDirectory() after migration (see Row 3 tests).
-- Existing global template UUIDs and portal metadata from 20260715150000 are preserved.
