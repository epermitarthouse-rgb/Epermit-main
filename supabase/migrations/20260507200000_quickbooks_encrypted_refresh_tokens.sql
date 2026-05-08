-- QuickBooks: persist encrypted refresh tokens only; access tokens are volatile (process memory).

ALTER TABLE public.quickbooks_connections
  ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS encrypted_token_version TEXT DEFAULT 'v1';

ALTER TABLE public.quickbooks_connections
  ALTER COLUMN access_token DROP NOT NULL,
  ALTER COLUMN refresh_token DROP NOT NULL,
  ALTER COLUMN access_token_expires_at DROP NOT NULL;

COMMENT ON COLUMN public.quickbooks_connections.encrypted_refresh_token IS
  'AES-256-GCM ciphertext (JSON: version, iv, authTag, ciphertext as base64).';

COMMENT ON COLUMN public.quickbooks_connections.access_token IS
  'Legacy column; must be NULL — access tokens are not persisted.';

COMMENT ON COLUMN public.quickbooks_connections.refresh_token IS
  'Legacy plaintext column; must be NULL — use encrypted_refresh_token.';
