-- Module feature flags: global product visibility for main modules (default ON)
-- DO NOT apply until reviewed. Regenerate src/integrations/supabase/types.ts after apply.

INSERT INTO public.feature_flags (key, enabled, label, description, category)
VALUES
  (
    'module.design_check',
    true,
    'DesignCheck',
    'Pre-submittal readiness overview at /designcheck',
    'Modules'
  ),
  (
    'module.code_analyzer',
    true,
    'Code Analyzer',
    'Code compliance analysis at /code-compliance',
    'Modules'
  ),
  (
    'module.utility_coordination',
    true,
    'Utility Coordination',
    'UCI workspace and all /uci routes including portal harvest',
    'Modules'
  ),
  (
    'module.jurisdiction_map',
    true,
    'Jurisdiction Map',
    'Interactive coverage map and state landing pages',
    'Modules'
  ),
  (
    'module.provider_compare',
    true,
    'Provider Compare',
    'Side-by-side jurisdiction comparison',
    'Modules'
  ),
  (
    'module.permit_intelligence',
    true,
    'Permit Intelligence',
    'Permit data search and intelligence',
    'Modules'
  ),
  (
    'module.permit_filing',
    true,
    'Permit Filing',
    'Multi-municipality permit filing wizard',
    'Modules'
  ),
  (
    'module.response_matrix',
    true,
    'Response Matrix',
    'Comment response matrix, review, and classified comments',
    'Modules'
  ),
  (
    'module.portal_harvest',
    true,
    'Portal Harvest',
    'Portal data gathering at /portal-data',
    'Modules'
  ),
  (
    'module.operations_board',
    true,
    'Operations Board',
    'Reimbursables, scope, and PM workflow board',
    'Modules'
  ),
  (
    'module.demo',
    true,
    'Executive Demo',
    'McDonald''s executive demo routes under /demo',
    'Modules'
  )
ON CONFLICT (key) DO NOTHING;
