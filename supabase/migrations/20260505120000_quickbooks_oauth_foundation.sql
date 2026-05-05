-- Phase 3B: QuickBooks OAuth connection storage + project QB linkage columns (tokens via service role only).

CREATE TABLE IF NOT EXISTS public.quickbooks_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,
  company_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ,
  scopes TEXT,
  token_type TEXT,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quickbooks_connections_environment_realm_unique UNIQUE (environment, realm_id)
);

CREATE INDEX IF NOT EXISTS idx_quickbooks_connections_environment_updated_at
  ON public.quickbooks_connections (environment, updated_at DESC);

COMMENT ON TABLE public.quickbooks_connections IS
  'QuickBooks OAuth tokens; readable/writable only via service_role backend — no client policies.';

ALTER TABLE public.quickbooks_connections ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_quickbooks_connections_updated_at
  BEFORE UPDATE ON public.quickbooks_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS qb_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS qb_invoice_id_m1 TEXT,
  ADD COLUMN IF NOT EXISTS qb_invoice_id_m2 TEXT,
  ADD COLUMN IF NOT EXISTS qb_invoice_id_m3 TEXT;
