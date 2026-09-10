-- Admin-created users: first-login password change enforcement (additive, backward-compatible)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_by_admin BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.must_change_password IS
  'When true, user must set a new password before accessing the application.';

COMMENT ON COLUMN public.profiles.created_by_admin IS
  'True when the account was provisioned by a platform admin (not self-signup).';

COMMENT ON COLUMN public.profiles.password_changed_at IS
  'Timestamp of the most recent user-initiated password change.';
