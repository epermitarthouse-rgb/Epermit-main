-- Row 2 stage 3: Tenant propagation columns, triggers, and validation.

ALTER TABLE public.coordination_stage_transitions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.coordination_costs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.coordination_equipment
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.scrape_jobs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_coordination_stage_transitions_tenant_id
  ON public.coordination_stage_transitions (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_costs_tenant_id
  ON public.coordination_costs (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coordination_equipment_tenant_id
  ON public.coordination_equipment (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_tenant_id
  ON public.scrape_jobs (tenant_id)
  WHERE tenant_id IS NOT NULL;

-- Backfill new columns from coordination_records / projects.
UPDATE public.coordination_stage_transitions cst
SET tenant_id = cr.tenant_id
FROM public.coordination_records cr
WHERE cst.coordination_record_id = cr.id
  AND cst.project_id = cr.project_id
  AND cr.tenant_id IS NOT NULL
  AND cst.tenant_id IS DISTINCT FROM cr.tenant_id;

UPDATE public.coordination_costs cc
SET tenant_id = cr.tenant_id
FROM public.coordination_records cr
WHERE cc.coordination_record_id = cr.id
  AND cc.project_id = cr.project_id
  AND cr.tenant_id IS NOT NULL
  AND cc.tenant_id IS DISTINCT FROM cr.tenant_id;

UPDATE public.coordination_equipment ce
SET tenant_id = cr.tenant_id
FROM public.coordination_records cr
WHERE ce.coordination_record_id = cr.id
  AND ce.project_id = cr.project_id
  AND cr.tenant_id IS NOT NULL
  AND ce.tenant_id IS DISTINCT FROM cr.tenant_id;

UPDATE public.scrape_jobs sj
SET tenant_id = p.tenant_id
FROM public.projects p
WHERE sj.project_id = p.id
  AND p.tenant_id IS NOT NULL
  AND sj.tenant_id IS DISTINCT FROM p.tenant_id;

-- Derive tenant_id from project when omitted on insert.
CREATE OR REPLACE FUNCTION public.set_row_tenant_from_project()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.projects WHERE id = NEW.project_id;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_tenant_id;
  ELSIF v_tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'tenant_id does not match project tenant' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_coordination_tenant_from_project()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.projects WHERE id = NEW.project_id;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_tenant_id;
  ELSIF v_tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'coordination tenant_id does not match project tenant' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_uci_child_tenant_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_record_tenant UUID;
  v_project_tenant UUID;
BEGIN
  SELECT cr.tenant_id, p.tenant_id
  INTO v_record_tenant, v_project_tenant
  FROM public.coordination_records cr
  JOIN public.projects p ON p.id = cr.project_id
  WHERE cr.id = NEW.coordination_record_id
    AND cr.project_id = NEW.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'coordination record not found for project' USING ERRCODE = '23503';
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_record_tenant;
  END IF;

  IF v_record_tenant IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM v_record_tenant THEN
    RAISE EXCEPTION 'child tenant_id does not match coordination record' USING ERRCODE = '23514';
  END IF;

  IF v_project_tenant IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM v_project_tenant THEN
    RAISE EXCEPTION 'child tenant_id does not match project tenant' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coordination_records_set_tenant ON public.coordination_records;
CREATE TRIGGER coordination_records_set_tenant
BEFORE INSERT OR UPDATE OF project_id, tenant_id ON public.coordination_records
FOR EACH ROW
EXECUTE FUNCTION public.set_coordination_tenant_from_project();

DROP TRIGGER IF EXISTS coordination_stage_transitions_set_tenant ON public.coordination_stage_transitions;
CREATE TRIGGER coordination_stage_transitions_set_tenant
BEFORE INSERT OR UPDATE OF project_id, tenant_id ON public.coordination_stage_transitions
FOR EACH ROW
EXECUTE FUNCTION public.validate_uci_child_tenant_match();

DROP TRIGGER IF EXISTS coordination_applications_set_tenant ON public.coordination_applications;
CREATE TRIGGER coordination_applications_set_tenant
BEFORE INSERT OR UPDATE OF project_id, tenant_id, coordination_record_id ON public.coordination_applications
FOR EACH ROW
EXECUTE FUNCTION public.validate_uci_child_tenant_match();

DROP TRIGGER IF EXISTS coordination_communications_set_tenant ON public.coordination_communications;
CREATE TRIGGER coordination_communications_set_tenant
BEFORE INSERT OR UPDATE OF project_id, tenant_id, coordination_record_id ON public.coordination_communications
FOR EACH ROW
EXECUTE FUNCTION public.validate_uci_child_tenant_match();

DROP TRIGGER IF EXISTS coordination_milestones_set_tenant ON public.coordination_milestones;
CREATE TRIGGER coordination_milestones_set_tenant
BEFORE INSERT OR UPDATE OF project_id, tenant_id, coordination_record_id ON public.coordination_milestones
FOR EACH ROW
EXECUTE FUNCTION public.validate_uci_child_tenant_match();

DROP TRIGGER IF EXISTS coordination_costs_set_tenant ON public.coordination_costs;
CREATE TRIGGER coordination_costs_set_tenant
BEFORE INSERT OR UPDATE OF project_id, tenant_id, coordination_record_id ON public.coordination_costs
FOR EACH ROW
EXECUTE FUNCTION public.validate_uci_child_tenant_match();

DROP TRIGGER IF EXISTS coordination_equipment_set_tenant ON public.coordination_equipment;
CREATE TRIGGER coordination_equipment_set_tenant
BEFORE INSERT OR UPDATE OF project_id, tenant_id, coordination_record_id ON public.coordination_equipment
FOR EACH ROW
EXECUTE FUNCTION public.validate_uci_child_tenant_match();

DROP TRIGGER IF EXISTS scrape_jobs_set_tenant ON public.scrape_jobs;
CREATE TRIGGER scrape_jobs_set_tenant
BEFORE INSERT OR UPDATE OF project_id, tenant_id ON public.scrape_jobs
FOR EACH ROW
EXECUTE FUNCTION public.set_row_tenant_from_project();

-- New projects inherit tenant from owner membership when created (app should set explicitly).
CREATE OR REPLACE FUNCTION public.set_project_tenant_from_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF NOT public.has_tenant_access(NEW.user_id, NEW.tenant_id) THEN
      RAISE EXCEPTION 'project owner must belong to tenant' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT tm.tenant_id INTO NEW.tenant_id
  FROM public.tenant_memberships tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = NEW.user_id
    AND tm.role = 'owner'
    AND t.is_demo = false
  ORDER BY tm.created_at ASC
  LIMIT 1;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_tenant_from_owner ON public.projects;
CREATE TRIGGER projects_set_tenant_from_owner
BEFORE INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.set_project_tenant_from_owner();
