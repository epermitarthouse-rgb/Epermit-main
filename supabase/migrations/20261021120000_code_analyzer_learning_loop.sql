-- Additive learning loop for Code Analyzer V2.
-- New tables only. Existing runs, findings, drawing facts, and code provisions are unchanged.
-- Rollback: drop the learning tables at the bottom of this file in reverse dependency order.
-- Feedback status changes only through the review functions. Direct approval is rejected.

CREATE TABLE IF NOT EXISTS public.code_analyzer_learning_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id UUID,
  run_id UUID REFERENCES public.code_analyzer_runs(id) ON DELETE SET NULL,
  sheet_id UUID REFERENCES public.code_analyzer_sheets(id) ON DELETE SET NULL,
  document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  code_edition TEXT,
  jurisdiction TEXT,
  source_provision TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'extraction_element', 'extraction_dimension', 'extraction_calculation', 'extraction_label',
    'dimension_association', 'missed_evidence', 'code_retrieval', 'jurisdiction_mapping',
    'false_positive', 'false_negative', 'applicability', 'exception_handling', 'confirmed_finding'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'evidence_review', 'approved', 'rejected', 'superseded'
  )),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('human_reviewer', 'ai_suggestion', 'trusted_ground_truth')),
  approval_basis TEXT CHECK (approval_basis IS NULL OR approval_basis IN ('human_approval', 'trusted_ground_truth')),
  original_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  drawing_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_correction JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_note TEXT,
  submitted_by UUID NOT NULL,
  evidence_reviewed_by UUID,
  evidence_reviewed_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  superseded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT code_analyzer_learning_feedback_sizes CHECK (
    octet_length(original_output::text) <= 24000
    AND octet_length(drawing_evidence::text) <= 12000
    AND octet_length(proposed_correction::text) <= 12000
    AND position('imagebase64' in lower(original_output::text || drawing_evidence::text)) = 0
  )
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_learning_feedback_project
  ON public.code_analyzer_learning_feedback (project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.code_analyzer_learning_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id UUID,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('promoted', 'rolled_back')),
  is_active BOOLEAN NOT NULL DEFAULT false,
  previous_version_id UUID,
  evaluation JSONB NOT NULL DEFAULT '{}'::jsonb,
  promoted_by UUID,
  rolled_back_by UUID,
  rollback_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_analyzer_learning_versions_one_active
  ON public.code_analyzer_learning_versions (project_id)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.code_analyzer_learning_guidance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id UUID,
  feedback_id UUID NOT NULL REFERENCES public.code_analyzer_learning_feedback(id) ON DELETE CASCADE,
  version_id UUID REFERENCES public.code_analyzer_learning_versions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('promoted', 'rolled_back', 'superseded')),
  scope TEXT NOT NULL CHECK (scope IN ('sheet', 'project_pattern')),
  authority TEXT NOT NULL DEFAULT 'human_reviewed_interpretation'
    CHECK (authority = 'human_reviewed_interpretation'),
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  effect JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_learning_guidance_active
  ON public.code_analyzer_learning_guidance (project_id, version_id)
  WHERE status = 'promoted';

