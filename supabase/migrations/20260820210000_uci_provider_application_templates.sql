-- UCI provider-scoped manual application template manifests (D3 Application Builder).
-- Written by scraper-service (service role); readable by authenticated users via utility_providers SELECT.

ALTER TABLE public.utility_providers
  ADD COLUMN IF NOT EXISTS uci_application_templates JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.utility_providers.uci_application_templates IS
  'Provider/workflow application package manifests keyed by "{utility_type}:{application_type}". Manual uploads supplement built-in filesystem templates.';
