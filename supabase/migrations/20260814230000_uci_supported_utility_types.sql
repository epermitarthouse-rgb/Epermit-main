-- Platform-wide UCI utility types and tenant-created provider support.

ALTER TABLE public.utility_providers
  DROP CONSTRAINT IF EXISTS utility_providers_uci_utility_type_check;
ALTER TABLE public.utility_providers
  ADD CONSTRAINT utility_providers_uci_utility_type_check
  CHECK (utility_type IN ('electric', 'gas', 'water', 'sewer', 'telecom'))
  NOT VALID;

-- Coordination records retain the provider's exact type. Existing foundation
-- rows are backfilled before making this required.
UPDATE public.coordination_records AS cr
SET utility_type = up.utility_type
FROM public.utility_providers AS up
WHERE up.id = cr.utility_provider_id
  AND cr.utility_type IS NULL;

ALTER TABLE public.coordination_records
  ALTER COLUMN utility_type SET NOT NULL;

ALTER TABLE public.coordination_records
  DROP CONSTRAINT IF EXISTS coordination_records_uci_utility_type_check;
ALTER TABLE public.coordination_records
  ADD CONSTRAINT coordination_records_uci_utility_type_check
  CHECK (utility_type IN ('electric', 'gas', 'water', 'sewer', 'telecom'))
  NOT VALID;

ALTER TABLE public.coordination_records
  DROP CONSTRAINT IF EXISTS coordination_records_project_provider_scope_unique;
ALTER TABLE public.coordination_records
  ADD CONSTRAINT coordination_records_project_provider_type_scope_unique
  UNIQUE (project_id, utility_provider_id, utility_type, scope_description);
