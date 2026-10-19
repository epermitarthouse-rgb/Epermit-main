-- Code Analyzer V2 authoritative jurisdiction/edition registry.
-- This migration defines storage and run context only. It does not bulk-ingest
-- proprietary ICC/NFPA text and must be applied explicitly after review.

CREATE TABLE IF NOT EXISTS public.code_analyzer_jurisdiction_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_key TEXT NOT NULL UNIQUE,
  jurisdiction_key TEXT NOT NULL,
  jurisdiction_name TEXT NOT NULL,
  governing_authority TEXT NOT NULL,
  jurisdiction_code_family TEXT NOT NULL,
  jurisdiction_code_edition TEXT NOT NULL,
  base_codes JSONB NOT NULL DEFAULT '[]'::JSONB,
  local_amendments JSONB NOT NULL DEFAULT '[]'::JSONB,
  referenced_standards JSONB NOT NULL DEFAULT '[]'::JSONB,
  effective_from DATE NOT NULL,
  superseded_on DATE,
  official_source_url TEXT NOT NULL,
  official_text_url TEXT,
  verification_date DATE NOT NULL,
  source_status TEXT NOT NULL
    CHECK (source_status IN ('verified', 'provisional', 'unavailable', 'outdated')),
  applicable_permit_dates JSONB NOT NULL DEFAULT '{}'::JSONB,
  transition_provisions JSONB NOT NULL DEFAULT '[]'::JSONB,
  documented_exceptions JSONB NOT NULL DEFAULT '[]'::JSONB,
  coverage JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (superseded_on IS NULL OR superseded_on >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_jurisdiction_editions_lookup
  ON public.code_analyzer_jurisdiction_editions
  (jurisdiction_key, source_status, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.code_analyzer_code_provisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provision_key TEXT NOT NULL UNIQUE,
  registry_key TEXT NOT NULL
    REFERENCES public.code_analyzer_jurisdiction_editions(registry_key) ON DELETE CASCADE,
  jurisdiction_key TEXT NOT NULL,
  jurisdiction_code_edition TEXT NOT NULL,
  code_book TEXT NOT NULL,
  edition TEXT NOT NULL,
  base_code_family TEXT,
  base_code_edition TEXT,
  section TEXT NOT NULL,
  heading TEXT,
  exact_text TEXT,
  exact_text_stored BOOLEAN NOT NULL DEFAULT false,
  provision_type TEXT NOT NULL DEFAULT 'requirement'
    CHECK (provision_type IN ('requirement', 'amendment', 'applicability', 'exception', 'commentary')),
  topics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  thresholds JSONB NOT NULL DEFAULT '[]'::JSONB,
  exceptions JSONB NOT NULL DEFAULT '[]'::JSONB,
  applicability JSONB NOT NULL DEFAULT '{}'::JSONB,
  source_url TEXT NOT NULL,
  source_locator TEXT,
  verification_date DATE NOT NULL,
  source_status TEXT NOT NULL
    CHECK (source_status IN ('verified_text', 'verified_summary', 'provisional', 'unavailable', 'outdated')),
  verification_status TEXT NOT NULL
    CHECK (verification_status IN ('verified', 'provisional', 'unavailable', 'outdated')),
  license_status TEXT NOT NULL,
  authoritative BOOLEAN NOT NULL DEFAULT false,
  supports_confirmed_violation BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    NOT authoritative
    OR (
      verification_status = 'verified'
      AND source_status = 'verified_text'
      AND exact_text_stored
      AND length(trim(COALESCE(exact_text, ''))) >= 12
    )
  ),
  CHECK (NOT supports_confirmed_violation OR authoritative)
);

CREATE INDEX IF NOT EXISTS idx_code_analyzer_code_provisions_filter
  ON public.code_analyzer_code_provisions
  (jurisdiction_key, jurisdiction_code_edition, code_book, edition, verification_status);
CREATE INDEX IF NOT EXISTS idx_code_analyzer_code_provisions_topics
  ON public.code_analyzer_code_provisions USING GIN (topics);

ALTER TABLE public.code_analyzer_jurisdiction_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_analyzer_code_provisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS code_analyzer_registry_authenticated_read
  ON public.code_analyzer_jurisdiction_editions;
CREATE POLICY code_analyzer_registry_authenticated_read
  ON public.code_analyzer_jurisdiction_editions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS code_analyzer_provisions_authenticated_read
  ON public.code_analyzer_code_provisions;
