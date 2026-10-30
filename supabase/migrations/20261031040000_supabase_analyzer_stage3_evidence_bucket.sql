-- Stage 3 private JSON evidence bucket (Apple Vision OCR packs).
-- Additive only. Does not alter drawing buckets, findings, or analyzer job tables.
-- Rollback: delete objects then DROP bucket (forward-fix preferred in prod).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'supabase-analyzer-stage3-evidence',
  'supabase-analyzer-stage3-evidence',
  false,
  262144, -- 256 KiB hard cap (app enforces 200 KiB)
  ARRAY['application/json']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Deny anon/authenticated direct object access. Edge service-role bypasses RLS.
-- No INSERT/SELECT/UPDATE/DELETE policies for authenticated or anon roles.

DROP POLICY IF EXISTS "Deny anon stage3 evidence select" ON storage.objects;
DROP POLICY IF EXISTS "Deny authenticated stage3 evidence select" ON storage.objects;
DROP POLICY IF EXISTS "Deny anon stage3 evidence insert" ON storage.objects;
DROP POLICY IF EXISTS "Deny authenticated stage3 evidence insert" ON storage.objects;

-- Explicit deny-style policies are unnecessary when no allow policies exist and
-- RLS is enabled on storage.objects (default). Document intent via comment only.
-- Service role (Edge processor + stage3-evidence function) remains the sole writer/reader.
