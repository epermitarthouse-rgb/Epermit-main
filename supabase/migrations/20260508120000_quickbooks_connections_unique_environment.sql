-- One QuickBooks connection row per environment (matches upsert onConflict: environment).

ALTER TABLE public.quickbooks_connections
  DROP CONSTRAINT IF EXISTS quickbooks_connections_environment_realm_unique;

CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_connections_environment_unique
  ON public.quickbooks_connections (environment);
