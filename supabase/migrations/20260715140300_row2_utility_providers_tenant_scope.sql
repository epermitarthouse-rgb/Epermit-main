-- Row 2 stage 4: Tenant-scoped utility_providers (preserve global catalog as templates).

ALTER TABLE public.utility_providers
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_global_template BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES public.utility_providers(id) ON DELETE SET NULL;

-- Existing seeded catalog becomes explicit global templates (readable by all authenticated users).
UPDATE public.utility_providers
SET is_global_template = true,
    tenant_id = NULL
WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_utility_providers_tenant_id
  ON public.utility_providers (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_utility_providers_tenant_slug
  ON public.utility_providers (tenant_id, slug)
  WHERE tenant_id IS NOT NULL;

DROP POLICY IF EXISTS "Authenticated users can read utility providers" ON public.utility_providers;

CREATE POLICY "Users can read global templates and tenant providers"
ON public.utility_providers
FOR SELECT
TO authenticated
USING (
  (is_global_template = true AND tenant_id IS NULL)
  OR (
    tenant_id IS NOT NULL
    AND public.can_access_tenant(auth.uid(), tenant_id)
  )
);

CREATE POLICY "Tenant admins can insert tenant providers"
ON public.utility_providers
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IS NOT NULL
  AND is_global_template = false
  AND public.has_tenant_admin_access(auth.uid(), tenant_id)
);

CREATE POLICY "Tenant admins can update tenant providers"
ON public.utility_providers
FOR UPDATE
TO authenticated
USING (
  tenant_id IS NOT NULL
  AND public.has_tenant_admin_access(auth.uid(), tenant_id)
)
WITH CHECK (
  tenant_id IS NOT NULL
  AND is_global_template = false
  AND public.has_tenant_admin_access(auth.uid(), tenant_id)
);

CREATE POLICY "Tenant admins can delete tenant providers"
ON public.utility_providers
FOR DELETE
TO authenticated
USING (
  tenant_id IS NOT NULL
  AND public.has_tenant_admin_access(auth.uid(), tenant_id)
);

CREATE POLICY "Platform admins can manage global templates"
ON public.utility_providers
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Copy a global template into a tenant-owned provider (idempotent by tenant+slug).
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
    slug, name, utility_type, ownership_type, service_territory,
    primary_portal_type, portal_url, portal_credentials_ref, primary_contact,
    sla_acknowledgment_business_days, sla_class_of_service_business_days,
    sla_ciac_confirmation_business_days, automation_status, notes,
    is_active, tenant_id, is_global_template, source_template_id
  ) VALUES (
    v_template.slug, v_template.name, v_template.utility_type, v_template.ownership_type,
    v_template.service_territory, v_template.primary_portal_type, v_template.portal_url,
    v_template.portal_credentials_ref, v_template.primary_contact,
    v_template.sla_acknowledgment_business_days, v_template.sla_class_of_service_business_days,
    v_template.sla_ciac_confirmation_business_days, v_template.automation_status, v_template.notes,
    true, p_tenant_id, false, v_template.id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.copy_utility_provider_template_for_tenant(UUID, TEXT) TO authenticated;