CREATE POLICY code_analyzer_provisions_authenticated_read
  ON public.code_analyzer_code_provisions
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.code_analyzer_jurisdiction_editions TO authenticated;
GRANT SELECT ON public.code_analyzer_code_provisions TO authenticated;
GRANT ALL ON public.code_analyzer_jurisdiction_editions TO service_role;
GRANT ALL ON public.code_analyzer_code_provisions TO service_role;

ALTER TABLE public.code_analyzer_runs
  ADD COLUMN IF NOT EXISTS requested_review_scope TEXT NOT NULL DEFAULT 'reference_only'
    CHECK (requested_review_scope IN ('reference_only', 'permit_compliance')),
  ADD COLUMN IF NOT EXISTS permit_facts JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS reference_review_confirmed BOOLEAN NOT NULL DEFAULT false;

INSERT INTO public.code_analyzer_jurisdiction_editions (
  registry_key, jurisdiction_key, jurisdiction_name, governing_authority,
  jurisdiction_code_family, jurisdiction_code_edition, base_codes,
  local_amendments, referenced_standards, effective_from, superseded_on,
  official_source_url, official_text_url, verification_date, source_status,
  applicable_permit_dates, transition_provisions, documented_exceptions, coverage
) VALUES
(
  'dc-2017-construction-codes', 'dc', 'Washington, DC',
  'District of Columbia Department of Buildings',
  'District of Columbia Construction Codes', '2017',
  '[{"family":"IBC","edition":"2015","discipline":"building"},{"family":"IEBC","edition":"2015","discipline":"existing_building"},{"family":"NEC","edition":"2014","discipline":"electrical"},{"family":"ASHRAE 90.1","edition":"2013","discipline":"commercial_energy"}]'::JSONB,
  '[{"codeBook":"DCMR Title 12, subtitles A-M","status":"verified","sourceUrl":"https://dob.dc.gov/page/dc-construction-codes"}]'::JSONB,
  '[{"family":"NFPA 70","edition":"2014","status":"adopted_base_code"},{"family":"ANSI/ASHRAE/IES 90.1","edition":"2013","status":"adopted_base_code"}]'::JSONB,
  DATE '2020-05-29', NULL,
  'https://dob.dc.gov/page/dc-construction-codes',
  'https://dob.dc.gov/sites/default/files/dc/sites/dob/publication/attachments/2017%20District%20of%20Columbia%20Building%20Code_Part%201.pdf',
  DATE '2026-10-20', 'verified',
  '{"defaultOnOrAfter":"2020-05-29","priorApplicationsRequireTransitionReview":true}'::JSONB,
  '[{"codeBook":"12-A DCMR","section":"123","topics":["permits issued before adoption","applications filed before adoption","design contracts executed before adoption","tenant layouts","permit revisions"],"rules":{"existing_permit":{"section":"12-A DCMR 123.1.1","requireOriginalEdition":true,"requireActivePermit":true},"pre_adoption_application":{"section":"12-A DCMR 123.1.2","requireDepositDate":true,"requireApplicationComplete":true},"design_contract":{"section":"12-A DCMR 123.1.3","requiresFurtherDocumentReview":true},"tenant_layout":{"section":"12-A DCMR 123.1.4","requireOriginalEdition":true},"revision":{"section":"12-A DCMR 123.1.5","requireOriginalEdition":true,"requireActivePermit":true}}}]'::JSONB,
  '["Section 102.6 exceptions","Section 123 conditions and code-official determinations"]'::JSONB,
  '{"adoption":"verified","applicability":"verified_partial","enforceableProvisionText":"unavailable","note":"No licensed comprehensive ICC/NFPA text is bundled."}'::JSONB
),
(
  'dc-2013-construction-codes', 'dc', 'Washington, DC',
  'District of Columbia Department of Buildings',
  'District of Columbia Construction Codes', '2013',
  '[{"family":"IBC","edition":"2012","discipline":"building"},{"family":"IEBC","edition":"2012","discipline":"existing_building"},{"family":"NEC","edition":"2011","discipline":"electrical"}]'::JSONB,
  '[{"codeBook":"DCMR Title 12 Construction Codes Supplement of 2013","status":"verified","sourceUrl":"https://dob.dc.gov/page/dc-construction-codes"}]'::JSONB,
  '[]'::JSONB,
  DATE '2014-03-28', DATE '2020-05-28',
  'https://dob.dc.gov/page/dc-construction-codes',
  'https://dob.dc.gov/page/dc-construction-codes',
  DATE '2026-10-20', 'verified',
  '{"defaultOnOrAfter":"2014-03-28","defaultThrough":"2020-05-28","transitionRightsMayContinueAfterSupersession":true}'::JSONB,
  '[]'::JSONB,
  '["Projects entitled to use prior editions under 12-A DCMR Section 123"]'::JSONB,
  '{"adoption":"verified","applicability":"verified_partial","enforceableProvisionText":"unavailable","note":"No licensed comprehensive ICC/NFPA text is bundled."}'::JSONB
)
ON CONFLICT (registry_key) DO UPDATE SET
  governing_authority = EXCLUDED.governing_authority,
  base_codes = EXCLUDED.base_codes,
  local_amendments = EXCLUDED.local_amendments,
  referenced_standards = EXCLUDED.referenced_standards,
  effective_from = EXCLUDED.effective_from,
  superseded_on = EXCLUDED.superseded_on,
  official_source_url = EXCLUDED.official_source_url,
  official_text_url = EXCLUDED.official_text_url,
  verification_date = EXCLUDED.verification_date,
  source_status = EXCLUDED.source_status,
  applicable_permit_dates = EXCLUDED.applicable_permit_dates,
  transition_provisions = EXCLUDED.transition_provisions,
  documented_exceptions = EXCLUDED.documented_exceptions,
  coverage = EXCLUDED.coverage,
  updated_at = now();

