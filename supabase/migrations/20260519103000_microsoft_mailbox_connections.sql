-- Phase 3.5: Microsoft Graph mailbox OAuth tokens (encrypted at application layer).

CREATE TABLE IF NOT EXISTS public.microsoft_mailbox_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mailbox_email TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  encrypted_token_json TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected',
  last_connected_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT microsoft_mailbox_connections_user_id_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_microsoft_mailbox_connections_user_id
  ON public.microsoft_mailbox_connections (user_id);

COMMENT ON TABLE public.microsoft_mailbox_connections IS
  'Microsoft Graph delegated tokens; readable/writable only via service_role backend — no client policies.';

ALTER TABLE public.microsoft_mailbox_connections ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_microsoft_mailbox_connections_updated_at
  BEFORE UPDATE ON public.microsoft_mailbox_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
