-- Portal credentials should be unique per jurisdiction + portal_username (case-insensitive).
-- Existing duplicate rows must be merged manually before this index can be applied in production.
-- Application layer dedupes by canonical key until cleanup is complete.

-- Uncomment after duplicate portal_credentials rows are resolved:
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_credentials_canonical_identity
--   ON public.portal_credentials (
--     lower(trim(jurisdiction)),
--     lower(trim(portal_username))
--   );

COMMENT ON TABLE public.portal_credentials IS
  'Shared portal login records. Canonical identity is lower(trim(jurisdiction)) + lower(trim(portal_username)). Duplicate rows are legacy data; new inserts reuse existing credentials at the API layer.';
