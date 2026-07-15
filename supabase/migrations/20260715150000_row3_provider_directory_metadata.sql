-- Row 3: Seed utility provider directory metadata hardening.
-- Backfills only fields documented in Phase 5 (uci_execution_sprints_and_phases.md):
--   primary_portal_type = 'portal'
--   portal_credentials_ref = credential label (matches PortalCredentialsManager / utility name)
--   portal_url = nullable if unknown (PEPCO only — verified in PEPCO scraper/docs)
-- Does NOT set service_territory, ownership_type, or multi-utility-type values.

UPDATE public.utility_providers
SET
  primary_portal_type = 'portal',
  portal_credentials_ref = name,
  updated_at = now()
WHERE is_global_template = true
  AND tenant_id IS NULL
  AND slug IN (
    'pepco',
    'bge',
    'washington-gas',
    'dominion',
    'fpl',
    'con-edison',
    'pseg',
    'eversource',
    'duke-energy',
    'georgia-power'
  );

-- PEPCO SIUP portal base URL (verified: scrapers/pepco/* and UCI sprint 4 prompts).
UPDATE public.utility_providers
SET
  portal_url = 'https://secure.pepco.com/service-installation-upgrades-portal/',
  updated_at = now()
WHERE is_global_template = true
  AND tenant_id IS NULL
  AND slug = 'pepco';