CREATE TABLE IF NOT EXISTS public.code_analyzer_learning_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES public.code_analyzer_learning_versions(id) ON DELETE CASCADE,
  feedback_id UUID REFERENCES public.code_analyzer_learning_feedback(id) ON DELETE SET NULL,
  metric TEXT NOT NULL CHECK (metric IN (
    'extraction', 'association', 'retrieval', 'false_positive', 'false_negative', 'reuse'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN (
    'improvement', 'regression', 'unchanged_correct', 'unchanged_incorrect'
  )),
  before_passed BOOLEAN NOT NULL,
  after_passed BOOLEAN NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.code_analyzer_learning_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  feedback_id UUID,
  version_id UUID,
  actor_id UUID,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_learning_audit_project
  ON public.code_analyzer_learning_audit (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.code_analyzer_learning_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id UUID,
  sheet_id UUID,
  guidance_id UUID NOT NULL REFERENCES public.code_analyzer_learning_guidance(id) ON DELETE CASCADE,
  version_id UUID,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_learning_applications_project
  ON public.code_analyzer_learning_applications (project_id, created_at DESC);

COMMENT ON TABLE public.code_analyzer_learning_feedback IS
  'Reviewer corrections. Original output and drawing evidence are immutable. Pending feedback is not learning.';
COMMENT ON TABLE public.code_analyzer_learning_guidance IS
  'Project-scoped interpretation guidance promoted from an approved correction. Not a code requirement.';
COMMENT ON TABLE public.code_analyzer_learning_versions IS
  'Promoted learning sets. One active version per project. Rollback restores the previous set.';

ALTER TABLE public.code_analyzer_learning_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_analyzer_learning_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_analyzer_learning_guidance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_analyzer_learning_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_analyzer_learning_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_analyzer_learning_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view learning feedback" ON public.code_analyzer_learning_feedback;
CREATE POLICY "Users can view learning feedback"
  ON public.code_analyzer_learning_feedback FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can view learning versions" ON public.code_analyzer_learning_versions;
CREATE POLICY "Users can view learning versions"
  ON public.code_analyzer_learning_versions FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can view learning guidance" ON public.code_analyzer_learning_guidance;
CREATE POLICY "Users can view learning guidance"
  ON public.code_analyzer_learning_guidance FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can view learning evaluations" ON public.code_analyzer_learning_evaluations;
CREATE POLICY "Users can view learning evaluations"
  ON public.code_analyzer_learning_evaluations FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can view learning audit" ON public.code_analyzer_learning_audit;
CREATE POLICY "Users can view learning audit"
  ON public.code_analyzer_learning_audit FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP POLICY IF EXISTS "Users can view learning applications" ON public.code_analyzer_learning_applications;
CREATE POLICY "Users can view learning applications"
  ON public.code_analyzer_learning_applications FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

DROP TRIGGER IF EXISTS update_code_analyzer_learning_feedback_updated_at
  ON public.code_analyzer_learning_feedback;
CREATE TRIGGER update_code_analyzer_learning_feedback_updated_at
  BEFORE UPDATE ON public.code_analyzer_learning_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_feedback_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sheet_project UUID;
  run_project UUID;
BEGIN
  IF NEW.sheet_id IS NOT NULL THEN
    SELECT project_id INTO sheet_project FROM public.code_analyzer_sheets WHERE id = NEW.sheet_id;
    IF sheet_project IS NULL OR sheet_project <> NEW.project_id THEN
      RAISE EXCEPTION 'learning feedback sheet is not in this project';
    END IF;
  END IF;
  IF NEW.run_id IS NOT NULL THEN
    SELECT project_id INTO run_project FROM public.code_analyzer_runs WHERE id = NEW.run_id;
    IF run_project IS NULL OR run_project <> NEW.project_id THEN
      RAISE EXCEPTION 'learning feedback run is not in this project';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'new learning feedback starts as pending';
    END IF;
    NEW.approval_basis := NULL;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.original_output IS DISTINCT FROM OLD.original_output
     OR NEW.drawing_evidence IS DISTINCT FROM OLD.drawing_evidence
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.sheet_id IS DISTINCT FROM OLD.sheet_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.code_edition IS DISTINCT FROM OLD.code_edition
     OR NEW.jurisdiction IS DISTINCT FROM OLD.jurisdiction
     OR NEW.source_provision IS DISTINCT FROM OLD.source_provision
  THEN
    RAISE EXCEPTION 'original learning evidence cannot be overwritten';
  END IF;

  IF NEW.proposed_correction IS DISTINCT FROM OLD.proposed_correction
     AND OLD.status NOT IN ('pending', 'evidence_review') THEN
    RAISE EXCEPTION 'proposed correction is locked after review';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF current_setting('code_analyzer.learning_transition', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'learning status changes go through the review functions';
    END IF;
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('evidence_review', 'rejected'))
      OR (OLD.status = 'evidence_review' AND NEW.status IN ('approved', 'rejected'))
      OR (OLD.status = 'approved' AND NEW.status = 'superseded')
    ) THEN
      RAISE EXCEPTION 'invalid learning status transition from % to %', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'approved' THEN
      IF NEW.approved_by IS NULL OR NEW.approved_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'approval requires the signed-in reviewer';
      END IF;
      IF NEW.evidence_reviewed_at IS NULL THEN
        RAISE EXCEPTION 'evidence review is required before approval';
      END IF;
      IF NEW.approval_basis NOT IN ('human_approval', 'trusted_ground_truth') THEN
        RAISE EXCEPTION 'approval basis is missing';
      END IF;
      IF OLD.source_kind = 'ai_suggestion' AND NEW.approval_basis IS DISTINCT FROM 'human_approval' THEN
        RAISE EXCEPTION 'an AI suggestion requires human approval';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS code_analyzer_learning_feedback_guard ON public.code_analyzer_learning_feedback;
CREATE TRIGGER code_analyzer_learning_feedback_guard
  BEFORE INSERT OR UPDATE ON public.code_analyzer_learning_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.code_analyzer_learning_feedback_guard();

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_guidance_error(
  p_scope TEXT,
  p_conditions JSONB,
  p_effect JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  key TEXT;
  label TEXT;
  sheet_number TEXT;
  sheet_id TEXT;
  section_locator TEXT;
  issue_signature TEXT;
  note TEXT;
BEGIN
  IF p_scope NOT IN ('sheet', 'project_pattern') THEN
    RETURN 'Scope must be this sheet or a project pattern.';
  END IF;
  IF p_effect IS NULL OR jsonb_typeof(p_effect) <> 'object' THEN
    RETURN 'A correction effect is required.';
  END IF;
  FOR key IN SELECT jsonb_object_keys(p_effect) LOOP
    IF lower(key) IN (
      'threshold', 'minimum', 'maximum', 'code_text', 'requirement', 'adopted_value',
      'exception_override', 'verifier_bypass', 'authoritative', 'shall'
    ) THEN
      RETURN 'Learning cannot set ' || key || '.';
    END IF;
  END LOOP;
  label := btrim(COALESCE(p_conditions->>'label_pattern', ''));
  sheet_number := btrim(COALESCE(p_conditions->>'sheet_number', ''));
  sheet_id := btrim(COALESCE(p_conditions->>'sheet_id', ''));
  section_locator := btrim(COALESCE(p_effect->>'section_locator', p_conditions->>'section_locator', ''));
  issue_signature := btrim(COALESCE(p_effect->>'issue_signature', ''));
  note := COALESCE(p_effect->>'note', '');
  IF note ~* '\m(code|ibc|ifc|ipc|imc|nfpa)\M.{0,80}\m(shall|must|minimum|maximum)\M' THEN
    RETURN 'The note states a code obligation. Record a drawing interpretation instead.';
  END IF;
  IF p_scope = 'sheet' AND sheet_number = '' AND sheet_id = '' THEN
    RETURN 'A sheet correction needs the sheet name or sheet id.';
  END IF;
  IF p_effect->>'kind' = 'relabel_element' THEN
    IF COALESCE(p_effect->>'element_type', '') !~ '^[a-z][a-z0-9_]{1,60}$' THEN
      RETURN 'The corrected element type must be a short classification label.';
    END IF;
    IF char_length(label) < 3 THEN
      RETURN 'Relabeling needs the printed label that was misread.';
    END IF;
  ELSIF p_effect->>'kind' IN ('bind_dimension', 'unbind_dimension') THEN
    IF char_length(label) < 3 THEN
      RETURN 'Association corrections need the printed dimension or label.';
    END IF;
    IF p_effect->>'kind' = 'bind_dimension' AND COALESCE(p_effect->>'bind_to', '') NOT IN ('element', 'calculation') THEN
      RETURN 'Say whether the dimension binds to an element or a calculation.';
    END IF;
  ELSIF p_effect->>'kind' = 'prefer_section' THEN
    IF char_length(section_locator) < 2 THEN
      RETURN 'Name the code section locator that should be preferred.';
    END IF;
  ELSIF p_effect->>'kind' = 'suppress_false_positive' THEN
    IF char_length(issue_signature) < (CASE WHEN p_scope = 'project_pattern' THEN 12 ELSE 8 END) THEN
      RETURN 'A false positive needs the finding title it applies to.';
    END IF;
  ELSIF p_effect->>'kind' IN ('flag_missed_evidence', 'interpretation_note') THEN
    IF char_length(btrim(note)) < 8 THEN
      RETURN 'Write a short correction the next review can read.';
    END IF;
  ELSE
    RETURN 'Unknown learning effect.';
  END IF;
  IF p_scope = 'project_pattern'
     AND char_length(label) < 3
     AND char_length(section_locator) < 2
     AND char_length(issue_signature) < 12 THEN
    RETURN 'A project pattern needs a label, section locator, or finding title.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_controlled_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  feedback_project UUID;
  version_project UUID;
BEGIN
  IF current_setting('code_analyzer.learning_transition', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'learning guidance and versions change only through promotion or rollback';
  END IF;
  IF TG_TABLE_NAME = 'code_analyzer_learning_guidance' THEN
    IF NEW.authority IS DISTINCT FROM 'human_reviewed_interpretation' THEN
      RAISE EXCEPTION 'learning guidance cannot be a code requirement';
    END IF;
    IF public.code_analyzer_learning_guidance_error(NEW.scope, NEW.conditions, NEW.effect) IS NOT NULL THEN
      RAISE EXCEPTION '%', public.code_analyzer_learning_guidance_error(NEW.scope, NEW.conditions, NEW.effect);
    END IF;
    SELECT project_id INTO feedback_project FROM public.code_analyzer_learning_feedback WHERE id = NEW.feedback_id;
    IF feedback_project IS NULL OR feedback_project <> NEW.project_id THEN
      RAISE EXCEPTION 'learning guidance must stay in the correction project';
    END IF;
    IF NEW.version_id IS NOT NULL THEN
      SELECT project_id INTO version_project FROM public.code_analyzer_learning_versions WHERE id = NEW.version_id;
      IF version_project IS NULL OR version_project <> NEW.project_id THEN
        RAISE EXCEPTION 'learning version is not in this project';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS code_analyzer_learning_guidance_controlled ON public.code_analyzer_learning_guidance;
CREATE TRIGGER code_analyzer_learning_guidance_controlled
  BEFORE INSERT OR UPDATE ON public.code_analyzer_learning_guidance
  FOR EACH ROW
  EXECUTE FUNCTION public.code_analyzer_learning_controlled_write();

DROP TRIGGER IF EXISTS code_analyzer_learning_versions_controlled ON public.code_analyzer_learning_versions;
CREATE TRIGGER code_analyzer_learning_versions_controlled
  BEFORE INSERT OR UPDATE ON public.code_analyzer_learning_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.code_analyzer_learning_controlled_write();

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_audit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'learning audit is append-only';
  END IF;
  IF current_setting('code_analyzer.learning_transition', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'learning audit is written by the review functions';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS code_analyzer_learning_audit_guard ON public.code_analyzer_learning_audit;
CREATE TRIGGER code_analyzer_learning_audit_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.code_analyzer_learning_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.code_analyzer_learning_audit_guard();

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_applications_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  guidance_project UUID;
BEGIN
  SELECT project_id INTO guidance_project
  FROM public.code_analyzer_learning_guidance
  WHERE id = NEW.guidance_id;
  IF guidance_project IS NULL OR guidance_project <> NEW.project_id THEN
    RAISE EXCEPTION 'learning application must stay in the guidance project';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS code_analyzer_learning_applications_guard ON public.code_analyzer_learning_applications;
CREATE TRIGGER code_analyzer_learning_applications_guard
  BEFORE INSERT OR UPDATE ON public.code_analyzer_learning_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.code_analyzer_learning_applications_guard();

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_require_editor(p_project_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.has_project_editor_access(actor, p_project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;
  RETURN actor;
END;
$$;

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_submit(p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
  project UUID;
  tenant UUID;
  feedback_id UUID;
  source_kind TEXT := 'human_reviewer';
BEGIN
  project := NULLIF(p_payload->>'project_id', '')::UUID;
  actor := public.code_analyzer_learning_require_editor(project);
  SELECT p.tenant_id INTO tenant FROM public.projects p WHERE p.id = project;
  IF NULLIF(p_payload->>'source_kind', '') = 'ai_suggestion' THEN
    source_kind := 'ai_suggestion';
  ELSIF NULLIF(p_payload->>'source_kind', '') = 'trusted_ground_truth' THEN
    source_kind := 'trusted_ground_truth';
  END IF;
  INSERT INTO public.code_analyzer_learning_feedback (
    project_id, tenant_id, run_id, sheet_id, document_id, code_edition, jurisdiction,
    source_provision, category, status, source_kind, original_output, drawing_evidence,
    proposed_correction, reviewer_note, submitted_by
  ) VALUES (
    project,
    tenant,
    NULLIF(p_payload->>'run_id', '')::UUID,
    NULLIF(p_payload->>'sheet_id', '')::UUID,
    NULLIF(p_payload->>'document_id', '')::UUID,
    NULLIF(p_payload->>'code_edition', ''),
    NULLIF(p_payload->>'jurisdiction', ''),
    NULLIF(p_payload->>'source_provision', ''),
    p_payload->>'category',
    'pending',
    source_kind,
    COALESCE(p_payload->'original_output', '{}'::jsonb),
    COALESCE(p_payload->'drawing_evidence', '{}'::jsonb),
    COALESCE(p_payload->'proposed_correction', '{}'::jsonb),
    NULLIF(p_payload->>'reviewer_note', ''),
    actor
  ) RETURNING id INTO feedback_id;

  PERFORM set_config('code_analyzer.learning_transition', '1', true);
  INSERT INTO public.code_analyzer_learning_audit (project_id, feedback_id, actor_id, action, detail)
  VALUES (project, feedback_id, actor, 'submitted', jsonb_build_object('source_kind', source_kind, 'category', p_payload->>'category'));
  RETURN feedback_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_decide(
  p_feedback_id UUID,
  p_action TEXT,
  p_attestation BOOLEAN,
  p_approval_basis TEXT,
  p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
  row public.code_analyzer_learning_feedback%ROWTYPE;
BEGIN
  SELECT * INTO row FROM public.code_analyzer_learning_feedback WHERE id = p_feedback_id;
  IF row.id IS NULL THEN
    RAISE EXCEPTION 'learning feedback not found';
  END IF;
  actor := public.code_analyzer_learning_require_editor(row.project_id);
  PERFORM set_config('code_analyzer.learning_transition', '1', true);

  IF p_action = 'start_review' THEN
    IF row.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'Only pending feedback can move into evidence review.';
    END IF;
    UPDATE public.code_analyzer_learning_feedback
      SET status = 'evidence_review', evidence_reviewed_by = actor, evidence_reviewed_at = now()
      WHERE id = row.id;
  ELSIF p_action = 'approve' THEN
    IF row.status IS DISTINCT FROM 'evidence_review' THEN
      RAISE EXCEPTION 'Evidence review is required before approval.';
    END IF;
    IF p_attestation IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Approval requires attestation that the original evidence was reviewed.';
    END IF;
    IF p_approval_basis NOT IN ('human_approval', 'trusted_ground_truth') THEN
      RAISE EXCEPTION 'Approval must be a human decision or an explicit trusted ground-truth source.';
    END IF;
    IF row.source_kind = 'ai_suggestion' AND p_approval_basis IS DISTINCT FROM 'human_approval' THEN
      RAISE EXCEPTION 'An AI suggestion cannot become learning without human approval.';
    END IF;
    UPDATE public.code_analyzer_learning_feedback
      SET status = 'approved', approved_by = actor, approved_at = now(), approval_basis = p_approval_basis
      WHERE id = row.id;
  ELSIF p_action = 'reject' THEN
    IF row.status NOT IN ('pending', 'evidence_review') THEN
      RAISE EXCEPTION 'This feedback can no longer be rejected.';
    END IF;
    UPDATE public.code_analyzer_learning_feedback
      SET status = 'rejected', rejected_by = actor, rejected_at = now(), rejection_reason = left(COALESCE(p_reason, ''), 500)
      WHERE id = row.id;
  ELSIF p_action = 'supersede' THEN
    IF row.status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'Only an approved correction can be superseded.';
    END IF;
    UPDATE public.code_analyzer_learning_feedback
      SET status = 'superseded'
      WHERE id = row.id;
  ELSE
    RAISE EXCEPTION 'Unknown learning action.';
  END IF;

  INSERT INTO public.code_analyzer_learning_audit (project_id, feedback_id, actor_id, action, detail)
  VALUES (row.project_id, row.id, actor, p_action, jsonb_build_object('approval_basis', p_approval_basis, 'reason', p_reason));
  RETURN p_action;
END;
$$;

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_promote(
  p_project_id UUID,
  p_feedback_ids UUID[],
  p_evaluation JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
  tenant UUID;
  version_id UUID;
  previous_id UUID;
  version_number INTEGER;
  approved_count INTEGER;
  feedback_row public.code_analyzer_learning_feedback%ROWTYPE;
  guidance_error TEXT;
  eval_item JSONB;
BEGIN
  actor := public.code_analyzer_learning_require_editor(p_project_id);
  IF p_feedback_ids IS NULL OR cardinality(p_feedback_ids) < 1 OR cardinality(p_feedback_ids) > 25 THEN
    RAISE EXCEPTION 'Promote between 1 and 25 approved corrections.';
  END IF;
  IF p_evaluation IS NULL OR jsonb_typeof(p_evaluation) <> 'object' THEN
    RAISE EXCEPTION 'An evaluation is required.';
  END IF;
  IF COALESCE((p_evaluation->>'accuracyClaim')::boolean, false)
     OR p_evaluation ? 'confidence'
     OR p_evaluation ? 'finding_count' THEN
    RAISE EXCEPTION 'Finding counts and model confidence are not acceptance metrics.';
  END IF;
  IF COALESCE((p_evaluation->>'labeledCount')::int, 0) < 1
     OR COALESCE((p_evaluation->>'improvements')::int, 0) < 1
     OR COALESCE((p_evaluation->>'regressions')::int, 0) <> 0 THEN
    RAISE EXCEPTION 'Promotion requires a measured improvement and no labeled regression.';
  END IF;
  IF jsonb_typeof(p_evaluation->'examples') <> 'array' THEN
    RAISE EXCEPTION 'Evaluation examples are required.';
  END IF;

  FOR eval_item IN SELECT value FROM jsonb_array_elements(p_evaluation->'examples') LOOP
    IF NOT (NULLIF(eval_item->>'feedback_id', '')::UUID = ANY (p_feedback_ids)) THEN
      RAISE EXCEPTION 'Evaluation example is not one of the corrections being promoted.';
    END IF;
    IF COALESCE(eval_item->>'metric', '') NOT IN (
      'extraction', 'association', 'retrieval', 'false_positive', 'false_negative', 'reuse'
    ) THEN
      RAISE EXCEPTION 'Unknown evaluation metric.';
    END IF;
  END LOOP;

  SELECT count(*) INTO approved_count
  FROM public.code_analyzer_learning_feedback
  WHERE id = ANY (p_feedback_ids)
    AND project_id = p_project_id
    AND status = 'approved';
  IF approved_count IS DISTINCT FROM cardinality(p_feedback_ids) THEN
    RAISE EXCEPTION 'Only approved corrections from this project can be promoted.';
  END IF;

  SELECT p.tenant_id INTO tenant FROM public.projects p WHERE p.id = p_project_id;
  SELECT id INTO previous_id
  FROM public.code_analyzer_learning_versions
  WHERE project_id = p_project_id AND is_active
  LIMIT 1;
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO version_number
  FROM public.code_analyzer_learning_versions
  WHERE project_id = p_project_id;

  PERFORM set_config('code_analyzer.learning_transition', '1', true);
  IF previous_id IS NOT NULL THEN
    UPDATE public.code_analyzer_learning_versions
      SET is_active = false
      WHERE id = previous_id;
  END IF;

  INSERT INTO public.code_analyzer_learning_versions (
    project_id, tenant_id, version_number, status, is_active, previous_version_id, evaluation, promoted_by
  ) VALUES (
    p_project_id, tenant, version_number, 'promoted', true, previous_id, p_evaluation, actor
  ) RETURNING id INTO version_id;

  FOR feedback_row IN
    SELECT * FROM public.code_analyzer_learning_feedback
    WHERE id = ANY (p_feedback_ids)
  LOOP
    IF feedback_row.project_id IS DISTINCT FROM p_project_id OR feedback_row.status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'Only approved corrections from this project can be promoted.';
    END IF;
    IF feedback_row.approval_basis NOT IN ('human_approval', 'trusted_ground_truth') THEN
      RAISE EXCEPTION 'Approval was not recorded as human or trusted ground truth.';
    END IF;
    IF feedback_row.source_kind = 'ai_suggestion' AND feedback_row.approval_basis IS DISTINCT FROM 'human_approval' THEN
      RAISE EXCEPTION 'An AI suggestion stays untrusted until a person approves it.';
    END IF;
    guidance_error := public.code_analyzer_learning_guidance_error(
      feedback_row.proposed_correction->>'scope',
      COALESCE(feedback_row.proposed_correction->'conditions', '{}'::jsonb),
      COALESCE(feedback_row.proposed_correction->'effect', '{}'::jsonb)
    );
    IF guidance_error IS NOT NULL THEN
      RAISE EXCEPTION '%', guidance_error;
    END IF;
    INSERT INTO public.code_analyzer_learning_guidance (
      project_id, tenant_id, feedback_id, version_id, status, scope, authority, conditions, effect, provenance
    ) VALUES (
      p_project_id,
      feedback_row.tenant_id,
      feedback_row.id,
      version_id,
      'promoted',
      feedback_row.proposed_correction->>'scope',
      'human_reviewed_interpretation',
      feedback_row.proposed_correction->'conditions',
      feedback_row.proposed_correction->'effect',
      jsonb_build_object(
        'feedback_id', feedback_row.id,
        'approved_by', feedback_row.approved_by,
        'approved_at', feedback_row.approved_at,
        'source_kind', feedback_row.source_kind,
        'approval_basis', feedback_row.approval_basis
      )
    );
  END LOOP;

  INSERT INTO public.code_analyzer_learning_evaluations (
    project_id, version_id, feedback_id, metric, outcome, before_passed, after_passed, detail
  )
  SELECT
    p_project_id,
    version_id,
    NULLIF(eval_row->>'feedback_id', '')::UUID,
    eval_row->>'metric',
    eval_row->>'outcome',
    COALESCE((eval_row->>'before_passed')::boolean, false),
    COALESCE((eval_row->>'after_passed')::boolean, false),
    eval_row
  FROM jsonb_array_elements(p_evaluation->'examples') AS eval_row
  WHERE COALESCE(eval_row->>'outcome', '') IN (
    'improvement', 'regression', 'unchanged_correct', 'unchanged_incorrect'
  );

  INSERT INTO public.code_analyzer_learning_audit (project_id, version_id, actor_id, action, detail)
  VALUES (p_project_id, version_id, actor, 'promoted', p_evaluation);
  RETURN version_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.code_analyzer_learning_rollback(
  p_project_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
  active_id UUID;
  previous_id UUID;
BEGIN
  actor := public.code_analyzer_learning_require_editor(p_project_id);
  SELECT id, previous_version_id INTO active_id, previous_id
  FROM public.code_analyzer_learning_versions
  WHERE project_id = p_project_id AND is_active AND status = 'promoted'
  LIMIT 1;
  IF active_id IS NULL THEN
    RAISE EXCEPTION 'No active learning version to roll back.';
  END IF;
  PERFORM set_config('code_analyzer.learning_transition', '1', true);
  UPDATE public.code_analyzer_learning_versions
    SET is_active = false, status = 'rolled_back', rolled_back_by = actor, rollback_reason = left(COALESCE(p_reason, ''), 500)
    WHERE id = active_id;
  UPDATE public.code_analyzer_learning_guidance
    SET status = 'rolled_back'
    WHERE version_id = active_id AND status = 'promoted';
  IF previous_id IS NOT NULL THEN
    UPDATE public.code_analyzer_learning_versions
      SET is_active = true, status = 'promoted'
      WHERE id = previous_id AND project_id = p_project_id;
  END IF;
  INSERT INTO public.code_analyzer_learning_audit (project_id, version_id, actor_id, action, detail)
  VALUES (
    p_project_id,
    active_id,
    actor,
    'rolled_back',
    jsonb_build_object('restored_version_id', previous_id, 'reason', p_reason)
  );
  RETURN previous_id;
END;
$$;

REVOKE ALL ON FUNCTION public.code_analyzer_learning_feedback_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.code_analyzer_learning_guidance_error(TEXT, JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.code_analyzer_learning_controlled_write() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.code_analyzer_learning_audit_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.code_analyzer_learning_applications_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.code_analyzer_learning_require_editor(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.code_analyzer_learning_submit(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.code_analyzer_learning_decide(UUID, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.code_analyzer_learning_promote(UUID, UUID[], JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.code_analyzer_learning_rollback(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.code_analyzer_learning_submit(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.code_analyzer_learning_decide(UUID, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.code_analyzer_learning_promote(UUID, UUID[], JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.code_analyzer_learning_rollback(UUID, TEXT) TO authenticated;

REVOKE ALL ON public.code_analyzer_learning_feedback FROM PUBLIC, anon;
REVOKE ALL ON public.code_analyzer_learning_versions FROM PUBLIC, anon;
REVOKE ALL ON public.code_analyzer_learning_guidance FROM PUBLIC, anon;
REVOKE ALL ON public.code_analyzer_learning_evaluations FROM PUBLIC, anon;
REVOKE ALL ON public.code_analyzer_learning_audit FROM PUBLIC, anon;
REVOKE ALL ON public.code_analyzer_learning_applications FROM PUBLIC, anon;

GRANT SELECT ON public.code_analyzer_learning_feedback TO authenticated;
GRANT SELECT ON public.code_analyzer_learning_versions TO authenticated;
GRANT SELECT ON public.code_analyzer_learning_guidance TO authenticated;
GRANT SELECT ON public.code_analyzer_learning_evaluations TO authenticated;
GRANT SELECT ON public.code_analyzer_learning_audit TO authenticated;
GRANT SELECT ON public.code_analyzer_learning_applications TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_learning_feedback TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_learning_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_learning_guidance TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_learning_evaluations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_learning_audit TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_analyzer_learning_applications TO service_role;