-- Only exact, official DC amendment excerpts are seeded. These applicability
-- provisions cannot support a confirmed dimensional/fire/accessibility violation.
INSERT INTO public.code_analyzer_code_provisions (
  provision_key, registry_key, jurisdiction_key, jurisdiction_code_edition,
  code_book, edition, base_code_family, base_code_edition, section, heading,
  exact_text, exact_text_stored, provision_type, topics, thresholds, exceptions,
  applicability, source_url, source_locator, verification_date, source_status,
  verification_status, license_status, authoritative, supports_confirmed_violation
) VALUES
(
  'dc-2017-12a-123.1.1', 'dc-2017-construction-codes', 'dc', '2017',
  '12-A DCMR', '2017', 'IBC', '2015', '123.1.1',
  'Permits issued prior to adoption of Construction Codes',
  'Work authorized by a permit issued before the effective date of the new edition of the Construction Codes, which permit has not expired pursuant to Section 105.10 or been revoked pursuant to Section 111, shall be allowed to be carried to completion under the edition of the Construction Codes under which the permit was issued, subject to the exceptions stated in Section 102.6.',
  true, 'applicability', ARRAY['permit issued','active permit','prior edition','transition'],
  '[]'::JSONB,
  '["The permit must not be expired or revoked.","Section 102.6 exceptions apply."]'::JSONB,
  '{"effectiveFrom":"2020-05-29","workScopes":["existing_permit"]}'::JSONB,
  'https://dob.dc.gov/sites/default/files/dc/sites/dob/publication/attachments/2017%20District%20of%20Columbia%20Building%20Code_Part%201.pdf',
  '2017 DC Building Code Part 1, Section 123.1.1', DATE '2026-10-20',
  'verified_text', 'verified', 'official_government_publication_excerpt', true, false
),
(
  'dc-2017-12a-123.1.4', 'dc-2017-construction-codes', 'dc', '2017',
  '12-A DCMR', '2017', 'IBC', '2015', '123.1.4',
  'Tenant layout permits in a new building',
  'The work necessary to finish the interior layout of every tenant space in a new building authorized by a permit issued under a previous edition of the Construction Codes, for first occupancy of each such tenant space, shall be considered part of the completion of said building, and the permits for such tenant work shall be allowed to be processed under the same edition of the Construction Codes as the permit for the new building, regardless of when the tenant layout project begins.',
  true, 'applicability', ARRAY['tenant layout','first occupancy','prior edition','transition'],
  '[]'::JSONB, '[]'::JSONB,
  '{"effectiveFrom":"2020-05-29","workScopes":["tenant_layout"]}'::JSONB,
  'https://dob.dc.gov/sites/default/files/dc/sites/dob/publication/attachments/2017%20District%20of%20Columbia%20Building%20Code_Part%201.pdf',
  '2017 DC Building Code Part 1, Section 123.1.4', DATE '2026-10-20',
  'verified_text', 'verified', 'official_government_publication_excerpt', true, false
)
ON CONFLICT (provision_key) DO UPDATE SET
  exact_text = EXCLUDED.exact_text,
  source_url = EXCLUDED.source_url,
  source_locator = EXCLUDED.source_locator,
  verification_date = EXCLUDED.verification_date,
  source_status = EXCLUDED.source_status,
  verification_status = EXCLUDED.verification_status,
  authoritative = EXCLUDED.authoritative,
  supports_confirmed_violation = EXCLUDED.supports_confirmed_violation,
  updated_at = now();

DROP FUNCTION IF EXISTS public.create_code_analyzer_run_async_v2(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[], TEXT[], UUID, TEXT, JSONB
);

CREATE OR REPLACE FUNCTION public.create_code_analyzer_run_async_v2(
  p_project_id UUID,
  p_user_id UUID,
  p_analysis_type TEXT,
  p_jurisdiction TEXT,
  p_project_type TEXT,
  p_code_year TEXT,
  p_analysis_mode TEXT,
  p_source_fingerprint TEXT,
  p_sheet_ids UUID[],
  p_analysis_modes TEXT[] DEFAULT ARRAY['ibc']::TEXT[],
  p_form_document_id UUID DEFAULT NULL,
  p_analysis_instructions TEXT DEFAULT NULL,
  p_index_completeness JSONB DEFAULT NULL,
  p_requested_review_scope TEXT DEFAULT 'reference_only',
  p_permit_facts JSONB DEFAULT '{}'::JSONB,
  p_reference_review_confirmed BOOLEAN DEFAULT false
)
RETURNS TABLE (run public.code_analyzer_runs, jobs_created INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.code_analyzer_runs;
  v_sheet_id UUID;
  v_mode TEXT;
  v_count INTEGER := 0;
BEGIN
  IF NOT public.has_project_editor_access(p_user_id, p_project_id) THEN
    RAISE EXCEPTION 'access denied';
  END IF;
  IF p_requested_review_scope NOT IN ('reference_only', 'permit_compliance') THEN
    RAISE EXCEPTION 'invalid review scope';
  END IF;

  UPDATE public.code_analyzer_runs
  SET status = 'superseded', updated_at = now()
  WHERE project_id = p_project_id
    AND analysis_type = COALESCE(p_analysis_type, 'standard_compliance')
    AND status IN ('current', 'stale', 'running', 'queued', 'partial', 'failed');

  INSERT INTO public.code_analyzer_runs (
    project_id, user_id, status, jurisdiction, project_type, code_year,
    analysis_mode, analysis_type, source_fingerprint, form_document_id,
    analysis_instructions, index_completeness, requested_review_scope,
    permit_facts, reference_review_confirmed
  ) VALUES (
    p_project_id, p_user_id, 'queued', p_jurisdiction, p_project_type, p_code_year,
    p_analysis_mode, COALESCE(p_analysis_type, 'standard_compliance'), p_source_fingerprint,
    p_form_document_id, NULLIF(trim(p_analysis_instructions), ''), p_index_completeness,
    p_requested_review_scope, COALESCE(p_permit_facts, '{}'::JSONB),
    COALESCE(p_reference_review_confirmed, false)
  )
  RETURNING * INTO v_run;

  FOREACH v_sheet_id IN ARRAY COALESCE(p_sheet_ids, ARRAY[]::UUID[])
  LOOP
    FOREACH v_mode IN ARRAY COALESCE(p_analysis_modes, ARRAY['ibc']::TEXT[])
    LOOP
      INSERT INTO public.code_analyzer_sheet_jobs (
        project_id, run_id, sheet_id, analysis_mode, status
      ) VALUES (
        p_project_id, v_run.id, v_sheet_id, v_mode, 'queued'
      )
      ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  UPDATE public.code_analyzer_runs
  SET status = 'running', updated_at = now()
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  run := v_run;
  jobs_created := v_count;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_code_analyzer_run_async_v2(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[], TEXT[], UUID, TEXT, JSONB, TEXT, JSONB, BOOLEAN
) TO authenticated;
